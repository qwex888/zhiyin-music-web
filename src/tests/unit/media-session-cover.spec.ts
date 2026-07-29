import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';

const ensureCachedCoverObjectUrl = vi.fn();

vi.mock('@/offline/media-cache', () => ({
  ensureCachedCoverObjectUrl: (...args: unknown[]) => ensureCachedCoverObjectUrl(...args),
}));

describe('updateMediaSessionMetadata 封面', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureCachedCoverObjectUrl.mockReset();
    ensureCachedCoverObjectUrl.mockResolvedValue('blob:cover-1');

    const mediaSession = {
      metadata: null as MediaMetadata | null,
      playbackState: 'none',
      setActionHandler: vi.fn(),
      setPositionState: vi.fn(),
    };
    Object.defineProperty(globalThis.navigator, 'mediaSession', {
      configurable: true,
      value: mediaSession,
    });
    // jsdom 可能无 MediaMetadata
    if (typeof MediaMetadata === 'undefined') {
      (globalThis as any).MediaMetadata = class MediaMetadata {
        title: string;
        artist: string;
        album: string;
        artwork: MediaImage[];
        constructor(init: MediaMetadataInit) {
          this.title = init.title ?? '';
          this.artist = init.artist ?? '';
          this.album = init.album ?? '';
          this.artwork = (init.artwork as MediaImage[]) ?? [];
        }
      };
    }
  });

  it('不使用 /api/covers 网络 URL，只用 ensure 得到的 blob:', async () => {
    const { updateMediaSessionMetadata } = await import('@/composables/useMediaSession');
    updateMediaSessionMetadata({
      id: 1,
      title: 'T',
      cover_id: 9309,
      artist: 'A',
      album: 'B',
    } as any);

    await flushPromises();

    expect(ensureCachedCoverObjectUrl).toHaveBeenCalledWith(9309);
    const meta = (navigator as any).mediaSession.metadata as MediaMetadata;
    expect(meta.artwork?.length).toBeGreaterThan(0);
    for (const art of meta.artwork ?? []) {
      expect(art.src).toMatch(/^blob:/);
      expect(art.src.includes('/api/covers')).toBe(false);
    }
  });

  it('切歌后旧封面异步结果不会写回', async () => {
    let resolveFirst!: (v: string) => void;
    ensureCachedCoverObjectUrl
      .mockImplementationOnce(
        () => new Promise<string>((r) => { resolveFirst = r; }),
      )
      .mockResolvedValueOnce('blob:cover-2');

    const { updateMediaSessionMetadata } = await import('@/composables/useMediaSession');

    updateMediaSessionMetadata({ id: 1, title: 'Old', cover_id: 1 } as any);
    updateMediaSessionMetadata({ id: 2, title: 'New', cover_id: 2 } as any);
    await flushPromises();

    resolveFirst('blob:cover-stale');
    await flushPromises();

    const meta = (navigator as any).mediaSession.metadata as MediaMetadata;
    expect(meta.title).toBe('New');
    expect(meta.artwork?.[0]?.src).toBe('blob:cover-2');
  });
});
