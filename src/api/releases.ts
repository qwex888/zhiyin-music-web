import api from './index';

export interface ReleaseChanges {
  feature: string[];
  fix: string[];
  perf: string[];
  refactor: string[];
  docs: string[];
  i18n: string[];
  build: string[];
  ci: string[];
  style: string[];
  test: string[];
  chore: string[];
}

export interface ReleaseModule {
  id: string;
  name: string;
  version: string;
  published_at: string;
  summary: string;
  changes: ReleaseChanges;
}

export interface ReleasesResponse {
  appVersion: string;
  modules: ReleaseModule[];
}

export interface LatestReleaseResponse {
  tag?: string | null;
  html_url: string;
  checked_at: string;
  cached: boolean;
  stale: boolean;
  summary: string;
  modules: ReleaseModule[];
}

export const releasesApi = {
  getReleases: () => api.get<ReleasesResponse>('/releases'),
  getLatest: () => api.get<LatestReleaseResponse>('/releases/latest'),
};
