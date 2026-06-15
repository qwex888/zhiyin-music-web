<script setup lang="ts">
import { ref, toRefs, onMounted, watch, type Component } from 'vue';
import { useVirtualList, useInfiniteScroll, onClickOutside } from '@vueuse/core';
import type { Song, RecentSong } from '@/types';
import { Play, Pause, Clock, MoreHorizontal, Loader2, AlertCircle, RefreshCw, Inbox, ListPlus, Search, Info, HardDriveDownload, Cloud } from 'lucide-vue-next';
import { isStrmSong } from '@/types';
import { usePlayerStore } from '@/stores/player';
import { useLibraryStore } from '@/stores/library';
import { useI18n } from 'vue-i18n';
import dayjs from 'dayjs';
import CoverImage from '@/components/common/CoverImage.vue';
import { getCachedSongIds } from '@/offline/media-cache';

export interface MenuAction {
  key: string;
  icon: Component;
  labelKey: string;
}

const defaultMenuActions: MenuAction[] = [
  { key: 'play', icon: Play, labelKey: 'songs.actions.play' },
  { key: 'addToQueue', icon: ListPlus, labelKey: 'songs.actions.add_to_queue' },
  { key: 'scrape', icon: Search, labelKey: 'songs.actions.scrape' },
  { key: 'viewDetails', icon: Info, labelKey: 'songs.actions.view_details' },
];

const props = withDefaults(defineProps<{
  songs: (Song | RecentSong)[];
  isLoading?: boolean;
  hasMore?: boolean;
  hasError?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
  showPlayedAt?: boolean;
  showIndex?: boolean;
  itemHeight?: number;
  menuActions?: MenuAction[];
}>(), {
  isLoading: false,
  hasMore: false,
  hasError: false,
  showArtist: true,
  showAlbum: true,
  showPlayedAt: false,
  showIndex: true,
  itemHeight: 64,
});

const emit = defineEmits<{
  (e: 'loadMore'): void;
  (e: 'play', song: Song): void;
  (e: 'retry'): void;
  (e: 'menuAction', action: string, song: Song): void;
}>();

const { songs } = toRefs(props);
const playerStore = usePlayerStore();
const libraryStore = useLibraryStore();
const { t } = useI18n();

const cachedIds = ref<Set<number>>(new Set());

const refreshCachedIds = async () => {
  cachedIds.value = await getCachedSongIds();
};

onMounted(refreshCachedIds);
watch(songs, refreshCachedIds);

const activeMenuSongId = ref<number | null>(null);
const menuRef = ref<HTMLElement | null>(null);

onClickOutside(menuRef, () => {
  activeMenuSongId.value = null;
});

const menuPosition = ref({ top: '0px', left: '0px' });

const toggleMenu = (songId: number, event: MouseEvent) => {
  if (activeMenuSongId.value === songId) {
    activeMenuSongId.value = null;
    return;
  }
  const btn = event.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect();
  const menuWidth = 168;
  const menuHeight = 180;
  let top = rect.bottom + 4;
  let left = rect.right - menuWidth;
  if (top + menuHeight > window.innerHeight) top = rect.top - menuHeight - 4;
  if (left < 8) left = 8;
  menuPosition.value = { top: `${top}px`, left: `${left}px` };
  activeMenuSongId.value = songId;
};

const handleMenuAction = (action: string, song: Song | RecentSong) => {
  activeMenuSongId.value = null;
  emit('menuAction', action, song as Song);
};

const resolvedMenuActions = () => props.menuActions ?? defaultMenuActions;

const { list, containerProps, wrapperProps } = useVirtualList(songs, {
  itemHeight: props.itemHeight,
  overscan: 5, // 减少预渲染数量，优化性能
});

const containerRef = containerProps.ref;

// Infinite scroll
useInfiniteScroll(containerRef, () => {
  if (props.hasMore && !props.isLoading) {
    emit('loadMore');
  }
}, { distance: 50 });

