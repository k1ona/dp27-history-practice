// Service worker: pre-caches every file listed in precache-manifest.json so the whole app runs offline.
// The build script replaces __VERSION__ with a content hash, so a new build installs a new cache.
const VERSION = "__VERSION__";
const CACHE = `dp27-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const res = await fetch(`precache-manifest.json?v=${VERSION}`, { cache: "no-store" });
    const manifest = await res.json();
    const cache = await caches.open(CACHE);
    // Add in small batches so one slow file does not stall the whole install on a weak connection.
    const files = manifest.files.map((f) => f.path);
    for (let i = 0; i < files.length; i += 20) {
      await cache.addAll(files.slice(i, i + 20).map((p) => new Request(p, { cache: "reload" })));
    }
    await cache.put("precache-manifest.json", new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("dp27-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the sync endpoint and anything external go to the network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = url.pathname.endsWith("/") ? new URL("index.html", url).href : url.href.split("?")[0].split("#")[0];
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      if (req.mode === "navigate") {
        const shell = await cache.match(new URL("index.html", self.registration.scope).href);
        if (shell) return shell;
      }
      return new Response("Offline and not cached.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});
