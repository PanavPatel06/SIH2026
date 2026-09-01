import { Component } from "react";

// Same reasoning as app/src/ErrorBoundary.jsx — an officer mid-queue-day
// shouldn't lose the whole dashboard to one bad render.
export default class ErrorBoundary extends Component {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    console.error("VAARI dashboard crashed:", error, info);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <main style={{ maxWidth: 420, margin: "40px auto", textAlign: "center" }}>
        <h1>🌾 VAARI</h1>
        <div className="card">
          <p>Something went wrong. Try reloading — today's data is safe on the server.</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
}
