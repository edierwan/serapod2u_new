/**
 * Serapod HR — Service Worker
 *
 * Minimal caching strategy:
 *   • Cache shell assets (JS, CSS, icons) on install
 *   • Network-first for navigation requests (with offline fallback)
 *   • Cache-first for static assets (/_next/static, /icons, /images)
 *   • NEVER cache API or Supabase responses (private HR data)
 */

const CACHE_NAME = 'serapod-hr-v1'

// Shell assets to pre-cache on install
const PRECACHE = ['/hr/mobile/home']

/* ── Install ──────────────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

/* ── Activate — clean old caches ──────────────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/* ── Fetch ────────────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // ─ NEVER cache sensitive API/Supabase calls ─────────────────────
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase') ||
    event.request.method !== 'GET'
  ) {
    return // let the browser handle it normally
  }

  // ─ Navigation (HTML pages) → network-first, offline fallback ────
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache a copy for offline use
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            // Only cache HR pages
            if (url.pathname.startsWith('/hr')) {
              cache.put(event.request, clone)
            }
          })
          return response
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached || caches.match('/hr/mobile/home')),
        ),
    )
    return
  }

  // ─ Static assets → cache-first (JS bundles, CSS, icons) ────────
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/images/')
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone()
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, clone))
            return response
          }),
      ),
    )
    return
  }

  // ─ Everything else → network only ──────────────────────────────
})
