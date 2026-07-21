import { describe, it, expect } from 'vitest';
import { createEagerProgressivePump, createEagerSplitStreams } from '@/sw-sparse-audio';

function makeSource(parts: Uint8Array[], delayMs = 0): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (i >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(parts[i++]);
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength ?? 0;
  }
  return total;
}

describe('createEagerSplitStreams', () => {
  it('慢消费 client 不阻塞 cache 侧尽快读完', async () => {
    const a = new Uint8Array(1000).fill(1);
    const b = new Uint8Array(2000).fill(2);
    const ac = new AbortController();
    const { forClient, forCache, pumpDone } = createEagerSplitStreams(
      makeSource([a, b]),
      ac.signal,
      10 * 1024 * 1024,
    );

    let clientStarted = false;
    const cacheBytesP = readAll(forCache);
    // client 故意慢读：cache 侧不应被其拖住
    const clientBytesP = (async () => {
      await new Promise((r) => setTimeout(r, 30));
      clientStarted = true;
      return readAll(forClient);
    })();

    const cacheBytes = await cacheBytesP;
    // 相对顺序断言（不依赖绝对毫秒）：client 尚未开始读，cache 已读完
    expect(clientStarted).toBe(false);
    const pump = await pumpDone;
    const clientBytes = await clientBytesP;

    expect(cacheBytes).toBe(3000);
    expect(clientBytes).toBe(3000);
    expect(pump.oversize).toBe(false);
    expect(pump.totalBytes).toBe(3000);
  });

  it('超过 maxBytes 时标记 oversize', async () => {
    const big = new Uint8Array(100).fill(9);
    const ac = new AbortController();
    const { forClient, forCache, pumpDone } = createEagerSplitStreams(
      makeSource([big, big]),
      ac.signal,
      150,
    );
    // 超限后硬背压依赖 client 消费；并行排空避免挂死
    void readAll(forClient);
    await readAll(forCache);
    const pump = await pumpDone;
    expect(pump.totalBytes).toBe(200);
    expect(pump.oversize).toBe(true);
  });
});

describe('createEagerProgressivePump', () => {
  it('client cancel 后仍继续泵满并保留 cacheParts', async () => {
    const chunks = [
      new Uint8Array(500).fill(1),
      new Uint8Array(500).fill(2),
      new Uint8Array(500).fill(3),
    ];
    const ac = new AbortController();
    const { forClient, pumpDone } = createEagerProgressivePump(
      makeSource(chunks, 5),
      ac.signal,
      10 * 1024 * 1024,
    );

    const reader = forClient.getReader();
    const first = await reader.read();
    expect(first.value?.byteLength).toBe(500);
    await reader.cancel(); // 模拟 <audio> 缓冲够后 cancel 响应体

    const pump = await pumpDone;
    expect(pump.oversize).toBe(false);
    expect(pump.totalBytes).toBe(1500);
    expect(pump.cacheParts.length).toBe(3);
    const cached = pump.cacheParts.reduce(
      (n, p) => n + (p instanceof Uint8Array ? p.byteLength : 0),
      0,
    );
    expect(cached).toBe(1500);
  });
});
