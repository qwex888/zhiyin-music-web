<script setup lang="ts">
import { Search, Settings } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

defineProps<{
  /** 可选副文案 key，默认 scrape.disabled_desc */
  descKey?: string;
}>();

const { t } = useI18n();
const router = useRouter();

const goSettings = () => {
  router.push({ path: '/settings', hash: '#scrape-feature' });
};
</script>

<template>
  <div class="flex-1 flex items-center justify-center p-6">
    <div class="max-w-md w-full text-center space-y-5">
      <div class="mx-auto w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
        <Search class="w-7 h-7 text-amber-500" />
      </div>
      <div class="space-y-2">
        <h2 class="text-xl font-semibold text-text-primary">{{ t('scrape.disabled_title') }}</h2>
        <p class="text-sm text-text-secondary leading-relaxed">
          {{ t(descKey || 'scrape.disabled_desc') }}
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-white hover:opacity-90 transition-opacity"
        @click="goSettings"
      >
        <Settings class="w-4 h-4" />
        {{ t('scrape.go_to_settings') }}
      </button>
    </div>
  </div>
</template>
