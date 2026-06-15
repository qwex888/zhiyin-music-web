<script setup lang="ts">
import { ref, computed, onUnmounted, watch, nextTick } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useI18n } from 'vue-i18n';
import { Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle, ChevronDown, Music2, ListMusic, Volume2, Mic2, List, Cloud } from 'lucide-vue-next';
import { isStrmSong } from '@/types';
import { musicApi } from '@/api/music';
import CoverImage from '@/components/common/CoverImage.vue';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'open-playlist'): void;
}>();

const playerStore = usePlayerStore();
const { t } = useI18n();

// Watch for visibility changes to lock body scroll
watch(() => props.modelValue, (val) => {
  if (val) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
});

// Cleanup scroll lock on unmount
onUnmounted(() => {
  document.body.style.overflow = '';
});

// Close handler
const close = () => {
  emit('update:modelValue', false);
};

// Drag to close logic
const touchStartY = ref(0);
const touchCurrentY = ref(0);
const isDragging = ref(false);

const handleTouchStart = (e: TouchEvent) => {
  touchStartY.value = e.touches[0].clientY;
  isDragging.value = true;
};

const handleTouchMove = (e: TouchEvent) => {
  if (!isDragging.value) return;
  const currentY = e.touches[0].clientY;
  if (currentY > touchStartY.value) {
    touchCurrentY.value = currentY - touchStartY.value;
  }
};

const handleTouchEnd = () => {
  isDragging.value = false;
  if (touchCurrentY.value > 150) {
    close();
  }
  touchCurrentY.value = 0;
};

// Styles for dragging effect
const containerStyle = computed(() => {
  if (!isDragging.value && touchCurrentY.value === 0) return {};
  return {
    transform: `translateY(${touchCurrentY.value}px)`,
    transition: isDragging.value ? 'none' : 'transform 0.3s ease',
  };
});

const formatTime = (seconds: number | null | undefined) => {
  if (seconds == null) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Progress handling
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

const handleSeek = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const val = Number(target.value);
  playerStore.seek((val / 100) * playerStore.duration);
};

const qualityShortLabels: Record<string, string> = { low: '128k', medium: '192k', high: '320k', lossless: 'FLAC', original: 'ORI' };

const isCurrentStrm = computed(() => isStrmSong(playerStore.currentSong));

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

// Lyrics Logic
const lyrics = ref<{ time: number; text: string; trans?: string }[]>([]);
const showLyrics = ref(false);
const hasLyrics = ref(false);
const lyricsContainerRef = ref<HTMLElement | null>(null);

const parseLyrics = (lrc: string) => {
  return lrc.split('\n').map(line => {
    const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const msStr = match[3] || '0';
      const ms = parseInt(msStr);
      const time = min * 60 + sec + ms / (msStr.length === 3 ? 1000 : 100);
      return { time, text: match[4].trim() };
    }
    return null;
  }).filter((item): item is { time: number; text: string } => item !== null && !!item.text);
};

// 解析翻译歌词，返回歌词数组
const parseTransLyrics = (transLrc: string) => {
  return transLrc.split('\n').map(line => {
    const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const msStr = match[3] || '0';
      const ms = parseInt(msStr);
      const time = min * 60 + sec + ms / (msStr.length === 3 ? 1000 : 100);
      return { time, text: match[4].trim() };
    }
    return null;
  }).filter((item): item is { time: number; text: string } => item !== null && !!item.text);
};

// 为原文歌词找到最接近的翻译
const findClosestTranslation = (originalTime: number, transLyrics: { time: number; text: string }[]): string | undefined => {
  if (transLyrics.length === 0) return undefined;
  
  // 找到时间最接近的翻译（允许最多 2 秒的误差）
  let closestTrans: { time: number; text: string } | null = null;
  let minDiff = Infinity;
  
  for (const trans of transLyrics) {
    const diff = Math.abs(trans.time - originalTime);
    if (diff < minDiff && diff <= 2) { // 最大允许 2 秒误差
      minDiff = diff;
      closestTrans = trans;
    }
  }
  
  return closestTrans?.text;
};

const checkLyricsAvailability = async () => {
  hasLyrics.value = false;
  if (!playerStore.currentSong) return;
  try {
    const { data } = await musicApi.checkLyrics(playerStore.currentSong.id);
    hasLyrics.value = data.has_lyrics;
  } catch (e) {
    hasLyrics.value = false;
  }
};

