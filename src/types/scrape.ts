// ── Scrape 类型 ──────────────────────────────────────────────

export type ScrapeSessionStatus = 'pending' | 'running' | 'needs_review' | 'confirmed' | 'done' | 'failed' | 'organizing' | 'organized' | 'organize_failed' | 'cancelled';

export interface ScrapeSession {
  id: number;
  song_id: number;
  status: ScrapeSessionStatus;
  version: number;
  created_at: string;
  updated_at: string;
  has_resolved: boolean;
}

export interface ListSessionsResponse {
  items: ScrapeSession[];
}

export interface CandidateFields {
  song_id: string;
  title: string;
  artist?: string;
  album?: string;
  album_img?: string;
  year?: string;
  genre?: string;
}

export interface ScrapeCandidate {
  id: number;
  source: string;
  score: number;
  fields_json: string;
  evidence_json: string;
}

export interface ListCandidatesResponse {
  session_id: number;
  items: ScrapeCandidate[];
}

export interface SearchRequest {
  title?: string;
  artist?: string;
  album?: string;
  sources?: string[];
  stop_on_first_match?: boolean;
}

export interface SearchResultItem {
  source: string;
  song_id: string;
  title: string;
  artist?: string;
  album?: string;
  album_img?: string;
  year?: string;
  score: number;
  lyrics_available: boolean;
  duration_secs?: number;
}

export interface SearchResponse {
  session_id: number;
  count: number;
  candidates: SearchResultItem[];
}

export interface ApplyCandidateRequest {
  candidate_id: number;
}

export interface ApplyCandidateResponse {
  session_id: number;
  applied: boolean;
  candidate_id: number;
}

export interface ConfirmRequest {
  expected_version: number;
  force?: boolean;
}

export interface CancelResponse {
  session_id: number;
  cancelled: boolean;
}

export interface BatchCancelResponse {
  cancelled_count: number;
  failed_ids: number[];
}

export interface DeleteResponse {
  session_id: number;
  deleted: boolean;
}

export interface BatchDeleteResponse {
  deleted_count: number;
  failed_ids: number[];
}

export interface ConfirmResponse {
  session_id: number;
  song_id: number;
  confirmed: boolean;
  new_version: number;
}

export interface BatchCreateRequest {
  song_ids: number[];
}

export interface BatchCreateResponse {
  created_count: number;
  session_ids: number[];
}

export interface FetchLyricRequest {
  source: string;
  song_id: string;
}

export interface FetchLyricResponse {
  source: string;
  song_id: string;
  lyrics?: string;
}

// ── 自动刮削类型 ──────────────────────────────────────────────

export interface AutoScrapeResponse {
  status: string;
  total: number;
}

export interface AutoScrapeProgress {
  running: boolean;
  total: number;
  completed: number;
  auto_applied: number;
  needs_review: number;
  failed: number;
  current_song?: string;
  status: string;
  message?: string;
}

// ── 日志类型 ──────────────────────────────────────────────────

export interface ScrapeLogItem {
  id: number;
  session_id: number | null;
  action: string;
  detail_json: string | null;
  created_at: string;
  song_title?: string;
}

export interface ScrapeLogListResponse {
  items: ScrapeLogItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ScrapeLogQuery {
  page?: number;
  page_size?: number;
  session_id?: number;
  action?: string;
}

// ── 会话详情类型 ──────────────────────────────────────────────

export interface ScrapeResolvedItem {
  id: number;
  origin: string;
  fields_json: string;
  confidence_label?: string;
  created_at: string;
}

export interface SongBrief {
  id: number;
  title: string;
  artist?: string;
  file_path: string;
}

export interface SessionDetailResponse {
  session: ScrapeSession;
  song: SongBrief | null;
  resolved: ScrapeResolvedItem[];
  logs: ScrapeLogItem[];
}

// ── Organize 类型 ────────────────────────────────────────────

export interface PreviewItemInput {
  old_path: string;
  artist?: string;
  album?: string;
  track_no?: number;
  title?: string;
}

export interface PreviewItemOutput {
  old_path: string;
  new_path: string;
  conflict: boolean;
}

export interface PreviewResponse {
  items: PreviewItemOutput[];
}

export interface OrganizeApplyRequest {
  plan_id: number;
  root_path: string;
  template: string;
  items: PreviewItemInput[];
}

export interface OrganizeApplyResponse {
  session_id: number;
  plan_id: number;
  status: string;
  moved_count: number;
  error_count: number;
}

export interface RollbackRequest {
  session_id: number;
}

export interface RollbackResponse {
  session_id: number;
  restored_count: number;
  error_count: number;
}

export interface OrganizeSession {
  id: number;
  plan_id: number;
  actor?: string;
  status: string;
  result_json: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePlanResponse {
  plan_id: number;
}

export interface RootsResponse {
  roots: string[];
}
