import { computed, ref } from 'vue';
import { systemApi } from '@/api/system';

const enabled = ref<boolean | null>(null);
const writeStrmSidecar = ref<boolean | null>(null);
const loading = ref(false);
let loadPromise: Promise<boolean> | null = null;

/**
 * 联网刮削总开关与 STRM 侧车写盘开关（管理员配置）
 */
export function useScrapeFeature() {
  const isEnabled = computed(() => enabled.value === true);
  const isReady = computed(() => enabled.value !== null);
  const canWriteStrmSidecar = computed(() => writeStrmSidecar.value !== false);
  const writeStrmSidecarReady = computed(() => writeStrmSidecar.value !== null);

  const ensureLoaded = async (): Promise<boolean> => {
    if (enabled.value !== null && writeStrmSidecar.value !== null) {
      return enabled.value;
    }
    if (loadPromise) return loadPromise;

    loading.value = true;
    loadPromise = (async () => {
      try {
        const { data } = await systemApi.getConfig();
        enabled.value = Boolean(data.scrape?.enabled);
        writeStrmSidecar.value =
          data.scrape?.write_strm_sidecar === undefined
            ? true
            : Boolean(data.scrape.write_strm_sidecar);
      } catch {
        // 拉取失败时按未开启处理，避免误放行
        enabled.value = false;
        writeStrmSidecar.value = true;
      } finally {
        loading.value = false;
        loadPromise = null;
      }
      return enabled.value === true;
    })();

    return loadPromise;
  };

  const setEnabledLocal = (value: boolean) => {
    enabled.value = value;
  };

  const setWriteStrmSidecarLocal = (value: boolean) => {
    writeStrmSidecar.value = value;
  };

  const refresh = async (): Promise<boolean> => {
    enabled.value = null;
    writeStrmSidecar.value = null;
    return ensureLoaded();
  };

  return {
    enabled,
    isEnabled,
    isReady,
    loading,
    writeStrmSidecar,
    canWriteStrmSidecar,
    writeStrmSidecarReady,
    ensureLoaded,
    setEnabledLocal,
    setWriteStrmSidecarLocal,
    refresh,
  };
}
