// Aus app/page.tsx herausgelöst (1.18.3, unverändert verschoben); Übersicht im README unter „Aufbau der Oberfläche“.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import type { AppState, Expense } from "../lib/types";
import { expenseCategories } from "../lib/config";
import { expenseConflictsWithMileageAllowance, round2 } from "../lib/calculations";
import { cleanContext, duplicateMessage, linkingErrors, paymentPayer, syncExpenseLink, validDate } from "../lib/receipt-linking";
import { readReceiptFile } from "../lib/receipt-file";
import { MerchantInput, PaymentSelect, ReceiptAttachment, ReceiptLinkFields } from "./receipt-link-fields";
import { knownMerchants, learnMerchant, type KnownMerchant } from "../lib/merchants";
import { monthLabel } from "../lib/month-navigation";
import { CurrencyFields } from "./currency-fields";

import { usePendingWork } from "../lib/pending-work";
import { nextExpenseDraft } from "../lib/batch-entry";
import { removeExpense } from "../lib/entry-removal";
import { BatchCount, Modal, blankExpense, dateDe, euro, focusFirstField, uid } from "./shared";

export function Expenses({
  state,
  update,
  notify,
  initialExpenseId,
  clearInitialExpense,
  initialDraft, clearInitialDraft, workspaceMonth, onSaved,
  onClosed,
}: {
  /** Formular ohne Speichern geschlossen. */
  onClosed?: () => void;
  state: AppState;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string, undo?: () => void) => void;
  initialExpenseId: string | null;
  clearInitialExpense: () => void;
  initialDraft?: Expense | null;
  clearInitialDraft?: () => void;
  workspaceMonth?: string;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState<Expense | null>(null);
  const merchants = useMemo(() => knownMerchants(state), [state.expenses, state.merchantRules]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Im Formular selbst geänderte Felder: ein gewählter Händler überschreibt sie nicht. */
  const touched = useRef(new Set<string>());
  useEffect(() => { touched.current.clear(); }, [editing?.id]);
  const withMerchant = (expense: Expense, merchant: string, match?: KnownMerchant): Expense => {
    const rule = match?.rule;
    if (!rule) return { ...expense, merchant };
    const next = { ...expense, merchant, ...(touched.current.has("category") ? {} : { category: rule.category }) };
    if (touched.current.has("vatRate") || rule.vatRate === expense.vatRate) return next;
    const net = round2(expense.gross / (1 + rule.vatRate / 100));
    return { ...next, vatRate: rule.vatRate, net, vat: round2(expense.gross - net) };
  };
  // Als Formular über der Monatsübersicht: nach Speichern oder Abbrechen wieder schließen.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) wasEditing.current = true;
    else if (wasEditing.current) { wasEditing.current = false; onClosed?.(); }
  }, [editing, onClosed]);
  useEffect(() => {
    if (initialDraft) {setEditing(initialDraft); clearInitialDraft?.();}
  }, [initialDraft, clearInitialDraft]);
  useEffect(() => {
    if (!initialExpenseId) return;
    const expense = state.expenses.find(e => e.id === initialExpenseId);
    if (expense) setEditing(structuredClone(expense));
    clearInitialExpense();
  }, [initialExpenseId, state.expenses, clearInitialExpense]);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const receiptRevision = useRef(0);
  const saving = useRef(false);
  useEffect(() => {saving.current = false; receiptRevision.current++; setReadingReceipt(false);}, [editing?.id]);
  useEffect(() => () => {receiptRevision.current++;}, []);
  usePendingWork(!!editing);
  const mileageConflict =
    !!editing &&
    expenseConflictsWithMileageAllowance(state.settings, state.trips, editing);
  const [batch, setBatch] = useState(0);
  useEffect(() => { if (!editing) setBatch(0); }, [editing]);
  const save = (next = false) => {
    if (!editing || readingReceipt || saving.current) return;
    const problem = linkingErrors(editing)[0] || (!validDate(editing.date) || !Number.isFinite(editing.gross) || editing.gross <= 0 ? "Bitte Rechnungsdatum und positiven Betrag prüfen" : "")
      || (editing.currency !== "EUR" && !(editing.exchangeRate > 0) ? `Bitte den Kurs für ${editing.currency} angeben (EZB-Kurs holen oder Kartenabrechnung).` : "") || duplicateMessage(state, editing);
    if (problem) return notify(problem);
    const duplicateReceipt =
      !!editing.receipt &&
      state.expenses.some(
        (x) => x.id !== editing.id && x.receipt?.hash === editing.receipt?.hash,
      );
    const duplicateDetails = state.expenses.some(
      (x) =>
        x.id !== editing.id &&
        x.date === editing.date &&
        x.gross === editing.gross &&
        !!editing.merchant &&
        x.merchant === editing.merchant &&
        (!editing.invoiceNumber || x.invoiceNumber === editing.invoiceNumber),
    );
    const e = {
      ...editing,
      ...cleanContext(editing),
      vat: round2(editing.gross - editing.net),
      reimbursementStatus: mileageConflict
        ? ("nicht erstattungsfähig" as const)
        : editing.reimbursementStatus,
      warnings: [
        ...(editing.receipt ? [] : ["Beleg fehlt"]),
        ...(editing.category === "Tanken" && !editing.vehicleId
          ? ["Tankbeleg ohne Fahrzeug"]
          : []),
        ...(duplicateReceipt || duplicateDetails
          ? ["Möglicher doppelter Beleg"]
          : []),
        ...(mileageConflict
          ? [
              "Durch die Kilometerpauschale abgegolten – nicht zusätzlich erstattungsfähig",
            ]
          : []),
      ],
    };
    if (!e.net && e.gross) {
      e.net = round2(e.gross / (1 + e.vatRate / 100));
      e.vat = round2(e.gross - e.net);
    }
    saving.current = true;
    update((s) => {
      const i = s.expenses.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        s.changes.push({
          id: uid(),
          entityType: "expense",
          entityId: e.id,
          field: "Gesamtdatensatz",
          oldValue: s.expenses[i],
          newValue: e,
          reason: "Manuelle Bearbeitung",
          user: s.settings.profileName || "Lokales Profil",
          changedAt: new Date().toISOString(),
        });
        s.expenses[i] = e;
      } else s.expenses.push(e);
      syncExpenseLink(s, e);
      // Händler merken: beim nächsten Beleg wiedererkennen, Kategorie und Steuersatz vorschlagen.
      learnMerchant(s, e, uid);
      return s;
    });
    const message = workspaceMonth && !e.date.startsWith(workspaceMonth)
      ? `Kostenposition gespeichert. Rechnungsdatum ${dateDe(e.date)}: Die Ausgabe erscheint in ${monthLabel(e.date.slice(0,7))}; der Arbeitsmonat bleibt ${monthLabel(workspaceMonth)}.`
      : "Kostenposition gespeichert";
    if (next) {
      setEditing(nextExpenseDraft(e, blankExpense()));
      setBatch((n) => n + 1);
      focusFirstField();
      notify(message === "Kostenposition gespeichert" ? "Kostenposition gespeichert – weiter mit der nächsten." : message);
      return;
    }
    setEditing(null);
    notify(message);
    onSaved?.();
  };
  const deleteEditing = () => {
    if (!editing || !state.expenses.some((e) => e.id === editing.id)) return;
    if (!window.confirm(`Kostenposition „${editing.description || editing.category}“ über ${euro(editing.gross)} löschen? Gespeicherte Abrechnungen bleiben unverändert.`)) return;
    const returned = state.receiptInbox.some((item) => item.expenseId === editing.id);
    update((s) => removeExpense(s, editing.id, { id: uid(), user: s.settings.profileName || "Lokales Profil", at: new Date().toISOString() }).state);
    setEditing(null);
    notify(returned ? "Kostenposition gelöscht. Der Beleg liegt wieder im Beleg-Eingang." : "Kostenposition gelöscht. Die Löschung steht im Änderungsprotokoll.");
  };
  const receipt = async (file?: File) => {
    if (!file || !editing) return;
    const revision = ++receiptRevision.current;
    setReadingReceipt(true);
    try {
      const receipt = {id:uid(), ...await readReceiptFile(file)};
      if (revision === receiptRevision.current) setEditing(current => current ? {...current, receipt} : null);
    } catch { if (revision === receiptRevision.current) notify("Beleg konnte nicht gelesen werden. Bitte erneut auswählen."); }
    finally { if (revision === receiptRevision.current) setReadingReceipt(false); }
  };
  return (
    <>
      {editing && (
        <Modal title="Kosten & Beleg" close={() => setEditing(null)} onSubmitShortcut={() => save(true)} wide>
          {workspaceMonth && <p className="notice" role="status">Arbeitsmonat: {monthLabel(workspaceMonth)}. Rechnungsdatum bitte am Beleg prüfen.{validDate(editing.date) && !editing.date.startsWith(workspaceMonth) && ` Diese Ausgabe erscheint wegen ihres Rechnungsdatums in ${monthLabel(editing.date.slice(0,7))}.`}</p>}
          {/* Zweispaltig: links Betrag, Beleg und Details; rechts Projekt und Reisezuordnung. */}
          <div className="expense-layout">
          <div className="form-grid expense-fields">
            <label>
              Datum
              <input
                type="date"
                value={editing.date}
                onChange={(e) =>
                  setEditing({ ...editing, date: e.target.value })
                }
              />
            </label>
            <label>
              Kategorie
              <select
                aria-label="Kategorie"
                value={editing.category}
                onChange={(e) => {
                  touched.current.add("category");
                  setEditing({ ...editing, category: e.target.value });
                }}
              >
                {expenseCategories.map((c) => (
                  <option key={c} value={c}>{c === "Hotel" ? "Hotel / Übernachtung" : c}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Beschreibung
              <input
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <label>
              Brutto ({editing.currency && editing.currency !== "EUR" ? editing.currency : "€"})
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                // Vorbelegte 0 beim Antippen markieren: Die erste Ziffer ersetzt sie (auf dem Handy musste man sie erst löschen).
                onFocus={(e) => { const field = e.currentTarget; requestAnimationFrame(() => { if (document.activeElement === field && Number(field.value) === 0) field.select(); }); }}
                value={editing.gross}
                onChange={(e) => {
                  const gross = Number(e.target.value);
                  const net = round2(gross / (1 + editing.vatRate / 100));
                  setEditing({
                    ...editing,
                    gross,
                    net,
                    vat: round2(gross - net),
                  });
                }}
              />
            </label>
            <CurrencyFields value={{currency: editing.currency || "EUR", exchangeRate: editing.exchangeRate, exchangeRateSource: editing.exchangeRateSource, gross: editing.gross, date: editing.date}}
              onChange={patch => setEditing(current => current ? {...current, ...patch} : current)} />
            <PaymentSelect value={editing.paymentType} onChange={paymentType => setEditing({...editing, paymentType, paidBy:paymentPayer(paymentType)})} />
            {editing.category === "Tanken" && (
              <>
                <label>
                  Fahrzeug
                  <select
                    value={editing.vehicleId || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        vehicleId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Bitte Fahrzeug auswählen</option>
                    {state.settings.vehicles
                      .filter((vehicle) => vehicle.active)
                      .map((vehicle) => (
                        <option value={vehicle.id} key={vehicle.id}>
                          {vehicle.name} · {vehicle.plate || "ohne Kennzeichen"}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Liter
                  <input
                    type="number"
                    step="0.01"
                    value={editing.fuelLiters || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        fuelLiters: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Kilometerstand
                  <input
                    type="number"
                    value={editing.odometer || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        odometer: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Preis je Liter
                  <input
                    disabled
                    value={
                      editing.fuelLiters
                        ? euro(editing.gross / editing.fuelLiters)
                        : "–"
                    }
                  />
                </label>
              </>
            )}
            <div className="wide expense-receipt">
              <label className="upload-box">
                <span>Beleg (PDF, JPG, PNG, HEIC)</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.heic,image/*"
                  onChange={(e) => receipt(e.target.files?.[0])}
                />
                <b>
                  {editing.receipt?.name || "Datei auswählen oder fotografieren"}
                </b>
              </label>
              <ReceiptAttachment receipt={editing.receipt} />
            </div>
            <details className="wide expense-more" open={!!(editing.merchant || editing.invoiceNumber || editing.businessShare !== 100 || editing.reimbursementStatus !== "offen")}>
              <summary>Weitere Angaben · Händler, Rechnungsnummer, Steuer, Erstattungsstatus, Anteil</summary>
              <div className="form-grid">
              <MerchantInput label="Händler / Anbieter" value={editing.merchant || ""} known={merchants}
                onChange={(merchant, match) => setEditing(withMerchant(editing, merchant, match))} />
              <label>
                Rechnungsnummer
                <input
                  value={editing.invoiceNumber || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, invoiceNumber: e.target.value })
                  }
                />
              </label>
              <label>
                Netto (€)
                <input
                  type="number"
                  step="0.01"
                  value={editing.net}
                  onChange={(e) =>
                    setEditing({ ...editing, net: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                USt.-Satz
                <select
                  value={editing.vatRate}
                  onChange={(e) => {
                    touched.current.add("vatRate");
                    setEditing({ ...editing, vatRate: Number(e.target.value) });
                  }}
                >
                  <option value="0">0 %</option>
                  <option value="7">7 %</option>
                  <option value="19">19 %</option>
                </select>
              </label>
              <label>
                Umsatzsteuer
                <input
                  disabled
                  value={euro(round2(editing.gross - editing.net))}
                />
              </label>
              <label>
                Erstattungsstatus
                <select
                  value={editing.reimbursementStatus}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      reimbursementStatus: e.target
                        .value as Expense["reimbursementStatus"],
                    })
                  }
                >
                  <option>offen</option>
                  <option>erstattet</option>
                  <option>nicht erstattungsfähig</option>
                </select>
              </label>
              <label>
                Dienstlicher Anteil (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={editing.businessShare}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      businessShare: Number(e.target.value),
                    })
                  }
                />
              </label>
              </div>
            </details>
          </div>
          <div className="expense-side">
            <ReceiptLinkFields value={editing} onChange={patch=>setEditing({...editing,...patch})} trips={state.trips} travelLabel="Reisezuordnung" compact innendienst={state.settings.staffRole === "innendienst"} />
            {mileageConflict && (
              <div className="error-box">
                <AlertTriangle />
                Mögliche Doppelerfassung: Bei Verwendung der Kilometerpauschale
                dürfen abgegoltene Fahrzeugkosten nicht zusätzlich angesetzt
                werden.
              </div>
            )}
          </div>
          </div>
          <div className="modal-actions">
            <BatchCount count={batch} noun={["Kostenposition", "Kostenpositionen"]} />
            {state.expenses.some((e) => e.id === editing.id) && <button className="ghost danger modal-delete" onClick={deleteEditing}><Trash2 size={16} /> Löschen</button>}
            <button className="ghost" onClick={() => setEditing(null)}>
              Abbrechen
            </button>
            <button className="ghost batch-next" onClick={() => save(true)} disabled={readingReceipt} title="Strg+Enter">
              <Plus size={17} />
              Speichern & nächste
            </button>
            <button className="primary" onClick={() => save()} disabled={readingReceipt}>
              <Save size={17} />
              Speichern & fertig
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
