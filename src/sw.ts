/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import {
  handleSparseStreamRequest,
  fillSparseGaps,
  cancelSparseFill,
} from './sw-sparse-audio';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

// 预缓存静态资源（由 vite-plugin-pwa 注入清单，dev 模式为空数组）
const manifest = self.__WB_MANIFEST;
if (manifest.length > 0) {
  precacheAndRoute(manifest);
  const navigationHandler = createHandlerBoundToURL('/index.html');
  registerRoute(new NavigationRoute(navigationHandler, {
    denylist: [/^\/api\//],
  }));
}

// --------------- 音频流缓存 ---------------
// 完整 Cache → 206。
// progressive=1（STRM）→ 路径 B tee 流式起播 + 整文件 Cache。
// 否则 → 路径 A 稀疏补洞；闲时 fill-audio-gaps 凑整首。
const STREAM_PATH_RE = /^\/api\/stream\/(\d+)$/;

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'cancel-audio-download') {
    const songId = Number(data.songId);
    const quality = (data.quality || 'original') as string;
    if (Number.isFinite(songId)) cancelSparseFill(songId, quality);
    return;
  }

  if (data.type === 'fill-audio-gaps') {
    const songId = Number(data.songId);
    const quality = (data.quality || 'original') as string;
    const url = data.url as string;
    if (!Number.isFinite(songId) || !url) return;

    event.waitUntil(
      (async () => {
        const result = await fillSparseGaps({ songId, quality, url });
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of clients) {
          c.postMessage({
            type: 'sparse-fill-result',
            songId,
            quality,
            result,
          });
        }
      })(),
    );
  }
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(STREAM_PATH_RE);
  if (!match) return;

  event.respondWith(handleSparseStreamRequest(event, match[1], url));
});
