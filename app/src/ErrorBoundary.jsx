import { Component } from "react";

// Without this, one uncaught render error (a bad API response shape, a null
// somewhere) whitescreens the whole app with no way back — bad anywhere,
// worse for a farmer standing at a gate with one bar of signal. Reload is
// the only recovery offered on purpose: this app has no client-side router
// state worth preserving past a crash.
export default class ErrorBoundary extends Component {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    console.error("VAARI crashed:", error, info);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <main style={{ paddingTop: 24, textAlign: "center" }}>
        <h1>🌾 VAARI</h1>
        <div className="card">
          <p>Something went wrong. Your bookings are safe — try reloading.</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
}
