<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import dayjs from 'dayjs';
import {
  HardDrive,
  RefreshCw,
  Trash2,
  CloudOff,
  Music2,
  Image,
  Settings2,
  AlertCircle,
  X,
} from 'lucide-vue-next';
import { useOfflineStore } from '@/stores/offline';
import { useToast } from '@/composables/useToast';
import { useAppConnectivity } from '@/offline/network';
import { getCacheLimit, setCacheLimit } from '@/offline/media-cache';
import {
  orphanIds,
  orphanDetected,
  orphanCheckDone,
  removeOrphanSong,
  removeAllOrphans,
} from '@/offline/orphan-detector';
import { offlineDb } from '@/offline/db';
import type { Song } from '@/types';
import TipBanner from '@/components/common/TipBanner.vue';

const { t } = useI18n();
const offlineStore = useOfflineStore();
const toast = useToast();
const { isOffline } = useAppConnectivity();

const cacheLimitGB = ref(getCacheLimit() / (1024 * 1024 * 1024));
const cacheLimitOptions = [0.5, 1, 2, 4, 8, 16];

const orphanSongDetails = ref<Map<number, Song>>(new Map());

const cacheUsagePercent = computed(() => {
  const limit = cacheLimitGB.value * 1024 * 1024 * 1024;
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((offlineStore.mediaStats.estimatedBytes / limit) * 100));
});

