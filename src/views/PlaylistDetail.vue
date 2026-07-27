<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowLeft,
  Play,
  ListMusic,
  ListPlus,
  Loader2,
  Pencil,
  Trash2,
  GripVertical,
  Globe,
  Lock,
} from 'lucide-vue-next';
import { playlistsApi } from '@/api/playlists';
import type { PlaylistDetail } from '@/types/playlist';
import type { Song } from '@/types';
import { usePlayerStore } from '@/stores/player';
import { useToast } from '@/composables/useToast';
import { usePlaylists } from '@/composables/usePlaylists';
import CoverImage from '@/components/common/CoverImage.vue';
import VirtualSongList from '@/components/common/VirtualSongList.vue';
import PlaylistFormModal from '@/components/common/PlaylistFormModal.vue';
import AddToPlaylistModal from '@/components/common/AddToPlaylistModal.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();
const toast = useToast();
const { invalidate } = usePlaylists();

const detail = ref<PlaylistDetail | null>(null);
const songs = ref<Song[]>([]);
const loading = ref(true);
const showEdit = ref(false);
const showAddModal = ref(false);
const addSongIds = ref<number[]>([]);
const reorderMode = ref(false);
const dragIndex = ref<number | null>(null);
const savingOrder = ref(false);

const playlistId = computed(() => Number(route.params.id));
const isOwner = computed(() => detail.value?.is_owner === true);

const fetchDetail = async () => {
  loading.value = true;
  try {
    const { data } = await playlistsApi.get(playlistId.value);
    detail.value = data;
    songs.value = data.songs || [];
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 403 || status === 404) {
      toast.error(t('playlist.not_found'));
      router.replace({ name: 'Playlists' });
    } else {
      toast.error(t('common.error'));
    }
  } finally {
    loading.value = false;
  }
};

watch(playlistId, () => {
  void fetchDetail();
});

onMounted(() => {
  void fetchDetail();
});

const goBack = () => {
  router.push({ name: 'Playlists' });
};

const playAll = async () => {
  if (songs.value.length === 0) {
    toast.info(t('common.no_data'));
    return;
  }
  await playerStore.setQueueAndPlay(songs.value);
};

const handlePlay = (song: Song) => {
  playerStore.setQueue(songs.value);
  playerStore.play(song);
};

const handleMenuAction = async (action: string, song: Song) => {
  switch (action) {
    case 'play':
      handlePlay(song);
      break;
    case 'addToQueue':
      playerStore.addToQueue(song);
      toast.success(t('common.add_to_queue'));
      break;
    case 'addToPlaylist':
      addSongIds.value = [song.id];
      showAddModal.value = true;
      break;
    case 'removeFromPlaylist':
      if (!isOwner.value) return;
      try {
        await playlistsApi.removeSongs(playlistId.value, [song.id]);
        songs.value = songs.value.filter((s) => s.id !== song.id);
        if (detail.value) {
          detail.value = {
            ...detail.value,
            song_count: Math.max(0, detail.value.song_count - 1),
          };
        }
        invalidate();
        toast.success(t('playlist.removed_song'));
      } catch {
        toast.error(t('common.error'));
      }
      break;
  }
};

const ownerMenuActions = computed(() => [
  { key: 'play', icon: Play, labelKey: 'songs.actions.play' },
  { key: 'addToQueue', icon: ListPlus, labelKey: 'songs.actions.add_to_queue' },
  { key: 'addToPlaylist', icon: ListMusic, labelKey: 'songs.actions.add_to_playlist' },
  { key: 'removeFromPlaylist', icon: Trash2, labelKey: 'playlist.remove_song' },
]);

const onEdited = (pl: { name: string; description: string | null; is_public: boolean; effective_cover_id: number | null; cover_id: number | null }) => {
  if (!detail.value) return;
  detail.value = {
    ...detail.value,
    ...pl,
  };
  invalidate();
};

const deletePlaylist = async () => {
  if (!detail.value || !confirm(t('playlist.delete_confirm'))) return;
  try {
    await playlistsApi.remove(detail.value.id);
    invalidate();
    toast.success(t('playlist.deleted'));
    router.replace({ name: 'Playlists' });
  } catch {
    toast.error(t('common.error'));
  }
};

const onDragStart = (index: number) => {
  dragIndex.value = index;
};

const onDragOver = (e: DragEvent, index: number) => {
  e.preventDefault();
  if (dragIndex.value === null || dragIndex.value === index) return;
  const list = [...songs.value];
  const [item] = list.splice(dragIndex.value, 1);
  list.splice(index, 0, item);
  songs.value = list;
  dragIndex.value = index;
};

const onDragEnd = async () => {
  dragIndex.value = null;
  if (!isOwner.value) return;
  savingOrder.value = true;
  try {
    const { data } = await playlistsApi.reorder(
      playlistId.value,
      songs.value.map((s) => s.id),
    );
    if (detail.value) {
      detail.value = { ...detail.value, ...data, songs: songs.value };
    }
    toast.success(t('playlist.reordered'));
  } catch {
    toast.error(t('common.error'));
    await fetchDetail();
  } finally {
    savingOrder.value = false;
  }
};
</script>

