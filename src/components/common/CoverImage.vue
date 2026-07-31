<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { Music2 } from 'lucide-vue-next';
import { useCoverUrl } from '@/composables/useCoverUrl';

const props = withDefaults(defineProps<{
  /** 本地封面 ID（走 /api/covers/{id}） */
  coverId?: number | null;
  /** 外部图片 URL；与 coverId 同时存在时优先用 src */
  src?: string | null;
  size?: 'thumb' | 'small' | 'medium' | 'large';
  imgClass?: string;
  /** 列表场景默认开启；播放器当前曲等需立即显示时传 false */
  lazy?: boolean;
  alt?: string;
}>(), {
  size: 'small',
  imgClass: '',
  lazy: true,
  alt: '',
});

type CoverState = 'idle' | 'loading' | 'loaded' | 'error';

const rootRef = ref<HTMLElement | null>(null);
/** lazy 时等进入可视区再拉封面，避免首页未滚动就打满 /api/covers */
const shouldFetch = ref(!props.lazy);

const hasExternalSrc = computed(() => !!props.src);
const hasValidCover = computed(() => hasExternalSrc.value || !!props.coverId);

const state = ref<CoverState>(hasValidCover.value ? 'loading' : 'idle');

const { displayUrl } = useCoverUrl(() => {
  if (hasExternalSrc.value) return null;
  if (!shouldFetch.value) return null;
  return props.coverId;
});
const coverUrl = computed(() => (hasExternalSrc.value ? (props.src || '') : displayUrl.value));

let io: IntersectionObserver | null = null;

onMounted(() => {
  if (!props.lazy) {
    shouldFetch.value = true;
    return;
  }
  const el = rootRef.value;
  if (!el) {
    shouldFetch.value = true;
    return;
  }
  if (typeof IntersectionObserver === 'undefined') {
    shouldFetch.value = true;
    return;
  }
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        shouldFetch.value = true;
        io?.disconnect();
        io = null;
      }
    },
    { rootMargin: '150px', threshold: 0.01 },
  );
  io.observe(el);
});

onUnmounted(() => {
  io?.disconnect();
  io = null;
});

const handleLoad = (e: Event) => {
  const img = e.target as HTMLImageElement;
  if (img.src.startsWith('data:')) return;
  state.value = 'loaded';
};

const handleError = (e: Event) => {
  const img = e.target as HTMLImageElement;
  if (img.src.startsWith('data:')) return;
  state.value = 'error';
};

watch(
  () => [props.src, props.coverId] as const,
  () => {
    state.value = hasValidCover.value ? 'loading' : 'idle';
  },
);
</script>

<template>
  <div ref="rootRef" class="cover-image">
    <img
      v-if="hasValidCover && coverUrl && state !== 'error' && lazy"
      v-lazy="coverUrl"
      :class="['cover-img', imgClass, { 'is-loaded': state === 'loaded' }]"
      :alt="alt"
      decoding="async"
      @load="handleLoad"
      @error="handleError"
    />
    <img
      v-else-if="hasValidCover && coverUrl && state !== 'error'"
      :src="coverUrl"
      :class="['cover-img', imgClass, { 'is-loaded': state === 'loaded' }]"
      :alt="alt"
      decoding="async"
      @load="handleLoad"
      @error="handleError"
    />

    <!-- 加载中：音符 SVG 占位 -->
    <div v-if="state === 'loading'" class="cover-placeholder bg-gradient-to-br">
      <svg class="w-5 h-5 opacity-30" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
      </svg>
    </div>

    <!-- 加载失败 / 无封面 -->
    <slot v-if="state === 'error' || state === 'idle'" name="fallback">
      <div class="cover-placeholder">
        <Music2 class="w-5 h-5 opacity-40" />
      </div>
    </slot>
  </div>
</template>

<style scoped>
.cover-image {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease-in;
}

.cover-img.is-loaded {
  opacity: 1;
}

.cover-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary, #71717a);
}

/* 封面加载动画 */
@keyframes shimmer {
  0% {
    background-position: -200px 0;
  }
  100% {
    background-position: 200px 0;
  }
}

.bg-gradient-to-br {
  background-image: linear-gradient(
    90deg,
    rgba(39, 39, 42, 0.5) 0px,
    rgba(63, 63, 70, 0.5) 40px,
    rgba(39, 39, 42, 0.5) 80px
  );
  background-size: 200px 100%;
  animation: shimmer 1.5s infinite linear;
}
</style>
