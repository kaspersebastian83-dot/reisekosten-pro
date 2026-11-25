import { Send, Smartphone, Upload, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { deviceId, lastHandoff, sentRecords, setSentRecords, touchDevice } from "../lib/device-settings";
import { localReceiptImage, rememberReceiptImage } from "../lib/receipt-images";
import { alsGesendetVermerken, anzahl, belegeDerAuswahl, berichtKurz, offeneEintraege, uebergabeDateiname, uebergabeLesen, uebergabeText, uebernehmen, UebergabeFehler, type Uebergabe, type UebergabeAuswahl, type Uebernahme } from "../lib/uebergabe";
import type { AppState } from "../lib/types";
import type { ExportShare } from "./export-share";
import type { FolderStorage } from "./folder-storage";

/*
 * Übergabe Handy → PC (Regeln und Dateiformat: lib/uebergabe.ts).
 *   Handy:  „An den PC senden“ schreibt die noch nicht gesendeten Reisen, Kosten und Belege in eine Datei und gibt sie an das
 *           Teilen-Menü (oder lädt sie herunter). Die Einträge bleiben auf dem Handy und gelten danach als gesendet.
 *   PC:     „Vom Handy übernehmen“ liest die Datei, zeigt vorab, was geschieht, und fügt hinzu – ersetzt wird nichts.
 */
/** Kalendertag in Ortszeit: Zeitstempel sind UTC – kurz nach Mitternacht läge der Tag sonst einen zurück. */
const tagDe = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10).split("-").reverse().join(".");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};
const eintraege = (n: number) => `${n} ${n === 1 ? "Eintrag" : "Einträge"}`;

/* ---------- Handy ---------- */

export interface Handoff {
  /** Dieses Gerät sendet (Handy, Tablet); am PC wird übernommen. */
  phone: boolean;
  /** Noch nicht gesendete oder seit dem Senden geänderte Einträge. */
  open: number;
  /** Reisen, Kosten und Belege insgesamt auf diesem Gerät. */
  total: number;
  /** Zeitpunkt der letzten Übergabe (ISO) oder null. */
  last: string | null;
  busy: boolean;
  send: (all?: boolean) => void;
}

export function useHandoff(state: AppState, share: ExportShare, notify: (message: string) => void, appVersion: string): Handoff {
  const [phone] = useState(() => touchDevice());
  const [sent, setSent] = useState(() => sentRecords());
  const [last, setLast] = useState(() => lastHandoff());
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state); stateRef.current = state;
  const sentRef = useRef(sent); sentRef.current = sent;
  const open = useMemo(() => phone ? anzahl(offeneEintraege(state, sent)) : 0, [phone, state, sent]);
  const total = state.trips.length + state.expenses.length + state.receiptInbox.length;

  const send = useCallback((all = false) => {
    if (busy) return;
    const current = stateRef.current;
    const auswahl: UebergabeAuswahl = all ? { trips: current.trips, expenses: current.expenses, receiptInbox: current.receiptInbox } : offeneEintraege(current, sentRef.current);
    if (!anzahl(auswahl)) { notify("Alles ist schon gesendet."); return; }
    setBusy(true);
    void (async () => {
      try {
        const belege: Record<string, string> = {};
        let fehlen = 0;
        for (const fileId of belegeDerAuswahl(auswahl)) { const url = await localReceiptImage(fileId); if (url) belege[fileId] = url; else fehlen++; }
        const now = new Date();
        const name = uebergabeDateiname(now);
        const file = new File([uebergabeText(current, auswahl, belege, { erstellt: now.toISOString(), geraet: deviceId(), app: appVersion })], name, { type: "text/plain" });
        share.send(file, () => {
          // Erst jetzt hat die Datei die App verlassen. Vermerkt wird die gesendete Fassung – wer inzwischen weiter ändert, sieht den Eintrag wieder als offen.
          const next = alsGesendetVermerken(stateRef.current, sentRef.current, auswahl);
          const at = new Date().toISOString();
          // Nur wenn der Vermerk gespeichert ist, gilt er auch hier – sonst bliebe „Alles gesendet“ bis zum Neuladen stehen,
          // obwohl beim nächsten Start wieder alles offen wäre.
          const stored = setSentRecords(next, at);
          if (stored) { setSent(next); setLast(at); }
          notify(`${eintraege(anzahl(auswahl))} an den PC gesendet. Am PC: Datensicherung → „Vom Handy übernehmen“.${fehlen ? ` ${fehlen} Belegbild(er) fehlen auf diesem Gerät.` : ""}${stored ? "" : " Der Vermerk „gesendet“ ließ sich nicht speichern – die Einträge bleiben als offen stehen und werden beim nächsten Mal erneut gesendet."}`);
        });
      } catch { notify("Die Übergabe konnte nicht erstellt werden. Bitte erneut versuchen."); }
      finally { setBusy(false); }
    })();
  }, [busy, share, notify, appVersion]);

  return { phone, open, total, last, busy, send };
}

