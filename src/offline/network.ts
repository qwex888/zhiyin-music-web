import { ref, computed } from 'vue';
import { useOnline } from '@vueuse/core';

const backendReachable = ref(false);
const healthCheckDone = ref(false);

export function setBackendReachable(value: boolean): void {
  backendReachable.value = value;
  healthCheckDone.value = true;
}

export function isBrowserOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/** 浏览器在线且后端健康检查通过 */
export function isAppOnline(): boolean {
  return isBrowserOnline() && backendReachable.value;
}

export function isOfflineMode(): boolean {
  return !isAppOnline();
}

export function useAppConnectivity() {
  const browserOnline = useOnline();

  const isOffline = computed(
    () => healthCheckDone.value && (!browserOnline.value || !backendReachable.value)
  );

  const statusLabel = computed(() => {
    if (!browserOnline.value) return 'offline';
    if (!backendReachable.value) return 'backend_unreachable';
    return 'online';
  });

  return {
    browserOnline,
    backendReachable,
    isOffline,
    statusLabel,
    setBackendReachable,
  };
}
