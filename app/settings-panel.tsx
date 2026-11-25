// Aus app/page.tsx herausgelöst (1.18.3, unverändert verschoben); Übersicht im README unter „Aufbau der Oberfläche“.
import { useEffect, useState } from "react";
import { AlertTriangle, Car, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { AppState, VehicleProfile } from "../lib/types";
import { today } from "../lib/config";
import { readAllDirections, setReadAllDirections } from "../lib/device-settings";

import { usePendingWork } from "../lib/pending-work";
import { appRelease } from "../lib/release";
import { uid } from "./shared";

export function SettingsPanel({
  state,
  update,
  notify,
  kasse,
}: {
  state: AppState;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string) => void;
  /** Bürokasse auf diesem Gerät anbieten (gilt sofort, nur für dieses Gerät). */
  kasse?: { sichtbar: boolean; setSichtbar: (value: boolean) => void };
}) {
  const [local, setLocal] = useState(structuredClone(state.settings));
  const [allDirections, setAllDirections] = useState(readAllDirections);
  // Oben über „Außendienst · Innendienst“ umgeschaltet: hier übernehmen, sonst würde „Speichern“ es zurückdrehen.
  useEffect(() => setLocal((current) => current.staffRole === state.settings.staffRole ? current : { ...current, staffRole: state.settings.staffRole }), [state.settings.staffRole]);
  usePendingWork(JSON.stringify(local) !== JSON.stringify(state.settings));
  const addVehicle = (ownership: VehicleProfile["ownership"]) => {
    const vehicle: VehicleProfile = {
      id: uid(),
      name:
        ownership === "privatwagen" ? "Neuer Privatwagen" : "Neuer Dienstwagen",
      plate: "",
      ownership,
      reimbursementMethod: ownership === "privatwagen" ? "pauschale" : "keine",
      active: true,
    };
    setLocal({
      ...local,
      vehicles: [...(local.vehicles || []), vehicle],
      defaultVehicleId: local.defaultVehicleId || vehicle.id,
    });
  };
  const updateVehicle = (id: string, patch: Partial<VehicleProfile>) =>
    setLocal({
      ...local,
      vehicles: (local.vehicles || []).map((vehicle) =>
        vehicle.id === id ? { ...vehicle, ...patch } : vehicle,
      ),
    });
  const deleteVehicle = (id: string) => {
    if ((local.vehicles || []).length <= 1) return;
    const vehicles = local.vehicles.filter((vehicle) => vehicle.id !== id);
    setLocal({
      ...local,
      vehicles,
      defaultVehicleId:
        local.defaultVehicleId === id
          ? vehicles.find((vehicle) => vehicle.active)?.id || vehicles[0].id
          : local.defaultVehicleId,
    });
  };
  const save = () => {
    update((s) => {
      s.changes.push({
        id: uid(),
        entityType: "settings",
        entityId: "main",
        field: "Einstellungen und Tarife",
        oldValue: s.settings,
        newValue: local,
        reason: "Einstellungen gespeichert",
        user: local.profileName || "Lokales Profil",
        changedAt: new Date().toISOString(),
      });
      s.settings = local;
      return s;
    });
    notify("Einstellungen gespeichert");
  };
  return (
    <div className="settings-layout">
      <section className="card app-version"><p className="eyebrow">Über diese App</p><h3>SpesenKit {appRelease.version}</h3>
        <p>Laufende Version{appRelease.commit ? ` · Commit ${appRelease.commit}` : ""}. Daten und Belege werden nur in diesem Browser gespeichert und – sobald er verbunden ist – im eigenen SpesenKit-Ordner. An Internetdienste geht nichts.</p>
      </section>
      <section className="card">
        <p className="eyebrow">Profil & Unternehmen</p>
        <h3>Angaben für die Abrechnung</h3>
        <div className="form-grid">
          <label>
            Name
            <input
              value={local.profileName}
              onChange={(e) =>
                setLocal({ ...local, profileName: e.target.value })
              }
            />
          </label>
          <label>
            Firma
            <input
              value={local.company}
              onChange={(e) => setLocal({ ...local, company: e.target.value })}
            />
          </label>
          <label>
            Abteilung
            <input
              value={local.department}
              onChange={(e) =>
                setLocal({ ...local, department: e.target.value })
              }
            />
          </label>
          <label>
            Kostenstelle
            <input
              value={local.costCenter}
              onChange={(e) =>
                setLocal({ ...local, costCenter: e.target.value })
              }
            />
          </label>
          <label>
            Tätigkeit
            <select
              aria-label="Tätigkeit"
              value={local.staffRole}
              onChange={(e) => setLocal({ ...local, staffRole: e.target.value as AppState["settings"]["staffRole"] })}
            >
              <option value="aussendienst">Außendienst – Dienstreisen, Fahrtenbuch, Verpflegung</option>
              <option value="innendienst">Innendienst – nur Kosten und Belege</option>
            </select>
            <small>Innendienst: keine Dienstreisen und kein Fahrtenbuch-Import, Kosten ohne Reise- und Projektzuordnung. Vorhandene Einträge bleiben erhalten. Umschalten geht auch oben über die Auswahl „Außendienst · Innendienst“.</small>
          </label>
          {kasse && <label className="check-row">
            <input type="checkbox" checked={kasse.sichtbar} onChange={(e) => { kasse.setSichtbar(e.target.checked); notify(e.target.checked ? "Bürokasse ist oben zur Auswahl." : "Bürokasse ausgeblendet – das Kassenbuch bleibt gespeichert."); }} />
            <span><b>Ich führe die Bürokasse</b><small>Zeigt oben zusätzlich „Bürokasse“ (Kassenbuch der Büro-Barkasse). Gilt nur für dieses Gerät, sofort.</small></span>
          </label>}
          <label className="check-row">
            <input type="checkbox" checked={allDirections} onChange={(e) => { setReadAllDirections(e.target.checked); setAllDirections(e.target.checked); notify(e.target.checked ? "Belege werden in allen Richtungen gelesen (langsamer)." : "Belege werden nur aufrecht gelesen – bei Bedarf „gedreht lesen“."); }} />
            <span><b>Belege automatisch in allen Richtungen lesen</b><small>Langsamer: Liest ein quer oder kopfüber fotografierter Beleg sich schlecht, probiert SpesenKit selbst alle Richtungen. Ohne Haken wird nur aufrecht gelesen; fehlen Betrag oder Datum, erscheint „Beleg liegt quer – gedreht lesen“. Gilt nur für dieses Gerät.</small></span>
          </label>
          <label>
            Zeitzone
            <input
              value={local.timezone}
              onChange={(e) => setLocal({ ...local, timezone: e.target.value })}
            />
          </label>
          <label className="wide">
            Wohnort / Startadresse
            <input
              value={local.homeAddress}
              onChange={(e) =>
                setLocal({ ...local, homeAddress: e.target.value })
              }
            />
          </label>
          <label className="wide">
            Erste Tätigkeitsstätte
            <input
              value={local.firstWorkplace}
              onChange={(e) =>
                setLocal({ ...local, firstWorkplace: e.target.value })
              }
            />
          </label>
          <label className="wide">
            Weitere Firmenstandorte
            <input
              value={local.regularSites}
              onChange={(e) =>
                setLocal({ ...local, regularSites: e.target.value })
              }
            />
          </label>
        </div>
      </section>
      <section className="card full vehicle-settings">
        <div className="card-head">
          <div>
            <p className="eyebrow">Fahrzeuge & Kilometererstattung</p>
            <h3>Dienstwagen und Privatwagen unterscheiden</h3>
          </div>
          <div className="vehicle-add-actions">
            <button className="ghost" onClick={() => addVehicle("dienstwagen")}>
              <Plus size={16} /> Dienstwagen
            </button>
            <button className="ghost" onClick={() => addVehicle("privatwagen")}>
              <Plus size={16} /> Privatwagen
            </button>
          </div>
        </div>
        <div className="info-box green vehicle-rule-note">
          <Car />
          <div>
            <b>Die Auswahl gilt je Fahrt</b>
            <p>
              Für einen Dienstwagen wird keine persönliche Kilometerpauschale
              berechnet. Beim Privatwagen wählen Sie Kilometerpauschale oder
              tatsächliche Fahrzeugkosten.
            </p>
          </div>
        </div>
        <div className="vehicle-list">
          {(local.vehicles || []).map((vehicle) => (
            <article
              key={vehicle.id}
              className={local.defaultVehicleId === vehicle.id ? "default" : ""}
            >
              <label className="vehicle-default">
                <input
                  type="radio"
                  name="defaultVehicle"
                  checked={local.defaultVehicleId === vehicle.id}
                  onChange={() =>
                    setLocal({ ...local, defaultVehicleId: vehicle.id })
                  }
                />
                <span>
                  <b>Standard</b>
                  <small>für neue und importierte Fahrten</small>
                </span>
              </label>
              <label>
                Fahrzeug / Modell
                <input
                  value={vehicle.name}
                  onChange={(event) =>
                    updateVehicle(vehicle.id, { name: event.target.value })
                  }
                />
              </label>
              <label>
                Kennzeichen
                <input
                  value={vehicle.plate}
                  placeholder="z. B. K-RK 123"
                  onChange={(event) =>
                    updateVehicle(vehicle.id, { plate: event.target.value })
                  }
                />
              </label>
              <label>
                Fahrzeugart
                <select
                  value={vehicle.ownership}
                  onChange={(event) => {
                    const ownership = event.target
                      .value as VehicleProfile["ownership"];
                    updateVehicle(vehicle.id, {
                      ownership,
                      reimbursementMethod:
                        ownership === "dienstwagen" ? "keine" : "pauschale",
                    });
                  }}
                >
                  <option value="dienstwagen">Dienstwagen</option>
                  <option value="privatwagen">Privatwagen</option>
                </select>
              </label>
              <label>
                Kilometerabrechnung
                {vehicle.ownership === "privatwagen" ? (
                  <select
                    value={vehicle.reimbursementMethod}
                    onChange={(event) =>
                      updateVehicle(vehicle.id, {
                        reimbursementMethod: event.target
                          .value as VehicleProfile["reimbursementMethod"],
                      })
                    }
                  >
                    <option value="pauschale">Kilometerpauschale</option>
                    <option value="tatsächliche Kosten">
                      tatsächliche Fahrzeugkosten
                    </option>
                  </select>
                ) : (
                  <div className="vehicle-no-mileage">
                    Keine persönliche Kilometerpauschale
                  </div>
                )}
              </label>
              <label className="vehicle-active check">
                <input
                  type="checkbox"
                  checked={vehicle.active}
                  onChange={(event) =>
                    updateVehicle(vehicle.id, { active: event.target.checked })
                  }
                />
                In Auswahllisten anzeigen
              </label>
              <button
                className="icon danger"
                onClick={() => deleteVehicle(vehicle.id)}
                disabled={(local.vehicles || []).length <= 1}
                aria-label={`${vehicle.name} löschen`}
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="card">
        <p className="eyebrow">Abwesenheitsregel</p>
        <h3>Wann entsteht ein Pauschbetrag?</h3>
        <div className="segmented">
          <button
            className={local.ruleMode === "legal" ? "active" : ""}
            onClick={() => setLocal({ ...local, ruleMode: "legal" })}
          >
            Gesetzliche Regel
          </button>
          <button
            className={local.ruleMode === "internal" ? "active" : ""}
            onClick={() => setLocal({ ...local, ruleMode: "internal" })}
          >
            Interne Firmenregel
          </button>
        </div>
        {local.ruleMode === "legal" ? (
          <div className="info-box green">
            <ShieldCheck />
            <div>
              <b>Mehr als 8:00 Stunden</b>
              <p>8:00 Stunden: 0,00 € · 8:01 Stunden: 14,00 €</p>
            </div>
          </div>
        ) : (
          <>
            <div className="field-row">
              <label>
                Vergleich
                <select
                  value={local.internalComparator}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      internalComparator: e.target
                        .value as typeof local.internalComparator,
                    })
                  }
                >
                  <option value="greater">mehr als</option>
                  <option value="atLeast">mindestens</option>
                </select>
              </label>
              <label>
                Grenze (Minuten)
                <input
                  type="number"
                  value={local.internalMinutes}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      internalMinutes: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="info-box yellow">
              <AlertTriangle />
              <div>
                <b>Interne Abrechnungsregel</b>
                <p>
                  Kann von der steuerlichen Höchstgrenze oder
                  Anspruchsvoraussetzung abweichen.
                </p>
              </div>
            </div>
          </>
        )}
      </section>
      <section className="card full">
        <div className="card-head">
          <div>
            <p className="eyebrow">Versionierte Tarife</p>
            <h3>Zentrale Rechts- und Pauschalwertkonfiguration</h3>
          </div>
          <button
            className="ghost"
            onClick={() =>
              setLocal({
                ...local,
                tariffs: [
                  ...local.tariffs,
                  {
                    id: uid(),
                    label: "Neuer Tarif",
                    validFrom: today(),
                    amount: 0,
                    country: "DE",
                    kind: "partial",
                    source: "Manuell ergänzt",
                    checkedAt: today(),
                    unit: "EUR",
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            Tarif
          </button>
        </div>
        <div className="tariff-table">
          {local.tariffs.map((t, i) => (
            <div key={t.id}>
              <input
                value={t.label}
                onChange={(e) => {
                  const a = [...local.tariffs];
                  a[i] = { ...t, label: e.target.value };
                  setLocal({ ...local, tariffs: a });
                }}
              />
              <select
                value={t.kind}
                onChange={(e) => {
                  const a = [...local.tariffs];
                  a[i] = { ...t, kind: e.target.value as typeof t.kind };
                  setLocal({ ...local, tariffs: a });
                }}
              >
                <option value="partial">Teilbetrag</option>
                <option value="full">Voller Tag</option>
                <option value="arrival">Anreise</option>
                <option value="departure">Abreise</option>
                <option value="mileage">Kilometer</option>
                <option value="breakfast">Frühstück</option>
                <option value="lunch">Mittag</option>
                <option value="dinner">Abend</option>
              </select>
              <input
                type="date"
                value={t.validFrom}
                onChange={(e) => {
                  const a = [...local.tariffs];
                  a[i] = { ...t, validFrom: e.target.value };
                  setLocal({ ...local, tariffs: a });
                }}
              />
              <input
                type="number"
                step="0.01"
                value={t.amount}
                onChange={(e) => {
                  const a = [...local.tariffs];
                  a[i] = { ...t, amount: Number(e.target.value) };
                  setLocal({ ...local, tariffs: a });
                }}
              />
              <span>{t.unit === "EUR" ? "€" : "%"}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="sticky-save">
        <button className="primary" onClick={save}>
          <Save size={18} />
          Einstellungen speichern
        </button>
      </div>
    </div>
  );
}
