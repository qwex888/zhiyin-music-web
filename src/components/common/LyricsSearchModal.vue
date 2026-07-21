<script setup lang="ts">
import { ref, watch, computed, nextTick, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search, X, Check, Loader2, Music2, ChevronLeft, ChevronRight, Clock, AlertCircle } from 'lucide-vue-next';
import { musicApi } from '@/api/music';
import { useToast } from '@/composables/useToast';
import { songEvents } from '@/utils/songEvents';
import { usePlayerStore } from '@/stores/player';
import { useScrapeSources } from '@/composables/useScrapeSources';

const props = defineProps<{
  modelValue: boolean;
  songId: number;
  songTitle?: string;
  songArtist?: string;
  songAlbum?: string;
  songDuration?: number | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

const { t } = useI18n();
const toast = useToast();
const playerStore = usePlayerStore();
const { getSourceLabel, getSourceColorClass, getSourceBadgeStyle, ensureLoaded } = useScrapeSources();

const title = ref('');
const artist = ref('');
const album = ref('');
const isSearching = ref(false);
const isReplacing = ref(false);
const currentIndex = ref(0);
const songDurationSecs = ref<number | null>(null);

const touchStartX = ref(0);
const touchDeltaX = ref(0);
const isDragging = ref(false);
const carouselRef = ref<HTMLElement | null>(null);

interface LyricsResult {
  source: string;
  song_id: string;
  title: string;
  artist: string | null;
  duration_secs: number | null;
  lyrics_preview: string | null;
  lyrics_full: string | null;
}

interface LrcLine {
  time: number;
  text: string;
  trans?: string;
}

const results = ref<LyricsResult[]>([]);

const parseTimeTag = (line: string): { time: number; text: string } | null => {
  const match = line.match(/^\[(\d{2}):(\d{2})(?:[.:：](\d{2,3}))?\](.*)/);
  if (!match) return null;
  const min = parseInt(match[1]);
  const sec = parseInt(match[2]);
  const msStr = match[3] || '0';
  const ms = parseInt(msStr);
  const time = min * 60 + sec + ms / (msStr.length === 3 ? 1000 : 100);
  const text = match[4].trim();
  return text ? { time, text } : null;
};

const parseLrc = (lrc: string | null): LrcLine[] => {
  if (!lrc) return [];

  const rawLines = lrc.split(/\r?\n/);
  const parsed: { time: number; text: string }[] = [];
  for (const line of rawLines) {
    const p = parseTimeTag(line);
    if (p) parsed.push(p);
  }
  if (parsed.length < 2) return parsed;

  // 检测同时间戳交替双语格式
  let dupCount = 0;
  for (let i = 1; i < parsed.length; i++) {
    if (Math.abs(parsed[i].time - parsed[i - 1].time) < 0.05 && parsed[i].text !== parsed[i - 1].text) {
      dupCount++;
    }
  }

  if (dupCount >= parsed.length * 0.15) {
    const result: LrcLine[] = [];
    let i = 0;
    while (i < parsed.length) {
      const current = parsed[i];
      if (i + 1 < parsed.length && Math.abs(parsed[i + 1].time - current.time) < 0.05 && parsed[i + 1].text !== current.text) {
        result.push({ time: current.time, text: current.text, trans: parsed[i + 1].text });
        i += 2;
      } else {
        result.push({ time: current.time, text: current.text });
        i++;
      }
    }
    return result;
  }

  return parsed;
};

// 使用 computed 确保响应式正确，避免在 render 期间修改状态
const allParsedLyrics = computed(() =>
  results.value.map(r => parseLrc(r.lyrics_full))
);

const getParsedLyrics = (index: number): LrcLine[] => {
  return allParsedLyrics.value[index] || [];
};

// 查找当前时间对应的高亮行
const findActiveLineIndex = (lines: LrcLine[], currentTime: number): number => {
  if (lines.length === 0) return -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].time <= currentTime) return i;
  }
  return -1;
};

// 当前可见 slide 的高亮行索引（响应式计算）
const activeLineIndex = computed(() => {
  const lines = getParsedLyrics(currentIndex.value);
  return findActiveLineIndex(lines, playerStore.progress);
});

const formatTimeTag = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// 自动滚动：保持高亮行始终居中
const slideRefs = ref<(HTMLElement | null)[]>([]);
const lyricsPaddingHeight = ref(150);

const setSlideRef = (el: any, index: number) => {
  slideRefs.value[index] = el as HTMLElement | null;
};

const getCarouselHeight = (): number => {
  return carouselRef.value?.clientHeight || 300;
};

