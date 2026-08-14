const CACHE='decocake-shell-v6';
const SHELL=['/','/index.html','/site.webmanifest','/manifest.webmanifest','/favicon.ico','/favicon-16x16.png','/favicon-32x32.png','/apple-touch-icon.png','/android-chrome-192x192.png','/android-chrome-512x512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('/index.html'))))});