const formatDuration = (seconds: number | null | undefined) => {
  if (seconds == null) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatTimeAgo = (date: string | undefined) => {
  if (!date) return t('common.just_now');
  return dayjs(date).fromNow();
};

const isCurrentSong = (song: Song | RecentSong) => {
  return playerStore.currentSong?.id === song.id;
};

const getArtistName = (song: Song | RecentSong) => {
  if ('artist' in song && song.artist) return song.artist;
  if ('artist_name' in song && song.artist_name) return song.artist_name; // Fallback if type differs
  return libraryStore.getArtistName(song.artist_id) || t('common.unknown_artist');
};

const getAlbumName = (song: Song | RecentSong) => {
  if ('album' in song && song.album) return song.album;
  return libraryStore.getAlbumName(song.album_id) || t('common.unknown_album');
};

const handlePlay = (song: Song | RecentSong) => {
  // Convert RecentSong to Song if needed, though they are compatible for play
  emit('play', song as Song);
};

</script>

<template>
  <div class="flex flex-col h-full bg-bg-surface/50 border border-border rounded-xl overflow-hidden backdrop-blur-sm">
    <!-- Table Header -->
    <div class="grid p-4 text-sm font-medium text-text-secondary border-b border-border bg-bg-surface/80 z-10"
         :class="[
           showPlayedAt 
             ? 'gap-4 grid-cols-[40px_minmax(200px,5fr)_minmax(120px,2fr)_minmax(120px,2fr)_minmax(100px,1.5fr)_64px_40px]' 
             : 'gap-3 grid-cols-[32px_1fr_52px_32px] md:gap-4 md:grid-cols-[40px_minmax(200px,5fr)_minmax(150px,3fr)_64px_40px] lg:grid-cols-[40px_minmax(220px,5fr)_minmax(150px,3fr)_minmax(150px,2fr)_64px_40px]'
         ]"
    >
      <div v-if="showIndex" class="text-center">#</div>
      <div class="md:hidden flex-1 min-w-0">{{ t('songs.table.title') }}</div>
      <div class="hidden md:block min-w-0">{{ t('songs.table.title') }}</div>
      <div v-if="showArtist" class="hidden md:block min-w-0">{{ t('songs.table.artist') }}</div>
      <div v-if="showAlbum" class="hidden lg:block min-w-0">{{ t('songs.table.album') }}</div>
      <div v-if="showPlayedAt" class="hidden lg:block min-w-0">{{ t('home.recent') }}</div>
      <div class="text-right"><Clock class="w-4 h-4 ml-auto" /></div>
      <div></div>
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

    <!-- Virtual List Container -->
    <div v-else class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-800 scrollbar-track-transparent" v-bind="containerProps">
      <div class="divide-y divide-border" v-bind="wrapperProps">
        <div 
          v-for="{ data: song, index } in list" 
          :key="song.id"
          class="group grid p-3 items-center hover:bg-bg-elevate transition-colors cursor-default box-border h-[64px]"
          :class="[
             { 'bg-primary/5': isCurrentSong(song) },
             showPlayedAt 
               ? 'gap-4 grid-cols-[40px_minmax(200px,5fr)_minmax(120px,2fr)_minmax(120px,2fr)_minmax(100px,1.5fr)_64px_40px]' 
               : 'gap-3 grid-cols-[32px_1fr_52px_32px] md:gap-4 md:grid-cols-[40px_minmax(200px,5fr)_minmax(150px,3fr)_64px_40px] lg:grid-cols-[40px_minmax(220px,5fr)_minmax(150px,3fr)_minmax(150px,2fr)_64px_40px]'
          ]"
          @dblclick="handlePlay(song)"
        >
          <!-- Play Button / Index -->
          <div v-if="showIndex" class="text-center flex justify-center">
            <button 
              v-if="isCurrentSong(song) && playerStore.isPlaying"
              @click.stop="playerStore.pause()"
              class="text-primary"
              :title="t('player.paused')"
            >
               <Pause class="w-4 h-4 fill-current" />
            </button>
            <button 
              v-else
              class="hidden group-hover:block text-text-primary"
              @click.stop="handlePlay(song)"
              :title="t('player.playing')"
            >
              <Play class="w-4 h-4 fill-current" />
            </button>
            <span v-if="!isCurrentSong(song)" class="group-hover:hidden text-text-secondary text-sm font-mono">
              {{ index + 1 }}
            </span>
            <span v-else-if="!playerStore.isPlaying" class="group-hover:hidden text-primary">
              <div class="w-3 h-3 bg-primary rounded-full animate-pulse"></div>
            </span>
          </div>

          <!-- Title (优先显示，分配最多空间) -->
          <div class="flex items-center gap-2 md:gap-3 min-w-0 overflow-hidden">
            <div class="w-9 h-9 md:w-10 md:h-10 bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 rounded overflow-hidden flex-shrink-0 shadow-sm relative">
               <CoverImage
                 :cover-id="song.cover_id"
                 size="thumb"
                 lazy
               />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm md:text-base font-medium truncate" :class="isCurrentSong(song) ? 'text-primary' : 'text-text-primary'">
                  {{ song.title }}
                </span>
                <Cloud
                  v-if="isStrmSong(song)"
                  class="w-3.5 h-3.5 flex-shrink-0 text-sky-400"
                  :title="t('player.strm_badge')"
                />
                <HardDriveDownload
                  v-if="cachedIds.has(song.id)"
                  class="w-3.5 h-3.5 flex-shrink-0 text-emerald-400"
                  :title="t('offline.cached_badge')"
                />
              </div>
              <div class="md:hidden text-xs text-text-secondary truncate">
                {{ getArtistName(song) }}
              </div>
            </div>
          </div>

          <!-- Artist (第二优先级) -->
          <div v-if="showArtist" class="hidden md:block text-text-secondary text-sm truncate hover:text-text-primary cursor-pointer hover:underline transition-colors min-w-0">
            {{ getArtistName(song) }}
          </div>

          <!-- Album (可在空间不足时隐藏) -->
          <div v-if="showAlbum" class="hidden lg:block text-text-secondary text-sm truncate hover:text-text-primary cursor-pointer hover:underline transition-colors min-w-0">
            {{ getAlbumName(song) }}
          </div>

          <!-- Played At -->
          <div v-if="showPlayedAt" class="hidden lg:block text-text-tertiary text-sm truncate min-w-0">
            {{ formatTimeAgo((song as RecentSong).played_at) }}
          </div>

          <!-- Duration (固定宽度，不换行) -->
          <div class="text-xs md:text-sm text-text-secondary font-mono text-right tabular-nums">
            {{ formatDuration(song.duration_secs) }}
          </div>

          <!-- Actions (固定宽度) -->
          <div class="relative flex justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity">
             <button 
               class="p-1 text-text-secondary hover:text-text-primary active:text-text-primary rounded-full hover:bg-bg-surface active:bg-bg-surface transition-colors"
               @click.stop="toggleMenu(song.id, $event)"
               :title="t('common.more_actions')"
             >
               <MoreHorizontal class="w-4 h-4" />
             </button>
             <Teleport to="body">
               <transition name="menu-fade">
                 <div
                   v-if="activeMenuSongId === song.id"
                   ref="menuRef"
                   class="fixed z-[200] min-w-[160px] py-1 bg-bg-surface border border-border rounded-xl shadow-xl"
                   :style="{ top: menuPosition.top, left: menuPosition.left }"
                   @click.stop
                 >
                   <button
                     v-for="action in resolvedMenuActions()"
                     :key="action.key"
                     class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-elevate transition-colors"
                     @click="handleMenuAction(action.key, song)"
                   >
                     <component :is="action.icon" class="w-4 h-4 flex-shrink-0" />
                     <span>{{ t(action.labelKey) }}</span>
                   </button>
                 </div>
               </transition>
             </Teleport>
          </div>
        </div>
      </div>
      
      <!-- Load More Loading State -->
      <div v-if="isLoading" class="py-4 flex justify-center items-center text-text-secondary gap-2">
        <Loader2 class="w-4 h-4 animate-spin" />
        <span class="text-sm">{{ t('common.loading') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 封面加载动画 */
@keyframes shimmer {
  0% {
    background-position: -200px 0;
  }
  100% {
    background-position: 200px 0;
  }
}

.bg-gradient-to-br {
  background-image: linear-gradient(
    90deg,
    rgba(39, 39, 42, 0.5) 0px,
    rgba(63, 63, 70, 0.5) 40px,
    rgba(39, 39, 42, 0.5) 80px
  );
  background-size: 200px 100%;
  animation: shimmer 1.5s infinite linear;
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
