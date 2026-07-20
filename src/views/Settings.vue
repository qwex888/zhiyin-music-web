
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Settings, Globe, Palette, Monitor, Moon, Sun, RefreshCw, CheckCircle2, XCircle, Sliders, Save, HardDrive, Music, Shield, Plus, Trash2, Sparkles, Lock, Eye, EyeOff, KeyRound, ChevronRight, FlaskConical, FolderOpen, ArrowUpCircle, Star, MessageCircle, ExternalLink } from 'lucide-vue-next';
import DirBrowser from '@/components/common/DirBrowser.vue';
import { useTheme } from '@/composables/useTheme';
import { usePlayerStore } from '@/stores/player';
import { useSystemStore } from '@/stores/system';
import { useAuthStore } from '@/stores/auth';
import { useLibraryStore } from '@/stores/library';
import { useOfflineStore } from '@/stores/offline';
import { clearLocalLibrary } from '@/offline/db';
import { clearAllMediaCache } from '@/offline/media-cache';
import { systemApi, type HealthInfo } from '@/api/system';
import { authApi } from '@/api/auth';
import { useToast } from '@/composables/useToast';
import { ref, onMounted, onUnmounted, reactive, computed } from 'vue';
import type { SystemConfig, UpdateConfigParams } from '@/types/config';
import type { ScanSnapshot } from '@/types';
import dayjs from 'dayjs';
import logoUrl from '@/assets/logo.svg';

const { t, locale } = useI18n();
const { theme, setTheme } = useTheme();
const playerStore = usePlayerStore();
const systemStore = useSystemStore();
const authStore = useAuthStore();
const isAdmin = computed(() => authStore.isAdmin);
const libraryStore = useLibraryStore();
const offlineStore = useOfflineStore();

const qualityOptions = [
  { value: 'low', short: '128k' },
  { value: 'medium', short: '192k' },
  { value: 'high', short: '320k' },
  { value: 'lossless', short: 'FLAC' },
  { value: 'original', short: 'ORI' },
] as const;
const toast = useToast();
const isChecking = ref(false);
const healthInfo = ref<HealthInfo | null>(null);
const isLoadingConfig = ref(true);
const isSaving = ref(false);
const scanStatus = ref<ScanSnapshot | null>(null);
let scanPollTimer: ReturnType<typeof setInterval> | null = null;
const config = ref<SystemConfig | null>(null);
const newRootPath = ref('');
const showDirBrowser = ref(false);
const latestVersion = ref<string | null>(null);

const GITHUB_REPO_URL = 'https://github.com/qwex888/zhiyin-music-web';
const GITHUB_ISSUES_URL = 'https://github.com/qwex888/zhiyin-music-web/issues';

const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

const hasUpdate = computed(() => {
  if (!latestVersion.value || !healthInfo.value?.version) return false;
  return compareVersions(latestVersion.value, healthInfo.value.version) > 0;
});

const VERSION_CACHE_KEY = 'zhiyin_latest_version';
// 时间戳，1小时
const VERSION_CACHE_TTL = 1 * 60 * 60 * 1000;

const checkLatestVersion = async () => {
  // const API_URL = 'https://github.com/qwex888/zhiyin-music-web/releases/latest';
  const API_URL = 'https://api.github.com/repos/qwex888/zhiyin-music-web/releases/latest';

  try {
    const cached = localStorage.getItem(VERSION_CACHE_KEY);
    if (cached) {
      const { version, etag, ts } = JSON.parse(cached);
      if (Date.now() - ts < VERSION_CACHE_TTL) {
        latestVersion.value = version;
        return;
      }
      const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
      if (etag) headers['If-None-Match'] = etag;
      const res = await fetch(API_URL, { headers });
      console.log('checkLatestVersion', res);
      if (res.status === 304) {
        localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify({ version, etag, ts: Date.now() }));
        latestVersion.value = version;
        return;
      }
      if (!res.ok) {
        latestVersion.value = version;
        return;
      }
      const data = await res.json();
      const tag = data.tag_name?.replace(/^v/, '') || null;
      const newEtag = res.headers.get('etag') || etag;
      localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify({ version: tag, etag: newEtag, ts: Date.now() }));
      latestVersion.value = tag;
    } else {
      const res = await fetch(API_URL, { headers: { Accept: 'application/vnd.github.v3+json' } });
      if (!res.ok) return;
      console.log('checkLatestVersion else', res);
      const data = await res.json();
      const tag = data.tag_name?.replace(/^v/, '') || null;
      const etag = res.headers.get('etag') || '';
      localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify({ version: tag, etag, ts: Date.now() }));
      latestVersion.value = tag;
    }
  } catch {
    // network error, silently ignore
  }
};

const isScanning = computed(() => scanStatus.value?.scanning === true);

const scanProgressPercent = computed(() => {
  if (!scanStatus.value || !isScanning.value) return 0;
  const { processed, files_to_process } = scanStatus.value;
  if (files_to_process <= 0) return 0;
  return Math.min(Math.round((processed / files_to_process) * 100), 100);
});

const lastScanTime = computed(() => {
  if (!scanStatus.value?.finished_at) return t('settings.never');
  return dayjs(scanStatus.value.finished_at).format('YYYY-MM-DD HH:mm:ss');
});

// Form state
const formState = reactive({
  logging: {
    level: 'info',
    modules: [] as string[]
  },
  maintenance: {
    enabled: false,
    enable_vacuum: false,
    history_retention_days: 0,
    interval_hours: 0,
    recommendation_retention_days: 0,
    vacuum_threshold: 0
  },
  recommend: {
    job_interval_hours: 0,
    max_results: 0,
    play_threshold: 0
  },
  scan: {
    interval_hours: 0,
    min_file_size: 1024,
    mode: '',
    roots: [] as string[],
    skip_small_files: true,
    scan_strm: true,
    strm_mode: 'proxy' as 'proxy' | 'redirect',
    strm_probe_remote: true,
  },
  security: {
    token_expiry_hours: 168,
    cors_origins: [] as string[],
    login_rate_limit: 10,
    login_rate_window_secs: 300,
    stream_token_ttl_secs: 180
  },
  scrape: {
    metadata_format: "json" as const,
    sidecar_for_all: false
  },
  subsonic: {
    enabled: true
  },
  transcode: {
    cache_strategy: 'smart',
    cache_threshold: 0,
    enabled: false,
    max_concurrent_transcodes: 0
  },
  web: {
    enabled: true
  }
});

