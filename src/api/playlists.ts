import api from './index';
import type {
  AddSongsResult,
  CreatePlaylistPayload,
  PlaylistDetail,
  PlaylistMembershipItem,
  PlaylistScope,
  PlaylistSummary,
  RemoveSongsResult,
  UpdatePlaylistPayload,
} from '@/types/playlist';

export const playlistsApi = {
  list: (params: { scope?: PlaylistScope } = {}) => {
    return api.get<PlaylistSummary[]>('/playlists', { params });
  },

  get: (id: number) => {
    return api.get<PlaylistDetail>(`/playlists/${id}`);
  },

  create: (payload: CreatePlaylistPayload) => {
    return api.post<PlaylistSummary>('/playlists', payload);
  },

  update: (id: number, payload: UpdatePlaylistPayload) => {
    return api.put<PlaylistSummary>(`/playlists/${id}`, payload);
  },

  remove: (id: number) => {
    return api.delete<{ deleted: boolean; id: number }>(`/playlists/${id}`);
  },

  uploadCover: (id: number, file: File) => {
    const form = new FormData();
    form.append('cover', file);
    return api.post<PlaylistSummary>(`/playlists/${id}/cover`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  clearCover: (id: number) => {
    return api.delete<PlaylistSummary>(`/playlists/${id}/cover`);
  },

  addSongs: (id: number, songIds: number[]) => {
    return api.post<AddSongsResult>(`/playlists/${id}/songs`, { song_ids: songIds });
  },

  removeSongs: (id: number, songIds: number[]) => {
    return api.delete<RemoveSongsResult>(`/playlists/${id}/songs`, {
      data: { song_ids: songIds },
    });
  },

  reorder: (id: number, songIds: number[]) => {
    return api.put<PlaylistSummary>(`/playlists/${id}/songs/reorder`, { song_ids: songIds });
  },

  membership: (songId: number) => {
    return api.get<{ items: PlaylistMembershipItem[] }>('/playlists/membership', {
      params: { song_id: songId },
    });
  },
};
