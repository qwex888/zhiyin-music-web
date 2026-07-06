<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle, Volume2, Music2, ListMusic, List, Maximize2, Cloud, Loader2 } from 'lucide-vue-next';
import { isStrmSong } from '@/types';
import { hasCachedAudioAnyQuality } from '@/offline/media-cache';
import CoverImage from '@/components/common/CoverImage.vue';
import { useI18n } from 'vue-i18n';
import PlaylistModal from '@/components/common/PlaylistModal.vue';
import FullScreenPlayer from '@/components/layout/FullScreenPlayer.vue';

const playerStore = usePlayerStore();
const { t } = useI18n();
const showPlaylist = ref(false);
const showFullScreen = ref(false);
const isCurrentCached = ref(false);

const checkCached = async () => {
  if (!playerStore.currentSong) { isCurrentCached.value = false; return; }
  isCurrentCached.value = await hasCachedAudioAnyQuality(playerStore.currentSong.id);
};
watch(() => playerStore.currentSong?.id, checkCached, { immediate: true });

// 格式化时间函数
// const formatTime = (seconds: number) => {
//   const mins = Math.floor(seconds / 60);
//   const secs = Math.floor(seconds % 60);
//   return `${mins}:${secs.toString().padStart(2, '0')}`;
// };

// 计算进度百分比
const prevProgressPercent = ref(0);
const progressPercent = computed(() => {
  if (!playerStore.duration) return 0;
  return (playerStore.progress / playerStore.duration) * 100;
});

// 检测进度是否需要过渡效果（切换歌曲时禁用过渡）
const shouldTransition = computed(() => {
  const current = progressPercent.value;
  const prev = prevProgressPercent.value;
  
  // 如果进度从大于5%跳到小于5%，说明是切换歌曲，不使用过渡
  if (prev > 5 && current < 5) {
    return false;
  }
  
  return true;
});

// 监听进度变化，更新上一次的值
watch(progressPercent, (newVal) => {
  prevProgressPercent.value = newVal;
});

// 处理进度条拖拽
const handleSeek = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const val = Number(target.value);
  playerStore.seek((val / 100) * playerStore.duration);
};

// 获取模式标题
const getModeTitle = (mode: string) => {
  return t(`player.mode.${mode}`);
};

// 切换播放模式
const togglePlayMode = () => {
  const modes: Array<'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle'> = ['sequence', 'repeat-all', 'repeat-one', 'shuffle'];
  const currentIndex = modes.indexOf(playerStore.playMode);
  const nextIndex = (currentIndex + 1) % modes.length;
  playerStore.playMode = modes[nextIndex];
};

// 获取当前播放模式的图标组件
const getCurrentModeIcon = computed(() => {
  switch (playerStore.playMode) {
    case 'repeat-all':
      return Repeat;
    case 'repeat-one':
      return Repeat1;
    case 'shuffle':
      return Shuffle;
    default: // sequence
      return List;
  }
});

// 获取当前播放模式的颜色
const getCurrentModeClass = computed(() => {
  if (playerStore.playMode === 'sequence') {
    return 'text-text-secondary hover:text-text-primary';
  }
  return 'text-accent';
});

const qualityOptions: Array<'low' | 'medium' | 'high' | 'lossless' | 'original'> = ['low', 'medium', 'high', 'lossless', 'original'];
const qualityShortLabels: Record<string, string> = { low: '128k', medium: '192k', high: '320k', lossless: 'FLAC', original: 'ORI' };

const isCurrentStrm = computed(() => isStrmSong(playerStore.currentSong));

const toggleQuality = () => {
  if (isCurrentStrm.value) return;
  const idx = qualityOptions.indexOf(playerStore.quality);
  playerStore.quality = qualityOptions[(idx + 1) % qualityOptions.length];
};
</script>

