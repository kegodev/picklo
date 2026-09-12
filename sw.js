const BUILD_VERSION = "8.2.2-fix4";
const CACHE = `picklo-shell-${BUILD_VERSION}`;
const SHELL = [
  "./",
  "./index.html",
  `./styles.css?v=${BUILD_VERSION}`,
  `./enhancements.css?v=${BUILD_VERSION}`,
  `./enhancements.js?v=${BUILD_VERSION}`,
  `./app.js?v=${BUILD_VERSION}`,
  `./agent-router.js?v=${BUILD_VERSION}`,
  `./cloud-ai.js?v=${BUILD_VERSION}`,
  `./runtime-policy.js?v=${BUILD_VERSION}`,
  `./supabase-client.js?v=${BUILD_VERSION}`,
  `./webllm-worker.js?v=${BUILD_VERSION}`,
  `./manifest.webmanifest?v=${BUILD_VERSION}`,
  `./version.json?v=${BUILD_VERSION}`,
  "./assets/picklo-mark.svg",
  "./assets/picklo-logo.svg",
  "./assets/apple-touch-icon.png",
  "./assets/picklo-192.png",
  "./assets/picklo-512.png",
  "./assets/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(
      SHELL.map(async (path) => {
        const response = await fetch(new Request(path, { cache: "no-store" }));
        if (response.ok) await cache.put(path, response.clone());
      })
    );
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE && /^picklo-(?:shell|v\d)/i.test(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: "PICKLO_BUILD_VERSION", version: BUILD_VERSION }));
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }
  event.respondWith(networkFirstAsset(event.request));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (!response.ok) throw new Error(`Navigation failed with ${response.status}`);
    const cache = await caches.open(CACHE);
    await cache.put("./index.html", response.clone());
    return response;
  } catch {
    return (await caches.match("./index.html")) || Response.error();
  }
}

async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  }
}


self.addEventListener("message", (event) => {
  if (event.data?.type === "PICKLO_CHECK_VERSION") {
    event.source?.postMessage?.({ type: "PICKLO_BUILD_VERSION", version: BUILD_VERSION });
  }
});
