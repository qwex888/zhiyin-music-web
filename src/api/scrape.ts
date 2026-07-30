import api from './index';
import { songEvents } from '@/utils/songEvents';
import type {
  ListSessionsResponse,
  ListCandidatesResponse,
  SearchRequest,
  SearchResponse,
  ApplyCandidateResponse,
  ConfirmResponse,
  BatchCreateResponse,
  FetchLyricResponse,
  AutoScrapeResponse,
  AutoScrapeProgress,
  ScrapeLogListResponse,
  ScrapeLogQuery,
  SessionDetailResponse,
  CancelResponse,
  BatchCancelResponse,
  DeleteResponse,
  BatchDeleteResponse,
} from '@/types/scrape';

export const scrapeApi = {
  getSessions: () => {
    return api.get<ListSessionsResponse>('/scrape/sessions');
  },

  getCandidates: (sessionId: number) => {
    return api.get<ListCandidatesResponse>(`/scrape/sessions/${sessionId}/candidates`);
  },

  search: (sessionId: number, params: SearchRequest) => {
    return api.post<SearchResponse>(`/scrape/sessions/${sessionId}/search`, params);
  },

  applyCandidate: (sessionId: number, candidateId: number) => {
    return api.post<ApplyCandidateResponse>(`/scrape/sessions/${sessionId}/apply-candidate`, {
      candidate_id: candidateId,
    });
  },

  confirm: async (sessionId: number, expectedVersion: number, force?: boolean) => {
    const res = await api.post<ConfirmResponse>(`/scrape/sessions/${sessionId}/confirm`, {
      expected_version: expectedVersion,
      force,
    });
    if (res.data.confirmed && res.data.song_id) {
      songEvents.emitSongUpdated([res.data.song_id]);
      songEvents.emitLyricsChanged(res.data.song_id);
    }
    return res;
  },

  cancelSession: (sessionId: number) => {
    return api.post<CancelResponse>(`/scrape/sessions/${sessionId}/cancel`);
  },

  batchCancel: (sessionIds: number[]) => {
    return api.post<BatchCancelResponse>('/scrape/batch-cancel', { session_ids: sessionIds });
  },

  deleteSession: (sessionId: number) => {
    return api.post<DeleteResponse>(`/scrape/sessions/${sessionId}/delete`);
  },

  batchDelete: (sessionIds: number[]) => {
    return api.post<BatchDeleteResponse>('/scrape/batch-delete', { session_ids: sessionIds });
  },

  batchCreate: (songIds: number[]) => {
    return api.post<BatchCreateResponse>('/scrape/batch', { song_ids: songIds });
  },

  fetchLyrics: (sessionId: number, source: string, songId: string) => {
    return api.post<FetchLyricResponse>(`/scrape/sessions/${sessionId}/lyrics`, {
      source,
      song_id: songId,
    });
  },

  autoScrape: (songIds: number[], minScore?: number) => {
    return api.post<AutoScrapeResponse>('/scrape/auto', {
      song_ids: songIds,
      min_score: minScore,
    });
  },

  getAutoScrapeStatus: () => {
    return api.get<AutoScrapeProgress>('/scrape/auto/status');
  },

  getLogs: (params?: ScrapeLogQuery) => {
    return api.get<ScrapeLogListResponse>('/scrape/logs', { params });
  },

  getSessionDetail: (sessionId: number) => {
    return api.get<SessionDetailResponse>(`/scrape/sessions/${sessionId}/detail`);
  },

  /** 确认前覆盖已应用候选字段（风格等） */
  overrideFields: (sessionId: number, body: { genre?: string }) => {
    return api.post<{ session_id: number; updated: boolean; genre?: string | null }>(
      `/scrape/sessions/${sessionId}/override-fields`,
      body,
    );
  },
};
