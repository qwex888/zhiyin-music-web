<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { genresApi, type GenreSummary } from '@/api/genres';
import type { Song } from '@/types';
import { useI18n } from 'vue-i18n';
import { usePlayerStore } from '@/stores/player';
import { useToast } from '@/composables/useToast';
import CoverImage from '@/components/common/CoverImage.vue';
import VirtualSongList from '@/components/common/VirtualSongList.vue';
import BatchGenreModal from '@/components/common/BatchGenreModal.vue';
import AddToPlaylistModal from '@/components/common/AddToPlaylistModal.vue';
import { ArrowLeft, Play, Loader2, Tags } from 'lucide-vue-next';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();
const toast = useToast();

const isUncategorized = computed(() => route.name === 'GenreUncategorized');
const genreId = computed(() => Number(route.params.id));

const genre = ref<GenreSummary | null>(null);
const songs = ref<Song[]>([]);
const isLoading = ref(true);
const showBatch = ref(false);
const batchSongIds = ref<number[]>([]);
const showAddToPlaylist = ref(false);
const addToPlaylistIds = ref<number[]>([]);
const listRef = ref<{ clearSelection?: (exit?: boolean) => void } | null>(null);

watch(
  () => [route.name, route.params.id] as const,
  () => {
    fetchData();
  },
);

const fetchData = async () => {
  isLoading.value = true;
  try {
    if (isUncategorized.value) {
      genre.value = { id: 0, name: t('genres.uncategorized'), song_count: 0 };
      const { data } = await genresApi.uncategorizedSongs({ limit: 200 });
      songs.value = data.items;
      genre.value.song_count = data.total;
    } else {
      const [{ data: g }, { data: s }] = await Promise.all([
        genresApi.get(genreId.value),
        genresApi.songs(genreId.value, { limit: 200 }),
      ]);
      genre.value = g;
      songs.value = s.items;
    }
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isLoading.value = false;
  }
};

const playAll = async () => {
  if (songs.value.length === 0) return;
  await playerStore.setQueueAndPlay(songs.value);
};

const handlePlay = (song: Song) => {
  playerStore.setQueue(songs.value);
  playerStore.play(song);
};

const handleMenuAction = (action: string, song: Song) => {
  switch (action) {
    case 'play':
      handlePlay(song);
      break;
    case 'addToQueue':
      playerStore.addToQueue(song);
      toast.success(t('common.add_to_queue'));
      break;
    case 'addToPlaylist':
      addToPlaylistIds.value = [song.id];
      showAddToPlaylist.value = true;
      break;
  }
};

const onBatchGenre = (ids: number[]) => {
  batchSongIds.value = ids;
  showBatch.value = true;
};

const onBatchDone = (payload?: { primary_genre_id?: number | null; genres?: string[] }) => {
  showBatch.value = false;
  listRef.value?.clearSelection?.();
  const nextId = payload?.primary_genre_id;
  if (nextId && nextId !== genreId.value && !isUncategorized.value) {
    router.replace({ name: 'GenreDetail', params: { id: nextId } });
  } else {
    fetchData();
  }
};

onMounted(fetchData);
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden pb-safe">
    <div class="flex-none px-4 md:px-8 pt-4 md:pt-6 space-y-4">
      <button
        type="button"
        class="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-primary"
        @click="router.push({ name: 'Genres' })"
      >
        <ArrowLeft class="w-4 h-4" /> {{ t('genres.back') }}
      </button>

      <div v-if="isLoading" class="flex justify-center py-20">
        <Loader2 class="w-8 h-8 animate-spin text-primary" />
      </div>

      <header v-else-if="genre" class="flex items-start gap-4 pb-2">
        <div class="w-24 h-24 rounded-xl overflow-hidden bg-bg-elevate flex-shrink-0">
          <CoverImage :cover-id="genre.cover_id ?? undefined" size="medium" class="w-full h-full object-cover" />
        </div>
        <div class="min-w-0 flex-1 space-y-2">
          <h1 class="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Tags class="w-5 h-5 text-primary" />
            {{ genre.name }}
          </h1>
          <p class="text-sm text-text-tertiary">{{ t('genres.song_count', { count: genre.song_count }) }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg bg-primary text-white text-sm inline-flex items-center gap-1"
              @click="playAll"
            >
              <Play class="w-4 h-4" /> {{ t('genres.play_all') }}
            </button>
          </div>
          <p class="text-[11px] text-text-tertiary">{{ t('genres.select_hint') }}</p>
        </div>
      </header>
    </div>

    <div v-if="!isLoading && genre" class="flex-1 overflow-hidden px-4 md:px-8 pb-24 min-h-0">
      <VirtualSongList
        ref="listRef"
        :songs="songs"
        :is-loading="false"
        :has-error="false"
        :has-more="false"
        enable-batch-genre
        @play="handlePlay"
        @menu-action="handleMenuAction"
        @batch-genre="onBatchGenre"
      />
    </div>

    <AddToPlaylistModal v-model="showAddToPlaylist" :song-ids="addToPlaylistIds" />
    <BatchGenreModal
      v-if="showBatch"
      :song-ids="batchSongIds"
      @close="showBatch = false"
      @done="onBatchDone"
    />
  </div>
</template>