let scrollRafId: number | null = null;
let userScrollTimer: ReturnType<typeof setTimeout> | null = null;
let isUserScrolling = false;
let isProgrammaticScroll = false;

const scrollToActiveLine = (slideIndex: number, lineIndex: number, immediate = false) => {
  if (scrollRafId) cancelAnimationFrame(scrollRafId);
  scrollRafId = requestAnimationFrame(() => {
    const container = slideRefs.value[slideIndex];
    if (!container || lineIndex < 0) return;
    const containerHeight = getCarouselHeight();
    lyricsPaddingHeight.value = Math.floor(containerHeight / 2);
    const lineEl = container.querySelector(`[data-line-index="${lineIndex}"]`) as HTMLElement | null;
    if (!lineEl) return;
    const targetScroll = lineEl.offsetTop - containerHeight / 2 + lineEl.offsetHeight / 2;
    isProgrammaticScroll = true;
    container.scrollTo({ top: Math.max(0, targetScroll), behavior: immediate ? 'instant' : 'smooth' });
    setTimeout(() => { isProgrammaticScroll = false; }, immediate ? 50 : 600);
  });
};

// 检测用户手动滚动，短暂暂停自动滚动以避免冲突
const onLyricsScroll = (index: number) => {
  if (index !== currentIndex.value) return;
  if (isProgrammaticScroll) return;
  isUserScrolling = true;
  if (userScrollTimer) clearTimeout(userScrollTimer);
  userScrollTimer = setTimeout(() => {
    isUserScrolling = false;
  }, 3000);
};

// activeLineIndex 变化时自动滚动（高亮行切换）
let lastScrolledLine = -1;
const stopActiveLineWatch = watch(
  activeLineIndex,
  (activeIdx) => {
    if (!props.modelValue || results.value.length === 0) return;
    if (activeIdx < 0) return;
    if (activeIdx !== lastScrolledLine) {
      lastScrolledLine = activeIdx;
      if (!isUserScrolling) {
        scrollToActiveLine(currentIndex.value, activeIdx);
      }
    }
  },
  { flush: 'post' }
);

onBeforeUnmount(() => {
  stopActiveLineWatch();
  if (scrollRafId) cancelAnimationFrame(scrollRafId);
  if (userScrollTimer) clearTimeout(userScrollTimer);
});

watch(() => props.modelValue, async (val) => {
  if (val) await ensureLoaded();
  if (val) {
    title.value = props.songTitle || '';
    artist.value = props.songArtist || '';
    album.value = props.songAlbum || '';
    results.value = [];
    currentIndex.value = 0;
    songDurationSecs.value = props.songDuration ?? null;
    lastScrolledLine = -1;
    isUserScrolling = false;
    if (userScrollTimer) clearTimeout(userScrollTimer);
  }
});

// 切换 slide 后定位到当前播放行
watch(currentIndex, () => {
  lastScrolledLine = -1;
  isUserScrolling = false;
  if (userScrollTimer) clearTimeout(userScrollTimer);
  nextTick(() => {
    nextTick(() => {
      if (activeLineIndex.value >= 0) {
        scrollToActiveLine(currentIndex.value, activeLineIndex.value, true);
      }
    });
  });
});

const close = () => emit('update:modelValue', false);

const canSearch = computed(() =>
  (title.value.trim() || artist.value.trim()) && !isSearching.value
);

const currentResult = computed(() => results.value[currentIndex.value] ?? null);

