// cartridge.cafe service worker — web push (ported from Unity Chant)
const CACHE_NAME = 'cartridge-cafe-v1'

self.addEventListener('install', () => { self.skipWaiting() })

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    ))
  )
  self.clients.claim()
})

// incoming push → OS notification
self.addEventListener('push', (event) => {
  if (!event.data) return
  let data = {}
  try { data = event.data.json() } catch { data = { title: 'cartridge.cafe', body: event.data.text() } }
  const options = {
    body: data.body || 'you have a new notification',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [80, 40, 80],
    data: { url: data.url || '/' },
    tag: data.tag || 'cafe-notification',
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(data.title || 'cartridge.cafe', options))
})

// click → focus an open tab on that url, or open one
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(url) && 'focus' in c) return c.focus()
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
