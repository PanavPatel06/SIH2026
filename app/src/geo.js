// Real geofence — replaces the old "I'm on my way" manual button with an
// actual distance check against the centre's coordinates (README §9).
// Same haversine formula as backend/app/logic.py's haversine_km, so both
// sides agree on what "within range" means. Stdlib Math only — no dependency.
export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export const GEOFENCE_RADIUS_KM = 10; // README §9

// Resolves with a distance in km, or rejects (no GPS, permission denied,
// timeout). Callers always keep a manual fallback for the reject case —
// geolocation on a farmer's phone in a field is not something to block on.
export function getDistanceToCentre(centreLat, centreLon) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("no geolocation on this device"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(haversineKm(pos.coords.latitude, pos.coords.longitude, centreLat, centreLon)),
      (err) => reject(err),
      { timeout: 8000, maximumAge: 60000 }
    );
  });
}
