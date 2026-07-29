import { beforeEach, describe, expect, it, vi } from 'vitest';

const coverStore = new Map<string, Response>();

vi.stubGlobal('caches', {
  open: vi.fn(async () => ({
    match: vi.fn(async (key: string) => {
      const stored = coverStore.get(key);
      return stored ? stored.clone() : undefined;
    }),
    put: vi.fn(async (key: string, res: Response) => {
      coverStore.set(key, res.clone());
    }),
    delete: vi.fn(async (key: string) => coverStore.delete(key)),
  })),
  delete: vi.fn(async () => true),
});

describe('cover cache dedupe', () => {
  beforeEach(() => {
    coverStore.clear();
    vi.stubGlobal('caches', {
      open: vi.fn(async () => ({
        match: vi.fn(async (key: string) => {
          const stored = coverStore.get(key);
          return stored ? stored.clone() : undefined;
        }),
        put: vi.fn(async (key: string, res: Response) => {
          coverStore.set(key, res.clone());
        }),
        delete: vi.fn(async (key: string) => coverStore.delete(key)),
      })),
      delete: vi.fn(async () => true),
    });
  });

  it('同 coverId 并发 cacheCoverFromUrl 只发一次网络请求', async () => {
    const { cacheCoverFromUrl } = await import('@/offline/media-cache');
    let fetches = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetches += 1;
        await new Promise((r) => setTimeout(r, 30));
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }),
    );

    await Promise.all([
      cacheCoverFromUrl('/api/covers/9309', 9309),
      cacheCoverFromUrl('/api/covers/9309', 9309),
      cacheCoverFromUrl('/api/covers/9309', 9309),
    ]);

    expect(fetches).toBe(1);
  });

  it('ensureCachedCoverObjectUrl 返回 blob: 且不重复 fetch', async () => {
    const { ensureCachedCoverObjectUrl, cacheCoverFromUrl } = await import('@/offline/media-cache');
    let fetches = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetches += 1;
        return new Response(new Uint8Array([9, 9]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }),
    );

    const a = await ensureCachedCoverObjectUrl(42);
    const b = await ensureCachedCoverObjectUrl(42);
    await cacheCoverFromUrl('/api/covers/42', 42);

    expect(a).toMatch(/^blob:/);
    expect(b).toMatch(/^blob:/);
    expect(fetches).toBe(1);
  });
});
