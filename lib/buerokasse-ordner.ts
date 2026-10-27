import { abgeschlosseneMonate, datensatzDatei, datensatzLesen, kassenbuchCsv, type KasseRecord } from "./buerokasse";
import { ensureDir, fileExists, openDir, readFileText, writeNewFile, type DirHandleLike } from "./folder-store";
import { dataUrlFile, fileDataUrl } from "./receipt-images";

/*
 * Bürokasse-Ordner auf dem Terminal-Laufwerk (nur am PC, Chrome/Edge):
 *   <gewählter Ordner>/Bürokasse/Buchungen/<Jahr>/<Nr>_<Art>_<id>.json   jeder Datensatz einzeln, wird nie überschrieben
 *   <gewählter Ordner>/Bürokasse/Belege/<Fingerabdruck>.jpg              Belegbilder, je Inhalt einmal
 *   <gewählter Ordner>/Bürokasse/Abschlüsse/<Jahr>/<Jahr-Monat>/         Kassenbuch_<Jahr-Monat>.pdf und .csv je abgeschlossenem Monat
 * Heißt der gewählte Ordner selbst „Bürokasse“, wird er direkt verwendet.
 */
export const KASSE_ORDNER = "Bürokasse";
const BUCHUNGEN = "Buchungen", BELEGE = "Belege", ABSCHLUESSE = "Abschlüsse";

export async function kasseOrdner(chosen: DirHandleLike) {
  return chosen.name === KASSE_ORDNER ? chosen : ensureDir(chosen, [KASSE_ORDNER]);
}

/** Schreibzugriff sicherstellen (fragt im Browser nach, wenn nötig – nur nach einem Klick aufrufen). */
export async function ordnerZugriff(handle: DirHandleLike, fragen = true) {
  const mode = { mode: "readwrite" as const };
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission(mode)) === "granted") return true;
  return fragen && !!handle.requestPermission && (await handle.requestPermission(mode)) === "granted";
}

export interface OrdnerBericht { buchungen: number; belege: number; ablage: string[]; fehlendeBelege: number }

/**
 * Legt alle Datensätze und Belege ab, die im Ordner noch fehlen, und für jeden abgeschlossenen Monat das Kassenbuch
 * (PDF und CSV), falls noch nicht vorhanden. Vorhandene Dateien werden nie überschrieben.
 */
export async function ordnerSchreiben(root: DirHandleLike, records: KasseRecord[], beleg: (fileId: string) => Promise<string>,
  pdf: (monat: string) => Promise<Blob>): Promise<OrdnerBericht> {
  const bericht: OrdnerBericht = { buchungen: 0, belege: 0, ablage: [], fehlendeBelege: 0 };
  const belege = await ensureDir(root, [BELEGE]);
  for (const fileId of new Set(records.filter((r) => r.beleg).map((r) => r.beleg!.fileId))) {
    if (await fileExists(belege, fileId)) continue;
    const dataUrl = await beleg(fileId);
    const file = dataUrl ? dataUrlFile(dataUrl) : null;
    if (!file) { bericht.fehlendeBelege++; continue; }
    if (await writeNewFile(belege, fileId, new Blob([file.bytes as BlobPart], { type: file.mime })) === "written") bericht.belege++;
  }
  // Belege vor den Buchungen: eine abgelegte Buchung zeigt nach Möglichkeit nie auf ein fehlendes Bild.
  for (const record of records) {
    const dir = await ensureDir(root, [BUCHUNGEN, record.datum.slice(0, 4)]);
    if (await writeNewFile(dir, datensatzDatei(record), JSON.stringify(record, null, 1)) === "written") bericht.buchungen++;
  }
  for (const monat of [...abgeschlosseneMonate(records)].sort()) {
    const dir = await ensureDir(root, [ABSCHLUESSE, monat.slice(0, 4), monat]);
    const name = `Kassenbuch_${monat}`;
    if (await writeNewFile(dir, `${name}.csv`, new Blob([kassenbuchCsv(records, monat)], { type: "text/csv;charset=utf-8" })) === "written") bericht.ablage.push(`${name}.csv`);
    if (await writeNewFile(dir, `${name}.pdf`, () => pdf(monat)) === "written") bericht.ablage.push(`${name}.pdf`);
  }
  return bericht;
}

/** Alle gültigen Datensätze aus dem Ordner (z. B. am neuen PC). Ungültige Dateien werden übersprungen und gezählt. */
export async function ordnerLesen(root: DirHandleLike) {
  const records: KasseRecord[] = [];
  let ungueltig = 0;
  const buchungen = await openDir(root, [BUCHUNGEN]);
  if (!buchungen?.values) return { records, ungueltig };
  for await (const jahr of buchungen.values()) {
    if (jahr.kind !== "directory" || !/^\d{4}$/.test(jahr.name)) continue;
    const dir = await openDir(buchungen, [jahr.name]);
    if (!dir?.values) continue;
    for await (const entry of dir.values()) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
      const text = await readFileText(dir, [], entry.name);
      let record: KasseRecord | null = null;
      try { record = text ? datensatzLesen(JSON.parse(text)) : null; } catch { record = null; }
      if (record && datensatzDatei(record) === entry.name) records.push(record); else ungueltig++;
    }
  }
  return { records, ungueltig };
}

/** Belegbild aus dem Ordner (nur, wenn der Inhalt zum Fingerabdruck passt). */
export async function ordnerBeleg(root: DirHandleLike, fileId: string) {
  const dir = await openDir(root, [BELEGE]);
  if (!dir) return "";
  try {
    const file = await (await dir.getFileHandle(fileId)).getFile();
    if (!file.arrayBuffer) return "";
    return fileDataUrl(fileId, new Uint8Array(await file.arrayBuffer())) || "";
  } catch { return ""; }
}
