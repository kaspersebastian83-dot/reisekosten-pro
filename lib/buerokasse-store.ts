import { openDB, type IDBPDatabase } from "idb";
import { datensatzLesen, type KasseRecord } from "./buerokasse";
import type { DirHandleLike } from "./folder-store";

/*
 * Bürokasse im Browser – eigene Datenbank, getrennt vom persönlichen SpesenKit-Bestand („reisekosten-pro“ bleibt unberührt).
 *   DB „spesenkit-buerokasse“, Version 1
 *     buchungen  Schlüssel = id, Wert = KasseRecord (nur hinzufügen, nie ändern oder löschen)
 *     belege     Schlüssel = fileId (SHA-256 + Endung), Wert = { dataUrl }
 *     meta       buchungsgeraet (true auf dem Gerät, auf dem gebucht wird), gesendet (ISO der letzten Sicherung),
 *                ordner (Bürokasse-Ordner auf dem PC, Verzeichnis-Handle)
 */
const DB = "spesenkit-buerokasse";
let connection: Promise<IDBPDatabase> | undefined;
function db() {
  connection ??= openDB(DB, 1, {
    upgrade(database) {
      for (const store of ["buchungen", "belege", "meta"]) if (!database.objectStoreNames.contains(store)) database.createObjectStore(store);
    },
    blocking() { const current = connection; connection = undefined; void current?.then((d) => d.close()); },
    terminated() { connection = undefined; },
  }).catch((error: unknown) => { connection = undefined; throw error; });
  return connection;
}

export async function kasseLaden(): Promise<KasseRecord[]> {
  const values = await (await db()).getAll("buchungen");
  return values.map(datensatzLesen).filter((r): r is KasseRecord => !!r);
}

/** Fügt neue Datensätze in einem Schritt hinzu; vorhandene ids bleiben unverändert. Liefert die Zahl der neuen. */
export async function kasseHinzufuegen(records: KasseRecord[]) {
  const transaction = (await db()).transaction("buchungen", "readwrite");
  let neu = 0;
  for (const record of records) {
    if (await transaction.store.getKey(record.id) !== undefined) continue;
    await transaction.store.add(record, record.id); neu++;
  }
  await transaction.done;
  return neu;
}

export async function belegSpeichern(fileId: string, dataUrl: string) {
  await (await db()).put("belege", { dataUrl }, fileId);
}
export async function belegLaden(fileId: string): Promise<string> {
  const value = await (await db()).get("belege", fileId) as { dataUrl?: string } | undefined;
  return value?.dataUrl || "";
}
export async function belegVorhanden(fileId: string) {
  return (await (await db()).getKey("belege", fileId)) !== undefined;
}

export interface KasseMeta { buchungsgeraet?: boolean; gesendet?: string; ordner?: DirHandleLike }
export async function metaLaden(): Promise<KasseMeta> {
  const database = await db();
  const [buchungsgeraet, gesendet, ordner] = await Promise.all(["buchungsgeraet", "gesendet", "ordner"].map((key) => database.get("meta", key)));
  return { buchungsgeraet: buchungsgeraet === true, gesendet: typeof gesendet === "string" ? gesendet : undefined, ordner: ordner || undefined };
}
export async function metaSetzen<K extends keyof KasseMeta>(key: K, value: KasseMeta[K] | undefined) {
  const database = await db();
  if (value === undefined) await database.delete("meta", key); else await database.put("meta", value, key);
}

/** Browser bitten, die Daten nicht bei Speicherknappheit zu löschen (wirkt auf dem Handy). */
export async function dauerhaftSpeichern() {
  try { return await navigator.storage?.persist?.() ?? false; } catch { return false; }
}
