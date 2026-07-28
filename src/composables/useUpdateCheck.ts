import { ref, computed } from 'vue';
import { releasesApi, type LatestReleaseResponse } from '@/api/releases';
import { systemApi } from '@/api/system';

const DISMISS_KEY = 'zhiyin_dismissed_update_tag';
const ONBOARDING_OPEN_KEY = 'zhiyin_onboarding_open';

const latest = ref<LatestReleaseResponse | null>(null);
const currentVersion = ref<string | null>(null);
const loading = ref(false);
const onboardingBlocking = ref(false);
const dismissTick = ref(0);
let fetched = false;

const compareVersions = (a: string, b: string): number => {
  const norm = (v: string) => v.replace(/^v/i, '');
  const pa = norm(a).split('.').map(Number);
  const pb = norm(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

const latestTag = computed(() => latest.value?.tag ?? null);

const hasUpdate = computed(() => {
  if (!latestTag.value || !currentVersion.value) return false;
  return compareVersions(latestTag.value, currentVersion.value) > 0;
});

const isDismissedForLatest = () => {
  if (!latestTag.value) return true;
  try {
    return localStorage.getItem(DISMISS_KEY) === latestTag.value.replace(/^v/i, '');
  } catch {
    return false;
  }
};

const dismissUpdateGuide = () => {
  if (!latestTag.value) return;
  try {
    localStorage.setItem(DISMISS_KEY, latestTag.value.replace(/^v/i, ''));
  } catch { /* noop */ }
  dismissTick.value += 1;
};

const setOnboardingBlocking = (v: boolean) => {
  onboardingBlocking.value = v;
  try {
    if (v) sessionStorage.setItem(ONBOARDING_OPEN_KEY, '1');
    else sessionStorage.removeItem(ONBOARDING_OPEN_KEY);
  } catch { /* noop */ }
};

const syncOnboardingBlockingFromStorage = () => {
  try {
    onboardingBlocking.value = sessionStorage.getItem(ONBOARDING_OPEN_KEY) === '1';
  } catch {
    onboardingBlocking.value = false;
  }
};

/** 引导弹窗：有更新、未按版本 dismiss、且不在 onboarding 期间 */
const shouldShowUpdateGuide = computed(() => {
  void dismissTick.value;
  if (onboardingBlocking.value) return false;
  if (!hasUpdate.value || !latestTag.value) return false;
  return !isDismissedForLatest();
});

const refreshUpdateCheck = async (force = false) => {
  if (loading.value) return;
  if (fetched && !force) return;
  loading.value = true;
  try {
    const [latestRes, healthRes] = await Promise.all([
      releasesApi.getLatest(),
      systemApi.getHealth(),
    ]);
    latest.value = latestRes.data;
    currentVersion.value = healthRes.data.version;
    fetched = true;
  } catch {
    // 静默：保留旧值
  } finally {
    loading.value = false;
  }
};

export function useUpdateCheck() {
  syncOnboardingBlockingFromStorage();
  return {
    latest,
    latestTag,
    currentVersion,
    hasUpdate,
    loading,
    onboardingBlocking,
    shouldShowUpdateGuide,
    refreshUpdateCheck,
    dismissUpdateGuide,
    setOnboardingBlocking,
    compareVersions,
  };
}
