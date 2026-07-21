<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Search, ChevronDown, ChevronUp, Music2, CheckCircle2, Clock, AlertCircle, Play, Filter,
  Eye, RefreshCw, X, FileText, Tag, Library, Zap, ScrollText, XCircle, Trash2,
} from 'lucide-vue-next';
import { scrapeApi } from '@/api/scrape';
import { musicApi } from '@/api/music';
import { useToast } from '@/composables/useToast';
import { useLibraryStore } from '@/stores/library';
import type {
  ScrapeSession,
  ScrapeSessionStatus,
  SearchResultItem,
  CandidateFields,
  AutoScrapeProgress,
  ScrapeLogItem,
  SessionDetailResponse,
} from '@/types/scrape';
import type { Song } from '@/types';
import SelectableSongList from '@/components/common/SelectableSongList.vue';
import { useScrapeSources } from '@/composables/useScrapeSources';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();

const { t } = useI18n();
const toast = useToast();
const libraryStore = useLibraryStore();
const authStore = useAuthStore();
const {
  enabledSources,
  ensureLoaded,
  getSourceLabel,
  getSourceColorClass,
  getSourceBadgeStyle,
  getSourceMeta,
  getEnabledKeys,
} = useScrapeSources();

// ── Tab ──────────────────────────────────────────────────────

const requestedTab = router.currentRoute.value.query.tab;
const activeTab = ref<'library' | 'sessions' | 'logs'>(
  requestedTab === 'sessions' || requestedTab === 'logs' ? requestedTab : 'library',
);
watch(
  () => router.currentRoute.value.query.tab,
  (tab) => {
    if (tab === 'library' || tab === 'sessions' || tab === 'logs') {
      activeTab.value = tab;
    }
  },
);
watch(activeTab, (tab) => {
  if (router.currentRoute.value.query.tab === tab) return;
  void router.replace({
    query: { ...router.currentRoute.value.query, tab },
  });
});

// ── Tab1: 音乐库选歌 ─────────────────────────────────────────

const librarySongs = ref<Song[]>([]);
const isLoadingLibrary = ref(false);
const hasLibraryError = ref(false);
const selectedSongIds = ref<Set<number>>(new Set());
const isCreatingScrape = ref(false);

type MetadataFilter = 'all' | 'missing_cover' | 'missing_artist' | 'missing_album' | 'missing_year' | 'missing_genre' | 'missing_duration';
const activeMetadataFilter = ref<MetadataFilter>('all');

const metadataFilterOptions: { key: MetadataFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'scrape.filter_meta_all' },
  { key: 'missing_cover', labelKey: 'scrape.filter_missing_cover' },
  { key: 'missing_artist', labelKey: 'scrape.filter_missing_artist' },
  { key: 'missing_album', labelKey: 'scrape.filter_missing_album' },
  { key: 'missing_year', labelKey: 'scrape.filter_missing_year' },
  { key: 'missing_duration', labelKey: 'scrape.filter_missing_duration' },
];

const filteredLibrarySongs = computed(() => {
  const songs = librarySongs.value;
  if (activeMetadataFilter.value === 'all') return songs;
  return songs.filter(s => {
    switch (activeMetadataFilter.value) {
      case 'missing_cover': return !s.cover_id;
      case 'missing_artist': return !s.artist && !s.artist_name && !s.artist_id;
      case 'missing_album': return !s.album && !s.album_name && !s.album_id;
      case 'missing_year': return !s.year;
      case 'missing_genre': return !s.genre;
      case 'missing_duration': return !s.duration_secs;
      default: return true;
    }
  });
});

const filterCounts = computed(() => {
  const songs = librarySongs.value;
  return {
    missing_cover: songs.filter(s => !s.cover_id).length,
    missing_artist: songs.filter(s => !s.artist && !s.artist_name && !s.artist_id).length,
    missing_album: songs.filter(s => !s.album && !s.album_name && !s.album_id).length,
    missing_year: songs.filter(s => !s.year).length,
    missing_genre: songs.filter(s => !s.genre).length,
    missing_duration: songs.filter(s => !s.duration_secs).length,
  } as Record<string, number>;
});

const fetchAllLibrarySongs = async () => {
  isLoadingLibrary.value = true;
  hasLibraryError.value = false;
  const pageSize = 200;
  let offset = 0;
  const allSongs: Song[] = [];
  try {
    while (true) {
      const { data } = await musicApi.getSongs({ limit: pageSize, offset });
      allSongs.push(...data.items);
      if (!data.has_next) break;
      offset += data.items.length;
    }
    librarySongs.value = allSongs;
  } catch {
    hasLibraryError.value = true;
    librarySongs.value = allSongs;
  } finally {
    isLoadingLibrary.value = false;
  }
};

const retryLibrary = () => {
  hasLibraryError.value = false;
  fetchAllLibrarySongs();
};

const toggleSong = (songId: number) => {
  const next = new Set(selectedSongIds.value);
  if (next.has(songId)) {
    next.delete(songId);
  } else {
    next.add(songId);
  }
  selectedSongIds.value = next;
};

const toggleAllSongs = () => {
  const filtered = filteredLibrarySongs.value;
  if (selectedSongIds.value.size === filtered.length) {
    selectedSongIds.value = new Set();
  } else {
    selectedSongIds.value = new Set(filtered.map(s => s.id));
  }
};

const handleCreateScrape = async () => {
  if (selectedSongIds.value.size === 0) return;
  isCreatingScrape.value = true;
  try {
    const ids = [...selectedSongIds.value];
    const { data } = await scrapeApi.batchCreate(ids);
    toast.success(t('scrape.batch_created', { count: data.created_count }));
    selectedSongIds.value = new Set();
    activeTab.value = 'sessions';
    await fetchSessions();
  } catch {
    toast.error(t('common.error'));
  } finally {
    isCreatingScrape.value = false;
  }
};

// ── 一键自动刮削 ──────────────────────────────────────────────

const autoScrapeProgress = ref<AutoScrapeProgress | null>(null);
const isAutoScraping = ref(false);
const autoScrapeMinScore = ref(50);
let autoScrapeTimer: ReturnType<typeof setInterval> | null = null;

const handleAutoScrape = async () => {
  if (selectedSongIds.value.size === 0) return;
  isAutoScraping.value = true;
  try {
    const ids = [...selectedSongIds.value];
    await scrapeApi.autoScrape(ids, autoScrapeMinScore.value);
    startAutoScrapePolling();
  } catch {
    toast.error(t('scrape.auto_scrape_conflict'));
    isAutoScraping.value = false;
  }
};

const startAutoScrapePolling = () => {
  stopAutoScrapePolling();
  autoScrapeTimer = setInterval(async () => {
    try {
      const { data } = await scrapeApi.getAutoScrapeStatus();
      autoScrapeProgress.value = data;
      if (!data.running) {
        stopAutoScrapePolling();
        isAutoScraping.value = false;
        toast.success(t('scrape.auto_scrape_done'));
        selectedSongIds.value = new Set();
        activeTab.value = 'sessions';
        await fetchSessions();
      }
    } catch {
      stopAutoScrapePolling();
      isAutoScraping.value = false;
    }
  }, 2000);
};

const stopAutoScrapePolling = () => {
  if (autoScrapeTimer) {
    clearInterval(autoScrapeTimer);
    autoScrapeTimer = null;
  }
};

// ── 写入中状态轮询（organizing → organized / organize_failed）──

let organizingPollTimer: ReturnType<typeof setInterval> | null = null;

const startOrganizingPoll = () => {
  if (organizingPollTimer) return;
  organizingPollTimer = setInterval(async () => {
    const hasOrganizing = sessions.value.some(s => s.status === 'organizing');
    if (!hasOrganizing) {
      stopOrganizingPoll();
      return;
    }
    await fetchSessions();
  }, 3000);
};

