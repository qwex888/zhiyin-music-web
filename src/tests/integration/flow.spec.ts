import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useLibraryStore } from '@/stores/library';
import { usePlayerStore } from '@/stores/player';
import type { Song } from '@/types';

const mockMusicApi = vi.hoisted(() => ({
  getSongs: vi.fn(),
  getAlbums: vi.fn(),
  getArtists: vi.fn(),
  getSong: vi.fn((id: number) =>
    Promise.resolve({
      data: {
        id,
        title: `Song ${id}`,
        file_path: 'path',
        duration_secs: 180,
        artist_id: 1,
        album_id: 1,
        bitrate: 320,
        channels: 2,
        codec: 'flac',
      },
    })
  ),
  getStreamToken: vi.fn(() => Promise.resolve({ data: { stream_token: 'test-token', expires_in: 60 } })),
  buildStreamUrl: vi.fn((id: number, quality: string, token: string) => `/api/stream/${id}?quality=${quality}&stoken=${token}`),
  reportMetadata: vi.fn(() => Promise.resolve()),
  getBatchSongs: vi.fn(() => Promise.resolve({ data: [] })),
}));

vi.mock('@/api/music', () => ({
  musicApi: mockMusicApi,
}));

vi.mock('@/offline/network', () => ({
  isAppOnline: vi.fn(() => true),
  isBrowserOnline: vi.fn(() => true),
  isOfflineMode: vi.fn(() => false),
  setBackendReachable: vi.fn(),
}));

vi.mock('@/offline/media-cache', () => ({
  getCachedAudioObjectUrl: vi.fn(() => Promise.resolve(null)),
  hasCachedAudio: vi.fn(() => Promise.resolve(false)),
  cacheAudioFromStreamUrl: vi.fn(() => Promise.resolve()),
  cacheCoverInBackground: vi.fn(),
}));

vi.mock('@/offline/library-query', () => ({
  querySongs: vi.fn((params: unknown) =>
    mockMusicApi.getSongs(params).then((r: { data: unknown }) => r.data)
  ),
  queryAlbums: vi.fn((params: unknown) =>
    mockMusicApi.getAlbums(params).then((r: { data: unknown }) => r.data)
  ),
  queryArtists: vi.fn((params: unknown) =>
    mockMusicApi.getArtists(params).then((r: { data: unknown }) => r.data)
  ),
  queryBatchSongs: vi.fn(),
}));

vi.mock('@/offline/db', () => ({
  offlineDb: { artists: { toArray: vi.fn(() => []) }, albums: { toArray: vi.fn(() => []) }, songs: { count: vi.fn(() => 0) } },
  hasLocalLibrary: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }),
}));

vi.mock('@/composables/useMediaSession', () => ({
  attachMediaSessionHandlers: vi.fn(),
  updateMediaSessionMetadata: vi.fn(),
  setMediaSessionPlaybackState: vi.fn(),
  updatePositionState: vi.fn(),
}));

vi.mock('@/utils/songEvents', () => ({
  songEvents: { onSongUpdated: vi.fn(), emitSongUpdated: vi.fn() },
}));

vi.mock('@/i18n', () => ({
  default: { global: { t: (k: string) => k } },
}));

// Mock Howler
vi.mock('howler', () => {
  return {
    Howl: class {
      constructor(opts: { onload?: () => void; onplay?: () => void }) {
        queueMicrotask(() => opts.onload?.());
        return {
          play: vi.fn(() => { opts.onplay?.(); }),
          pause: vi.fn(),
          unload: vi.fn(),
          duration: vi.fn(() => 200),
          seek: vi.fn(() => 10),
          state: vi.fn(() => 'loaded'),
          on: vi.fn(),
          once: vi.fn((e: string, cb: () => void) => { if (e === 'load') queueMicrotask(cb); }),
          off: vi.fn(),
        };
      }
    },
    Howler: {
      volume: vi.fn(),
    }
  };
});

describe('Integration Flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('Library Store', () => {
    it('fetchSongs updates state correctly', async () => {
      const store = useLibraryStore();
      const mockSongs: Song[] = [
          { id: 1, title: 'Test Song', artist_id: 10, album_id: 20, duration_secs: 180, file_path: 'path' }
      ];
      mockMusicApi.getSongs.mockResolvedValue({ 
        data: { 
          items: mockSongs, 
          total: 1, 
          limit: 10, 
          offset: 0, 
          has_next: false 
        } 
      });

      await store.fetchSongs();

      expect(store.songs).toEqual(mockSongs);
      expect(store.loading).toBe(false);
      expect(store.error).toBe(null);
    });

    it('fetchSongs handles error', async () => {
      const store = useLibraryStore();
      mockMusicApi.getSongs.mockRejectedValue(new Error('Network Error'));

      await store.fetchSongs();

      expect(store.songs).toEqual([]);
      expect(store.error).toBe('Network Error');
    });
  });

  describe('Player Store', () => {
    it('play updates current song and queue', async () => {
      const store = usePlayerStore();
      const song: Song = { id: 1, title: 'Song 1', file_path: 'p1', duration_secs: 180, artist_id: 1, album_id: 1 };
      
      await store.play(song);

      expect(store.currentSong?.id).toBe(1);
      expect(store.queue.some(s => s.id === 1)).toBe(true);
      expect(mockMusicApi.getStreamToken).toHaveBeenCalledWith(1, 'original');
    });

    it('addToQueue adds song', () => {
      const store = usePlayerStore();
      const song: Song = { id: 2, title: 'Song 2', file_path: 'p2', duration_secs: 200, artist_id: 2, album_id: 2 };
      
      store.addToQueue(song);
      expect(store.queue).toHaveLength(1);
      expect(store.queue[0]).toEqual(song);
    });
  });
});
