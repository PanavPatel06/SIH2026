import { useState } from "react";
import { api, setToken } from "../api.js";

// Phone + PIN, not phone + OTP — README §15 already established SMS delivery
// can't be trusted here (no DLT access), so it can't gate login either. A
// PIN a farmer sets once is something they can reliably re-enter themselves.
export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState("login"); // login | register
  const [form, setForm] = useState({ name: "", phone: "", village: "", pin: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { access_token } = mode === "login"
        ? await api.loginFarmer({ phone: form.phone, pin: form.pin })
        : await api.registerFarmer(form);
      setToken(access_token);
      const farmer = await api.me();
      onAuthed(farmer);
    } catch (e) {
      setError(e.status === 401 ? "Wrong phone number or PIN." : String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ paddingTop: 24 }}>
      <header style={{ marginBottom: 20 }}>
        <h1>🌾 VAARI</h1>
        <div className="tag">Know when to leave. Not when to wait.</div>
      </header>
      <div className="card">
        <h2>{mode === "login" ? "Log in" : "Register"}</h2>
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <label>Full name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </>
          )}
          <label>Phone number</label>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          {mode === "register" && (
            <>
              <label>Village</label>
              <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} />
            </>
          )}
          <label>{mode === "login" ? "PIN" : "Set a PIN (4+ digits)"}</label>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            minLength={4}
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value })}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "…" : mode === "login" ? "Log in" : "Register"}
          </button>
        </form>
        {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}
        <p className="muted" style={{ marginTop: 10 }}>
          {mode === "login" ? "New here? " : "Already registered? "}
          <a onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Register" : "Log in"}
          </a>
        </p>
      </div>
    </main>
  );
}
