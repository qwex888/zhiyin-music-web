
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { 
  BarChart2, 
  Music, 
  Disc, 
  Users, 
  HardDrive, 
  Activity, 
  Zap, 
  Database, 
  Server, 
  TrendingUp,
  AlertCircle,
  RefreshCw
} from 'lucide-vue-next';
import { statsApi } from '@/api/stats';
import type { Stats } from '@/types';
import dayjs from 'dayjs';

const { t } = useI18n();
const isLoading = ref(true);
const stats = ref<Stats | null>(null);
const hasError = ref(false);

const fetchStats = async () => {
  isLoading.value = true;
  hasError.value = false;
  try {
    const { data } = await statsApi.getStats();
    stats.value = data;
  } catch (e) {
    console.error(e);
    hasError.value = true;
  } finally {
    isLoading.value = false;
  }
};

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const formatDate = (date: string | null) => {
  if (!date) return t('settings.never');
  return dayjs(date).format('YYYY-MM-DD HH:mm');
};

onMounted(() => {
  fetchStats();
});
</script>

<template>
  <div class="p-4 md:p-8 pb-24 max-w-7xl mx-auto animate-fade-in">
    <header class="mb-8">
      <h1 class="text-3xl font-bold text-text-primary flex items-center gap-3 mb-2">
        <BarChart2 class="w-8 h-8 text-primary" />
        {{ t('stats.title') }}
      </h1>
      <p class="text-text-secondary">{{ t('stats.subtitle') }}</p>
    </header>

    <div v-if="isLoading" class="flex justify-center py-20">
      <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>

    <!-- Error State -->
    <div v-else-if="hasError" class="flex flex-col items-center justify-center py-20 text-text-secondary">
      <AlertCircle class="w-12 h-12 mb-3 text-red-400 opacity-60" />
      <p class="text-sm font-medium mb-4">{{ t('common.error') }}</p>
      <button
        @click="fetchStats"
        class="flex items-center gap-2 px-4 py-2 bg-bg-elevate hover:bg-bg-surface border border-border rounded-lg text-sm text-text-primary hover:text-primary transition-colors"
      >
        <RefreshCw class="w-4 h-4" />
        {{ t('common.retry') }}
      </button>
    </div>

    <div v-else-if="stats" class="space-y-8">
      <!-- Library Overview -->
      <section>
        <h2 class="text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Music class="w-5 h-5 text-accent" />
          {{ t('stats.library_overview') }}
        </h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
            <div class="text-text-secondary text-sm mb-1">{{ t('stats.total_songs') }}</div>
            <div class="text-3xl font-bold text-text-primary">{{ stats.library.total_songs }}</div>
            <div class="mt-2 text-xs text-green-500 flex items-center gap-1">
              <TrendingUp class="w-3 h-3" />
              {{ stats.recent.songs_added_last_7_days }} {{ t('stats.added_7days') }}
            </div>
          </div>
          <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
            <div class="text-text-secondary text-sm mb-1">{{ t('stats.total_artists') }}</div>
            <div class="text-3xl font-bold text-text-primary">{{ stats.library.total_artists }}</div>
            <div class="mt-2 text-xs text-text-tertiary">
              <Users class="w-3 h-3 inline mr-1" />
              {{ t('stats.unique_artists') }}
            </div>
          </div>
          <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
            <div class="text-text-secondary text-sm mb-1">{{ t('stats.total_albums') }}</div>
            <div class="text-3xl font-bold text-text-primary">{{ stats.library.total_albums }}</div>
            <div class="mt-2 text-xs text-text-tertiary">
              <Disc class="w-3 h-3 inline mr-1" />
              {{ t('stats.albums_eps') }}
            </div>
          </div>
          <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
            <div class="text-text-secondary text-sm mb-1">{{ t('stats.total_size') }}</div>
            <div class="text-3xl font-bold text-text-primary">{{ formatBytes(stats.library.total_file_size_bytes) }}</div>
            <div class="mt-2 text-xs text-text-tertiary">
              <HardDrive class="w-3 h-3 inline mr-1" />
              {{ t('stats.storage_used') }}
            </div>
          </div>
        </div>
      </section>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- Playback Trends -->
        <section class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
          <h2 class="text-lg font-bold text-text-primary mb-6 flex items-center gap-2">
            <Activity class="w-5 h-5 text-accent-blue" />
            {{ t('stats.playback_trends') }}
          </h2>
          <div class="grid grid-cols-2 gap-6">
            <div class="text-center p-4 bg-bg-elevate rounded-lg">
              <div class="text-sm text-text-secondary mb-1">{{ t('stats.plays_today') }}</div>
              <div class="text-2xl font-bold text-primary">{{ stats.playback.plays_today }}</div>
            </div>
            <div class="text-center p-4 bg-bg-elevate rounded-lg">
              <div class="text-sm text-text-secondary mb-1">{{ t('stats.plays_7days') }}</div>
              <div class="text-2xl font-bold text-primary">{{ stats.playback.plays_last_7_days }}</div>
            </div>
            <div class="text-center p-4 bg-bg-elevate rounded-lg">
              <div class="text-sm text-text-secondary mb-1">{{ t('stats.plays_30days') }}</div>
              <div class="text-2xl font-bold text-primary">{{ stats.playback.plays_last_30_days }}</div>
            </div>
            <div class="text-center p-4 bg-bg-elevate rounded-lg">
              <div class="text-sm text-text-secondary mb-1">{{ t('stats.total_plays') }}</div>
              <div class="text-2xl font-bold text-primary">{{ stats.playback.total_plays }}</div>
            </div>
          </div>
        </section>

        <!-- Quality Distribution -->
        <section class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
          <h2 class="text-lg font-bold text-text-primary mb-6 flex items-center gap-2">
            <Zap class="w-5 h-5 text-accent-yellow" />
            {{ t('stats.quality_distribution') }}
          </h2>
          <div class="space-y-4">
            <div v-for="format in stats.quality.formats" :key="format.codec" class="space-y-1">
              <div class="flex justify-between text-sm">
                <span class="font-medium text-text-primary uppercase">{{ format.codec }}</span>
                <span class="text-text-secondary">{{ format.count }} ({{ format.percentage.toFixed(2) }}%)</span>
              </div>
              <div class="h-2 bg-bg-elevate rounded-full overflow-hidden">
                <div 
                  class="h-full bg-primary rounded-full" 
                  :style="{ width: `${format.percentage}%` }"
                ></div>
              </div>
            </div>
            <div class="flex gap-4 mt-6 pt-4 border-t border-border">
              <div>
                <div class="text-xs text-text-secondary">{{ t('stats.high_quality') }}</div>
                <div class="text-lg font-bold text-text-primary">{{ stats.quality.high_quality_count }}</div>
              </div>
              <div>
                <div class="text-xs text-text-secondary">{{ t('stats.lossless') }}</div>
                <div class="text-lg font-bold text-text-primary">{{ stats.quality.lossless_count }}</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Top Content -->
      <section class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Top Songs -->
        <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
          <h3 class="font-bold text-text-primary mb-4">{{ t('stats.top_songs') }}</h3>
          <ul v-if="stats.top_content.most_played_songs?.length" class="space-y-3">
            <li v-for="(song, index) in stats.top_content.most_played_songs" :key="song.id" class="flex items-center gap-3">
              <div class="w-6 text-center text-sm font-bold text-text-tertiary">{{ index + 1 }}</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-text-primary truncate">{{ song.title }}</div>
                <div class="text-xs text-text-secondary truncate">{{ song.artist_name }}</div>
              </div>
              <div class="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {{ song.play_count }}
              </div>
            </li>
          </ul>
          <div v-else class="flex flex-col items-center justify-center py-8 text-text-tertiary">
            <Music class="w-8 h-8 mb-2 opacity-30" />
            <span class="text-sm">{{ t('common.no_data') }}</span>
          </div>
        </div>

        <!-- Top Artists -->
        <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
          <h3 class="font-bold text-text-primary mb-4">{{ t('stats.top_artists') }}</h3>
          <ul v-if="stats.top_content.most_played_artists?.length" class="space-y-3">
            <li v-for="(artist, index) in stats.top_content.most_played_artists" :key="artist.id" class="flex items-center gap-3">
              <div class="w-6 text-center text-sm font-bold text-text-tertiary">{{ index + 1 }}</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-text-primary truncate">{{ artist.name }}</div>
              </div>
              <div class="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {{ artist.play_count }}
              </div>
            </li>
          </ul>
          <div v-else class="flex flex-col items-center justify-center py-8 text-text-tertiary">
            <Users class="w-8 h-8 mb-2 opacity-30" />
            <span class="text-sm">{{ t('common.no_data') }}</span>
          </div>
        </div>

        <!-- Top Albums -->
        <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
          <h3 class="font-bold text-text-primary mb-4">{{ t('stats.top_albums') }}</h3>
          <ul v-if="stats.top_content.most_played_albums?.length" class="space-y-3">
            <li v-for="(album, index) in stats.top_content.most_played_albums" :key="album.id" class="flex items-center gap-3">
              <div class="w-6 text-center text-sm font-bold text-text-tertiary">{{ index + 1 }}</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-text-primary truncate">{{ album.name }}</div>
                <div class="text-xs text-text-secondary truncate">{{ album.artist_name }}</div>
              </div>
              <div class="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {{ album.play_count }}
              </div>
            </li>
          </ul>
          <div v-else class="flex flex-col items-center justify-center py-8 text-text-tertiary">
            <Disc class="w-8 h-8 mb-2 opacity-30" />
            <span class="text-sm">{{ t('common.no_data') }}</span>
          </div>
        </div>
      </section>

      <!-- System Health & Storage -->
      <section class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
          <h2 class="text-lg font-bold text-text-primary mb-4 flex items-center gap-2">
            <Server class="w-5 h-5 text-text-secondary" />
            {{ t('stats.system_health') }}
          </h2>
          <div class="space-y-4">
            <div class="flex justify-between items-center py-2 border-b border-border/50">
              <span class="text-sm text-text-secondary">{{ t('stats.active_jobs') }}</span>
              <span class="font-mono text-text-primary">{{ stats.system.active_transcode_jobs }}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-border/50">
              <span class="text-sm text-text-secondary">{{ t('stats.fragmentation') }}</span>
              <span class="font-mono text-text-primary">{{ Number(stats.system.database_fragmentation_percent).toFixed(2) }}%</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-border/50">
              <span class="text-sm text-text-secondary">{{ t('stats.recommendation_cache') }}</span>
              <span class="font-mono text-text-primary">{{ stats.system.recommendation_cache_count }} {{ t('stats.items') }}</span>
            </div>
            <div class="flex justify-between items-center py-2">
              <span class="text-sm text-text-secondary">{{ t('stats.last_scan') }}</span>
              <span class="font-mono text-text-primary text-xs">{{ formatDate(stats.recent.last_scan_at) }}</span>
            </div>
          </div>
        </div>

        <div class="bg-bg-surface p-6 rounded-xl border border-border shadow-sm">
          <h2 class="text-lg font-bold text-text-primary mb-4 flex items-center gap-2">
            <Database class="w-5 h-5 text-text-secondary" />
            {{ t('stats.storage_usage') }}
          </h2>
          <div class="space-y-4">
            <div class="flex justify-between items-center py-2 border-b border-border/50">
              <span class="text-sm text-text-secondary">{{ t('stats.database') }}</span>
              <span class="font-mono text-text-primary">{{ formatBytes(stats.storage.database_size_bytes) }}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-border/50">
              <span class="text-sm text-text-secondary">{{ t('stats.covers') }}</span>
              <span class="font-mono text-text-primary">{{ formatBytes(stats.storage.covers_cache_size_bytes) }}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b border-border/50">
              <span class="text-sm text-text-secondary">{{ t('stats.transcodes') }}</span>
              <span class="font-mono text-text-primary">{{ formatBytes(stats.storage.transcode_cache_size_bytes) }}</span>
            </div>
            <div class="flex justify-between items-center py-2">
              <span class="text-sm text-text-secondary">{{ t('stats.cache') }} ({{ t('stats.total') }})</span>
              <span class="font-mono text-primary font-bold">{{ formatBytes(stats.storage.total_cache_size_bytes) }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
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
