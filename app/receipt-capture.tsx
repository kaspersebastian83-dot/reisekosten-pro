// Aus app/page.tsx herausgelöst (1.18.3, unverändert verschoben); Übersicht im README unter „Aufbau der Oberfläche“.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, Copy, Inbox, ReceiptText, RotateCcw, ScanLine, ShieldCheck, Sparkles, X } from "lucide-react";
import type { AppState, Expense, ReceiptInboxItem } from "../lib/types";
import { expenseCategories, today } from "../lib/config";
import { round2 } from "../lib/calculations";
import { cleanContext, duplicateMessage, linkingErrors, paymentPayer, similarExpense, validDate } from "../lib/receipt-linking";
import { jpegName, readReceiptFile, rotateReceiptImage } from "../lib/receipt-file";
import { MerchantInput, PaymentSelect, ReceiptLinkFields, useReceiptDataUrl } from "./receipt-link-fields";
import { knownMerchants } from "../lib/merchants";
import { RECEIPT_ROTATIONS, TURNED_ONLY, UPRIGHT_ONLY, applyMerchantRule, readingIncomplete, recognizeReceiptLocally } from "../lib/receipt-ocr";
import { readAllDirections } from "../lib/device-settings";
import { CurrencyFields } from "./currency-fields";

import { usePendingWork } from "../lib/pending-work";
import { euro, uid } from "./shared";

