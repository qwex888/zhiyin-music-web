<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search, X, Check, Loader2, Image as ImageIcon } from 'lucide-vue-next';
import { musicApi } from '@/api/music';
import { useToast } from '@/composables/useToast';
import { useScrapeSources } from '@/composables/useScrapeSources';
import { useScrapeFeature } from '@/composables/useScrapeFeature';
import { useRouter } from 'vue-router';

export interface CoverSearchPick {
  cover_url: string;
  source?: string;
  title?: string;
}

const props = defineProps<{
  modelValue: boolean;
  songId: number;
  songTitle?: string;
  songArtist?: string;
  songAlbum?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'apply', pick: CoverSearchPick): void;
}>();

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const { getSourceLabel, getSourceColorClass, ensureLoaded } = useScrapeSources();
const { ensureLoaded: ensureScrapeFeature, isEnabled: scrapeEnabled } = useScrapeFeature();

const title = ref('');
const artist = ref('');
const album = ref('');
const isSearching = ref(false);
const selectedUrl = ref<string | null>(null);
const results = ref<Array<{
  source: string;
  song_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  cover_url: string;
}>>([]);

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const close = () => {
  isOpen.value = false;
};

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    title.value = props.songTitle || '';
    artist.value = props.songArtist || '';
    album.value = props.songAlbum || '';
    results.value = [];
    selectedUrl.value = null;
    await ensureLoaded();
    await ensureScrapeFeature();
    if (!scrapeEnabled.value) {
      toast.info(t('scrape.disabled_toast'));
      close();
      await router.push({ path: '/settings', hash: '#scrape-feature' });
    }
  },
);

const handleSearch = async () => {
  if (isSearching.value) return;
  isSearching.value = true;
  selectedUrl.value = null;
  try {
    const { data } = await musicApi.searchCovers(props.songId, {
      title: title.value.trim() || undefined,
      artist: artist.value.trim() || undefined,
      album: album.value.trim() || undefined,
    });
    results.value = data.results;
    if (data.results.length === 0) {
      toast.info(t('songs.cover_search.no_results'));
    }
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    toast.error(typeof msg === 'string' && msg ? msg : t('common.error'));
  } finally {
    isSearching.value = false;
  }
};

const apply = () => {
  const item = results.value.find((r) => r.cover_url === selectedUrl.value);
  if (!item) return;
  emit('apply', {
    cover_url: item.cover_url,
    source: item.source,
    title: item.title,
  });
  toast.success(t('songs.cover_search.staged'));
  close();
};
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[210] bg-black/60 backdrop-blur-sm md:flex md:items-center md:justify-center md:p-4"
        @click.self="close"
      >
        <div
          class="absolute inset-x-0 bottom-0 max-md:h-[85vh] max-md:max-h-[85vh] flex flex-col bg-bg-surface border border-border rounded-t-2xl shadow-2xl overflow-hidden
                 md:relative md:inset-auto md:h-auto md:max-h-[80vh] md:w-full md:max-w-lg md:rounded-2xl"
          @click.stop
        >
          <div class="md:hidden flex justify-center pt-2 pb-1 flex-shrink-0">
            <div class="w-10 h-1 rounded-full bg-text-tertiary/30"></div>
          </div>

          <div class="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
            <h3 class="font-bold text-lg text-text-primary">{{ t('songs.cover_search.title') }}</h3>
            <button class="p-2 text-text-secondary hover:text-text-primary rounded-full hover:bg-bg-elevate" @click="close">
              <X class="w-5 h-5" />
            </button>
          </div>

          <div class="px-4 py-3 border-b border-border space-y-2 flex-shrink-0">
            <div class="grid grid-cols-3 gap-2">
              <input v-model="title" class="px-2 py-1.5 bg-bg-main border border-border rounded-lg text-sm" :placeholder="t('lyrics.title')" @keydown.enter="handleSearch" />
              <input v-model="artist" class="px-2 py-1.5 bg-bg-main border border-border rounded-lg text-sm" :placeholder="t('lyrics.artist')" @keydown.enter="handleSearch" />
              <input v-model="album" class="px-2 py-1.5 bg-bg-main border border-border rounded-lg text-sm" :placeholder="t('lyrics.album')" @keydown.enter="handleSearch" />
            </div>
            <button
              class="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium bg-primary text-white hover:bg-primary-hover disabled:opacity-60"
              :disabled="isSearching"
              @click="handleSearch"
            >
              <Loader2 v-if="isSearching" class="w-4 h-4 animate-spin" />
              <Search v-else class="w-4 h-4" />
              {{ t('songs.cover_search.search') }}
            </button>
          </div>

          <div class="flex-1 overflow-y-auto min-h-0 p-4">
            <div v-if="isSearching" class="flex justify-center py-12">
              <Loader2 class="w-8 h-8 animate-spin text-primary" />
            </div>
            <div v-else-if="results.length === 0" class="flex flex-col items-center py-12 text-text-tertiary text-sm">
              <ImageIcon class="w-10 h-10 mb-3 opacity-40" />
              {{ t('songs.cover_search.empty_hint') }}
            </div>
            <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <button
                v-for="item in results"
                :key="`${item.source}-${item.song_id}-${item.cover_url}`"
                type="button"
                class="relative rounded-xl overflow-hidden border-2 transition-all text-left"
                :class="selectedUrl === item.cover_url ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40'"
                @click="selectedUrl = item.cover_url"
              >
                <div class="aspect-square bg-bg-elevate">
                  <img :src="item.cover_url" :alt="item.title" class="w-full h-full object-cover" loading="lazy" />
                </div>
                <div class="p-2">
                  <p class="text-xs text-text-primary truncate">{{ item.title }}</p>
                  <span class="text-[10px] text-text-tertiary" :class="getSourceColorClass(item.source)">
                    {{ getSourceLabel(item.source) }}
                  </span>
                </div>
                <div
                  v-if="selectedUrl === item.cover_url"
                  class="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center"
                >
                  <Check class="w-3.5 h-3.5" />
                </div>
              </button>
            </div>
          </div>

          <div class="p-4 border-t border-border flex-shrink-0">
            <button
              class="w-full py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="!selectedUrl"
              @click="apply"
            >
              {{ t('songs.cover_search.apply') }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
