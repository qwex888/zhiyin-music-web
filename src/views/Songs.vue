<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { querySongs } from '@/offline/library-query';
import type { Song } from '@/types';
import { usePlayerStore } from '@/stores/player';
import { useLibraryStore } from '@/stores/library';
import { Search, Filter, ArrowUpDown, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { scrapeApi } from '@/api/scrape';
import { useToast } from '@/composables/useToast';
import VirtualSongList from '@/components/common/VirtualSongList.vue';
import LyricsSearchModal from '@/components/common/LyricsSearchModal.vue';

const playerStore = usePlayerStore();
const libraryStore = useLibraryStore();
const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const songs = ref<Song[]>([]);
const isLoading = ref(false);
const hasError = ref(false);
const searchQuery = ref('');
let fetchId = 0;
const PAGE_SIZE = 200;

// 排序状态
const sortBy = ref('created_at');
const sortOrder = ref<'asc' | 'desc'>('desc');
const showSortMenu = ref(false);

const sortOptions = [
  { value: 'created_at', label: () => t('songs.sort_recent') },
  { value: 'title', label: () => t('songs.sort_title') },
  { value: 'artist', label: () => t('songs.sort_artist') },
  { value: 'duration', label: () => t('songs.sort_duration') },
  { value: 'year', label: () => t('songs.sort_year') },
];

const setSort = (field: string) => {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy.value = field;
    sortOrder.value = field === 'title' ? 'asc' : 'desc';
  }
  showSortMenu.value = false;
  resetAndFetch();
};

// 筛选状态
const showFilterMenu = ref(false);
const filterArtistId = ref<number | undefined>(undefined);
const filterAlbumId = ref<number | undefined>(undefined);

const activeFilterCount = computed(() => {
  let count = 0;
  if (filterArtistId.value) count++;
  if (filterAlbumId.value) count++;
  return count;
});

const filterArtistName = computed(() => {
  if (!filterArtistId.value) return '';
  const artist = libraryStore.artists.find(a => a.id === filterArtistId.value);
  return artist?.name || '';
});

const filterAlbumName = computed(() => {
  if (!filterAlbumId.value) return '';
  const album = libraryStore.albums.find(a => a.id === filterAlbumId.value);
  return album?.name || '';
});

const clearFilters = () => {
  filterArtistId.value = undefined;
  filterAlbumId.value = undefined;
  showFilterMenu.value = false;
  resetAndFetch();
};

const setFilterArtist = (artistId: number | undefined) => {
  filterArtistId.value = artistId;
  filterAlbumId.value = undefined;
  showFilterMenu.value = false;
  resetAndFetch();
};

const setFilterAlbum = (albumId: number | undefined) => {
  filterAlbumId.value = albumId;
  filterArtistId.value = undefined;
  showFilterMenu.value = false;
  resetAndFetch();
};

const buildParams = (pageOffset: number) => {
  const params: {
    limit: number;
    offset: number;
    q?: string;
    sort_by?: string;
    sort_order?: string;
    artist_id?: number;
    album_id?: number;
  } = {
    limit: PAGE_SIZE,
    offset: pageOffset,
  };
  if (searchQuery.value.trim()) params.q = searchQuery.value.trim();
  if (sortBy.value !== 'created_at' || sortOrder.value !== 'desc') {
    params.sort_by = sortBy.value;
    params.sort_order = sortOrder.value;
  }
  if (filterArtistId.value) params.artist_id = filterArtistId.value;
  if (filterAlbumId.value) params.album_id = filterAlbumId.value;
  return params;
};

/** 一次性拉取全部歌曲（分页循环，方式同 Scrape.fetchAllLibrarySongs） */
const fetchSongs = async () => {
  const currentId = ++fetchId;
  isLoading.value = true;
  hasError.value = false;
  const allSongs: Song[] = [];
  let pageOffset = 0;
  try {
    while (true) {
      const data = await querySongs(buildParams(pageOffset));
      if (currentId !== fetchId) return;
      allSongs.push(...data.items);
      if (!data.has_next) break;
      pageOffset += data.items.length;
    }
    songs.value = allSongs;
  } catch (e) {
    if (currentId !== fetchId) return;
    console.error(t('common.error'), e);
    hasError.value = true;
    songs.value = allSongs;
  } finally {
    if (currentId === fetchId) isLoading.value = false;
  }
};