const fetchLyrics = async () => {
  lyrics.value = [];
  if (!playerStore.currentSong) return;
  
  // If we already know there are no lyrics, don't fetch
  if (!hasLyrics.value) return;

  try {
    const { data } = await musicApi.getLyrics(playerStore.currentSong.id);
    if (data.has_lyrics && data.lyrics) {
      // 尝试检测双语歌词：通过时间戳倒退来判断
      const lines = data.lyrics.split('\n');
      let splitIndex = -1;
      let prevTime = -1;
      
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/);
        if (match) {
          const min = parseInt(match[1]);
          const sec = parseInt(match[2]);
          const msStr = match[3] || '0';
          const ms = parseInt(msStr);
          const currentTime = min * 60 + sec + ms / (msStr.length === 3 ? 1000 : 100);
          
          // 如果时间戳倒退超过30秒，认为是第二部分开始
          if (prevTime > 0 && currentTime < prevTime - 30) {
            splitIndex = i;
            break;
          }
          prevTime = currentTime;
        }
      }
      
      if (splitIndex > 0) {
        const part1 = lines.slice(0, splitIndex).join('\n');
        const part2 = lines.slice(splitIndex).join('\n');

        const originalLyrics = parseLyrics(part1);
        const transLyrics = parseTransLyrics(part2);

        lyrics.value = originalLyrics.map(lyric => {
          const trans = findClosestTranslation(lyric.time, transLyrics);
          return trans ? { ...lyric, trans } : lyric;
        });
      } else {
        lyrics.value = parseLyrics(data.lyrics);
      }
    }
  } catch {
    // 歌词加载失败，静默处理
  }
};

const currentLyricIndex = computed(() => {
  const t = playerStore.progress;
  // Find the last lyric that has time <= current time
  for (let i = lyrics.value.length - 1; i >= 0; i--) {
    if (lyrics.value[i].time <= t + 0.2) { 
      return i;
    }
  }
  return -1;
});

watch(() => playerStore.currentSong?.id, async () => {
  const wasShowingLyrics = showLyrics.value;
  lyrics.value = [];

  await checkLyricsAvailability();

  if (wasShowingLyrics && playerStore.currentSong && hasLyrics.value) {
    showLyrics.value = true;
    fetchLyrics();
  } else {
    showLyrics.value = false;
  }
});

watch(() => props.modelValue, (val) => {
  if (val) {
    // If opening player and lyrics not loaded but available, load them
    if (lyrics.value.length === 0 && hasLyrics.value) {
      fetchLyrics();
    } else if (lyrics.value.length === 0) {
      // Re-check just in case
      checkLyricsAvailability();
    }
  }
});

watch(currentLyricIndex, (newIndex) => {
  if (showLyrics.value && lyricsContainerRef.value && newIndex >= 0) {
    scrollToCurrentLyric();
  }
});

const scrollToCurrentLyric = () => {
  nextTick(() => {
    const container = lyricsContainerRef.value;
    if (!container) return;
    const activeEl = container.querySelector('.active-lyric') as HTMLElement | null;
    if (!activeEl) return;

    // 手动计算滚动位置，避免 scrollIntoView 连带滚动祖先容器导致整体上移
    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const scrollTarget = container.scrollTop
      + (activeRect.top - containerRect.top)
      - (containerRect.height / 2)
      + (activeRect.height / 2);

    container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
  });
};

const toggleLyrics = () => {
  if (!showLyrics.value && lyrics.value.length === 0 && hasLyrics.value) {
    fetchLyrics();
  }
  showLyrics.value = !showLyrics.value;
  if (showLyrics.value) {
    scrollToCurrentLyric();
  }
};

const seekToLyric = (time: number) => {
  playerStore.seek(time);
};
</script>

