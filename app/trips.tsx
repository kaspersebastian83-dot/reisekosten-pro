// Aus app/page.tsx herausgelöst (1.18.3, unverändert verschoben); Übersicht im README unter „Aufbau der Oberfläche“.
import { useEffect, useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { AppState, ReviewStatus, Trip } from "../lib/types";
import { calculateDay, groupTripsByDay, duplicateKey, round2, validateTrip } from "../lib/calculations";
import { manualTripErrors, manualTripInterval, manualTripReviewNotes, projectPlace, projectSuggestions } from "../lib/manual-trip";

import { usePendingWork } from "../lib/pending-work";
import { nextTripDraft } from "../lib/batch-entry";
import { linkedExpenseCount, removeTrip } from "../lib/entry-removal";
import { BatchCount, Modal, blankTrip, dateDe, euro, focusFirstField, uid } from "./shared";

export function Trips({
  state,
  update,
  notify,
  editing,
  setEditing,
  onSaved,
}: {
  state: AppState;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string) => void;
  editing: Trip | null;
  setEditing: (trip: Trip | null) => void;
  onSaved?: () => void;
}) {
  usePendingWork(!!editing);
  // Stapelerfassung: Anzahl der in dieser Runde gespeicherten Reisen; endet, wenn das Fenster schließt.
  const [batch, setBatch] = useState(0);
  useEffect(() => { if (!editing) setBatch(0); }, [editing]);
  const save = (next = false) => {
    if (!editing || manualTripErrors(editing, state.trips.find(t => t.id === editing.id)?.order).length) return;
    const t = {
      ...editing,
      sourceHash: duplicateKey(editing),
      warnings: [...validateTrip(editing), ...manualTripReviewNotes(editing)],
      status: "ungeprüft" as ReviewStatus,
    };
    update((s) => {
      const i = s.trips.findIndex((x) => x.id === t.id);
      if (i >= 0) {
        s.changes.push({
          id: uid(),
          entityType: "trip",
          entityId: t.id,
          field: "Gesamtdatensatz",
          oldValue: s.trips[i],
          newValue: t,
          reason: "Manuelle Bearbeitung",
          user: s.settings.profileName || "Lokales Profil",
          changedAt: new Date().toISOString(),
        });
        s.trips[i] = t;
      } else s.trips.push(t);
      return s;
    });
    if (next) {
      setEditing(nextTripDraft(t, blankTrip(state.settings)));
      setBatch((n) => n + 1);
      focusFirstField();
      notify("Reise gespeichert – weiter mit der nächsten.");
      return;
    }
    setEditing(null);
    notify("Reise gespeichert. Eine Hotelrechnung bei Bedarf über „Hotelrechnung erfassen“ ergänzen; es wird keine Übernachtungspauschale hinzugefügt.");
    onSaved?.();
  };
  const del = (id: string) =>
    update((s) => removeTrip(s, id, { id: uid(), user: s.settings.profileName || "Lokales Profil", at: new Date().toISOString() }));
  // Aus dem Bearbeitungsfenster: mit Rückfrage, danach schließen.
  const deleteEditing = () => {
    if (!editing || !state.trips.some((t) => t.id === editing.id)) return;
    const linked = linkedExpenseCount(state, editing.id);
    if (!window.confirm(`Reise vom ${dateDe(editing.date)}${editing.destination ? ` nach ${editing.destination}` : ""} löschen?${linked ? ` ${linked === 1 ? "Eine zugeordnete Kostenposition bleibt" : `${linked} zugeordnete Kostenpositionen bleiben`} erhalten, aber ohne Reisezuordnung.` : ""} Gespeicherte Abrechnungen bleiben unverändert.`)) return;
    del(editing.id);
    setEditing(null);
    notify("Reise gelöscht. Die Löschung steht im Änderungsprotokoll.");
  };
  return (
    <>
      {editing && (
        <Modal
          title={
            state.trips.some((t) => t.id === editing.id)
              ? "Reise bearbeiten"
              : "Neue Dienstreise"
          }
          close={() => setEditing(null)}
          onSubmitShortcut={() => save(true)}
          wide
        >
          <TripForm
            key={editing.id}
            trip={editing}
            setTrip={setEditing}
            settings={state.settings}
            trips={state.trips}
          />
          <div className="modal-actions">
            <BatchCount count={batch} noun={["Reise", "Reisen"]} />
            {state.trips.some((t) => t.id === editing.id) && <button className="ghost danger modal-delete" onClick={deleteEditing}><Trash2 size={16} /> Reise löschen</button>}
            <button className="ghost" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
            <button className="ghost batch-next" onClick={() => save(true)} disabled={!!manualTripErrors(editing, state.trips.find(t => t.id === editing.id)?.order).length} title="Strg+Enter">
              <Plus size={17} />
              Speichern & nächste
            </button>
            <button className="primary" onClick={() => save()} disabled={!!manualTripErrors(editing, state.trips.find(t => t.id === editing.id)?.order).length}>
              <Save size={17} />
              Speichern & fertig
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function TripForm({ trip, setTrip, settings, trips }: {
  trip: Trip; setTrip: (t: Trip) => void; settings: AppState["settings"]; trips: Trip[];
}) {
  const set = <K extends keyof Trip>(k: K, v: Trip[K]) => setTrip({ ...trip, [k]: v });
  const originalProject = trips.find(t => t.id === trip.id)?.order;
  const existing = originalProject !== undefined;
  const errors = manualTripErrors(trip, originalProject);
  // Vor der ersten Eingabe keine roten Fehler, nur ein ruhiger Hinweis auf die Pflichtangaben.
  const [initial] = useState(() => JSON.stringify(trip));
  const untouched = !existing && JSON.stringify(trip) === initial;
  const interval = manualTripInterval(trip);
  const days = errors.length ? [] : [...groupTripsByDay([trip])].map(([date, dayTrips]) => calculateDay(date, dayTrips, settings));
  const selectedVehicle = settings.vehicles.find(v => v.id === trip.vehicleId);
  const duration = (minutes: number) => `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
  const suggestedDestination = useRef(projectPlace(trip.order));
  const changeProject = (value: string) => {
    const place = projectPlace(value);
    const useSuggestion = !trip.destination || trip.destination === suggestedDestination.current;
    setTrip({ ...trip, order: value, destination: useSuggestion && place ? place : trip.destination });
    if (place) suggestedDestination.current = place;
  };
  return (
    // Zweispaltig: links die Eingaben, rechts Abwesenheit und Verpflegungsvorschau – passt ohne Scrollen auf übliche Bildschirme.
    <div className="manual-trip trip-layout">
    <div className="form-grid trip-fields">
      <p className="wide trip-intro">Pflichtangaben mit *. Erfasst wird die berufliche Abwesenheit von Wohnung und erster Tätigkeitsstätte.</p>
      <label className="wide">Projekt *
        <input aria-label="Projekt *" required list="trip-projects" placeholder="26.0123 Musterstadt" title="Nummer und Ort, frei eingeben oder bisheriges Projekt auswählen" value={trip.order} onChange={e => changeProject(e.target.value)} />
        <datalist id="trip-projects">{projectSuggestions(trips).map(p => <option key={p} value={p} />)}</datalist>
        {existing && !projectPlace(trip.order) && <small>Vorhandene Projektangabe kann unverändert bleiben.</small>}
      </label>
      <label>Reisegrund *<input required value={trip.purpose} onChange={e => set("purpose", e.target.value)} /></label>
      <label>Reiseziel *<input aria-label="Reiseziel *" required title="Projektort vorgeschlagen, frei überschreibbar. Vorschau nur für Inland." value={trip.destination} onChange={e => set("destination", e.target.value)} /></label>
      <div className="wide trip-times">
      <label>Abfahrt Datum *<input required type="date" value={trip.date} onChange={e => setTrip({...trip, date: e.target.value, endDate: !trip.endDate || trip.endDate === trip.date ? e.target.value : trip.endDate})} /></label>
      <label>Abfahrt Uhrzeit *<input required type="time" step="1" value={trip.startTime} onChange={e => set("startTime", e.target.value)} /></label>
      <label>Rückkehr Datum *<input required type="date" value={trip.endDate || trip.date} onChange={e => set("endDate", e.target.value)} /></label>
      <label>Rückkehr Uhrzeit *<input required type="time" step="1" value={trip.endTime} onChange={e => set("endTime", e.target.value)} /></label>
      </div>
      {(!!interval?.nights || trip.overnight) && <div className="wide trip-overnight">
        <label className="check"><input type="checkbox" checked={trip.overnight} onChange={e => set("overnight", e.target.checked)} />{interval?.nights === 1 ? "Auswärtige Übernachtung zwischen Abfahrt und Rückkehr tatsächlich erfolgt" : `Alle ${interval?.nights || 0} auswärtigen Übernachtungen zwischen Abfahrt und Rückkehr tatsächlich erfolgt`}</label>
        <small>Nächte: {days.slice(0,-1).map(d => dateDe(d.date)).join(" · ")} (jeweils auf den Folgetag). Bei abweichenden oder fehlenden Übernachtungen nicht bestätigen; Einzelheiten in Notizen festhalten.</small>
      </div>}
      <MealEditor trip={trip} setTrip={setTrip} />
      <details className="wide"><summary>Weitere Angaben · Fahrzeug, Korrekturen und Notizen</summary><div className="form-grid">
      <label>Startort<input value={trip.startPlace} onChange={e => set("startPlace", e.target.value)} /></label>
      <label>Kunde<input value={trip.customer} onChange={e => set("customer", e.target.value)} /></label>
      <label className="wide">Notizen / abweichende Übernachtungen<textarea value={trip.notes} onChange={e => set("notes", e.target.value)} /></label>
      <label>
        Verwendetes Fahrzeug
        <select
          value={trip.vehicleId || ""}
          onChange={(e) => {
            const vehicle = settings.vehicles.find(
              (item) => item.id === e.target.value,
            );
            // „Bisher: …“ / „Bitte Fahrzeug auswählen“ heißt: unverändert lassen.
            if (!vehicle) return;
            setTrip({
              ...trip,
              vehicleId: vehicle.id,
              vehicle: vehicle.name,
              plate: vehicle.plate,
              vehicleType:
                vehicle.ownership === "privatwagen"
                  ? "privatfahrzeug"
                  : "firmenfahrzeug",
            });
          }}
        >
          <option value="">
            {trip.vehicle
              ? `Bisher: ${trip.vehicle}`
              : "Bitte Fahrzeug auswählen"}
          </option>
          {settings.vehicles
            .filter(
              (vehicle) => vehicle.active || vehicle.id === trip.vehicleId,
            )
            .map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name} ·{" "}
                {vehicle.ownership === "privatwagen"
                  ? "Privatwagen"
                  : "Dienstwagen"}
              </option>
            ))}
        </select>
        <small>
          {selectedVehicle?.ownership === "privatwagen"
            ? selectedVehicle.reimbursementMethod === "pauschale"
              ? "Kilometerpauschale wird für dienstliche Kilometer berechnet."
              : "Abrechnung über tatsächliche Fahrzeugkosten."
            : selectedVehicle
              ? "Dienstwagen: keine persönliche Kilometerpauschale."
              : "Die Fahrzeugart beeinflusst die Kilometererstattung."}
        </small>
      </label>
      <label>
        Dienstliche Kilometer
        <input
          type="number"
          min="0"
          step="0.1"
          value={trip.businessKm}
          onChange={(e) => set("businessKm", Number(e.target.value))}
        />
      </label>
      <label>
        Kilometerstand Start
        <input
          type="number"
          value={trip.kmStart ?? ""}
          onChange={(e) =>
            set("kmStart", e.target.value ? Number(e.target.value) : undefined)
          }
        />
      </label>
      <label>
        Kilometerstand Ende
        <input
          type="number"
          value={trip.kmEnd ?? ""}
          onChange={(e) =>
            set("kmEnd", e.target.value ? Number(e.target.value) : undefined)
          }
        />
      </label>
      <label>
        Fahrtart
        <select
          value={trip.tripType}
          onChange={(e) => set("tripType", e.target.value as Trip["tripType"])}
        >
          <option>dienstlich</option>
          <option>privat</option>
          <option>erste Tätigkeitsstätte</option>
        </select>
      </label>
      <label>
        Manuelle Abwesenheit (Min.)
        <input
          type="number"
          value={trip.manualAbsenceMinutes ?? ""}
          onChange={(e) =>
            set(
              "manualAbsenceMinutes",
              e.target.value ? Number(e.target.value) : undefined,
            )
          }
        />
      </label>
      </div></details>
    </div>
    <aside className="trip-side">
      {errors.length > 0 && (untouched
        ? <p className="trip-required">Bitte Projekt, Reisegrund, Reiseziel sowie Abfahrt und Rückkehr angeben.</p>
        : <div className="trip-errors" role="alert">{errors.map(e => <p key={e}>{e}</p>)}</div>)}
      {interval && <div className="trip-summary"><b>Abwesenheitsdauer: {duration(interval.minutes)}</b><p>Keine Arbeitszeit. {interval.nights} Datumswechsel · {interval.nights + 1} Kalendertag(e).</p></div>}
      <label className="check confirm">
        <input
          type="checkbox"
          checked={trip.absenceConfirmed}
          onChange={(e) => set("absenceConfirmed", e.target.checked)}
        />
        <span>
          <b>Abwesenheitsdauer bestätigt</b>
          <small>
            Die Zeit bildet die berufliche Abwesenheit von Wohnung und erster
            Tätigkeitsstätte ab.
          </small>
        </span>
      </label>
      <section className="trip-preview" aria-label="Verpflegungsvorschau">
        <h3>Verpflegungsvorschau · Inland</h3>
        {days.map(day => <article key={day.date}>
          <div className="trip-preview-day"><b>{dateDe(day.date)} · {duration(day.absenceMinutes)}</b><b>{euro(day.allowanceAfter)}</b></div>
          <small>{day.reason}{day.breakfastCut || day.lunchCut || day.dinnerCut ? ` · ${euro(day.allowanceBefore)} − Frühstück ${euro(day.breakfastCut)} − Mittag ${euro(day.lunchCut)} − Abend ${euro(day.dinnerCut)}` : ""}</small>
        </article>)}
        {!!days.length && <p className="trip-preview-total"><b>Verpflegung gesamt: {euro(round2(days.reduce((sum,d) => sum + d.allowanceAfter, 0)))}</b></p>}
        {!days.length && <p className="muted">Erscheint, sobald Abfahrt und Rückkehr stimmen.</p>}
        {settings.ruleMode === "internal" && <p className="trip-preview-note">Achtung: interne Schwelle aus Einstellungen aktiv.</p>}
        {/* Zustandsabhängige Hinweise sichtbar; der immer gleiche Grundhinweis aufklappbar. */}
        {manualTripReviewNotes(trip).slice(1).map(note => <p key={note} className="trip-preview-note">{note}</p>)}
        <details className="trip-preview-more"><summary>Hinweise zur Vorschau</summary>
          <p>{settings.ruleMode === "internal" ? "Interne Schwelle aus Einstellungen aktiv." : "Gespeicherte Inlandstarife und gesetzlicher Schwellenmodus."} Vorschau dieser Reise; weitere Reisen desselben Tages können die Monatsberechnung beeinflussen.</p>
          <p>{manualTripReviewNotes(trip)[0]}</p>
          <p>Übernachtungspauschale: 0,00 €. Hotelrechnung separat über „Hotelrechnung“ erfassen. Keine doppelte Erstattung; keine automatische Zuordnung.</p>
        </details>
      </section>
    </aside>
    </div>
  );
}
function MealEditor({
  trip,
  setTrip,
}: {
  trip: Trip;
  setTrip: (t: Trip) => void;
}) {
  const days: string[] = [];
  const start = new Date(`${trip.date}T12:00:00Z`);
  const end = new Date(`${trip.endDate || trip.date}T12:00:00Z`);
  for (
    let d = start;
    d <= end && days.length < 60;
    d = new Date(d.getTime() + 86400000)
  )
    days.push(d.toISOString().slice(0, 10));
  const multi = days.length > 1;
  const setMeal = (
    day: string,
    field: "breakfast" | "lunch" | "dinner",
    checked: boolean,
  ) => {
    if (!multi)
      return setTrip({ ...trip, meals: { ...trip.meals, [field]: checked }, dailyMeals: { ...trip.dailyMeals, [day]: { ...(trip.dailyMeals?.[day] || trip.meals), [field]: checked } } });
    const current = trip.dailyMeals?.[day] || (day === trip.date ? trip.meals : { breakfast: false, lunch: false, dinner: false });
    setTrip({
      ...trip,
      dailyMeals: {
        ...(trip.dailyMeals || {}),
        [day]: { ...current, [field]: checked },
      },
    });
  };
  return (
    <div className="wide meal-days">
      <b>Gestellte / bezahlte Mahlzeiten</b>
      {days.map((day) => {
        const m = multi
          ? trip.dailyMeals?.[day] || (day === trip.date ? trip.meals : { breakfast: false, lunch: false, dinner: false })
          : trip.dailyMeals?.[day] || trip.meals;
        return (
          <fieldset key={day}>
            <legend>{multi ? dateDe(day) : "Reisetag"}</legend>
            {(["breakfast", "lunch", "dinner"] as const).map((f) => (
              <label className="check" key={f}>
                <input
                  type="checkbox"
                  checked={m[f]}
                  onChange={(e) => setMeal(day, f, e.target.checked)}
                />
                {f === "breakfast"
                  ? "Frühstück"
                  : f === "lunch"
                    ? "Mittagessen"
                    : "Abendessen"}
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
