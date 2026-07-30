<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { genresApi, type GenreSummary } from '@/api/genres';
import { useI18n } from 'vue-i18n';
import { useToast } from '@/composables/useToast';
import { X, Search, Loader2 } from 'lucide-vue-next';
import GenreChips from '@/components/common/GenreChips.vue';

const props = defineProps<{
  songIds?: number[];
  albumId?: number;
}>();
const emit = defineEmits<{
  close: [];
  done: [payload?: { primary_genre_id?: number | null; genres?: string[] }];
}>();

const { t } = useI18n();
const toast = useToast();
const selectedGenres = ref<string[]>([]);
const searchQuery = ref('');
const searchResults = ref<GenreSummary[]>([]);
const searching = ref(false);
const op = ref<'set' | 'add' | 'remove' | 'clear'>('set');
const writeTags = ref(true);
const lock = ref(true);
const saving = ref(false);

const isAlbumMode = () => props.albumId != null;

const suggestionNames = computed(() =>
  searchResults.value
    .map((g) => g.name)
    .filter((name) => !selectedGenres.value.some((s) => s.toLowerCase() === name.toLowerCase())),
);

const runSearch = async () => {
  searching.value = true;
  try {
    const q = searchQuery.value.trim();
    const { data } = await genresApi.list({ limit: 30, offset: 0, q: q || undefined });
    searchResults.value = data.items;
  } catch (e) {
    console.error(e);
    searchResults.value = [];
  } finally {
    searching.value = false;
  }
};

const debouncedSearch = useDebounceFn(runSearch, 280);

watch(
  searchQuery,
  () => {
    debouncedSearch();
  },
  { immediate: true },
);

const pickResult = (name: string) => {
  if (selectedGenres.value.some((s) => s.toLowerCase() === name.toLowerCase())) return;
  selectedGenres.value = [...selectedGenres.value, name];
};

const submit = async () => {
  saving.value = true;
  try {
    const genres = selectedGenres.value.map((s) => s.trim()).filter(Boolean);
    if (op.value !== 'clear' && genres.length === 0) {
      toast.error(t('genres.enter_genres'));
      return;
    }

    if (isAlbumMode()) {
      const { data } = await genresApi.applyAlbum(props.albumId!, {
        genres: op.value === 'clear' ? [] : genres,
        op: op.value,
        write_tags: writeTags.value,
        lock: lock.value,
      });
      toast.success(t('genres.album_apply_success', { count: data.updated_count }));
      emit('done', {
        primary_genre_id: data.primary_genre_id,
        genres: data.genres,
      });
    } else {
      const songIds = props.songIds ?? [];
      if (songIds.length === 0) {
        toast.error(t('genres.select_songs_first'));
        return;
      }
      const { data } = await genresApi.batchUpdate({
        song_ids: songIds,
        genres: op.value === 'clear' ? [] : genres,
        op: op.value,
        write_tags: writeTags.value,
        lock: lock.value,
      });
      toast.success(t('genres.batch_success', { count: songIds.length }));
      emit('done', {
        primary_genre_id: data.primary_genre_id,
        genres: data.genres,
      });
    }
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[160] bg-black/60 backdrop-blur-sm md:flex md:items-center md:justify-center md:p-4"
      @click.self="emit('close')"
    >
      <div
        class="absolute inset-x-0 bottom-0 max-md:max-h-[85vh] flex flex-col bg-bg-surface border border-border rounded-t-2xl shadow-2xl overflow-hidden
               md:relative md:inset-auto md:w-full md:max-w-md md:rounded-2xl md:max-h-[80vh]"
        @click.stop
      >
        <div class="md:hidden flex justify-center pt-2 pb-1 flex-shrink-0">
          <div class="w-10 h-1 rounded-full bg-text-tertiary/30"></div>
        </div>

        <div class="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h3 class="font-medium text-text-primary">
            {{ albumId != null ? t('genres.apply_to_album') : t('genres.batch_edit') }}
          </h3>
          <button type="button" class="p-1 text-text-tertiary hover:text-text-primary" @click="emit('close')">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto min-h-0 p-5 space-y-4">
          <p v-if="albumId == null" class="text-xs text-text-tertiary">
            {{ t('genres.selected_count', { count: songIds?.length ?? 0 }) }}
          </p>
          <p v-else class="text-xs text-text-tertiary">{{ t('genres.apply_to_album_hint') }}</p>

          <div>
            <label class="block text-xs text-text-secondary mb-1">{{ t('genres.op') }}</label>
            <select v-model="op" class="w-full p-2 rounded-lg bg-bg-elevate border border-border text-sm">
              <option value="set">{{ t('genres.op_set') }}</option>
              <option value="add">{{ t('genres.op_add') }}</option>
              <option value="remove">{{ t('genres.op_remove') }}</option>
              <option value="clear">{{ t('genres.op_clear') }}</option>
            </select>
          </div>

          <div v-if="op !== 'clear'" class="space-y-3">
            <div>
              <label class="block text-xs text-text-secondary mb-1">{{ t('genres.picker_search') }}</label>
              <div class="relative">
                <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
                <input
                  v-model="searchQuery"
                  type="search"
                  class="w-full pl-9 pr-3 py-2 rounded-lg bg-bg-elevate border border-border text-sm"
                  :placeholder="t('genres.search_placeholder')"
                />
                <Loader2
                  v-if="searching"
                  class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-text-tertiary"
                />
              </div>
            </div>

            <div v-if="suggestionNames.length" class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              <button
                v-for="name in suggestionNames"
                :key="name"
                type="button"
                class="px-2.5 py-1 rounded-full text-xs font-medium bg-bg-elevate text-text-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors"
                @click="pickResult(name)"
              >
                {{ name }}
              </button>
            </div>
            <p v-else-if="!searching" class="text-[11px] text-text-tertiary">
              {{ t('genres.picker_empty') }}
            </p>

            <div>
              <label class="block text-xs text-text-secondary mb-1">{{ t('genres.picker_selected') }}</label>
              <GenreChips v-model="selectedGenres" />
            </div>
          </div>

          <label class="flex items-center gap-2 text-sm text-text-primary">
            <input v-model="writeTags" type="checkbox" class="w-4 h-4" />
            {{ t('genres.write_tags') }}
          </label>
          <p class="text-[10px] text-text-tertiary -mt-2">{{ t('genres.write_tags_hint') }}</p>

          <label class="flex items-center gap-2 text-sm text-text-primary">
            <input v-model="lock" type="checkbox" class="w-4 h-4" />
            {{ t('genres.lock') }}
          </label>
        </div>

        <div class="flex justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0">
          <button type="button" class="px-3 py-1.5 text-sm text-text-secondary" @click="emit('close')">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-lg bg-primary text-white disabled:opacity-50"
            :disabled="saving"
            @click="submit"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
