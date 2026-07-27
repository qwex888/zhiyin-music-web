<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { X, Loader2, Check, Plus, ListMusic } from 'lucide-vue-next';
import { playlistsApi } from '@/api/playlists';
import { usePlaylists } from '@/composables/usePlaylists';
import { useToast } from '@/composables/useToast';
import type { PlaylistMembershipItem } from '@/types/playlist';
import PlaylistFormModal from '@/components/common/PlaylistFormModal.vue';
import CoverImage from '@/components/common/CoverImage.vue';

const props = defineProps<{
  modelValue: boolean;
  songIds: number[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'done'): void;
}>();

const { t } = useI18n();
const toast = useToast();
const { myPlaylists, refreshMine, invalidate } = usePlaylists();

const loading = ref(false);
const submitting = ref(false);
/** playlistId → 当前选中曲目中已在该歌单的数量 */
const containedCounts = ref<Map<number, number>>(new Map());
const selected = ref<Set<number>>(new Set());
const showCreate = ref(false);

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const songTotal = computed(() => props.songIds.length);

/** 所选歌曲已全部在该歌单中 → 才禁用 */
const isFullyContained = (playlistId: number) => {
  if (songTotal.value === 0) return false;
  return (containedCounts.value.get(playlistId) || 0) >= songTotal.value;
};

const containedCount = (playlistId: number) => containedCounts.value.get(playlistId) || 0;

const isPartialContained = (playlistId: number) => {
  const n = containedCount(playlistId);
  return n > 0 && n < songTotal.value;
};

const load = async () => {
  if (!props.songIds.length) return;
  loading.value = true;
  selected.value = new Set();
  try {
    await refreshMine(true);
    const uniqueIds = [...new Set(props.songIds)];
    const results = await Promise.all(
      uniqueIds.map((id) => playlistsApi.membership(id)),
    );
    const counts = new Map<number, number>();
    for (const { data } of results) {
      for (const item of data.items as PlaylistMembershipItem[]) {
        if (!item.contains) continue;
        counts.set(item.playlist_id, (counts.get(item.playlist_id) || 0) + 1);
      }
    }
    containedCounts.value = counts;
  } catch {
    toast.error(t('common.error'));
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load();
  },
);

const toggle = (id: number) => {
  if (isFullyContained(id)) {
    toast.info(
      songTotal.value === 1
        ? t('playlist.already_in_playlist')
        : t('playlist.all_already_in_playlist'),
    );
    return;
  }
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
};

const close = () => {
  isOpen.value = false;
};

const submit = async () => {
  if (selected.value.size === 0) {
    toast.info(t('playlist.select_at_least_one'));
    return;
  }
  submitting.value = true;
  try {
    let added = 0;
    let skipped = 0;
    for (const playlistId of selected.value) {
      const { data } = await playlistsApi.addSongs(playlistId, props.songIds);
      added += data.added_count;
      skipped += data.skipped_count;
    }
    invalidate();
    if (added === 0) {
      toast.info(t('playlist.all_already_in_playlist'));
    } else {
      toast.success(t('playlist.added_result', { added, skipped }));
    }
    emit('done');
    close();
  } catch {
    toast.error(t('common.error'));
  } finally {
    submitting.value = false;
  }
};

const onCreated = async (playlist: { id: number }) => {
  try {
    const { data } = await playlistsApi.addSongs(playlist.id, props.songIds);
    invalidate();
    if (data.added_count === 0) {
      toast.info(t('playlist.all_already_in_playlist'));
    } else {
      toast.success(t('playlist.created_and_added'));
    }
    emit('done');
    close();
  } catch {
    toast.error(t('common.error'));
  }
};