const resetAndFetch = () => {
  songs.value = [];
  hasError.value = false;
  fetchSongs();
};

const debouncedSearch = useDebounceFn(() => {
  resetAndFetch();
}, 350);

watch(searchQuery, () => {
  debouncedSearch();
});

const clearSearch = () => {
  searchQuery.value = '';
};

const retrySongs = () => {
  hasError.value = false;
  fetchSongs();
};

const playSong = (song: Song) => {
  playerStore.play(song);
};

const playAllSongs = () => {
  if (songs.value.length > 0) {
    playerStore.setQueue(songs.value);
    playerStore.play(songs.value[0]);
  }
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
    case 'searchLyrics':
      lyricsSearchTarget.value = song;
      showLyricsSearch.value = true;
      break;
  }
};

const showLyricsSearch = ref(false);
const lyricsSearchTarget = ref<Song | null>(null);

const closeMenus = () => {
  showSortMenu.value = false;
  showFilterMenu.value = false;
};

onMounted(() => {
  if (router.currentRoute.value.query.offline === '1') {
    toast.info(t('offline.route_blocked'));
  }
  fetchSongs();
  libraryStore.fetchArtists({ limit: 1000 });
  libraryStore.fetchAlbums({ limit: 1000 });
});
</script>

<template>
<div class="h-full" @click="closeMenus">
  <div class="flex flex-col h-full p-0 md:p-8  overflow-hidden">
    <!-- Header -->
    <header class="pt-2 md:pt-0 flex-none flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div class="flex items-center gap-4 md:gap-8">
        <h1 class="text-2xl md:text-3xl font-bold text-text-primary">{{ t('songs.title') }}</h1>
        <button class="text-sm text-primary hover:text-primary-hover transition-colors font-medium whitespace-nowrap" @click="playAllSongs">
          {{ t('songs.play_all') }}
        </button>
      </div>
      <div class="flex items-center gap-2 md:gap-3 w-full md:w-auto">
         <div class="relative flex-1 md:flex-none">
           <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
           <input 
             v-model="searchQuery"
             type="text" 
             :placeholder="t('common.search')" 
             class="w-full md:w-64 bg-bg-surface border border-border rounded-full py-2 pl-10 pr-9 text-sm text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
           />
           <button
             v-if="searchQuery"
             class="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
             @click="clearSearch"
             :title="t('common.clear_search')"
           >
             <X class="w-4 h-4" />
           </button>
         </div>

         <!-- Filter Button -->
         <div class="relative">
           <button
             @click.stop="showFilterMenu = !showFilterMenu; showSortMenu = false"
             class="p-2 bg-bg-surface border rounded-full hover:bg-bg-elevate transition-colors flex-shrink-0"
             :class="activeFilterCount > 0 ? 'border-primary text-primary' : 'border-border text-text-secondary hover:text-text-primary'"
             :title="t('common.filter')"
           >
             <Filter class="w-4 h-4" />
           </button>
           <span v-if="activeFilterCount > 0" class="absolute -top-1 -right-1 w-4 h-4 bg-primary text-white text-[10px] rounded-full flex items-center justify-center">{{ activeFilterCount }}</span>

           <!-- Filter Dropdown -->
           <div v-if="showFilterMenu" @click.stop class="absolute right-0 top-full mt-2 w-64 md:w-72 bg-bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden">
             <div class="p-3 border-b border-border flex items-center justify-between">
               <span class="text-sm font-medium text-text-primary">{{ t('common.filter') }}</span>
               <button v-if="activeFilterCount > 0" @click="clearFilters" class="text-xs text-primary hover:text-primary-hover">{{ t('common.clear') }}</button>
             </div>
             <div class="max-h-64 overflow-y-auto p-2 space-y-1">
               <!-- Active filter display -->
               <div v-if="filterArtistName" class="flex items-center justify-between px-3 py-2 bg-primary/10 rounded-lg text-sm">
                 <span class="text-primary truncate">{{ t('songs.artist') }}: {{ filterArtistName }}</span>
                 <button @click="setFilterArtist(undefined)" class="text-primary hover:text-primary-hover"><X class="w-3.5 h-3.5" /></button>
               </div>
               <div v-if="filterAlbumName" class="flex items-center justify-between px-3 py-2 bg-primary/10 rounded-lg text-sm">
                 <span class="text-primary truncate">{{ t('songs.album') }}: {{ filterAlbumName }}</span>
                 <button @click="setFilterAlbum(undefined)" class="text-primary hover:text-primary-hover"><X class="w-3.5 h-3.5" /></button>
               </div>

               <!-- Artist list -->
               <div class="pt-1">
                 <div class="px-3 py-1 text-xs text-text-tertiary font-medium uppercase">{{ t('songs.artist') }}</div>
                 <button
                   v-for="artist in libraryStore.artists.slice(0, 20)"
                   :key="artist.id"
                   @click="setFilterArtist(artist.id)"
                   class="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-bg-elevate transition-colors truncate"
                   :class="filterArtistId === artist.id ? 'text-primary bg-primary/5' : 'text-text-secondary'"
                 >{{ artist.name }}</button>
               </div>

               <!-- Album list -->
               <div class="pt-1 border-t border-border/50">
                 <div class="px-3 py-1 text-xs text-text-tertiary font-medium uppercase">{{ t('songs.album') }}</div>
                 <button
                   v-for="album in libraryStore.albums.slice(0, 20)"
                   :key="album.id"
                   @click="setFilterAlbum(album.id)"
                   class="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-bg-elevate transition-colors truncate"
                   :class="filterAlbumId === album.id ? 'text-primary bg-primary/5' : 'text-text-secondary'"
                 >{{ album.name }}</button>
               </div>
             </div>
           </div>
         </div>

         <!-- Sort Button -->
         <div class="relative">
           <button
             @click.stop="showSortMenu = !showSortMenu; showFilterMenu = false"
             class="p-2 bg-bg-surface border border-border rounded-full hover:bg-bg-elevate transition-colors text-text-secondary hover:text-text-primary flex-shrink-0"
             :title="t('common.sort')"
           >
             <ArrowUpDown class="w-4 h-4" />
           </button>

           <!-- Sort Dropdown -->
           <div v-if="showSortMenu" @click.stop class="absolute right-0 top-full mt-2 w-48 bg-bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden">
             <div class="p-2 space-y-0.5">
               <button
                 v-for="opt in sortOptions"
                 :key="opt.value"
                 @click="setSort(opt.value)"
                 class="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg hover:bg-bg-elevate transition-colors"
                 :class="sortBy === opt.value ? 'text-primary bg-primary/5' : 'text-text-secondary'"
               >
                 <span>{{ opt.label() }}</span>
                 <span v-if="sortBy === opt.value" class="text-xs text-text-tertiary">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
               </button>
             </div>
           </div>
         </div>
      </div>
    </header>

    <div class="flex-1 overflow-hidden">
      <VirtualSongList 
        :songs="songs"
        :is-loading="isLoading"
        :has-more="false"
        :has-error="hasError"
        :enable-navigation="true"
        @play="playSong"
        @retry="retrySongs"
        @menu-action="handleMenuAction"
        @navigate-artist="(id) => id && router.push({ name: 'ArtistDetail', params: { id } })"
        @navigate-album="(id) => id && router.push({ name: 'AlbumDetail', params: { id } })"
      />
    </div>
  </div>

  <LyricsSearchModal
    v-model="showLyricsSearch"
    :song-id="lyricsSearchTarget?.id ?? 0"
    :song-title="lyricsSearchTarget?.title"
    :song-artist="lyricsSearchTarget?.artist_name"
    :song-album="lyricsSearchTarget?.album ?? lyricsSearchTarget?.album_name"
    :song-duration="lyricsSearchTarget?.duration_secs"
  />
</div>
</template>
