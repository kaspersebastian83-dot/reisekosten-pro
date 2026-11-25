import { Download, Share2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { setShareExports, shareExports, touchDevice } from "../lib/device-settings";
import { download, setExportDelivery } from "../lib/exports";
import { shareFile, shareSupported, shareableFile } from "../lib/share-file";

/*
 * Exporte teilen statt herunterladen (Handy, Tablet): PDF, Tabellen, ZIP und JSON-Sicherung gehen über das Teilen-Menü
 * des Geräts direkt an Mail, OneDrive usw. Am PC (Maus) ändert sich nichts. Teilt das Gerät eine Dateiart nicht, wird sie
 * wie bisher heruntergeladen. Entsteht die Datei zu lange nach dem Fingertipp (große PDF/ZIP), verlangt der Browser einen
 * zweiten Tipp – dann erscheint „Datei ist fertig“ mit dem Knopf „Teilen“.
 */
export interface ExportShare {
  /** Gerät mit Fingerbedienung und Teilen-Menü: Wahl „Teilen / Herunterladen“ anbieten. */
  offered: boolean;
  sharing: boolean;
  setSharing: (value: boolean) => void;
  /** Eine einzelne Datei übergeben (Teilen-Menü oder Download, je nach Gerät und Wahl). onDelivered läuft erst, wenn die
   *  Datei die App wirklich verlassen hat – geteilt oder heruntergeladen –, nicht bei abgebrochenem Teilen. */
  send: (file: File, onDelivered?: () => void) => void;
  /** Fertige Datei, die auf den zweiten Tipp wartet. */
  ready: File | null;
  shareReady: () => void;
  downloadReady: () => void;
  dismissReady: () => void;
}

export function useExportShare(notify: (message: string) => void): ExportShare {
  const [offered] = useState(() => touchDevice() && shareSupported());
  const [sharing, setSharingState] = useState(() => shareExports());
  const [ready, setReadyState] = useState<File | null>(null);
  // Was nach erfolgreicher Übergabe der wartenden Datei geschehen soll (z. B. Einträge als gesendet vermerken).
  const readyDone = useRef<(() => void) | undefined>(undefined);
  const setReady = (file: File | null, onDelivered?: () => void) => { readyDone.current = file ? onDelivered : undefined; setReadyState(file); };
  const notifyRef = useRef(notify); notifyRef.current = notify;

  const hand = useCallback(async (file: File, secondTap: boolean, onDelivered?: () => void) => {
    const done = secondTap ? readyDone.current : onDelivered;
    const outcome = await shareFile(file);
    if (outcome === "shared") { setReady(null); done?.(); return; }
    if (outcome === "cancelled") { if (!secondTap) notifyRef.current("Nicht geteilt – das Teilen-Menü wurde geschlossen."); return; }
    if (outcome === "needs-tap" && !secondTap) { setReady(file, onDelivered); return; }
    setReady(null);
    download(file, file.name);
    notifyRef.current(`„${file.name}“ lässt sich auf diesem Gerät nicht teilen – stattdessen heruntergeladen.`);
    done?.();
  }, []);

  useEffect(() => {
    if (!offered || !sharing) { setExportDelivery(); return; }
    setExportDelivery((blob, name) => { void hand(shareableFile(blob, name), false); });
    return () => setExportDelivery();
  }, [offered, sharing, hand]);

  return {
    offered, sharing, ready,
    setSharing: (value) => { setShareExports(value); setSharingState(value); },
    shareReady: () => { if (ready) void hand(ready, true); },
    send: (file, onDelivered) => { if (offered && sharing) void hand(file, false, onDelivered); else { download(file, file.name); onDelivered?.(); } },
    downloadReady: () => { const done = readyDone.current; if (ready) { download(ready, ready.name); done?.(); } setReady(null); },
    dismissReady: () => setReady(null),
  };
}

/** Wahl je Gerät; erscheint nur auf Handy/Tablet mit Teilen-Menü. */
export function ExportDeliveryChoice({ share }: { share: ExportShare }) {
  if (!share.offered) return null;
  return (
    <div className="export-delivery" role="group" aria-label="Exporte auf diesem Gerät">
      <div className="segmented">
        <button type="button" className={share.sharing ? "active" : ""} aria-pressed={share.sharing} onClick={() => share.setSharing(true)}><Share2 size={16} /> Teilen</button>
        <button type="button" className={share.sharing ? "" : "active"} aria-pressed={!share.sharing} onClick={() => share.setSharing(false)}><Download size={16} /> Herunterladen</button>
      </div>
      <small>{share.sharing ? "Die Datei geht an das Teilen-Menü dieses Geräts – zum Beispiel Mail oder OneDrive." : "Die Datei wird auf diesem Gerät unter „Downloads“ gespeichert."}</small>
    </div>
  );
}

const fileSize = (bytes: number) => bytes >= 1_048_576 ? `${(bytes / 1_048_576).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("de-DE")} KB`;

/** Zweiter Tipp für große Dateien: Die Datei ist erstellt und wartet nur noch auf „Teilen“. */
export function ExportReadySheet({ share }: { share: ExportShare }) {
  const file = share.ready;
  if (!file) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) share.dismissReady(); }}>
      <div className="modal export-ready" role="dialog" aria-modal="true" aria-labelledby="export-ready-title">
        <header>
          <h2 id="export-ready-title">Datei ist fertig</h2>
          <button className="icon" aria-label="Schließen" onClick={share.dismissReady}><X /></button>
        </header>
        <div className="modal-body">
          <p className="export-ready-file"><b>{file.name}</b><small>{fileSize(file.size)}</small></p>
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={share.downloadReady}><Download size={18} /> Herunterladen</button>
            <button type="button" className="primary" autoFocus onClick={share.shareReady}><Share2 size={18} /> Teilen</button>
          </div>
        </div>
      </div>
    </div>
  );
}