const stopOrganizingPoll = () => {
  if (organizingPollTimer) {
    clearInterval(organizingPollTimer);
    organizingPollTimer = null;
  }
};

const autoScrapePercent = computed(() => {
  if (!autoScrapeProgress.value || autoScrapeProgress.value.total === 0) return 0;
  return Math.round((autoScrapeProgress.value.completed / autoScrapeProgress.value.total) * 100);
});

const formatDuration = (seconds: number | undefined) => {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// ── Tab2: 会话管理 ────────────────────────────────────────────

const sessions = ref<ScrapeSession[]>([]);
const isLoadingSessions = ref(false);
const filterStatus = ref<ScrapeSessionStatus | 'all'>('all');
const expandedSessionId = ref<number | null>(null);

const songMap = ref<Map<number, Song>>(new Map());

const searchForm = ref({
  title: '',
  artist: '',
  album: '',
  sources: [] as string[],
});
const isSearching = ref(false);
const searchResults = ref<SearchResultItem[]>([]);
const mobileSearchMetaExpanded = ref<Record<number, boolean>>({});

const isMobileSearchMetaExpanded = (sessionId: number) => mobileSearchMetaExpanded.value[sessionId] ?? false;
const toggleMobileSearchMeta = (sessionId: number) => {
  mobileSearchMetaExpanded.value = {
    ...mobileSearchMetaExpanded.value,
    [sessionId]: !isMobileSearchMetaExpanded(sessionId),
  };
};

const isApplying = ref<number | null>(null);
const isConfirming = ref(false);

// ── 批量选择 & 取消/确认弹窗 ──────────────────────────────────
const selectedSessionIds = ref<Set<number>>(new Set());
const isCancelling = ref(false);

const cancelModal = reactive({
  visible: false,
  sessionId: null as number | null,
  isBatch: false,
});

const forceConfirmModal = reactive({
  visible: false,
  session: null as ScrapeSession | null,
});

const cancellableStatuses = new Set(['pending', 'needs_review', 'confirmed']);
const deletableStatuses = new Set(['confirmed', 'organized', 'organize_failed', 'cancelled']);
const selectableStatuses = new Set([...cancellableStatuses, ...deletableStatuses]);

const selectableSessions = computed(() =>
  filteredSessions.value.filter(s => selectableStatuses.has(s.status))
);

const isAllSelectableSelected = computed(() => {
  if (selectableSessions.value.length === 0) return false;
  return selectableSessions.value.every(s => selectedSessionIds.value.has(s.id));
});

const selectedHasCancellable = computed(() =>
  [...selectedSessionIds.value].some(id => {
    const s = sessions.value.find(s => s.id === id);
    return s && cancellableStatuses.has(s.status);
  })
);

const selectedHasDeletable = computed(() =>
  [...selectedSessionIds.value].some(id => {
    const s = sessions.value.find(s => s.id === id);
    return s && deletableStatuses.has(s.status);
  })
);

const toggleSessionSelect = (id: number) => {
  const next = new Set(selectedSessionIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedSessionIds.value = next;
};

const toggleAllSessionsSelect = () => {
  if (isAllSelectableSelected.value) {
    selectedSessionIds.value = new Set();
  } else {
    selectedSessionIds.value = new Set(selectableSessions.value.map(s => s.id));
  }
};

const showCancelModal = (sessionId: number) => {
  cancelModal.sessionId = sessionId;
  cancelModal.isBatch = false;
  cancelModal.visible = true;
};

const showBatchCancelModal = () => {
  cancelModal.sessionId = null;
  cancelModal.isBatch = true;
  cancelModal.visible = true;
};

const closeCancelModal = () => {
  cancelModal.visible = false;
  cancelModal.sessionId = null;
};

const confirmCancel = async () => {
  isCancelling.value = true;
  try {
    if (cancelModal.isBatch) {
      const ids = [...selectedSessionIds.value];
      const { data } = await scrapeApi.batchCancel(ids);
      toast.success(t('scrape.batch_cancel_success', { count: data.cancelled_count }));
      if (data.failed_ids.length > 0) {
        toast.error(t('scrape.batch_cancel_partial', { count: data.failed_ids.length }));
      }
      selectedSessionIds.value = new Set();
    } else if (cancelModal.sessionId) {
      await scrapeApi.cancelSession(cancelModal.sessionId);
      toast.success(t('scrape.cancelled_success'));
    }
    await fetchSessions();
  } catch {
    toast.error(t('common.error'));
  } finally {
    isCancelling.value = false;
    closeCancelModal();
  }
};

const showForceConfirmModal = (session: ScrapeSession) => {
  forceConfirmModal.session = session;
  forceConfirmModal.visible = true;
};

const closeForceConfirmModal = () => {
  forceConfirmModal.visible = false;
  forceConfirmModal.session = null;
};

const confirmForce = async () => {
  if (!forceConfirmModal.session) return;
  isConfirming.value = true;
  try {
    await scrapeApi.confirm(forceConfirmModal.session.id, forceConfirmModal.session.version, true);
    toast.success(t('scrape.confirmed'));
    await fetchSessions();
  } catch {
    toast.error(t('common.error'));
  } finally {
    isConfirming.value = false;
    closeForceConfirmModal();
  }
};

// ── 删除弹窗 ──────────────────────────────────────────────────
const isDeleting = ref(false);

const deleteModal = reactive({
  visible: false,
  sessionId: null as number | null,
  isBatch: false,
});

const showDeleteModal = (sessionId: number) => {
  deleteModal.sessionId = sessionId;
  deleteModal.isBatch = false;
  deleteModal.visible = true;
};

const showBatchDeleteModal = () => {
  deleteModal.sessionId = null;
  deleteModal.isBatch = true;
  deleteModal.visible = true;
};

const closeDeleteModal = () => {
  deleteModal.visible = false;
  deleteModal.sessionId = null;
};

const confirmDelete = async () => {
  isDeleting.value = true;
  try {
    if (deleteModal.isBatch) {
      const ids = [...selectedSessionIds.value].filter(id => {
        const s = sessions.value.find(s => s.id === id);
        return s && deletableStatuses.has(s.status);
      });
      const { data } = await scrapeApi.batchDelete(ids);
      toast.success(t('scrape.batch_delete_success', { count: data.deleted_count }));
      if (data.failed_ids.length > 0) {
        toast.error(t('scrape.batch_delete_partial', { count: data.failed_ids.length }));
      }
      selectedSessionIds.value = new Set();
    } else if (deleteModal.sessionId) {
      await scrapeApi.deleteSession(deleteModal.sessionId);
      toast.success(t('scrape.deleted_success'));
    }
    await fetchSessions();
  } catch {
    toast.error(t('common.error'));
  } finally {
    isDeleting.value = false;
    closeDeleteModal();
  }
};

const showLyricsModal = ref(false);
const lyricsContent = ref('');
const lyricsLoading = ref(false);
const lyricsTitle = ref('');

const allSources = computed(() =>
  enabledSources.value.map(s => ({
    value: s.key,
    label: s.display_name,
    color: s.color,
    capabilities: s.capabilities,
  }))
);

const goManageSources = () => router.push({ name: 'ScrapeSources' });

const filteredSessions = computed(() => {
  if (filterStatus.value === 'all') return sessions.value;
  if (filterStatus.value === 'done') {
    return sessions.value.filter(s => s.status === 'done' || s.status === 'confirmed');
  }
  return sessions.value.filter(s => s.status === filterStatus.value);
});

const statusFilters: { value: ScrapeSessionStatus | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'scrape.filter_all' },
  { value: 'pending', labelKey: 'scrape.status_pending' },
  { value: 'needs_review', labelKey: 'scrape.status_needs_review' },
  { value: 'organizing', labelKey: 'scrape.status_organizing' },
  { value: 'organized', labelKey: 'scrape.status_organized' },
  { value: 'organize_failed', labelKey: 'scrape.status_organize_failed' },
  { value: 'done', labelKey: 'scrape.status_done' },
  { value: 'cancelled', labelKey: 'scrape.status_cancelled' },
];

const fetchSessions = async () => {
  isLoadingSessions.value = true;
  try {
    const { data } = await scrapeApi.getSessions();
    sessions.value = data.items;
    const validIds = new Set(data.items.filter(s => selectableStatuses.has(s.status)).map(s => s.id));
    const next = new Set([...selectedSessionIds.value].filter(id => validIds.has(id)));
    selectedSessionIds.value = next;
    const songIds = [...new Set(data.items.map(s => s.song_id))];
    if (songIds.length > 0) {
      try {
        const { data: songs } = await musicApi.getBatchSongs(songIds);
        const map = new Map<number, Song>();
        songs.forEach(s => map.set(s.id, s));
        songMap.value = map;
      } catch { /* ignore */ }
    }
    if (data.items.some(s => s.status === 'organizing')) {
      startOrganizingPoll();
    } else {
      stopOrganizingPoll();
    }
  } catch {
    toast.error(t('common.error'));
  } finally {
    isLoadingSessions.value = false;
  }
};

const getSongName = (songId: number) => {
  const song = songMap.value.get(songId);
  return song ? (song.title || `#${songId}`) : `#${songId}`;
};

const getSongArtist = (songId: number) => {
  const song = songMap.value.get(songId);
  return song?.artist || song?.artist_name || '';
};

const getSongAlbum = (songId: number) => {
  const song = songMap.value.get(songId);
  return song?.album || song?.album_name || '';
};

const getSongDuration = (songId: number) => {
  const song = songMap.value.get(songId);
  if (!song?.duration_secs) return '未知';
  const mins = Math.floor(song.duration_secs / 60);
  const secs = Math.floor(song.duration_secs % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const getSongFilePath = (songId: number) => {
  const song = songMap.value.get(songId);
  return song?.file_path || '';
};

const toggleSession = (sessionId: number) => {
  if (expandedSessionId.value === sessionId) {
    expandedSessionId.value = null;
    searchResults.value = [];
  } else {
    expandedSessionId.value = sessionId;
    searchResults.value = [];
    const song = songMap.value.get(sessions.value.find(s => s.id === sessionId)?.song_id ?? 0);
    if (song) {
      searchForm.value.title = song.title || '';
      searchForm.value.artist = song.artist || song.artist_name || '';
      searchForm.value.album = song.album || song.album_name || '';
    }
  }
};

const toggleSource = (source: string) => {
  const idx = searchForm.value.sources.indexOf(source);
  if (idx >= 0) {
    searchForm.value.sources.splice(idx, 1);
  } else {
    searchForm.value.sources.push(source);
  }
};

const handleSearch = async () => {
  if (!expandedSessionId.value) return;
  isSearching.value = true;
  searchResults.value = [];
  try {
    const { data } = await scrapeApi.search(expandedSessionId.value, {
      title: searchForm.value.title || undefined,
      artist: searchForm.value.artist || undefined,
      album: searchForm.value.album || undefined,
      sources: searchForm.value.sources.length > 0 ? searchForm.value.sources : undefined,
    });
    searchResults.value = data.candidates;
    if (expandedSessionId.value) {
      mobileSearchMetaExpanded.value = {
        ...mobileSearchMetaExpanded.value,
        [expandedSessionId.value]: false,
      };
    }
    await fetchSessions();
  } catch {
    toast.error(t('common.error'));
  } finally {
    isSearching.value = false;
  }
};

const handleApply = async (sessionId: number, candidateIdx: number) => {
  isApplying.value = candidateIdx;
  try {
    const searchResult = searchResults.value[candidateIdx];
    if (!searchResult) {
      toast.error(t('scrape.no_candidates'));
      return;
    }

    const { data } = await scrapeApi.getCandidates(sessionId);
    if (data.items.length === 0) {
      toast.error(t('scrape.no_candidates'));
      return;
    }

    const candidate = data.items.find(c => {
      try {
        const fields: CandidateFields = JSON.parse(c.fields_json);
        return c.source === searchResult.source && fields.song_id === searchResult.song_id;
      } catch {
        return false;
      }
    });

    if (!candidate) {
      toast.error(t('scrape.no_candidates'));
      return;
    }
    await scrapeApi.applyCandidate(sessionId, candidate.id);
    toast.success(t('scrape.applied'));
    await fetchSessions();
  } catch {
    toast.error(t('common.error'));
  } finally {
    isApplying.value = null;
  }
};

const handleConfirm = async (session: ScrapeSession) => {
  if (!session.has_resolved) {
    showForceConfirmModal(session);
    return;
  }
  isConfirming.value = true;
  try {
    await scrapeApi.confirm(session.id, session.version);
    toast.success(t('scrape.confirmed'));
    expandedSessionId.value = null;
    searchResults.value = [];
    await fetchSessions();
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: string } })?.response?.data;
    if (msg === 'no_resolved_data') {
      showForceConfirmModal(session);
    } else {
      toast.error(t('common.error'));
    }
  } finally {
    isConfirming.value = false;
  }
};

