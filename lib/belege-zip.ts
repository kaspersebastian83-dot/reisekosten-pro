/*
 * „Belegfotos als ZIP“ (Datensicherung, seit 1.20.0): alle Belegfotos dieses Geräts als normale Bilddateien in EINER
 * ZIP-Datei – zum Mitnehmen auf den PC, zum Weitergeben oder Ablegen. Nur lesen: Der Bestand ändert sich nicht.
 *
 * Inhalt:
 *   Kosten/<JJJJ-MM>/<Datum>_<Kostenart>_<Betrag>_<Händler>.<Endung>   Foto jeder Kostenposition (ohne stornierte)
 *   Beleg-Eingang/<Datum>_<Dateiname>.<Endung>                         Fotos im Beleg-Eingang, die (noch) keiner
 *                                                                      Kostenposition gehören – auch archivierte
 *   Belegliste.csv                                                     eine Zeile je Foto (Semikolon, UTF-8 mit BOM)
 * Dasselbe Foto (gleicher Fingerabdruck) steht nur einmal darin; die Kostenposition geht dem Eingang vor.
 * Fehlt ein Bild auf diesem Gerät, steht es in der Liste mit Hinweis – die ZIP entsteht trotzdem.
 */
import JSZip from "jszip";
import Papa from "papaparse";
import { dataUrlFile, receiptDataUrl } from "./receipt-images";
import type { AppState, Expense, Receipt, ReceiptInboxItem } from "./types";

export interface BelegEintrag {
  bereich: "Kosten" | "Beleg-Eingang";
  /** JJJJ-MM-TT; im Eingang das erkannte Belegdatum, sonst der Tag der Aufnahme. */
  datum: string;
  receipt: Receipt;
  expense?: Expense;
  inbox?: ReceiptInboxItem;
}

const TAG = /^\d{4}-\d{2}-\d{2}$/;
const eingangsDatum = (item: ReceiptInboxItem) => item.suggestion?.date && TAG.test(item.suggestion.date) ? item.suggestion.date : (item.capturedAt || "").slice(0, 10);
/** Gleiches Foto erkennen: Fingerabdruck der Datei, bei älteren Ständen der gespeicherte Hash. */
const fotoKennung = (receipt: Receipt) => receipt.fileId || receipt.hash || receipt.id;

/** Alle Belegfotos des Bestands, nach Datum sortiert; optional nur ein Monat (JJJJ-MM). */
export function belegListe(state: Pick<AppState, "expenses" | "receiptInbox">, monat?: string): BelegEintrag[] {
  const liste: BelegEintrag[] = [];
  const gesehen = new Set<string>();
  for (const expense of state.expenses) {
    if (expense.status === "storniert" || !expense.receipt) continue;
    const kennung = fotoKennung(expense.receipt);
    if (gesehen.has(kennung)) continue;
    gesehen.add(kennung);
    liste.push({ bereich: "Kosten", datum: expense.date, receipt: expense.receipt, expense });
  }
  for (const item of state.receiptInbox) {
    if (!item.receipt) continue;
    const kennung = fotoKennung(item.receipt);
    if (gesehen.has(kennung)) continue;   // schon als Kostenposition darin
    gesehen.add(kennung);
    liste.push({ bereich: "Beleg-Eingang", datum: eingangsDatum(item), receipt: item.receipt, inbox: item });
  }
  return liste
    .filter((eintrag) => !monat || eintrag.datum.startsWith(monat))
    .sort((a, b) => a.datum.localeCompare(b.datum) || a.bereich.localeCompare(b.bereich) || (a.expense?.id || a.inbox?.id || "").localeCompare(b.expense?.id || b.inbox?.id || ""));
}

/** Monate (JJJJ-MM) mit mindestens einem Belegfoto, neueste zuerst – für die Auswahl „Zeitraum“. */
export function belegMonate(state: Pick<AppState, "expenses" | "receiptInbox">) {
  return [...new Set(belegListe(state).map((eintrag) => eintrag.datum.slice(0, 7)).filter((monat) => /^\d{4}-\d{2}$/.test(monat)))].sort().reverse();
}

