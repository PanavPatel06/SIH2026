import { useEffect, useState } from "react";
import Auth from "./pages/Auth.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Bookings from "./pages/Bookings.jsx";
import { api, getToken, clearToken } from "./api.js";

export default function App() {
  const [officer, setOfficer] = useState(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    api.me().then(setOfficer).catch(() => clearToken()).finally(() => setChecking(false));
  }, []);

  const logout = () => {
    clearToken();
    setOfficer(null);
  };

  if (checking) return null;
  if (!officer) return <Auth onAuthed={setOfficer} />;

  return (
    <>
      <header>
        <h1>🌾 VAARI — Officer Dashboard</h1>
        <nav>
          <a className={page === "dashboard" ? "active" : ""} onClick={() => setPage("dashboard")}>
            Centres & Capacity
          </a>
          <a className={page === "bookings" ? "active" : ""} onClick={() => setPage("bookings")}>
            Bookings & Payments
          </a>
          <a onClick={logout}>Log out ({officer.email})</a>
        </nav>
      </header>
      <main>{page === "dashboard" ? <Dashboard officer={officer} /> : <Bookings officer={officer} />}</main>
    </>
  );
}
