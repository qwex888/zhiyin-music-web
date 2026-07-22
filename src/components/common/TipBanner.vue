<script setup lang="ts">
import { computed, type Component } from 'vue';
import { AlertCircle } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    /** 语义变体：控制底色/边框/文字对比度（浅色深字、深色浅字） */
    variant?: 'warning' | 'danger' | 'info';
    size?: 'sm' | 'md';
    /** lucide 组件；false 隐藏默认图标。也可用 #icon 插槽完全自定义 */
    icon?: Component | false;
    align?: 'center' | 'start';
    /** all=四周边框；bottom=仅底边（顶栏条）；none=无边框 */
    border?: 'all' | 'bottom' | 'none';
  }>(),
  {
    variant: 'warning',
    size: 'md',
    align: 'center',
    border: 'all',
  },
);

const resolvedIcon = computed(() => {
  if (props.icon === false) return null;
  return props.icon ?? AlertCircle;
});

const rootClass = computed(() => {
  const variantMap = {
    warning:
      'bg-amber-500/10 text-amber-800 dark:text-amber-200',
    danger:
      'bg-red-500/10 text-red-800 dark:text-red-200',
    info:
      'bg-sky-500/10 text-sky-800 dark:text-sky-200',
  } as const;

  const borderColorMap = {
    warning: 'border-amber-500/20',
    danger: 'border-red-500/20',
    info: 'border-sky-500/20',
  } as const;

  const borderMap = {
    all: `border rounded-xl ${borderColorMap[props.variant]}`,
    bottom: `border-b border-x-0 border-t-0 rounded-none ${borderColorMap[props.variant]}`,
    none: 'border-0',
  } as const;

  const sizeMap = {
    sm: 'gap-2 px-3 py-2 text-xs',
    md: 'gap-3 px-4 py-4 text-sm',
  } as const;

  return [
    'flex',
    props.align === 'start' ? 'items-start' : 'items-center',
    sizeMap[props.size],
    variantMap[props.variant],
    borderMap[props.border],
  ];
});

const iconClass = computed(() =>
  props.size === 'sm' ? 'w-4 h-4 flex-shrink-0' : 'w-5 h-5 flex-shrink-0',
);
</script>

<template>
  <div role="status" :class="rootClass">
    <slot name="icon">
      <component
        :is="resolvedIcon"
        v-if="resolvedIcon"
        :class="[iconClass, align === 'start' ? 'mt-0.5' : '']"
      />
    </slot>
    <div class="min-w-0">
      <slot />
    </div>
  </div>
</template>
