import { ref, computed } from 'vue';
import { useOnline } from '@vueuse/core';

const backendReachable = ref(false);
const healthCheckDone = ref(false);

let _healthCheckResolve: (() => void) | null = null;
let _healthCheckPromise: Promise<void> = new Promise((resolve) => {
  _healthCheckResolve = resolve;
});

export function setBackendReachable(value: boolean): void {
  backendReachable.value = value;
  healthCheckDone.value = true;
  if (_healthCheckResolve) {
    _healthCheckResolve();
    _healthCheckResolve = null;
  }
}

/** 重置 health check 状态（登录/登出切换时调用） */
export function resetHealthCheck(): void {
  healthCheckDone.value = false;
  backendReachable.value = false;
  _healthCheckPromise = new Promise((resolve) => {
    _healthCheckResolve = resolve;
  });
}

/** 等待首次 health check 完成（若已完成立即 resolve） */
export function waitForHealthCheck(): Promise<void> {
  if (healthCheckDone.value) return Promise.resolve();
  return _healthCheckPromise;
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
