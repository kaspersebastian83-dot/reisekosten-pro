import { useEffect, useRef, useState } from "react";

export function UpdateNotice({ canUpdate }: { canUpdate: (discard: boolean) => Promise<boolean> }) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [deferred, setDeferred] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const readiness = useRef(canUpdate); readiness.current = canUpdate;
  const discard = useRef(false);
  const reload = useRef(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const observe = () => {
      if (!disposed && registration?.waiting && navigator.serviceWorker.controller) {
        setWaiting(registration.waiting); setDeferred(false);
      }
      const installing = registration?.installing;
      installing?.addEventListener("statechange", () => { if (installing.state === "installed") observe(); }, { once: false });
    };
    const onMessage = async (event: MessageEvent) => {
      if (event.data?.type === "CAN_UPDATE") {
        const ready = await readiness.current(discard.current);
        event.source && (event.source as ServiceWorker).postMessage({ type: "UPDATE_READINESS", requestId: event.data.requestId, ready });
      }
      if (event.data?.type === "UPDATE_APPROVED") reload.current = true;
      if (event.data?.type === "UPDATE_BLOCKED") {
        discard.current = false; setBusy(false); setBlocked(true);
        setMessage("Bitte offene Eingaben oder Importe in allen App-Tabs abschließen. Gespeicherte Daten bleiben erhalten.");
      }
    };
    const onController = () => { if (reload.current) window.location.reload(); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    void navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { updateViaCache: "none" })
      .then((value) => {
        registration = value; observe(); registration.addEventListener("updatefound", observe);
        // Offline checks are optional and do not produce console noise.
        return registration.update();
      }).catch(() => undefined);
    const check = () => { if (document.visibilityState === "visible") void registration?.update().catch(() => undefined); };
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true; registration?.removeEventListener("updatefound", observe);
      document.removeEventListener("visibilitychange", check);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
    };
  }, []);
  const accept = async (discardDrafts = false) => {
    if (!waiting || busy) return;
    if (!(await readiness.current(discardDrafts))) { setBlocked(true); setMessage("Es gibt offene Eingaben, einen Import oder noch nicht gespeicherte Änderungen. Bitte zuerst abschließen."); return; }
    discard.current = discardDrafts;
    setBusy(true); setMessage("Update wird vorbereitet …");
    waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  };
  if (!waiting) return null;
  if (deferred) return <button className="link update-reminder" onClick={() => setDeferred(false)}>Neue Version verfügbar · Update anzeigen</button>;
  return <section className="notice update-notice" role="status" aria-label="App aktualisieren">
    <div><b>Neue Version verfügbar</b><p>{message || "Ihre gespeicherten Daten und Belege bleiben erhalten."}</p>
      {blocked && <p>„Verwerfen“ betrifft nur ungespeicherte Eingaben in diesem Tab. Bei Speicherfehlern zuerst eine JSON-Sicherung erstellen und erneut speichern.</p>}
    </div>
    <div className="update-actions">
      <button className="primary" disabled={busy} onClick={() => void accept()}>Jetzt aktualisieren</button>
      {blocked && <button disabled={busy} onClick={() => void accept(true)}>Offene Eingaben verwerfen und aktualisieren</button>}
      <button disabled={busy} onClick={() => { setDeferred(true); setBlocked(false); setMessage(""); }}>Später</button>
    </div>
  </section>;
}
