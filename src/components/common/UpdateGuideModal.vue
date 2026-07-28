<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowUpCircle } from 'lucide-vue-next';
import { useUpdateCheck } from '@/composables/useUpdateCheck';
import type { ReleaseChanges } from '@/api/releases';

const { t } = useI18n();
const {
  latest,
  latestTag,
  shouldShowUpdateGuide,
  dismissUpdateGuide,
} = useUpdateCheck();

const visible = computed({
  get: () => shouldShowUpdateGuide.value,
  set: (v: boolean) => {
    if (!v) dismissUpdateGuide();
  },
});

const changeSections = computed(() => {
  const modules = latest.value?.modules ?? [];
  const keys: Array<keyof ReleaseChanges> = [
    'feature', 'fix', 'perf', 'refactor', 'docs', 'i18n', 'build', 'ci', 'style', 'test', 'chore',
  ];
  const merged: Partial<Record<keyof ReleaseChanges, string[]>> = {};
  for (const mod of modules) {
    for (const key of keys) {
      const items = mod.changes?.[key] ?? [];
      if (!items.length) continue;
      merged[key] = [...(merged[key] ?? []), ...items];
    }
  }
  return keys
    .filter((k) => (merged[k]?.length ?? 0) > 0)
    .map((k) => ({ key: k, items: merged[k]! }));
});

const close = () => {
  dismissUpdateGuide();
};
</script>

<template>
  <Teleport to="body">
    <transition name="fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[210] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="close"
      >
        <div class="bg-bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          <div class="relative bg-primary-gradient p-6 pb-8 text-center">
            <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm mb-4">
              <ArrowUpCircle class="w-7 h-7 text-white" />
            </div>
            <h2 class="text-xl font-bold text-white">{{ t('update_guide.title') }}</h2>
            <p class="mt-2 text-sm text-white/85 font-mono">v{{ latestTag }}</p>
          </div>

          <div class="p-6 space-y-4 max-h-[50vh] overflow-y-auto">
            <p class="text-sm text-text-secondary leading-relaxed">
              {{ t('update_guide.desc', { version: latestTag }) }}
            </p>
            <p v-if="latest?.summary" class="text-sm text-text-primary font-medium">
              {{ latest.summary }}
            </p>
            <div v-if="changeSections.length" class="space-y-3">
              <div v-for="sec in changeSections" :key="sec.key">
                <div class="text-xs font-medium text-text-tertiary mb-1">
                  {{ t(`changelog.type.${sec.key}`, sec.key) }}
                </div>
                <ul class="space-y-1 pl-4 list-disc text-xs text-text-secondary">
                  <li v-for="(item, idx) in sec.items.slice(0, 8)" :key="idx">{{ item }}</li>
                </ul>
              </div>
            </div>
            <p class="text-[11px] text-text-tertiary">{{ t('update_guide.settings_hint') }}</p>
          </div>

          <div class="px-6 pb-6">
            <button
              type="button"
              class="w-full py-2.5 rounded-xl text-sm font-medium text-white bg-primary-gradient hover:brightness-110 shadow-lg shadow-primary/20"
              @click="close"
            >
              {{ t('update_guide.got_it') }}
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
</style>
