<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDebounceFn } from '@vueuse/core';
import { genresApi, type GenreSummary } from '@/api/genres';
import { Search, Tags, AlertCircle, RefreshCw, Inbox, X, Loader2 } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import CoverImage from '@/components/common/CoverImage.vue';

const { t } = useI18n();
const router = useRouter();
const genres = ref<GenreSummary[]>([]);
const limit = ref(50);
const offset = ref(0);
const isLoading = ref(false);
const isLoadingMore = ref(false);
const hasMore = ref(true);
const hasError = ref(false);
const searchQuery = ref('');
const scrollContainer = ref<HTMLElement | null>(null);
let fetchId = 0;

const presetGenres = computed(() => genres.value.filter((g) => g.origin === 'preset' || !g.origin));
const manualGenres = computed(() => genres.value.filter((g) => g.origin === 'manual'));
const autoGenres = computed(() => genres.value.filter((g) => g.origin === 'auto'));

const goToGenre = (id: number) => {
  router.push({ name: 'GenreDetail', params: { id } });
};

const goUncategorized = () => {
  router.push({ name: 'GenreUncategorized' });
};

const buildParams = (extraOffset?: number) => {
  const params: { limit: number; offset: number; q?: string } = {
    limit: limit.value,
    offset: extraOffset ?? offset.value,
  };
  if (searchQuery.value.trim()) params.q = searchQuery.value.trim();
  return params;
};

const fetchGenres = async () => {
  const currentId = ++fetchId;
  isLoading.value = true;
  hasError.value = false;
  try {
    const { data } = await genresApi.list(buildParams());
    if (currentId !== fetchId) return;
    genres.value = data.items;
    hasMore.value = data.has_next;
  } catch (e) {
    if (currentId !== fetchId) return;
    console.error(e);
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
    const { data } = await genresApi.list(buildParams(nextOffset));
    if (currentId !== fetchId) return;
    genres.value = [...genres.value, ...data.items];
    offset.value = nextOffset;
    hasMore.value = data.has_next;
  } catch (e) {
    if (currentId !== fetchId) return;
    console.error(e);
    hasError.value = true;
  } finally {
    if (currentId === fetchId) isLoadingMore.value = false;
  }
};

const onScroll = () => {
  const el = scrollContainer.value;
  if (!el) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMore();
};

const resetAndFetch = () => {
  offset.value = 0;
  genres.value = [];
  hasMore.value = true;
  hasError.value = false;
  fetchGenres();
};

const debouncedSearch = useDebounceFn(() => resetAndFetch(), 350);
watch(searchQuery, () => debouncedSearch());

onMounted(() => {
  fetchGenres();
  scrollContainer.value?.addEventListener('scroll', onScroll);
});
onUnmounted(() => {
  scrollContainer.value?.removeEventListener('scroll', onScroll);
});
</script>

<template>
  <div ref="scrollContainer" class="h-full overflow-y-auto p-4 md:p-8 pb-24">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <h1 class="text-2xl font-bold text-text-primary flex items-center gap-2">
        <Tags class="w-6 h-6 text-primary" />
        {{ t('genres.title') }}
      </h1>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-2 text-sm rounded-lg border border-border bg-bg-elevate text-text-secondary hover:text-primary"
          @click="goUncategorized"
        >
          {{ t('genres.uncategorized') }}
        </button>
        <div class="relative flex-1 sm:w-64">
          <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            v-model="searchQuery"
            type="text"
            class="w-full pl-9 pr-8 py-2 rounded-lg bg-bg-elevate border border-border text-sm text-text-primary outline-none focus:border-primary"
            :placeholder="t('genres.search_placeholder')"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary"
            @click="searchQuery = ''"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="isLoading && genres.length === 0" class="flex justify-center py-20">
      <Loader2 class="w-8 h-8 animate-spin text-primary" />
    </div>
    <div v-else-if="hasError && genres.length === 0" class="text-center py-20 space-y-3">
      <AlertCircle class="w-10 h-10 mx-auto text-red-400" />
      <p class="text-text-secondary">{{ t('common.error') }}</p>
      <button type="button" class="inline-flex items-center gap-2 text-primary" @click="resetAndFetch">
        <RefreshCw class="w-4 h-4" /> {{ t('common.retry') }}
      </button>
    </div>
    <div v-else-if="genres.length === 0" class="text-center py-20 text-text-tertiary">
      <Inbox class="w-10 h-10 mx-auto mb-3 opacity-50" />
      {{ t('common.no_data') }}
    </div>
    <div v-else class="space-y-8">
      <section v-if="presetGenres.length">
        <h2 class="text-sm font-medium text-text-secondary mb-3">{{ t('genres.section_preset') }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <button
            v-for="g in presetGenres"
            :key="g.id"
            type="button"
            class="text-left group rounded-xl border border-border bg-bg-surface p-3 hover:border-primary/40 transition-colors"
            @click="goToGenre(g.id)"
          >
            <div class="aspect-square rounded-lg overflow-hidden bg-bg-elevate mb-3">
              <CoverImage :cover-id="g.cover_id ?? undefined" size="medium" class="w-full h-full object-cover" />
            </div>
            <p class="font-medium text-text-primary truncate group-hover:text-primary">{{ g.name }}</p>
            <p class="text-xs text-text-tertiary mt-0.5">
              {{ t('genres.song_count', { count: g.song_count }) }}
            </p>
          </button>
        </div>
      </section>

      <section v-if="manualGenres.length">
        <h2 class="text-sm font-medium text-text-secondary mb-3">{{ t('genres.section_manual') }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <button
            v-for="g in manualGenres"
            :key="g.id"
            type="button"
            class="text-left group rounded-xl border border-border bg-bg-surface p-3 hover:border-primary/40 transition-colors"
            @click="goToGenre(g.id)"
          >
            <div class="aspect-square rounded-lg overflow-hidden bg-bg-elevate mb-3">
              <CoverImage :cover-id="g.cover_id ?? undefined" size="medium" class="w-full h-full object-cover" />
            </div>
            <p class="font-medium text-text-primary truncate group-hover:text-primary">{{ g.name }}</p>
            <p class="text-xs text-text-tertiary mt-0.5">
              {{ t('genres.song_count', { count: g.song_count }) }}
            </p>
          </button>
        </div>
      </section>

      <section v-if="autoGenres.length">
        <h2 class="text-sm font-medium text-text-secondary mb-3">{{ t('genres.section_auto') }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <button
            v-for="g in autoGenres"
            :key="g.id"
            type="button"
            class="text-left group rounded-xl border border-dashed border-border bg-bg-surface/80 p-3 hover:border-primary/40 transition-colors"
            @click="goToGenre(g.id)"
          >
            <div class="aspect-square rounded-lg overflow-hidden bg-bg-elevate mb-3">
              <CoverImage :cover-id="g.cover_id ?? undefined" size="medium" class="w-full h-full object-cover" />
            </div>
            <p class="font-medium text-text-primary truncate group-hover:text-primary">{{ g.name }}</p>
            <p class="text-xs text-text-tertiary mt-0.5">
              {{ t('genres.song_count', { count: g.song_count }) }} · {{ t('genres.origin_auto') }}
            </p>
          </button>
        </div>
      </section>
    </div>
    <div v-if="isLoadingMore" class="flex justify-center py-6">
      <Loader2 class="w-5 h-5 animate-spin text-primary" />
    </div>
  </div>
</template>