<template>
  <Teleport to="body">
    <transition name="slide-up">
      <div 
        v-if="modelValue"
        class="fixed inset-0 z-[100] bg-bg-main flex flex-col overflow-hidden touch-none h-screen supports-[height:100dvh]:h-[100dvh]"
        :style="containerStyle"
        @click.stop
      >
      <!-- Background Blur -->
      <div class="absolute inset-0 z-[-1] opacity-30 blur-3xl scale-150 pointer-events-none" v-if="playerStore.currentSong?.cover_id">
         <CoverImage
           :cover-id="playerStore.currentSong.cover_id"
           size="medium"
         />
      </div>
      <div class="absolute inset-0 z-[-1] bg-bg-main/80 backdrop-blur-3xl"></div>

      <!-- Header (Mobile Drag Handle) -->
      <div 
        class="h-12 flex items-center justify-center relative flex-shrink-0 cursor-grab active:cursor-grabbing md:cursor-default"
        @touchstart="handleTouchStart"
        @touchmove="handleTouchMove"
        @touchend="handleTouchEnd"
      >
        <button 
          @click="close"
          class="absolute left-4 p-2 text-text-secondary hover:text-text-primary transition-colors rounded-full hover:bg-bg-elevate"
          :title="t('player.close_player')"
        >
          <ChevronDown class="w-6 h-6" />
        </button>
        <div class="w-12 h-1 bg-text-tertiary/20 rounded-full md:hidden"></div>
        
      </div>

      <!-- Content -->
      <div class="flex-1 flex flex-col md:flex-row items-center justify-center p-4 md:p-6 pb-safe gap-4 md:gap-16 max-w-7xl mx-auto w-full overflow-hidden">
        <!-- Cover Art / Lyrics Container -->
        <div class="w-full max-w-sm md:max-w-md flex-1 md:aspect-square relative group min-h-0">
          
          <!-- Cover Art -->
          <div v-show="!showLyrics" class="w-full h-full relative flex items-center justify-center">
            <div class="w-full aspect-square max-h-full relative">
              <div class="w-full h-full rounded-2xl md:rounded-3xl overflow-hidden shadow-2xl border border-border/10 bg-bg-elevate relative z-10" 
                   :class="{ 'cursor-pointer': hasLyrics }"
                   @click="hasLyrics && toggleLyrics()">
                <CoverImage
                  :cover-id="playerStore.currentSong?.cover_id"
                  size="medium"
                  :alt="playerStore.currentSong?.title || ''"
                >
                  <template #fallback>
                    <div class="w-full h-full flex items-center justify-center text-text-tertiary">
                      <Music2 class="w-24 h-24 opacity-50" />
                    </div>
                  </template>
                </CoverImage>
                
                <!-- Hover Overlay -->
                 <div v-if="hasLyrics" class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                    <span class="text-white/90 font-medium px-4 py-2 bg-black/40 rounded-full backdrop-blur-sm flex items-center gap-2">
                      <Mic2 class="w-4 h-4" />
                      {{ t('player.show_lyrics') }}
                    </span>
                 </div>
              </div>
              <!-- Reflection/Glow -->
              <div class="absolute -inset-4 bg-primary/20 blur-2xl rounded-full -z-10 opacity-50 group-hover:opacity-75 transition-opacity duration-500"></div>
            </div>
          </div>

          <!-- Lyrics View -->
          <div v-show="showLyrics" class="w-full h-full relative z-10 flex flex-col rounded-2xl md:rounded-3xl bg-bg-elevate/30 backdrop-blur-sm border border-white/5 overflow-hidden">
             <div 
               ref="lyricsContainerRef"
               class="flex-1 overflow-y-auto scrollbar-hide text-center space-y-5 md:space-y-8 px-4 py-[20%] md:py-[50%]"
               style="mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent); -webkit-mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent);"
             >
                <div v-if="lyrics.length === 0" class="h-full flex items-center justify-center text-text-secondary/50 italic">
                   {{ t('player.no_lyrics') }}
                </div>
                <div 
                  v-for="(line, index) in lyrics" 
                  :key="index"
                  class="transition-all duration-500 cursor-pointer select-none space-y-0.5 md:space-y-1"
                  :class="index === currentLyricIndex ? 'scale-105 active-lyric' : 'scale-100'"
                  @click.stop="seekToLyric(line.time)"
                >
                  <p 
                    class="text-base md:text-2xl font-medium transition-all duration-500 leading-relaxed"
                    :class="index === currentLyricIndex ? 'text-primary drop-shadow-md' : 'text-text-secondary/40 hover:text-text-secondary/80'"
                  >
                    {{ line.text }}
                  </p>
                  <p 
                    v-if="line.trans"
                    class="text-xs md:text-base font-normal transition-all duration-500 leading-relaxed"
                    :class="index === currentLyricIndex ? 'text-primary/80' : 'text-text-secondary/30 hover:text-text-secondary/60'"
                  >
                    {{ line.trans }}
                  </p>
                </div>
             </div>
          </div>
        </div>

        <!-- Controls Section -->
        <div class="w-full max-w-md flex flex-col gap-4 md:gap-10 flex-shrink-0">
          <!-- Song Info -->
          <div class="text-center md:text-left space-y-1 md:space-y-2">
            <div class="flex items-center justify-center md:justify-start gap-2 md:gap-3">
              <h2 class="text-xl md:text-4xl font-bold text-text-primary line-clamp-2">
                {{ playerStore.currentSong?.title || t('player.playing') }}
              </h2>
              <!-- STRM Badge -->
              <Cloud
                v-if="isStrmSong(playerStore.currentSong)"
                class="w-6 h-6 flex-shrink-0 text-sky-400"
                :title="t('player.strm_badge')"
              />
              <!-- Quality Badge -->
              <span
                class="px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider border"
                :class="isCurrentStrm ? 'border-border/50 text-text-tertiary' : 'border-border text-text-secondary'"
                :title="isCurrentStrm ? t('player.strm_quality_locked') : t(`player.quality_${playerStore.quality}`)"
              >
                {{ isCurrentStrm ? 'ORI' : qualityShortLabels[playerStore.quality] }}
              </span>
              <!-- Lyrics Badge -->
              <button 
                @click="hasLyrics && toggleLyrics()"
                class="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border transition-all"
                :class="[
                  hasLyrics 
                    ? (showLyrics ? 'bg-primary text-white border-primary' : 'bg-transparent text-primary border-primary hover:bg-primary/10 cursor-pointer') 
                    : 'bg-transparent text-text-secondary border-text-secondary cursor-default opacity-70'
                ]"
                :title="hasLyrics ? t('player.lyrics_available') : t('player.no_lyrics')"
              >
                {{ hasLyrics ? t('player.has_lyrics') : t('player.no_lyrics') }}
              </button>
            </div>
            <p class="text-base md:text-xl text-text-secondary font-medium">
              {{ playerStore.currentSong?.artist || t('common.unknown_artist') }}
            </p>
          </div>

          <!-- Progress Bar -->
          <div class="space-y-2 group">
            <div class="relative h-2 bg-bg-elevate rounded-full cursor-pointer">
              <!-- Track -->
              <div class="absolute inset-0 bg-text-primary/10 rounded-full"></div>
              <!-- Fill -->
              <div 
                class="absolute top-0 left-0 h-full bg-primary-gradient rounded-full"
                :class="{ 'transition-all duration-100': shouldTransition }"
                :style="{ width: `${progressPercent}%` }"
              ></div>
              <!-- Handle -->
              <div 
                class="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                :class="{ 'transition-all duration-100': shouldTransition }"
                :style="{ left: `${progressPercent}%` }"
              ></div>
              <!-- Input -->
              <input 
                type="range" 
                min="0" 
                max="100" 
                :value="progressPercent"
                @input="handleSeek"
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <div class="flex justify-between text-xs md:text-sm text-text-tertiary font-mono">
              <span>{{ formatTime(playerStore.progress) }}</span>
              <span>{{ formatTime(playerStore.duration) }}</span>
            </div>
          </div>

          <!-- Main Controls -->
          <div class="flex items-center justify-between">
            <!-- 播放模式切换按钮 -->
            <button 
              @click="togglePlayMode"
              :class="getCurrentModeClass"
              :title="getModeTitle(playerStore.playMode)"
              class="p-2 transition-colors"
            >
              <component :is="getCurrentModeIcon" class="w-6 h-6" />
            </button>
            
            <button 
              @click="playerStore.prev" 
              class="p-2 text-text-primary hover:text-primary transition-colors"
              :title="t('player.prev')"
            >
              <SkipBack class="w-8 h-8 md:w-10 md:h-10 fill-current" />
            </button>

            <button 
              @click="playerStore.togglePlay" 
              class="w-16 h-16 md:w-20 md:h-20 rounded-full bg-primary-gradient hover:scale-105 text-white flex items-center justify-center transition-all shadow-xl shadow-primary/20"
              :title="playerStore.isPlaying ? t('player.paused') : t('player.playing')"
            >
              <Pause v-if="playerStore.isPlaying" class="w-8 h-8 md:w-10 md:h-10 fill-current" />
              <Play v-else class="w-8 h-8 md:w-10 md:h-10 fill-current ml-1" />
            </button>

            <button 
              @click="playerStore.next" 
              class="p-2 text-text-primary hover:text-primary transition-colors"
              :title="t('player.next')"
            >
              <SkipForward class="w-8 h-8 md:w-10 md:h-10 fill-current" />
            </button>

            <!-- 播放队列按钮 -->
            <button 
              @click="$emit('open-playlist')"
              class="p-2 text-text-secondary hover:text-text-primary transition-colors"
              :title="t('player.queue')"
            >
              <ListMusic class="w-6 h-6" />
            </button>
          </div>

          <!-- Volume Control (PC Only) -->
          <div class="hidden md:flex items-center gap-4 px-4 py-2 bg-bg-elevate/50 rounded-xl w-64 mx-auto">
             <Volume2 class="w-5 h-5 text-text-secondary" />
             <input 
               type="range" 
               min="0" 
               max="1" 
               step="0.01"
               :value="playerStore.volume"
               @input="(e) => playerStore.setVolume(Number((e.target as HTMLInputElement).value))"
               class="flex-1 h-1 bg-bg-elevate rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text-primary hover:[&::-webkit-slider-thumb]:bg-accent transition-all"
             />
          </div>
        </div>
        <div class="h-20px"></div>
      </div>
    </div>
  </transition>
  </Teleport>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}

.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 20px);
}

.scrollbar-hide::-webkit-scrollbar {
    display: none;
}
.scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
</style>