/** Eine Zeile über der Kopfzeile (Handy, ohne verbundenen Ordner). */
export function HandoffLine({ handoff }: { handoff: Handoff }) {
  const { open, last } = handoff;
  return <div className={`folder-banner backup-reminder${open ? "" : " handoff-done"}`} role="status">
    <div><b>{open ? `${eintraege(open)} noch nicht gesendet` : "Alles an den PC gesendet"}</b>
      <p>{last ? `Zuletzt an den PC gesendet: ${tagDe(last)}` : "Bisher nur auf diesem Gerät."}</p></div>
    {open > 0 && <button className="primary" disabled={handoff.busy} onClick={() => handoff.send()}><Send size={16} />Senden</button>}
  </div>;
}

/** Karte unter „Datensicherung“ auf dem Handy. */
export function HandoffSendCard({ handoff }: { handoff: Handoff }) {
  const { open, total, last } = handoff;
  return <section className="card backup-card handoff-card" aria-label="An den PC senden">
    <div className="backup-icon"><Send /></div>
    <h2>An den PC senden</h2>
    <p>Schickt die Reisen, Kosten und Belegfotos dieses Geräts an Ihren PC – zum Beispiel über OneDrive oder per Mail an sich selbst. Am PC unter Datensicherung „Vom Handy übernehmen“ wählen. Die Einträge bleiben auf diesem Gerät.</p>
    <p className="handoff-status" role="status"><b>{!total ? "Noch nichts erfasst." : open ? `${eintraege(open)} noch nicht gesendet.` : "Alles gesendet."}</b>{last ? ` Zuletzt gesendet: ${tagDe(last)}.` : ""}</p>
    <button className="primary" disabled={handoff.busy || !open} onClick={() => handoff.send()}><Send size={18} />An den PC senden</button>
    {total > 0 && <button className="link" disabled={handoff.busy} onClick={() => handoff.send(true)}>Alles erneut senden</button>}
    <small className="muted">Abgeschlossen wird am PC – dort liegen alle Einträge. Auf dem Handy gelöschte Einträge werden am PC nicht gelöscht.</small>
  </section>;
}

/* ---------- PC ---------- */

interface Vorschau { name: string; eingang: Uebergabe; ergebnis: Uebernahme; ausgang: AppState }

