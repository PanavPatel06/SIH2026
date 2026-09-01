import { useEffect, useState } from "react";
import { api } from "../api.js";
import { rankSlots } from "../advisor.js";
import { freshnessLabel } from "../offline.js";

const today = () => new Date().toISOString().slice(0, 10);
const riskBand = (r) => (r < 0.3 ? "low" : r < 0.6 ? "med" : "high");

export default function Home({ farmer }) {
  const [centres, setCentres] = useState({ data: [], fresh: true, at: null });
  const [centreId, setCentreId] = useState("");
  const [capacity, setCapacity] = useState(null);
  const [moisture, setMoisture] = useState("");
  const [quantity, setQuantity] = useState("40");
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [alternatives, setAlternatives] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.centres().then((r) => {
      setCentres(r);
      if (r.data?.length) setCentreId(r.data[0].id);
    }).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!centreId) return;
    setCapacity(null);
    api.capacity(centreId, today()).then(setCapacity).catch(() => setCapacity(null));
  }, [centreId]);

  // On-device — no network call, works offline off the cached capacity number.
  const ranked = capacity
    ? rankSlots({
        computedCapacity: capacity.data?.computed_capacity,
        moisturePct: moisture === "" ? null : Number(moisture),
      })
    : [];
  const best = ranked[0];

  const book = async () => {
    setBusy(true);
    setError("");
    setAlternatives([]);
    try {
      const { data, queued } = await api.book({
        // farmer_id comes from the auth token server-side now, not this body
        centre_id: centreId,
        day: today(),
        quantity_quintals: Number(quantity) || 0,
        moisture_pct: moisture === "" ? null : Number(moisture),
      });
      if (queued) {
        setBooking({ queued: true });
      } else {
        setBooking({ queued: false, token: data.token, predicted_eta: data.predicted_eta });
      }
    } catch (e) {
      // A 409 here means this centre is full for today — cross-centre load
      // balancing (README §5): show the nearest less-crowded centre instead
      // of just failing the booking (README's whole point: reduce congestion
      // district-wide, not just queue farmers politely at one jammed centre).
      if (e.status === 409 && e.detail?.alternatives?.length) {
        setAlternatives(e.detail.alternatives);
        setError(`${centres.data.find((c) => c.id === centreId)?.name} is full for today.`);
      } else {
        setError(String(e.message || e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <div className="card" style={{ color: "#c0392b", fontSize: 13 }}>
          {error}
          {alternatives.map((a) => (
            <div key={a.centre_id} style={{ marginTop: 8, padding: 8, background: "#e8f5e9", borderRadius: 6, color: "#1a1a1a" }}>
              Try <strong>{a.name}</strong> instead — {a.free} trolleys free, {a.distance_km} km away.{" "}
              <button className="secondary" style={{ width: "auto", marginTop: 4 }} onClick={() => setCentreId(a.centre_id)}>
                Switch to {a.name}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Hi {farmer.name} 👋</h2>
        {!centres.fresh && <div className="stale">Showing centres from {freshnessLabel(centres.at)}</div>}
        <label>Procurement centre</label>
        <select value={centreId} onChange={(e) => setCentreId(e.target.value)}>
          {centres.data.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label>Quantity (quintals)</label>
        <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <label>Moisture % (if you've tested it)</label>
        <input type="number" step="0.1" placeholder="optional" value={moisture} onChange={(e) => setMoisture(e.target.value)} />
      </div>

      {capacity && (
        <div className="card">
          <h2>Today at {centres.data.find((c) => c.id === centreId)?.name}</h2>
          {!capacity.fresh && <div className="stale">As of {freshnessLabel(capacity.at)} — offline advice, not live</div>}
          <p><strong>{capacity.data.computed_capacity} trolleys today</strong> · limiting factor: {capacity.data.limiting_factor}</p>

          {best && (
            <div style={{ marginTop: 10 }}>
              <strong>🤖 On-device advisor</strong>
              <p style={{ fontSize: 13 }}>
                Best arrival window: <strong>{best.label}</strong> — ~{best.predictedWaitMin} min wait.{" "}
                <span className={`badge ${riskBand(best.rejectionRisk)}`}>
                  {Math.round(best.rejectionRisk * 100)}% rejection risk
                </span>
              </p>
              <p className="muted">{best.rejectionReason}</p>
              {best.rejectionRisk >= 0.5 && (
                <p style={{ color: "#c0392b", fontSize: 13 }}>
                  ⚠ Estimated wasted-trip cost if rejected: ₹{best.estimatedCostRupees}. Consider drying and rebooking instead.
                </p>
              )}
            </div>
          )}

          {!booking && (
            <button onClick={book} disabled={busy}>{busy ? "Booking…" : "Book earliest available slot"}</button>
          )}

          {booking?.queued && (
            <div style={{ marginTop: 10, padding: 10, background: "#eceff1", borderRadius: 6 }}>
              📥 No network right now — booking saved and will be submitted automatically when you're back online.
            </div>
          )}
          {booking && !booking.queued && (
            <div style={{ marginTop: 10, padding: 10, background: "#e8f5e9", borderRadius: 6 }}>
              ✅ Booked! Token <strong>{booking.token}</strong> — see "My Slot" tab.
            </div>
          )}
        </div>
      )}

      {centreId && !capacity && (
        <div className="card muted">No capacity published for this centre today yet.</div>
      )}
    </>
  );
}
