import { useEffect, useState } from "react";
import { api, setToken } from "../api.js";

// Officer login (email + password) and self-serve registration, gated by a
// shared OFFICER_SIGNUP_CODE the district admin hands out — see
// backend/app/main.py's register_officer for why. The seeded demo officer
// (see GETTING_STARTED.md) can just log in without ever using this code.
export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", centre_id: "", signup_code: "" });
  const [centres, setCentres] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode === "register") api.centres().then(setCentres).catch(() => {});
  }, [mode]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { access_token } = mode === "login"
        ? await api.loginOfficer({ email: form.email, password: form.password })
        : await api.registerOfficer(form);
      setToken(access_token);
      onAuthed(await api.me());
    } catch (e) {
      setError(e.status === 401 ? "Wrong email or password." : e.status === 403 ? "Invalid signup code." : String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 420, margin: "40px auto" }}>
      <header style={{ marginBottom: 20 }}>
        <h1>🌾 VAARI — Officer Dashboard</h1>
      </header>
      <div className="card">
        <h2>{mode === "login" ? "Log in" : "Register"}</h2>
        <form onSubmit={submit}>
          <label>Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <label>Password</label>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          {mode === "register" && (
            <>
              <label>Centre</label>
              <select value={form.centre_id} onChange={(e) => setForm({ ...form, centre_id: e.target.value })} required>
                <option value="">Select a centre</option>
                {centres.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <label>Signup code (from your district admin)</label>
              <input value={form.signup_code} onChange={(e) => setForm({ ...form, signup_code: e.target.value })} required />
            </>
          )}
          <button type="submit" disabled={loading}>{loading ? "…" : mode === "login" ? "Log in" : "Register"}</button>
        </form>
        {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}
        <p className="muted" style={{ marginTop: 10 }}>
          {mode === "login" ? "New officer? " : "Already registered? "}
          <a onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Register" : "Log in"}
          </a>
        </p>
      </div>
    </main>
  );
}
