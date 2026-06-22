<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { queryAlbums } from '@/offline/library-query';
import type { Album } from '@/types';
import { Disc, Play, Search, Grid, List, AlertCircle, RefreshCw, Inbox, X, Loader2 } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import CoverImage from '@/components/common/CoverImage.vue';

const { t } = useI18n();
const albums = ref<Album[]>([]);
const limit = ref(50);
const offset = ref(0);
const isLoading = ref(false);
const isLoadingMore = ref(false);
const hasMore = ref(true);
const hasError = ref(false);
const searchQuery = ref('');
const viewMode = ref<'grid' | 'list'>('grid');
const scrollContainer = ref<HTMLElement | null>(null);
let fetchId = 0;

const buildParams = (extraOffset?: number) => {
  const params: { limit: number; offset: number; q?: string } = {
    limit: limit.value,
    offset: extraOffset ?? offset.value,
  };
  if (searchQuery.value.trim()) params.q = searchQuery.value.trim();
  return params;
};

const fetchAlbums = async () => {
  const currentId = ++fetchId;
  isLoading.value = true;
  hasError.value = false;
  try {
    const data = await queryAlbums(buildParams());
    if (currentId !== fetchId) return;
    albums.value = data.items;
    hasMore.value = data.has_next;
  } catch (e) {
    if (currentId !== fetchId) return;
    console.error(t('common.error'), e);
    hasError.value = true;
    hasMore.value = false;
  } finally {
    if (currentId === fetchId) isLoading.value = false;
  }
};

const loadMore = async () => {
  if (!hasMore.value || isLoading.value || isLoadingMore.value || hasError.value) return;
  const currentId = ++fetchId;
  isLoadingMore.value = true;
  try {
    const nextOffset = offset.value + limit.value;
    const data = await queryAlbums(buildParams(nextOffset));
    if (currentId !== fetchId) return;
    albums.value = [...albums.value, ...data.items];
    offset.value = nextOffset;
    hasMore.value = data.has_next;
  } catch (e) {
    if (currentId !== fetchId) return;
    console.error(t('common.error'), e);
    hasError.value = true;
    hasMore.value = false;
  } finally {
    if (currentId === fetchId) isLoadingMore.value = false;
  }
};

const onScroll = () => {
  const el = scrollContainer.value;
  if (!el) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
    loadMore();
  }
};

