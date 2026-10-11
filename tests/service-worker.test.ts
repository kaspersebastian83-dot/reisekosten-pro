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
