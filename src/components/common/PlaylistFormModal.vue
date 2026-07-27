<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { X, Loader2, ImagePlus } from 'lucide-vue-next';
import { playlistsApi } from '@/api/playlists';
import { usePlaylists } from '@/composables/usePlaylists';
import { useToast } from '@/composables/useToast';
import type { PlaylistSummary } from '@/types/playlist';

const props = defineProps<{
  modelValue: boolean;
  playlist?: PlaylistSummary | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved', playlist: PlaylistSummary): void;
}>();

const { t } = useI18n();
const toast = useToast();
const { invalidate } = usePlaylists();

const name = ref('');
const description = ref('');
const isPublic = ref(false);
const coverFile = ref<File | null>(null);
const coverPreview = ref<string | null>(null);
const saving = ref(false);
const clearExistingCover = ref(false);

const isEdit = computed(() => !!props.playlist);

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const reset = () => {
  name.value = props.playlist?.name ?? '';
  description.value = props.playlist?.description ?? '';
  isPublic.value = props.playlist?.is_public ?? false;
  coverFile.value = null;
  coverPreview.value = null;
  clearExistingCover.value = false;
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  },
);

const onCoverChange = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(file.type)) {
    toast.error(t('playlist.cover_type_error'));
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast.error(t('playlist.cover_size_error'));
    return;
  }
  coverFile.value = file;
  clearExistingCover.value = false;
  coverPreview.value = URL.createObjectURL(file);
};

const close = () => {
  isOpen.value = false;
};

const submit = async () => {
  const trimmed = name.value.trim();
  if (!trimmed) {
    toast.error(t('playlist.name_required'));
    return;
  }
  saving.value = true;
  try {
    let saved: PlaylistSummary;
    if (isEdit.value && props.playlist) {
      const { data } = await playlistsApi.update(props.playlist.id, {
        name: trimmed,
        description: description.value.trim() || null,
        is_public: isPublic.value,
      });
      saved = data;
      if (coverFile.value) {
        const { data: withCover } = await playlistsApi.uploadCover(saved.id, coverFile.value);
        saved = withCover;
      } else if (clearExistingCover.value && props.playlist.cover_id) {
        const { data: cleared } = await playlistsApi.clearCover(saved.id);
        saved = cleared;
      }
    } else {
      const { data } = await playlistsApi.create({
        name: trimmed,
        description: description.value.trim() || undefined,
        is_public: isPublic.value,
      });
      saved = data;
      if (coverFile.value) {
        const { data: withCover } = await playlistsApi.uploadCover(saved.id, coverFile.value);
        saved = withCover;
      }
    }
    invalidate();
    toast.success(isEdit.value ? t('playlist.updated') : t('playlist.created'));
    emit('saved', saved);
    close();
  } catch {
    toast.error(t('common.error'));
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
        <!-- 移动端：底部 85vh 抽屉；桌面：居中卡片 -->
        <div
          class="absolute inset-x-0 bottom-0 max-md:h-[85vh] max-md:max-h-[85vh] flex flex-col bg-bg-surface border border-border rounded-t-2xl shadow-2xl overflow-hidden
                 md:relative md:inset-auto md:h-auto md:max-h-[90vh] md:w-full md:max-w-md md:rounded-2xl"
          @click.stop
        >
          <div class="md:hidden flex justify-center pt-2 pb-1 flex-shrink-0">
            <div class="w-10 h-1 rounded-full bg-text-tertiary/30"></div>
          </div>

          <div class="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
            <h3 class="font-bold text-lg text-text-primary">
              {{ isEdit ? t('playlist.edit') : t('playlist.create') }}
            </h3>
            <button
              class="p-2 text-text-secondary hover:text-text-primary rounded-full hover:bg-bg-elevate"
              @click="close"
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          <div class="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
            <div>
              <label class="block text-sm text-text-secondary mb-1.5">{{ t('playlist.name') }}</label>
              <input
                v-model="name"
                type="text"
                maxlength="100"
                class="w-full px-3 py-2.5 rounded-xl bg-bg-elevate border border-border text-text-primary text-sm focus:outline-none focus:border-primary"
                :placeholder="t('playlist.name_placeholder')"
              />
            </div>

            <div>
              <label class="block text-sm text-text-secondary mb-1.5">{{ t('playlist.description') }}</label>
              <textarea
                v-model="description"
                rows="3"
                class="w-full px-3 py-2.5 rounded-xl bg-bg-elevate border border-border text-text-primary text-sm focus:outline-none focus:border-primary resize-none"
                :placeholder="t('playlist.description_placeholder')"
              />
            </div>

            <label class="flex items-center gap-3 cursor-pointer select-none">
              <input v-model="isPublic" type="checkbox" class="w-4 h-4 accent-primary" />
              <span class="text-sm text-text-primary">{{ t('playlist.is_public') }}</span>
            </label>

            <div>
              <label class="block text-sm text-text-secondary mb-1.5">{{ t('playlist.cover') }}</label>
              <div class="flex items-center gap-3">
                <div class="w-16 h-16 rounded-lg overflow-hidden bg-bg-elevate border border-border flex items-center justify-center flex-shrink-0">
                  <img v-if="coverPreview" :src="coverPreview" class="w-full h-full object-cover" alt="" />
                  <ImagePlus v-else class="w-6 h-6 text-text-tertiary" />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-bg-elevate cursor-pointer text-text-primary">
                    {{ t('playlist.choose_cover') }}
                    <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="onCoverChange" />
                  </label>
                  <button
                    v-if="isEdit && playlist?.cover_id && !coverFile"
                    type="button"
                    class="text-xs text-text-secondary hover:text-red-500 text-left"
                    @click="clearExistingCover = true"
                  >
                    {{ clearExistingCover ? t('playlist.cover_will_clear') : t('playlist.clear_cover') }}
                  </button>
                </div>
              </div>
            </div>
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
              :disabled="saving"
              @click="submit"
            >
              <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
              {{ t('common.save') }}
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
