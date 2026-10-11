const scopeUrl = new URL(self.registration.scope);
const CACHE_PREFIX = `reisekosten-pro:${scopeUrl.pathname}:`;
const CACHE = `${CACHE_PREFIX}__BUILD_ID__`;
// Der Produktionsbuild ergänzt alle eigenen JS-/CSS-Dateien für Offline-Starts.
const appShell = ["./", "./manifest.webmanifest", "./favicon.svg", "./icon-192.png", "./icon-512.png", /* BUILD_ASSETS */].map(
  (path) => new URL(path, scopeUrl).href,
);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(appShell)));
  // Eine laufende Sitzung behält ihre Programmversion bis alle Tabs geschlossen sind.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    // Alte 1.6.0-Caches können mehrere Pages-Unterpfade enthalten.
    if (keys.includes("reisekosten-pro-v1.6.0")) {
      const legacy = await caches.open("reisekosten-pro-v1.6.0");
      for (const request of await legacy.keys()) {
        const url = new URL(request.url);
        if (url.origin === scopeUrl.origin && url.pathname.startsWith(scopeUrl.pathname)) await legacy.delete(request);
      }
      if (!(await legacy.keys()).length) await caches.delete("reisekosten-pro-v1.6.0");
    }
    await self.clients.claim();
  })());
});

// All app tabs must hold readiness until the explicitly requested activation.
let activation = null;
self.addEventListener("message", (event) => {
  if (event.data?.type === "UPDATE_READINESS" && activation && event.data.requestId === activation.id && event.source) {
    activation.replies.set(event.source.id, event.data.ready === true);
    activation.check?.();
  }
  if (event.data?.type !== "ACTIVATE_UPDATE" || activation) return;
  // Reserve the request before matchAll yields to a concurrent click/tab.
  const pending = activation = { id: `${Date.now()}-${Math.random()}`, replies: new Map(), check: null };
  event.waitUntil((async () => {
    const appClients = async () => (await self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .filter((client) => client.url.startsWith(scopeUrl.href));
    const clients = await appClients();
    let approved = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      pending.check = () => {
        if (clients.every((client) => pending.replies.has(client.id))) {
          clearTimeout(timer); resolve(clients.every((client) => pending.replies.get(client.id)));
        }
      };
      clients.forEach((client) => client.postMessage({ type: "CAN_UPDATE", requestId: pending.id }));
      pending.check();
    });
    // A tab opened during preparation has not consented: abort and retry.
    const currentClients = await appClients();
    approved = approved && currentClients.every((client) => pending.replies.get(client.id) === true);
    const recipients = new Map([...clients, ...currentClients].map((client) => [client.id, client]));
    recipients.forEach((client) => client.postMessage({ type: approved ? "UPDATE_APPROVED" : "UPDATE_BLOCKED", requestId: pending.id }));
    activation = null;
    if (approved) await self.skipWaiting();
  })());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== scopeUrl.origin || !requestUrl.pathname.startsWith(scopeUrl.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Keep the HTML and hashed assets of this active version together.
    if (event.request.mode === "navigate") {
      const shell = await cache.match(appShell[0]);
      if (shell) return shell;
    }
    // Hash-Dateien ändern ihren Inhalt nie.
    if (requestUrl.pathname.includes("/assets/")) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(cache.put(event.request, copy));
      }
      return response;
    } catch {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") return (await cache.match(appShell[0])) || Response.error();
      return Response.error();
    }
  })());
});
