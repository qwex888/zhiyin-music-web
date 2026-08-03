<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  X, Loader2, Music2, Pencil, Upload, Search, Mic2, AlertCircle, RefreshCw,
} from 'lucide-vue-next';
import { musicApi } from '@/api/music';
import type { Song } from '@/types';
import { isStrmSong } from '@/types';
import CoverImage from '@/components/common/CoverImage.vue';
import CoverSearchModal, { type CoverSearchPick } from '@/components/common/CoverSearchModal.vue';
import LyricsSearchModal from '@/components/common/LyricsSearchModal.vue';
import { useToast } from '@/composables/useToast';
import { songEvents } from '@/utils/songEvents';
import { useAuthStore } from '@/stores/auth';
import { useScrapeFeature } from '@/composables/useScrapeFeature';

type DetailMode = 'view' | 'edit';
type PendingCover =
  | { kind: 'file'; file: File; previewUrl: string }
  | { kind: 'url'; url: string; source?: string };

const props = withDefaults(defineProps<{
  modelValue: boolean;
  songId: number | null;
  mode?: DetailMode;
}>(), {
  mode: 'view',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'update:mode', value: DetailMode): void;
}>();

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();
const { canWriteStrmSidecar, ensureLoaded: ensureScrapeFeature } = useScrapeFeature();

const strmSidecarWriteOff = computed(
  () => isStrmSong(song.value) && !canWriteStrmSidecar.value
);

const loading = ref(false);
const saving = ref(false);
const loadError = ref(false);
const song = ref<Song | null>(null);
const hasLyrics = ref(false);
const internalMode = ref<DetailMode>('view');

const form = ref({
  title: '',
  artist: '',
  album: '',
  year: '' as string,
  track_no: '' as string,
  genre: '',
});

const pendingCover = ref<PendingCover | null>(null);
const pendingLyrics = ref<string | null>(null);
const showCoverSearch = ref(false);
const showLyricsSearch = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isEdit = computed(() => internalMode.value === 'edit');

const display = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
};

const formatDuration = (seconds: number | null | undefined) => {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
};

