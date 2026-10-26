// Gemeinsame Hilfen für Browserchecks mit dem SpesenKit-Ordner (privates Browserdateisystem OPFS des Testprofils).
// Nur für Sandbox-Browser (SANDBOX_HANDLE_SHIM=1), die beim Zurücklesen eines OPFS-Ordners aus IndexedDB abstürzen:
// Ordner werden dort als Pfad gespeichert und beim Lesen durch den echten Ordner ersetzt. Ohne die Variable wie bisher.
export const handleShim = () => {
  if (typeof FileSystemDirectoryHandle === 'undefined' || typeof StorageManager === 'undefined') return;
  const paths = new WeakMap(), cache = new Map(), KEY = 'test-opfs-paths';
  const known = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const remember = (handle, path) => { paths.set(handle, path); cache.set(path, handle); const list = known(); if (!list.includes(path)) localStorage.setItem(KEY, JSON.stringify([...list, path])); };
  const getRoot = StorageManager.prototype.getDirectory;
  StorageManager.prototype.getDirectory = async function () { const root = await getRoot.call(this); if (!paths.has(root)) paths.set(root, ''); return root; };
  const getDir = FileSystemDirectoryHandle.prototype.getDirectoryHandle;
  FileSystemDirectoryHandle.prototype.getDirectoryHandle = async function (name, options) {
    const child = await getDir.call(this, name, options), parent = paths.get(this);
    if (parent !== undefined) remember(child, parent ? `${parent}/${name}` : name);
    return child;
  };
  (async () => { const root = await navigator.storage.getDirectory(); for (const p of known()) { let dir = root; try { for (const part of p.split('/')) dir = await dir.getDirectoryHandle(part); } catch { /* entfernt */ } } })();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (value && typeof value === 'object' && value.handle instanceof FileSystemHandle && paths.has(value.handle)) value = { ...value, handle: { testOpfsPath: paths.get(value.handle) } };
    return put.call(this, value, key);
  };
  const result = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result'), converted = new WeakMap();
  Object.defineProperty(IDBRequest.prototype, 'result', { configurable: true, get() {
    const value = result.get.call(this);
    if (!value || typeof value !== 'object' || !value.handle || value.handle.testOpfsPath === undefined) return value;
    if (!converted.has(value)) converted.set(value, { ...value, handle: cache.get(value.handle.testOpfsPath) });
    return converted.get(value);
  } });
};
