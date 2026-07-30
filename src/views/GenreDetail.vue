<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { genresApi, type GenreSummary } from '@/api/genres';
import type { Song } from '@/types';
import { useI18n } from 'vue-i18n';
import { usePlayerStore } from '@/stores/player';
import { useToast } from '@/composables/useToast';
import CoverImage from '@/components/common/CoverImage.vue';
import { ArrowLeft, Play, Loader2, Tags } from 'lucide-vue-next';
import BatchGenreModal from '@/components/common/BatchGenreModal.vue';

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
const selectedIds = ref<Set<number>>(new Set());
const showBatch = ref(false);

watch(
  () => route.params.id,
  () => {
    if (!isUncategorized.value) fetchData();
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

const toggleSelect = (id: number) => {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
};

const openBatch = () => {
  if (selectedIds.value.size === 0) {
    toast.info(t('genres.select_songs_first'));
    return;
  }
  showBatch.value = true;
};

onMounted(fetchData);
</script>

<template>
  <div class="p-4 md:p-8 pb-24 space-y-6">
    <button type="button" class="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-primary" @click="router.push({ name: 'Genres' })">
      <ArrowLeft class="w-4 h-4" /> {{ t('genres.back') }}
    </button>

    <div v-if="isLoading" class="flex justify-center py-20">
      <Loader2 class="w-8 h-8 animate-spin text-primary" />
    </div>

    <template v-else-if="genre">
      <header class="flex items-start gap-4">
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
            <button type="button" class="px-3 py-1.5 rounded-lg bg-primary text-white text-sm inline-flex items-center gap-1" @click="playAll">
              <Play class="w-4 h-4" /> {{ t('genres.play_all') }}
            </button>
            <button type="button" class="px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary" @click="openBatch">
              {{ t('genres.batch_edit') }}
            </button>
          </div>
        </div>
      </header>

      <div class="space-y-1">
        <button
          v-for="song in songs"
          :key="song.id"
          type="button"
          class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-bg-elevate text-left"
          @click="playerStore.play(song)"
        >
          <input
            type="checkbox"
            class="w-4 h-4"
            :checked="selectedIds.has(song.id)"
            @click.stop="toggleSelect(song.id)"
          />
          <div class="w-10 h-10 rounded overflow-hidden bg-bg-elevate flex-shrink-0">
            <CoverImage :cover-id="song.cover_id" size="thumb" class="w-full h-full object-cover" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-text-primary truncate">{{ song.title || song.file_path }}</p>
            <p class="text-xs text-text-tertiary truncate">
              {{ song.artist_name || '—' }}
              <span v-if="song.genres?.length"> · {{ song.genres.join(', ') }}</span>
            </p>
          </div>
        </button>
      </div>
    </template>

    <BatchGenreModal
      v-if="showBatch"
      :song-ids="[...selectedIds]"
      @close="showBatch = false"
      @done="(payload) => {
        showBatch = false;
        selectedIds.clear();
        const nextId = payload?.primary_genre_id;
        if (nextId && nextId !== genreId && !isUncategorized) {
          router.replace({ name: 'GenreDetail', params: { id: nextId } });
        } else {
          fetchData();
        }
      }"
    />
  </div>
</template>
