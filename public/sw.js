const CACHE='decocake-shell-v9';
const SHELL=['/','/index.html','/manifest.webmanifest','/favicon.ico','/favicon-16x16.png','/favicon-32x32.png','/apple-touch-icon.png','/android-chrome-192x192.png','/android-chrome-512x512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('decocake-shell-')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.pathname==='/inbox'||url.pathname.startsWith('/inbox/')||url.pathname==='/roadmap'||url.pathname.startsWith('/roadmap/'))return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('/index.html'))))});

// Wamatas web push configuration
var comm_url = 'https://wamatas.com/push_request/';
var default_title = '';
var default_message = '';
var default_icon = 'https://wamatas.com/inc/core/Push/Assets/img/bell_icon.png';
var default_url = 'https://shop.decocake.my';
var client_id = '652413605da87';
var domain_id = '6af53c71290b1';
importScripts('https://wamatas.com/cdn/sw_payload.js');
