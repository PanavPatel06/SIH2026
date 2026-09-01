import { useEffect, useState } from "react";
import Auth from "./pages/Auth.jsx";
import Home from "./pages/Home.jsx";
import MyBookings from "./pages/MyBookings.jsx";
import { api, getToken, clearToken } from "./api.js";

export default function App() {
  const [farmer, setFarmer] = useState(null);
  const [checking, setChecking] = useState(true); // validating an existing token before rendering anything
  const [tab, setTab] = useState("home");
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    // Validate the stored token rather than trusting its presence — an
    // expired/invalid one must bounce back to login, not a broken Home page.
    api.me().then(setFarmer).catch(() => clearToken()).finally(() => setChecking(false));
  }, []);

  const logout = () => {
    clearToken();
    setFarmer(null);
  };

  if (checking) return null; // one render tick — avoids a login-screen flash on a valid session

  if (!farmer) {
    return <Auth onAuthed={setFarmer} />;
  }

  return (
    <>
      <header>
        <h1>🌾 VAARI</h1>
        <div className="tag">Your turn. On time.</div>
      </header>
      {!online && <div className="offline-banner">📡 Offline — showing last-known data</div>}
      <main>
        {tab === "home" && <Home farmer={farmer} />}
        {tab === "bookings" && <MyBookings farmer={farmer} />}
      </main>
      <nav className="tabs">
        <a className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>🏠 Home</a>
        <a className={tab === "bookings" ? "active" : ""} onClick={() => setTab("bookings")}>🎫 My Slot</a>
        <a onClick={logout}>🚪 Log out</a>
      </nav>
    </>
  );
}
