import { describe, it, expect, vi } from 'vitest';
import { musicApi } from '@/api/music';
import { historyApi } from '@/api/history';
import { systemApi } from '@/api/system';
import api from '@/api/index';

// Mock the api module
vi.mock('@/api/index', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('Music API', () => {
  it('getSongs calls /songs with correct params', async () => {
    const params = { limit: 10, offset: 0 };
    await musicApi.getSongs(params);
    expect(api.get).toHaveBeenCalledWith('/songs', { params });
  });

  it('getAlbums calls /albums with correct params', async () => {
    const params = { limit: 20, offset: 20 };
    await musicApi.getAlbums(params);
    expect(api.get).toHaveBeenCalledWith('/albums', { params });
  });

  it('getArtists calls /artists with correct params', async () => {
      const params = { limit: 5, offset: 0 };
      await musicApi.getArtists(params);
      expect(api.get).toHaveBeenCalledWith('/artists', { params });
  });

  it('getRecommendations calls /recommend', async () => {
      await musicApi.getRecommendations();
      expect(api.get).toHaveBeenCalledWith('/recommend');
  });

  it('buildStreamUrl returns correct URL with stream token', () => {
    const url = musicApi.buildStreamUrl(123, 'lossless', 'abc123');
    expect(url).toBe('/api/stream/123?quality=lossless&stoken=abc123');
  });

  it('buildStreamUrl appends progressive=1 when requested', () => {
    const url = musicApi.buildStreamUrl(123, 'original', 'tok', { progressive: true });
    expect(url).toContain('progressive=1');
    expect(url).toContain('stoken=tok');
  });

  it('getStreamToken calls POST /stream-token', async () => {
    await musicApi.getStreamToken(123, 'high');
    expect(api.post).toHaveBeenCalledWith('/stream-token', { song_id: 123, quality: 'high' });
  });

  it('getCoverUrl returns correct URL', () => {
    const url = musicApi.getCoverUrl(456);
    expect(url).toBe('/api/covers/456?size=original');
  });
});

describe('History API', () => {
    it('getHistory calls /history with correct params', async () => {
        const params = { limit: 15, offset: 0 };
        await historyApi.getHistory(params);
        expect(api.get).toHaveBeenCalledWith('/history', { params });
    });

    it('getRecentSongs calls /history/recent', async () => {
        await historyApi.getRecentSongs();
        expect(api.get).toHaveBeenCalledWith('/history/recent');
    });

    it('getSongHistory calls /history/song/{id}', async () => {
        await historyApi.getSongHistory(101);
        expect(api.get).toHaveBeenCalledWith('/history/song/101');
    });

    it('getStats calls /history/stats', async () => {
        await historyApi.getStats();
        expect(api.get).toHaveBeenCalledWith('/history/stats');
    });
});

describe('System API', () => {
    it('triggerScan calls POST /scan', async () => {
        await systemApi.triggerScan();
        expect(api.post).toHaveBeenCalledWith('/scan');
    });

    it('getJobStatus calls /jobs/status', async () => {
        await systemApi.getJobStatus();
        expect(api.get).toHaveBeenCalledWith('/jobs/status');
    });

    it('getHealth calls /health', async () => {
        await systemApi.getHealth();
        expect(api.get).toHaveBeenCalledWith('/health');
    });

    it('getConfig calls /config', async () => {
        await systemApi.getConfig();
        expect(api.get).toHaveBeenCalledWith('/config');
    });
});
