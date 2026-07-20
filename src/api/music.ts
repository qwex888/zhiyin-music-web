import api from './index';
import type { Song, Album, Artist, Recommendation, PaginatedResponse } from '@/types';

interface StreamTokenResponse {
  stream_token: string;
  expires_in: number;
}

export const musicApi = {
  getSongs: (params: { limit?: number; offset?: number; q?: string; sort_by?: string; sort_order?: string; artist_id?: number; album_id?: number } = {}) => {
    return api.get<PaginatedResponse<Song>>('/songs', { params });
  },
  getSong: (id: number) => {
    return api.get<Song>(`/songs/${id}`);
  },
  getAlbums: (params: { limit?: number; offset?: number; q?: string } = {}) => {
    return api.get<PaginatedResponse<Album>>('/albums', { params });
  },
  getAlbum: (id: number) => {
    return api.get<Album>(`/albums/${id}`);
  },
  getArtists: (params: { limit?: number; offset?: number; q?: string } = {}) => {
    return api.get<PaginatedResponse<Artist>>('/artists', { params });
  },
  getArtist: (id: number) => {
    return api.get<Artist>(`/artists/${id}`);
  },
  getBatchSongs: async (ids: number[]) => {
    const BATCH_LIMIT = 500;
    if (ids.length <= BATCH_LIMIT) {
      return api.post<Song[]>('/songs/batch', { ids });
    }
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
      chunks.push(ids.slice(i, i + BATCH_LIMIT));
    }
    const results = await Promise.all(
      chunks.map(chunk => api.post<Song[]>('/songs/batch', { ids: chunk }))
    );
    return { data: results.flatMap(r => r.data) } as { data: Song[] };
  },
  getRecommendations: () => {
    return api.get<Recommendation[]>('/recommend');
  },
  getStreamToken: (songId: number, quality: 'low' | 'medium' | 'high' | 'lossless' | 'original' = 'high') => {
    return api.post<StreamTokenResponse>('/stream-token', { song_id: songId, quality });
  },
  buildStreamUrl: (
    id: number,
    quality: string,
    streamToken: string,
    opts?: { progressive?: boolean },
  ) => {
    const params = new URLSearchParams({
      quality,
      stoken: streamToken,
    });
    if (opts?.progressive) params.set('progressive', '1');
    return `/api/stream/${id}?${params.toString()}`;
  },
  getCoverUrl: (id: number) => {
    return `/api/covers/${id}?size=original`;
  },
  getLyrics: (id: number) => {
    return api.get<{ has_lyrics: boolean; lyrics: string; song_id: number }>(`/songs/${id}/lyrics`);
  },
  checkLyrics: (id: number) => {
    return api.get<{ has_lyrics: boolean; song_id: number }>(`/songs/${id}/lyrics/check`);
  },
  searchLyrics: (id: number, params: { title?: string; artist?: string; album?: string }) => {
    return api.post<{
      song_duration_secs: number | null;
      results: Array<{
        source: string;
        song_id: string;
        title: string;
        artist: string | null;
        duration_secs: number | null;
        lyrics_preview: string | null;
        lyrics_full: string | null;
      }>;
    }>(`/songs/${id}/lyrics/search`, params);
  },
  replaceLyrics: (id: number, lyrics: string) => {
    return api.post<{ success: boolean; method: string }>(`/songs/${id}/lyrics/replace`, { lyrics });
  },
  reportMetadata: (id: number, data: {
    duration_secs?: number;
    bitrate?: number;
    sample_rate?: number;
    channels?: number;
    bit_depth?: number;
    codec?: string;
    force?: boolean;
  }) => {
    return api.post<{ updated: boolean; fields_updated: string[] }>(`/songs/${id}/metadata`, data);
  },
};