export function ReceiptCapture({
  state,
  month,
  update,
  notify,
  close,
  initial,
  onDone,
  position,
}: {
  state: AppState;
  month: string;
  update: (f: (s: AppState) => AppState) => void;
  notify: (s: string, undo?: () => void) => void;
  close: () => void;
  initial?: ReceiptInboxItem;
  /** Eingang der Reihe nach: nach „übernehmen“ oder „im Eingang lassen“ weiter zum nächsten Beleg statt schließen. */
  onDone?: () => void;
  /** z. B. „Beleg 2 von 5“ */
  position?: string;
}) {
  const now = today();
  const [receipt, setReceipt] = useState(initial?.receipt);
  const merchants = useMemo(() => knownMerchants(state), [state.expenses, state.merchantRules]); // eslint-disable-line react-hooks/exhaustive-deps
  const receiptUrl = useReceiptDataUrl(receipt);
  const [suggestion, setSuggestionState] = useState<import("../lib/types").ReceiptSuggestion>(
    initial?.suggestion || {
      date: now.startsWith(month) ? now : `${month}-01`,
      category: "sonstige Nebenkosten",
      vatRate: 19,
      confidence: 0,
    },
  );
  const [paymentType, setPaymentType] = useState<Expense["paymentType"]>(
    initial ? initial.paymentType || state.expenses.find(e => e.id === initial.expenseId)?.paymentType || "unbekannt" : "privat vorgestreckt",
  );
  const [tripId, setTripId] = useState<string | undefined>(initial?.tripId);
  const [scanning, setScanning] = useState(false);
  const [readingReceipt, setReadingReceipt] = useState(false);
  const saving = useRef(false);
  const [progress, setProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState("");
  const [scanError, setScanError] = useState("");
  /** Nur aufrecht gelesen und Betrag oder Datum fehlen: „gedreht lesen“ anbieten. */
  const [turnable, setTurnable] = useState(false);
  /** Was die letzte Texterkennung tatsächlich gefunden hat (nicht vorbelegte Formularwerte). */
  const ocrFound = useRef<{ gross?: number; date?: string }>({});
  usePendingWork(true);

  const selectedTripId = tripId;
  const duplicateReceipt = receipt
    ? state.expenses.some(
        (expense) =>
          expense.id !== initial?.expenseId &&
          expense.receipt?.hash === receipt.hash,
      ) ||
      state.receiptInbox.some(
        (item) => item.id !== initial?.id && item.receipt.hash === receipt.hash,
      )
    : false;

  const similarReceipt = similarExpense(state.expenses, {...suggestion, id:initial?.expenseId});
  const setSuggestion = (next: typeof suggestion) => {
    for (const key of Object.keys(next) as (keyof typeof suggestion)[]) if (next[key] !== suggestion[key]) editedFields.current.add(key);
    setSuggestionState(next);
  };
  const scanRevision = useRef(0);
  const editedFields = useRef(new Set<string>());
  useEffect(() => () => { scanRevision.current++; fileRevision.current++; }, []);
  const scan = async (nextReceipt: NonNullable<typeof receipt>, turned = false) => {
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(nextReceipt.type)) {
      setScanError(
        "Dieser Dateityp kann gespeichert, aber nicht automatisch gelesen werden.",
      );
      return;
    }
    const revision = ++scanRevision.current;
    setScanning(true);
    setScanError("");
    setTurnable(false);
    // Vorgabe: nur aufrecht lesen (schnell). Alle Richtungen nur mit Geräteeinstellung oder über „gedreht lesen“.
    const all = readAllDirections();
    try {
      const recognized = await recognizeReceiptLocally(
        nextReceipt.dataUrl,
        (value, status) => {
          if (revision !== scanRevision.current) return;
          setProgress(value);
          setScanStatus(status);
        },
        turned ? TURNED_ONLY : all ? RECEIPT_ROTATIONS : UPRIGHT_ONLY,
      );
      const { rotation, ocrConfidence: _ocrConfidence, ...read } = recognized;
      const learned = applyMerchantRule(read, state.merchantRules, merchants);
      if (revision !== scanRevision.current) return;
      if (turned) {
        const found = (x: { gross?: number; date?: string }) => (x.gross ? 1 : 0) + (x.date ? 1 : 0);
        const better = (!!learned.suggestion.gross && !ocrFound.current.gross) || found(learned.suggestion) > found(ocrFound.current);
        if (!better) { setScanError("Auch gedreht nicht besser lesbar – bitte Betrag und Datum eintippen."); return; }
      } else if (!all && readingIncomplete(learned.suggestion)) setTurnable(true);
      ocrFound.current = { gross: learned.suggestion.gross, date: learned.suggestion.date };
      setSuggestionState(current => ({...current, ...Object.fromEntries(Object.entries(learned.suggestion).filter(([key]) => !editedFields.current.has(key)))}));
      // Quer oder kopfüber gelesen: gespeichertes Foto aufrecht drehen (Fingerabdruck bleibt der der Originaldatei).
      if (rotation) {
        const upright = await rotateReceiptImage(nextReceipt.dataUrl, rotation);
        if (upright && revision === scanRevision.current)
          setReceipt(current => current && current.id === nextReceipt.id && current.dataUrl === nextReceipt.dataUrl
            ? { ...current, dataUrl: upright.dataUrl, size: upright.size, type: "image/jpeg", name: jpegName(current.name) } : current);
      }

    } catch {
      if (revision !== scanRevision.current) return;
      setScanError(
        "Die automatische Erkennung war nicht möglich. Der Beleg kann trotzdem gespeichert und manuell bestätigt werden.",
      );
    } finally {
      if (revision === scanRevision.current) setScanning(false);
    }
  };

  const fileRevision = useRef(0);
  const chooseFile = async (file?: File) => {
    if (!file) return;
    const revision = ++fileRevision.current;
    scanRevision.current++;
    editedFields.current.clear();
    setReadingReceipt(true);
    setScanning(false);
    try {
      const nextReceipt = {id: initial?.receipt.id || uid(), ...await readReceiptFile(file)};
      if (revision !== fileRevision.current) return;
      setReceipt(nextReceipt);
      void scan(nextReceipt);
    } catch {
      if (revision === fileRevision.current) setScanError("Beleg konnte nicht gelesen werden. Bitte erneut auswählen.");
    } finally { if (revision === fileRevision.current) setReadingReceipt(false); }
  };

  const buildInboxItem = (
    status: ReceiptInboxItem["status"],
    expenseId?: string,
  ): ReceiptInboxItem => ({
    id: initial?.id || uid(),
    receipt: receipt!,
    capturedAt: initial?.capturedAt || new Date().toISOString(),
    status,
    suggestion,
    tripId: selectedTripId || undefined,
    expenseId,
    paymentType,
    notes: initial?.notes || "",
  });

  const saveInbox = () => {
    if (!receipt || readingReceipt || saving.current) return;
    const duplicate = duplicateMessage(state, {id:initial?.expenseId, receipt}, initial?.id);
    if (duplicate) return notify(duplicate);
    saving.current = true;
    const item = buildInboxItem(suggestion.rawText ? "erkannt" : "neu");
    update((s) => {
      const index = s.receiptInbox.findIndex((entry) => entry.id === item.id);
      if (index >= 0) s.receiptInbox[index] = item;
      else s.receiptInbox.push(item);
      return s;
    });
    notify("Beleg im Eingang gespeichert", () =>
      update((s) => {
        if (initial) {
          const index = s.receiptInbox.findIndex(
            (entry) => entry.id === initial.id,
          );
          if (index >= 0) s.receiptInbox[index] = initial;
        } else
          s.receiptInbox = s.receiptInbox.filter(
            (entry) => entry.id !== item.id,
          );
        return s;
      }),
    );
    if (onDone) onDone(); else close();
  };

  const createExpenseFromReceipt = () => {
    if (readingReceipt || scanning || saving.current) return;
    if (!receipt || !(suggestion.gross && Number.isFinite(suggestion.gross) && suggestion.gross > 0) || !validDate(suggestion.date)) {
      notify("Bitte Datum und Betrag bestätigen");
      return;
    }
    const currency = suggestion.currency || "EUR", exchangeRate = currency === "EUR" ? 1 : suggestion.exchangeRate || 0;
    if (!(exchangeRate > 0)) { notify(`Bitte den Kurs für ${currency} angeben (EZB-Kurs holen oder Kartenabrechnung).`); return; }
    const problem = linkingErrors({...suggestion, date:suggestion.date!, category:suggestion.category || ""})[0] || duplicateMessage(state, {id:initial?.expenseId, receipt, merchant:suggestion.merchant, invoiceNumber:suggestion.invoiceNumber}, initial?.id);
    if (problem) return notify(problem);
    const vatRate = suggestion.vatRate ?? 19;
    const net = round2(suggestion.gross / (1 + vatRate / 100));
    const expenseId = initial?.expenseId || uid();
    const duplicate = duplicateReceipt || !!similarReceipt;
    const merchantPattern = suggestion.merchant
      ?.toLowerCase()
      .trim()
      .slice(0, 40);
    const previousMerchantRule = merchantPattern
      ? structuredClone(
          state.merchantRules.find(
            (entry) => entry.merchantPattern === merchantPattern,
          ),
        )
      : undefined;
    const previousExpense = state.expenses.find(e => e.id === expenseId);
    const expense: Expense = {
      ...previousExpense,
      ...cleanContext(suggestion),
      id: expenseId,
      date: suggestion.date!,
      tripId: selectedTripId || undefined,
      category: suggestion.category || "sonstige Nebenkosten",
      description: suggestion.merchant || "Fotografierter Beleg",
      gross: suggestion.gross,
      net,
      vatRate,
      vat: round2(suggestion.gross - net),
      currency,
      exchangeRate,
      exchangeRateSource: currency === "EUR" ? undefined : suggestion.exchangeRateSource,
      paymentType,
      paidBy:
        paymentPayer(paymentType),
      reimbursementStatus:
        paymentType === "privat vorgestreckt"
          ? "offen"
          : "nicht erstattungsfähig",
      merchant: suggestion.merchant,
      invoiceNumber: suggestion.invoiceNumber,
      businessShare: 100,
      notes: previousExpense?.notes || "Aus Beleg-Eingang übernommen",
      receipt,
      status: duplicate ? "ungeprüft" : "vollständig",
      warnings: duplicate ? ["Möglicher doppelter Beleg"] : [],
    };
    saving.current = true;
    const item = buildInboxItem("zugeordnet", expense.id);
    update((s) => {
      const expenseIndex = s.expenses.findIndex(
        (entry) => entry.id === expense.id,
      );
      if (expenseIndex >= 0) s.expenses[expenseIndex] = expense;
      else s.expenses.push(expense);
      const inboxIndex = s.receiptInbox.findIndex(
        (entry) => entry.id === item.id,
      );
      if (inboxIndex >= 0) s.receiptInbox[inboxIndex] = item;
      else s.receiptInbox.push(item);
      if (merchantPattern) {
        const rule = s.merchantRules.find(
          (entry) => entry.merchantPattern === merchantPattern,
        );
        if (rule) {
          rule.category = expense.category;
          rule.paymentType = paymentType;
          rule.vatRate = vatRate;
          rule.uses += 1;
          rule.updatedAt = new Date().toISOString();
        } else {
          s.merchantRules.push({
            id: uid(),
            merchantPattern,
            category: expense.category,
            paymentType,
            vatRate,
            uses: 1,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      return s;
    });
    notify(`${expense.category}: ${euro(expense.gross)} übernommen`, () =>
      update((s) => {
        s.expenses = s.expenses.filter((entry) => entry.id !== expense.id);
        if (previousExpense) s.expenses.push(previousExpense);
        if (initial) {
          const index = s.receiptInbox.findIndex(
            (entry) => entry.id === initial.id,
          );
          if (index >= 0) s.receiptInbox[index] = initial;
        } else
          s.receiptInbox = s.receiptInbox.filter(
            (entry) => entry.id !== item.id,
          );
        if (merchantPattern) {
          s.merchantRules = s.merchantRules.filter(
            (entry) => entry.merchantPattern !== merchantPattern,
          );
          if (previousMerchantRule) s.merchantRules.push(previousMerchantRule);
        }
        return s;
      }),
    );
    if (onDone) onDone(); else close();
  };

  return (
    <div
      className="quick-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className="receipt-capture"
        aria-label="Beleg fotografieren und zuordnen"
      >
        <header>
          <div>
            <p className="eyebrow">Beleg-Eingang{position ? ` · ${position}` : ""}</p>
            <h2>
              {initial ? "Beleg prüfen" : "Fotografieren – den Rest später"}
            </h2>
          </div>
          <button className="icon" onClick={close} aria-label="Schließen">
            <X />
          </button>
        </header>
        {!receipt ? (
          <label className="camera-stage">
            <div>
              <Camera size={42} />
              <h3>Beleg fotografieren</h3>
              <p>Auf dem Smartphone oder iPad öffnet sich direkt die Kamera.</p>
              <span className="primary">Kamera öffnen</span>
            </div>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.heic,.pdf,image/*"
              capture="environment"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </label>
        ) : (
          <div className="receipt-workspace">
            <div className="receipt-preview">
              {receipt.type.startsWith("image/") &&
              !receipt.type.includes("heic") ? (
                // Data-URLs aus der lokalen IndexedDB benötigen keine Bildoptimierung.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={receiptUrl || undefined} alt="Fotografierter Beleg" />
              ) : (
                <div>
                  <ReceiptText size={40} />
                  <b>{receipt.name}</b>
                </div>
              )}
              <label>
                <Camera size={16} />
                Neu fotografieren
                <input
                  type="file"
                  accept="image/*,.pdf"
                  capture="environment"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
              </label>
            </div>
            <div className="receipt-fields">
              {scanning && (
                <div className="ocr-progress">
                  <ScanLine size={18} />
                  <div>
                    <b>Beleg wird lokal gelesen … {progress}%</b>
                    <span>{scanStatus}</span>
                    <i>
                      <em style={{ width: `${progress}%` }} />
                    </i>
                    {/* Speichern wartet auf die Erkennung (sonst gingen erkannte Felder und das aufrecht gedrehte Foto verloren).
                        Hängt sie, lässt sie sich abbrechen und der Beleg von Hand erfassen. */}
                    <button type="button" className="link" onClick={() => { scanRevision.current++; setScanning(false); setScanError("Erkennung abgebrochen. Den Beleg bitte von Hand ergänzen."); }}>Erkennung abbrechen</button>
                  </div>
                </div>
              )}
              {scanError && (
                <div className="info-box yellow">
                  <AlertTriangle />
                  <div>
                    <b>Manuelle Bestätigung</b>
                    <p>{scanError}</p>
                  </div>
                </div>
              )}
              {turnable && !scanning && receipt && (
                <div className="info-box yellow turn-hint">
                  <RotateCcw size={18} />
                  <div>
                    <b>{!suggestion.gross ? "Betrag" : "Datum"} nicht gelesen</b>
                    <p>Liegt der Beleg auf dem Foto quer oder auf dem Kopf? Dann gedreht lesen lassen (dauert etwas länger).</p>
                    <button type="button" className="ghost" onClick={() => void scan(receipt, true)}>Beleg liegt quer – gedreht lesen</button>
                  </div>
                </div>
              )}
              {(duplicateReceipt || similarReceipt) && (
                <div className="info-box yellow">
                  <Copy size={18} />
                  <div>
                    <b>Möglicher doppelter Beleg</b>
                    <p>
                      Datei oder Rechnungsangaben passen zu einem vorhandenen Beleg. Bitte vor erneutem Erfassen prüfen.
                    </p>
                  </div>
                </div>
              )}
              {!scanning && suggestion.confidence > 0 && (
                <div className="ocr-result">
                  <Sparkles size={17} />
                  <span>
                    <b>{suggestion.confidence}% Erkennungsqualität</b> – bitte
                    Vorschläge kurz bestätigen.
                  </span>
                </div>
              )}
              <div className="receipt-form">
                <label>
                  Datum
                  <input
                    type="date"
                    value={suggestion.date || ""}
                    onChange={(event) =>
                      setSuggestion({ ...suggestion, date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Betrag ({suggestion.currency && suggestion.currency !== "EUR" ? suggestion.currency : "€"})
                  <input
                    inputMode="decimal"
                    type="number"
                    step="0.01"
                    value={suggestion.gross || ""}
                    onChange={(event) =>
                      setSuggestion({
                        ...suggestion,
                        gross: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <MerchantInput className="wide" label="Händler" value={suggestion.merchant || ""} known={merchants}
                  onChange={(merchant, match) => {
                    // Nur der Händler gilt als selbst eingegeben. Kategorie und Steuersatz aus seiner Regel sind Vorgaben:
                    // ein anderer Händler darf sie wieder ändern – selbst geänderte Felder bleiben.
                    editedFields.current.add("merchant");
                    setSuggestionState({
                      ...suggestion, merchant,
                      ...(match?.rule && !editedFields.current.has("category") ? { category: match.rule.category } : {}),
                      ...(match?.rule && !editedFields.current.has("vatRate") ? { vatRate: match.rule.vatRate } : {}),
                    });
                  }} />
                <label>
                  Kategorie
                  <select
                    aria-label="Kategorie"
                    value={suggestion.category || "sonstige Nebenkosten"}
                    onChange={(event) =>
                      setSuggestion({
                        ...suggestion,
                        category: event.target.value,
                      })
                    }
                  >
                    {expenseCategories.map((category) => (
                      <option key={category} value={category}>{category === "Hotel" ? "Hotel / Übernachtung" : category}</option>
                    ))}
                  </select>
                </label>
                <label>Rechnungsnummer<input value={suggestion.invoiceNumber || ""} onChange={e=>setSuggestion({...suggestion, invoiceNumber:e.target.value})} /></label>
                <CurrencyFields value={{currency: suggestion.currency || "EUR", exchangeRate: suggestion.exchangeRate ?? (suggestion.currency && suggestion.currency !== "EUR" ? 0 : 1), exchangeRateSource: suggestion.exchangeRateSource, gross: suggestion.gross || 0, date: suggestion.date || ""}}
                  onChange={patch => { for (const key of ["currency", "exchangeRate", "exchangeRateSource"]) editedFields.current.add(key); setSuggestionState(current => ({...current, ...patch})); }} />
                <PaymentSelect value={paymentType} onChange={setPaymentType} />
                <ReceiptLinkFields value={{...suggestion, category:suggestion.category || "", date:suggestion.date || "", tripId:selectedTripId}} onChange={patch => {
                  const {tripId:nextTrip, ...context} = patch;
                  if ("tripId" in patch) setTripId(nextTrip);
                  setSuggestion({...suggestion, ...context});
                }} trips={state.trips} innendienst={state.settings.staffRole === "innendienst"} />
              </div>
            </div>
          </div>
        )}
        {receipt && (
          <footer>
            <button className="ghost" onClick={saveInbox} disabled={scanning || readingReceipt} title={scanning ? "Erst nach der Texterkennung – oder „Erkennung abbrechen“" : undefined}>
              <Inbox size={17} />
              Nur im Eingang speichern
            </button>
            <button
              className="primary"
              onClick={createExpenseFromReceipt}
              disabled={scanning || readingReceipt}
            >
              <Check size={18} />
              Bestätigen & Ausgabe anlegen
            </button>
          </footer>
        )}
        <p className="local-ocr-note">
          <ShieldCheck size={14} />
          Der Beleg bleibt auf diesem Gerät. Für die Texterkennung wird beim
          ersten Einsatz einmalig ein Sprachmodell geladen.
        </p>
      </section>
    </div>
  );
}
