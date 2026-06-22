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
  getArtists: (params: { limit?: number; offset?: number; q?: string } = {}) => {
    return api.get<PaginatedResponse<Artist>>('/artists', { params });
  },
  getBatchSongs: (ids: number[]) => {
    return api.post<Song[]>('/songs/batch', { ids });
  },
  getRecommendations: () => {
    return api.get<Recommendation[]>('/recommend');
  },
  getStreamToken: (songId: number, quality: 'low' | 'medium' | 'high' | 'lossless' | 'original' = 'high') => {
    return api.post<StreamTokenResponse>('/stream-token', { song_id: songId, quality });
  },
  buildStreamUrl: (id: number, quality: string, streamToken: string) => {
    return `/api/stream/${id}?quality=${quality}&stoken=${streamToken}`;
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
  reportDuration: (id: number, durationSecs: number) => {
    return api.post<{ updated: boolean }>(`/songs/${id}/duration`, { duration_secs: durationSecs });
  },
};
