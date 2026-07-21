/**
 * Service Worker 稀疏分片音频缓存。
 *
 * - 播放 Range 请求：只补缺失字节，写入 IndexedDB，再组装返回 206
 * - 闲时补洞：按块拉取未覆盖区间，拼满后迁入 Cache Storage
 * - 完整缓存格式与 media-cache.ts 一致：/_c/audio/{id}/{quality}
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

export const AUDIO_CACHE = 'zhiyin-audio-v1';
export const SPARSE_DB = 'zhiyin-sparse-audio';
export const SPARSE_DB_VERSION = 1;

/** 闲时补洞单次请求大小（字节）— 偏大以减少请求次数 */
export const IDLE_FILL_CHUNK = 5 * 1024 * 1024;

/** 闲时补洞最大并发（类上传分片池） */
export const IDLE_FILL_CONCURRENCY = 3;

/** 起播/seek 单次最多拉取并返回的字节（上限）。
 * 实际单次大小由浏览器 Range 决定；Chrome 播放时常只要 ~1MB，
 * 因此 Network 里仍可能看到大量 ~1MB 请求——增大本常量不会强迫浏览器一次要 5MB。 */
export const PLAY_SERVE_CHUNK = 3 * 1024 * 1024;

export type SparseMeta = {
  key: string;
  songId: number;
  quality: string;
  totalSize: number | null;
  contentType: string;
};

export type SparseChunk = {
  key: string;
  songId: number;
  quality: string;
  start: number;
  end: number; // inclusive
  data: ArrayBuffer;
};

type RangeSpec = { start: number; end: number | null };

const keyLocks = new Map<string, Promise<unknown>>();
const activeFills = new Map<string, AbortController>();
/** 路径 B：progressive eager 泵内存上限；超过则只播不缓存，避免撑爆 SW */
export const PROGRESSIVE_EAGER_MAX_BYTES = 100 * 1024 * 1024;

/** 路径 B：progressive 下载中的 AbortController（同曲仅一路） */
const activeProgressive = new Map<string, AbortController>();
/** 路径 B：当前会话世代，防止 abort 后的旧 cache 任务误写入 */
const progressiveGeneration = new Map<string, number>();

function sparseKey(songId: number | string, quality: string): string {
  return `${songId}:${quality}`;
}

function chunkKey(songId: number, quality: string, start: number): string {
  return `${songId}:${quality}:${start}`;
}

function cacheKeyPath(songId: number | string, quality: string): string {
  return `/_c/audio/${songId}/${quality}`;
}

async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const current = prev.then(() => gate);
  keyLocks.set(key, current);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (keyLocks.get(key) === current) keyLocks.delete(key);
  }
}

function openSparseDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SPARSE_DB, SPARSE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('chunks')) {
        const store = db.createObjectStore('chunks', { keyPath: 'key' });
        store.createIndex('bySong', ['songId', 'quality'], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('idb aborted'));
  });
}

async function getMeta(db: IDBDatabase, key: string): Promise<SparseMeta | undefined> {
  const tx = db.transaction('meta', 'readonly');
  const result = await idbReq(tx.objectStore('meta').get(key));
  await txDone(tx);
  return result as SparseMeta | undefined;
}

async function putMeta(db: IDBDatabase, meta: SparseMeta): Promise<void> {
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(meta);
  await txDone(tx);
}

async function deleteMeta(db: IDBDatabase, key: string): Promise<void> {
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').delete(key);
  await txDone(tx);
}

async function getChunks(
  db: IDBDatabase,
  songId: number,
  quality: string,
): Promise<SparseChunk[]> {
  const tx = db.transaction('chunks', 'readonly');
  const idx = tx.objectStore('chunks').index('bySong');
  // IDBKeyRange.only 对复合索引更稳妥
  const rows = await idbReq(idx.getAll(IDBKeyRange.only([songId, quality])));
  await txDone(tx);
  return (rows as SparseChunk[]).sort((a, b) => a.start - b.start);
}

/**
 * 重写某首歌的全部分片。
 * 注意：同一事务内不得在请求之间 await，否则事务会提前提交导致写入失败。
 */