const formatBytes = (bytes: number | null | undefined) => {
  if (bytes == null || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const artistName = computed(() => song.value?.artist_name || song.value?.artist || '—');
const albumName = computed(() => song.value?.album_name || song.value?.album || '—');
const genreText = computed(() => {
  if (song.value?.genres?.length) return song.value.genres.join('; ');
  return song.value?.genre || '';
});

const coverPreview = computed(() => {
  if (pendingCover.value?.kind === 'file') return pendingCover.value.previewUrl;
  if (pendingCover.value?.kind === 'url') return pendingCover.value.url;
  return null;
});

const clearPending = () => {
  if (pendingCover.value?.kind === 'file') {
    URL.revokeObjectURL(pendingCover.value.previewUrl);
  }
  pendingCover.value = null;
  pendingLyrics.value = null;
};

const fillForm = (s: Song) => {
  form.value = {
    title: s.title || '',
    artist: s.artist_name || s.artist || '',
    album: s.album_name || s.album || '',
    year: s.year != null ? String(s.year) : '',
    track_no: s.track_no != null ? String(s.track_no) : '',
    genre: s.genres?.length ? s.genres.join('; ') : (s.genre || ''),
  };
};

const load = async () => {
  if (props.songId == null) return;
  loading.value = true;
  loadError.value = false;
  try {
    const [{ data }, lyricsCheck] = await Promise.all([
      musicApi.getSong(props.songId),
      musicApi.checkLyrics(props.songId).catch(() => ({ data: { has_lyrics: false } })),
      ensureScrapeFeature(),
    ]);
    song.value = data;
    hasLyrics.value = Boolean(lyricsCheck.data?.has_lyrics);
    fillForm(data);
  } catch {
    loadError.value = true;
    song.value = null;
  } finally {
    loading.value = false;
  }
};

watch(
  () => [props.modelValue, props.songId, props.mode] as const,
  ([open, id, mode]) => {
    if (!open) {
      clearPending();
      return;
    }
    internalMode.value = mode || 'view';
    emit('update:mode', internalMode.value);
    clearPending();
    if (id != null) load();
  },
);

const close = () => {
  clearPending();
  isOpen.value = false;
};

const switchToEdit = () => {
  if (!song.value) return;
  fillForm(song.value);
  internalMode.value = 'edit';
  emit('update:mode', 'edit');
};

const cancelEdit = () => {
  clearPending();
  if (song.value) fillForm(song.value);
  internalMode.value = 'view';
  emit('update:mode', 'view');
};

const onPickFile = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (pendingCover.value?.kind === 'file') {
    URL.revokeObjectURL(pendingCover.value.previewUrl);
  }
  pendingCover.value = {
    kind: 'file',
    file,
    previewUrl: URL.createObjectURL(file),
  };
};

const onCoverSearchApply = (pick: CoverSearchPick) => {
  if (pendingCover.value?.kind === 'file') {
    URL.revokeObjectURL(pendingCover.value.previewUrl);
  }
  pendingCover.value = { kind: 'url', url: pick.cover_url, source: pick.source };
};

const onLyricsApply = (lyrics: string) => {
  pendingLyrics.value = lyrics;
};

const save = async () => {
  if (props.songId == null || saving.value || !song.value) return;
  saving.value = true;
  try {
    if (pendingCover.value?.kind === 'file') {
      await musicApi.uploadSongCover(props.songId, pendingCover.value.file);
    }
    const body: Parameters<typeof musicApi.updateSongTags>[1] = {
      title: form.value.title.trim(),
      artist: form.value.artist.trim(),
      album: form.value.album.trim(),
      genre: form.value.genre.trim(),
    };
    const year = form.value.year.trim();
    if (year) body.year = Number(year);
    const track = form.value.track_no.trim();
    if (track) body.track_no = Number(track);
    if (pendingLyrics.value != null) {
      if (strmSidecarWriteOff.value) {
        toast.error(t('settings.write_strm_sidecar_lyrics_blocked'));
      } else {
        body.lyrics = pendingLyrics.value;
      }
    }
    if (pendingCover.value?.kind === 'url') body.cover_url = pendingCover.value.url;

    await musicApi.updateSongTags(props.songId, body);
    toast.success(t('songs.detail.save_success'));
    songEvents.emitSongUpdated([props.songId]);
    if (pendingLyrics.value != null && !strmSidecarWriteOff.value) {
      songEvents.emitLyricsChanged(props.songId);
    }
    clearPending();
    await load();
    internalMode.value = 'view';
    emit('update:mode', 'view');
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    toast.error(typeof msg === 'string' && msg ? msg : t('songs.detail.save_error'));
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[160] bg-black/60 backdrop-blur-sm md:flex md:items-center md:justify-center md:p-4"
        @click.self="close"
      >
        <div
          class="absolute inset-0 flex flex-col bg-bg-surface overflow-hidden
                 md:relative md:inset-auto md:max-h-[85vh] md:w-full md:max-w-3xl md:rounded-2xl md:border md:border-border md:shadow-2xl"
          @click.stop
        >
          <div class="flex items-center justify-between px-4 py-3 md:px-5 border-b border-border flex-shrink-0">
            <h3 class="font-bold text-lg text-text-primary">
              {{ isEdit ? t('songs.detail.edit_title') : t('songs.details') }}
            </h3>
            <div class="flex items-center gap-1">
              <button
                v-if="!isEdit && song && authStore.isAdmin"
                class="p-2 text-text-secondary hover:text-text-primary rounded-full hover:bg-bg-elevate"
                :title="t('songs.actions.edit_metadata')"
                @click="switchToEdit"
              >
                <Pencil class="w-5 h-5" />
              </button>
              <button class="p-2 text-text-secondary hover:text-text-primary rounded-full hover:bg-bg-elevate" @click="close">
                <X class="w-5 h-5" />
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto min-h-0 p-4 md:p-5">
            <div v-if="loading" class="flex justify-center py-16">
              <Loader2 class="w-8 h-8 animate-spin text-primary" />
            </div>

            <div v-else-if="loadError" class="flex flex-col items-center py-16 text-text-tertiary gap-3">
              <AlertCircle class="w-10 h-10 opacity-50" />
              <p class="text-sm">{{ t('songs.detail.load_error') }}</p>
              <button class="flex items-center gap-2 text-sm text-primary" @click="load">
                <RefreshCw class="w-4 h-4" />
                {{ t('common.retry') }}
              </button>
            </div>

            <template v-else-if="song">
              <!-- Header cover + titles -->
              <div class="flex gap-4 mb-6">
                <div class="relative w-24 h-24 md:w-28 md:h-28 rounded-xl overflow-hidden bg-bg-elevate flex-shrink-0 border border-border">
                  <img
                    v-if="coverPreview"
                    :src="coverPreview"
                    alt=""
                    class="w-full h-full object-cover"
                  />
                  <CoverImage
                    v-else
                    :cover-id="song.cover_id"
                    size="medium"
                    :lazy="false"
                    :alt="song.title || ''"
                  >
                    <template #fallback>
                      <div class="w-full h-full flex items-center justify-center text-text-tertiary">
                        <Music2 class="w-10 h-10 opacity-40" />
                      </div>
                    </template>
                  </CoverImage>
                </div>
                <div class="flex-1 min-w-0">
                  <template v-if="!isEdit">
                    <h4 class="text-lg font-semibold text-text-primary truncate">{{ display(song.title) }}</h4>
                    <p class="text-sm text-text-secondary truncate mt-1">{{ artistName }}</p>
                    <p class="text-sm text-text-tertiary truncate">{{ albumName }}</p>
                    <p v-if="isStrmSong(song)" class="text-[10px] text-amber-500 mt-2">STRM</p>
                  </template>
                  <template v-else>
                    <p class="text-xs text-text-tertiary mb-2">{{ t('songs.detail.cover_section') }}</p>
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-bg-elevate border border-border hover:border-primary/40"
                        @click="fileInputRef?.click()"
                      >
                        <Upload class="w-3.5 h-3.5" />
                        {{ t('songs.detail.upload_cover') }}
                      </button>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-bg-elevate border border-border hover:border-primary/40"
                        @click="showCoverSearch = true"
                      >
                        <Search class="w-3.5 h-3.5" />
                        {{ t('songs.detail.search_cover') }}
                      </button>
                      <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onPickFile" />
                    </div>
                    <p v-if="pendingCover" class="text-[10px] text-primary mt-2">{{ t('songs.detail.cover_pending') }}</p>
                  </template>
                </div>
              </div>

              <!-- Edit fields -->
              <div v-if="isEdit" class="space-y-3 mb-6">
                <p
                  v-if="strmSidecarWriteOff"
                  class="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2"
                >
                  {{ t('settings.write_strm_sidecar_disabled_hint') }}
                </p>
                <div v-for="field in [
                  { key: 'title', label: t('songs.detail.fields.title') },
                  { key: 'artist', label: t('songs.detail.fields.artist') },
                  { key: 'album', label: t('songs.detail.fields.album') },
                  { key: 'year', label: t('songs.detail.fields.year') },
                  { key: 'track_no', label: t('songs.detail.fields.track_no') },
                  { key: 'genre', label: t('songs.detail.fields.genre') },
                ]" :key="field.key" class="grid grid-cols-[7rem_1fr] gap-2 items-center">
                  <label class="text-xs text-text-secondary">{{ field.label }}</label>
                  <input
                    v-model="(form as any)[field.key]"
                    class="px-3 py-2 bg-bg-main border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <div class="pt-2 border-t border-border">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-xs text-text-secondary">{{ t('songs.detail.lyrics_section') }}</p>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 text-xs text-primary"
                      @click="showLyricsSearch = true"
                    >
                      <Mic2 class="w-3.5 h-3.5" />
                      {{ t('songs.detail.search_lyrics') }}
                    </button>
                  </div>
                  <p class="text-xs text-text-tertiary">
                    <template v-if="pendingLyrics">{{ t('songs.detail.lyrics_pending') }}</template>
                    <template v-else-if="hasLyrics">{{ t('songs.detail.lyrics_present') }}</template>
                    <template v-else>{{ t('songs.detail.lyrics_absent') }}</template>
                  </p>
                </div>
              </div>

              <!-- View sections -->
              <div v-else class="space-y-5">
                <section>
                  <h5 class="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">{{ t('songs.detail.section_basic') }}</h5>
                  <div class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.duration') }}</span><span>{{ formatDuration(song.duration_secs) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.track_no') }}</span><span>{{ display(song.track_no) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.disc_no') }}</span><span>{{ display(song.disc_no) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.year') }}</span><span>{{ display(song.year) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.genre') }}</span><span>{{ display(genreText) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.album_artist') }}</span><span>{{ display(song.album_artist) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.play_count') }}</span><span>{{ display(song.play_count) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.source_type') }}</span><span>{{ display(song.source_type || 'local') }}</span>
                  </div>
                </section>
                <section>
                  <h5 class="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">{{ t('songs.detail.section_audio') }}</h5>
                  <div class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.codec') }}</span><span>{{ display(song.codec) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.bitrate') }}</span><span>{{ song.bitrate != null ? `${song.bitrate} kbps` : '—' }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.sample_rate') }}</span><span>{{ song.sample_rate != null ? `${song.sample_rate} Hz` : '—' }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.channels') }}</span><span>{{ display(song.channels) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.bit_depth') }}</span><span>{{ song.bit_depth != null ? `${song.bit_depth} bit` : '—' }}</span>
                  </div>
                </section>
                <section>
                  <h5 class="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">{{ t('songs.detail.section_file') }}</h5>
                  <div class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.id') }}</span><span>{{ song.id }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.cover_id') }}</span><span>{{ display(song.cover_id) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.file_size') }}</span><span>{{ formatBytes(song.file_size) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.file_path') }}</span><span class="break-all">{{ display(song.file_path) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.created_at') }}</span><span>{{ display(song.created_at) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.updated_at') }}</span><span>{{ display(song.updated_at) }}</span>
                    <span class="text-text-tertiary">{{ t('songs.detail.fields.lyrics') }}</span><span>{{ hasLyrics ? t('songs.detail.lyrics_present') : t('songs.detail.lyrics_absent') }}</span>
                  </div>
                </section>
              </div>
            </template>
          </div>

          <div v-if="isEdit" class="flex gap-2 p-4 border-t border-border flex-shrink-0">
            <button class="flex-1 py-2.5 rounded-xl text-sm bg-bg-elevate" :disabled="saving" @click="cancelEdit">
              {{ t('common.cancel') }}
            </button>
            <button
              class="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary text-white hover:bg-primary-hover disabled:opacity-60 flex items-center justify-center gap-2"
              :disabled="saving"
              @click="save"
            >
              <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
              {{ t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </transition>

    <CoverSearchModal
      v-if="songId != null"
      v-model="showCoverSearch"
      :song-id="songId"
      :song-title="form.title"
      :song-artist="form.artist"
      :song-album="form.album"
      @apply="onCoverSearchApply"
    />
    <LyricsSearchModal
      v-if="songId != null"
      v-model="showLyricsSearch"
      :song-id="songId"
      :song-title="form.title"
      :song-artist="form.artist"
      :song-album="form.album"
      :song-duration="song?.duration_secs"
      :source-type="song?.source_type"
      apply-mode="defer"
      @apply="onLyricsApply"
    />
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