const resetAndFetch = () => {
  offset.value = 0;
  albums.value = [];
  hasMore.value = true;
  hasError.value = false;
  fetchAlbums();
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

const retryAlbums = () => {
  hasError.value = false;
  hasMore.value = true;
  if (albums.value.length === 0) {
    offset.value = 0;
    fetchAlbums();
  } else {
    loadMore();
  }
};

onMounted(() => {
  fetchAlbums();
});

onUnmounted(() => {
  fetchId++;
});
</script>

<template>
  <div ref="scrollContainer" class="p-4 md:p-8 pb-24 h-full overflow-y-auto" @scroll="onScroll">
    <header class="flex items-center justify-between mb-8">
      <h1 class="text-3xl font-bold text-text-primary">{{ t('albums.title') }}</h1>
      
      <div class="flex items-center gap-3">
         <div class="relative hidden md:block">
           <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
           <input 
             v-model="searchQuery"
             type="text" 
             :placeholder="t('common.search')" 
             class="bg-bg-surface border border-border rounded-full py-2 pl-10 pr-9 text-sm text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
           />
           <button
             v-if="searchQuery"
             class="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
             @click="clearSearch"
           >
             <X class="w-4 h-4" />
           </button>
         </div>
         <div class="flex bg-bg-surface rounded-lg p-1 border border-border">
           <button
             @click="viewMode = 'grid'"
             class="p-1.5 rounded transition-colors"
             :class="viewMode === 'grid' ? 'bg-bg-elevate text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
           >
             <Grid class="w-4 h-4" />
           </button>
           <button
             @click="viewMode = 'list'"
             class="p-1.5 rounded transition-colors"
             :class="viewMode === 'list' ? 'bg-bg-elevate text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'"
           >
             <List class="w-4 h-4" />
           </button>
         </div>
      </div>
    </header>

    <!-- Loading (initial) -->
    <div v-if="isLoading && albums.length === 0" class="flex justify-center py-20">
      <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>

    <!-- Error State -->
    <div v-else-if="hasError && albums.length === 0" class="flex flex-col items-center justify-center py-20 text-text-secondary">
      <AlertCircle class="w-12 h-12 mb-3 text-red-400 opacity-60" />
      <p class="text-sm font-medium mb-4">{{ t('common.error') }}</p>
      <button
        @click="retryAlbums"
        class="flex items-center gap-2 px-4 py-2 bg-bg-elevate hover:bg-bg-surface border border-border rounded-lg text-sm text-text-primary hover:text-primary transition-colors"
      >
        <RefreshCw class="w-4 h-4" />
        {{ t('common.retry') }}
      </button>
    </div>

    <!-- Empty State -->
    <div v-else-if="!isLoading && albums.length === 0" class="flex flex-col items-center justify-center py-20 text-text-secondary">
      <Inbox class="w-12 h-12 mb-3 text-text-tertiary opacity-40" />
      <p class="text-sm font-medium">{{ searchQuery ? t('common.no_data') : t('common.no_data') }}</p>
    </div>

    <!-- Album Grid -->
    <template v-else>
      <!-- Grid View -->
      <div v-if="viewMode === 'grid'" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
        <div 
          v-for="album in albums" 
          :key="album.id"
          class="group cursor-pointer p-4 rounded-xl hover:bg-bg-elevate transition-colors border border-transparent hover:border-border"
        >
          <div class="relative aspect-square mb-4 bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 rounded-lg shadow-lg overflow-hidden border border-border">
            <CoverImage
              :cover-id="album.cover_id"
              size="medium"
              lazy
              img-class="group-hover:scale-105 transition-transform duration-500"
            >
              <template #fallback>
                <div class="w-full h-full flex items-center justify-center bg-bg-elevate text-text-tertiary">
                  <Disc class="w-16 h-16" />
                </div>
              </template>
            </CoverImage>
            
            <button class="absolute bottom-3 right-3 w-12 h-12 bg-primary-gradient rounded-full flex items-center justify-center shadow-xl opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300 hover:scale-110">
              <Play class="w-6 h-6 text-white fill-current ml-1" />
            </button>
          </div>

          <div class="text-center md:text-left">
            <div class="font-bold text-text-primary truncate text-base mb-1 group-hover:text-primary transition-colors" alt="{{ album.name }}">{{ album.name }}</div>
            <div class="text-sm text-text-secondary truncate">{{ album.artist_name || t('common.unknown') }}</div>
            <div class="text-xs text-text-tertiary mt-1">{{ album.year || t('albums.unknown_year') }} • {{ t('albums.count', { count: album.song_ids?.length || 0 }) }}</div>
          </div>
        </div>
      </div>

      <!-- List View -->
      <div v-else class="space-y-1">
        <div
          v-for="album in albums"
          :key="album.id"
          class="group flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-bg-elevate transition-colors cursor-pointer border border-transparent hover:border-border"
        >
          <div class="relative w-14 h-14 md:w-16 md:h-16 flex-shrink-0 rounded-lg overflow-hidden border border-border bg-bg-elevate">
            <CoverImage
              :cover-id="album.cover_id"
              size="small"
              lazy
              img-class="group-hover:scale-105 transition-transform duration-300"
            >
              <template #fallback>
                <div class="w-full h-full flex items-center justify-center text-text-tertiary">
                  <Disc class="w-7 h-7" />
                </div>
              </template>
            </CoverImage>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-text-primary truncate group-hover:text-primary transition-colors">{{ album.name }}</div>
            <div class="text-sm text-text-secondary truncate">{{ album.artist_name || t('common.unknown') }}</div>
          </div>
          <div class="hidden md:flex items-center gap-6 text-sm text-text-tertiary flex-shrink-0">
            <span class="tabular-nums w-12 text-right">{{ album.year || '—' }}</span>
            <span class="tabular-nums w-16 text-right">{{ t('albums.count', { count: album.song_ids?.length || 0 }) }}</span>
          </div>
          <button class="p-2 rounded-full opacity-0 group-hover:opacity-100 bg-primary-gradient text-white shadow-lg transition-all hover:scale-110 flex-shrink-0">
            <Play class="w-4 h-4 fill-current ml-0.5" />
          </button>
        </div>
      </div>

      <!-- Load More -->
      <div v-if="isLoadingMore" class="py-6 flex justify-center items-center text-text-secondary gap-2">
        <Loader2 class="w-5 h-5 animate-spin" />
        <span class="text-sm">{{ t('common.loading') }}</span>
      </div>
    </template>
  </div>
</template>
