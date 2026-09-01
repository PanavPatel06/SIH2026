import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api.js";
import { freshnessLabel, outboxList } from "../offline.js";
import { GEOFENCE_RADIUS_KM, getDistanceToCentre } from "../geo.js";

const STATE_LABEL = {
  booked: "Booked — stay home until it's your turn",
  activated: "On the way",
  checked_in: "Checked in at the gate",
  weighed: "Weighed & accepted",
  deferred: "Not accepted — rebook once dry",
  done: "Payment complete",
};

// Farmer's phone shows this at the gate instead of reciting an 8-character
// token — the officer scans it with the camera scanner on the dashboard's
// Bookings page (README §17 step 5, "gate scans offline": no network call
// happens here, it's a pure client-side render of the token already cached).
function TokenQR({ token }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    QRCode.toDataURL(token, { width: 160, margin: 1 }).then(setDataUrl).catch(() => setDataUrl(""));
  }, [token]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt={`QR code for ${token}`} width={160} height={160} style={{ display: "block", margin: "8px 0" }} />;
}

// Real geofence: tries the device's GPS against the centre's coordinates and
// auto-activates within GEOFENCE_RADIUS_KM. Any failure (no GPS, permission
// denied, unknown centre) falls back to the plain manual button — a farmer's
// phone in a field is never something to block the flow on.
function GeofenceButton({ token, centre, onActivated }) {
  const [status, setStatus] = useState("idle"); // idle | checking | far | error
  const [distanceKm, setDistanceKm] = useState(null);

  const doActivate = async () => {
    await api.activate(token);
    onActivated();
  };

  const check = async () => {
    if (!centre) return doActivate(); // no coordinates cached — skip straight to manual
    setStatus("checking");
    try {
      const d = await getDistanceToCentre(centre.lat, centre.lon);
      setDistanceKm(d);
      if (d <= GEOFENCE_RADIUS_KM) {
        await doActivate();
      } else {
        setStatus("far");
      }
    } catch {
      setStatus("error"); // no GPS / denied — offer manual fallback below
    }
  };

  if (status === "checking") return <p className="muted">Checking your location…</p>;
  if (status === "far") {
    return (
      <p className="muted">
        You're {distanceKm.toFixed(1)} km away — get within {GEOFENCE_RADIUS_KM} km to activate, or{" "}
        <button className="secondary" style={{ width: "auto" }} onClick={doActivate}>activate manually</button>
      </p>
    );
  }
  if (status === "error") {
    return <button onClick={doActivate}>I'm on my way (couldn't check GPS — tap to confirm)</button>;
  }
  return <button onClick={check}>I'm on my way (within {GEOFENCE_RADIUS_KM} km)</button>;
}

export default function MyBookings({ farmer }) {
  const [bookings, setBookings] = useState({ data: [], fresh: true, at: null });
  const [centresById, setCentresById] = useState({});
  const [pending, setPending] = useState([]);
  const [error, setError] = useState("");

  const load = () => {
    api.myBookings().then(setBookings).catch((e) => setError(String(e)));
    setPending(outboxList());
  };
  useEffect(load, [farmer.id]);
  useEffect(() => {
    api.centres().then((r) => setCentresById(Object.fromEntries(r.data.map((c) => [c.id, c])))).catch(() => {});
  }, []);

  return (
    <>
      {error && <div className="card" style={{ color: "#c0392b", fontSize: 13 }}>{error}</div>}

      {pending.length > 0 && (
        <div className="card" style={{ background: "#fff9c4" }}>
          <h2>Waiting to sync ({pending.length})</h2>
          <p className="muted">Booked while offline — will submit automatically once you have signal.</p>
        </div>
      )}

      <div className="card">
        <h2>My bookings</h2>
        {!bookings.fresh && <div className="stale">As of {freshnessLabel(bookings.at)}</div>}
        {!bookings.data.length && <p className="muted">No bookings yet — book a slot from Home.</p>}
        {bookings.data.map((b) => (
          <div key={b.token} style={{ borderTop: "1px solid #eee", paddingTop: 10, marginTop: 10 }}>
            <div className="token">{b.token}</div>
            <p style={{ fontSize: 13, marginTop: 6 }}>
              {STATE_LABEL[b.state] || b.state}
              <br />
              Predicted ETA: <strong>{new Date(b.predicted_eta).toLocaleString()}</strong>
            </p>
            {b.state === "booked" && (
              <>
                <TokenQR token={b.token} />
                <GeofenceButton token={b.token} centre={centresById[b.centre_id]} onActivated={load} />
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