async function replaceChunks(
  db: IDBDatabase,
  songId: number,
  quality: string,
  merged: Array<{ start: number; end: number; data: ArrayBuffer }>,
): Promise<void> {
  const readTx = db.transaction('chunks', 'readonly');
  const existingKeys = await idbReq(
    readTx.objectStore('chunks').index('bySong').getAllKeys(IDBKeyRange.only([songId, quality])),
  );
  await txDone(readTx);

  const writeTx = db.transaction('chunks', 'readwrite');
  const store = writeTx.objectStore('chunks');
  for (const k of existingKeys) {
    store.delete(k);
  }
  for (const c of merged) {
    const row: SparseChunk = {
      key: chunkKey(songId, quality, c.start),
      songId,
      quality,
      start: c.start,
      end: c.end,
      data: c.data,
    };
    store.put(row);
  }
  await txDone(writeTx);
}

function mergeRanges(
  chunks: Array<{ start: number; end: number; data: ArrayBuffer }>,
): Array<{ start: number; end: number; data: ArrayBuffer }> {
  if (chunks.length === 0) return [];
  const sorted = [...chunks].sort((a, b) => a.start - b.start || b.end - a.end);

  type Part = { start: number; data: ArrayBuffer };
  const out: Array<{ start: number; end: number; data: ArrayBuffer }> = [];
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  let parts: Part[] = [{ start: sorted[0].start, data: sorted[0].data }];

  const flush = () => {
    const size = curEnd - curStart + 1;
    const buf = new Uint8Array(size);
    for (const p of parts) {
      const offset = p.start - curStart;
      if (offset >= 0 && offset < size) {
        const len = Math.min(p.data.byteLength, size - offset);
        buf.set(new Uint8Array(p.data, 0, len), offset);
      }
    }
    out.push({ start: curStart, end: curEnd, data: buf.buffer });
  };

  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.start <= curEnd + 1) {
      parts.push({ start: n.start, data: n.data });
      curEnd = Math.max(curEnd, n.end);
    } else {
      flush();
      curStart = n.start;
      curEnd = n.end;
      parts = [{ start: n.start, data: n.data }];
    }
  }
  flush();
  return out;
}

export function findHoles(
  covered: Array<{ start: number; end: number }>,
  from: number,
  to: number,
): Array<{ start: number; end: number }> {
  if (to < from) return [];
  const holes: Array<{ start: number; end: number }> = [];
  let cursor = from;
  for (const c of covered) {
    if (c.end < cursor) continue;
    if (c.start > to) break;
    if (c.start > cursor) {
      holes.push({ start: cursor, end: Math.min(c.start - 1, to) });
    }
    cursor = Math.max(cursor, c.end + 1);
    if (cursor > to) break;
  }
  if (cursor <= to) holes.push({ start: cursor, end: to });
  return holes;
}

function parseRangeHeader(header: string | null): RangeSpec | null {
  if (!header) return { start: 0, end: null };
  const m = header.match(/bytes=(\d+)-(\d*)/);
  if (!m) return { start: 0, end: null };
  return {
    start: parseInt(m[1], 10),
    end: m[2] ? parseInt(m[2], 10) : null,
  };
}

function parseContentRange(header: string | null): { start: number; end: number; total: number | null } | null {
  if (!header) return null;
  const m = header.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!m) return null;
  return {
    start: parseInt(m[1], 10),
    end: parseInt(m[2], 10),
    total: m[3] === '*' ? null : parseInt(m[3], 10),
  };
}

async function addChunkData(
  db: IDBDatabase,
  songId: number,
  quality: string,
  start: number,
  data: ArrayBuffer,
  contentType: string,
  totalSize: number | null,
): Promise<SparseMeta> {
  const end = start + data.byteLength - 1;
  const key = sparseKey(songId, quality);
  const meta = (await getMeta(db, key)) ?? {
    key,
    songId,
    quality,
    totalSize: null,
    contentType: contentType || 'application/octet-stream',
  };
  if (totalSize != null) meta.totalSize = totalSize;
  if (contentType) meta.contentType = contentType;

  const chunks = await getChunks(db, songId, quality);
  const merged = mergeRanges([
    ...chunks.map((c) => ({ start: c.start, end: c.end, data: c.data })),
    { start, end, data },
  ]);
  await replaceChunks(db, songId, quality, merged);
  await putMeta(db, meta);
  return meta;
}