const handlePreviewLyrics = async (sessionId: number, candidate: SearchResultItem) => {
  showLyricsModal.value = true;
  lyricsLoading.value = true;
  lyricsContent.value = '';
  lyricsTitle.value = `${candidate.title} - ${candidate.artist || ''}`;
  try {
    const { data } = await scrapeApi.fetchLyrics(sessionId, candidate.source, candidate.song_id);
    lyricsContent.value = data.lyrics || '';
  } catch {
    lyricsContent.value = '';
  } finally {
    lyricsLoading.value = false;
  }
};

const closeLyricsModal = () => {
  showLyricsModal.value = false;
  lyricsContent.value = '';
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending': return 'bg-zinc-500/10 text-zinc-500';
    case 'running': return 'bg-blue-500/10 text-blue-500';
    case 'needs_review': return 'bg-amber-500/10 text-amber-500';
    case 'confirmed': return 'bg-emerald-500/10 text-emerald-500';
    case 'organizing': return 'bg-indigo-500/10 text-indigo-500';
    case 'organized': return 'bg-teal-500/10 text-teal-500';
    case 'organize_failed': return 'bg-rose-500/10 text-rose-500';
    case 'done': return 'bg-primary/10 text-primary';
    case 'cancelled': return 'bg-red-500/10 text-red-500';
    default: return 'bg-zinc-500/10 text-zinc-500';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'pending': return Clock;
    case 'running': return Play;
    case 'needs_review': return AlertCircle;
    case 'confirmed': return CheckCircle2;
    case 'organizing': return Play;
    case 'organized': return CheckCircle2;
    case 'organize_failed': return XCircle;
    case 'done': return CheckCircle2;
    case 'cancelled': return XCircle;
    default: return Clock;
  }
};

const getSourceColor = (source: string) => getSourceColorClass(source);

const sourceBadgeStyle = (source: string) => getSourceBadgeStyle(source);

// ── Tab3: 刮削日志 ────────────────────────────────────────────

const logs = ref<ScrapeLogItem[]>([]);
const logsTotal = ref(0);
const logsPage = ref(1);
const logsPageSize = ref(20);
const logsFilterAction = ref<string>('');
const isLoadingLogs = ref(false);
const expandedLogSessionId = ref<number | null>(null);
const sessionDetail = ref<SessionDetailResponse | null>(null);
const isLoadingDetail = ref(false);

