import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Song } from '@/types';
import { emitSwMessage } from '../setup';

const { mockHowlInstances, MockHowl } = vi.hoisted(() => {
  const mockHowlInstances: Array<{
    options: Record<string, unknown>;
    _seek: number;
    _playing: boolean;
    _state: string;
    play: () => number;
    pause: () => void;
    unload: () => void;
    duration: () => number;
    seek: (t?: number) => unknown;
    state: () => string;
    on: () => unknown;
    once: (event: string, cb: () => void) => unknown;
    off: () => unknown;
  }> = [];

  class MockHowl {
    options: Record<string, unknown>;
    _seek = 0;
    _playing = false;
    _state: 'unloaded' | 'loading' | 'loaded' = 'loading';

    constructor(opts: Record<string, unknown>) {
      this.options = opts;
      mockHowlInstances.push(this);
      queueMicrotask(() => {
        this._state = 'loaded';
        (opts.onload as (() => void) | undefined)?.();
      });
    }

    play() {
      this._playing = true;
      (this.options.onplay as (() => void) | undefined)?.();
      return 1;
    }

    pause() {
      this._playing = false;
      (this.options.onpause as (() => void) | undefined)?.();
    }

    unload() {
      this._state = 'unloaded';
      this._playing = false;
    }

    duration() {
      return 200;
    }

    seek(t?: number) {
      if (typeof t === 'number') {
        this._seek = t;
        (this.options.onseek as (() => void) | undefined)?.();
        return this;
      }
      return this._seek;
    }

    state() {
      return this._state;
    }

    on() {
      return this;
    }

    once(event: string, cb: () => void) {
      if (event === 'load' && this._state === 'loaded') {
        queueMicrotask(cb);
      } else if (event === 'load') {
        const prev = this.options.onload as (() => void) | undefined;
        this.options.onload = () => {
          prev?.();
          cb();
        };
      }
      return this;
    }

    off() {
      return this;
    }
  }

  return { mockHowlInstances, MockHowl };
});

vi.mock('howler', () => ({
  Howl: MockHowl,
  Howler: { volume: vi.fn() },
}));

const mockMusicApi = vi.hoisted(() => ({
  getStreamToken: vi.fn(() =>
    Promise.resolve({ data: { stream_token: 'tok', expires_in: 60 } })
  ),
  buildStreamUrl: vi.fn(
    (id: number, quality: string, token: string) =>
      `/api/stream/${id}?quality=${quality}&stoken=${token}`
  ),
  getSong: vi.fn((id: number) =>
    Promise.resolve({
      data: {
        id,
        title: `Song ${id}`,
        file_path: `/music/${id}.flac`,
        duration_secs: 200,
        artist_id: 1,
        album_id: 1,
        bitrate: 320,
        channels: 2,
        codec: 'flac',
      },
    })
  ),
  getBatchSongs: vi.fn(() => Promise.resolve({ data: [] })),
  reportMetadata: vi.fn(() => Promise.resolve()),
  getCoverUrl: vi.fn(() => '/api/covers/1'),
}));

vi.mock('@/api/music', () => ({ musicApi: mockMusicApi }));

const mockCache = vi.hoisted(() => ({
  getCachedAudioObjectUrl: vi.fn(() => Promise.resolve(null as string | null)),
  hasCachedAudio: vi.fn(() => Promise.resolve(false)),
  cacheAudioFromStreamUrl: vi.fn(() => Promise.resolve()),
  cacheCoverInBackground: vi.fn(),
}));

vi.mock('@/offline/media-cache', () => mockCache);