function coveredBytes(chunks: Array<{ start: number; end: number }>): number {
  return chunks.reduce((sum, c) => sum + (c.end - c.start + 1), 0);
}

export function isFullyCovered(
  chunks: Array<{ start: number; end: number }>,
  totalSize: number,
): boolean {
  if (totalSize <= 0) return false;
  const holes = findHoles(chunks, 0, totalSize - 1);
  return holes.length === 0;
}

async function assembleRange(
  chunks: SparseChunk[],
  start: number,
  end: number,
): Promise<ArrayBuffer> {
  const size = end - start + 1;
  const out = new Uint8Array(size);
  for (const c of chunks) {
    if (c.end < start || c.start > end) continue;
    const copyStart = Math.max(c.start, start);
    const copyEnd = Math.min(c.end, end);
    const srcOffset = copyStart - c.start;
    const dstOffset = copyStart - start;
    const len = copyEnd - copyStart + 1;
    out.set(new Uint8Array(c.data, srcOffset, len), dstOffset);
  }
  return out.buffer;
}

async function fetchByteRange(
  url: string,
  start: number,
  end: number | null,
  credentials: RequestCredentials,
  signal?: AbortSignal,
): Promise<{ data: ArrayBuffer; start: number; end: number; totalSize: number | null; contentType: string; status: number }> {
  const headers = new Headers();
  if (end != null) {
    headers.set('Range', `bytes=${start}-${end}`);
  } else {
    headers.set('Range', `bytes=${start}-`);
  }

  const res = await fetch(url, {
    method: 'GET',
    headers,
    credentials,
    signal,
  });

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('token_expired'), { status: res.status });
  }
  if (!res.ok && res.status !== 206) {
    throw Object.assign(new Error(`fetch_failed_${res.status}`), { status: res.status });
  }

  const buf = await res.arrayBuffer();
  const cr = parseContentRange(res.headers.get('Content-Range'));
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';

  if (res.status === 200 && !cr) {
    // 远端不支持 Range，返回了整文件
    return {
      data: buf,
      start: 0,
      end: buf.byteLength - 1,
      totalSize: buf.byteLength,
      contentType,
      status: 200,
    };
  }

  const absStart = cr?.start ?? start;
  const absEnd = cr?.end ?? absStart + buf.byteLength - 1;
  return {
    data: buf,
    start: absStart,
    end: absEnd,
    totalSize: cr?.total ?? null,
    contentType,
    status: res.status,
  };
}

async function notifyClients(message: Record<string, unknown>): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) c.postMessage(message);
}

async function migrateToFullCache(
  songId: number,
  quality: string,
  meta: SparseMeta,
  chunks: SparseChunk[],
): Promise<boolean> {
  if (meta.totalSize == null || meta.totalSize <= 0) return false;
  if (!isFullyCovered(chunks, meta.totalSize)) return false;

  const full = await assembleRange(chunks, 0, meta.totalSize - 1);
  const blob = new Blob([new Uint8Array(full)], { type: meta.contentType });
  const cache = await caches.open(AUDIO_CACHE);
  await cache.put(
    cacheKeyPath(songId, quality),
    new Response(blob, {
      headers: {
        'Content-Type': meta.contentType,
        'Content-Length': String(blob.size),
        'Accept-Ranges': 'bytes',
      },
    }),
  );

  // 清理稀疏数据
  const db = await openSparseDb();
  const key = sparseKey(songId, quality);
  await deleteMeta(db, key);
  await replaceChunks(db, songId, quality, []);

  await notifyClients({ type: 'audio-cached', songId, quality });
  return true;
}

async function tryFinalize(
  db: IDBDatabase,
  songId: number,
  quality: string,
): Promise<boolean> {
  const key = sparseKey(songId, quality);
  const meta = await getMeta(db, key);
  if (!meta?.totalSize) return false;
  const chunks = await getChunks(db, songId, quality);
  return migrateToFullCache(songId, quality, meta, chunks);
}

/**
 * 路径 B 核心：单泵从上游全速 read，同时
 * - 推给 forClient（不因 <audio> 慢读而停泵）
 * - 在 maxBytes 内累积 cacheParts 供完整写入 Cache
 *
 * 关键：`<audio>` 缓冲够后常会 cancel 响应体。此时只停止向 client 推送，
 * **不得**停上游泵，否则网络会表现为「起播后加载停缓」，且整曲无法入 Cache。
 *
 * 超过 maxBytes：丢弃 cache 意图；若 client 仍在读，对未消费积压做硬背压。
 * client 已 cancel 且已 oversize：可中止上游（两边都不再需要数据）。
 */
