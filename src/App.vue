<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useOnline } from '@vueuse/core';
import dayjs from 'dayjs';
import MainLayout from '@/components/layout/MainLayout.vue';
import ToastContainer from '@/components/common/ToastContainer.vue';
import { systemApi } from '@/api/system';
import { useToast } from '@/composables/useToast';
import { useSystemStore } from '@/stores/system';
import { useAuthStore } from '@/stores/auth';
import { useTheme } from '@/composables/useTheme';
import { usePlayerStore } from '@/stores/player';
import { useLibraryStore } from '@/stores/library';
import { useOfflineStore } from '@/stores/offline';
import { setBackendReachable, resetHealthCheck } from '@/offline/network';
import { detectOrphans, orphanDetected, orphanIds } from '@/offline/orphan-detector';

const route = useRoute();
const toast = useToast();
const systemStore = useSystemStore();
const authStore = useAuthStore();
const playerStore = usePlayerStore();
const libraryStore = useLibraryStore();
const offlineStore = useOfflineStore();
const browserOnline = useOnline();
const { locale, t } = useI18n();

useTheme();

const showMainLayout = computed(() => authStore.isAuthenticated && route.name !== 'Login');

watch(locale, (newLocale) => {
  if (newLocale === 'zh-CN') {
    dayjs.locale('zh-cn');
  } else {
    dayjs.locale('en');
  }
});

const checkHealth = async () => {
  if (!browserOnline.value) {
    setBackendReachable(false);
    systemStore.setConnected(false);
    await libraryStore.hydrateLocalMetadata();
    await offlineStore.refreshMeta();
    return;
  }
  try {
    await systemApi.getHealth();
    systemStore.setConnected(true);
    setBackendReachable(true);
    if (authStore.isAuthenticated) {
      void offlineStore.syncLibrary();
      detectOrphans().then(({ orphan }) => {
        if (orphan.size > 0) {
          toast.error(t('offline.orphan_detected', { count: orphan.size }));
          const removed = playerStore.removeOrphanSongs(orphan);
          if (removed > 0) {
            toast.info(t('offline.orphan_queue_cleaned', { count: removed }));
          }
        }
      });
    }
  } catch {
    systemStore.setConnected(false);
    setBackendReachable(false);
    await libraryStore.hydrateLocalMetadata();
    if (authStore.isAuthenticated) {
      toast.error(t('settings.backend_connect_failed'));
    }
  } finally {
    await offlineStore.refreshMeta();
  }
};

watch(() => authStore.isAuthenticated, (authenticated) => {
  if (authenticated) {
    resetHealthCheck();
    void checkHealth();
  }
});

watch(browserOnline, (online) => {
  if (authStore.isAuthenticated) {
    if (online) void checkHealth();
    else {
      setBackendReachable(false);
      systemStore.setConnected(false);
      void libraryStore.hydrateLocalMetadata();
    }
  }
});

onMounted(() => {
  if (authStore.isAuthenticated) {
    void checkHealth();
    void libraryStore.hydrateLocalMetadata();
  }
  playerStore.isPlaying = false;
});
</script>

<template>
  <MainLayout v-if="showMainLayout" />
  <router-view v-else />
  <ToastContainer />
</template>
