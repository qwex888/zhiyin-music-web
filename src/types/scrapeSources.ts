export interface SourceCapabilities {
  search: boolean;
  lyric: boolean;
  cover: boolean;
}

export interface ScrapeSourceListItem {
  key: string;
  display_name: string;
  driver_type: 'builtin' | 'template' | string;
  driver_key?: string | null;
  enabled: boolean;
  priority: number;
  timeout_secs?: number | null;
  color?: string | null;
  icon?: string | null;
  is_builtin: boolean;
  capabilities: SourceCapabilities;
  registry_version: number;
}

export interface SourceFieldStats {
  title: boolean;
  artist: boolean;
  album: boolean;
  album_img: boolean;
  year: boolean;
  duration_secs: boolean;
  lyrics_available: boolean;
}

export interface SourceHealthSnapshot {
  status: 'healthy' | 'degraded' | 'down' | string;
  latency_ms: number;
  search_ok: boolean;
  lyric_ok: boolean;
  cover_ok: boolean;
  field_stats: SourceFieldStats;
  error_message?: string | null;
  probed_at: string;
  sample_keyword: string;
}

export interface ScrapeSourceDetail extends ScrapeSourceListItem {
  template_json?: string | null;
  last_health?: SourceHealthSnapshot | null;
}

export interface ScrapeSourcesMeta {
  registry_version: number;
  enabled_keys: string[];
}

export interface CreateScrapeSourceRequest {
  key: string;
  display_name: string;
  template_json: string;
  enabled?: boolean;
  priority?: number;
  timeout_secs?: number | null;
  color?: string | null;
  icon?: string | null;
}

export interface UpdateScrapeSourceRequest {
  display_name?: string;
  enabled?: boolean;
  priority?: number;
  timeout_secs?: number | null;
  color?: string | null;
  icon?: string | null;
  template_json?: string;
  capabilities?: SourceCapabilities;
}

export interface HealthListItem {
  key: string;
  display_name: string;
  health?: SourceHealthSnapshot | null;
}

export interface ReloadResponse {
  registry_version: number;
  warnings: string[];
}
