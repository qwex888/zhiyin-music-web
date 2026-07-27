<script setup lang="ts">
import { useToast } from '@/composables/useToast';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-vue-next';

const { toasts, removeToast } = useToast();
</script>

<template>
  <!-- 挂到 body，避免被页面内 stacking context / 弹层蒙层压住 -->
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
      <transition-group name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="pointer-events-auto min-w-[300px] max-w-md p-4 rounded-lg shadow-lg border flex items-start gap-3 transform transition-all duration-300 backdrop-blur-md"
          :class="{
            'bg-bg-surface/90 border-primary/20 text-text-primary': toast.type === 'info',
            'bg-emerald-50/90 dark:bg-emerald-950/90 border-emerald-500/30 text-emerald-700 dark:text-emerald-400': toast.type === 'success',
            'bg-red-50/90 dark:bg-red-950/90 border-red-500/30 text-red-700 dark:text-red-400': toast.type === 'error'
          }"
        >
          <CheckCircle v-if="toast.type === 'success'" class="w-5 h-5 flex-shrink-0" />
          <AlertCircle v-else-if="toast.type === 'error'" class="w-5 h-5 flex-shrink-0" />
          <Info v-else class="w-5 h-5 flex-shrink-0" />

          <div class="flex-1 text-sm font-medium pt-0.5 break-words">{{ toast.message }}</div>

          <button @click="removeToast(toast.id)" class="hover:opacity-70 transition-opacity p-0.5">
            <X class="w-4 h-4" />
          </button>
        </div>
      </transition-group>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>