/** Karte unter „Datensicherung“ am PC: Datei wählen → Vorschau → übernehmen. */
export function HandoffImportCard({ state, setState, notify, folder }: { state: AppState; setState: (state: AppState) => void; notify: (message: string) => void; folder: FolderStorage }) {
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const [working, setWorking] = useState(false);

  const lesen = async (file?: File) => {
    if (!file) return;
    try {
      const eingang = uebergabeLesen(await file.text());
      // Vorschau = dieselbe Rechnung wie die Übernahme, nur ohne zu speichern.
      setVorschau({ name: file.name, eingang, ausgang: state, ergebnis: uebernehmen(state, eingang, { id: crypto.randomUUID(), at: new Date().toISOString() }) });
    } catch (error) { notify(error instanceof UebergabeFehler ? error.message : "Die Datei konnte nicht gelesen werden."); }
  };
  // Dateiauswahl ohne dauerhaftes Eingabefeld: Unter „Datensicherung“ bleibt „Sicherung wiederherstellen“ das einzige Dateifeld.
  const waehlen = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".txt,.json,text/plain,application/json";
    input.onchange = () => { void lesen(input.files?.[0]); };
    input.click();
  };
  const bestaetigen = async () => {
    if (!vorschau || working) return;
    // Hat sich der Bestand seit der Vorschau geändert (anderer Tab, Ordnerabgleich), gilt die Vorschau nicht mehr.
    if (vorschau.ausgang !== state) { setVorschau(null); notify("Der Bestand hat sich inzwischen geändert. Bitte die Datei erneut wählen."); return; }
    setWorking(true);
    try {
      if (folder.status.kind === "ok") {
        try { await folder.backupNow("vor_uebernahme"); }
        catch (error) { notify(`Nicht übernommen: Der aktuelle Stand konnte nicht gesichert werden (${error instanceof Error ? error.message : "Fehler"}).`); return; }
      }
      // Bilder zuerst bereitlegen: Beim Speichern des Bestands werden sie abgelegt, kein Verweis zeigt ins Leere.
      for (const [fileId, dataUrl] of Object.entries(vorschau.ergebnis.bericht.belege)) rememberReceiptImage(fileId, dataUrl);
      setState(vorschau.ergebnis.state);
      notify(berichtKurz(vorschau.ergebnis.bericht));
      setVorschau(null);
    } finally { setWorking(false); }
  };

  const bericht = vorschau?.ergebnis.bericht;
  const liste = (titel: string, zeilen: string[], klasse = "") => zeilen.length > 0 && <div className={`handoff-list ${klasse}`}><b>{titel}</b><ul>{zeilen.map((zeile, index) => <li key={index}>{zeile}</li>)}</ul></div>;
  return <section className="card backup-card handoff-card" aria-label="Vom Handy übernehmen">
    <div className="backup-icon"><Smartphone /></div>
    <h2>Vom Handy übernehmen</h2>
    <p>Fügt Reisen, Kosten und Belegfotos hinzu, die auf dem Handy mit „An den PC senden“ verschickt wurden. Der Bestand hier wird <b>nicht ersetzt</b>; vor dem Übernehmen sehen Sie, was dazukommt.</p>
    <button className="ghost" onClick={waehlen}><Upload size={18} />Datei vom Handy wählen</button>
    {vorschau && bericht && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setVorschau(null); }}>
      <div className="modal handoff-preview" role="dialog" aria-modal="true" aria-labelledby="handoff-preview-title">
        <header><h2 id="handoff-preview-title">Vom Handy übernehmen</h2><button className="icon" aria-label="Schließen" disabled={working} onClick={() => setVorschau(null)}><X /></button></header>
        <div className="modal-body">
          <p className="muted">{vorschau.name}{vorschau.eingang.erstellt ? ` · erstellt am ${tagDe(vorschau.eingang.erstellt)}` : ""}</p>
          {vorschau.ergebnis.geaendert
            ? <dl className="handoff-counts">
                <div><dt>Reisen</dt><dd>{bericht.neu.trips}</dd></div>
                <div><dt>Kosten</dt><dd>{bericht.neu.expenses}</dd></div>
                <div><dt>Belege im Eingang</dt><dd>{bericht.neu.receiptInbox}</dd></div>
              </dl>
            : <div className="notice" role="status"><div><b>Nichts Neues.</b><p>{bericht.abweichungen.length ? "Die Einträge dieser Datei sind schon hier – einige weichen ab (siehe unten)." : "Alle Einträge dieser Datei sind schon hier."}</p></div></div>}
          {vorschau.ergebnis.geaendert && <p>Neue Reisen und Kosten kommen als „ungeprüft“ an und erscheinen unter „Prüfen“.</p>}
          {bericht.vorhanden > 0 && <p>{eintraege(bericht.vorhanden)} {bericht.vorhanden === 1 ? "ist" : "sind"} schon vorhanden und {bericht.vorhanden === 1 ? "wird" : "werden"} übersprungen.</p>}
          {bericht.eingangErledigt > 0 && <p>{bericht.eingangErledigt === 1 ? "1 Beleg im Eingang wird" : `${bericht.eingangErledigt} Belege im Eingang werden`} als erledigt vermerkt – das Handy hat {bericht.eingangErledigt === 1 ? "ihn" : "sie"} inzwischen als Kosten erfasst.</p>}
          {liste("Abgeschlossene Monate bekommen neue Einträge", bericht.geschlosseneMonate.map((month) => `${month.split("-").reverse().join("/")}: Die abgeschlossene Abrechnung bleibt unverändert. Für eine Korrektur dort eine neue Version erstellen.`), "warn")}
          {liste("Abweichungen – der Stand hier bleibt", bericht.abweichungen, "warn")}
          {liste("Mögliche doppelte Einträge", bericht.doppelt, "warn")}
          {liste("Neue Fahrzeuge", bericht.fahrzeugeNeu.map((vehicle) => `${vehicle.name}${vehicle.plate ? ` (${vehicle.plate})` : ""} · ${vehicle.ownership === "privatwagen" ? "Privatwagen" : "Dienstwagen"} · Erstattung: ${vehicle.reimbursementMethod}`))}
          {liste("Hinweise", bericht.hinweise, "warn")}
          <p className="muted">Auf dem Handy gelöschte Einträge werden hier nicht gelöscht.{folder.status.kind === "ok" ? " Der aktuelle Stand wird vorher im SpesenKit-Ordner unter „Sicherungen“ abgelegt." : ""}</p>
          <div className="modal-actions">
            <button type="button" className="ghost" disabled={working} onClick={() => setVorschau(null)}>{vorschau.ergebnis.geaendert ? "Abbrechen" : "Schließen"}</button>
            {vorschau.ergebnis.geaendert && <button type="button" className="primary" disabled={working} onClick={() => void bestaetigen()}>{working ? "Wird übernommen …" : "Übernehmen"}</button>}
          </div>
        </div>
      </div>
    </div>}
  </section>;
}
