// Thin fetch wrapper — the backend is the boring part, so the client stays boring too.
export const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";
const TOKEN_KEY = "vaari:officer_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function req(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`${res.status} ${res.statusText}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  centres: () => req("/centres"),
  createCentre: (data) => req("/centres", { method: "POST", body: JSON.stringify(data) }),
  setCapacity: (centreId, data) =>
    req(`/centres/${centreId}/capacity`, { method: "POST", body: JSON.stringify(data) }),
  getCapacity: (centreId, day) => req(`/centres/${centreId}/capacity/${day}`).catch(() => null),
  centreBookings: (centreId, day) => req(`/centres/${centreId}/bookings?day=${day}`),
  checkin: (token) => req(`/bookings/${token}/checkin`, { method: "POST", body: JSON.stringify({}) }),
  weigh: (token) => req(`/bookings/${token}/weigh`, { method: "POST" }),
  paymentStatus: (token) => req(`/bookings/${token}/payment`),
  advancePayment: (token, stage) =>
    req(`/bookings/${token}/payment/advance`, { method: "POST", body: JSON.stringify({ stage }) }),
  loginOfficer: (data) => req("/auth/officer/login", { method: "POST", body: JSON.stringify(data) }),
  registerOfficer: (data) => req("/auth/officer/register", { method: "POST", body: JSON.stringify(data) }),
  me: () => req("/auth/officer/me"),
};