const corsOriginsInput = ref('');
const loggingModulesInput = ref('');

const savedFormSnapshot = ref('');

const takeFormSnapshot = () => {
  savedFormSnapshot.value = JSON.stringify({
    logging: formState.logging,
    maintenance: formState.maintenance,
    recommend: formState.recommend,
    scan: formState.scan,
    scrape: formState.scrape,
    security: formState.security,
    subsonic: formState.subsonic,
    transcode: formState.transcode,
    web: formState.web,
  });
};

const hasConfigChanged = computed(() => {
  if (!savedFormSnapshot.value) return false;
  const current = JSON.stringify({
    logging: formState.logging,
    maintenance: formState.maintenance,
    recommend: formState.recommend,
    scan: formState.scan,
    scrape: formState.scrape,
    security: formState.security,
    subsonic: formState.subsonic,
    transcode: formState.transcode,
    web: formState.web,
  });
  return current !== savedFormSnapshot.value;
});

const changeLanguage = (lang: string) => {
  locale.value = lang;
};

const addRoot = () => {
  if (newRootPath.value && !formState.scan.roots.includes(newRootPath.value)) {
    formState.scan.roots.push(newRootPath.value);
    newRootPath.value = '';
  }
};

const onDirSelected = (path: string) => {
  if (path && !formState.scan.roots.includes(path)) {
    formState.scan.roots.push(path);
  }
};

const removeRoot = (index: number) => {
  formState.scan.roots.splice(index, 1);
};

const checkHealth = async (showToast = false) => {
  if (isChecking.value) return;
  isChecking.value = true;
  try {
    const { data } = await systemApi.getHealth();
    healthInfo.value = data;
    systemStore.setConnected(true);
    if (showToast) {
      toast.success(t('settings.backend_connected_success'));
    }
  } catch (e) {
    systemStore.setConnected(false);
    healthInfo.value = null;
    if (showToast) {
      toast.error(t('settings.backend_connect_failed'));
    }
  } finally {
    isChecking.value = false;
  }
};

const fetchConfig = async () => {
  isLoadingConfig.value = true;
  try {
    const { data } = await systemApi.getConfig();
    config.value = data;
    
    // Initialize form state
    if (data) {
      Object.assign(formState.logging, data.logging);
      Object.assign(formState.maintenance, data.maintenance);
      Object.assign(formState.recommend, data.recommend);
      Object.assign(formState.scan, data.scan);
      Object.assign(formState.security, data.security);
      Object.assign(formState.subsonic, data.subsonic);
      Object.assign(formState.transcode, data.transcode);
      Object.assign(formState.web, data.web);
      if (data.scrape) Object.assign(formState.scrape, data.scrape);

      corsOriginsInput.value = (data.security?.cors_origins || []).join(', ');
      loggingModulesInput.value = (data.logging?.modules || []).join(', ');
      takeFormSnapshot();
    }
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isLoadingConfig.value = false;
  }
};

const saveConfig = async () => {
  isSaving.value = true;
  try {
    const updateParams: UpdateConfigParams = {
      logging: {
        ...formState.logging,
        modules: loggingModulesInput.value
          .split(',')
          .map(v => v.trim())
          .filter(Boolean)
      },
      maintenance: formState.maintenance,
      recommend: formState.recommend,
      scan: formState.scan,
      security: {
        ...formState.security,
        cors_origins: corsOriginsInput.value
          .split(',')
          .map(v => v.trim())
          .filter(Boolean)
      },
      scrape: formState.scrape,
      subsonic: formState.subsonic,
      transcode: formState.transcode,
      web: formState.web
    };
    
    await systemApi.updateConfig(updateParams);
    toast.success(t('settings.config_saved'));
    await fetchConfig(); // Refresh config to get updated state
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isSaving.value = false;
  }
};

const fetchScanStatus = async () => {
  try {
    const { data } = await systemApi.getScanStatus();
    scanStatus.value = data;
    if (data.scanning) {
      startScanPolling();
    } else {
      stopScanPolling();
    }
  } catch (e) {
    console.error(e);
  }
};

const startScanPolling = () => {
  if (scanPollTimer) return;
  scanPollTimer = setInterval(fetchScanStatus, 5000);
};

const stopScanPolling = () => {
  if (scanPollTimer) {
    clearInterval(scanPollTimer);
    scanPollTimer = null;
  }
};

const triggerScan = async () => {
  if (isScanning.value) return;
  try {
    await systemApi.triggerScan();
    toast.success(t('settings.scan_started'));
    await fetchScanStatus();
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  }
};

// Password change
const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const isChangingPassword = ref(false);
const showPasswordForm = ref(false);
const showOldPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);

const passwordValidation = computed(() => {
  const { oldPassword, newPassword, confirmPassword } = passwordForm;
  if (!oldPassword || !newPassword || !confirmPassword) return null;
  if (newPassword.length < 8) return t('auth.password_too_short', { min: 8 });
  if (!/[a-zA-Z]/.test(newPassword)) return t('auth.password_need_letter');
  if (!/\d/.test(newPassword)) return t('auth.password_need_digit');
  if (newPassword !== confirmPassword) return t('auth.password_mismatch');
  return '';
});

const canSubmitPassword = computed(() => {
  const { oldPassword, newPassword, confirmPassword } = passwordForm;
  return oldPassword && newPassword && confirmPassword && passwordValidation.value === '';
});

const changePassword = async () => {
  if (!canSubmitPassword.value) {
    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error(t('settings.fields_incomplete'));
    } else if (passwordValidation.value) {
      toast.error(passwordValidation.value);
    }
    return;
  }
  isChangingPassword.value = true;
  try {
    await authApi.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
    toast.success(t('settings.password_changed'));
    passwordForm.oldPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
    showOldPassword.value = false;
    showNewPassword.value = false;
    showConfirmPassword.value = false;
    showPasswordForm.value = false;
  } catch (e: any) {
    if (e.response?.status === 400 || e.response?.status === 401) {
      toast.error(t('settings.wrong_password'));
    } else {
      toast.error(t('settings.password_change_failed'));
    }
  } finally {
    isChangingPassword.value = false;
  }
};

onMounted(() => {
  if (isAdmin.value) {
    checkHealth();
    fetchConfig();
    fetchScanStatus();
  }
  checkLatestVersion();
});

