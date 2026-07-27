<script setup lang="ts">
import { ref, toRefs, onMounted, onUnmounted, watch, computed, nextTick, type Component, type ComponentPublicInstance } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { onClickOutside, useMediaQuery } from '@vueuse/core';
import type { Song, RecentSong } from '@/types';
import { Play, Pause, Clock, MoreHorizontal, Loader2, AlertCircle, RefreshCw, Inbox, ListPlus, Search, Info, Cloud, Mic2, ListMusic, X } from 'lucide-vue-next';
import { isStrmSong } from '@/types';
import { usePlayerStore } from '@/stores/player';
import { useLibraryStore } from '@/stores/library';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/useToast';
import dayjs from 'dayjs';
import CoverImage from '@/components/common/CoverImage.vue';
import AddToPlaylistModal from '@/components/common/AddToPlaylistModal.vue';
import { getCachedSongIds } from '@/offline/media-cache';

export interface MenuAction {
  key: string;
  icon: Component;
  labelKey: string;
}

const defaultMenuActions: MenuAction[] = [
  { key: 'play', icon: Play, labelKey: 'songs.actions.play' },
  { key: 'addToQueue', icon: ListPlus, labelKey: 'songs.actions.add_to_queue' },
  { key: 'addToPlaylist', icon: ListMusic, labelKey: 'songs.actions.add_to_playlist' },
  { key: 'scrape', icon: Search, labelKey: 'songs.actions.scrape' },
  { key: 'viewDetails', icon: Info, labelKey: 'songs.actions.view_details' },
  { key: 'searchLyrics', icon: Mic2, labelKey: 'songs.actions.search_lyrics' },
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
  adminOnlyActions?: string[];
  enableNavigation?: boolean;
  /** 是否启用多选（默认开启） */
  enableSelection?: boolean;
}>(), {
  isLoading: false,
  hasMore: false,
  hasError: false,
  showArtist: true,
  showAlbum: true,
  showPlayedAt: false,
  showIndex: true,
  itemHeight: 72,
  enableNavigation: false,
  enableSelection: true,
});

const emit = defineEmits<{
  (e: 'loadMore'): void;
  (e: 'play', song: Song): void;
  (e: 'retry'): void;
  (e: 'menuAction', action: string, song: Song): void;
  (e: 'navigateArtist', artistId: number | null | undefined): void;
  (e: 'navigateAlbum', albumId: number | null | undefined): void;
}>();

const { songs } = toRefs(props);
const playerStore = usePlayerStore();
const libraryStore = useLibraryStore();
const { t } = useI18n();
const authStore = useAuthStore();
const toast = useToast();

const isMobile = useMediaQuery('(max-width: 767px)');
const mobileSelectMode = ref(false);
const selectedIds = ref<Set<number>>(new Set());
const showBatchPlaylist = ref(false);

const showCheckboxes = computed(() => {
  if (!props.enableSelection) return false;
  return !isMobile.value || mobileSelectMode.value;
});

const selectedCount = computed(() => selectedIds.value.size);

const selectedSongs = computed(() =>
  songs.value.filter((s) => selectedIds.value.has(s.id)) as Song[],
);

const isAllSelected = computed(() =>
  songs.value.length > 0 && songs.value.every((s) => selectedIds.value.has(s.id)),
);

const isIndeterminate = computed(() =>
  selectedCount.value > 0 && selectedCount.value < songs.value.length,
);

const showActionBar = computed(() => props.enableSelection && selectedCount.value > 0);

const effectiveMenuActions = computed(() => {
  const actions = props.menuActions ?? defaultMenuActions;
  if (authStore.isAdmin) return actions;
  const blocked = new Set(props.adminOnlyActions ?? ['scrape', 'searchLyrics']);
  return actions.filter(a => !blocked.has(a.key));
});

// --- 缓存状态 ---
const cachedIds = ref<Set<number>>(new Set());

const refreshCachedIds = async () => {
  cachedIds.value = await getCachedSongIds();
};

onMounted(refreshCachedIds);

