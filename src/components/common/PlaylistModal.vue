<script setup lang="ts">
import { computed } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useI18n } from 'vue-i18n';
import { X, Play, Music2, Trash2, Cloud } from 'lucide-vue-next';
import { isStrmSong } from '@/types';
import { useVirtualList } from '@vueuse/core';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const playerStore = usePlayerStore();
const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const close = () => {
  isOpen.value = false;
};

const formatDuration = (seconds: number | null | undefined) => {
  if (seconds == null) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const playSong = (index: number) => {
  const song = playerStore.queue[index];
  if (!song) return;
  // 同曲再点无效果（store.play 也会拦截；此处避免多余调用）
  if (playerStore.currentSong?.id === song.id) return;
  playerStore.play(song);
};

const removeSong = (e: Event, index: number) => {
  e.stopPropagation();
  playerStore.queue.splice(index, 1);
};

const clearQueue = () => {
  playerStore.queue = [];
  close();
};

const queue = computed(() => playerStore.queue);
const { list, containerProps, wrapperProps } = useVirtualList(queue, {
  itemHeight: 56, // p-2 gap-3, text sizes... approx 56px?
  overscan: 10
});
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div 
        v-if="isOpen" 
        class="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
        @click="close"
      ></div>
    </transition>

    <transition name="slide-up">
      <div 
        v-if="isOpen"
        v-click-outside="close"
        class="fixed inset-x-0 bottom-0 z-[111] bg-bg-surface border-t border-border rounded-t-2xl shadow-2xl max-h-[70vh] flex flex-col md:max-w-md md:left-auto md:right-4 md:bottom-24 md:rounded-2xl md:border"
      >
      <!-- Header -->
      <div class="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div class="flex items-center gap-2">
          <h3 class="font-bold text-lg text-text-primary">{{ t('player.queue') }}</h3>
          <span class="text-xs text-text-tertiary bg-bg-elevate px-2 py-0.5 rounded-full">{{ playerStore.queue.length }}</span>
        </div>
        <div class="flex items-center gap-2">
          <button 
            @click="clearQueue" 
            class="text-xs text-text-secondary hover:text-red-500 transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-elevate"
            v-if="playerStore.queue.length > 0"
            :title="t('common.clear')"
          >
            <Trash2 class="w-3.5 h-3.5" />
            {{ t('common.clear') }}
          </button>
          <button 
            @click="close"
            class="p-2 -mr-2 text-text-secondary hover:text-text-primary transition-colors rounded-full hover:bg-bg-elevate"
            :title="t('common.close')"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- List -->
      <div v-bind="containerProps" class="flex-1 overflow-y-auto min-h-0 p-2 space-y-1">
        <div v-bind="wrapperProps">
          <div 
            v-for="{ data: song, index } in list" 
            :key="song.id || index"
            class="flex items-center gap-3 p-2 rounded-lg group hover:bg-bg-elevate transition-colors cursor-pointer h-[56px] box-border"
            :class="{ 'bg-primary/5': playerStore.currentIndex === index }"
            @click="playSong(index)"
          >
            <!-- Playing Indicator / Number -->
            <div class="w-8 flex justify-center text-xs font-mono text-text-tertiary">
              <div v-if="playerStore.currentIndex === index" class="w-3 h-3 bg-primary rounded-full animate-pulse"></div>
              <template v-else>
                <span class="group-hover:hidden">{{ index + 1 }}</span>
                <Play class="w-3 h-3 hidden group-hover:block text-text-primary fill-current" />
              </template>
            </div>

            <!-- Info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 min-w-0">
                <span class="text-sm font-medium truncate" :class="playerStore.currentIndex === index ? 'text-primary' : 'text-text-primary'">
                  {{ song.title }}
                </span>
                <Cloud
                  v-if="isStrmSong(song)"
                  class="w-3 h-3 flex-shrink-0 text-sky-400"
                  :title="t('player.strm_badge')"
                />
              </div>
              <div class="text-xs text-text-secondary truncate">
                {{ song.artist || t('common.unknown_artist') }}
              </div>
            </div>

            <!-- Duration -->
            <div class="text-xs text-text-tertiary font-mono">
              {{ formatDuration(song.duration_secs) }}
            </div>
            
            <!-- Remove -->
            <button 
              @click="(e) => removeSong(e, index)"
              class="p-1.5 text-text-tertiary hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
              :title="t('common.remove')"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="playerStore.queue.length === 0" class="flex flex-col items-center justify-center py-12 text-text-tertiary">
          <Music2 class="w-12 h-12 mb-3 opacity-20" />
          <p class="text-sm">{{ t('player.queue_empty') }}</p>
        </div>
      </div>
    </div>
  </transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}

@media (min-width: 768px) {
  .slide-up-enter-from,
  .slide-up-leave-to {
    transform: translateY(20px);
    opacity: 0;
  }
  
  .slide-up-enter-active,
  .slide-up-leave-active {
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
}
</style>
