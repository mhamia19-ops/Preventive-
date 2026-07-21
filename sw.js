// MaintOS service worker — caches the app shell so it can load with zero
// connectivity after the first successful visit. Only active when the app
// is served over http(s)/localhost (browsers disallow service workers on
// file:// pages).
const CACHE_NAME = "maintos-cache-v5";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
];
// Precompute absolute URLs so fetch events (which always carry absolute
// URLs) can be matched exactly against CORE_ASSETS.
const CORE_ASSET_URLS = CORE_ASSETS.map((a) => new URL(a, self.location.href).href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => {}) // don't fail install if e.g. the CDN is unreachable
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first, but ONLY for the exact app-shell files listed above.
// Everything else — most importantly every Supabase call (REST, Realtime,
// Auth, Storage, Functions) — is intentionally left untouched and goes
// straight to the network like normal. Caching those was the earlier bug:
// it made newly-added lines/machines/people invisible until a reload,
// because the app's own re-fetch after saving was being served a stale
// cached snapshot instead of hitting the database.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!CORE_ASSET_URLS.includes(event.request.url)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

/* ============================================================
   PUSH NOTIFICATIONS
============================================================ */
self.addEventListener("push", (event) => {
  let data = { title: "MaintOS", body: "" };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "MaintOS", {
      body: data.body || "",
      tag: "maintos-notification",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});