<template>
  <div class="h-full overflow-y-auto pb-24">
    <div class="sticky top-0 z-10 bg-bg-main/95 backdrop-blur-sm border-b border-border px-4 md:px-8 py-3">
      <div class="flex items-center gap-3">
        <button
          class="p-2 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-text-primary"
          @click="goBack"
        >
          <ArrowLeft class="w-5 h-5" />
        </button>
        <h1 class="text-lg font-semibold text-text-primary truncate flex-1">
          {{ detail?.name || t('common.loading') }}
        </h1>
        <template v-if="isOwner && detail">
          <button
            class="p-2 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-text-primary"
            :title="t('playlist.edit')"
            @click="showEdit = true"
          >
            <Pencil class="w-4 h-4" />
          </button>
          <button
            class="p-2 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-red-500"
            :title="t('playlist.delete')"
            @click="deletePlaylist"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </template>
      </div>
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <Loader2 class="w-10 h-10 animate-spin text-primary" />
    </div>

    <template v-else-if="detail">
      <div class="px-4 md:px-8 py-6 flex flex-col sm:flex-row items-center sm:items-end gap-6">
        <div class="w-40 h-40 md:w-48 md:h-48 rounded-xl overflow-hidden border border-border shadow-lg flex-shrink-0">
          <CoverImage :cover-id="detail.effective_cover_id ?? undefined" size="large">
            <template #fallback>
              <div class="w-full h-full flex items-center justify-center bg-bg-elevate text-text-tertiary">
                <ListMusic class="w-16 h-16" />
              </div>
            </template>
          </CoverImage>
        </div>
        <div class="flex flex-col items-center sm:items-start gap-2 min-w-0">
          <div class="flex items-center gap-2 text-xs text-text-tertiary">
            <span class="inline-flex items-center gap-1">
              <Globe v-if="detail.is_public" class="w-3.5 h-3.5" />
              <Lock v-else class="w-3.5 h-3.5" />
              {{ detail.is_public ? t('playlist.public') : t('playlist.private') }}
            </span>
            <span>·</span>
            <span>{{ detail.owner_user_id }}</span>
          </div>
          <h2 class="text-2xl md:text-3xl font-bold text-text-primary text-center sm:text-left break-words">
            {{ detail.name }}
          </h2>
          <p v-if="detail.description" class="text-sm text-text-secondary text-center sm:text-left">
            {{ detail.description }}
          </p>
          <p class="text-sm text-text-tertiary">
            {{ t('playlist.song_count', { count: songs.length }) }}
          </p>
          <div class="flex items-center gap-3 mt-2">
            <button
              class="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-full font-medium text-sm shadow-lg shadow-primary/20"
              @click="playAll"
            >
              <Play class="w-4 h-4 fill-current" />
              {{ t('albums.play_all') }}
            </button>
            <!-- <button
              v-if="isOwner"
              class="px-4 py-2.5 rounded-full text-sm border border-border hover:bg-bg-elevate text-text-secondary"
              @click="reorderMode = !reorderMode"
            >
              {{ reorderMode ? t('playlist.done_reorder') : t('playlist.reorder') }}
              <span v-if="savingOrder" class="ml-1">…</span>
            </button> -->
          </div>
        </div>
      </div>

      <!-- 拖拽排序模式 -->
      <div v-if="reorderMode && isOwner" class="px-4 md:px-8 space-y-1">
        <div
          v-for="(song, index) in songs"
          :key="song.id"
          draggable="true"
          class="flex items-center gap-3 p-3 rounded-xl bg-bg-surface border border-border cursor-grab active:cursor-grabbing"
          @dragstart="onDragStart(index)"
          @dragover="onDragOver($event, index)"
          @dragend="onDragEnd"
        >
          <GripVertical class="w-4 h-4 text-text-tertiary flex-shrink-0" />
          <span class="text-xs text-text-tertiary w-6">{{ index + 1 }}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-text-primary truncate">{{ song.title }}</div>
            <div class="text-xs text-text-secondary truncate">{{ song.artist_name || song.artist || t('common.unknown_artist') }}</div>
          </div>
        </div>
      </div>

      <div v-else class="px-4 md:px-8">
        <VirtualSongList
          :songs="songs"
          :is-loading="false"
          :has-error="false"
          :has-more="false"
          :menu-actions="isOwner ? ownerMenuActions : undefined"
          @play="handlePlay"
          @menu-action="handleMenuAction"
        />
      </div>
    </template>

    <PlaylistFormModal v-if="detail" v-model="showEdit" :playlist="detail" @saved="onEdited" />
    <AddToPlaylistModal v-model="showAddModal" :song-ids="addSongIds" />
  </div>
</template>
