/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

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

// --------------- 音频流缓存（核心逻辑）---------------
// 使用原生 fetch 事件拦截以确保捕获 <audio> 元素请求。
// 去掉 Range 头拿完整 200 响应，clone 一份写入 Cache Storage，
// 原始响应交给播放器。后续 seek 产生的 Range 请求直接从缓存切片返回 206。

const AUDIO_CACHE = 'zhiyin-audio-v1';
const STREAM_PATH_RE = /^\/api\/stream\/(\d+)$/;
const pendingCaches = new Map<string, Promise<void>>();
const activeDownloads = new Map<string, AbortController>();

// 监听客户端取消下载指令
self.addEventListener('message', (event) => {
  if (event.data?.type === 'cancel-audio-download') {
    const { songId, quality } = event.data;
    const key = `/_c/audio/${songId}/${quality || 'original'}`;
    const ac = activeDownloads.get(key);
    if (ac) {
      ac.abort();
      activeDownloads.delete(key);
    }
  }
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(STREAM_PATH_RE);
  if (!match) return;

  event.respondWith(handleStreamRequest(event, match[1], url));
});

async function handleStreamRequest(
  event: FetchEvent,
  songId: string,
  url: URL,
): Promise<Response> {
  const quality = url.searchParams.get('quality') || 'original';
  const cacheKey = `/_c/audio/${songId}/${quality}`;

  try {
    const cache = await caches.open(AUDIO_CACHE);

    // 1. 命中缓存 → 支持 Range 切片返回
    const cached = await cache.match(cacheKey);
    if (cached) return serveWithRange(cached, event.request);

    // 2. 有同一首歌正在下载/写入 → 等待完成后从缓存返回（去重核心）
    const pending = pendingCaches.get(cacheKey);
    if (pending) {
      await pending;
      const nowCached = await cache.match(cacheKey);
      if (nowCached) return serveWithRange(nowCached, event.request);
    }

    // 3. 未命中且无进行中请求 → 去掉 Range 头拿完整响应
    const fetchHeaders = new Headers(event.request.headers);
    fetchHeaders.delete('Range');

    const ac = new AbortController();
    activeDownloads.set(cacheKey, ac);

    const response = await fetch(event.request.url, {
      method: 'GET',
      headers: fetchHeaders,
      credentials: event.request.credentials,
      signal: ac.signal,
    });

    if (!response.ok) {
      activeDownloads.delete(cacheKey);
      return response;
    }

    // 4. clone → 后台写入缓存，并注册到 pendingCaches 供去重
    const cloneForCache = response.clone();
    const cacheP = cache.put(cacheKey, cloneForCache)
      .then(() => {
        self.clients.matchAll().then(clients => {
          clients.forEach(c =>
            c.postMessage({ type: 'audio-cached', songId: Number(songId), quality }),
          );
        });
      })
      .catch(() => {})
      .finally(() => {
        pendingCaches.delete(cacheKey);
        activeDownloads.delete(cacheKey);
      });
    pendingCaches.set(cacheKey, cacheP);
    event.waitUntil(cacheP);

    return response;
  } catch {
    return fetch(event.request);
  }
}

async function serveWithRange(
  cached: Response,
  request: Request,
): Promise<Response> {
  const rangeHeader = request.headers.get('Range');
  if (!rangeHeader) return cached;

  const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!rangeMatch) return cached;

  const blob = await cached.blob();
  const totalSize = blob.size;
  const start = parseInt(rangeMatch[1], 10);
  const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : totalSize - 1;

  if (start >= totalSize) {
    return new Response('', {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { 'Content-Range': `bytes */${totalSize}` },
    });
  }

  const actualEnd = Math.min(end, totalSize - 1);
  const sliced = blob.slice(start, actualEnd + 1);
  const contentType =
    cached.headers.get('Content-Type') || 'application/octet-stream';

  return new Response(sliced, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(sliced.size),
      'Content-Range': `bytes ${start}-${actualEnd}/${totalSize}`,
      'Accept-Ranges': 'bytes',
    },
  });
}
