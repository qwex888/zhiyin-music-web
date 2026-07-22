<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { CloudOff, WifiOff } from 'lucide-vue-next';
import { useAppConnectivity } from '@/offline/network';
import TipBanner from '@/components/common/TipBanner.vue';

const { t } = useI18n();
const { isOffline, statusLabel } = useAppConnectivity();
</script>

<template>
  <TipBanner
    v-if="isOffline"
    size="sm"
    border="bottom"
    class="justify-center rounded-none bg-amber-500/15 !py-2"
    :icon="statusLabel === 'offline' ? WifiOff : CloudOff"
  >
    {{
      statusLabel === 'offline'
        ? t('offline.banner_no_network')
        : t('offline.banner_backend_down')
    }}
  </TipBanner>
</template>
