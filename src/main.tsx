import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";

class StartupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <main className="loading" role="alert">
        <h1>SpesenKit konnte nicht gestartet werden</h1>
        <p>Beim Anzeigen ist ein Fehler aufgetreten. Ihre lokalen Daten wurden nicht gelöscht.</p>
        <p>Bitte neu laden. Bleibt der Fehler bestehen, prüfen Sie die Browser-Konsole.</p>
        <button onClick={() => location.reload()}>Erneut laden</button>
      </main>
    );
    return this.props.children;
  }
}

async function start() {
  const root = document.getElementById("root");
  if (!root) throw new Error("App-Container fehlt.");
  // Importfehler bleiben im sichtbaren HTML-Startbildschirm erklärbar.
  const { default: Home } = await import("../app/page");
  createRoot(root).render(<StrictMode><StartupBoundary><Home /></StartupBoundary></StrictMode>);
}
void start().catch((error) => {
  console.error("SpesenKit-Start fehlgeschlagen", error);
  const status = document.getElementById("startup-status");
  if (status) status.textContent = "Programmdateien konnten nicht geladen werden. Prüfen Sie die Verbindung und laden Sie die Seite erneut. Ihre lokalen Daten bleiben erhalten.";
});
