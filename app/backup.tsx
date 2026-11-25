// Aus app/page.tsx herausgelöst (1.18.3, unverändert verschoben); Übersicht im README unter „Aufbau der Oberfläche“.
import { useRef, useState } from "react";
import { Download, RotateCcw, Trash2, Upload } from "lucide-react";
import type { AppState } from "../lib/types";
import { emptyState } from "../lib/config";
import { normalizeState } from "../lib/storage";
import { MissingReceiptImageError } from "../lib/receipt-images";
import { droppedClosings } from "../lib/folder-backups";
import { FolderCard, type FolderStorage } from "./folder-storage";
import { demoErlaubt } from "../lib/demo-switch";
import { HandoffImportCard, HandoffSendCard, type Handoff } from "./uebergabe";
import { ExportDeliveryChoice, type ExportShare } from "./export-share";
import { exportBackup } from "../lib/exports";

import { usePendingWork } from "../lib/pending-work";

export function Backup({
  state,
  setState,
  notify,
  folder,
  share,
  handoff,
}: {
  state: AppState;
  setState: (s: AppState) => void;
  notify: (s: string) => void;
  folder: FolderStorage;
  share: ExportShare;
  handoff: Handoff;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  usePendingWork(restoring);
  const restore = async (file?: File) => {
    if (!file) return;
    setRestoring(true);
    try {
      let restored: AppState;
      try {
        const parsed = JSON.parse(await file.text()) as AppState;
        if (!parsed.settings || !Array.isArray(parsed.trips)) throw new Error();
        restored = normalizeState(parsed);
      } catch { notify("Ungültige Datensicherung"); return; }
      // Ausdrücklich bestätigen; abgeschlossene Abrechnungen, die dabei wegfielen, werden genannt.
      const dropped = droppedClosings(state, restored);
      const linked = folder.status.kind === "ok";
      if (!confirm(`Aktuellen Datenbestand durch „${file.name}“ ersetzen?\n\nInhalt: ${restored.trips.length} Reisen, ${restored.expenses.length} Kosten, ${restored.statements.length} Abrechnungsversionen.${linked ? "\nDer aktuelle Stand wird vorher im SpesenKit-Ordner gesichert." : "\nOhne SpesenKit-Ordner gibt es keine automatische Sicherung des aktuellen Stands – vorher „Sicherung herunterladen“ verwenden."}${dropped.length ? `\n\nACHTUNG: Diese abgeschlossenen Abrechnungen sind in der Datei nicht enthalten: ${dropped.join(", ")}.` : ""}`)) return;
      if (linked) {
        try { await folder.backupNow("vor_wiederherstellung"); }
        catch (error) { notify(`Nicht wiederhergestellt: Der aktuelle Stand konnte nicht gesichert werden (${error instanceof Error ? error.message : "Fehler"}).`); return; }
      }
      setState(restored);
      notify("Datensicherung wiederhergestellt");
    } finally { setRestoring(false); }
  };
  const reset = async () => {
    const linked = folder.status.kind === "ok";
    if (!confirm(linked ? "Wirklich alle Daten löschen? Auch die Datei im SpesenKit-Ordner wird geleert; der vorherige Stand bleibt als spesenkit.vorher.json im Ordner „Daten“." : "Wirklich alle lokalen Daten löschen?")) return;
    // Use the guarded autosave transaction, including its cross-tab check.
    setState(structuredClone(emptyState));
    notify("Lokale Daten gelöscht");
  };
  return (
    <div className="backup-grid">
      <FolderCard folder={folder} />
      <section className="card backup-card">
        <div className="backup-icon">
          <Download />
        </div>
        <h2>Vollständige Datensicherung</h2>
        <p>
          Exportiert Fahrten, Kosten, Belege, Regeln, Importprofile und
          abgeschlossene Abrechnungen als JSON.
        </p>
        <ExportDeliveryChoice share={share} />
        <button className="primary" onClick={() => void exportBackup(state).catch((error) => notify(error instanceof MissingReceiptImageError ? error.message : "JSON-Sicherung konnte nicht erstellt werden."))}>
          <Download size={18} />
          {share.offered && share.sharing ? "Sicherung teilen" : "Sicherung herunterladen"}
        </button>
      </section>
      {/* Übergabe Handy → PC: Das Handy sendet, der PC übernimmt (ersetzt nichts – anders als „Sicherung wiederherstellen“). */}
      {handoff.phone ? <HandoffSendCard handoff={handoff} /> : <HandoffImportCard state={state} setState={setState} notify={notify} folder={folder} />}
      <section className="card backup-card">
        <div className="backup-icon">
          <RotateCcw />
        </div>
        <h2>Sicherung wiederherstellen</h2>
        <p>
          Vor dem Einspielen wird die vorhandene Datenbank ersetzt. Erstellen
          Sie vorher eine aktuelle Sicherung.
        </p>
        <input
          ref={input}
          hidden
          type="file"
          accept=".json"
          onChange={(e) => restore(e.target.files?.[0])}
        />
        <button className="ghost" onClick={() => input.current?.click()}>
          <Upload size={18} />
          JSON auswählen
        </button>
      </section>
      {demoErlaubt() && (
        <section className="card full demo-box">
          <div>
            <p className="eyebrow">Demo-Modus (nur Test)</p>
            <h3>Alle Sonderfälle in Ruhe ausprobieren</h3>
            <p>
              Erzeugt erfundene Fahrten mit Grenzfällen, Mehrtagesreise,
              Mahlzeitenkürzung, Duplikat, Firmen- und Privatfahrzeug sowie
              fehlendem Beleg. Ersetzt alle vorhandenen Daten.
            </p>
          </div>
          <button
            className="ghost"
            onClick={() => {
              import("../lib/demo")
                .then(({ demoState }) => {
                  setState(demoState());
                  notify("Demo-Daten geladen");
                })
                .catch(() => notify("Demo-Daten konnten nicht geladen werden."));
            }}
          >
            Demo-Daten laden
          </button>
        </section>
      )}
      <section className="card full">
        <div className="card-head">
          <div>
            <p className="eyebrow">Revisionsprotokoll</p>
            <h3>Letzte Änderungen</h3>
          </div>
          <span className="status-pill">{state.changes.length} Einträge</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Bereich</th>
                <th>Änderung</th>
                <th>Grund</th>
                <th>Profil</th>
              </tr>
            </thead>
            <tbody>
              {state.changes
                .slice()
                .reverse()
                .slice(0, 10)
                .map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.changedAt).toLocaleString("de-DE")}</td>
                    <td>{c.entityType}</td>
                    <td>{c.field}</td>
                    <td>{c.reason}</td>
                    <td>{c.user}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {state.changes.length === 0 && (
            <p className="muted" style={{ padding: "12px" }}>
              Noch keine manuellen Änderungen protokolliert.
            </p>
          )}
        </div>
      </section>
      <section className="danger-zone">
        <div>
          <h3>Alle lokalen Daten löschen</h3>
          <p>
            Dieser Vorgang kann nur mit einer zuvor exportierten Sicherung
            rückgängig gemacht werden.
          </p>
        </div>
        <button className="danger-button" onClick={reset}>
          <Trash2 size={17} />
          Daten löschen
        </button>
      </section>
    </div>
  );
}

/** Nach „Speichern & nächste“: Fokus auf das erste Eingabefeld des (neu gerenderten) Formulars. */
