// Local-first cache. Every successful GET is stashed with a timestamp; every
// screen that reads it can show "as of HH:MM" instead of silently going stale
// (README §10 — a system that lies about freshness once is never trusted again).
const PREFIX = "vaari:";

export function cacheSet(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, at: Date.now() }));
  } catch {
    // storage full or unavailable — the app still works, it just won't have offline data
  }
}

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { data, at } = JSON.parse(raw);
    return { data, at };
  } catch {
    return null;
  }
}

export function freshnessLabel(at) {
  if (!at) return null;
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

// Outbox for writes made while offline — drained on the next successful request.
// ponytail: polled on interval below rather than a real background-sync
// registration; upgrade to the Background Sync API if offline booking volume
// ever justifies it.
export function outboxAdd(entry) {
  const list = JSON.parse(localStorage.getItem(PREFIX + "outbox") || "[]");
  list.push({ ...entry, id: crypto.randomUUID(), at: Date.now() });
  localStorage.setItem(PREFIX + "outbox", JSON.stringify(list));
}

export function outboxList() {
  return JSON.parse(localStorage.getItem(PREFIX + "outbox") || "[]");
}

export function outboxRemove(id) {
  const list = outboxList().filter((e) => e.id !== id);
  localStorage.setItem(PREFIX + "outbox", JSON.stringify(list));
}