// --- 虚拟滚动 ---
const scrollContainerRef = ref<HTMLElement | null>(null);
let prevFirstId: number | undefined;

const rowVirtualizer = useVirtualizer(computed(() => ({
  count: songs.value.length,
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: () => props.itemHeight,
  overscan: 8,
})));

const virtualItems = computed(() => rowVirtualizer.value.getVirtualItems());
const totalSize = computed(() => rowVirtualizer.value.getTotalSize());

const rowGridStyle = computed(() => {
  const cols: string[] = [];
  if (showCheckboxes.value) cols.push('36px');
  if (props.showIndex) cols.push('40px');
  cols.push('minmax(140px, 4fr)');
  if (props.showArtist) cols.push('minmax(100px, 2fr)');
  if (props.showAlbum) cols.push('minmax(100px, 2fr)');
  if (props.showPlayedAt) cols.push('minmax(88px, 1.5fr)');
  cols.push('64px', '40px');
  return { gridTemplateColumns: cols.join(' ') };
});

const measureRow = (el: Element | ComponentPublicInstance | null) => {
  if (el && el instanceof HTMLElement) {
    rowVirtualizer.value.measureElement(el);
  }
};

watch(songs, (newSongs, oldSongs) => {
  refreshCachedIds();
  const newFirstId = newSongs[0]?.id;
  const isFullReplace = newFirstId !== prevFirstId && oldSongs?.length > 0;
  prevFirstId = newFirstId;
  if (isFullReplace) {
    rowVirtualizer.value.scrollToOffset(0);
    clearSelection(false);
  } else {
    // 清理已不在列表中的选中项
    const valid = new Set(newSongs.map((s) => s.id));
    const next = new Set([...selectedIds.value].filter((id) => valid.has(id)));
    if (next.size !== selectedIds.value.size) selectedIds.value = next;
  }
  nextTick(() => rowVirtualizer.value.measure());
});

watch(showCheckboxes, () => {
  nextTick(() => rowVirtualizer.value.measure());
});

watch(virtualItems, (items) => {
  if (!props.hasMore || props.isLoading || items.length === 0) return;
  const lastItem = items[items.length - 1];
  if (lastItem && lastItem.index >= songs.value.length - 5) {
    emit('loadMore');
  }
});

// --- 选择 ---
const isSelected = (id: number) => selectedIds.value.has(id);

const toggleSelect = (id: number) => {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
};

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(songs.value.map((s) => s.id));
  }
};

const clearSelection = (exitMobileMode = true) => {
  selectedIds.value = new Set();
  if (exitMobileMode) mobileSelectMode.value = false;
};

const enterMobileSelect = (songId: number) => {
  if (!props.enableSelection || !isMobile.value) return;
  mobileSelectMode.value = true;
  selectedIds.value = new Set([songId]);
};

// 长按
const LONG_PRESS_MS = 480;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressTriggered = false;
let suppressNextClick = false;

const clearLongPress = () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
};

const onRowTouchStart = (songId: number) => {
  if (!props.enableSelection || !isMobile.value || mobileSelectMode.value) return;
  longPressTriggered = false;
  clearLongPress();
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    suppressNextClick = true;
    enterMobileSelect(songId);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(12); } catch { /* noop */ }
    }
  }, LONG_PRESS_MS);
};

const onRowTouchMove = () => {
  clearLongPress();
};

const onRowTouchEnd = () => {
  clearLongPress();
};

const onRowClick = (song: Song | RecentSong, e: MouseEvent) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (mobileSelectMode.value) {
    e.preventDefault();
    toggleSelect(song.id);
    return;
  }
};

const onRowContextMenu = (e: Event) => {
  if (longPressTriggered || mobileSelectMode.value) {
    e.preventDefault();
  }
};

const batchAddToQueue = () => {
  const list = selectedSongs.value;
  if (list.length === 0) return;
  let added = 0;
  for (const song of list) {
    if (!playerStore.queue.find((s) => s.id === song.id)) {
      playerStore.addToQueue(song);
      added += 1;
    }
  }
  toast.success(t('songs.batch_added_to_queue', { count: added }));
  clearSelection();
};

