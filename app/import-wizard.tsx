// Aus app/page.tsx herausgelöst (1.18.3, unverändert verschoben); Übersicht im README unter „Aufbau der Oberfläche“.
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, FileSpreadsheet, Upload } from "lucide-react";
import type { AppState, Trip } from "../lib/types";
import { commitTripImport } from "../lib/storage";
import {
  canonicalFields,
  parseImportFile,
  rowsToTrips,
  suggestMapping,
} from "../lib/importer";

import { usePendingWork } from "../lib/pending-work";
import { type Tab, dateDe, uid } from "./shared";

export function ImportWizard({
  state,
  confirmImport,
  notify,
  go,
}: {
  state: AppState;
  confirmImport: (trips: Trip[], profile: import("../lib/types").ImportProfile, vimcar: boolean) => ReturnType<typeof commitTripImport>;
  notify: (s: string) => void;
  go: (t: Tab) => void;
}) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File>();
  const [sheets, setSheets] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const [sheet, setSheet] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState("Mein Fahrtenbuch");
  const [format, setFormat] = useState<"vimcar" | "generic">("generic");
  const [result, setResult] = useState<{
    trips: Trip[];
    duplicates: number;
    invalid: number;
    ignoredCommute: number;
    ignoredPrivate: number;
    format: "vimcar" | "generic";
  }>();
  const [error, setError] = useState("");
  const [rowNumbers, setRowNumbers] = useState<Record<string, number[]>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, number[]>>({});
  const [parseWarning, setParseWarning] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(new Set<number>());
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const choosing = useRef(0);
  const submitting = useRef(false);
  usePendingWork(step > 1 && step < 5 || saving || reading);
  const rows = sheets[sheet] || [];
  const converted = useMemo(() => rowsToTrips(rows, mapping, state.trips, state.settings.vehicles,
    state.settings.defaultVehicleId, state.settings.homeAddress, state.settings.firstWorkplace, rowErrors[sheet] || []),
    [rows, mapping, state.trips, state.settings, rowErrors, sheet]);
  const eligible = converted.review.filter((row) => row.status === "ready");
  const selectedTrips = eligible.filter((row) => selected.has(row.index)).map((row) => row.trip!);
  const prepareReview = () => { setSelected(new Set(eligible.map((row) => row.index))); setFilter("all"); setError(""); setStep(4); };
  const cancel = () => { if (submitting.current) return; choosing.current++; setReading(false); setStep(1); setFile(undefined); setSheets({}); setSelected(new Set()); setError(""); };
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const choose = async (f?: File) => {
    if (!f) return;
    const attempt = ++choosing.current;
    setReading(true); setError("");
    setFile(f);
    try {
      const parsed = await parseImportFile(f);
      if (attempt !== choosing.current) return;
      setRowNumbers(parsed.rowNumbers); setRowErrors(parsed.rowErrors); setParseWarning(parsed.warning || "");
      setFormat(parsed.format);
      if (parsed.format === "vimcar") setProfileName("Vimcar CSV");
      setSheets(parsed.sheets);
      const first = Object.keys(parsed.sheets)[0];
      setSheet(first);
      setMapping(suggestMapping(Object.keys(parsed.sheets[first]?.[0] || {})));
      setStep(2);
    } catch (e) {
      if (attempt !== choosing.current) return;
      setError(
        e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.",
      );
    } finally { if (attempt === choosing.current) setReading(false); }
  };
  const applyProfile = (id: string) => {
    const p = state.profiles.find((x) => x.id === id);
    if (p) {
      setMapping(p.mapping);
      setProfileName(p.name);
    }
  };
  const doImport = async () => {
    if (submitting.current || !selectedTrips.length) return;
    submitting.current = true; setSaving(true); setError("");
    try {
      const committed = await confirmImport(selectedTrips, { id: uid(), name: profileName, mapping,
        createdAt: new Date().toISOString() }, format === "vimcar");
      setResult({ ...converted, trips: committed.trips, duplicates: converted.duplicates + committed.duplicates });
      setStep(5); notify(`${committed.trips.length} Fahrten importiert`);
    } catch (error) {
      setError(`Import nicht gespeichert. Es wurden keine Teilmengen übernommen. ${error instanceof Error ? error.message : "Bitte erneut versuchen."}`);
    } finally { submitting.current = false; setSaving(false); }
  };
  return (
    <div className="flow-layout">
      <section className="card flow-card">
        <div className="steps">
          {["Datei", "Tabelle", "Zuordnung", "Vorschau", "Fertig"].map(
            (x, i) => (
              <div className={step >= i + 1 ? "done" : ""} key={x}>
                <span>{step > i + 1 ? <Check size={15} /> : i + 1}</span>
                <b>{x}</b>
              </div>
            ),
          )}
        </div>
        {step === 1 && (
          <div className="drop-zone">
            <Upload size={36} />
            <h2>Fahrtenbuch auswählen</h2>
            <p>
              Vimcar-CSV, XLSX oder CSV. Für Vimcar-Spesen benötigen wir
              den CSV-Export mit Abfahrts- und Ankunftszeiten.
            </p>
            <label className="primary file-button">
              Datei auswählen
              <input
                type="file"
                accept=".xlsx,.csv,.pdf"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
            {reading && <p role="status">Datei wird lokal gelesen …</p>}
            {error && (
              <div className="error-box">
                <AlertTriangle />
                {error}
              </div>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="wizard-body">
            <p className="eyebrow">Datei erkannt</p>
            <h2>{file?.name}</h2>
            <div className="field-row">
              <label>
                Tabellenblatt
                <select
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setMapping(
                      suggestMapping(
                        Object.keys(sheets[e.target.value]?.[0] || {}),
                      ),
                    );
                  }}
                >
                  {Object.keys(sheets).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Gespeichertes Importprofil
                <select
                  defaultValue=""
                  onChange={(e) => applyProfile(e.target.value)}
                >
                  <option value="">Automatisch zuordnen</option>
                  {state.profiles.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="info-box">
              <FileSpreadsheet />
              <div>
                <b>
                  {rows.length} Datenzeilen · {headers.length} Spalten
                </b>
                {format === "vimcar" && (
                  <p>
                    <b>Vimcar-Export automatisch erkannt.</b> Betrieb,
                    Arbeitsweg und Privat werden getrennt ausgewertet.
                  </p>
                )}
                <p>
                  Kopfzeile erkannt: {headers.slice(0, 6).join(", ")}
                  {headers.length > 6 ? " …" : ""}
                </p>
              </div>
            </div>
            <WizardNav back={() => setStep(1)} next={() => setStep(3)} />
          </div>
        )}
        {step === 3 && (
          <div className="wizard-body">
            <p className="eyebrow">Spaltenzuordnung kontrollieren</p>
            <h2>
              {Object.keys(mapping).length} von {canonicalFields.length} Feldern
              erkannt
            </h2>
            <div className="mapping-grid">
              {canonicalFields.map(([field, label]) => (
                <label key={field}>
                  <span>
                    {label}
                    {[
                      "date",
                      "startTime",
                      "endTime",
                      "destination",
                      "purpose",
                    ].includes(field) && <em> wichtig</em>}
                  </span>
                  <select
                    value={mapping[field] || ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [field]: e.target.value })
                    }
                  >
                    <option value="">Nicht importieren</option>
                    {headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label>
              Profilname
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </label>
            <WizardNav
              back={() => setStep(2)}
              next={prepareReview}
              disabled={!mapping.date}
            />
          </div>
        )}
        {step === 4 && (
          <div className="wizard-body">
            <p className="eyebrow">Import prüfen · {file?.name}</p>
            <h2>{rows.length} Datenzeilen · {selectedTrips.length} ausgewählt</h2>
            <div className="result-grid review-counts">
              <div><b>{eligible.length}</b><span>Bereit</span></div>
              <div><b>{converted.duplicates}</b><span>Duplikate</span></div>
              <div><b>{converted.ignoredPrivate + converted.ignoredCommute}</b><span>Privat / Arbeitsweg ausgeschlossen</span></div>
              <div><b>{converted.invalid}</b><span>Ungültig</span></div>
              <div><b>{eligible.filter((row) => row.trip!.warnings.length).length}</b><span>Mit Prüfhinweisen</span></div>
            </div>
            {parseWarning && <p className="warning-line">{parseWarning} · fehlerhafte Zeilen bitte in der Quelle korrigieren.</p>}
            <div className="review-controls">
              <label>Status filtern<select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">Alle Zeilen</option><option value="ready">Bereit</option><option value="duplicate">Duplikate</option>
                <option value="excluded">Ausgeschlossen</option><option value="invalid">Ungültig</option><option value="warning">Prüfhinweise</option>
              </select></label>
              <button disabled={saving} onClick={() => setSelected(new Set(eligible.map((row) => row.index)))}>Alle bereiten auswählen</button>
              <button disabled={saving} onClick={() => setSelected(new Set())}>Auswahl aufheben</button>
            </div>
            <div className="table-wrap import-review"><table><thead><tr><th>Übernehmen</th><th>Quellzeile</th><th>Datum / Zeit</th><th>Fahrt / km</th><th>Status / Erklärung</th></tr></thead><tbody>
              {converted.review.filter((row) => filter === "all" || row.status === filter || filter === "warning" && row.trip?.warnings.length).map((row) => <tr key={row.index}>
                <td><input type="checkbox" aria-label={`Zeile ${rowNumbers[sheet]?.[row.index] || row.index + 2} übernehmen`}
                  disabled={saving || row.status !== "ready"} checked={row.status === "ready" && selected.has(row.index)}
                  onChange={(e) => setSelected((old) => { const next = new Set(old); if (e.target.checked) next.add(row.index); else next.delete(row.index); return next; })} /></td>
                <td>{rowNumbers[sheet]?.[row.index] || row.index + 2}</td>
                <td>{dateDe(row.date || "")}<small>{`${row.startTime || "Zeit offen"} – ${row.endTime || "Zeit offen"}${row.trip?.endDate ? " · " + dateDe(row.trip.endDate) : ""}`}</small></td>
                <td>{row.classification || "Nicht erkannt"}<small>{row.trip ? `${row.trip.startPlace || "Start offen"} → ${row.trip.destination || "Ziel offen"} · ${row.trip.businessKm.toLocaleString("de-DE")} km` : `${(row.distance || 0).toLocaleString("de-DE")} km`}</small></td>
                <td><b>{{ready:"Bereit",duplicate:"Duplikat",excluded:"Ausgeschlossen",invalid:"Ungültig"}[row.status]}</b><small>{row.reason}</small></td>
              </tr>)}
            </tbody></table></div>
            {error && <div className="error-box" role="alert">{error}</div>}
            <div className="info-box yellow">
              <AlertTriangle />
              <div>
                <b>
                  {format === "vimcar"
                    ? "Spesenlogik für Vimcar"
                    : "Zeitbedeutung noch zu bestätigen"}
                </b>
                {format === "vimcar" ? (
                  <p>
                    Importiert werden nur Betriebsfahrten. Die Tagesabwesenheit
                    läuft von der ersten bis zur letzten Betriebsfahrt;
                    Arbeitsweg und Privatfahrten werden nicht als Reisekosten
                    angesetzt.
                  </p>
                ) : (
                  <p>
                    Importierte Start- und Endzeiten werden nicht ungeprüft als
                    steuerliche Abwesenheitsdauer übernommen. Die Tage erhalten
                    einen Prüfhinweis.
                  </p>
                )}
              </div>
            </div>
            <div className="wizard-nav">
              <button disabled={saving} onClick={() => setStep(3)}>Zurück zur Zuordnung</button>
              <button disabled={saving} onClick={cancel}>Import abbrechen</button>
              <button className="primary" disabled={saving || !selectedTrips.length} onClick={() => void doImport()}>
                {saving ? "Wird gespeichert …" : `${selectedTrips.length} Fahrten importieren`}
              </button>
            </div>
          </div>
        )}
        {step === 5 && (
          <div className="success-state">
            <div className="success-icon">
              <Check />
            </div>
            <h2>Import abgeschlossen</h2>
            <p>
              {result?.trips.length || 0} Fahrten wurden übernommen.
            </p>
            <div className="result-grid">
              <div>
                <b>{result?.duplicates || 0}</b>
                <span>Duplikate übersprungen</span>
              </div>
              <div>
                <b>{result?.invalid || 0}</b>
                <span>ungültige Zeilen</span>
              </div>
              {result && (
                <>
                  <div>
                    <b>{result.ignoredCommute}</b>
                    <span>Arbeitsweg-Zeilen nicht angesetzt</span>
                  </div>
                  <div>
                    <b>{result.ignoredPrivate}</b>
                    <span>Privatfahrten nicht angesetzt</span>
                  </div>
                </>
              )}
              <div>
                <b>{profileName}</b>
                <span>{result?.trips.length ? "Profil gespeichert" : "Keine neuen Daten gespeichert"}</span>
              </div>
            </div>
            <button className="primary" onClick={() => go("Monatsübersicht")}>
              Zur Monatsübersicht
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </section>
      <aside className="side-help">
        <h3>Was passiert beim Import?</h3>
        <ol>
          <li>Die Datei wird nur in Ihrem Browser gelesen.</li>
          <li>Spalten werden automatisch vorgeschlagen.</li>
          <li>Duplikate werden anhand mehrerer Merkmale verhindert.</li>
          <li>Unklare Abwesenheitszeiten bleiben zur Bestätigung offen.</li>
        </ol>
        <p>
          <b>Vimcar-Profil eingerichtet.</b>
          <br />
          Der bereitgestellte CSV-Aufbau mit 29 Spalten ist fest zugeordnet. Der
          PDF-Bericht enthält keine Uhrzeiten und dient deshalb nur als
          Nachweis, nicht als Quelle der Spesenberechnung.
        </p>
      </aside>
    </div>
  );
}
function WizardNav({
  back,
  next,
  disabled,
  nextLabel = "Weiter",
}: {
  back: () => void;
  next: () => void;
  disabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="wizard-nav">
      <button className="ghost" onClick={back}>
        Zurück
      </button>
      <button className="primary" disabled={disabled} onClick={next}>
        {nextLabel}
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Record<string, unknown>[];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h}>{String(r[h] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
