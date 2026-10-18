import type { DirHandleLike, FolderLink } from "./folder-store";

/*
 * Gemeinsame Datenbank der App-Familie (Projektzentrale, LabelKit, FotoKit, PlanKit, BelegKit):
 * DB „mosaik-suite“, Version 1, Store „kv“ – Vertrag unverändert übernommen. SpesenKit nutzt nur den
 * eigenen Schlüssel „spesenkit-ordner“. Die SpesenKit-Datenbank „reisekosten-pro“ bleibt unberührt.
 */
const SUITE_DB = "mosaik-suite";
const STORE = "kv";
export const LINK_KEY = "spesenkit-ordner";

let opening: Promise<IDBDatabase> | undefined;
function open() {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(SUITE_DB, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onsuccess = () => {
        // Andere Apps der Familie nie blockieren: bei einer Versionsänderung/Löschung Verbindung freigeben.
        request.result.onversionchange = () => { request.result.close(); opening = undefined; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Gemeinsamer App-Speicher ist blockiert."));
    });
    opening.catch(() => { opening = undefined; });
  }
  return opening;
}
function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest | void) {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve((request ? request.result : undefined) as T);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

/** Ohne verbundenen Ordner soll SpesenKit keine zusätzliche Datenbank anlegen – nur lesen, wenn es sie gibt. */
async function suiteExists() {
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (!list) return true;
  try { return (await list.call(indexedDB)).some((db) => db.name === SUITE_DB); } catch { return true; }
}

export const suiteLinks = {
  async get(): Promise<FolderLink | undefined> {
    if (!opening && !(await suiteExists())) return undefined;
    const value = await run<FolderLink | undefined>("readonly", (store) => store.get(LINK_KEY));
    if (!value || typeof value !== "object" || !value.handle || !Number.isInteger(value.revision) || typeof value.hash !== "string") return undefined;
    return value;
  },
  set: (link: FolderLink) => run<void>("readwrite", (store) => { store.put(link, LINK_KEY); }),
  clear: () => run<void>("readwrite", (store) => { store.delete(LINK_KEY); }),
};

/** Ein Schreibvorgang pro Browserprofil gleichzeitig (mehrere SpesenKit-Tabs). */
export function withFolderLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = (navigator as unknown as { locks?: { request(name: string, cb: () => Promise<unknown>): Promise<unknown> } }).locks;
  return locks ? (locks.request("spesenkit-ordner", task) as Promise<T>) : task();
}

type PickerWindow = Window & { showDirectoryPicker?: (options?: { mode?: "readwrite"; id?: string }) => Promise<DirHandleLike> };
export const folderSupported = () => typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
export function pickFolder() {
  return (window as PickerWindow).showDirectoryPicker!({ mode: "readwrite", id: "spesenkit-ordner" });
}