const batchAddToPlaylist = () => {
  if (selectedCount.value === 0) return;
  showBatchPlaylist.value = true;
};

const onBatchPlaylistDone = () => {
  clearSelection();
};

// --- 菜单 ---
const activeMenuSongId = ref<number | null>(null);
const menuRef = ref<HTMLElement | null>(null);

onClickOutside(menuRef, () => {
  activeMenuSongId.value = null;
});

const menuPosition = ref({ top: '0px', left: '0px' });

const toggleMenu = (songId: number, event: MouseEvent) => {
  if (mobileSelectMode.value) return;
  if (activeMenuSongId.value === songId) {
    activeMenuSongId.value = null;
    return;
  }
  const btn = event.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect();
  const menuWidth = 168;
  const menuHeight = 220;
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

// --- 工具函数 ---
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
  if ('artist_name' in song && song.artist_name) return song.artist_name;
  return libraryStore.getArtistName(song.artist_id) || t('common.unknown_artist');
};

const getAlbumName = (song: Song | RecentSong) => {
  if ('album' in song && song.album) return song.album;
  return libraryStore.getAlbumName(song.album_id) || t('common.unknown_album');
};

const handlePlay = (song: Song | RecentSong) => {
  if (mobileSelectMode.value) {
    toggleSelect(song.id);
    return;
  }
  emit('play', song as Song);
};

onUnmounted(() => {
  clearLongPress();
});
</script>

