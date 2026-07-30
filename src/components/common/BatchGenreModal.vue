<script setup lang="ts">
import { ref } from 'vue';
import { genresApi } from '@/api/genres';
import { useI18n } from 'vue-i18n';
import { useToast } from '@/composables/useToast';
import { X } from 'lucide-vue-next';

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
const genresInput = ref('');
const op = ref<'set' | 'add' | 'remove' | 'clear'>('set');
const writeTags = ref(true);
const lock = ref(true);
const saving = ref(false);

const isAlbumMode = () => props.albumId != null;

const submit = async () => {
  saving.value = true;
  try {
    const genres = genresInput.value
      .split(/[;|,/、，]/)
      .map((s) => s.trim())
      .filter(Boolean);
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
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-2xl bg-bg-surface border border-border p-5 space-y-4 shadow-xl">
      <div class="flex items-center justify-between">
        <h3 class="font-medium text-text-primary">
          {{ albumId != null ? t('genres.apply_to_album') : t('genres.batch_edit') }}
        </h3>
        <button type="button" class="text-text-tertiary" @click="emit('close')"><X class="w-5 h-5" /></button>
      </div>
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

      <div v-if="op !== 'clear'">
        <label class="block text-xs text-text-secondary mb-1">{{ t('genres.genres_input') }}</label>
        <input
          v-model="genresInput"
          type="text"
          class="w-full p-2 rounded-lg bg-bg-elevate border border-border text-sm"
          :placeholder="t('genres.genres_placeholder')"
        />
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

      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="px-3 py-1.5 text-sm text-text-secondary" @click="emit('close')">{{ t('common.cancel') }}</button>
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
</template>
