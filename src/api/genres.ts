import api from './index';
import type { PaginatedResponse, Song } from '@/types';
import i18n from '@/i18n';

export interface GenreSummary {
  id: number;
  name: string;
  song_count: number;
  cover_id?: number | null;
  origin?: 'preset' | 'manual' | 'auto' | string;
}

function localeParam() {
  const lang = String(i18n.global.locale.value || 'zh-CN');
  return lang.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

export const genresApi = {
  list: (params: { limit?: number; offset?: number; q?: string } = {}) =>
    api.get<PaginatedResponse<GenreSummary>>('/genres', {
      params: { ...params, locale: localeParam() },
    }),

  get: (id: number) =>
    api.get<GenreSummary>(`/genres/${id}`, { params: { locale: localeParam() } }),

  songs: (
    id: number,
    params: { limit?: number; offset?: number; sort_by?: string; sort_order?: string } = {},
  ) => api.get<PaginatedResponse<Song>>(`/genres/${id}/songs`, { params }),

  uncategorizedSongs: (
    params: { limit?: number; offset?: number; sort_by?: string; sort_order?: string } = {},
  ) => api.get<PaginatedResponse<Song>>('/genres/uncategorized/songs', { params }),

  create: (name: string) =>
    api.post<GenreSummary>('/genres', { name }, { params: { locale: localeParam() } }),

  rename: (id: number, name: string) =>
    api.patch<GenreSummary>(`/genres/${id}`, { name }, { params: { locale: localeParam() } }),

  merge: (from_ids: number[], to_id: number) =>
    api.post<GenreSummary>(
      '/genres/merge',
      { from_ids, to_id },
      { params: { locale: localeParam() } },
    ),

  remove: (id: number, migrate_to?: number) =>
    api.delete(`/genres/${id}`, { params: { migrate_to } }),

  updateSong: (
    songId: number,
    body: {
      genres?: string[];
      op?: 'set' | 'add' | 'remove' | 'clear';
      lock?: boolean;
      write_tags?: boolean;
    },
  ) => api.patch<{ genres: string[]; genre_locked: boolean }>(`/songs/${songId}/genres`, body),

  batchUpdate: (body: {
    song_ids: number[];
    genres?: string[];
    op?: 'set' | 'add' | 'remove' | 'clear';
    lock?: boolean;
    write_tags?: boolean;
  }) =>
    api.post<{ updated_count: number; primary_genre_id?: number | null; genres?: string[] }>(
      '/songs/genres/batch',
      body,
    ),

  applyAlbum: (
    albumId: number,
    body: {
      genres: string[];
      op?: 'set' | 'add' | 'remove' | 'clear';
      lock?: boolean;
      write_tags?: boolean;
    },
  ) =>
    api.post<{ updated_count: number; primary_genre_id?: number | null; genres?: string[] }>(
      `/albums/${albumId}/genres/apply`,
      body,
    ),
};

