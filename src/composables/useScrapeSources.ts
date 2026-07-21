import { computed, ref } from 'vue';
import { scrapeSourcesApi } from '@/api/scrapeSources';
import type { ScrapeSourceListItem } from '@/types/scrapeSources';

const sources = ref<ScrapeSourceListItem[]>([]);
const registryVersion = ref(0);
const loading = ref(false);
const loaded = ref(false);
let loadPromise: Promise<void> | null = null;

function hashColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

function hexToBadgeStyle(hex?: string | null): string {
  if (!hex) return '';
  const color = hex.startsWith('#') ? hex : `#${hex}`;
  return `background-color: ${color}1a; color: ${color}; border-color: ${color}33`;
}

export function useScrapeSources() {
  const enabledSources = computed(() =>
    [...sources.value]
      .filter(s => s.enabled)
      .sort((a, b) => a.priority - b.priority)
  );

  const sourceMap = computed(() => {
    const map = new Map<string, ScrapeSourceListItem>();
    for (const s of sources.value) {
      map.set(s.key, s);
    }
    return map;
  });

  const getSourceMeta = (key: string): ScrapeSourceListItem | undefined =>
    sourceMap.value.get(key);

  const getSourceLabel = (key: string): string =>
    getSourceMeta(key)?.display_name || key;

  const getSourceColorClass = (key: string): string => {
    const meta = getSourceMeta(key);
    if (meta?.color) {
      return '';
    }
    switch (key) {
      case 'netease': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'qq': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'kugou': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'kuwo': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      case 'migu': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
      case 'acoustid': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
      default: return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
    }
  };

  const getSourceBadgeStyle = (key: string): Record<string, string> | undefined => {
    const meta = getSourceMeta(key);
    if (!meta?.color) return undefined;
    const style = hexToBadgeStyle(meta.color);
    if (!style) return undefined;
    const parts = style.split(';').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split(':').map(s => s.trim());
      if (k && v) acc[k] = v;
      return acc;
    }, {});
    return parts;
  };

  const getEnabledKeys = (): string[] => enabledSources.value.map(s => s.key);

  const refresh = async (enabledOnly = false) => {
    if (loadPromise) {
      await loadPromise;
      if (enabledOnly && sources.value.every(s => !s.enabled || s.enabled)) {
        // 已加载全量列表时无需重复请求
        if (!enabledOnly || sources.value.length > 0) return;
      }
    }

    loading.value = true;
    loadPromise = (async () => {
      try {
        const [{ data: list }, { data: meta }] = await Promise.all([
          scrapeSourcesApi.list(enabledOnly),
          scrapeSourcesApi.meta(),
        ]);
        sources.value = list.sort((a, b) => a.priority - b.priority);
        registryVersion.value = meta.registry_version;
        loaded.value = true;
      } finally {
        loading.value = false;
        loadPromise = null;
      }
    })();

    await loadPromise;
  };

  const ensureLoaded = async () => {
    if (!loaded.value) {
      await refresh(true);
    }
  };

  const syncIfStale = async (version?: number) => {
    if (version !== undefined && version !== registryVersion.value) {
      await refresh(false);
    }
  };

  return {
    sources,
    enabledSources,
    registryVersion,
    loading,
    loaded,
    refresh,
    ensureLoaded,
    syncIfStale,
    getSourceMeta,
    getSourceLabel,
    getSourceColorClass,
    getSourceBadgeStyle,
    getEnabledKeys,
    hashColor,
  };
}
