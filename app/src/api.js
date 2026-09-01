import { cacheGet, cacheSet, outboxAdd } from "./offline.js";

export const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";
const TOKEN_KEY = "vaari:token";

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function getCached(path, cacheKey, { timeoutMs = 4000 } = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API_BASE}${path}`, { signal: ctrl.signal, headers: authHeaders() });
    clearTimeout(t);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    cacheSet(cacheKey, data);
    return { data, fresh: true, at: Date.now() };
  } catch {
    const cached = cacheGet(cacheKey);
    if (cached) return { data: cached.data, fresh: false, at: cached.at };
    throw new Error("offline and nothing cached yet for this screen");
  }
}

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let detail;
    try {
      detail = JSON.parse(text).detail;
    } catch {
      detail = text;
    }
    const err = new Error(typeof detail === "string" ? detail : detail?.message || "request failed");
    err.detail = detail; // structured 409 bodies (e.g. { message, alternatives }) survive here
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Writes queue locally when offline and drain automatically once back online —
// the UI never blocks on the network (README §10, local-first writes).
async function postOrQueue(path, body, kind) {
  try {
    return { data: await post(path, body), queued: false };
  } catch (e) {
    if (!navigator.onLine) {
      outboxAdd({ path, body, kind });
      return { data: null, queued: true };
    }
    throw e;
  }
}

export const api = {
  centres: () => getCached("/centres", "centres"),
  capacity: (centreId, day) => getCached(`/centres/${centreId}/capacity/${day}`, `capacity:${centreId}:${day}`),
  myBookings: () => getCached("/me/bookings", "bookings:me"),
  booking: (token) => getCached(`/bookings/${token}`, `booking:${token}`),
  book: (data) => postOrQueue("/bookings", data, "book"),
  activate: (token) => postOrQueue(`/bookings/${token}/activate`, {}, "activate"),
  // auth — register/login aren't queued offline (a farmer's first login needs
  // a live network regardless; the outbox exists for actions taken once
  // already signed in, not for signing in itself)
  registerFarmer: (data) => post("/auth/farmer/register", data),
  loginFarmer: (data) => post("/auth/farmer/login", data),
  // deliberately not cached: this is the session-validity check on app load,
  // and falling back to a stale cache here would let an expired/logged-out
  // token (or a previous farmer's cached identity, on a shared device) look
  // valid. Must always hit the network and must throw cleanly on 401.
  me: async () => {
    const res = await fetch(`${API_BASE}/auth/farmer/me`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  },
};