export function createEagerProgressivePump(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  maxBytes: number = PROGRESSIVE_EAGER_MAX_BYTES,
): {
  forClient: ReadableStream<Uint8Array>;
  pumpDone: Promise<{
    totalBytes: number;
    oversize: boolean;
    error: unknown;
    cacheParts: BlobPart[];
  }>;
} {
  type Slot = { data: Uint8Array };
  const slots: Array<Slot | null> = [];
  let clientIdx = 0;
  let closed = false;
  let err: unknown = null;
  let totalBytes = 0;
  let oversize = false;
  let clientCancelled = false;
  const cacheParts: BlobPart[] = [];
  const clientWaiters: Array<() => void> = [];
  const drainWaiters: Array<() => void> = [];

  const wakeClient = () => {
    while (clientWaiters.length) clientWaiters.shift()!();
  };
  const wakeDrain = () => {
    while (drainWaiters.length) drainWaiters.shift()!();
  };

  const unconsumedClientBytes = () => {
    let n = 0;
    for (let i = clientIdx; i < slots.length; i++) {
      const s = slots[i];
      if (s) n += s.data.byteLength;
    }
    return n;
  };

  const releaseConsumed = () => {
    // client 已读过的 slot 置空，降低峰值（cacheParts 另持有 ref直至 oversize/写完）
    for (let i = 0; i < clientIdx; i++) {
      if (slots[i]) slots[i] = null;
    }
  };

  const forClient = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (err) {
          controller.error(err);
          return;
        }
        if (clientIdx < slots.length) {
          const slot = slots[clientIdx++];
          releaseConsumed();
          wakeDrain();
          if (slot) {
            controller.enqueue(slot.data);
            return;
          }
          continue;
        }
        if (closed) {
          controller.close();
          return;
        }
        await new Promise<void>((r) => { clientWaiters.push(r); });
      }
    },
    cancel() {
      clientCancelled = true;
      // 释放未读 slot，避免切歌后仍占内存；上游泵继续为 Cache 拉完
      for (let i = clientIdx; i < slots.length; i++) slots[i] = null;
      clientIdx = slots.length;
      wakeDrain();
      wakeClient();
    },
  });

  const pumpDone = (async () => {
    const reader = source.getReader();
    let lastLogAt = Date.now();
    let lastLogBytes = 0;
    let reachedEnd = false;
    try {
      while (!signal.aborted) {
        // client 已走且不再缓存：无需继续占带宽
        if (clientCancelled && oversize) break;

        const { done, value } = await reader.read();
        if (done) {
          reachedEnd = true;
          break;
        }
        if (!value || value.byteLength === 0) continue;

        totalBytes += value.byteLength;

        if (!oversize) {
          if (totalBytes > maxBytes) {
            oversize = true;
            cacheParts.length = 0;
            console.warn('[SW progressive] eager oversize, drop cache retention', {
              totalBytes, maxBytes,
            });
            if (clientCancelled) break;
          } else {
            cacheParts.push(value as BlobPart);
          }
        }

        // 仅当页面仍在消费时才入队；cancel 后只为 cache 泵
        if (!clientCancelled) {
          slots.push({ data: value });
          wakeClient();

          // 超限后硬背压：未消费积压不得超过 maxBytes，防止内存峰值失控
          if (oversize) {
            while (
              !signal.aborted
              && !clientCancelled
              && unconsumedClientBytes() > maxBytes
            ) {
              await new Promise<void>((r) => { drainWaiters.push(r); });
            }
          }
        }

        const now = Date.now();
        if (now - lastLogAt >= 2000) {
          const dt = (now - lastLogAt) / 1000;
          const mbps = ((totalBytes - lastLogBytes) / dt / (1024 * 1024)).toFixed(2);
          console.log('[SW progressive pump]', {
            totalMB: (totalBytes / (1024 * 1024)).toFixed(2),
            mbps,
            oversize,
            clientCancelled,
            clientBacklogMB: (unconsumedClientBytes() / (1024 * 1024)).toFixed(2),
          });
          lastLogAt = now;
          lastLogBytes = totalBytes;
        }
      }
    } catch (e) {
      if (!signal.aborted) err = e;
    } finally {
      closed = true;
      wakeClient();
      wakeDrain();
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
    const incomplete = !reachedEnd || !!err || oversize;
    return {
      totalBytes,
      oversize: oversize || !reachedEnd,
      error: err,
      cacheParts: incomplete ? [] : cacheParts.slice(),
    };
  })();

  return { forClient, pumpDone };
}