<template>
  <div class="h-16 md:h-20 glass flex items-center px-4 justify-between z-50 fixed bottom-0 w-full left-0 right-0 border-t border-border">
    <!-- 进度条 (移动端置顶) -->
    <div class="absolute top-0 left-0 right-0 h-0.5 md:hidden bg-bg-elevate group cursor-pointer">
       <div 
         class="absolute inset-0 bg-primary-gradient" 
         :class="{ 'transition-all duration-100': shouldTransition }"
         :style="{ width: `${progressPercent}%` }"
       ></div>
       <input 
         type="range" 
         min="0" 
         max="100" 
         :value="progressPercent"
         @input="handleSeek"
         class="absolute -top-2 -bottom-2 w-full opacity-0 cursor-pointer"
       />
    </div>

     <!-- 歌曲信息 -->
     <div 
       class="flex items-center flex-1 min-w-0 gap-3 md:gap-4 md:w-1/3 cursor-pointer group/info"
       @click="showFullScreen = true"
     >
       <div class="w-10 h-10 md:w-14 md:h-14 bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 rounded md:rounded-md overflow-hidden shadow-sm border border-border group relative flex-shrink-0">
        <CoverImage
          v-if="playerStore.currentSong"
          :cover-id="playerStore.currentSong.cover_id"
          size="small"
          :alt="t('player.playing')"
        />
        <div v-else class="w-full h-full flex items-center justify-center text-text-tertiary bg-bg-surface">
          <Music2 class="w-5 h-5 md:w-8 md:h-8" />
        </div>
         <div v-if="playerStore.currentSong" class="absolute inset-0 bg-black/20 opacity-0 group-hover/info:opacity-100 transition-opacity hidden md:flex items-center justify-center">
            <Maximize2 class="w-6 h-6 text-white" />
         </div>
       </div>
       <div v-if="playerStore.currentSong" class="overflow-hidden flex-1">
         <div class="flex items-center gap-2 min-w-0">
           <span class="text-sm font-medium text-text-primary truncate">{{ playerStore.currentSong.title }}</span>
           <Cloud
             v-if="isStrmSong(playerStore.currentSong)"
             class="w-4 h-4 flex-shrink-0 text-sky-400"
             :title="t('player.strm_badge')"
           />
         </div>
         <div class="text-xs text-text-secondary truncate">{{ playerStore.currentSong.artist }}</div>
       </div>
     </div>

    <!-- 播放控制 -->
    <div class="flex items-center gap-3 md:gap-6 md:w-1/3 md:justify-center">
      <!-- 上一首 (桌面端) -->
      <button @click="playerStore.prev" class="hidden md:block text-text-primary hover:text-primary transition-colors" :title="t('player.prev')">
        <SkipBack class="w-5 h-5" />
      </button>

      <!-- 播放/暂停 -->
      <button 
        @click="playerStore.togglePlay" 
        class="w-9 h-9 md:w-10 md:h-10 rounded-full bg-primary-gradient hover:scale-105 text-white flex items-center justify-center transition-all shadow-lg shadow-primary/20 flex-shrink-0"
        :class="{ 'opacity-75 cursor-not-allowed hover:!scale-100': playerStore.isBuffering }"
        :disabled="playerStore.isBuffering"
        :title="playerStore.isBuffering ? t('player.buffering') : (playerStore.isPlaying ? t('player.paused') : t('player.playing'))"
      >
        <Loader2 v-if="playerStore.isBuffering" class="w-4 h-4 md:w-5 md:h-5 animate-spin" />
        <Pause v-else-if="playerStore.isPlaying" class="w-4 h-4 md:w-5 md:h-5 fill-current" />
        <Play v-else class="w-4 h-4 md:w-5 md:h-5 fill-current ml-0.5" />
      </button>

      <!-- 下一首 -->
      <button @click="playerStore.next" class="text-text-primary hover:text-primary transition-colors" :title="t('player.next')">
        <SkipForward class="w-5 h-5" />
      </button>

      <!-- 播放列表按钮 (移动端) -->
      <button 
        @click.stop="showPlaylist = !showPlaylist" 
        class="md:hidden text-text-secondary hover:text-text-primary transition-colors p-1"
        :class="{ 'text-primary': showPlaylist }"
        :title="t('player.queue')"
      >
        <ListMusic class="w-5 h-5" />
      </button>
    </div>
    <!-- 桌面端进度条 (位于底部) -->
    <div class="absolute top-0 left-0 right-0 h-1 bg-transparent group cursor-pointer hidden md:block">
        <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-bg-elevate group-hover:h-1 transition-all">
           <div 
             class="h-full bg-primary-gradient relative" 
             :class="{ 'transition-all duration-100': shouldTransition }"
             :style="{ width: `${progressPercent}%` }"
           >
             <div 
               class="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
               :class="{ 'transition-all duration-100': shouldTransition }"
             ></div>
           </div>
        </div>
        <input 
           type="range" 
           min="0" 
           max="100" 
           :value="progressPercent"
           @input="handleSeek"
           class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
    </div>
    <!-- 桌面端控制 (进度条/音量/模式) -->
    <div class="hidden md:flex items-center justify-end w-1/3 gap-4">
       <!-- 播放模式切换按钮 -->
       <button 
          @click="togglePlayMode"
          :class="getCurrentModeClass"
          :title="getModeTitle(playerStore.playMode)"
          class="transition-colors"
        >
          <component :is="getCurrentModeIcon" class="w-5 h-5" />
        </button>

        <!-- 音质切换按钮 -->
        <button
          @click="toggleQuality"
          :title="isCurrentStrm ? t('player.strm_quality_locked') : t(`player.quality_${playerStore.quality}`)"
          class="text-[10px] font-bold font-mono leading-none px-1.5 py-1 rounded border transition-colors"
          :class="isCurrentStrm
            ? 'text-text-tertiary border-border/50 cursor-not-allowed opacity-60'
            : 'text-text-secondary border-border hover:text-primary hover:border-primary/40'"
        >
          {{ isCurrentStrm ? 'ORI' : qualityShortLabels[playerStore.quality] }}
        </button>

        <!-- 播放列表按钮 -->
        <button 
          @click.stop="showPlaylist = !showPlaylist" 
          class="text-text-secondary hover:text-text-primary transition-colors p-1"
          :class="{ 'text-primary': showPlaylist }"
          :title="t('player.queue')"
        >
          <ListMusic class="w-5 h-5" />
        </button>
        
        <!-- 音量 -->
        <div class="flex items-center gap-2 group" :title="t('player.volume')">
           <Volume2 class="w-5 h-5 text-text-secondary" />
           <input 
             type="range" 
             min="0" 
             max="1" 
             step="0.01"
             :value="playerStore.volume"
             @input="(e) => playerStore.setVolume(Number((e.target as HTMLInputElement).value))"
             class="w-20 h-1 bg-bg-elevate rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text-primary hover:[&::-webkit-slider-thumb]:bg-accent transition-all"
           />
        </div>
    </div>

    <PlaylistModal v-model="showPlaylist" />
    <FullScreenPlayer v-model="showFullScreen" @open-playlist="showPlaylist = true" />
  </div>
</template>
