<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { historyApi } from '@/api/history';
import type { Song, RecentSong } from '@/types';
import { usePlayerStore } from '@/stores/player';
import { Calendar, RefreshCw } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { scrapeApi } from '@/api/scrape';
import { useScrapeFeature } from '@/composables/useScrapeFeature';
import { useToast } from '@/composables/useToast';
import VirtualSongList from '@/components/common/VirtualSongList.vue';

const playerStore = usePlayerStore();
const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const { ensureLoaded: ensureScrapeFeature, isEnabled: scrapeEnabled } = useScrapeFeature();
const songs = ref<RecentSong[]>([]);
const isLoading = ref(false);
const hasError = ref(false);

const fetchHistory = async () => {
  isLoading.value = true;
  hasError.value = false;
  try {
    const { data: historyList } = await historyApi.getRecentSongs();
    songs.value = historyList;
  } catch (e) {
    console.error(t('common.error'), e);
    hasError.value = true;
  } finally {
    isLoading.value = false;
  }
};

const playSong = (song: Song) => {
  playerStore.play(song);
};

const handleMenuAction = async (action: string, song: Song) => {
  switch (action) {
    case 'play':
      playerStore.play(song);
      break;
    case 'addToQueue':
      playerStore.addToQueue(song);
      toast.success(t('common.add_to_queue'));
      break;
    case 'scrape':
      await ensureScrapeFeature();
      if (!scrapeEnabled.value) {
        toast.info(t('scrape.disabled_toast'));
        router.push({ path: '/settings', hash: '#scrape-feature' });
        break;
      }
      try {
        await scrapeApi.batchCreate([song.id]);
        toast.success(t('scrape.batch_created', { count: 1 }));
        router.push('/scrape');
      } catch {
        toast.error(t('common.error'));
      }
      break;
    case 'viewDetails':
      break;
  }
};

onMounted(() => {
  fetchHistory();
});
</script>

<template>
  <div class="flex flex-col h-full p-0 md:p-8 overflow-hidden">
    <header class="pt-2 md:pt-0 flex-none flex items-center justify-between mb-6">
      <h1 class="text-3xl font-bold text-text-primary flex items-center gap-3">
        <Calendar class="w-8 h-8 text-primary" />
        {{ t('nav.history') }}
      </h1>
      <button
        @click="fetchHistory"
        :disabled="isLoading"
        class="p-2 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-primary transition-colors"
        :class="{ 'animate-spin': isLoading }"
        :title="t('common.refresh')"
      >
        <RefreshCw class="w-5 h-5" />
      </button>
    </header>

    <div class="flex-1 overflow-hidden">
      <VirtualSongList 
        :songs="songs" 
        :is-loading="isLoading"
        :has-error="hasError"
        :show-album="false"
        :show-played-at="true"
        @play="playSong"
        @retry="fetchHistory"
        @menu-action="handleMenuAction"
      />
    </div>
  </div>
</template>