const formatDuration = (secs: number | null | undefined): string => {
  if (!secs || secs <= 0) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const durationDiff = computed(() => {
  const orig = songDurationSecs.value;
  const result = currentResult.value?.duration_secs;
  if (!orig || !result) return null;
  return Math.abs(orig - result);
});

const isDurationClose = computed(() => {
  const diff = durationDiff.value;
  if (diff === null) return null;
  return diff <= 5;
});

const handleSearch = async () => {
  if (!canSearch.value) return;
  isSearching.value = true;
  results.value = [];
  currentIndex.value = 0;
  lastScrolledLine = -1;
  isUserScrolling = false;
  if (userScrollTimer) clearTimeout(userScrollTimer);
  try {
    const { data } = await musicApi.searchLyrics(props.songId, {
      title: title.value.trim() || undefined,
      artist: artist.value.trim() || undefined,
      album: album.value.trim() || undefined,
    });
    results.value = data.results;
    if (data.song_duration_secs) {
      songDurationSecs.value = data.song_duration_secs;
    }
    if (data.results.length === 0) {
      toast.info(t('lyrics.no_results'));
    } else {
      // 双重 nextTick：第一次让 DOM 渲染，第二次确保布局计算（含动态 padding）完成
      nextTick(() => {
        nextTick(() => {
          scrollToActiveLine(0, activeLineIndex.value, true);
        });
      });
    }
  } catch {
    toast.error(t('common.error'));
  } finally {
    isSearching.value = false;
  }
};

const handleReplace = async () => {
  const result = currentResult.value;
  if (!result?.lyrics_full || isReplacing.value) return;
  isReplacing.value = true;
  try {
    await musicApi.replaceLyrics(props.songId, result.lyrics_full);
    toast.success(t('lyrics.replace_success'));
    songEvents.emitSongUpdated([props.songId]);
    songEvents.emitLyricsChanged(props.songId);
    close();
  } catch {
    toast.error(t('lyrics.replace_error'));
  } finally {
    isReplacing.value = false;
  }
};

const goTo = (index: number) => {
  if (index >= 0 && index < results.value.length) {
    currentIndex.value = index;
  }
};

const prev = () => goTo(currentIndex.value - 1);
const next = () => goTo(currentIndex.value + 1);

const onTouchStart = (e: TouchEvent) => {
  touchStartX.value = e.touches[0].clientX;
  touchDeltaX.value = 0;
  isDragging.value = true;
};

const onTouchMove = (e: TouchEvent) => {
  if (!isDragging.value) return;
  touchDeltaX.value = e.touches[0].clientX - touchStartX.value;
};

const onTouchEnd = () => {
  if (!isDragging.value) return;
  isDragging.value = false;
  if (touchDeltaX.value > 50) prev();
  else if (touchDeltaX.value < -50) next();
  touchDeltaX.value = 0;
};

// 鼠标拖动
const onMouseDown = (e: MouseEvent) => {
  touchStartX.value = e.clientX;
  touchDeltaX.value = 0;
  isDragging.value = true;
  e.preventDefault();
};

const onMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return;
  touchDeltaX.value = e.clientX - touchStartX.value;
};

const onMouseUp = () => {
  if (!isDragging.value) return;
  isDragging.value = false;
  if (touchDeltaX.value > 50) prev();
  else if (touchDeltaX.value < -50) next();
  touchDeltaX.value = 0;
};

const sourceLabel = (source: string) => getSourceLabel(source);

const sourceColor = (source: string) => getSourceColorClass(source);

