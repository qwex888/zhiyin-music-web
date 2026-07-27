export type PlaylistSortMode = 'added_at' | 'manual';
export type PlaylistScope = 'mine' | 'public' | 'all';

export interface PlaylistSummary {
  id: number;
  name: string;
  description: string | null;
  is_public: boolean;
  owner_user_id: string;
  is_owner: boolean;
  song_count: number;
  cover_id: number | null;
  effective_cover_id: number | null;
  sort_mode: PlaylistSortMode | string;
  created_at: string;
  updated_at: string;
}

export interface PlaylistDetail extends PlaylistSummary {
  songs: import('./index').Song[];
}

export interface PlaylistMembershipItem {
  playlist_id: number;
  name: string;
  contains: boolean;
}

export interface CreatePlaylistPayload {
  name: string;
  description?: string;
  is_public?: boolean;
}

export interface UpdatePlaylistPayload {
  name?: string;
  description?: string | null;
  is_public?: boolean;
}

export interface AddSongsResult {
  added_count: number;
  skipped_count: number;
  playlist: PlaylistSummary;
}

export interface RemoveSongsResult {
  removed_count: number;
  playlist: PlaylistSummary;
}