// ── 危险操作：重置所有数据 ──────────────────────────────────
const showResetConfirm = ref(false);
const resetConfirmInput = ref('');
const isResetting = ref(false);

const handleResetAll = async () => {
  if (resetConfirmInput.value !== 'RESET') return;
  isResetting.value = true;
  try {
    const { data } = await systemApi.resetAllData();
    if (data.success) {
      // 停止播放并清空播放器状态
      playerStore.clearQueue();

      // 清空本地库元数据（IndexedDB）
      await clearLocalLibrary();

      // 清空音频/封面媒体缓存（CacheStorage）
      await clearAllMediaCache();

      // 重置前端 store 数据
      libraryStore.songs = [];
      libraryStore.albums = [];
      libraryStore.artists = [];
      libraryStore.totalSongs = 0;

      // 刷新离线 store 状态
      await offlineStore.refreshMeta();

      toast.success(t('settings.reset_success'));
      showResetConfirm.value = false;
      resetConfirmInput.value = '';
      await fetchConfig();
    } else {
      toast.error(data.message);
    }
  } catch {
    toast.error(t('settings.reset_failed'));
  } finally {
    isResetting.value = false;
  }
};

onUnmounted(() => {
  stopScanPolling();
});
</script>

<template>
  <div class="p-4 md:p-8 pb-24 max-w-5xl mx-auto animate-fade-in">
    <header class="mb-8 md:mb-12">
      <div class="flex flex-col items-center gap-2 mb-6">
        <img :src="logoUrl" alt="Logo" class="w-14 h-14 md:w-16 md:h-16 drop-shadow-lg" />
        <span class="text-lg md:text-xl font-bold tracking-widest text-primary">{{ t('settings.app_name') }}</span>
      </div>
      <div class="text-center md:text-left">
        <h1 class="text-3xl md:text-4xl font-bold text-text-primary tracking-tight mb-2 flex items-center justify-center md:justify-start gap-3">
          <Settings class="w-8 h-8 md:w-10 md:h-10 text-primary" />
          {{ t('settings.title') }}
        </h1>
        <p class="text-text-secondary text-sm md:text-base max-w-2xl">
          {{ t('settings.subtitle') }}
        </p>
      </div>
    </header>

    <div class="space-y-8">

      <!-- Account Security -->
      <section>
        <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2 mb-6 flex items-center gap-2">
          <Lock class="w-5 h-5 text-emerald-500" />
          {{ t('settings.account_security') }}
        </h3>

        <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm">
          <!-- User Info Bar -->
          <div class="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div class="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary-gradient flex items-center justify-center shadow-md shadow-primary/15 flex-shrink-0">
                <span class="text-lg sm:text-xl font-bold text-white uppercase">{{ authStore.user?.username?.charAt(0) || '?' }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm sm:text-base font-semibold text-text-primary truncate">{{ authStore.user?.display_name || authStore.user?.username || '-' }}</h3>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-xs text-text-secondary truncate">{{ authStore.user?.username }}</span>
                  <span class="text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    :class="authStore.user?.role === 'admin'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-bg-elevate text-text-secondary'"
                  >{{ authStore.user?.role || '-' }}</span>
                </div>
              </div>
            </div>
            <button
              @click="showPasswordForm = !showPasswordForm"
              class="flex items-center justify-center sm:justify-start gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 w-full sm:w-auto flex-shrink-0"
              :class="showPasswordForm
                ? 'bg-primary text-white shadow-sm'
                : 'bg-bg-elevate text-text-primary hover:bg-primary hover:text-white border border-border'"
            >
              <KeyRound class="w-4 h-4" />
              {{ t('settings.change_password') }}
              <ChevronRight
                class="w-4 h-4 transition-transform duration-300"
                :class="showPasswordForm ? 'rotate-90' : ''"
              />
            </button>
          </div>

          <!-- Expandable Password Form -->
          <div
            class="grid transition-all duration-300 ease-in-out"
            :class="showPasswordForm ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
          >
            <div class="overflow-hidden">
              <div class="px-5 pb-5 pt-1 border-t border-border">
                <p class="text-xs text-text-secondary mb-4 mt-3">{{ t('settings.change_password_desc') }}</p>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <!-- Current Password -->
                  <div>
                    <label class="block text-text-secondary text-xs mb-1.5">{{ t('settings.current_password') }}</label>
                    <div class="relative">
                      <input
                        v-model="passwordForm.oldPassword"
                        :type="showOldPassword ? 'text' : 'password'"
                        :placeholder="t('settings.current_password_placeholder')"
                        class="w-full p-2.5 pr-10 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none transition-colors text-sm"
                      />
                      <button
                        type="button"
                        @click="showOldPassword = !showOldPassword"
                        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <EyeOff v-if="showOldPassword" class="w-4 h-4" />
                        <Eye v-else class="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <!-- New Password -->
                  <div>
                    <label class="block text-text-secondary text-xs mb-1.5">{{ t('settings.new_password') }}</label>
                    <div class="relative">
                      <input
                        v-model="passwordForm.newPassword"
                        :type="showNewPassword ? 'text' : 'password'"
                        :placeholder="t('settings.new_password_placeholder')"
                        class="w-full p-2.5 pr-10 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none transition-colors text-sm"
                      />
                      <button
                        type="button"
                        @click="showNewPassword = !showNewPassword"
                        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <EyeOff v-if="showNewPassword" class="w-4 h-4" />
                        <Eye v-else class="w-4 h-4" />
                      </button>
                    </div>
                    <p class="text-[10px] text-text-tertiary mt-1">{{ t('auth.password_hint') }}</p>
                  </div>

                  <!-- Confirm New Password -->
                  <div>
                    <label class="block text-text-secondary text-xs mb-1.5">{{ t('settings.confirm_new_password') }}</label>
                    <div class="relative">
                      <input
                        v-model="passwordForm.confirmPassword"
                        :type="showConfirmPassword ? 'text' : 'password'"
                        :placeholder="t('settings.confirm_new_password_placeholder')"
                        class="w-full p-2.5 pr-10 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none transition-colors text-sm"
                        @keyup.enter="changePassword"
                      />
                      <button
                        type="button"
                        @click="showConfirmPassword = !showConfirmPassword"
                        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <EyeOff v-if="showConfirmPassword" class="w-4 h-4" />
                        <Eye v-else class="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Validation + Submit row -->
                <div class="flex items-center justify-between mt-4 gap-4">
                  <p
                    v-if="passwordValidation && passwordValidation !== ''"
                    class="text-xs text-red-500 flex items-center gap-1 flex-1"
                  >
                    <XCircle class="w-3.5 h-3.5 flex-shrink-0" />
                    {{ passwordValidation }}
                  </p>
                  <div v-else class="flex-1"></div>
                  <button
                    @click="changePassword"
                    :disabled="!canSubmitPassword || isChangingPassword"
                    class="px-6 py-2.5 rounded-xl font-medium transition-all text-sm flex items-center gap-2 active:scale-[0.98] flex-shrink-0"
                    :class="canSubmitPassword && !isChangingPassword
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30'
                      : 'bg-bg-elevate text-text-tertiary cursor-not-allowed'"
                  >
                    <RefreshCw v-if="isChangingPassword" class="w-4 h-4 animate-spin" />
                    <Lock v-else class="w-4 h-4" />
                    {{ isChangingPassword ? t('settings.password_changing') : t('settings.change_password') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Appearance & Interface -->
      <section class="space-y-6">
        <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2 mb-4 flex items-center gap-2">
           <Palette class="w-5 h-5 text-accent-orange" />
           {{ t('settings.appearance') }}
        </h3>
        
        <div class="flex flex-wrap gap-6">
          <!-- Theme Selection -->
          <div class="flex-1 min-w-[300px] bg-bg-surface rounded-2xl border border-border overflow-hidden hover:border-primary/20 transition-colors shadow-sm">
            <div class="p-6">
              <h2 class="text-base font-medium text-text-primary mb-4">{{ t('settings.theme') }}</h2>
              <div class="grid grid-cols-2 gap-4">
                <button 
                  @click="setTheme('light')"
                  class="group relative flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all duration-300"
                  :class="theme === 'light' ? 'bg-zinc-50 border-primary shadow-inner' : 'bg-bg-main border-transparent hover:bg-bg-elevate'"
                >
                  <div class="w-full aspect-video bg-white rounded-lg border border-zinc-200 shadow-sm flex items-center justify-center overflow-hidden">
                     <div class="w-3/4 h-3/4 bg-zinc-50 rounded-md flex flex-col gap-1 p-2">
                        <div class="w-1/3 h-2 bg-zinc-200 rounded-full"></div>
                        <div class="w-full h-16 bg-zinc-100 rounded-md mt-1"></div>
                     </div>
                  </div>
                  <div class="flex items-center gap-2">
                     <Sun class="w-4 h-4" :class="theme === 'light' ? 'text-primary' : 'text-text-secondary'" />
                     <span class="text-sm font-medium" :class="theme === 'light' ? 'text-primary' : 'text-text-secondary'">{{ t('settings.light') }}</span>
                  </div>
                  <div v-if="theme === 'light'" class="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary"></div>
                </button>

                <button 
                  @click="setTheme('dark')"
                  class="group relative flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all duration-300"
                  :class="theme === 'dark' ? 'bg-zinc-900 border-primary shadow-inner' : 'bg-bg-main border-transparent hover:bg-bg-elevate'"
                >
                   <div class="w-full aspect-video bg-zinc-950 rounded-lg border border-zinc-800 shadow-sm flex items-center justify-center overflow-hidden">
                     <div class="w-3/4 h-3/4 bg-zinc-900 rounded-md flex flex-col gap-1 p-2">
                        <div class="w-1/3 h-2 bg-zinc-700 rounded-full"></div>
                        <div class="w-full h-16 bg-zinc-800 rounded-md mt-1"></div>
                     </div>
                  </div>
                  <div class="flex items-center gap-2">
                     <Moon class="w-4 h-4" :class="theme === 'dark' ? 'text-primary' : 'text-text-secondary'" />
                     <span class="text-sm font-medium" :class="theme === 'dark' ? 'text-primary' : 'text-text-secondary'">{{ t('settings.dark') }}</span>
                  </div>
                  <div v-if="theme === 'dark'" class="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary"></div>
                </button>
              </div>
            </div>
          </div>

          <!-- Language Selection -->
          <div class="flex-1 min-w-[300px] bg-bg-surface rounded-2xl border border-border overflow-hidden hover:border-primary/20 transition-colors shadow-sm">
             <div class="p-6">
                <h2 class="text-base font-medium text-text-primary mb-4 flex items-center gap-2">
                   <Globe class="w-4 h-4 text-accent-blue" />
                   {{ t('settings.language') }}
                </h2>
                <div class="grid grid-cols-2 gap-4">
                   <button 
                      @click="changeLanguage('zh-CN')"
                      class="group relative flex items-center justify-between p-4 rounded-xl border-2 transition-all duration-300"
                      :class="locale === 'zh-CN' ? 'bg-bg-elevate border-primary shadow-sm' : 'bg-bg-main border-transparent hover:bg-bg-elevate'"
                   >
                      <span class="font-medium" :class="locale === 'zh-CN' ? 'text-primary' : 'text-text-primary'">中文</span>
                      <div v-if="locale === 'zh-CN'" class="w-2 h-2 rounded-full bg-primary"></div>
                   </button>

                   <button 
                      @click="changeLanguage('en-US')"
                      class="group relative flex items-center justify-between p-4 rounded-xl border-2 transition-all duration-300"
                      :class="locale === 'en-US' ? 'bg-bg-elevate border-primary shadow-sm' : 'bg-bg-main border-transparent hover:bg-bg-elevate'"
                   >
                      <span class="font-medium" :class="locale === 'en-US' ? 'text-primary' : 'text-text-primary'">English</span>
                      <div v-if="locale === 'en-US'" class="w-2 h-2 rounded-full bg-primary"></div>
                   </button>
                </div>
             </div>
          </div>

          <!-- Quality Selection -->
          <div class="flex-1 min-w-[300px] bg-bg-surface rounded-2xl border border-border overflow-hidden hover:border-primary/20 transition-colors shadow-sm">
            <div class="p-6">
              <h2 class="text-base font-medium text-text-primary mb-4 flex items-center gap-2">
                <Music class="w-4 h-4 text-accent" />
                {{ t('player.quality_title') }}
              </h2>
              <div class="grid grid-cols-3 gap-3">
                <button
                  v-for="opt in qualityOptions"
                  :key="opt.value"
                  @click="playerStore.quality = opt.value"
                  class="group relative flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all duration-300"
                  :class="playerStore.quality === opt.value
                    ? 'bg-bg-elevate border-primary shadow-sm'
                    : 'bg-bg-main border-transparent hover:bg-bg-elevate'"
                >
                  <span
                    class="text-sm font-bold font-mono"
                    :class="playerStore.quality === opt.value ? 'text-primary' : 'text-text-primary'"
                  >{{ opt.short }}</span>
                  <span
                    class="text-[10px] leading-tight text-center"
                    :class="playerStore.quality === opt.value ? 'text-primary/70' : 'text-text-secondary'"
                  >{{ t(`player.quality_${opt.value}`) }}</span>
                  <div v-if="playerStore.quality === opt.value" class="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary"></div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- System Config (admin only) -->
      <section v-if="config && isAdmin" class="space-y-6">
        <div class="sticky top-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 pt-2 pb-2 mb-4 bg-bg-main/95 backdrop-blur-sm border-b border-border">
          <div class="flex items-center justify-between max-w-5xl mx-auto">
            <h3 class="text-lg font-semibold text-text-primary flex items-center gap-2">
               <Sliders class="w-5 h-5 text-accent-blue" />
               {{ t('settings.configuration') }}
            </h3>
            <button
              @click="saveConfig"
              class="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors text-sm"
              :class="hasConfigChanged && !isSaving
                ? 'bg-primary hover:bg-primary-hover text-white'
                : 'bg-bg-elevate text-text-tertiary cursor-not-allowed'"
              :disabled="isSaving || !hasConfigChanged"
            >
              <Save class="w-4 h-4" />
              {{ isSaving ? t('settings.saving') : t('settings.save_changes') }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Scan Settings -->
          <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm p-6 space-y-4">
            <h4 class="font-medium text-text-primary flex items-center gap-2">
              <HardDrive class="w-4 h-4 text-text-secondary" />
              {{ t('settings.scan_settings') }}
            </h4>
            
            <div class="space-y-4 text-sm">
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.scan_mode') }}</label>
                <select 
                  v-model="formState.scan.mode"
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                >
                  <option value="manual">{{ t('settings.scan_mode_manual') }}</option>
                  <option value="scheduled">{{ t('settings.scan_mode_scheduled') }}</option>
                  <option value="watch">{{ t('settings.scan_mode_watch') }}</option>
                </select>
              </div>

              <div v-if="formState.scan.mode === 'scheduled'">
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.interval_hours') }}</label>
                <input 
                  v-model.number="formState.scan.interval_hours" 
                  type="number" 
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>

              <div class="flex items-center justify-between">
                <label class="text-text-primary">{{ t('settings.skip_small_files') }}</label>
                <input 
                  v-model="formState.scan.skip_small_files" 
                  type="checkbox" 
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>
              <div v-if="formState.scan.skip_small_files">
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.min_file_size') }}</label>
                <input 
                  v-model.number="formState.scan.min_file_size" 
                  type="number" 
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>

              <div class="pt-4 border-t border-border">
                <label class="block text-text-secondary text-xs mb-2">{{ t('settings.music_directories') }}</label>
                
                <div class="space-y-2 mb-3">
                  <div v-for="(root, index) in formState.scan.roots" :key="index" class="flex items-center gap-2 p-2 bg-bg-main rounded border border-border group">
                    <span class="text-text-primary flex-1 text-sm truncate" :title="root">{{ root }}</span>
                    <button @click="removeRoot(index)" class="p-1 text-text-secondary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100" :title="t('settings.remove')">
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                  <div v-if="formState.scan.roots.length === 0" class="text-sm text-text-tertiary italic p-2 text-center">
                    {{ t('common.no_data') }}
                  </div>
                </div>

                <div class="flex gap-2">
                  <input 
                    v-model="newRootPath"
                    type="text" 
                    :placeholder="t('settings.path_placeholder')"
                    class="flex-1 p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none text-sm"
                    @keyup.enter="addRoot"
                  />
                  <button @click="addRoot" class="px-3 py-2 bg-bg-elevate hover:bg-bg-surface border border-border rounded text-text-primary hover:text-primary transition-colors" :title="t('settings.add_directory')">
                    <Plus class="w-4 h-4" />
                  </button>
                  <button @click="showDirBrowser = true" class="px-3 py-2 bg-bg-elevate hover:bg-bg-surface border border-border rounded text-text-primary hover:text-primary transition-colors" :title="t('settings.browse_directory')">
                    <FolderOpen class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Transcode Settings -->
          <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm p-6 space-y-4">
            <h4 class="font-medium text-text-primary flex items-center gap-2">
              <Music class="w-4 h-4 text-text-secondary" />
              {{ t('settings.transcode_settings') }}
            </h4>
            
            <div class="space-y-4 text-sm">
              <div class="flex items-center justify-between">
                <label class="text-text-primary">{{ t('settings.enable_transcoding') }}</label>
                <input 
                  v-model="formState.transcode.enabled" 
                  type="checkbox" 
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.transcode_cache_path') }}</label>
                <div class="p-2 bg-bg-main rounded border border-border text-text-primary truncate text-xs" :title="config.transcode.cache_path">{{ config.transcode.cache_path }}</div>
              </div>
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.max_concurrent_jobs') }}</label>
                <input 
                  v-model.number="formState.transcode.max_concurrent_transcodes" 
                  type="number" 
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.cache_strategy') }}</label>
                <select 
                  v-model="formState.transcode.cache_strategy"
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                >
                  <option value="none">{{ t('settings.cache_strategy_none') }}</option>
                  <option value="all">{{ t('settings.cache_strategy_all') }}</option>
                  <option value="smart">{{ t('settings.cache_strategy_smart') }}</option>
                </select>
              </div>
              <div v-if="formState.transcode.cache_strategy === 'smart'">
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.cache_threshold') }}</label>
                <input 
                  v-model.number="formState.transcode.cache_threshold" 
                  type="number" 
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>
            </div>
          </div>

          <!-- Recommend Settings -->
          <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm p-6 space-y-4">
            <h4 class="font-medium text-text-primary flex items-center gap-2">
              <Sparkles class="w-4 h-4 text-text-secondary" />
              {{ t('settings.recommend_settings') }}
            </h4>
            
            <div class="space-y-4 text-sm">
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.recommend_interval') }}</label>
                <input 
                  v-model.number="formState.recommend.job_interval_hours" 
                  type="number" 
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.play_threshold') }}</label>
                <input 
                  v-model.number="formState.recommend.play_threshold" 
                  type="number" 
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.max_results') }}</label>
                <input 
                  v-model.number="formState.recommend.max_results" 
                  type="number" 
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>
            </div>
          </div>

          <!-- Maintenance Settings -->
          <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm p-6 space-y-4">
            <h4 class="font-medium text-text-primary flex items-center gap-2">
              <Shield class="w-4 h-4 text-text-secondary" />
              {{ t('settings.maintenance_settings') }}
            </h4>
            
            <div class="space-y-4 text-sm">
              <div class="flex items-center justify-between">
                <label class="text-text-primary">{{ t('settings.enable_maintenance') }}</label>
                <input 
                  v-model="formState.maintenance.enabled" 
                  type="checkbox" 
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.maintenance_interval') }}</label>
                <input 
                  v-model.number="formState.maintenance.interval_hours" 
                  type="number" 
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-text-secondary text-xs mb-1">{{ t('settings.history_retention_days') }}</label>
                  <input 
                    v-model.number="formState.maintenance.history_retention_days" 
                    type="number" 
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label class="block text-text-secondary text-xs mb-1">{{ t('settings.recommendation_retention_days') }}</label>
                  <input 
                    v-model.number="formState.maintenance.recommendation_retention_days" 
                    type="number" 
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  />
                </div>
              </div>
              <div class="flex items-center justify-between">
                <label class="text-text-primary">{{ t('settings.enable_vacuum') }}</label>
                <input 
                  v-model="formState.maintenance.enable_vacuum" 
                  type="checkbox" 
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>
              <div v-if="formState.maintenance.enable_vacuum">
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.vacuum_threshold') }}</label>
                <input 
                  v-model.number="formState.maintenance.vacuum_threshold" 
                  type="number" 
                  step="0.1"
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                />
              </div>
            </div>
          </div>

          <!-- Advanced Settings -->
          <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm p-6 space-y-4 md:col-span-2">
            <h4 class="font-medium text-text-primary flex items-center gap-2">
              <Shield class="w-4 h-4 text-text-secondary" />
              高级配置（特色）
            </h4>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <label class="text-text-primary">启用 Subsonic API</label>
                  <input
                    v-model="formState.subsonic.enabled"
                    type="checkbox"
                    class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                  />
                </div>
                <!-- <div class="flex items-center justify-between">
                  <label class="text-text-primary">启用内置 Web 前端</label>
                  <input
                    v-model="formState.web.enabled"
                    type="checkbox"
                    class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                  />
                </div> -->
                <div>
                  <label class="block text-text-secondary text-xs mb-1">JWT 过期小时数</label>
                  <input
                    v-model.number="formState.security.token_expiry_hours"
                    type="number"
                    min="1"
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label class="block text-text-secondary text-xs mb-1">登录限流次数（窗口内）</label>
                  <input
                    v-model.number="formState.security.login_rate_limit"
                    type="number"
                    min="0"
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label class="block text-text-secondary text-xs mb-1">登录限流窗口（秒）</label>
                  <input
                    v-model.number="formState.security.login_rate_window_secs"
                    type="number"
                    min="1"
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  />
                </div>
              </div>

              <div class="space-y-4">
                <div>
                  <label class="block text-text-secondary text-xs mb-1">流媒体 Token TTL（秒）</label>
                  <input
                    v-model.number="formState.security.stream_token_ttl_secs"
                    type="number"
                    min="1"
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  />
                </div>
                <!-- <div>
                  <label class="block text-text-secondary text-xs mb-1">CORS 允许来源（逗号分隔）</label>
                  <input
                    v-model="corsOriginsInput"
                    type="text"
                    placeholder="https://music.example.com, http://localhost:5173"
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label class="block text-text-secondary text-xs mb-1">日志级别</label>
                  <select
                    v-model="formState.logging.level"
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  >
                    <option value="trace">trace</option>
                    <option value="debug">debug</option>
                    <option value="info">info</option>
                    <option value="warn">warn</option>
                    <option value="error">error</option>
                  </select>
                </div>
                <div>
                  <label class="block text-text-secondary text-xs mb-1">模块日志（逗号分隔）</label>
                  <input
                    v-model="loggingModulesInput"
                    type="text"
                    placeholder="zhiyin=debug, axum=info"
                    class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                  />
                </div> -->
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- System & Library Info (admin only) -->
      <section v-if="isAdmin" class="space-y-6">
        <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2 mb-4 flex items-center gap-2">
           <Monitor class="w-5 h-5 text-text-secondary" />
           {{ t('settings.system') }}
        </h3>

        <!-- System Info Card -->
        <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm flex flex-col h-full">
           <div class="p-6 flex-1 space-y-6">
              <!-- API Status -->
              <div class="flex items-center justify-between group">
                 <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-bg-elevate flex items-center justify-center text-text-secondary group-hover:text-primary transition-colors">
                       <RefreshCw class="w-5 h-5" />
                    </div>
                    <div>
                       <h4 class="font-medium text-text-primary">{{ t('settings.api_status') }}</h4>
                       <p class="text-xs text-text-secondary">{{ t('settings.backend_connection') }}</p>
                    </div>
                 </div>
                 <div class="flex items-center gap-2">
                    <span 
                      class="text-sm font-medium px-2 py-1 rounded flex items-center gap-1.5 transition-colors"
                      :class="systemStore.isConnected ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'"
                    >
                      <CheckCircle2 v-if="systemStore.isConnected" class="w-3.5 h-3.5" />
                      <XCircle v-else class="w-3.5 h-3.5" />
                      {{ systemStore.isConnected ? t('settings.connected') : t('settings.disconnected') }}
                    </span>
                    <button 
                      @click="checkHealth(true)" 
                      class="p-1.5 hover:bg-bg-elevate rounded-md text-text-secondary hover:text-primary transition-colors"
                      :class="{ 'animate-spin': isChecking }"
                      :title="t('settings.refresh_status')"
                    >
                      <RefreshCw class="w-4 h-4" />
                    </button>
                 </div>
              </div>

              <div class="h-px bg-border w-full"></div>

              <!-- Version & Build Info -->
              <div class="flex items-center justify-between group">
                 <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-bg-elevate flex items-center justify-center text-text-secondary group-hover:text-primary transition-colors">
                       <Monitor class="w-5 h-5" />
                    </div>
                    <div>
                       <h4 class="font-medium text-text-primary">{{ t('settings.app_name') }}</h4>
                       <p class="text-xs text-text-secondary">{{ t('settings.current_version') }}</p>
                    </div>
                 </div>
                 <div class="flex items-center gap-2">
                   <span class="font-mono text-sm bg-bg-elevate px-2 py-1 rounded text-text-primary">
                     v{{ healthInfo?.version || '-' }}
                   </span>
                   <a
                     v-if="hasUpdate"
                     :href="`${GITHUB_REPO_URL}/releases/latest`"
                     target="_blank"
                     rel="noopener noreferrer"
                     class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
                     :title="t('settings.update_available_hint', { version: latestVersion })"
                   >
                     <ArrowUpCircle class="w-3.5 h-3.5" />
                     {{ t('common.new_version', { version: latestVersion }) }}
                   </a>
                 </div>
              </div>

           </div>
           
           <!-- Action Footer -->
           <div class="p-4 bg-bg-elevate/30 border-t border-border space-y-3">
              <button 
                @click="triggerScan"
                :disabled="isScanning"
                class="w-full py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl font-medium transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                 <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': isScanning }" />
                 {{ isScanning ? t('settings.scanning') : t('settings.scan') }}
              </button>

              <!-- 扫描进度 -->
              <div v-if="isScanning && scanStatus" class="space-y-2">
                <div class="flex items-center justify-between text-xs text-text-secondary">
                  <span>{{ t(`settings.scan_phase.${scanStatus.phase}`) }}</span>
                  <span>{{ scanProgressPercent }}%</span>
                </div>
                <div class="h-1.5 bg-bg-main rounded-full overflow-hidden">
                  <div 
                    class="h-full bg-primary-gradient rounded-full transition-all duration-500"
                    :style="{ width: `${scanProgressPercent}%` }"
                  ></div>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center text-[10px]">
                  <div>
                    <div class="text-text-tertiary">{{ t('settings.scan_added') }}</div>
                    <div class="font-medium text-green-500">{{ scanStatus.added }}</div>
                  </div>
                  <div>
                    <div class="text-text-tertiary">{{ t('settings.scan_modified') }}</div>
                    <div class="font-medium text-amber-500">{{ scanStatus.modified }}</div>
                  </div>
                  <div>
                    <div class="text-text-tertiary">{{ t('settings.scan_deleted') }}</div>
                    <div class="font-medium text-red-500">{{ scanStatus.deleted }}</div>
                  </div>
                </div>
                <p v-if="scanStatus.current_file" class="text-[10px] text-text-tertiary truncate" :title="scanStatus.current_file">
                  {{ scanStatus.current_file }}
                </p>
              </div>

              <p v-else class="text-[10px] text-center text-text-tertiary">
                {{ t('settings.last_scan', { time: scanStatus?.finished_at ? lastScanTime : t('settings.never') }) }}
              </p>
           </div>
        </div>
      </section>

      <!-- Experimental Features (admin only) -->
      <section v-if="config && isAdmin" class="space-y-6">
        <div class="flex items-center justify-between border-b border-amber-500/30 pb-2 mb-4">
          <h3 class="text-lg font-semibold text-text-primary flex items-center gap-2">
            <FlaskConical class="w-5 h-5 text-amber-500" />
            {{ t('settings.experimental_title') }}
          </h3>
          <button
            @click="saveConfig"
            class="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors text-sm"
            :class="hasConfigChanged && !isSaving
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-bg-elevate text-text-tertiary cursor-not-allowed'"
            :disabled="isSaving || !hasConfigChanged"
          >
            <Save class="w-4 h-4" />
            {{ isSaving ? t('settings.saving') : t('settings.save_changes') }}
          </button>
        </div>

        <div class="bg-amber-500/5 rounded-2xl border border-amber-500/20 p-1">
          <div class="bg-bg-surface rounded-xl p-6 space-y-4">
            <div class="flex items-start gap-3 mb-4">
              <div class="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <FlaskConical class="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p class="text-sm font-medium text-text-primary">{{ t('settings.strm_settings') }}</p>
                <p class="text-[10px] text-text-tertiary mt-0.5">{{ t('settings.experimental_desc') }}</p>
              </div>
            </div>

            <div class="space-y-4 text-sm">
              <div class="flex items-center justify-between">
                <div>
                  <label class="text-text-primary">{{ t('settings.scan_strm') }}</label>
                  <p class="text-[10px] text-text-tertiary">{{ t('settings.scan_strm_desc') }}</p>
                </div>
                <input
                  v-model="formState.scan.scan_strm"
                  type="checkbox"
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>

              <div v-if="formState.scan.scan_strm">
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.strm_mode') }}</label>
                <select
                  v-model="formState.scan.strm_mode"
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                >
                  <option value="proxy">{{ t('settings.strm_mode_proxy') }}</option>
                  <option value="redirect">{{ t('settings.strm_mode_redirect') }}</option>
                </select>
              </div>

              <div v-if="formState.scan.scan_strm" class="flex items-center justify-between">
                <div>
                  <label class="text-text-primary">{{ t('settings.strm_probe_remote') }}</label>
                  <p class="text-[10px] text-text-tertiary">{{ t('settings.strm_probe_remote_desc') }}</p>
                </div>
                <input
                  v-model="formState.scan.strm_probe_remote"
                  type="checkbox"
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Sidecar Metadata Settings (admin only) -->
      <section v-if="config && isAdmin" class="space-y-6">
        <div class="bg-amber-500/5 rounded-2xl border border-amber-500/20 p-1">
          <div class="bg-bg-surface rounded-xl p-6 space-y-4">
            <div class="flex items-start gap-3 mb-4">
              <div class="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <HardDrive class="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p class="text-sm font-medium text-text-primary">{{ t('settings.sidecar_settings') }}</p>
                <p class="text-[10px] text-text-tertiary mt-0.5">{{ t('settings.sidecar_settings_desc') }}</p>
              </div>
            </div>

            <div class="space-y-4 text-sm">
              <div>
                <label class="block text-text-secondary text-xs mb-1">{{ t('settings.metadata_format') }}</label>
                <select
                  v-model="formState.scrape.metadata_format"
                  class="w-full p-2 bg-bg-elevate rounded border border-border text-text-primary focus:border-primary outline-none"
                >
                  <option value="json">JSON (.metadata.json)</option>
                  <option value="nfo">NFO (.nfo - Kodi/Jellyfin)</option>
                </select>
                <p class="text-[10px] text-text-tertiary mt-1">{{ t('settings.metadata_format_desc') }}</p>
              </div>

              <div class="flex items-center justify-between">
                <div>
                  <label class="text-text-primary">{{ t('settings.sidecar_for_all') }}</label>
                  <p class="text-[10px] text-text-tertiary">{{ t('settings.sidecar_for_all_desc') }}</p>
                </div>
                <input
                  v-model="formState.scrape.sidecar_for_all"
                  type="checkbox"
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Version Changelog -->
      <section class="space-y-6">
        <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2 mb-4 flex items-center gap-2">
          <ArrowUpCircle class="w-5 h-5 text-primary" />
          {{ t('changelog.title') }}
        </h3>
        <div class="bg-bg-surface rounded-2xl border border-border p-6">
          <p class="text-sm text-text-secondary mb-4">{{ t('changelog.settings_desc') }}</p>
          <router-link
            to="/changelog"
            class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-bg-elevate border border-border text-text-primary hover:border-primary/40 hover:text-primary transition-colors"
          >
            <ArrowUpCircle class="w-4 h-4" />
            {{ t('changelog.view_details') }}
            <ChevronRight class="w-4 h-4 text-text-tertiary" />
          </router-link>
        </div>
      </section>

      <!-- GitHub Community -->
      <section class="space-y-6">
        <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2 mb-4 flex items-center gap-2">
          <Star class="w-5 h-5 text-amber-500" />
          {{ t('settings.github_community') }}
        </h3>
        <div class="bg-bg-surface rounded-2xl border border-border p-6 space-y-4">
          <p class="text-sm text-text-secondary">{{ t('settings.github_desc') }}</p>
          <div class="flex flex-wrap gap-3">
            <a :href="GITHUB_REPO_URL" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-bg-elevate border border-border text-text-primary hover:border-primary/40 hover:text-primary transition-colors">
              <Star class="w-4 h-4" />
              {{ t('settings.github_star') }}
              <ExternalLink class="w-3.5 h-3.5 text-text-tertiary" />
            </a>
            <a :href="GITHUB_ISSUES_URL" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-bg-elevate border border-border text-text-primary hover:border-primary/40 hover:text-primary transition-colors">
              <MessageCircle class="w-4 h-4" />
              {{ t('settings.github_issues') }}
              <ExternalLink class="w-3.5 h-3.5 text-text-tertiary" />
            </a>
          </div>
          <p class="text-xs text-text-tertiary">{{ t('settings.github_issues_hint') }}</p>
        </div>
      </section>

      <!-- Danger Zone (admin only) -->
      <section v-if="isAdmin" class="space-y-6">
        <h3 class="text-lg font-semibold text-red-500 border-b border-red-500/20 pb-2 mb-4 flex items-center gap-2">
          <Trash2 class="w-5 h-5" />
          {{ t('settings.danger_zone') }}
        </h3>

        <div class="bg-red-500/5 rounded-2xl border border-red-500/20 p-6 space-y-4">
          <div class="flex items-start gap-4">
            <div class="flex-1">
              <p class="text-sm font-medium text-text-primary">{{ t('settings.reset_all_data') }}</p>
              <p class="text-xs text-text-secondary mt-1">{{ t('settings.reset_all_data_desc') }}</p>
            </div>
            <button
              @click="showResetConfirm = true"
              :disabled="isResetting"
              class="flex-none px-4 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw v-if="isResetting" class="w-4 h-4 animate-spin inline mr-1" />
              {{ t('settings.reset_all_btn') }}
            </button>
          </div>
        </div>
      </section>

      <!-- Reset Confirmation Modal -->
      <Teleport to="body">
        <div
          v-if="showResetConfirm"
          class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          @click.self="showResetConfirm = false"
        >
          <div class="bg-bg-surface rounded-2xl border border-red-500/30 shadow-2xl w-full max-w-md mx-4 p-6 space-y-5 animate-fade-in">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <Trash2 class="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h4 class="text-lg font-semibold text-text-primary">{{ t('settings.reset_confirm_title') }}</h4>
                <p class="text-xs text-text-secondary">{{ t('settings.reset_confirm_subtitle') }}</p>
              </div>
            </div>

            <div class="bg-red-500/5 border border-red-500/20 rounded-xl p-4 space-y-2">
              <p class="text-sm text-red-500 font-medium">{{ t('settings.reset_warning') }}</p>
              <ul class="text-xs text-text-secondary space-y-1 list-disc list-inside">
                <li>{{ t('settings.reset_item_songs') }}</li>
                <li>{{ t('settings.reset_item_covers') }}</li>
                <li>{{ t('settings.reset_item_transcode') }}</li>
                <li>{{ t('settings.reset_item_history') }}</li>
                <li>{{ t('settings.reset_item_scrape') }}</li>
              </ul>
              <p class="text-xs text-emerald-500 mt-2">{{ t('settings.reset_keep') }}</p>
            </div>

            <div class="space-y-2">
              <label class="text-xs text-text-secondary">{{ t('settings.reset_type_confirm') }}</label>
              <input
                v-model="resetConfirmInput"
                type="text"
                :placeholder="t('settings.reset_type_placeholder')"
                class="w-full px-3 py-2 rounded-lg border border-border bg-bg-main text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500"
              />
            </div>

            <div class="flex gap-3 pt-1">
              <button
                @click="showResetConfirm = false; resetConfirmInput = ''"
                class="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-bg-elevate text-text-secondary hover:bg-bg-main transition-colors border border-border"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                @click="handleResetAll"
                :disabled="resetConfirmInput !== 'RESET' || isResetting"
                class="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw v-if="isResetting" class="w-4 h-4 animate-spin inline mr-1" />
                {{ t('settings.reset_execute') }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>


    </div>

    <!-- Directory Browser Dialog -->
    <DirBrowser
      :visible="showDirBrowser"
      @close="showDirBrowser = false"
      @select="onDirSelected"
    />
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