const handleCacheLimitChange = (val: number) => {
  cacheLimitGB.value = val;
  setCacheLimit(val * 1024 * 1024 * 1024);
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const loadOrphanDetails = async () => {
  const ids = Array.from(orphanIds.value);
  if (ids.length === 0) return;
  const songs = await offlineDb.songs.bulkGet(ids);
  const map = new Map<number, Song>();
  for (const s of songs) {
    if (s) map.set(s.id, s);
  }
  orphanSongDetails.value = map;
};

onMounted(async () => {
  void offlineStore.refreshMeta();
  if (orphanCheckDone.value && orphanDetected.value) {
    await loadOrphanDetails();
  }
});

const handleSync = async () => {
  const ok = await offlineStore.syncLibrary();
  if (ok) toast.success(t('offline.sync_success'));
  else toast.error(t('offline.sync_failed'));
};

const handleClearLibrary = async () => {
  if (!confirm(t('offline.clear_library_confirm'))) return;
  await offlineStore.clearLibrary();
  toast.success(t('offline.clear_library_done'));
};

const handleClearMedia = async () => {
  if (!confirm(t('offline.clear_media_confirm'))) return;
  await offlineStore.clearMedia();
  toast.success(t('offline.clear_media_done'));
};

const handleRemoveOrphan = async (songId: number) => {
  await removeOrphanSong(songId);
  orphanSongDetails.value.delete(songId);
  toast.success(t('offline.orphan_removed'));
  void offlineStore.refreshMeta();
};

const handleClearAllOrphans = async () => {
  if (!confirm(t('offline.orphan_clear_all_confirm'))) return;
  await removeAllOrphans();
  orphanSongDetails.value.clear();
  toast.success(t('offline.orphan_clear_done'));
  void offlineStore.refreshMeta();
};
</script>

<template>
  <div class="p-6 max-w-2xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-text-primary flex items-center gap-2">
        <HardDrive class="w-7 h-7 text-primary" />
        {{ t('offline.title') }}
      </h1>
      <p class="text-text-secondary text-sm mt-1">{{ t('offline.subtitle') }}</p>
    </div>

    <TipBanner
      v-if="isOffline"
      :icon="CloudOff"
      align="start"
      class="rounded-lg border-amber-500/30"
    >
      {{ t('offline.currently_offline_hint') }}
    </TipBanner>

    <section class="bg-bg-surface border border-border rounded-xl p-5 space-y-4">
      <h2 class="font-semibold text-text-primary">{{ t('offline.library_section') }}</h2>
      <dl class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt class="text-text-secondary">{{ t('offline.local_songs') }}</dt>
          <dd class="font-mono text-text-primary">{{ offlineStore.localSongCount }}</dd>
        </div>
        <div>
          <dt class="text-text-secondary">{{ t('offline.last_sync') }}</dt>
          <dd class="text-text-primary">
            {{
              offlineStore.lastSyncedAt
                ? dayjs(offlineStore.lastSyncedAt).format('YYYY-MM-DD HH:mm')
                : t('offline.never')
            }}
          </dd>
        </div>
      </dl>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-sm font-medium disabled:opacity-50"
          :disabled="!offlineStore.canSync"
          @click="handleSync"
        >
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': offlineStore.isSyncing }" />
          {{ t('offline.sync_now') }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border text-text-secondary hover:text-red-400 text-sm"
          @click="handleClearLibrary"
        >
          <Trash2 class="w-4 h-4" />
          {{ t('offline.clear_library') }}
        </button>
      </div>
      <p class="text-xs text-text-secondary">{{ t('offline.library_hint') }}</p>
    </section>

    <section class="bg-bg-surface border border-border rounded-xl p-5 space-y-4">
      <h2 class="font-semibold text-text-primary">{{ t('offline.media_section') }}</h2>
      <dl class="grid grid-cols-2 gap-3 text-sm">
        <div class="flex items-center gap-2">
          <Music2 class="w-4 h-4 text-primary" />
          <div>
            <dt class="text-text-secondary">{{ t('offline.cached_tracks') }}</dt>
            <dd class="font-mono text-text-primary">{{ offlineStore.mediaStats.audioCount }}</dd>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Image class="w-4 h-4 text-primary" />
          <div>
            <dt class="text-text-secondary">{{ t('offline.cached_covers') }}</dt>
            <dd class="font-mono text-text-primary">{{ offlineStore.mediaStats.coverCount }}</dd>
          </div>
        </div>
        <div class="col-span-2">
          <dt class="text-text-secondary">{{ t('offline.cache_size') }}</dt>
          <dd class="font-mono text-text-primary">
            {{ formatBytes(offlineStore.mediaStats.estimatedBytes) }}
          </dd>
        </div>
      </dl>

      <!-- 缓存用量进度条 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs text-text-secondary">
          <span>{{ formatBytes(offlineStore.mediaStats.estimatedBytes) }} / {{ cacheLimitGB }} GB</span>
          <span>{{ cacheUsagePercent }}%</span>
        </div>
        <div class="h-2 bg-bg-elevate rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="cacheUsagePercent > 90 ? 'bg-red-500' : cacheUsagePercent > 70 ? 'bg-amber-500' : 'bg-primary'"
            :style="{ width: `${cacheUsagePercent}%` }"
          ></div>
        </div>
      </div>

      <!-- 缓存上限配置 -->
      <div class="space-y-2 pt-2 border-t border-border">
        <div class="flex items-center gap-2 text-sm text-text-primary">
          <Settings2 class="w-4 h-4 text-text-secondary" />
          <span>{{ t('offline.cache_limit_label') }}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="opt in cacheLimitOptions"
            :key="opt"
            type="button"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
            :class="cacheLimitGB === opt
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'bg-bg-elevate text-text-secondary border-border hover:border-primary/20'"
            @click="handleCacheLimitChange(opt)"
          >
            {{ opt }} GB
          </button>
        </div>
        <p class="text-xs text-text-tertiary">{{ t('offline.cache_limit_hint') }}</p>
      </div>

      <button
        type="button"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border text-text-secondary hover:text-red-400 text-sm"
        @click="handleClearMedia"
      >
        <Trash2 class="w-4 h-4" />
        {{ t('offline.clear_media') }}
      </button>
      <p class="text-xs text-text-secondary">{{ t('offline.media_hint') }}</p>
    </section>

    <section
      v-if="orphanCheckDone && orphanDetected"
      class="bg-bg-surface border border-amber-500/30 rounded-xl p-5 space-y-4"
    >
      <div class="flex items-center gap-2">
        <AlertCircle class="w-5 h-5 text-amber-400" />
        <h2 class="font-semibold text-text-primary">{{ t('offline.orphan_section') }} ({{ orphanIds.size }})</h2>
      </div>
      <p class="text-xs text-text-secondary">{{ t('offline.orphan_hint') }}</p>

      <div class="space-y-2 max-h-64 overflow-y-auto">
        <div
          v-for="songId in orphanIds"
          :key="songId"
          class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-bg-elevate"
        >
          <div class="min-w-0 flex-1">
            <div class="text-sm text-text-primary truncate">
              {{ orphanSongDetails.get(songId)?.title || `#${songId}` }}
            </div>
            <div v-if="orphanSongDetails.get(songId)?.artist_name" class="text-xs text-text-secondary truncate">
              {{ orphanSongDetails.get(songId)?.artist_name }}
            </div>
          </div>
          <button
            type="button"
            class="flex-shrink-0 p-1.5 rounded-md text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-colors"
            :title="t('offline.orphan_remove')"
            @click="handleRemoveOrphan(songId)"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
        <p v-if="orphanIds.size === 0" class="text-xs text-text-tertiary text-center py-2">
          {{ t('offline.orphan_empty') }}
        </p>
      </div>

      <button
        v-if="orphanIds.size > 0"
        type="button"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm"
        @click="handleClearAllOrphans"
      >
        <Trash2 class="w-4 h-4" />
        {{ t('offline.orphan_clear_all') }}
      </button>
    </section>
  </div>
</template>
