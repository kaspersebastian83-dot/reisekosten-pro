// Gespeicherter Bestand aus der IndexedDB „reisekosten-pro“. Seit 1.9 liegen Belegbilder getrennt (IndexedDB
// „spesenkit-belege“, Store „belege“, Schlüssel = receipt.fileId); im Bestand ist receipt.dataUrl dann leer.
// storedState(page) setzt die Bilder wieder ein, damit Prüfungen den Inhalt vergleichen können;
// storedState(page, { raw: true }) liefert den Bestand genau wie gespeichert.
export const storedState = (page, { raw = false } = {}) => page.evaluate(async (raw) => {
  const read = (name, store, key) => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store);
      const r = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
      const keys = key === undefined ? tx.objectStore(store).getAllKeys() : null;
      tx.oncomplete = () => { db.close(); resolve(key === undefined ? Object.fromEntries(keys.result.map((k, i) => [k, r.result[i]])) : r.result); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
  const state = await read('reisekosten-pro', 'state', 'main');
  if (raw || !state) return state;
  // Die Bilddatenbank nie selbst anlegen (sonst fehlte der App später ihr Store).
  const exists = (await indexedDB.databases()).some((db) => db.name === 'spesenkit-belege');
  const images = exists ? await read('spesenkit-belege', 'belege') : {};
  const fill = (item) => { if (item?.receipt?.fileId && !item.receipt.dataUrl) item.receipt.dataUrl = images[item.receipt.fileId]?.dataUrl || ''; };
  // Absichtlich fehlerhafte Bestände (Prüfung der Fehleranzeige) unverändert lassen.
  const list = (value) => Array.isArray(value) ? value : [];
  list(state.expenses).forEach(fill); list(state.receiptInbox).forEach(fill);
  for (const snapshot of list(state.statements)) list(snapshot?.expensesSnapshot).forEach(fill);
  return state;
}, raw);

/** Datenbanken dieses Ursprungs (Name und Version), nach Namen sortiert. */
export const databases = (page) => page.evaluate(async () => (await indexedDB.databases()).map(({ name, version }) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name)));
