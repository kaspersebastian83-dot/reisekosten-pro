import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

it("löscht beim Aktivieren nur App-Caches des eigenen Unterpfads", async () => {
  const deleted: string[] = [];
  const legacyRequests = [new Request("https://example.test/reisekosten-pro/"), new Request("https://example.test/other-repo/")];
  const keys = ["other-app", "reisekosten-pro:/reisekosten-pro/:old", "reisekosten-pro:/other-repo/:old", "reisekosten-pro:/reisekosten-pro/:__BUILD_ID__", "reisekosten-pro-v1.6.0"];
  const handlers: Record<string, (event: { waitUntil: (promise: Promise<unknown>) => void }) => void> = {};
  const legacy = {
    keys: async () => [...legacyRequests],
    delete: async (request: Request) => { legacyRequests.splice(legacyRequests.indexOf(request), 1); },
  };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, Response,
    self: { registration: { scope: "https://example.test/reisekosten-pro/" }, clients: { claim: async () => undefined }, addEventListener: (name: string, handler: typeof handlers[string]) => { handlers[name] = handler; } },
    caches: { keys: async () => keys, delete: async (key: string) => { deleted.push(key); }, open: async () => legacy },
  });
  let completed: Promise<unknown> = Promise.resolve();
  handlers.activate({ waitUntil: (promise) => { completed = promise; } });
  await completed;
  expect(deleted).toEqual(["reisekosten-pro:/reisekosten-pro/:old"]);
  expect(legacyRequests.map((request) => request.url)).toEqual(["https://example.test/other-repo/"]);
});

it("liefert die zur aktiven Version gehörende HTML-Shell auch bei neuer Netzwerkversion", async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cached = new Response("active shell");
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, Response,
    self: { registration: { scope: "https://example.test/reisekosten-pro/" }, addEventListener: (name: string, fn: typeof handlers[string]) => handlers[name] = fn },
    caches: { open: async () => ({ match: async () => cached }) },
    fetch: async () => { throw Error("Network must not replace the active shell"); },
  });
  let response = Promise.resolve(new Response());
  handlers.fetch({ request: { method: "GET", url: "https://example.test/reisekosten-pro/", mode: "navigate" }, respondWith: (p: Promise<Response>) => response = p });
  expect(await (await response).text()).toBe("active shell");
});

it.each([true, false])("aktiviert ein Update nur nach Zustimmung aller App-Tabs: %s", async (ready) => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const notifications: string[] = [];
  let skipped = 0;
  const client = { id: "tab", url: "https://example.test/reisekosten-pro/", postMessage(data: { type: string; requestId?: string }) {
    notifications.push(data.type);
    if (data.type === "CAN_UPDATE") queueMicrotask(() => handlers.message({ source: client, data: { type: "UPDATE_READINESS", requestId: data.requestId, ready } }));
  } };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, Response, setTimeout, clearTimeout,
    self: { registration: { scope: "https://example.test/reisekosten-pro/" }, clients: { matchAll: async () => [client] }, skipWaiting: async () => skipped++, addEventListener: (name: string, fn: typeof handlers[string]) => handlers[name] = fn },
  });
  let complete = Promise.resolve();
  handlers.message({ data: { type: "ACTIVATE_UPDATE" }, waitUntil: (p: Promise<void>) => complete = p });
  await complete;
  expect(skipped).toBe(ready ? 1 : 0);
  expect(notifications).toEqual(["CAN_UPDATE", ready ? "UPDATE_APPROVED" : "UPDATE_BLOCKED"]);
});

it("bricht ab, wenn während der Bereitschaftsprüfung ein neuer App-Tab geöffnet wird", async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const notices: string[] = [];
  let skipped = 0, scans = 0;
  const original = { id: "original", url: "https://example.test/reisekosten-pro/", postMessage(data: { type: string; requestId?: string }) {
    notices.push(data.type);
    if (data.type === "CAN_UPDATE") queueMicrotask(() => handlers.message({ source: original, data: { type: "UPDATE_READINESS", requestId: data.requestId, ready: true } }));
  } };
  const newcomer = { id: "new", url: original.url, postMessage(data: { type: string }) { notices.push(`new:${data.type}`); } };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, Response, setTimeout, clearTimeout,
    self: { registration: { scope: "https://example.test/reisekosten-pro/" }, clients: { matchAll: async () => ++scans === 1 ? [original] : [original, newcomer] }, skipWaiting: async () => skipped++, addEventListener: (name: string, fn: typeof handlers[string]) => handlers[name] = fn },
  });
  let complete = Promise.resolve();
  handlers.message({ data: { type: "ACTIVATE_UPDATE" }, waitUntil: (p: Promise<void>) => complete = p });
  await complete;
  expect(skipped).toBe(0);
  expect(notices).toEqual(["CAN_UPDATE", "UPDATE_BLOCKED", "new:UPDATE_BLOCKED"]);
});

