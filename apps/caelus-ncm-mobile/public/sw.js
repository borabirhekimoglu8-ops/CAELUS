"use strict";

const CACHE = "caelus-grounded-mobile-v7-ncm3-truth";
const CORE = ["/", "/manifest.webmanifest", "/caelus_wasm.wasm", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((windows) => Promise.all(windows.map((client) => client.navigate(client.url)))),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put("/", response.clone()));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      });
      return cached || network.catch(() => caches.match("/"));
    }),
  );
});
