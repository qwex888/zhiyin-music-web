import api from './index';
import type {
  CreateScrapeSourceRequest,
  HealthListItem,
  ReloadResponse,
  ScrapeSourceDetail,
  ScrapeSourceListItem,
  ScrapeSourcesMeta,
  SourceHealthSnapshot,
  UpdateScrapeSourceRequest,
} from '@/types/scrapeSources';

export const scrapeSourcesApi = {
  list: (enabledOnly?: boolean) =>
    api.get<ScrapeSourceListItem[]>('/scrape/sources', {
      params: enabledOnly ? { enabled_only: true } : undefined,
    }),

  meta: () => api.get<ScrapeSourcesMeta>('/scrape/sources/meta'),

  get: (key: string) => api.get<ScrapeSourceDetail>(`/scrape/sources/${encodeURIComponent(key)}`),

  create: (body: CreateScrapeSourceRequest) =>
    api.post<ScrapeSourceDetail>('/scrape/sources', body),

  update: (key: string, body: UpdateScrapeSourceRequest) =>
    api.put<ScrapeSourceDetail>(`/scrape/sources/${encodeURIComponent(key)}`, body),

  delete: (key: string) =>
    api.delete<{ deleted: boolean; key: string }>(`/scrape/sources/${encodeURIComponent(key)}`),

  reset: (key: string) =>
    api.post<ScrapeSourceDetail>(`/scrape/sources/${encodeURIComponent(key)}/reset`),

  reload: () => api.post<ReloadResponse>('/scrape/sources/reload'),

  listHealth: () => api.get<{ items: HealthListItem[] }>('/scrape/sources/health'),

  probe: (key: string, sampleKeyword?: string) =>
    api.post<SourceHealthSnapshot>(`/scrape/sources/${encodeURIComponent(key)}/probe`, {
      sample_keyword: sampleKeyword,
    }),

  probeAll: () => api.post<SourceHealthSnapshot[]>('/scrape/sources/probe-all'),

  /** 批量开启内置音乐源（不含 acoustid） */
  enableBuiltins: () =>
    api.post<{ enabled_count: number; enabled_keys: string[]; registry_version: number }>(
      '/scrape/sources/enable-builtins',
    ),
};
