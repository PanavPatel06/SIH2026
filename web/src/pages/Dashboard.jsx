import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { api } from "../api.js";

// default Leaflet marker icons reference files that don't bundle correctly
// under Vite — point them at a CDN instead of shipping our own icon assets.
// Colour-code by today's backlog ratio (booked ÷ capacity) so the officer
// sees which centre is heading for a jam without opening it.
const MARKER_COLORS = { ok: "green", warn: "orange", full: "red", unknown: "grey" };
const icons = Object.fromEntries(
  Object.entries(MARKER_COLORS).map(([key, color]) => [
    key,
    new L.Icon({
      iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    }),
  ])
);
const iconFor = (ratio) => {
  if (ratio == null) return icons.unknown;
  if (ratio >= 1) return icons.full;
  if (ratio >= 0.7) return icons.warn;
  return icons.ok;
};

const today = () => new Date().toISOString().slice(0, 10);

export default function Dashboard({ officer }) {
  const [centres, setCentres] = useState([]);
  const [backlog, setBacklog] = useState({}); // centreId -> { capacity, booked, ratio }
  const [selected, setSelected] = useState(null);
  const [capacity, setCapacity] = useState(null);
  const [form, setForm] = useState({ gunny_bags: "", labour_gangs: "", trucks_confirmed: "" });
  const [newCentre, setNewCentre] = useState({ name: "", lat: "", lon: "", weighbridges: 1, officer_email: "" });
  const [error, setError] = useState("");

  // A centre-scoped officer only sees/manages their own centre — the backend
  // already enforces this (auth.require_centre_access), scoping here just
  // avoids showing controls (and drawing 403s) for centres they can't touch.
  // officer.centre_id === null means a district admin: sees everything.
  const load = () => {
    api.centres().then((cs) => {
      const visible = officer.centre_id ? cs.filter((c) => c.id === officer.centre_id) : cs;
      setCentres(visible);
      loadBacklog(visible);
    }).catch((e) => setError(String(e)));
  };

  // Backlog heatmap data (README §6 "live backlog heatmap") — booked ÷
  // published capacity per centre, so an officer sees who's about to jam
  // before the yard actually does.
  const loadBacklog = async (cs) => {
    const entries = await Promise.all(
      cs.map(async (c) => {
        const [cap, bookings] = await Promise.all([
          api.getCapacity(c.id, today()),
          api.centreBookings(c.id, today()).catch(() => []),
        ]);
        const capNum = cap?.computed_capacity || 0;
        const ratio = capNum > 0 ? bookings.length / capNum : 0;
        return [c.id, { capacity: capNum, booked: bookings.length, ratio }];
      })
    );
    setBacklog(Object.fromEntries(entries));
  };

  useEffect(load, []);

  const select = async (c) => {
    setSelected(c);
    const cap = await api.getCapacity(c.id, today());
    setCapacity(cap);
  };

  const submitCapacity = async (e) => {
    e.preventDefault();
    if (!selected) return;
    try {
      const cap = await api.setCapacity(selected.id, {
        day: today(),
        gunny_bags: Number(form.gunny_bags) || 0,
        labour_gangs: Number(form.labour_gangs) || 0,
        trucks_confirmed: Number(form.trucks_confirmed) || 0,
      });
      setCapacity(cap);
      setError("");
      loadBacklog(centres);
    } catch (e) {
      setError(String(e));
    }
  };

  const submitCentre = async (e) => {
    e.preventDefault();
    try {
      await api.createCentre({
        name: newCentre.name,
        lat: Number(newCentre.lat),
        lon: Number(newCentre.lon),
        weighbridges: Number(newCentre.weighbridges) || 1,
        officer_email: newCentre.officer_email,
      });
      setNewCentre({ name: "", lat: "", lon: "", weighbridges: 1, officer_email: "" });
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  const mapCenter = centres.length ? [centres[0].lat, centres[0].lon] : [23.2, 77.08];

  return (
    <>
      {error && <div className="card" style={{ color: "#c0392b" }}>{error}</div>}

      <div className="card">
        <h2>Procurement centres — {today()}</h2>
        <MapContainer center={mapCenter} zoom={9} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {centres.map((c) => {
            const bl = backlog[c.id];
            return (
              <Marker key={c.id} position={[c.lat, c.lon]} icon={iconFor(bl?.ratio)} eventHandlers={{ click: () => select(c) }}>
                <Popup>
                  <strong>{c.name}</strong>
                  <br />
                  {bl ? `${bl.booked} / ${bl.capacity} booked today` : "No capacity published yet"}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
        <p className="muted" style={{ marginTop: 6 }}>
          🟢 under 70% booked · 🟠 70–100% · 🔴 fully booked or over
        </p>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Centres</h2>
          <table>
            <tbody>
              {centres.map((c) => (
                <tr key={c.id} style={{ cursor: "pointer", fontWeight: selected?.id === c.id ? 700 : 400 }} onClick={() => select(c)}>
                  <td>{c.name}</td>
                  <td className="muted">{c.weighbridges} weighbridge(s)</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Only district admins (officer.centre_id === null) can create centres — enforced
              server-side too; hidden here rather than shown-then-403'd for a centre officer. */}
          {!officer.centre_id && (
            <>
              <h2 style={{ marginTop: 20 }}>Add a centre</h2>
              <form onSubmit={submitCentre}>
                <label>Name</label>
                <input value={newCentre.name} onChange={(e) => setNewCentre({ ...newCentre, name: e.target.value })} required />
                <label>Latitude</label>
                <input value={newCentre.lat} onChange={(e) => setNewCentre({ ...newCentre, lat: e.target.value })} required />
                <label>Longitude</label>
                <input value={newCentre.lon} onChange={(e) => setNewCentre({ ...newCentre, lon: e.target.value })} required />
                <label>Weighbridges</label>
                <input type="number" min="1" value={newCentre.weighbridges} onChange={(e) => setNewCentre({ ...newCentre, weighbridges: e.target.value })} />
                <label>Officer email (for SLA-breach alerts)</label>
                <input type="email" value={newCentre.officer_email} onChange={(e) => setNewCentre({ ...newCentre, officer_email: e.target.value })} />
                <button type="submit">Add centre</button>
              </form>
            </>
          )}
        </div>

        <div className="card">
          <h2>Today's capacity input {selected && `— ${selected.name}`}</h2>
          {!selected && <p className="muted">Select a centre to log today's inputs.</p>}
          {selected && (
            <>
              <form onSubmit={submitCapacity}>
                <label>Gunny bags in stock</label>
                <input type="number" value={form.gunny_bags} onChange={(e) => setForm({ ...form, gunny_bags: e.target.value })} required />
                <label>Labour gangs present</label>
                <input type="number" value={form.labour_gangs} onChange={(e) => setForm({ ...form, labour_gangs: e.target.value })} required />
                <label>Evacuation trucks confirmed</label>
                <input type="number" value={form.trucks_confirmed} onChange={(e) => setForm({ ...form, trucks_confirmed: e.target.value })} required />
                <button type="submit">Publish today's capacity</button>
              </form>

              {capacity && (
                <div style={{ marginTop: 16, padding: 12, background: "#e8f5e9", borderRadius: 6 }}>
                  <strong>{capacity.computed_capacity} trolleys today</strong>
                  <div className="limiting">Limiting factor: {capacity.limiting_factor}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
