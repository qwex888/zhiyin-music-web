<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { Music2 } from 'lucide-vue-next';
import { useCoverUrl } from '@/composables/useCoverUrl';

const props = withDefaults(defineProps<{
  coverId?: number | null;
  size?: 'thumb' | 'small' | 'medium' | 'large';
  imgClass?: string;
  lazy?: boolean;
  alt?: string;
}>(), {
  size: 'small',
  imgClass: '',
  lazy: false,
  alt: '',
});

type CoverState = 'idle' | 'loading' | 'loaded' | 'error';
const state = ref<CoverState>(props.coverId ? 'loading' : 'idle');

const { displayUrl } = useCoverUrl(() => props.coverId);
const coverUrl = computed(() => displayUrl.value);
const hasValidCover = computed(() => !!props.coverId);

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

watch(() => props.coverId, (id) => {
  state.value = id ? 'loading' : 'idle';
});
</script>

<template>
  <div class="cover-image">
    <img
      v-if="hasValidCover && state !== 'error' && lazy"
      v-lazy="coverUrl"
      :class="['cover-img', imgClass, { 'is-loaded': state === 'loaded' }]"
      :alt="alt"
      decoding="async"
      @load="handleLoad"
      @error="handleError"
    />
    <img
      v-else-if="hasValidCover && state !== 'error'"
      :src="coverUrl"
      :class="['cover-img', imgClass, { 'is-loaded': state === 'loaded' }]"
      :alt="alt"
      decoding="async"
      @load="handleLoad"
      @error="handleError"
    />

    <!-- 加载中：音符 SVG 占位 -->
    <div v-if="state === 'loading'" class="cover-placeholder">
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
</style>