/** @deprecated 测试兼容别名，内部改为 createEagerProgressivePump */
export function createEagerSplitStreams(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  maxBytes: number = PROGRESSIVE_EAGER_MAX_BYTES,
): {
  forClient: ReadableStream<Uint8Array>;
  forCache: ReadableStream<Uint8Array>;
  pumpDone: Promise<{ totalBytes: number; oversize: boolean; error: unknown }>;
} {
  const { forClient, pumpDone } = createEagerProgressivePump(source, signal, maxBytes);
  // 兼容旧测试：forCache 从 pump 结果构造只读流
  const forCache = new ReadableStream<Uint8Array>({
    start(controller) {
      void pumpDone.then((r) => {
        if (r.error) {
          controller.error(r.error);
          return;
        }
        for (const part of r.cacheParts) {
          if (part instanceof Uint8Array) controller.enqueue(part);
        }
        controller.close();
      });
    },
  });
  return {
    forClient,
    forCache,
    pumpDone: pumpDone.then(({ totalBytes, oversize, error }) => ({ totalBytes, oversize, error })),
  };
}

/**
 * 路径 B：STRM progressive — eager pump 流式起播，跳过稀疏 IDB，整文件写入 Cache。
 * 网络侧全速拉取，不受 <audio> 缓冲背压拖慢；内存峰值超过 PROGRESSIVE_EAGER_MAX_BYTES 则只播不缓存。
 */
export async function handleProgressiveStream(
  event: FetchEvent,
  songId: number,
  quality: string,
): Promise<Response> {
  const cachePath = cacheKeyPath(songId, quality);
  const key = sparseKey(songId, quality);

  try {
    const cache = await caches.open(AUDIO_CACHE);
    const cached = await cache.match(cachePath);
    if (cached) return serveFullCacheWithRange(cached, event.request);

    // 同曲只保留一路：取消旧会话，防止 token 续签/重入造成双路
    activeProgressive.get(key)?.abort();
    const ac = new AbortController();
    const gen = (progressiveGeneration.get(key) ?? 0) + 1;
    progressiveGeneration.set(key, gen);
    activeProgressive.set(key, ac);

    const isActiveSession = () =>
      !ac.signal.aborted
      && activeProgressive.get(key) === ac
      && progressiveGeneration.get(key) === gen;

    const headers = new Headers(event.request.headers);
    headers.delete('Range');

    const netRes = await fetch(event.request.url, {
      method: 'GET',
      headers,
      credentials: event.request.credentials,
      signal: ac.signal,
      // 提示中间层勿缓存残缺响应
      cache: 'no-store',
    });

    if (!netRes.ok) {
      if (activeProgressive.get(key) === ac) activeProgressive.delete(key);
      return netRes;
    }
    if (!netRes.body) {
      if (activeProgressive.get(key) === ac) activeProgressive.delete(key);
      return netRes;
    }

    const contentType = netRes.headers.get('Content-Type') || 'application/octet-stream';
    const contentLengthHeader = netRes.headers.get('Content-Length');
    const declaredLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;

    // 已知超大：不入内存队列、不写 Cache，单路直给 <audio>
    if (Number.isFinite(declaredLength) && declaredLength > PROGRESSIVE_EAGER_MAX_BYTES) {
      if (activeProgressive.get(key) === ac) activeProgressive.delete(key);
      const outHeaders = new Headers();
      outHeaders.set('Content-Type', contentType);
      outHeaders.set('Content-Length', String(declaredLength));
      console.warn('[SW progressive] file too large for eager cache, stream-only', {
        songId, quality, declaredLength,
      });
      return new Response(netRes.body, {
        status: 200,
        statusText: 'OK',
        headers: outHeaders,
      });
    }

    const { forClient, pumpDone } = createEagerProgressivePump(
      netRes.body,
      ac.signal,
      PROGRESSIVE_EAGER_MAX_BYTES,
    );

    const cacheP = (async () => {
      try {
        const pumpResult = await pumpDone;
        if (!isActiveSession()) return;
        if (pumpResult.error || pumpResult.oversize) {
          if (pumpResult.oversize) {
            console.warn('[SW progressive] skip cache (oversize)', {
              songId, quality, totalBytes: pumpResult.totalBytes,
            });
          }
          return;
        }
        const blob = new Blob(pumpResult.cacheParts, { type: contentType });
        if (blob.size <= 0) return;
        if (Number.isFinite(declaredLength) && declaredLength > 0 && blob.size !== declaredLength) {
          console.warn('[SW progressive] size mismatch, skip cache', {
            songId, quality, expected: declaredLength, actual: blob.size,
          });
          return;
        }
        if (!isActiveSession()) return;
        await cache.put(
          cachePath,
          new Response(blob, {
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(blob.size),
              'Accept-Ranges': 'bytes',
            },
          }),
        );
        if (!isActiveSession()) return;
        console.log('[SW progressive] cached', { songId, quality, size: blob.size });
        await notifyClients({ type: 'audio-cached', songId, quality });
      } catch {
        /* aborted or error */
      } finally {
        if (activeProgressive.get(key) === ac) activeProgressive.delete(key);
      }
    })();
    event.waitUntil(Promise.all([cacheP, pumpDone.catch(() => {})]));

    const outHeaders = new Headers();
    outHeaders.set('Content-Type', contentType);
    if (contentLengthHeader) outHeaders.set('Content-Length', contentLengthHeader);
    // 不设置 Accept-Ranges，降低浏览器发 Range 的动机
    // 调试标记：确认浏览器跑的是新 SW
    outHeaders.set('X-Zhiyin-Progressive', 'eager-pump-v3');

    return new Response(forClient, {
      status: 200,
      statusText: 'OK',
      headers: outHeaders,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return new Response('', { status: 499, statusText: 'Client Closed Request' });
    }
    console.warn('[SW progressive] fallback to network', err);
    return fetch(event.request);
  }
}

