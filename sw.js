'use strict';
// 离线壳。VERSION 换号 = 老缓存整仓作废，所以每次改 js/css 都要把它跟着 bump。
const VERSION = 'slither-v0.1.1';

// 只预取外壳：引擎与渲染层留给网络优先那条路，免得改一版 js 就被旧缓存钉死。
const SHELL = ['./', './index.html', './css/game.css', './manifest.webmanifest',
  './icons/favicon-32.png', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  './assets/sprites/ripple-128.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 网络优先、失败退缓存：同源子资源（js/css/png）永远先拿最新的一份，
// 命中过网络才顺手回填。手工版本号 + cache-first 会把 js 钉死在旧版，
// 出新 HTML 配旧 JS 那种鬼状态就是这么来的。
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type !== 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (
        req.mode === 'navigate' ? caches.match('./index.html') : Response.error()
      )))
  );
});
