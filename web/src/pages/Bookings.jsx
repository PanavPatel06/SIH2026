import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const today = () => new Date().toISOString().slice(0, 10);
const STAGES = ["jform_issued", "uploaded_to_portal", "payment_advised", "dbt_credited"];

// Gate operator's camera scanner (README §17 step 5, "gate scans offline") —
// decodes entirely on-device via the native BarcodeDetector API, the same
// token the farmer's QR (app/src/pages/MyBookings.jsx) encodes. No network
// call until the decoded token hits the existing /checkin endpoint below, so
// this is genuinely offline-capable, not just camera-flavoured.
// ponytail: native BarcodeDetector over a decode library — Chrome/Edge/
// Android WebView support it, Safari doesn't. Falls back to the manual
// table buttons below on any unsupported browser or camera failure; add
// a jsQR fallback only if a pilot actually hits a Safari-only device.
function ScanCheckin({ onScanned }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOpen(false);
  };

  const start = async () => {
    setOpen(true);
    setStatus("Requesting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus("Point at the farmer's QR code");
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const loop = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length) {
            const token = codes[0].rawValue;
            stop();
            onScanned(token);
            return;
          }
        } catch {
          // transient mid-frame decode errors are normal — keep polling
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch {
      setStatus("Camera unavailable — use the table below instead.");
    }
  };

  if (!supported) return null; // manual table check-in below always works regardless

  return (
    <div style={{ marginBottom: 16 }}>
      {!open && (
        <button className="secondary" style={{ width: "auto" }} onClick={start}>📷 Scan to check in</button>
      )}
      {open && (
        <div>
          <video ref={videoRef} style={{ width: 240, borderRadius: 8 }} muted playsInline />
          <p className="muted">{status}</p>
          <button className="secondary" style={{ width: "auto" }} onClick={stop}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function PaymentPanel({ token }) {
  const [stages, setStages] = useState([]);
  const load = () => api.paymentStatus(token).then(setStages).catch(() => setStages([]));
  useEffect(load, [token]);

  const advance = async (stage) => {
    await api.advancePayment(token, stage);
    load();
  };

  const done = new Set(stages.map((s) => s.stage));
  const next = STAGES.find((s) => !done.has(s));

  return (
    <div style={{ marginTop: 6 }}>
      {stages.map((s) => (
        <span key={s.stage} className={`badge ${s.sla_breached ? "breach" : "ok"}`} style={{ marginRight: 4 }}>
          {s.stage}{s.sla_breached ? " ⚠ SLA breached" : ""}
        </span>
      ))}
      {next && (
        <button className="secondary" onClick={() => advance(next)} style={{ marginLeft: 6 }}>
          Advance → {next}
        </button>
      )}
    </div>
  );
}

export default function Bookings({ officer }) {
  const [centres, setCentres] = useState([]);
  const [centreId, setCentreId] = useState("");
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.centres().then((cs) => {
      // same centre-scoping as Dashboard.jsx — backend enforces it regardless
      const visible = officer.centre_id ? cs.filter((c) => c.id === officer.centre_id) : cs;
      setCentres(visible);
      if (visible.length) setCentreId(visible[0].id);
    });
  }, []);

  const load = () => {
    if (!centreId) return;
    api.centreBookings(centreId, today()).then(setBookings).catch((e) => setError(String(e)));
  };
  useEffect(load, [centreId]);

  const checkin = async (token) => {
    await api.checkin(token);
    load();
  };
  const weigh = async (token) => {
    await api.weigh(token);
    load();
  };

  return (
    <div className="card">
      <h2>Bookings — {today()}</h2>
      <label>Centre</label>
      <select value={centreId} onChange={(e) => setCentreId(e.target.value)}>
        {centres.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {error && <p style={{ color: "#c0392b" }}>{error}</p>}

      <ScanCheckin onScanned={(token) => checkin(token).catch((e) => setError(String(e.message || e)))} />

      <table style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>Token</th><th>Slot</th><th>Predicted ETA</th><th>State</th><th>Actions</th><th>Payment</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.token}>
              <td>{b.token}</td>
              <td>{b.slot_start.slice(11, 16)}</td>
              <td>{b.predicted_eta.slice(11, 16)}</td>
              <td><span className={`badge ${b.state}`}>{b.state}</span></td>
              <td>
                {b.state === "booked" && <button onClick={() => checkin(b.token)}>Check in</button>}
                {b.state === "checked_in" && <button onClick={() => weigh(b.token)}>Weigh</button>}
              </td>
              <td>{(b.state === "weighed" || b.state === "done") && <PaymentPanel token={b.token} />}</td>
            </tr>
          ))}
          {!bookings.length && (
            <tr><td colSpan="6" className="muted">No bookings yet for this centre today.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