const logActionFilters = [
  { value: '', labelKey: 'scrape.log_filter_all' },
  { value: 'created', labelKey: 'scrape.log_action_created' },
  { value: 'searched', labelKey: 'scrape.log_action_searched' },
  { value: 'applied', labelKey: 'scrape.log_action_applied' },
  { value: 'confirmed', labelKey: 'scrape.log_action_confirmed' },
  { value: 'auto_applied', labelKey: 'scrape.log_action_auto_applied' },
  { value: 'auto_needs_review', labelKey: 'scrape.log_action_auto_needs_review' },
  { value: 'auto_started', labelKey: 'scrape.log_action_auto_started' },
  { value: 'auto_completed', labelKey: 'scrape.log_action_auto_completed' },
  { value: 'auto_failed', labelKey: 'scrape.log_action_failed' },
  { value: 'cancelled', labelKey: 'scrape.log_action_cancelled' },
];

const fetchLogs = async () => {
  isLoadingLogs.value = true;
  try {
    const { data } = await scrapeApi.getLogs({
      page: logsPage.value,
      page_size: logsPageSize.value,
      action: logsFilterAction.value || undefined,
    });
    logs.value = data.items;
    logsTotal.value = data.total;
  } catch {
    toast.error(t('common.error'));
  } finally {
    isLoadingLogs.value = false;
  }
};

const logsTotalPages = computed(() =>
  Math.max(1, Math.ceil(logsTotal.value / logsPageSize.value))
);

const changeLogsPage = (p: number) => {
  if (p < 1 || p > logsTotalPages.value) return;
  logsPage.value = p;
  fetchLogs();
};

const changeLogsFilter = (action: string) => {
  logsFilterAction.value = action;
  logsPage.value = 1;
  fetchLogs();
};

const toggleLogDetail = async (sessionId: number | null) => {
  if (!sessionId) return;
  if (expandedLogSessionId.value === sessionId) {
    expandedLogSessionId.value = null;
    sessionDetail.value = null;
    return;
  }
  expandedLogSessionId.value = sessionId;
  isLoadingDetail.value = true;
  try {
    const { data } = await scrapeApi.getSessionDetail(sessionId);
    sessionDetail.value = data;
  } catch {
    sessionDetail.value = null;
  } finally {
    isLoadingDetail.value = false;
  }
};

const getActionColor = (action: string) => {
  const colors: Record<string, string> = {
    created: 'bg-blue-500/10 text-blue-500',
    searched: 'bg-indigo-500/10 text-indigo-500',
    applied: 'bg-emerald-500/10 text-emerald-500',
    confirmed: 'bg-green-500/10 text-green-500',
    auto_started: 'bg-violet-500/10 text-violet-500',
    auto_applied: 'bg-teal-500/10 text-teal-500',
    auto_needs_review: 'bg-amber-500/10 text-amber-500',
    auto_completed: 'bg-cyan-500/10 text-cyan-500',
    auto_failed: 'bg-red-500/10 text-red-500',
    cancelled: 'bg-red-500/10 text-red-500',
  };
  return colors[action] || 'bg-zinc-500/10 text-zinc-500';
};

const formatLogTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
};

const parseDetail = (json: string | null): Record<string, unknown> | null => {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
};

onMounted(async () => {
  await ensureLoaded();
  searchForm.value.sources = getEnabledKeys();
  fetchAllLibrarySongs();
  fetchSessions();
  libraryStore.fetchArtists({ limit: 1000 });
  libraryStore.fetchAlbums({ limit: 1000 });
  // 检查是否有正在进行的自动刮削
  scrapeApi.getAutoScrapeStatus().then(({ data }) => {
    if (data.running) {
      autoScrapeProgress.value = data;
      isAutoScraping.value = true;
      startAutoScrapePolling();
    }
  }).catch(() => { });
});

onUnmounted(() => {
  stopAutoScrapePolling();
  stopOrganizingPoll();
});
</script>

