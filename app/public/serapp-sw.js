/**
 * Serapp — Service Worker
 * Minimal shell caching only. Never cache API / private order data.
 *
 * Important: do NOT precache authenticated routes (e.g. /serapp/order).
 * A failed cache.addAll() aborts SW install → Chrome never fires
 * beforeinstallprompt → no "Install app" affordance.
 */

const CACHE_NAME = 'serapp-v6'
const PRECACHE = [
  '/icons/serapp-homescreen-192.png',
  '/icons/serapp-homescreen-512.png',
  '/brand/serapod-wordmark.png',
  '/serapp-manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[Serapp SW] precache skip:', url, err)
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          '<!doctype html><title>Serapp offline</title><p>You are offline. Reconnect to open Serapp.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
      ),
    )
    return
  }

  if (
    url.pathname.startsWith('/_next/static') ||
    url.pathname.startsWith('/icons') ||
    url.pathname.startsWith('/brand')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (!response.ok) return response
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          return response
        })
      }),
    )
  }
})
