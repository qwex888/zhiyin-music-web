
export interface ConfigMeta {
  default_value: any;
  description: string;
  requires_restart: boolean;
}

export interface ConfigItem<T> {
  _meta: Record<keyof T, ConfigMeta>;
}

export interface DatabaseConfig {
  path: string;
  pool_size: number;
}

export interface MaintenanceConfig {
  enable_vacuum: boolean;
  enabled: boolean;
  history_retention_days: number;
  interval_hours: number;
  recommendation_retention_days: number;
  vacuum_threshold: number;
}

export interface RecommendConfig {
  job_interval_hours: number;
  max_results: number;
  play_threshold: number;
}

export interface ScanConfig {
  interval_hours: number;
  min_file_size: number;
  mode: string;
  roots: string[];
  skip_small_files: boolean;
  scan_strm: boolean;
  strm_mode: 'proxy' | 'redirect';
  strm_probe_remote: boolean;
}

export interface ServerConfig {
  drop_cache_after_stream: boolean;
  host: string;
  port: number;
}

export interface SubsonicConfig {
  enabled: boolean;
}

export interface WebConfig {
  enabled: boolean;
  path: string;
}

export interface SecurityConfig {
  token_expiry_hours: number;
  cors_origins: string[];
  login_rate_limit: number;
  login_rate_window_secs: number;
  stream_token_ttl_secs?: number;
}

export interface LoggingConfig {
  level: string;
  modules: string[];
}

export interface TranscodeConfig {
  cache_path: string;
  cache_strategy: string;
  cache_threshold: number;
  enabled: boolean;
  max_concurrent_transcodes: number;
}

export interface ScrapeConfig {
  enabled: boolean;
  metadata_format: 'json' | 'nfo';
  sidecar_for_all: boolean;
}

export interface SystemConfig {
  database: DatabaseConfig & ConfigItem<DatabaseConfig>;
  logging: LoggingConfig & ConfigItem<LoggingConfig>;
  maintenance: MaintenanceConfig & ConfigItem<MaintenanceConfig>;
  recommend: RecommendConfig & ConfigItem<RecommendConfig>;
  scan: ScanConfig & ConfigItem<ScanConfig>;
  scrape: ScrapeConfig & ConfigItem<ScrapeConfig>;
  security: SecurityConfig & ConfigItem<SecurityConfig>;
  server: ServerConfig & ConfigItem<ServerConfig>;
  subsonic: SubsonicConfig & ConfigItem<SubsonicConfig>;
  transcode: TranscodeConfig & ConfigItem<TranscodeConfig>;
  web: WebConfig & ConfigItem<WebConfig>;
}

export interface UpdateConfigParams {
  logging?: Partial<LoggingConfig>;
  maintenance?: Partial<MaintenanceConfig>;
  recommend?: Partial<RecommendConfig>;
  scan?: Partial<ScanConfig>;
  scrape?: Partial<ScrapeConfig>;
  security?: Partial<SecurityConfig>;
  subsonic?: Partial<SubsonicConfig>;
  transcode?: Partial<TranscodeConfig>;
  web?: Partial<WebConfig>;
}
