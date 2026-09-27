// Service worker: bewaart de app op de telefoon, zodat hij ook bij slecht bereik in de stal opent.
// - Eigen bestanden: eerst het netwerk (dan heeft iedereen meteen de nieuwste versie), anders de bewaarde kopie.
// - Firebase-bibliotheek (vaste versie in de URL): uit de bewaarde kopie, want die verandert nooit.
// - Database en weerbericht gaan niet via deze cache; Firestore bewaart de gegevens zelf offline.
const CACHE = "windrakerhof-v1";
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "firebase-config.js",
  "manifest.webmanifest",
  "img/logo.jpg",
  "img/favicon.png",
  "img/apple-touch-icon.png",
  "img/icon-192.png",
  "img/icon-512.png",
  "img/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
          .then((hit) => hit || Response.error()))
    );
    return;
  }

  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }))
    );
  }
});
