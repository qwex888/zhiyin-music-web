
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  page: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export type SourceType = 'local' | 'strm';

export interface Song {
  id: number;
  title: string;
  artist_id: number;
  album_id: number;
  artist?: string; // Optional, for UI display after mapping
  artist_name?: string; // Alternative field name
  album?: string;  // Optional, for UI display after mapping
  album_name?: string; // Alternative field name
  album_artist?: string;
  duration_secs: number | null;
  track_no?: number;
  disc_no?: number;
  year?: number;
  genre?: string;
  cover_id?: number;
  file_path: string;
  file_size?: number;
  bitrate?: number | null;
  sample_rate?: number | null;
  channels?: number | null;
  bit_depth?: number | null;
  play_count?: number;
  created_at?: string;
  updated_at?: string;
  source_type?: SourceType;
  codec?: string | null;
}

export function isStrmSong(song: Song | null | undefined): boolean {
  return song?.source_type === 'strm';
}

export interface RecentSong extends Song {
  score: number;
  played_at: string;
}

export interface Album {
  id: number;
  name: string;
  artist_id?: number;
  artist_name?: string;
  year?: number;
  cover_id?: number;
  song_ids?: number[];
}

export interface Artist {
  id: number;
  name: string;
  song_count?: number;
  album_count?: number;
  artist_id?: number;
  cover_id?: number;
  song_ids?: number[];
}

export interface PlayHistory extends Song {
  song_id: number;
  played_at: string;
}

export interface Recommendation extends Song {
  song_id: number;
  score: number;
}

export interface HistoryStats {
  total_plays: number;
  unique_songs: number;
  recent_7days_plays: number;
  top_song_id?: number;
  top_song_plays?: number;
}

export interface LibraryStats {
  total_albums: number;
  total_artists: number;
  total_file_size_bytes: number;
  total_songs: number;
}

export interface PlaybackStats {
  plays_last_30_days: number;
  plays_last_7_days: number;
  plays_today: number;
  total_plays: number;
}

export interface QualityStats {
  formats: {
    codec: string;
    count: number;
    percentage: number;
  }[];
  high_quality_count: number;
  lossless_count: number;
}

export interface RecentStats {
  last_recommendation_update: string | null;
  last_scan_at: string | null;
  songs_added_last_30_days: number;
  songs_added_last_7_days: number;
}

export interface StorageStats {
  covers_cache_size_bytes: number;
  database_size_bytes: number;
  total_cache_size_bytes: number;
  transcode_cache_size_bytes: number;
}

export interface SystemStats {
  active_transcode_jobs: number;
  database_fragmentation_percent: number;
  recommendation_cache_count: number;
}

export interface TopContentStats {
  most_played_albums: {
    artist_name: string;
    id: number;
    name: string;
    play_count: number;
  }[];
  most_played_artists: {
    id: number;
    name: string;
    play_count: number;
  }[];
  most_played_songs: {
    artist_name: string;
    id: number;
    play_count: number;
    title: string;
  }[];
}

export interface Stats {
  library: LibraryStats;
  playback: PlaybackStats;
  quality: QualityStats;
  recent: RecentStats;
  storage: StorageStats;
  system: SystemStats;
  top_content: TopContentStats;
}

export type ScanPhase = 'idle' | 'walking' | 'hashing' | 'processing' | 'done';

export interface ScanSnapshot {
  added: number;
  current_file: string | null;
  current_root: string | null;
  deleted: number;
  elapsed_secs: number | null;
  errors: number;
  files_to_process: number;
  finished_at: string | null;
  modified: number;
  phase: ScanPhase;
  processed: number;
  scanning: boolean;
  started_at: string | null;
  total_files: number;
  unchanged: number;
}
