import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const coverStore = new Map<string, Response>();

function stubCaches() {
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
}

function stubFetch(handler?: () => Promise<Response> | Response) {
  let count = 0;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
    count += 1;
    if (handler) return handler();
    await new Promise((r) => setTimeout(r, 15));
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    getCount: () => count,
  };
}

const lazyStub = {
  mounted() {},
  updated() {},
};

stubCaches();

describe('封面网络加载：多次请求防护', () => {
  beforeEach(() => {
    coverStore.clear();
    stubCaches();
    vi.resetModules();
  });

  it('同 coverId 并发 cacheCoverFromUrl / ensure / background 只发 1 次 fetch', async () => {
    const fetcher = stubFetch();
    const {
      cacheCoverFromUrl,
      cacheCoverInBackground,
      ensureCachedCoverObjectUrl,
    } = await import('@/offline/media-cache');

    await Promise.all([
      cacheCoverFromUrl('/api/covers/9309', 9309),
      ensureCachedCoverObjectUrl(9309),
      cacheCoverFromUrl('/api/covers/9309', 9309),
    ]);
    cacheCoverInBackground(9309);
    await flushPromises();

    expect(fetcher.getCount()).toBe(1);
    expect(fetcher.fetchMock).toHaveBeenCalledWith(
      '/api/covers/9309',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('不同 coverId 各自独立请求', async () => {
    const fetcher = stubFetch();
    const { ensureCachedCoverObjectUrl } = await import('@/offline/media-cache');

    await Promise.all([
      ensureCachedCoverObjectUrl(100),
      ensureCachedCoverObjectUrl(200),
    ]);

    expect(fetcher.getCount()).toBe(2);
  });

  it('已缓存后再次 ensure / background 不再打网络', async () => {
    const fetcher = stubFetch();
    const {
      ensureCachedCoverObjectUrl,
      cacheCoverInBackground,
    } = await import('@/offline/media-cache');

    await ensureCachedCoverObjectUrl(7);
    expect(fetcher.getCount()).toBe(1);

    await ensureCachedCoverObjectUrl(7);
    cacheCoverInBackground(7);
    await flushPromises();
    expect(fetcher.getCount()).toBe(1);
  });

  it('useCoverUrl：加载中不把 /api/covers 赋给 displayUrl（避免 img+fetch 双下载）', async () => {
    let release!: (res: Response) => void;
    const pending = new Promise<Response>((r) => {
      release = r;
    });
    const fetcher = stubFetch(() => pending);

    const { useCoverUrl } = await import('@/composables/useCoverUrl');

    const Host = defineComponent({
      setup() {
        const id = ref<number | null>(9309);
        const { displayUrl } = useCoverUrl(() => id.value);
        return { displayUrl, id };
      },
      template: '<span>{{ displayUrl }}</span>',
    });

    const w = mount(Host);
    await nextTick();
    await Promise.resolve();

    expect(w.vm.displayUrl).toBe('');
    expect(String(w.vm.displayUrl).startsWith('/api/covers')).toBe(false);

    release(
      new Response(new Uint8Array([9]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    await flushPromises();
    await nextTick();

    expect(w.vm.displayUrl).toMatch(/^blob:/);
    expect(fetcher.getCount()).toBe(1);
    w.unmount();
  });

  it('useCoverUrl：两个实例同 coverId 仍只 fetch 一次', async () => {
    const fetcher = stubFetch();
    const { useCoverUrl } = await import('@/composables/useCoverUrl');

    const Host = defineComponent({
      setup() {
        const a = useCoverUrl(() => 9309);
        const b = useCoverUrl(() => 9309);
        return { urlA: a.displayUrl, urlB: b.displayUrl };
      },
      template: '<div>{{ urlA }}|{{ urlB }}</div>',
    });

    const w = mount(Host);
    await vi.waitFor(() => {
      expect(w.vm.urlA).toMatch(/^blob:/);
      expect(w.vm.urlB).toMatch(/^blob:/);
    });

    expect(fetcher.getCount()).toBe(1);
    w.unmount();
  });

  it('CoverImage ×2 + cacheCoverInBackground 同 id：网络仅 1 次', async () => {
    const fetcher = stubFetch();
    const { cacheCoverInBackground } = await import('@/offline/media-cache');
    const CoverImage = (await import('@/components/common/CoverImage.vue')).default;

    const mountOpts = {
      props: { coverId: 9309, lazy: false as const },
      global: { directives: { lazy: lazyStub } },
    };
    const w1 = mount(CoverImage, mountOpts);
    const w2 = mount(CoverImage, mountOpts);
    cacheCoverInBackground(9309);

    await vi.waitFor(() => {
      expect(fetcher.getCount()).toBe(1);
    });

    await flushPromises();
    const imgs = [...w1.findAll('img'), ...w2.findAll('img')];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      const src = img.attributes('src') || '';
      expect(src.startsWith('/api/covers')).toBe(false);
      expect(src).toMatch(/^blob:/);
    }

    w1.unmount();
    w2.unmount();
  });

  it('fetch 失败时才回退到 /api/covers 网络 URL', async () => {
    stubFetch(async () => new Response('', { status: 404 }));
    const { useCoverUrl } = await import('@/composables/useCoverUrl');

    const Host = defineComponent({
      setup() {
        const { displayUrl } = useCoverUrl(() => 404);
        return { displayUrl };
      },
      template: '<span>{{ displayUrl }}</span>',
    });
    const w = mount(Host);
    await vi.waitFor(() => {
      expect(w.vm.displayUrl).toBe('/api/covers/404');
    });
    w.unmount();
  });
});
