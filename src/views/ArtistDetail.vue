<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { queryBatchSongs, queryArtistById } from '@/offline/library-query';
import type { Song, Artist } from '@/types';
import { ArrowLeft, Play, Users, Loader2 } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { usePlayerStore } from '@/stores/player';
import { useToast } from '@/composables/useToast';
import CoverImage from '@/components/common/CoverImage.vue';
import VirtualSongList from '@/components/common/VirtualSongList.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();
const toast = useToast();

const artist = ref<Artist | null>(null);
const songs = ref<Song[]>([]);
const isLoading = ref(true);

const goBack = () => {
  router.back();
};

const playAll = async () => {
  if (songs.value.length === 0) {
    toast.info(t('common.no_data'));
    return;
  }
  playerStore.setQueue(songs.value);
  playerStore.play(songs.value[0]);
};

const fetchArtistDetail = async () => {
  isLoading.value = true;
  const artistId = Number(route.params.id);
  try {
    artist.value = await queryArtistById(artistId);

    if (artist.value?.song_ids?.length) {
      songs.value = await queryBatchSongs(artist.value.song_ids);
    }
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  fetchArtistDetail();
});
</script>

<template>
  <div class="h-full overflow-y-auto pb-24">
    <!-- Header -->
    <div class="sticky top-0 z-10 bg-bg-main/95 backdrop-blur-sm border-b border-border px-4 md:px-8 py-3">
      <div class="flex items-center gap-3">
        <button
          @click="goBack"
          class="p-2 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft class="w-5 h-5" />
        </button>
        <h1 class="text-lg font-semibold text-text-primary truncate">
          {{ artist?.name || t('common.loading') }}
        </h1>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-20">
      <Loader2 class="w-10 h-10 animate-spin text-primary" />
    </div>

    <template v-else-if="artist">
      <!-- Artist Info -->
      <div class="px-4 md:px-8 py-6 flex flex-col sm:flex-row items-center sm:items-end gap-6">
        <div class="w-40 h-40 md:w-48 md:h-48 rounded-full overflow-hidden border border-border shadow-lg flex-shrink-0">
          <CoverImage :cover-id="artist.cover_id" size="large">
            <template #fallback>
              <div class="w-full h-full flex items-center justify-center bg-bg-elevate text-text-tertiary">
                <Users class="w-16 h-16" />
              </div>
            </template>
          </CoverImage>
        </div>
        <div class="flex flex-col items-center sm:items-start gap-2 min-w-0">
          <h2 class="text-2xl md:text-3xl font-bold text-text-primary text-center sm:text-left break-words">{{ artist.name }}</h2>
          <p class="text-sm text-text-tertiary">
            {{ t('artists.count', { count: songs.length }) }} · {{ t('artists.albums', { count: artist.album_count || 0 }) }}
          </p>
          <button
            @click="playAll"
            class="mt-3 flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-full font-medium text-sm shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            <Play class="w-4 h-4 fill-current" />
            {{ t('artists.play_all') }}
          </button>
        </div>
      </div>

      <!-- Song List -->
      <div class="px-4 md:px-8">
        <VirtualSongList
          :songs="songs"
          :is-loading="false"
          :has-error="false"
          :has-more="false"
        />
      </div>
    </template>
  </div>
</template>
