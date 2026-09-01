// Assert-based self-check, same convention as backend/test_logic.py.
// Run: node src/geo.test.mjs
import { haversineKm } from "./geo.js";

const dSelf = haversineKm(23.25, 77.4, 23.25, 77.4);
if (dSelf !== 0) throw new Error(`same point must be 0 km apart, got ${dSelf}`);

const dFar = haversineKm(28.6139, 77.209, 19.076, 72.8777); // Delhi -> Mumbai
if (!(dFar > 1100 && dFar < 1200)) throw new Error(`expected ~1150 km Delhi-Mumbai, got ${dFar}`);

console.log("ok  haversineKm (2 checks)");