const statusText = (playlistId: number) => {
  if (isFullyContained(playlistId)) {
    return songTotal.value === 1
      ? t('playlist.already_added')
      : t('playlist.all_already_added');
  }
  if (isPartialContained(playlistId)) {
    return t('playlist.partial_already_added', {
      count: containedCount(playlistId),
    });
  }
  return '';
};
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm md:flex md:items-center md:justify-center md:p-4"
        @click.self="close"
      >
        <!-- 移动端：底部 85vh 抽屉；桌面：居中卡片 -->
        <div
          class="absolute inset-x-0 bottom-0 max-md:h-[85vh] max-md:max-h-[85vh] flex flex-col bg-bg-surface border border-border rounded-t-2xl shadow-2xl overflow-hidden
                 md:relative md:inset-auto md:h-auto md:max-h-[80vh] md:w-full md:max-w-md md:rounded-2xl"
          @click.stop
        >
          <div class="md:hidden flex justify-center pt-2 pb-1 flex-shrink-0">
            <div class="w-10 h-1 rounded-full bg-text-tertiary/30"></div>
          </div>

          <div class="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
            <h3 class="font-bold text-lg text-text-primary">{{ t('playlist.add_to') }}</h3>
            <button
              class="p-2 text-text-secondary hover:text-text-primary rounded-full hover:bg-bg-elevate"
              @click="close"
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          <div class="flex-1 overflow-y-auto min-h-0 p-3">
            <div v-if="loading" class="flex justify-center py-12">
              <Loader2 class="w-8 h-8 animate-spin text-primary" />
            </div>

            <template v-else>
              <button
                class="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-dashed border-border hover:border-primary/40 hover:bg-bg-elevate text-sm text-primary mb-2"
                @click="showCreate = true"
              >
                <Plus class="w-4 h-4" />
                {{ t('playlist.create_new') }}
              </button>

              <div v-if="myPlaylists.length === 0" class="flex flex-col items-center py-10 text-text-tertiary">
                <ListMusic class="w-10 h-10 mb-3 opacity-40" />
                <p class="text-sm">{{ t('playlist.empty_mine') }}</p>
              </div>

              <button
                v-for="pl in myPlaylists"
                :key="pl.id"
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left mb-1"
                :class="
                  isFullyContained(pl.id)
                    ? 'opacity-50 cursor-not-allowed'
                    : selected.has(pl.id)
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-bg-elevate border border-transparent'
                "
                :disabled="isFullyContained(pl.id)"
                @click="toggle(pl.id)"
              >
                <div class="w-11 h-11 rounded-lg overflow-hidden bg-bg-elevate flex-shrink-0 border border-border">
                  <CoverImage :cover-id="pl.effective_cover_id ?? undefined" size="small">
                    <template #fallback>
                      <div class="w-full h-full flex items-center justify-center">
                        <ListMusic class="w-5 h-5 text-text-tertiary" />
                      </div>
                    </template>
                  </CoverImage>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-text-primary truncate">{{ pl.name }}</div>
                  <div class="text-xs text-text-tertiary">
                    {{ t('playlist.song_count', { count: pl.song_count }) }}
                    <span v-if="statusText(pl.id)"> · {{ statusText(pl.id) }}</span>
                  </div>
                </div>
                <Check
                  v-if="isFullyContained(pl.id) || selected.has(pl.id)"
                  class="w-4 h-4 text-primary flex-shrink-0"
                />
              </button>
            </template>
          </div>

          <div class="flex items-center gap-3 px-5 py-4 border-t border-border flex-shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              class="flex-1 py-2.5 rounded-xl text-sm font-medium text-text-secondary border border-border hover:bg-bg-elevate"
              @click="close"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              class="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-primary-gradient hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
              :disabled="submitting || selected.size === 0"
              @click="submit"
            >
              <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
              {{ t('playlist.confirm_add') }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <PlaylistFormModal v-model="showCreate" @saved="onCreated" />
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

@media (max-width: 767px) {
  .fade-enter-active .absolute,
  .fade-leave-active .absolute {
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .fade-enter-from .absolute,
  .fade-leave-to .absolute {
    transform: translateY(100%);
  }
}
</style>
