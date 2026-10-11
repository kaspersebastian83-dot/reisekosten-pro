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