/**
 * 处理 /api/stream 请求：完整 Cache → 路径 B progressive / 路径 A 稀疏。
 */
export async function handleSparseStreamRequest(
  event: FetchEvent,
  songIdStr: string,
  url: URL,
): Promise<Response> {
  const songId = Number(songIdStr);
  const quality = url.searchParams.get('quality') || 'original';

  // 路径 B：STRM 主动标记 progressive=1
  if (url.searchParams.get('progressive') === '1') {
    return handleProgressiveStream(event, songId, quality);
  }

  const key = sparseKey(songId, quality);
  const cachePath = cacheKeyPath(songId, quality);

  try {
    const cache = await caches.open(AUDIO_CACHE);
    const cached = await cache.match(cachePath);
    if (cached) return serveFullCacheWithRange(cached, event.request);

    return await withKeyLock(key, async () => {
      const range = parseRangeHeader(event.request.headers.get('Range'));
      const reqStart = range?.start ?? 0;
      const reqEnd = range?.end ?? null;

      const db = await openSparseDb();
      let meta = await getMeta(db, key);
      let chunks = await getChunks(db, songId, quality);

      // 单次只服务一小段：开放 Range / 超大 Range 都截断，边下边播
      let serveEnd =
        reqEnd == null
          ? reqStart + PLAY_SERVE_CHUNK - 1
          : Math.min(reqEnd, reqStart + PLAY_SERVE_CHUNK - 1);

      if (meta?.totalSize != null) {
        if (reqStart >= meta.totalSize) {
          return new Response('', {
            status: 416,
            statusText: 'Range Not Satisfiable',
            headers: { 'Content-Range': `bytes */${meta.totalSize}` },
          });
        }
        serveEnd = Math.min(serveEnd, meta.totalSize - 1);
      }

      const holes = findHoles(
        chunks.map((c) => ({ start: c.start, end: c.end })),
        reqStart,
        serveEnd,
      );

      for (const hole of holes) {
        const fetchEnd = Math.min(hole.end, hole.start + PLAY_SERVE_CHUNK - 1);
        const fetched = await fetchByteRange(
          event.request.url,
          hole.start,
          fetchEnd,
          event.request.credentials,
        );
        meta = await addChunkData(
          db, songId, quality,
          fetched.start, fetched.data, fetched.contentType, fetched.totalSize,
        );
        // 远端不支持 Range、一次返回整文件：写入后可完整缓存
        if (fetched.status === 200 && fetched.totalSize != null) {
          chunks = await getChunks(db, songId, quality);
          await tryFinalize(db, songId, quality);
          const nowCached = await cache.match(cachePath);
          if (nowCached) return serveFullCacheWithRange(nowCached, event.request);
          break;
        }
        // 学到 totalSize 后收紧 serveEnd
        if (meta.totalSize != null) {
          serveEnd = Math.min(serveEnd, meta.totalSize - 1);
        }
      }

      chunks = await getChunks(db, songId, quality);
      meta = (await getMeta(db, key)) ?? meta;
      if (meta?.totalSize != null) {
        serveEnd = Math.min(serveEnd, meta.totalSize - 1);
      }
      await tryFinalize(db, songId, quality);

      const nowCached = await cache.match(cachePath);
      if (nowCached) return serveFullCacheWithRange(nowCached, event.request);

      const body = await assembleRange(chunks, reqStart, serveEnd);
      const total = meta?.totalSize ?? '*';
      return new Response(body, {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Content-Type': meta?.contentType || 'application/octet-stream',
          'Content-Length': String(body.byteLength),
          'Content-Range': `bytes ${reqStart}-${serveEnd}/${total}`,
          'Accept-Ranges': 'bytes',
        },
      });
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.warn('[SW sparse] fallback to network', err);
    // 稀疏逻辑失败时回退透传，保证可播
    return fetch(event.request);
  }
}

export async function serveFullCacheWithRange(
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

/**
 * 将空洞切成固定大小任务（上传分片式），供并发池消费。
 */
export function planFillTasks(
  holes: Array<{ start: number; end: number }>,
  chunkSize: number = IDLE_FILL_CHUNK,
): Array<{ start: number; end: number }> {
  const tasks: Array<{ start: number; end: number }> = [];
  for (const hole of holes) {
    let s = hole.start;
    while (s <= hole.end) {
      const e = Math.min(hole.end, s + chunkSize - 1);
      tasks.push({ start: s, end: e });
      s = e + 1;
    }
  }
  return tasks;
}

/**
 * 闲时补洞：用独立 stream URL 只拉取缺失区间，拼满后写入完整 Cache。
 * 分片任务队列 + 最大 IDLE_FILL_CONCURRENCY 并发（参考分片上传）。
 * 网络请求在锁外执行，写入 IDB 时持锁，避免阻塞播放 Range。
 */
export async function fillSparseGaps(options: {
  songId: number;
  quality: string;
  url: string;
}): Promise<'done' | 'cancelled' | 'need_token' | 'error'> {
  const { songId, quality, url } = options;
  const key = sparseKey(songId, quality);

  const cache = await caches.open(AUDIO_CACHE);
  if (await cache.match(cacheKeyPath(songId, quality))) {
    await notifyClients({ type: 'audio-cached', songId, quality });
    return 'done';
  }

  cancelSparseFill(songId, quality);
  const ac = new AbortController();
  activeFills.set(key, ac);

  try {
    // 探测 totalSize（若尚无）
    const needProbe = await withKeyLock(key, async () => {
      const db = await openSparseDb();
      const meta = await getMeta(db, key);
      return meta?.totalSize == null;
    });

    if (needProbe) {
      if (ac.signal.aborted) return 'cancelled';
      try {
        const probe = await fetchByteRange(
          url, 0, Math.min(65536, IDLE_FILL_CHUNK) - 1, 'include', ac.signal,
        );
        const done = await withKeyLock(key, async () => {
          const db = await openSparseDb();
          await addChunkData(
            db, songId, quality,
            probe.start, probe.data, probe.contentType, probe.totalSize,
          );
          if (probe.status === 200 && probe.totalSize != null) {
            return (await tryFinalize(db, songId, quality)) ? 'done' as const : 'error' as const;
          }
          return null;
        });
        if (done) return done;
      } catch (e: any) {
        if (e?.name === 'AbortError') return 'cancelled';
        if (e?.status === 401 || e?.status === 403) return 'need_token';
        return 'error';
      }
    }

    while (!ac.signal.aborted) {
      // 规划本轮任务：只取当前仍缺失的区间，切成大块
      const planned = await withKeyLock(key, async () => {
        const db = await openSparseDb();
        if (await caches.open(AUDIO_CACHE).then((c) => c.match(cacheKeyPath(songId, quality)))) {
          return { kind: 'done' as const };
        }
        const meta = await getMeta(db, key);
        if (!meta?.totalSize) return { kind: 'error' as const };

        const chunks = await getChunks(db, songId, quality);
        const covered = chunks.map((c) => ({ start: c.start, end: c.end }));
        if (isFullyCovered(covered, meta.totalSize)) {
          const ok = await tryFinalize(db, songId, quality);
          return { kind: ok ? 'done' as const : 'error' as const };
        }

        const holes = findHoles(covered, 0, meta.totalSize - 1);
        if (holes.length === 0) {
          const ok = await tryFinalize(db, songId, quality);
          return { kind: ok ? 'done' as const : 'error' as const };
        }

        return { kind: 'tasks' as const, tasks: planFillTasks(holes, IDLE_FILL_CHUNK) };
      });

      if (planned.kind === 'done') return 'done';
      if (planned.kind === 'error') return 'error';
      if (planned.kind !== 'tasks') return 'error';

      const taskQueue = planned.tasks;
      if (taskQueue.length === 0) return 'error';

      // 并发池：最多 IDLE_FILL_CONCURRENCY 个在飞请求（类上传分片）
      let cursor = 0;
      // 用对象承载状态，避免 async 回调内赋值后被控制流收窄成仅 'ok'
      const fillState: { reason: 'ok' | 'cancelled' | 'need_token' | 'error' } = { reason: 'ok' };

      const runWorker = async () => {
        while (!ac.signal.aborted && fillState.reason === 'ok') {
          const idx = cursor++;
          if (idx >= taskQueue.length) return;
          const task = taskQueue[idx];

          try {
            const fetched = await fetchByteRange(
              url, task.start, task.end, 'include', ac.signal,
            );
            await withKeyLock(key, async () => {
              const db = await openSparseDb();
              await addChunkData(
                db, songId, quality,
                fetched.start, fetched.data, fetched.contentType, fetched.totalSize,
              );
            });
          } catch (e: any) {
            if (e?.name === 'AbortError') {
              // 勿覆盖 need_token / error（由其它 worker 触发的 abort）
              if (fillState.reason === 'ok') fillState.reason = 'cancelled';
              return;
            }
            if (e?.status === 401 || e?.status === 403) {
              fillState.reason = 'need_token';
              ac.abort();
              return;
            }
            fillState.reason = 'error';
            ac.abort();
            return;
          }
        }
      };

      const workerCount = Math.min(IDLE_FILL_CONCURRENCY, taskQueue.length);
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      if (fillState.reason === 'need_token') return 'need_token';
      if (fillState.reason === 'error') return 'error';
      if (fillState.reason === 'cancelled') return 'cancelled';

      // 本轮任务跑完后尝试 finalize；未满则继续下一轮（播放路径可能又补了洞）
      const finalized = await withKeyLock(key, async () => {
        const db = await openSparseDb();
        return tryFinalize(db, songId, quality);
      });
      if (finalized) return 'done';
    }
    return 'cancelled';
  } finally {
    if (activeFills.get(key) === ac) activeFills.delete(key);
  }
}

export function cancelSparseFill(songId: number, quality: string): void {
  const key = sparseKey(songId, quality);
  const ac = activeFills.get(key);
  if (ac) {
    ac.abort();
    activeFills.delete(key);
  }
  const prog = activeProgressive.get(key);
  if (prog) {
    prog.abort();
    activeProgressive.delete(key);
  }
  // 抬升世代，使任何仍在跑的旧 cache 任务 isActiveSession 失败
  progressiveGeneration.set(key, (progressiveGeneration.get(key) ?? 0) + 1);
}

/** 供调试 / 测试导出 */
export const __sparseTestUtils = {
  findHoles,
  isFullyCovered,
  coveredBytes,
  mergeRanges,
  planFillTasks,
  createEagerSplitStreams,
  createEagerProgressivePump,
  PROGRESSIVE_EAGER_MAX_BYTES,
};