<template>
  <div class="flex flex-col h-full bg-bg-surface/50 border border-border rounded-xl overflow-hidden backdrop-blur-sm relative">
    <!-- Table Header -->
    <div
      class="grid gap-3 md:gap-4 px-1 py-4 md:p-4 text-sm font-medium text-text-secondary border-b border-border bg-bg-surface/80 z-10"
      :style="rowGridStyle"
    >
      <div v-if="showCheckboxes" class="flex justify-center self-center" data-select-checkbox>
        <input
          type="checkbox"
          class="w-4 h-4 rounded border-border accent-[var(--color-primary)] cursor-pointer"
          :checked="isAllSelected"
          :indeterminate="isIndeterminate"
          :title="t('songs.select_all')"
          @change="toggleSelectAll"
        />
      </div>
      <div v-if="showIndex" class="text-center self-center">#</div>
      <div class="min-w-0 break-words flex items-center gap-2">
        <span>{{ t('songs.table.title') }}</span>
        <span v-if="showActionBar" class="text-xs font-normal text-primary">
          {{ t('songs.selected_count', { count: selectedCount }) }}
        </span>
      </div>
      <div v-if="showArtist" class="min-w-0 break-words">{{ t('songs.table.artist') }}</div>
      <div v-if="showAlbum" class="min-w-0 break-words">{{ t('songs.table.album') }}</div>
      <div v-if="showPlayedAt" class="min-w-0 break-words">{{ t('home.recent') }}</div>
      <div class="text-right self-center"><Clock class="w-4 h-4 ml-auto" /></div>
      <div class="self-center"></div>
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
    <div
      v-else
      ref="scrollContainerRef"
      class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-800 scrollbar-track-transparent"
      :class="{ 'pb-24': showActionBar }"
    >
      <div class="w-full relative" :style="{ height: `${totalSize}px` }">
        <div
          class="absolute top-0 left-0 w-full"
          :style="{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }"
        >
          <div
            v-for="virtualRow in virtualItems"
            :key="songs[virtualRow.index]?.id ?? virtualRow.index"
            :ref="measureRow"
            :data-index="virtualRow.index"
            class="group grid gap-3 md:gap-4 px-1 py-3 md:p-3 items-start hover:bg-bg-elevate transition-colors cursor-default box-border border-b border-border select-none"
            :style="rowGridStyle"
            :class="{
              'bg-primary/5': isCurrentSong(songs[virtualRow.index]) && !isSelected(songs[virtualRow.index].id),
              'bg-primary/10 ring-1 ring-inset ring-primary/25': isSelected(songs[virtualRow.index].id),
            }"
            @dblclick="handlePlay(songs[virtualRow.index])"
            @click="onRowClick(songs[virtualRow.index], $event)"
            @touchstart.passive="onRowTouchStart(songs[virtualRow.index].id)"
            @touchmove.passive="onRowTouchMove"
            @touchend.passive="onRowTouchEnd"
            @touchcancel.passive="onRowTouchEnd"
            @contextmenu="onRowContextMenu"
          >
            <!-- Checkbox -->
            <div v-if="showCheckboxes" class="flex justify-center self-center pt-0.5" data-select-checkbox>
              <input
                type="checkbox"
                class="w-4 h-4 rounded border-border accent-[var(--color-primary)] cursor-pointer"
                :checked="isSelected(songs[virtualRow.index].id)"
                @click.stop
                @change="toggleSelect(songs[virtualRow.index].id)"
              />
            </div>

            <!-- Play Button / Index -->
            <div v-if="showIndex" class="text-center flex justify-center self-center pt-0.5">
              <button
                v-if="isCurrentSong(songs[virtualRow.index]) && playerStore.isPlaying"
                @click.stop="playerStore.pause()"
                class="text-primary"
                :title="t('player.paused')"
              >
                 <Pause class="w-4 h-4 fill-current" />
              </button>
              <button
                v-else
                class="hidden group-hover:block text-text-primary"
                @click.stop="handlePlay(songs[virtualRow.index])"
                :title="t('player.playing')"
              >
                <Play class="w-4 h-4 fill-current" />
              </button>
              <span v-if="!isCurrentSong(songs[virtualRow.index])" class="group-hover:hidden text-text-secondary text-sm font-mono">
                {{ virtualRow.index + 1 }}
              </span>
              <span v-else-if="!playerStore.isPlaying" class="group-hover:hidden text-primary">
                <div class="w-3 h-3 bg-primary rounded-full animate-pulse"></div>
              </span>
            </div>

            <!-- Title -->
            <div class="flex items-start gap-2 md:gap-3 min-w-0">
              <div class="w-9 h-9 md:w-10 md:h-10 from-zinc-800/50 to-zinc-900/50 rounded overflow-hidden flex-shrink-0 shadow-sm relative">
                 <CoverImage
                   :cover-id="songs[virtualRow.index].cover_id"
                   size="thumb"
                   lazy
                 />
              </div>
              <div class="min-w-0 flex-1">
                <div
                  class="text-sm md:text-base font-medium leading-snug break-words whitespace-normal"
                  :class="isCurrentSong(songs[virtualRow.index]) || isSelected(songs[virtualRow.index].id) ? 'text-primary' : 'text-text-primary'"
                >
                  {{ songs[virtualRow.index].title }}
                </div>
                <div v-if="isStrmSong(songs[virtualRow.index])" class="flex items-center gap-1 mt-1">
                  <Cloud
                    class="w-3 h-3 flex-shrink-0 text-sky-400"
                    :title="t('player.strm_badge')"
                  />
                  <span class="text-xs text-sky-400">{{ t('player.strm_badge') }}</span>
                </div>
              </div>
            </div>

            <!-- Artist -->
            <div
              v-if="showArtist"
              class="text-text-secondary text-sm leading-snug break-words whitespace-normal transition-colors min-w-0"
              :class="enableNavigation && !mobileSelectMode ? 'hover:text-text-primary cursor-pointer hover:underline' : ''"
              @click.stop="!mobileSelectMode && enableNavigation && emit('navigateArtist', songs[virtualRow.index].artist_id)"
            >
              {{ getArtistName(songs[virtualRow.index]) }}
            </div>

            <!-- Album -->
            <div
              v-if="showAlbum"
              class="text-text-secondary text-sm leading-snug break-words whitespace-normal transition-colors min-w-0"
              :class="enableNavigation && !mobileSelectMode ? 'hover:text-text-primary cursor-pointer hover:underline' : ''"
              @click.stop="!mobileSelectMode && enableNavigation && emit('navigateAlbum', songs[virtualRow.index].album_id)"
            >
              {{ getAlbumName(songs[virtualRow.index]) }}
            </div>

            <!-- Played At -->
            <div
              v-if="showPlayedAt"
              class="text-text-tertiary text-sm leading-snug break-words whitespace-normal min-w-0"
            >
              {{ formatTimeAgo((songs[virtualRow.index] as RecentSong).played_at) }}
            </div>

            <!-- Duration -->
            <div class="text-xs md:text-sm text-text-secondary font-mono text-right tabular-nums self-center whitespace-nowrap">
              {{ formatDuration(songs[virtualRow.index].duration_secs) }}
            </div>

            <!-- Actions -->
            <div class="relative flex justify-center self-center md:opacity-0 md:group-hover:opacity-100 transition-opacity">
               <button
                 v-if="!mobileSelectMode"
                 class="p-1 text-text-secondary hover:text-text-primary active:text-text-primary rounded-full hover:bg-bg-surface active:bg-bg-surface transition-colors"
                 @click.stop="toggleMenu(songs[virtualRow.index].id, $event)"
                 :title="t('common.more_actions')"
               >
                 <MoreHorizontal class="w-4 h-4" />
               </button>
               <Teleport to="body">
                 <transition name="menu-fade">
                   <div
                     v-if="activeMenuSongId === songs[virtualRow.index].id"
                     ref="menuRef"
                     class="fixed z-[200] min-w-[160px] py-1 bg-bg-surface border border-border rounded-xl shadow-xl"
                     :style="{ top: menuPosition.top, left: menuPosition.left }"
                     @click.stop
                   >
                     <button
                       v-for="action in effectiveMenuActions"
                       :key="action.key"
                       class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-elevate transition-colors"
                       @click="handleMenuAction(action.key, songs[virtualRow.index])"
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
      </div>

      <div v-if="isLoading" class="py-4 flex justify-center items-center text-text-secondary gap-2">
        <Loader2 class="w-4 h-4 animate-spin" />
        <span class="text-sm">{{ t('common.loading') }}</span>
      </div>
    </div>

    <!-- 批量操作条：固定在列表底部，避开播放条 -->
    <Teleport to="body">
      <transition name="bar-slide">
        <div
          v-if="showActionBar"
          class="fixed inset-x-0 z-[105] px-3 md:px-6 pointer-events-none"
          style="bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px))"
        >
          <div class="pointer-events-auto mx-auto max-w-3xl flex items-center gap-2 p-2 md:p-2.5 rounded-2xl bg-bg-surface/95 backdrop-blur-md border border-border shadow-2xl">
            <span class="hidden sm:inline text-xs text-text-secondary px-2 whitespace-nowrap">
              {{ t('songs.selected_count', { count: selectedCount }) }}
            </span>
            <button
              class="flex-1 flex items-center justify-center gap-1.5 py-2.5 md:py-2 rounded-xl text-sm font-medium text-text-primary bg-bg-elevate hover:bg-bg-main border border-border transition-colors"
              @click="batchAddToQueue"
            >
              <ListPlus class="w-4 h-4" />
              <span class="truncate">{{ t('songs.batch_add_to_queue') }}</span>
            </button>
            <button
              class="flex-1 flex items-center justify-center gap-1.5 py-2.5 md:py-2 rounded-xl text-sm font-medium text-white bg-primary-gradient hover:brightness-110 transition-all"
              @click="batchAddToPlaylist"
            >
              <ListMusic class="w-4 h-4" />
              <span class="truncate">{{ t('songs.batch_add_to_playlist') }}</span>
            </button>
            <button
              class="p-2.5 rounded-xl text-text-secondary hover:text-text-primary hover:bg-bg-elevate border border-border transition-colors flex-shrink-0"
              :title="t('songs.clear_selection')"
              @click="clearSelection()"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>
      </transition>
    </Teleport>

    <AddToPlaylistModal
      v-model="showBatchPlaylist"
      :song-ids="[...selectedIds]"
      @done="onBatchPlaylistDone"
    />
  </div>
</template>

<style scoped>
.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
.bar-slide-enter-active,
.bar-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.bar-slide-enter-from,
.bar-slide-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
