<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { queryBatchSongs, queryAlbumById } from '@/offline/library-query';
import type { Song, Album } from '@/types';
import { ArrowLeft, Play, Disc, Loader2 } from 'lucide-vue-next';
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

const album = ref<Album | null>(null);
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
    case 'viewDetails':
      router.push(`/songs/${song.id}`);
      break;
  }
};

const fetchAlbumDetail = async () => {
  isLoading.value = true;
  const albumId = Number(route.params.id);
  try {
    album.value = await queryAlbumById(albumId);

    if (album.value?.song_ids?.length) {
      songs.value = await queryBatchSongs(album.value.song_ids);
    }
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  fetchAlbumDetail();
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
          {{ album?.name || t('common.loading') }}
        </h1>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-20">
      <Loader2 class="w-10 h-10 animate-spin text-primary" />
    </div>

    <template v-else-if="album">
      <!-- Album Info -->
      <div class="px-4 md:px-8 py-6 flex flex-col sm:flex-row items-center sm:items-end gap-6">
        <div class="w-40 h-40 md:w-48 md:h-48 rounded-xl overflow-hidden border border-border shadow-lg flex-shrink-0">
          <CoverImage :cover-id="album.cover_id" size="large">
            <template #fallback>
              <div class="w-full h-full flex items-center justify-center bg-bg-elevate text-text-tertiary">
                <Disc class="w-16 h-16" />
              </div>
            </template>
          </CoverImage>
        </div>
        <div class="flex flex-col items-center sm:items-start gap-2 min-w-0">
          <h2 class="text-2xl md:text-3xl font-bold text-text-primary text-center sm:text-left break-words">{{ album.name }}</h2>
          <p class="text-text-secondary">{{ album.artist_name || t('common.unknown') }}</p>
          <p class="text-sm text-text-tertiary">
            {{ album.year || t('albums.unknown_year') }} · {{ t('albums.count', { count: songs.length }) }}
          </p>
          <button
            @click="playAll"
            class="mt-3 flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-full font-medium text-sm shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            <Play class="w-4 h-4 fill-current" />
            {{ t('albums.play_all') }}
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
          @play="handlePlay"
          @menu-action="handleMenuAction"
        />
      </div>
    </template>
  </div>
</template>