const sourceBadgeStyle = (source: string) => getSourceBadgeStyle(source);
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div v-if="modelValue" class="fixed inset-0 z-[200] flex md:items-center md:justify-center" @click.self="close">
        <div class="hidden md:block absolute inset-0 bg-black/50 backdrop-blur-sm" @click="close"></div>

        <div class="relative w-full h-full md:w-[560px] md:h-[85vh] bg-bg-surface md:rounded-2xl md:border border-border shadow-2xl flex flex-col z-10 overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 md:px-5 md:py-4 border-b border-border flex-shrink-0">
            <div class="flex items-center gap-2">
              <Music2 class="w-5 h-5 text-primary" />
              <h3 class="text-base font-semibold text-text-primary">{{ t('lyrics.search_title') }}</h3>
            </div>
            <button @click="close" class="p-1.5 text-text-secondary hover:text-text-primary transition-colors rounded-lg hover:bg-bg-elevate">
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Search Form -->
          <div class="px-4 py-2.5 md:px-5 md:py-4 space-y-2 md:space-y-3 border-b border-border flex-shrink-0">
            <div class="grid grid-cols-3 gap-2 md:gap-3">
              <div>
                <label class="block text-xs text-text-secondary mb-1">{{ t('lyrics.title') }}</label>
                <input
                  v-model="title"
                  type="text"
                  class="w-full px-2.5 py-1.5 md:px-3 md:py-2 bg-bg-main border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  @keydown.enter="handleSearch"
                />
              </div>
              <div>
                <label class="block text-xs text-text-secondary mb-1">{{ t('lyrics.artist') }}</label>
                <input
                  v-model="artist"
                  type="text"
                  class="w-full px-2.5 py-1.5 md:px-3 md:py-2 bg-bg-main border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  @keydown.enter="handleSearch"
                />
              </div>
              <div>
                <label class="block text-xs text-text-secondary mb-1">{{ t('lyrics.album') }}</label>
                <input
                  v-model="album"
                  type="text"
                  class="w-full px-2.5 py-1.5 md:px-3 md:py-2 bg-bg-main border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  @keydown.enter="handleSearch"
                />
              </div>
            </div>
            <button
              @click="handleSearch"
              :disabled="!canSearch"
              class="w-full flex items-center justify-center gap-2 py-2 md:py-2.5 rounded-xl text-sm font-medium transition-all"
              :class="canSearch
                ? 'bg-primary-gradient text-white hover:brightness-110 shadow-lg shadow-primary/20'
                : 'bg-bg-elevate text-text-tertiary cursor-not-allowed'"
            >
              <Loader2 v-if="isSearching" class="w-4 h-4 animate-spin" />
              <Search v-else class="w-4 h-4" />
              {{ isSearching ? t('lyrics.searching') : t('lyrics.search') }}
            </button>
          </div>

          <!-- Carousel Results -->
          <div class="flex-1 flex flex-col min-h-0" v-if="results.length > 0">
            <!-- Result Info Bar -->
            <div class="flex items-center justify-between px-4 py-2 md:px-5 md:py-2.5 border-b border-border flex-shrink-0">
              <div class="flex items-center gap-3">
                <!-- Source Badge -->
                <span
                  v-if="currentResult"
                  class="text-xs px-2 py-1 rounded-md font-medium border"
                  :class="sourceBadgeStyle(currentResult.source) ? '' : sourceColor(currentResult.source)"
                  :style="sourceBadgeStyle(currentResult.source)"
                >
                  {{ sourceLabel(currentResult.source) }}
                </span>
                <!-- Song Info -->
                <div v-if="currentResult" class="min-w-0">
                  <div class="text-sm font-medium text-text-primary truncate">{{ currentResult.title }}</div>
                  <div v-if="currentResult.artist" class="text-xs text-text-secondary truncate">{{ currentResult.artist }}</div>
                </div>
              </div>
              <!-- Counter -->
              <span class="text-xs text-text-tertiary tabular-nums flex-shrink-0">
                {{ t('lyrics.result_count', { current: currentIndex + 1, total: results.length }) }}
              </span>
            </div>

            <!-- Duration Comparison -->
            <div v-if="currentResult" class="flex items-center gap-2 md:gap-3 px-4 py-1.5 md:px-5 md:py-2 border-b border-border flex-shrink-0 text-[11px] md:text-xs">
              <div class="flex items-center gap-1.5 text-xs">
                <Clock class="w-3.5 h-3.5 text-text-tertiary" />
                <span class="text-text-secondary">{{ t('lyrics.original_duration') }}:</span>
                <span class="text-text-primary font-medium tabular-nums">{{ formatDuration(songDurationSecs) }}</span>
              </div>
              <span class="text-text-tertiary">→</span>
              <div class="flex items-center gap-1.5 text-xs">
                <span class="text-text-secondary">{{ t('lyrics.result_duration') }}:</span>
                <span class="text-text-primary font-medium tabular-nums">{{ formatDuration(currentResult.duration_secs) }}</span>
              </div>
              <div v-if="isDurationClose !== null" class="flex items-center gap-1 ml-auto">
                <Check v-if="isDurationClose" class="w-3.5 h-3.5 text-emerald-500" />
                <AlertCircle v-else class="w-3.5 h-3.5 text-amber-500" />
                <span class="text-xs" :class="isDurationClose ? 'text-emerald-500' : 'text-amber-500'">
                  {{ isDurationClose ? t('lyrics.duration_match') : t('lyrics.duration_mismatch') }}
                </span>
              </div>
            </div>

            <!-- Swiper Lyrics Area -->
            <div
              ref="carouselRef"
              class="flex-1 relative overflow-hidden min-h-0 select-none"
              @touchstart="onTouchStart"
              @touchmove="onTouchMove"
              @touchend="onTouchEnd"
              @mousedown="onMouseDown"
              @mousemove="onMouseMove"
              @mouseup="onMouseUp"
              @mouseleave="onMouseUp"
            >
              <!-- Prev/Next Arrows (PC) -->
              <button
                v-if="currentIndex > 0"
                @click.stop="prev"
                class="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center rounded-full bg-bg-surface/90 border border-border shadow-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevate transition-all"
              >
                <ChevronLeft class="w-4 h-4" />
              </button>
              <button
                v-if="currentIndex < results.length - 1"
                @click.stop="next"
                class="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center rounded-full bg-bg-surface/90 border border-border shadow-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevate transition-all"
              >
                <ChevronRight class="w-4 h-4" />
              </button>

              <!-- Slides Container -->
              <div
                class="flex h-full transition-transform duration-300 ease-out"
                :class="{ '!transition-none': isDragging }"
                :style="{ transform: `translateX(calc(-${currentIndex * 100}% + ${isDragging ? touchDeltaX : 0}px))` }"
              >
                <div
                  v-for="(result, index) in results"
                  :key="`${result.source}-${result.song_id}`"
                  class="w-full flex-shrink-0 h-full overflow-y-auto px-5 md:px-12 py-3 lyrics-scroll-container"
                  :ref="(el) => setSlideRef(el, index)"
                  @scroll="onLyricsScroll(index)"
                >
                  <!-- 解析后的 LRC 歌词：带时间高亮 -->
                  <template v-if="getParsedLyrics(index).length > 0">
                    <!-- 顶部留白确保开头几行能滚动到中间 -->
                    <div :style="{ height: lyricsPaddingHeight + 'px' }"></div>
                    <div
                      v-for="(line, lineIdx) in getParsedLyrics(index)"
                      :key="lineIdx"
                      :data-line-index="lineIdx"
                      class="py-1.5 transition-all duration-300 flex items-start gap-2"
                      :class="{
                        'cursor-grabbing': isDragging,
                        'cursor-grab': !isDragging,
                      }"
                    >
                      <span
                        class="text-[10px] tabular-nums flex-shrink-0 w-10 text-right transition-colors duration-300 pt-0.5"
                        :class="index === currentIndex && activeLineIndex === lineIdx
                          ? 'text-primary/70'
                          : 'text-text-tertiary/40'"
                      >{{ formatTimeTag(line.time) }}</span>
                      <div class="flex-1 min-w-0">
                        <span
                          class="text-sm leading-relaxed transition-all duration-300"
                          :class="index === currentIndex && activeLineIndex === lineIdx
                            ? 'text-primary font-semibold scale-[1.02] origin-left'
                            : 'text-text-secondary/60'"
                        >{{ line.text }}</span>
                        <p
                          v-if="line.trans"
                          class="text-xs leading-relaxed transition-all duration-300 mt-0.5"
                          :class="index === currentIndex && activeLineIndex === lineIdx
                            ? 'text-primary/70'
                            : 'text-text-tertiary/40'"
                        >{{ line.trans }}</p>
                      </div>
                    </div>
                    <!-- 底部留白确保最后几行能滚动到中间 -->
                    <div :style="{ height: lyricsPaddingHeight + 'px' }"></div>
                  </template>
                  <!-- 降级：非 LRC 格式或解析失败 -->
                  <pre
                    v-else
                    class="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed font-mono"
                    :class="{ 'cursor-grabbing': isDragging, 'cursor-grab': !isDragging }"
                  >{{ result.lyrics_full || t('lyrics.no_results') }}</pre>
                </div>
              </div>

              <!-- Swipe Hint (mobile) -->
              <div v-if="results.length > 1" class="md:hidden absolute bottom-2 left-0 right-0 text-center">
                <span class="text-[10px] text-text-tertiary/60 bg-bg-surface/80 px-2 py-0.5 rounded-full">
                  {{ t('lyrics.swipe_hint') }}
                </span>
              </div>
            </div>

            <!-- Dots Indicator -->
            <div v-if="results.length > 1" class="flex items-center justify-center gap-1.5 py-2 border-t border-border flex-shrink-0">
              <button
                v-for="(_, index) in results"
                :key="index"
                @click="goTo(index)"
                class="w-2 h-2 rounded-full transition-all duration-200"
                :class="index === currentIndex
                  ? 'bg-primary w-5'
                  : 'bg-text-tertiary/30 hover:bg-text-tertiary/50'"
              />
            </div>

            <!-- Apply Button -->
            <div class="px-4 py-2.5 md:px-5 md:py-3 border-t border-border flex-shrink-0">
              <button
                @click="handleReplace"
                :disabled="!currentResult?.lyrics_full || isReplacing"
                class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
                :class="currentResult?.lyrics_full
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20'
                  : 'bg-bg-elevate text-text-tertiary cursor-not-allowed'"
              >
                <Loader2 v-if="isReplacing" class="w-4 h-4 animate-spin" />
                <Check v-else class="w-4 h-4" />
                {{ isReplacing ? t('lyrics.replacing') : t('lyrics.replace') }}
              </button>
            </div>
          </div>

          <!-- Empty State -->
          <div v-else class="flex-1 flex items-center justify-center py-12 text-text-tertiary text-sm">
            {{ isSearching ? '' : t('lyrics.no_results') }}
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

.lyrics-scroll-container {
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: var(--color-text-tertiary, #888) transparent;
}
.lyrics-scroll-container::-webkit-scrollbar {
  width: 4px;
}
.lyrics-scroll-container::-webkit-scrollbar-track {
  background: transparent;
}
.lyrics-scroll-container::-webkit-scrollbar-thumb {
  background-color: var(--color-text-tertiary, #888);
  border-radius: 2px;
  opacity: 0.3;
}
</style>