<template>
  <div class="flex flex-col h-full p-0 md:p-4 overflow-hidden animate-fade-in">
    <!-- 页头 -->
    <header class="pt-2 md:pt-0 flex-none mb-6">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold text-text-primary tracking-tight mb-1 flex items-center gap-3">
            <Search class="w-7 h-7 md:w-8 md:h-8 text-primary" />
            {{ t('scrape.title') }}
          </h1>
          <p class="text-text-secondary text-sm max-w-2xl">
            {{ t('scrape.subtitle') }}
          </p>
        </div>
        <button v-if="authStore.isAdmin" @click="goManageSources"
          class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-border hover:border-primary/30 text-text-secondary hover:text-primary transition-colors">
          <Tag class="w-4 h-4" />
          {{ t('scrape.manage_sources') }}
        </button>
      </div>
    </header>

    <!-- Tab 切换 -->
    <div class="flex-none flex items-center gap-1 mb-5 border-b border-border">
      <button @click="activeTab = 'library'"
        class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px" :class="activeTab === 'library'
          ? 'text-primary border-primary'
          : 'text-text-secondary border-transparent hover:text-text-primary hover:border-border'">
        <Library class="w-4 h-4" />
        {{ t('scrape.tab_library') }}
      </button>
      <button @click="activeTab = 'sessions'"
        class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px" :class="activeTab === 'sessions'
          ? 'text-primary border-primary'
          : 'text-text-secondary border-transparent hover:text-text-primary hover:border-border'">
        <Tag class="w-4 h-4" />
        {{ t('scrape.tab_sessions') }}
        <span v-if="sessions.length > 0"
          class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{{ sessions.length
          }}</span>
      </button>
      <button @click="activeTab = 'logs'; fetchLogs()"
        class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px" :class="activeTab === 'logs'
          ? 'text-primary border-primary'
          : 'text-text-secondary border-transparent hover:text-text-primary hover:border-border'">
        <ScrollText class="w-4 h-4" />
        {{ t('scrape.tab_logs') }}
      </button>
    </div>

    <!-- ═══════════ Tab 1: 音乐库选歌 ═══════════ -->
    <div v-if="activeTab === 'library'" class="flex-1 flex flex-col overflow-hidden">
      <!-- 操作面板 -->
      <div class="flex-none flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-3">
          <span class="text-sm text-text-secondary">
            {{ t('scrape.selected_count', { count: selectedSongIds.size }) }}
          </span>
          <button v-if="selectedSongIds.size > 0" @click="selectedSongIds = new Set()"
            class="text-xs text-text-tertiary hover:text-text-primary transition-colors">
            {{ t('scrape.deselect_all') }}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button @click="fetchAllLibrarySongs" :disabled="isLoadingLibrary"
            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all" :class="isLoadingLibrary
              ? 'bg-primary/50 text-white/70 cursor-not-allowed'
              : 'bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/20'">
            <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': isLoadingLibrary }" />
            {{ t('common.refresh') }}
          </button>
          <button @click="handleCreateScrape" :disabled="selectedSongIds.size === 0 || isCreatingScrape"
            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all" :class="selectedSongIds.size > 0 && !isCreatingScrape
              ? 'bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/20'
              : 'bg-bg-elevate text-text-tertiary cursor-not-allowed border border-border'">
            <RefreshCw v-if="isCreatingScrape" class="w-4 h-4 animate-spin" />
            <Search v-else class="w-4 h-4" />
            {{ isCreatingScrape ? t('scrape.creating') : t('scrape.create_scrape') }}
          </button>
          <button @click="handleAutoScrape" :disabled="selectedSongIds.size === 0 || isAutoScraping"
            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all" :class="selectedSongIds.size > 0 && !isAutoScraping
              ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20'
              : 'bg-bg-elevate text-text-tertiary cursor-not-allowed border border-border'">
            <RefreshCw v-if="isAutoScraping" class="w-4 h-4 animate-spin" />
            <Zap v-else class="w-4 h-4" />
            {{ isAutoScraping ? t('scrape.auto_scraping') : t('scrape.auto_scrape') }}
          </button>
        </div>
      </div>

      <!-- 自动刮削进度面板 -->
      <div v-if="isAutoScraping && autoScrapeProgress"
        class="flex-none mb-4 bg-bg-surface rounded-2xl border border-amber-500/20 p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Zap class="w-4 h-4 text-amber-500" />
            <span class="text-sm font-medium text-text-primary">{{ t('scrape.auto_scrape') }}</span>
          </div>
          <span class="text-xs text-text-secondary">
            {{ t('scrape.auto_scrape_progress', {
              completed: autoScrapeProgress.completed, total:
                autoScrapeProgress.total
            }) }}
          </span>
        </div>

        <div class="w-full h-2 bg-bg-elevate rounded-full overflow-hidden">
          <div class="h-full bg-amber-500 rounded-full transition-all duration-500"
            :style="{ width: `${autoScrapePercent}%` }"></div>
        </div>

        <div v-if="autoScrapeProgress.current_song" class="text-xs text-text-secondary truncate">
          {{ t('scrape.auto_scrape_current', { song: autoScrapeProgress.current_song }) }}
        </div>

        <div class="flex items-center gap-4 text-xs">
          <span class="text-emerald-500">{{ t('scrape.auto_applied') }}: {{ autoScrapeProgress.auto_applied }}</span>
          <span class="text-amber-500">{{ t('scrape.needs_review_count') }}: {{ autoScrapeProgress.needs_review
          }}</span>
          <span class="text-red-500">{{ t('scrape.failed_count') }}: {{ autoScrapeProgress.failed }}</span>
        </div>
      </div>

      <!-- 元数据筛选 -->
      <div class="flex-none mb-3 flex flex-wrap items-center gap-2">
        <Filter class="w-4 h-4 text-text-tertiary flex-shrink-0" />
        <button v-for="opt in metadataFilterOptions" :key="opt.key"
          @click="activeMetadataFilter = opt.key; selectedSongIds = new Set()"
          class="px-3 py-1 rounded-full text-xs font-medium transition-all border" :class="activeMetadataFilter === opt.key
            ? 'bg-primary text-white border-primary shadow-sm'
            : 'bg-bg-elevate text-text-secondary border-border hover:border-primary/30 hover:text-text-primary'">
          {{ t(opt.labelKey) }}
          <span v-if="filterCounts[opt.key]" class="ml-1 opacity-70">{{ filterCounts[opt.key] }}</span>
          <span v-else-if="opt.key === 'all'" class="ml-1 opacity-70">{{ librarySongs.length }}</span>
        </button>
      </div>

      <!-- 可选歌曲列表 -->
      <div class="flex-1 overflow-hidden">
        <SelectableSongList :songs="filteredLibrarySongs" :selected-ids="selectedSongIds" :is-loading="isLoadingLibrary"
          :has-error="hasLibraryError" @retry="retryLibrary" @toggle="toggleSong" @toggle-all="toggleAllSongs" />
      </div>
    </div>

    <!-- ═══════════ Tab 2: 会话管理 ═══════════ -->
    <div v-else-if="activeTab === 'sessions'" class="flex-1 overflow-y-auto pb-24">
      <div class="max-w-5xl mx-auto space-y-4">
        <!-- 筛选 & 刷新 -->
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div class="flex flex-wrap gap-2">
            <button v-for="f in statusFilters" :key="f.value" @click="filterStatus = f.value"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border" :class="filterStatus === f.value
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-bg-surface text-text-secondary border-border hover:border-primary/20'">
              {{ t(f.labelKey) }}{{ filterStatus === f.value ? `(${selectableSessions.length})` : '' }}
            </button>
          </div>
          <button @click="fetchSessions" :disabled="isLoadingSessions"
            class="p-2 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-primary transition-colors"
            :class="{ 'animate-spin': isLoadingSessions }">
            <RefreshCw class="w-4 h-4" />
          </button>
        </div>

        <!-- 批量操作工具栏 -->
        <div v-if="selectedSessionIds.size > 0"
          class="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/20">
          <div class="flex items-center gap-3">
            <input type="checkbox" :checked="isAllSelectableSelected" @change="toggleAllSessionsSelect"
              class="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer" />
            <span class="text-sm text-text-primary font-medium">
              {{ t('scrape.selected_sessions_count', { count: selectedSessionIds.size }) }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button v-if="selectedHasCancellable" @click="showBatchCancelModal" :disabled="isCancelling"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-500/20">
              <XCircle class="w-3.5 h-3.5" />
              {{ t('scrape.batch_cancel') }}
            </button>
            <button v-if="selectedHasDeletable" @click="showBatchDeleteModal" :disabled="isDeleting"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-zinc-500/10 text-zinc-500 hover:bg-zinc-600 hover:text-white border border-zinc-500/20">
              <Trash2 class="w-3.5 h-3.5" />
              {{ t('scrape.batch_delete') }}
            </button>
          </div>
        </div>

        <!-- Session 列表 -->
        <div class="space-y-3">
          <div v-if="isLoadingSessions" class="text-center py-12 text-text-secondary text-sm">
            <RefreshCw class="w-6 h-6 animate-spin mx-auto mb-2" />
            {{ t('common.loading') }}
          </div>

          <div v-else-if="filteredSessions.length === 0" class="text-center py-12 text-text-secondary text-sm">
            {{ t('common.no_data') }}
          </div>

          <div v-for="session in filteredSessions" :key="session.id"
            class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm transition-all hover:border-primary/20">
            <!-- Session 行 -->
            <div class="p-4 flex items-center gap-4 cursor-pointer" @click="toggleSession(session.id)">
              <!-- 复选框（可操作状态显示） -->
              <input v-if="selectableStatuses.has(session.status)" type="checkbox"
                :checked="selectedSessionIds.has(session.id)" @click.stop="toggleSessionSelect(session.id)"
                class="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer flex-shrink-0" />
              <div v-else class="w-4 flex-shrink-0" />

              <div
                class="w-8 h-8 rounded-full bg-bg-elevate flex items-center justify-center text-text-secondary flex-shrink-0">
                <component :is="getStatusIcon(session.status)" class="w-4 h-4" />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-text-primary text-sm truncate">
                    {{ getSongName(session.song_id) }}
                  </span>
                  <span class="text-[10px] text-text-tertiary">#{{ session.id }}</span>
                </div>
                <div class="text-xs text-text-secondary mt-0.5">
                  {{ getSongArtist(session.song_id) }}
                  <span v-if="getSongAlbum(session.song_id)"> · {{ getSongAlbum(session.song_id) }}</span>
                </div>
                <div>
                  <span class="text-xs text-text-secondary">时长：{{ getSongDuration(session.song_id) }}</span>
                </div>
                <div v-if="getSongFilePath(session.song_id)"
                  class="text-xs text-text-tertiary mt-0.5 truncate max-w-[400px]"
                  :title="getSongFilePath(session.song_id)">
                  {{ getSongFilePath(session.song_id) }}
                </div>
              </div>

              <span class="text-[10px] font-medium px-2 py-1 rounded-full flex-shrink-0"
                :class="getStatusColor(session.status)">
                {{ t(`scrape.status_${session.status}`) }}
              </span>

              <!-- 单条取消按钮 -->
              <button v-if="cancellableStatuses.has(session.status)" @click.stop="showCancelModal(session.id)"
                class="p-1.5 rounded-lg hover:bg-red-500/10 text-text-tertiary hover:text-red-500 transition-colors flex-shrink-0"
                :title="t('scrape.cancel')">
                <XCircle class="w-4 h-4" />
              </button>
              <!-- 单条删除按钮（终态会话） -->
              <button v-if="deletableStatuses.has(session.status)" @click.stop="showDeleteModal(session.id)"
                class="p-1.5 rounded-lg hover:bg-zinc-500/10 text-text-tertiary hover:text-zinc-500 transition-colors flex-shrink-0"
                :title="t('scrape.delete')">
                <Trash2 class="w-4 h-4" />
              </button>

              <component :is="expandedSessionId === session.id ? ChevronUp : ChevronDown"
                class="w-4 h-4 text-text-tertiary flex-shrink-0" />
            </div>

            <!-- 展开详情 -->
            <div class="grid transition-all duration-300 ease-in-out"
              :class="expandedSessionId === session.id ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'">
              <div class="overflow-hidden">
                <div class="space-y-4">
                  <!-- 移动端：有搜索结果时折叠搜索元数据栏 -->
                  <button v-if="searchResults.length > 0 && expandedSessionId === session.id"
                    @click.stop="toggleMobileSearchMeta(session.id)"
                    class="md:hidden flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium bg-bg-elevate border border-border text-text-secondary hover:text-primary transition-colors">
                    <component :is="isMobileSearchMetaExpanded(session.id) ? ChevronUp : ChevronDown" class="w-4 h-4" />
                    {{ isMobileSearchMetaExpanded(session.id) ? t('scrape.collapse_search_meta') :
                      t('scrape.expand_search_meta') }}
                  </button>

                  <!-- 搜索表单 -->
                  <div class="grid transition-all duration-300 ease-in-out md:grid-rows-[1fr] md:opacity-100" :class="searchResults.length > 0 && expandedSessionId === session.id
                    ? (isMobileSearchMetaExpanded(session.id) ? 'max-md:grid-rows-[1fr] max-md:opacity-100' : 'max-md:grid-rows-[0fr] max-md:opacity-0')
                    : 'max-md:grid-rows-[1fr] max-md:opacity-100'">
                    <div class="overflow-hidden space-y-3">

                      <h4 class="text-sm font-medium text-text-primary flex items-center gap-1.5">
                        <Search class="w-3.5 h-3.5" />
                        {{ t('scrape.search_title') }}
                      </h4>



                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label class="block text-text-secondary text-xs mb-1">{{ t('scrape.search_title_label')
                          }}</label>
                          <input v-model="searchForm.title" type="text"
                            class="w-full p-2 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none text-sm" />
                        </div>
                        <div>
                          <label class="block text-text-secondary text-xs mb-1">{{ t('scrape.search_artist_label')
                          }}</label>
                          <input v-model="searchForm.artist" type="text"
                            class="w-full p-2 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none text-sm" />
                        </div>
                        <div>
                          <label class="block text-text-secondary text-xs mb-1">{{ t('scrape.search_album_label')
                          }}</label>
                          <input v-model="searchForm.album" type="text"
                            class="w-full p-2 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none text-sm" />
                        </div>
                      </div>

                      <!-- 来源选择 -->
                      <div>
                        <label class="block text-text-secondary text-xs mb-1.5">{{ t('scrape.search_sources') }}</label>
                        <div class="flex flex-wrap gap-2">
                          <button v-for="src in allSources" :key="src.value" @click="toggleSource(src.value)"
                            class="px-2.5 py-1 rounded-md text-xs font-medium transition-all border" :class="searchForm.sources.includes(src.value)
                              ? (sourceBadgeStyle(src.value) ? '' : getSourceColor(src.value))
                              : 'bg-bg-main text-text-tertiary border-border'"
                            :style="searchForm.sources.includes(src.value) ? sourceBadgeStyle(src.value) : undefined">
                            {{ src.label }}
                          </button>
                        </div>
                      </div>
                      <button @click="handleSearch" :disabled="isSearching"
                        class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all" :class="!isSearching
                          ? 'bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/20'
                          : 'bg-bg-elevate text-text-tertiary cursor-not-allowed'">
                        <RefreshCw v-if="isSearching" class="w-4 h-4 animate-spin" />
                        <Search v-else class="w-4 h-4" />
                        {{ isSearching ? t('scrape.searching') : t('scrape.search_btn') }}
                      </button>
                    </div>
                  </div>
                  <!-- 搜索结果 -->
                  <div v-if="searchResults.length > 0" class="space-y-3">
                    <div class="flex items-center justify-between px-2">
                      <h4 class="text-sm font-medium text-text-primary">
                        {{ t('scrape.search_results') }}
                        <span class="text-text-tertiary font-normal ml-1">({{ searchResults.length }})</span>
                      </h4>
                      <div class="flex items-center gap-2">

                        <!-- 确认按钮 -->
                        <div v-if="session.status === 'needs_review'">
                          <button v-if="session.has_resolved" @click.stop="handleConfirm(session)"
                            :disabled="isConfirming"
                            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                            :class="!isConfirming
                              ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                              : 'bg-bg-elevate text-text-tertiary cursor-not-allowed'">
                            <RefreshCw v-if="isConfirming" class="w-4 h-4 animate-spin" />
                            <CheckCircle2 v-else class="w-4 h-4" />
                            {{ isConfirming ? t('scrape.confirming') : t('scrape.confirm_with_data') }}
                          </button>
                          <button v-else @click.stop="handleConfirm(session)" :disabled="isConfirming"
                            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border border-amber-500/20">
                            <AlertCircle class="w-4 h-4" />
                            {{ t('scrape.confirm_with_data') }}
                          </button>
                        </div>

                        <!-- 写入中状态 -->
                        <div v-if="session.status === 'organizing'" class="pt-2 border-t border-border">
                          <div class="flex items-center gap-2 text-sm text-indigo-500">
                            <RefreshCw class="w-4 h-4 animate-spin" />
                            {{ t('scrape.status_organizing') }}
                          </div>
                        </div>

                        <!-- 写入失败状态 -->
                        <div v-if="session.status === 'organize_failed'" class="pt-2 border-t border-border">
                          <div class="flex items-center gap-2 text-sm text-rose-500">
                            <XCircle class="w-4 h-4" />
                            {{ t('scrape.status_organize_failed') }}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3"
                      :class="{ 'max-h-[348px] overflow-y-auto pr-1': searchResults.length > 3 }">
                      <div v-for="(candidate, idx) in searchResults" :key="`${candidate.source}-${candidate.song_id}`"
                        class="bg-bg-main rounded-xl border border-border p-3 space-y-2 hover:border-primary/20 transition-colors">
                        <div class="flex items-start gap-3">
                          <div class="w-12 h-12 rounded-lg bg-bg-elevate overflow-hidden flex-shrink-0">
                            <img v-if="candidate.album_img" :src="candidate.album_img" :alt="candidate.title"
                              class="w-full h-full object-cover" loading="lazy"
                              @error="($event.target as HTMLImageElement).style.display = 'none'" />
                            <div v-else class="w-full h-full flex items-center justify-center text-text-tertiary">
                              <Music2 class="w-5 h-5" />
                            </div>
                          </div>

                          <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium text-text-primary truncate">{{ candidate.title }}</p>
                            <p class="text-xs text-text-secondary truncate">
                              {{ candidate.artist || t('common.unknown_artist') }}
                              <span v-if="candidate.album"> · {{ candidate.album }}</span>
                            </p>
                          </div>
                        </div>

                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="text-[10px] font-medium px-1.5 py-0.5 rounded border"
                            :class="sourceBadgeStyle(candidate.source) ? '' : getSourceColor(candidate.source)"
                            :style="sourceBadgeStyle(candidate.source)">
                            {{ getSourceLabel(candidate.source) }}
                          </span>
                          <span v-if="!candidate.album_img && !getSourceMeta(candidate.source)?.capabilities.cover"
                            class="text-[10px] text-text-tertiary bg-bg-elevate px-1.5 py-0.5 rounded">
                            {{ t('scrape.no_cover_source') }}
                          </span>
                          <span v-if="candidate.year"
                            class="text-[10px] text-text-tertiary bg-bg-elevate px-1.5 py-0.5 rounded">
                            {{ candidate.year }}
                          </span>
                          <span v-if="candidate.duration_secs"
                            class="text-[10px] text-text-tertiary bg-bg-elevate px-1.5 py-0.5 rounded font-mono">
                            {{ formatDuration(candidate.duration_secs) }}
                          </span>
                          <span class="text-[10px] px-1.5 py-0.5 rounded" :class="candidate.lyrics_available
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : 'bg-zinc-500/10 text-zinc-400'">
                            {{ candidate.lyrics_available ? t('scrape.lyrics_available') :
                              t('scrape.lyrics_unavailable') }}
                          </span>
                        </div>

                        <div class="flex items-center gap-2">
                          <span class="text-[10px] text-text-secondary">{{ t('scrape.candidate_score') }}</span>
                          <div class="flex-1 h-1.5 bg-bg-elevate rounded-full overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-500"
                              :class="candidate.score >= 80 ? 'bg-emerald-500' : candidate.score >= 50 ? 'bg-amber-500' : 'bg-red-500'"
                              :style="{ width: `${Math.min(candidate.score, 100)}%` }"></div>
                          </div>
                          <span class="text-[10px] font-mono text-text-primary">{{ candidate.score }}</span>
                        </div>

                        <div class="flex gap-2 pt-1">
                          <button v-if="candidate.lyrics_available"
                            @click.stop="handlePreviewLyrics(session.id, candidate)"
                            class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-bg-elevate text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors border border-border">
                            <Eye class="w-3 h-3" />
                            {{ t('scrape.preview_lyrics') }}
                          </button>
                          <button @click.stop="handleApply(session.id, idx)" :disabled="isApplying === idx"
                            class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                            :class="isApplying !== idx
                              ? 'bg-primary/10 text-primary hover:bg-primary hover:text-white border border-primary/20'
                              : 'bg-bg-elevate text-text-tertiary cursor-not-allowed border border-border'">
                            <RefreshCw v-if="isApplying === idx" class="w-3 h-3 animate-spin" />
                            <CheckCircle2 v-else class="w-3 h-3" />
                            {{ isApplying === idx ? t('scrape.applying') : t('scrape.apply') }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-else-if="!isSearching && expandedSessionId === session.id"
                    class="text-center py-6 text-text-secondary text-xs">
                    {{ t('scrape.no_results') }}
                  </div>


                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════ Tab 3: 刮削日志 ═══════════ -->
    <div v-else-if="activeTab === 'logs'" class="flex-1 overflow-y-auto pb-24">
      <div class="max-w-5xl mx-auto space-y-4">
        <!-- 筛选栏 -->
        <div class="flex flex-wrap gap-2">
          <button v-for="f in logActionFilters" :key="f.value" @click="changeLogsFilter(f.value)"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border" :class="logsFilterAction === f.value
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-bg-surface text-text-secondary border-border hover:border-primary/20'">
            {{ t(f.labelKey) }}
          </button>
        </div>

        <!-- 加载中 -->
        <div v-if="isLoadingLogs" class="text-center py-12 text-text-secondary text-sm">
          <RefreshCw class="w-6 h-6 animate-spin mx-auto mb-2" />
          {{ t('common.loading') }}
        </div>

        <!-- 空状态 -->
        <div v-else-if="logs.length === 0" class="text-center py-12 text-text-secondary text-sm">
          <ScrollText class="w-8 h-8 mx-auto mb-2 text-text-tertiary" />
          {{ t('scrape.log_empty') }}
        </div>

        <!-- 日志列表 -->
        <div v-else class="space-y-2">
          <div v-for="log in logs" :key="log.id"
            class="bg-bg-surface rounded-xl border border-border overflow-hidden transition-all hover:border-primary/20">
            <div class="p-3 flex items-center gap-3 cursor-pointer" @click="toggleLogDetail(log.session_id)">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-bg-elevate flex items-center justify-center">
                <Zap v-if="log.action.startsWith('auto_')" class="w-3.5 h-3.5 text-amber-500" />
                <ScrollText v-else class="w-3.5 h-3.5 text-text-secondary" />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-medium px-2 py-0.5 rounded-full" :class="getActionColor(log.action)">
                    {{ t(`scrape.log_action_${log.action}`, log.action) }}
                  </span>
                  <span v-if="log.session_id" class="text-[10px] text-text-tertiary">
                    #{{ log.session_id }}
                  </span>
                </div>
                <div class="text-xs text-text-secondary mt-0.5 truncate">
                  <span v-if="log.song_title" class="text-text-primary">{{ log.song_title }}</span>
                  <span v-if="log.song_title && parseDetail(log.detail_json)"> · </span>
                  <template v-if="parseDetail(log.detail_json)">
                    <span v-if="parseDetail(log.detail_json)?.result_count !== undefined">
                      {{ parseDetail(log.detail_json)?.result_count }} {{ t('scrape.search_results') }}
                    </span>
                    <span v-else-if="parseDetail(log.detail_json)?.source">
                      {{ getSourceLabel(String(parseDetail(log.detail_json)?.source)) }}
                    </span>
                    <span v-else-if="parseDetail(log.detail_json)?.total !== undefined">
                      {{ parseDetail(log.detail_json)?.total }} {{ t('scrape.songs') }}
                    </span>
                  </template>
                </div>
              </div>

              <span class="text-[10px] text-text-tertiary flex-shrink-0 whitespace-nowrap">
                {{ formatLogTime(log.created_at) }}
              </span>

              <component :is="expandedLogSessionId === log.session_id ? ChevronUp : ChevronDown"
                class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
            </div>

            <!-- 展开的会话详情 -->
            <div v-if="log.session_id && expandedLogSessionId === log.session_id"
              class="border-t border-border px-4 py-3 bg-bg-main space-y-3">
              <div v-if="isLoadingDetail" class="text-center py-4 text-text-secondary text-sm">
                <RefreshCw class="w-4 h-4 animate-spin mx-auto mb-1" />
              </div>
              <template v-else-if="sessionDetail">
                <div class="flex items-center gap-3">
                  <span class="text-xs text-text-secondary">{{ t('scrape.session_id') }}:</span>
                  <span class="text-xs font-mono text-text-primary">#{{ sessionDetail.session.id }}</span>
                  <span class="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    :class="getStatusColor(sessionDetail.session.status)">
                    {{ t(`scrape.status_${sessionDetail.session.status}`) }}
                  </span>
                </div>
                <div v-if="sessionDetail.song" class="text-xs text-text-secondary">
                  {{ sessionDetail.song.title }} · {{ sessionDetail.song.artist || '' }}
                </div>

                <!-- 已应用结果 -->
                <div v-if="sessionDetail.resolved.length > 0" class="space-y-1">
                  <h5 class="text-xs font-medium text-text-primary">{{ t('scrape.log_resolved') }}</h5>
                  <div v-for="r in sessionDetail.resolved" :key="r.id"
                    class="text-[10px] bg-bg-surface rounded-lg px-3 py-2 border border-border">
                    <span class="text-emerald-500">{{ r.origin }}</span>
                    <span v-if="r.confidence_label" class="ml-2 text-text-tertiary">{{ r.confidence_label }}</span>
                    <span class="ml-2 text-text-tertiary">{{ formatLogTime(r.created_at) }}</span>
                  </div>
                </div>

                <!-- 操作历史 -->
                <div v-if="sessionDetail.logs.length > 0" class="space-y-1">
                  <h5 class="text-xs font-medium text-text-primary">{{ t('scrape.log_timeline') }}</h5>
                  <div v-for="sl in sessionDetail.logs" :key="sl.id" class="text-[10px] flex items-center gap-2 py-1">
                    <span class="text-text-tertiary w-32 flex-shrink-0">{{ formatLogTime(sl.created_at) }}</span>
                    <span class="px-1.5 py-0.5 rounded-full" :class="getActionColor(sl.action)">
                      {{ t(`scrape.log_action_${sl.action}`, sl.action) }}
                    </span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div v-if="logsTotalPages > 1" class="flex items-center justify-center gap-2 pt-4">
          <button @click="changeLogsPage(logsPage - 1)" :disabled="logsPage <= 1"
            class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors" :class="logsPage > 1
              ? 'bg-bg-surface text-text-primary border-border hover:border-primary/30'
              : 'bg-bg-main text-text-tertiary border-border cursor-not-allowed'">
            {{ t('scrape.log_prev') }}
          </button>
          <span class="text-xs text-text-secondary px-3">
            {{ logsPage }} / {{ logsTotalPages }}
          </span>
          <button @click="changeLogsPage(logsPage + 1)" :disabled="logsPage >= logsTotalPages"
            class="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors" :class="logsPage < logsTotalPages
              ? 'bg-bg-surface text-text-primary border-border hover:border-primary/30'
              : 'bg-bg-main text-text-tertiary border-border cursor-not-allowed'">
            {{ t('scrape.log_next') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 歌词预览弹窗 -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="showLyricsModal" class="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
          @click="closeLyricsModal">
        </div>
      </transition>
      <transition name="slide-up">
        <div v-if="showLyricsModal"
          class="fixed inset-x-4 bottom-4 top-auto md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[500px] md:max-h-[70vh] z-[111] bg-bg-surface rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
          <div class="flex items-center justify-between p-4 border-b border-border">
            <div class="flex items-center gap-2 min-w-0">
              <FileText class="w-4 h-4 text-primary flex-shrink-0" />
              <h3 class="font-medium text-text-primary text-sm truncate">{{ lyricsTitle }}</h3>
            </div>
            <button @click="closeLyricsModal"
              class="p-1.5 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-text-primary transition-colors">
              <X class="w-4 h-4" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-4 min-h-[200px] max-h-[50vh]">
            <div v-if="lyricsLoading" class="flex items-center justify-center py-12 text-text-secondary text-sm">
              <RefreshCw class="w-5 h-5 animate-spin mr-2" />
              {{ t('scrape.lyrics_loading') }}
            </div>
            <div v-else-if="!lyricsContent" class="text-center py-12 text-text-secondary text-sm">
              {{ t('scrape.lyrics_empty') }}
            </div>
            <pre v-else class="text-sm text-text-primary whitespace-pre-wrap leading-relaxed font-sans">{{ lyricsContent }}
        </pre>
          </div>

          <div class="p-3 border-t border-border">
            <button @click="closeLyricsModal"
              class="w-full py-2 rounded-xl text-sm font-medium bg-bg-elevate text-text-primary hover:bg-bg-main transition-colors">
              {{ t('scrape.close') }}
            </button>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 取消确认弹窗 -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="cancelModal.visible" class="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
          @click="closeCancelModal"></div>
      </transition>
      <transition name="slide-up">
        <div v-if="cancelModal.visible"
          class="fixed inset-x-4 bottom-4 top-auto md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[400px] z-[111] bg-bg-surface rounded-2xl border border-border shadow-2xl overflow-hidden">
          <div class="flex items-center gap-3 p-5 border-b border-border">
            <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
              <XCircle class="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h3 class="font-medium text-text-primary text-sm">{{ t('scrape.cancel') }}</h3>
              <p class="text-xs text-text-secondary mt-0.5">
                {{ cancelModal.isBatch
                  ? t('scrape.batch_cancel_confirm', { count: selectedSessionIds.size })
                  : t('scrape.cancel_confirm') }}
              </p>
            </div>
          </div>
          <div class="flex gap-3 p-4">
            <button @click="closeCancelModal"
              class="flex-1 py-2 rounded-xl text-sm font-medium bg-bg-elevate text-text-primary hover:bg-bg-main transition-colors">
              {{ t('scrape.close') }}
            </button>
            <button @click="confirmCancel" :disabled="isCancelling"
              class="flex-1 py-2 rounded-xl text-sm font-medium transition-all bg-red-500 hover:bg-red-600 text-white">
              <RefreshCw v-if="isCancelling" class="w-4 h-4 animate-spin mx-auto" />
              <span v-else>{{ cancelModal.isBatch ? t('scrape.batch_cancel') : t('scrape.cancel') }}</span>
            </button>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 无候选二次确认弹窗 -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="forceConfirmModal.visible" class="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
          @click="closeForceConfirmModal"></div>
      </transition>
      <transition name="slide-up">
        <div v-if="forceConfirmModal.visible"
          class="fixed inset-x-4 bottom-4 top-auto md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[420px] z-[111] bg-bg-surface rounded-2xl border border-border shadow-2xl overflow-hidden">
          <div class="flex items-center gap-3 p-5 border-b border-border">
            <div class="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <AlertCircle class="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h3 class="font-medium text-text-primary text-sm">{{ t('scrape.confirm_no_resolved_title') }}</h3>
              <p class="text-xs text-text-secondary mt-1 leading-relaxed">
                {{ t('scrape.confirm_no_resolved_msg') }}
              </p>
            </div>
          </div>
          <div class="flex gap-3 p-4">
            <button @click="closeForceConfirmModal"
              class="flex-1 py-2 rounded-xl text-sm font-medium bg-bg-elevate text-text-primary hover:bg-bg-main transition-colors">
              {{ t('scrape.close') }}
            </button>
            <button @click="confirmForce" :disabled="isConfirming"
              class="flex-1 py-2 rounded-xl text-sm font-medium transition-all bg-amber-500 hover:bg-amber-600 text-white">
              <RefreshCw v-if="isConfirming" class="w-4 h-4 animate-spin mx-auto" />
              <span v-else>{{ t('scrape.confirm_force') }}</span>
            </button>
          </div>
        </div>
      </transition>
    </Teleport>

    <!-- 删除确认弹窗 -->
    <Teleport to="body">
      <transition name="fade">
        <div v-if="deleteModal.visible" class="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
          @click="closeDeleteModal"></div>
      </transition>
      <transition name="slide-up">
        <div v-if="deleteModal.visible"
          class="fixed inset-x-4 bottom-4 top-auto md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[400px] z-[111] bg-bg-surface rounded-2xl border border-border shadow-2xl overflow-hidden">
          <div class="flex items-center gap-3 p-5 border-b border-border">
            <div class="w-10 h-10 rounded-full bg-zinc-500/10 flex items-center justify-center flex-shrink-0">
              <Trash2 class="w-5 h-5 text-zinc-500" />
            </div>
            <div>
              <h3 class="font-medium text-text-primary text-sm">{{ t('scrape.delete') }}</h3>
              <p class="text-xs text-text-secondary mt-0.5">
                {{ deleteModal.isBatch
                  ? t('scrape.batch_delete_confirm', { count: selectedSessionIds.size })
                  : t('scrape.delete_confirm') }}
              </p>
            </div>
          </div>
          <div class="flex gap-3 p-4">
            <button @click="closeDeleteModal"
              class="flex-1 py-2 rounded-xl text-sm font-medium bg-bg-elevate text-text-primary hover:bg-bg-main transition-colors">
              {{ t('scrape.close') }}
            </button>
            <button @click="confirmDelete" :disabled="isDeleting"
              class="flex-1 py-2 rounded-xl text-sm font-medium transition-all bg-zinc-600 hover:bg-zinc-700 text-white">
              <RefreshCw v-if="isDeleting" class="w-4 h-4 animate-spin mx-auto" />
              <span v-else>{{ deleteModal.isBatch ? t('scrape.batch_delete') : t('scrape.delete') }}</span>
            </button>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