// Nach einem Deploy darf die neue Version nie die alte index.html aus dem HTTP-Cache des Browsers übernehmen:
// Sie nennt Programmdateien, die auf GitHub Pages schon gelöscht sind (404 → „Die Anwendung konnte nicht geladen werden“).
const SCOPE = "https://example.test/reisekosten-pro/";
const shellHtml = (asset: string) => `<script type="module" crossorigin src="./assets/${asset}"></script><link rel="stylesheet" crossorigin href="./assets/index-X.css">`;
function swMitCaches(stores: Record<string, Map<string, string>>, network: (url: string) => string, extra: Record<string, unknown> = {}) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const requests: { url: string; cache?: string }[] = [];
  const store = (name: string) => (stores[name] ??= new Map());
  const cacheApi = (name: string) => ({
    addAll: async (list: Request[]) => { for (const r of list) { requests.push({ url: r.url, cache: r.cache }); store(name).set(r.url, network(r.url)); } },
    match: async (key: string | Request) => { const v = store(name).get(typeof key === "string" ? key : key.url); return v == null ? undefined : new Response(v); },
    keys: async () => [...store(name).keys()].map((u) => new Request(u)),
  });
  const calls = { skipWaiting: 0, navigated: [] as string[] };
  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8")
    .replace("__BUILD_ID__", "neu").replace("/* BUILD_ASSETS */", '"./assets/index-NEU.js", "./assets/index-X.css"');
  vm.runInNewContext(source, {
    URL, Response, Request,
    self: { registration: { scope: SCOPE }, skipWaiting: async () => { calls.skipWaiting++; },
      clients: { claim: async () => undefined, matchAll: async () => [{ url: SCOPE, navigate: async (u: string) => { calls.navigated.push(u); } }] },
      addEventListener: (n: string, fn: (event: unknown) => void) => { handlers[n] = fn; } },
    caches: { open: async (n: string) => cacheApi(n), keys: async () => Object.keys(stores), delete: async (n: string) => { delete stores[n]; return true; } },
    ...extra,
  });
  const run = async (name: string) => { let p: Promise<unknown> = Promise.resolve(); handlers[name]({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
  return { run, requests, calls, stores };
}
const neuesNetz = (url: string) => (url === SCOPE ? shellHtml("index-NEU.js") : "datei");

it("lädt die App-Shell bei der Installation am HTTP-Cache vorbei", async () => {
  const sw = swMitCaches({}, neuesNetz);
  await sw.run("install");
  expect(sw.requests.find((r) => r.url === SCOPE)?.cache).toBe("reload");
  expect(sw.requests.every((r) => r.cache === "reload")).toBe(true);
  expect(sw.calls.skipWaiting).toBe(0);
});

it("verwirft eine Installation, deren HTML-Shell nicht zu den Programmdateien passt", async () => {
  const sw = swMitCaches({}, (url) => (url === SCOPE ? shellHtml("index-ALT.js") : "datei"));
  await expect(sw.run("install")).rejects.toThrow(/passt nicht/);
  expect(Object.keys(sw.stores)).not.toContain("reisekosten-pro:/reisekosten-pro/:neu");
});

it("ersetzt eine laufende kaputte Version sofort und lädt ihre Tabs nach der Aktivierung neu", async () => {
  // So sah es bei SpesenKit 1.7.0 aus: alte Shell, deren Programmdateien es nicht mehr gibt
  const kaputt = new Map([[SCOPE, shellHtml("index-ALT.js")], [SCOPE + "assets/index-NEU.js", "datei"]]);
  const sw = swMitCaches({ "reisekosten-pro:/reisekosten-pro/:kaputt": kaputt }, neuesNetz);
  await sw.run("install");
  expect(sw.calls.skipWaiting).toBe(1);
  await sw.run("activate");
  await new Promise((r) => setTimeout(r, 0));
  expect(Object.keys(sw.stores)).toEqual(["reisekosten-pro:/reisekosten-pro/:neu"]);
  expect(sw.calls.navigated).toEqual([SCOPE]);
});

it("lässt eine intakte laufende Version weiterlaufen, bis alle Tabs zustimmen", async () => {
  const intakt = new Map([[SCOPE, shellHtml("index-ALT.js")], [SCOPE + "assets/index-ALT.js", "datei"], [SCOPE + "assets/index-X.css", "datei"]]);
  const sw = swMitCaches({ "reisekosten-pro:/reisekosten-pro/:alt": intakt }, neuesNetz);
  await sw.run("install");
  expect(sw.calls.skipWaiting).toBe(0);
  await sw.run("activate");
  await new Promise((r) => setTimeout(r, 0));
  expect(sw.calls.navigated).toEqual([]);
});
