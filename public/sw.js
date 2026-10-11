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

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== scopeUrl.origin || !requestUrl.pathname.startsWith(scopeUrl.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Hash-Dateien ändern ihren Inhalt nie; der Startbildschirm bleibt netzwerkaktuell.
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
