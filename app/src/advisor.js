// On-device slot advisor — README §11. Runs entirely in the browser with the
// last-synced capacity number, zero network required. This is a rule-based
// stand-in for the trained LightGBM/ONNX model the README describes; swap
// `rankSlots` for a call into onnxruntime-web once real historical data
// exists to train on. The interface (inputs in, ranked slots out) won't change.
const OPERATING_START_HOUR = 6;
const SLOT_BLOCKS = 12; // 06:00-18:00, one block per hour
const OPERATING_MINUTES = SLOT_BLOCKS * 60;
const MOISTURE_LIMIT = 12.0;
const TROLLEY_RENT_RUPEES = 1500; // ponytail: a flat pilot estimate — vary by district if you get real data

// Farmers habitually arrive at dawn regardless of their booked block (the
// whole premise of this project — README §1). Model that real-world skew even
// though every block has equal *formal* capacity, so the advisor doesn't
// recommend 6 AM by default and accidentally recreate the stampede.
const DAWN_CROWDING = [1.7, 1.55, 1.35, 1.15, 1.0, 1.0, 1.0, 0.95, 0.9, 0.85, 0.85, 0.85];

export function rejectionRisk(moisturePct) {
  if (moisturePct == null) return { risk: 0.1, reason: "No moisture reading yet — assuming dry." };
  if (moisturePct <= MOISTURE_LIMIT) {
    return { risk: 0.05, reason: `Moisture ${moisturePct}% — within the ${MOISTURE_LIMIT}% limit.` };
  }
  const over = moisturePct - MOISTURE_LIMIT;
  return {
    risk: Math.min(0.95, 0.3 + over * 0.15),
    reason: `Moisture ${moisturePct}% — ${over.toFixed(1)}pt over limit. Dry before travelling.`,
  };
}

export function rankSlots({ computedCapacity, moisturePct = null }) {
  if (!computedCapacity || computedCapacity <= 0) return [];
  const avgServiceMin = OPERATING_MINUTES / computedCapacity;
  const perBlock = Math.max(1, Math.floor(computedCapacity / SLOT_BLOCKS));
  const { risk, reason } = rejectionRisk(moisturePct);

  const slots = [];
  for (let block = 0; block < SLOT_BLOCKS; block++) {
    const crowding = DAWN_CROWDING[block] ?? 1.0;
    // mid-block position, adjusted for how much heavier that hour really runs
    const effectivePosition = (perBlock / 2) * crowding;
    const waitMin = Math.round(effectivePosition * avgServiceMin);
    const hour = OPERATING_START_HOUR + block;
    const costRupees = Math.round(risk * TROLLEY_RENT_RUPEES);
    slots.push({
      block,
      label: `${String(hour).padStart(2, "0")}:00`,
      predictedWaitMin: waitMin,
      rejectionRisk: risk,
      rejectionReason: reason,
      estimatedCostRupees: costRupees,
      score: waitMin + risk * 200, // wait in minutes vs. risk, weighted so risk dominates as it should
    });
  }
  return slots.sort((a, b) => a.score - b.score);
}
