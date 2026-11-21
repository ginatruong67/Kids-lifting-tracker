const CACHE = "kids-lifts-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./plan.json",
  "./manifest.webmanifest",
  "./robots.txt",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./exercises/arm-circles.svg",
  "./exercises/band-pull-apart.svg",
  "./exercises/band-row.svg",
  "./exercises/bird-dog.svg",
  "./exercises/bw-squat.svg",
  "./exercises/calf-raise-step.svg",
  "./exercises/calf-raise.svg",
  "./exercises/calf-stretch.svg",
  "./exercises/cat-cow.svg",
  "./exercises/chest-opener.svg",
  "./exercises/curl-2lb.svg",
  "./exercises/dead-bug.svg",
  "./exercises/dead-hang-supported.svg",
  "./exercises/easy-breathing.svg",
  "./exercises/easy-squat-rehearsal.svg",
  "./exercises/glute-bridge.svg",
  "./exercises/goblet-squat-2lb.svg",
  "./exercises/hamstring-stretch.svg",
  "./exercises/hip-flexor-stretch.svg",
  "./exercises/hip-hinge.svg",
  "./exercises/incline-pushup.svg",
  "./exercises/knee-pushup.svg",
  "./exercises/kneeling-plank.svg",
  "./exercises/march-in-place.svg",
  "./exercises/oh-press-2lb.svg",
  "./exercises/pause-band-row.svg",
  "./exercises/pause-calf-raise.svg",
  "./exercises/pause-glute-bridge.svg",
  "./exercises/pause-oh-press-2lb.svg",
  "./exercises/pause-rdl-2lb.svg",
  "./exercises/pause-squat.svg",
  "./exercises/rdl-2lb.svg",
  "./exercises/scapular-shrug.svg",
  "./exercises/single-leg-balance.svg",
  "./exercises/slow-step-up.svg",
  "./exercises/step-up-2lb.svg",
  "./exercises/step-up.svg",
  "./exercises/tempo-curl-2lb.svg",
  "./exercises/tempo-goblet-squat-2lb.svg",
  "./exercises/tempo-incline-pushup.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached || caches.match("./index.html"));
      return cached || fresh;
    })
  );
});
