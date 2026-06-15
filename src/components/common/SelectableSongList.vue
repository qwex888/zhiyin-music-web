<script setup lang="ts">
import { toRefs, computed } from 'vue';
import { useVirtualList, useInfiniteScroll } from '@vueuse/core';
import type { Song } from '@/types';
import { Loader2, AlertCircle, RefreshCw, Inbox, Clock } from 'lucide-vue-next';
import { useLibraryStore } from '@/stores/library';
import { useI18n } from 'vue-i18n';
import CoverImage from '@/components/common/CoverImage.vue';

const props = withDefaults(defineProps<{
  songs: Song[];
  selectedIds: Set<number>;
  isLoading?: boolean;
  hasMore?: boolean;
  hasError?: boolean;
  itemHeight?: number;
}>(), {
  isLoading: false,
  hasMore: false,
  hasError: false,
  itemHeight: 56,
});

const emit = defineEmits<{
  (e: 'loadMore'): void;
  (e: 'retry'): void;
  (e: 'toggle', songId: number): void;
  (e: 'toggleAll'): void;
}>();

const { songs } = toRefs(props);
const libraryStore = useLibraryStore();
const { t } = useI18n();

const { list, containerProps, wrapperProps } = useVirtualList(songs, {
  itemHeight: props.itemHeight,
  overscan: 5,
});

const containerRef = containerProps.ref;

useInfiniteScroll(containerRef, () => {
  if (props.hasMore && !props.isLoading) {
    emit('loadMore');
  }
}, { distance: 50 });

const isAllSelected = computed(() => {
  return props.songs.length > 0 && props.selectedIds.size === props.songs.length;
});

const isIndeterminate = computed(() => {
  return props.selectedIds.size > 0 && props.selectedIds.size < props.songs.length;
});

const formatDuration = (seconds: number | undefined) => {
  if (!seconds && seconds !== 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const getArtistName = (song: Song) => {
  if (song.artist) return song.artist;
  if (song.artist_name) return song.artist_name;
  return libraryStore.getArtistName(song.artist_id) || t('common.unknown_artist');
};
</script>

<template>
  <div class="flex flex-col h-full bg-bg-surface/50 border border-border rounded-xl overflow-hidden backdrop-blur-sm">
    <!-- Table Header -->
    <div class="grid gap-3 grid-cols-[36px_1fr_52px] md:gap-4 md:grid-cols-[36px_minmax(200px,5fr)_minmax(150px,3fr)_64px] p-3 md:p-4 text-sm font-medium text-text-secondary border-b border-border bg-bg-surface/80 z-10">
      <div class="flex justify-center">
        <input
          type="checkbox"
          :checked="isAllSelected"
          :indeterminate="isIndeterminate"
          class="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer accent-[var(--color-primary)]"
          @change="emit('toggleAll')"
        />
      </div>
      <div class="min-w-0">{{ t('songs.table.title') }}</div>
      <div class="hidden md:block min-w-0">{{ t('songs.table.artist') }}</div>
      <div class="text-right"><Clock class="w-4 h-4 ml-auto" /></div>
    </div>

    <!-- Error State -->
    <div v-if="hasError && songs.length === 0" class="flex-1 flex flex-col items-center justify-center py-16 text-text-secondary">
      <AlertCircle class="w-10 h-10 mb-3 text-red-400 opacity-60" />
      <p class="text-sm font-medium mb-4">{{ t('common.error') }}</p>
      <button
        @click="emit('retry')"
        class="flex items-center gap-2 px-4 py-2 bg-bg-elevate hover:bg-bg-surface border border-border rounded-lg text-sm text-text-primary hover:text-primary transition-colors"
      >
        <RefreshCw class="w-4 h-4" />
        {{ t('common.retry') }}
      </button>
    </div>

    <!-- Empty State -->
    <div v-else-if="!isLoading && songs.length === 0" class="flex-1 flex flex-col items-center justify-center py-16 text-text-secondary">
      <Inbox class="w-12 h-12 mb-3 text-text-tertiary opacity-40" />
      <p class="text-sm font-medium">{{ t('common.no_data') }}</p>
    </div>

    <!-- Virtual List -->
    <div v-else class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-800 scrollbar-track-transparent" v-bind="containerProps">
      <div class="divide-y divide-border" v-bind="wrapperProps">
        <div
          v-for="{ data: song } in list"
          :key="song.id"
          class="group grid gap-3 grid-cols-[36px_1fr_52px] md:gap-4 md:grid-cols-[36px_minmax(200px,5fr)_minmax(150px,3fr)_64px] p-2 md:p-3 items-center hover:bg-bg-elevate transition-colors cursor-pointer box-border"
          :class="{ 'bg-primary/5': selectedIds.has(song.id) }"
          :style="{ height: `${itemHeight}px` }"
          @click="emit('toggle', song.id)"
        >
          <!-- Checkbox -->
          <div class="flex justify-center">
            <input
              type="checkbox"
              :checked="selectedIds.has(song.id)"
              class="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer accent-[var(--color-primary)]"
              @click.stop
              @change="emit('toggle', song.id)"
            />
          </div>

          <!-- Title + Cover -->
          <div class="flex items-center gap-2 md:gap-3 min-w-0 overflow-hidden">
            <div class="w-8 h-8 md:w-9 md:h-9 bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 rounded overflow-hidden flex-shrink-0 shadow-sm">
              <CoverImage :cover-id="song.cover_id" size="thumb" lazy />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-text-primary truncate">{{ song.title }}</div>
              <div class="md:hidden text-xs text-text-secondary truncate">{{ getArtistName(song) }}</div>
            </div>
          </div>

          <!-- Artist -->
          <div class="hidden md:block text-text-secondary text-sm truncate min-w-0">
            {{ getArtistName(song) }}
          </div>

          <!-- Duration -->
          <div class="text-xs md:text-sm text-text-secondary font-mono text-right tabular-nums">
            {{ formatDuration(song.duration_secs || 0) }}
          </div>
        </div>
      </div>

      <!-- Load More -->
      <div v-if="isLoading" class="py-4 flex justify-center items-center text-text-secondary gap-2">
        <Loader2 class="w-4 h-4 animate-spin" />
        <span class="text-sm">{{ t('common.loading') }}</span>
      </div>
    </div>
  </div>
</template>