/** Teil eines Dateinamens: ohne Zeichen, die Windows, Android oder ZIP-Programme stören, höchstens 40 Zeichen. */
export const dateinamenTeil = (text: string) => text.normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "").replace(/\s+/g, " ").trim().replace(/ /g, "-").replace(/^\.+/, "").slice(0, 40).replace(/[-.]+$/, "");
const betragText = (expense: Expense) => `${expense.gross.toFixed(2).replace(".", ",")}${expense.currency && expense.currency !== "EUR" ? expense.currency : "EUR"}`;
const endung = (receipt: Receipt) => {
  const ausId = receipt.fileId?.split(".")[1];
  if (ausId && ausId !== "bin") return ausId;
  const ausName = /\.([a-z0-9]{1,5})$/i.exec(receipt.name || "")?.[1]?.toLowerCase();
  if (ausName) return ausName === "jpeg" ? "jpg" : ausName;
  const ausTyp = (receipt.type || "").split("/")[1]?.toLowerCase();
  return ausTyp === "jpeg" ? "jpg" : ausTyp && /^[a-z0-9]{1,5}$/.test(ausTyp) ? ausTyp : "bin";
};

/** Pfad im ZIP; gleiche Namen bekommen _2, _3 … */
export function belegPfade(liste: BelegEintrag[]) {
  const vergeben = new Set<string>();
  return liste.map((eintrag) => {
    const teile = eintrag.expense
      ? [eintrag.datum, eintrag.expense.category, betragText(eintrag.expense), eintrag.expense.merchant || eintrag.expense.description]
      : [eintrag.datum, (eintrag.receipt.name || "Beleg").replace(/\.[a-z0-9]{1,5}$/i, "")];
    const stamm = teile.map((teil) => dateinamenTeil(teil || "")).filter(Boolean).join("_") || "Beleg";
    const ordner = eintrag.expense ? `Kosten/${eintrag.datum.slice(0, 7)}` : "Beleg-Eingang";
    let pfad = `${ordner}/${stamm}.${endung(eintrag.receipt)}`;
    for (let n = 2; vergeben.has(pfad.toLowerCase()); n++) pfad = `${ordner}/${stamm}_${n}.${endung(eintrag.receipt)}`;
    vergeben.add(pfad.toLowerCase());
    return pfad;
  });
}

export const belegeZipName = (heute: string, monat?: string) => `SpesenKit-Belege_${monat || "alle"}_${heute}.zip`;

export interface BelegeZipErgebnis { blob: Blob; fotos: number; fehlen: number }

/**
 * Baut die ZIP. `bild` liefert die Daten-URL eines Belegs (Vorgabe: Sitzung, Browser, SpesenKit-Ordner) oder "".
 * Bilder werden ohne erneute Kompression abgelegt (sie sind schon JPEG/PNG/PDF).
 */
export async function belegeZip(liste: BelegEintrag[], bild: (receipt: Receipt) => Promise<string> = receiptDataUrl): Promise<BelegeZipErgebnis> {
  const zip = new JSZip();
  const pfade = belegPfade(liste);
  let fotos = 0, fehlen = 0;
  const zeilen = [];
  for (const [index, eintrag] of liste.entries()) {
    const datei = dataUrlFile(await bild(eintrag.receipt).catch(() => ""));
    if (datei) { zip.file(pfade[index], datei.bytes, { binary: true, compression: "STORE" }); fotos++; } else fehlen++;
    const { expense, inbox } = eintrag;
    zeilen.push({
      Datei: datei ? pfade[index] : "",
      Bereich: eintrag.bereich,
      Datum: eintrag.datum.split("-").reverse().join("."),
      Kostenart: expense?.category || inbox?.suggestion?.category || "",
      Beschreibung: expense?.description || "",
      Händler: expense?.merchant || inbox?.suggestion?.merchant || "",
      Betrag: expense ? expense.gross.toFixed(2).replace(".", ",") : inbox?.suggestion?.gross ? inbox.suggestion.gross.toFixed(2).replace(".", ",") : "",
      Währung: expense?.currency || inbox?.suggestion?.currency || (expense || inbox?.suggestion?.gross ? "EUR" : ""),
      Zahlungsart: expense?.paymentType || inbox?.paymentType || "",
      Projekt: expense?.projectNumber || "",
      Status: expense ? expense.status : inbox?.status === "archiviert" ? "archiviert" : "noch nicht zugeordnet",
      Originaldatei: eintrag.receipt.name || "",
      Hinweis: datei ? "" : "Bild auf diesem Gerät nicht vorhanden",
    });
  }
  zip.file("Belegliste.csv", "﻿" + Papa.unparse(zeilen.length ? zeilen : [{ Datei: "", Bereich: "", Datum: "", Hinweis: "Keine Belegfotos" }], { delimiter: ";" }));
  return { blob: await zip.generateAsync({ type: "blob", mimeType: "application/zip" }), fotos, fehlen };
}
