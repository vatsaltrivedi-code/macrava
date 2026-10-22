// Macro Budget service worker: lets the app open offline and be installed.
// Pages always come from the network first (so updates show up straight away); the last copy is the offline fallback.
// Only this site's own files are handled; logins, saved plans (Supabase), fonts and analytics go straight to the network.
const CACHE = "mb-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon.svg"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // Network first; keep one copy of the app page for offline use
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && url.pathname === "/") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); }
      return res;
    }).catch(() => caches.match(url.pathname === "/" ? "/" : req).then((r) => r || caches.match("/"))));
    return;
  }
  // Icons, manifest and other small files: cached copy if there is one, refreshed in the background
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