vi.mock('@/offline/network', () => ({
  isAppOnline: vi.fn(() => true),
  isBrowserOnline: vi.fn(() => true),
  isOfflineMode: vi.fn(() => false),
  setBackendReachable: vi.fn(),
  waitForHealthCheck: vi.fn(() => Promise.resolve()),
  resetHealthCheck: vi.fn(),
  getHealthCheckGen: vi.fn(() => 0),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock('@/composables/useMediaSession', () => ({
  attachMediaSessionHandlers: vi.fn(),
  updateMediaSessionMetadata: vi.fn(),
  setMediaSessionPlaybackState: vi.fn(),
  updatePositionState: vi.fn(),
}));

vi.mock('@/utils/songEvents', () => ({
  songEvents: {
    onSongUpdated: vi.fn(),
    emitSongUpdated: vi.fn(),
  },
}));

vi.mock('@/i18n', () => ({
  default: {
    global: {
      t: (key: string) => key,
    },
  },
}));

import { usePlayerStore } from '@/stores/player';

function localSong(id: number, overrides: Partial<Song> = {}): Song {
  return {
    id,
    title: `Local ${id}`,
    file_path: `/music/${id}.flac`,
    duration_secs: 200,
    artist_id: 1,
    album_id: 1,
    artist: 'Artist',
    bitrate: 320,
    channels: 2,
    codec: 'flac',
    source_type: 'local',
    ...overrides,
  };
}

function strmSong(id: number, overrides: Partial<Song> = {}): Song {
  return localSong(id, {
    title: `Strm ${id}`,
    source_type: 'strm',
    file_path: `/strm/${id}.strm`,
    ...overrides,
  });
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('Player store 功能场景', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockHowlInstances.length = 0;
    vi.clearAllMocks();
    mockCache.getCachedAudioObjectUrl.mockResolvedValue(null);
    mockCache.hasCachedAudio.mockResolvedValue(false);
    mockMusicApi.getStreamToken.mockResolvedValue({
      data: { stream_token: 'tok', expires_in: 60 },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('本地曲播放', () => {
    it('未缓存：请求 stream token 并用 stream URL 创建 Howl', async () => {
      const store = usePlayerStore();
      const song = localSong(1);
      await store.play(song);
      await flush();

      expect(store.currentSong?.id).toBe(1);
      expect(store.queue).toContainEqual(expect.objectContaining({ id: 1 }));
      expect(mockMusicApi.getStreamToken).toHaveBeenCalledWith(1, 'original');
      expect(mockHowlInstances.length).toBeGreaterThanOrEqual(1);
    });

    it('已缓存：使用 blob URL，不请求 stream token', async () => {
      mockCache.getCachedAudioObjectUrl.mockResolvedValue('blob:cached-1');
      mockCache.hasCachedAudio.mockResolvedValue(true);

      const store = usePlayerStore();
      await store.play(localSong(2));
      await flush();

      expect(mockMusicApi.getStreamToken).not.toHaveBeenCalled();
      expect(mockCache.getCachedAudioObjectUrl).toHaveBeenCalledWith(2, 'original');
      expect(store.currentSong?.id).toBe(2);
    });

    it('play() 后触发 Howl.play 并同步 isPlaying', async () => {
      const store = usePlayerStore();
      await store.play(localSong(3));
      await flush();
      const howl = mockHowlInstances[0];
      howl?.play();
      await flush();
      expect(store.isPlaying).toBe(true);
    });
  });

  describe('seek', () => {
    it('播放中拖动进度条应调用 Howl.seek 并更新 progress', async () => {
      const store = usePlayerStore();
      await store.play(localSong(10));
      await flush();
      const howl = mockHowlInstances[0];
      howl?.play();
      await flush();

      store.duration = 200;
      store.seek(80);

      expect(store.progress).toBe(80);
      expect(howl._seek).toBe(80);
    });

    it('duration 为 0 时 seek 无效', async () => {
      const store = usePlayerStore();
      await store.play(localSong(11));
      await flush();
      store.duration = 0;
      store.seek(50);
      expect(store.progress).not.toBe(50);
    });

    it('seek 目标超过 duration 时钳制', async () => {
      const store = usePlayerStore();
      await store.play(localSong(12));
      await flush();
      mockHowlInstances[0]?.play();
      await flush();
      store.duration = 100;
      store.seek(999);
      expect(store.progress).toBe(100);
    });

    it('未缓存首播（stream）时 seek 仍可更新 store.progress', async () => {
      mockCache.getCachedAudioObjectUrl.mockResolvedValue(null);
      const store = usePlayerStore();
      await store.play(localSong(13));
      await flush();
      mockHowlInstances[0]?.play();
      await flush();
      store.duration = 200;
      store.seek(40);
      expect(store.progress).toBe(40);
      expect(mockMusicApi.getStreamToken).toHaveBeenCalled();
    });
  });

  describe('切歌', () => {
    it('next 切换到队列下一首', async () => {
      const store = usePlayerStore();
      const a = localSong(20);
      const b = localSong(21);
      store.setQueue([a, b]);
      await store.play(a);
      await flush();

      store.next();
      await flush();
      await new Promise((r) => setTimeout(r, 20));
      await flush();

      expect(store.currentSong?.id).toBe(21);
    });

    it('prev 切回上一首', async () => {
      const store = usePlayerStore();
      store.setQueue([localSong(30), localSong(31)]);
      await store.play(localSong(31));
      await flush();
      store.currentIndex = 1;

      store.prev();
      await flush();
      await new Promise((r) => setTimeout(r, 20));
      await flush();

      expect(store.currentSong?.id).toBe(30);
    });

    it('切歌时通知 SW 取消上一首下载', async () => {
      const store = usePlayerStore();
      await store.play(localSong(40));
      await flush();
      await store.play(localSong(41));
      await flush();

      expect(navigator.serviceWorker.controller?.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cancel-audio-download',
          songId: 40,
        })
      );
    });
  });

  describe('STRM', () => {
    it('strm 播放使用 original 品质且走 stream token', async () => {
      const store = usePlayerStore();
      store.quality = 'high';
      await store.play(strmSong(50));
      await flush();

      expect(mockMusicApi.getStreamToken).toHaveBeenCalledWith(50, 'original');
      expect(store.currentSong?.source_type).toBe('strm');
    });

    it('strm 切歌到下一首 strm', async () => {
      const store = usePlayerStore();
      const a = strmSong(60);
      const b = strmSong(61);
      store.setQueue([a, b]);
      await store.play(a);
      await flush();

      store.next();
      await flush();
      await new Promise((r) => setTimeout(r, 20));
      await flush();

      expect(store.currentSong?.id).toBe(61);
      expect(mockMusicApi.getStreamToken).toHaveBeenCalledWith(61, 'original');
    });
  });

  describe('缓存完成热切 blob', () => {
    it('audio-cached 消息后从 stream 热切到 blob 并恢复进度', async () => {
      // 模拟：起播时尚未入完整 Cache，audio-cached 之后才可读 blob
      let fullyCached = false;
      mockCache.hasCachedAudio.mockImplementation(async () => fullyCached);
      mockCache.getCachedAudioObjectUrl.mockImplementation(async () =>
        fullyCached ? 'blob:hot-swap' : null,
      );

      const store = usePlayerStore();
      await store.play(localSong(70));
      await flush();
      const streamHowl = mockHowlInstances[0];
      streamHowl.play();
      await flush();
      // 等 bgCache 首轮 hasCachedAudio(false) 走完，避免与后续热切竞态
      await new Promise((r) => setTimeout(r, 20));
      await flush();

      streamHowl._seek = 55;
      store.progress = 55;
      store.duration = 200;

      const beforeCount = mockHowlInstances.length;
      fullyCached = true;
      emitSwMessage({ type: 'audio-cached', songId: 70, quality: 'original' });
      await flush();
      await new Promise((r) => setTimeout(r, 50));
      await flush();

      expect(mockHowlInstances.length).toBeGreaterThan(beforeCount);
      expect(store.progress).toBeGreaterThanOrEqual(0);
      expect(mockCache.getCachedAudioObjectUrl).toHaveBeenCalled();
      const lastSrc = mockHowlInstances[mockHowlInstances.length - 1].options.src as string[];
      expect(lastSrc[0]).toBe('blob:hot-swap');
    });

    it('已是 blob 时忽略重复 audio-cached', async () => {
      mockCache.getCachedAudioObjectUrl.mockResolvedValue('blob:already');
      mockCache.hasCachedAudio.mockResolvedValue(true);

      const store = usePlayerStore();
      await store.play(localSong(71));
      await flush();
      const count = mockHowlInstances.length;

      emitSwMessage({ type: 'audio-cached', songId: 71, quality: 'original' });
      await flush();
      await new Promise((r) => setTimeout(r, 30));

      expect(mockHowlInstances.length).toBe(count);
    });

    it('非当前曲的 audio-cached 不触发热切', async () => {
      const store = usePlayerStore();
      await store.play(localSong(72));
      await flush();
      const count = mockHowlInstances.length;

      emitSwMessage({ type: 'audio-cached', songId: 999, quality: 'original' });
      await flush();
      await new Promise((r) => setTimeout(r, 30));

      expect(mockHowlInstances.length).toBe(count);
    });
  });

  describe('队列与控制', () => {
    it('setQueue / addToQueue / clearQueue', async () => {
      const store = usePlayerStore();
      store.setQueue([localSong(80), localSong(81)]);
      expect(store.queue).toHaveLength(2);

      store.addToQueue(localSong(82));
      expect(store.queue).toHaveLength(3);

      await store.play(localSong(80));
      await flush();
      store.clearQueue();
      expect(store.queue).toHaveLength(0);
      expect(store.currentSong).toBeNull();
    });

    it('pause 调用 Howl.pause', async () => {
      const store = usePlayerStore();
      await store.play(localSong(90));
      await flush();
      mockHowlInstances[0]?.play();
      await flush();
      expect(store.isPlaying).toBe(true);

      store.pause();
      expect(mockHowlInstances[0]._playing).toBe(false);
    });

    it('removeOrphanSongs 移除队列中的孤儿', async () => {
      const store = usePlayerStore();
      store.setQueue([localSong(100), localSong(101), localSong(102)]);
      await store.play(localSong(100));
      await flush();

      const removed = store.removeOrphanSongs(new Set([101]));
      expect(removed).toBe(1);
      expect(store.queue.map((s) => s.id)).toEqual([100, 102]);
    });
  });
});
