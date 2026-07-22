<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Database, RefreshCw, Plus, Trash2, RotateCcw, Activity, X, Save, Zap,
  Palette, CircleCheck, CircleX, Info,
} from 'lucide-vue-next';
import { scrapeSourcesApi } from '@/api/scrapeSources';
import { useScrapeSources } from '@/composables/useScrapeSources';
import { useScrapeFeature } from '@/composables/useScrapeFeature';
import ScrapeDisabledPanel from '@/components/common/ScrapeDisabledPanel.vue';
import { useToast } from '@/composables/useToast';
import type {
  HealthListItem,
  ScrapeSourceListItem,
  SourceHealthSnapshot,
} from '@/types/scrapeSources';

const { t } = useI18n();
const toast = useToast();
const { refresh: refreshGlobalSources } = useScrapeSources();
const { isEnabled: scrapeEnabled, isReady: scrapeFeatureReady, ensureLoaded: ensureScrapeFeature } = useScrapeFeature();

const sources = ref<ScrapeSourceListItem[]>([]);
const healthItems = ref<HealthListItem[]>([]);
const isLoading = ref(false);
const isProbingAll = ref(false);
const probingKey = ref<string | null>(null);
const registryVersion = ref(0);
const probeResults = ref<HealthListItem[]>([]);
const probeModalVisible = ref(false);

const editModal = reactive({
  visible: false,
  isCreate: false,
  key: '',
  display_name: '',
  enabled: true,
  priority: 100,
  timeout_secs: '30' as string | number,
  color: '',
  template_json: '',
  is_builtin: false,
});

const fetchAll = async () => {
  isLoading.value = true;
  try {
    const [{ data: list }, { data: meta }, { data: health }] = await Promise.all([
      scrapeSourcesApi.list(),
      scrapeSourcesApi.meta(),
      scrapeSourcesApi.listHealth(),
    ]);
    sources.value = list.sort((a, b) => a.priority - b.priority);
    registryVersion.value = meta.registry_version;
    healthItems.value = health.items;
    await refreshGlobalSources();
  } catch {
    toast.error(t('common.error'));
  } finally {
    isLoading.value = false;
  }
};

const healthMap = computed(() => {
  const map = new Map<string, SourceHealthSnapshot | null | undefined>();
  for (const item of healthItems.value) {
    map.set(item.key, item.health);
  }
  return map;
});

const generateSourceKey = () => {
  const existing = new Set(sources.value.map((item) => item.key));
  let index = 1;
  while (existing.has(`template-source-${index}`)) index += 1;
  return `template-source-${index}`;
};

const openCreate = () => {
  editModal.visible = true;
  editModal.isCreate = true;
  editModal.key = generateSourceKey();
  editModal.display_name = '';
  editModal.enabled = true;
  editModal.priority = 100;
  editModal.timeout_secs = '30';
  editModal.color = '#6366F1';
  editModal.template_json = JSON.stringify({
    search: {
      method: 'GET',
      url: 'https://example.com/search',
      headers: {},
      query: { keyword: '{{title}} {{artist}}', page: '1' },
      body: null,
      response_format: 'json',
      items_path: '/data/list',
      field_map: {
        song_id: 'id',
        title: 'name',
        artist: 'artist',
        album: 'album',
        album_img: 'cover',
        year: 'year',
        duration_secs: 'duration',
      },
      duration_unit: 'seconds',
    },
    lyric: {
      method: 'GET',
      url: 'https://example.com/lyric?id={{song_id}}',
      response_format: 'json',
      content_path: '/lrc/content',
      encoding: 'utf8',
    },
    cover: {
      method: 'GET',
      url: 'https://example.com/cover?id={{song_id}}',
      response_format: 'url_in_json',
      url_path: '/data/img',
    },
  }, null, 2);
  editModal.is_builtin = false;
};

const openEdit = async (item: ScrapeSourceListItem) => {
  try {
    const { data } = await scrapeSourcesApi.get(item.key);
    editModal.visible = true;
    editModal.isCreate = false;
    editModal.key = data.key;
    editModal.display_name = data.display_name;
    editModal.enabled = data.enabled;
    editModal.priority = data.priority;
    editModal.timeout_secs = data.timeout_secs ?? '';
    editModal.color = data.color ?? '';
    editModal.template_json = data.template_json ?? '';
    editModal.is_builtin = data.is_builtin;
  } catch {
    toast.error(t('common.error'));
  }
};

const closeEdit = () => {
  editModal.visible = false;
};

const saveEdit = async () => {
  try {
    const timeout = editModal.timeout_secs === '' ? null : Number(editModal.timeout_secs);
    if (editModal.isCreate) {
      if (!editModal.key.trim() || !editModal.display_name.trim()) {
        toast.error(t('scrape_sources.fields_required'));
        return;
      }
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(editModal.key.trim())) {
        toast.error(t('scrape_sources.key_invalid'));
        return;
      }
      if (sources.value.some((item) => item.key === editModal.key.trim())) {
        toast.error(t('scrape_sources.key_duplicate'));
        return;
      }
      JSON.parse(editModal.template_json);
      await scrapeSourcesApi.create({
        key: editModal.key.trim(),
        display_name: editModal.display_name.trim(),
        template_json: editModal.template_json,
        enabled: editModal.enabled,
        priority: editModal.priority,
        timeout_secs: timeout,
        color: editModal.color || null,
      });
      toast.success(t('scrape_sources.create_success'));
    } else {
      const payload: Record<string, unknown> = {
        display_name: editModal.display_name.trim(),
        enabled: editModal.enabled,
        priority: editModal.priority,
        timeout_secs: timeout,
        color: editModal.color || null,
      };
      if (!editModal.is_builtin) {
        JSON.parse(editModal.template_json);
        payload.template_json = editModal.template_json;
      }
      await scrapeSourcesApi.update(editModal.key, payload);
      toast.success(t('scrape_sources.save_success'));
    }
    closeEdit();
    await fetchAll();
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: string } })?.response?.data;
    toast.error(typeof msg === 'string' ? msg : t('common.error'));
  }
};

const handleDelete = async (item: ScrapeSourceListItem) => {
  if (item.is_builtin) return;
  if (!confirm(t('scrape_sources.delete_confirm', { name: item.display_name }))) return;
  try {
    await scrapeSourcesApi.delete(item.key);
    toast.success(t('scrape_sources.delete_success'));
    await fetchAll();
  } catch {
    toast.error(t('common.error'));
  }
};

const handleReset = async (item: ScrapeSourceListItem) => {
  if (!item.is_builtin) return;
  if (!confirm(t('scrape_sources.reset_confirm', { name: item.display_name }))) return;
  try {
    await scrapeSourcesApi.reset(item.key);
    toast.success(t('scrape_sources.reset_success'));
    await fetchAll();
  } catch {
    toast.error(t('common.error'));
  }
};

const handleReload = async () => {
  try {
    const { data } = await scrapeSourcesApi.reload();
    registryVersion.value = data.registry_version;
    toast.success(t('scrape_sources.reload_success'));
    await fetchAll();
  } catch {
    toast.error(t('common.error'));
  }
};

const handleProbe = async (key: string) => {
  probingKey.value = key;
  try {
    const { data } = await scrapeSourcesApi.probe(key);
    toast.success(t('scrape_sources.probe_success'));
    const { data: health } = await scrapeSourcesApi.listHealth();
    healthItems.value = health.items;
    const source = sources.value.find((item) => item.key === key);
    probeResults.value = [{
      key,
      display_name: source?.display_name ?? key,
      health: data,
    }];
    probeModalVisible.value = true;
  } catch {
    toast.error(t('common.error'));
  } finally {
    probingKey.value = null;
  }
};

const handleProbeAll = async () => {
  isProbingAll.value = true;
  try {
    await scrapeSourcesApi.probeAll();
    toast.success(t('scrape_sources.probe_all_success'));
    const { data: health } = await scrapeSourcesApi.listHealth();
    healthItems.value = health.items;
    const enabledKeys = new Set(sources.value.filter((item) => item.enabled).map((item) => item.key));
    probeResults.value = health.items.filter((item) => enabledKeys.has(item.key));
    probeModalVisible.value = true;
  } catch {
    toast.error(t('common.error'));
  } finally {
    isProbingAll.value = false;
  }
};

const probeChecks = (health: SourceHealthSnapshot) => [
  { label: t('scrape_sources.check_search'), value: health.search_ok },
  { label: t('scrape_sources.check_lyric'), value: health.lyric_ok },
  { label: t('scrape_sources.check_cover'), value: health.cover_ok },
  { label: t('scrape_sources.field_title'), value: health.field_stats.title },
  { label: t('scrape_sources.field_artist'), value: health.field_stats.artist },
  { label: t('scrape_sources.field_album'), value: health.field_stats.album },
  { label: t('scrape_sources.field_album_img'), value: health.field_stats.album_img },
  { label: t('scrape_sources.field_year'), value: health.field_stats.year },
  { label: t('scrape_sources.field_duration'), value: health.field_stats.duration_secs },
  { label: t('scrape_sources.field_lyrics_available'), value: health.field_stats.lyrics_available },
];

const healthStatusLabel = (status?: string) =>
  t(`scrape_sources.health_${status || 'unknown'}`);

const healthStatusClass = (status?: string) => {
  switch (status) {
    case 'healthy': return 'bg-emerald-500/10 text-emerald-500';
    case 'degraded': return 'bg-amber-500/10 text-amber-500';
    case 'down': return 'bg-red-500/10 text-red-500';
    default: return 'bg-zinc-500/10 text-zinc-400';
  }
};

const capLabel = (item: ScrapeSourceListItem) => {
  const caps: string[] = [];
  if (item.capabilities.search) caps.push(t('scrape_sources.cap_search'));
  if (item.capabilities.lyric) caps.push(t('scrape_sources.cap_lyric'));
  if (item.capabilities.cover) caps.push(t('scrape_sources.cap_cover'));
  return caps.join(' · ') || '-';
};

onMounted(async () => {
  await ensureScrapeFeature();
  if (!scrapeEnabled.value) return;
  await fetchAll();
});
</script>

<template>
  <div class="flex flex-col h-full p-0 md:p-4 overflow-hidden animate-fade-in">
    <ScrapeDisabledPanel v-if="scrapeFeatureReady && !scrapeEnabled" />
    <template v-else-if="scrapeFeatureReady && scrapeEnabled">
    <header class="pt-2 md:pt-0 flex-none mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div>
        <h1 class="text-2xl md:text-3xl font-bold text-text-primary tracking-tight mb-1 flex items-center gap-3">
          <Database class="w-7 h-7 md:w-8 md:h-8 text-primary" />
          {{ t('scrape_sources.title') }}
        </h1>
        <p class="text-text-secondary text-sm max-w-2xl">{{ t('scrape_sources.subtitle') }}</p>
        <p class="text-xs text-text-tertiary mt-1">
          {{ t('scrape_sources.registry_version', { version: registryVersion }) }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button @click="handleReload" class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-border hover:border-primary/30">
          <RefreshCw class="w-4 h-4" />
          {{ t('scrape_sources.reload') }}
        </button>
        <button @click="handleProbeAll" :disabled="isProbingAll"
          class="flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-border hover:border-primary/30 disabled:opacity-50">
          <Activity class="w-4 h-4" :class="{ 'animate-pulse': isProbingAll }" />
          {{ t('scrape_sources.probe_all') }}
        </button>
        <button @click="openCreate"
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-white hover:bg-primary-hover">
          <Plus class="w-4 h-4" />
          {{ t('scrape_sources.create') }}
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-auto pb-24">
      <div v-if="isLoading" class="text-center py-16 text-text-secondary">
        <RefreshCw class="w-6 h-6 animate-spin mx-auto mb-2" />
        {{ t('common.loading') }}
      </div>

      <div v-else class="bg-bg-surface rounded-2xl border border-border overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-bg-elevate/50 text-text-secondary text-xs">
            <tr>
              <th class="text-left px-4 py-3">{{ t('scrape_sources.col_name') }}</th>
              <th class="text-left px-4 py-3 hidden md:table-cell">{{ t('scrape_sources.col_type') }}</th>
              <th class="text-left px-4 py-3">{{ t('scrape_sources.col_enabled') }}</th>
              <th class="text-left px-4 py-3 hidden sm:table-cell">{{ t('scrape_sources.col_priority') }}</th>
              <th class="text-left px-4 py-3 hidden lg:table-cell">{{ t('scrape_sources.col_capabilities') }}</th>
              <th class="text-left px-4 py-3">{{ t('scrape_sources.col_health') }}</th>
              <th class="text-right px-4 py-3">{{ t('scrape_sources.col_actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in sources" :key="item.key" class="border-t border-border hover:bg-bg-main/50">
              <td class="px-4 py-3">
                <div class="font-medium text-text-primary">{{ item.display_name }}</div>
                <div class="text-xs text-text-tertiary font-mono">{{ item.key }}</div>
              </td>
              <td class="px-4 py-3 hidden md:table-cell">
                <span class="text-xs px-2 py-0.5 rounded-full bg-bg-elevate border border-border">
                  {{ item.driver_type }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="text-xs px-2 py-0.5 rounded-full"
                  :class="item.enabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-500/10 text-zinc-400'">
                  {{ item.enabled ? t('scrape_sources.enabled') : t('scrape_sources.disabled') }}
                </span>
              </td>
              <td class="px-4 py-3 hidden sm:table-cell text-text-secondary">{{ item.priority }}</td>
              <td class="px-4 py-3 hidden lg:table-cell text-xs text-text-secondary">{{ capLabel(item) }}</td>
              <td class="px-4 py-3">
                <span v-if="healthMap.get(item.key)"
                  class="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  :class="healthStatusClass(healthMap.get(item.key)?.status)">
                  {{ healthMap.get(item.key)?.status || '-' }}
                </span>
                <span v-else class="text-xs text-text-tertiary">-</span>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1">
                  <button @click="handleProbe(item.key)" :disabled="probingKey === item.key"
                    class="p-1.5 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-primary"
                    :title="t('scrape_sources.probe')">
                    <Zap class="w-4 h-4" :class="{ 'animate-pulse': probingKey === item.key }" />
                  </button>
                  <button @click="openEdit(item)"
                    class="p-1.5 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-primary">
                    <Save class="w-4 h-4" />
                  </button>
                  <button v-if="item.is_builtin" @click="handleReset(item)"
                    class="p-1.5 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-amber-500">
                    <RotateCcw class="w-4 h-4" />
                  </button>
                  <button v-else @click="handleDelete(item)"
                    class="p-1.5 rounded-lg hover:bg-red-500/10 text-text-secondary hover:text-red-500">
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Teleport to="body">
      <transition name="fade">
        <div v-if="editModal.visible" class="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm" @click="closeEdit" />
      </transition>
      <transition name="slide-up">
        <div v-if="editModal.visible"
          class="fixed inset-x-4 bottom-4 top-auto md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[640px] md:max-h-[85vh] z-[111] bg-bg-surface rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
          <div class="flex items-center justify-between p-4 border-b border-border">
            <h3 class="font-medium text-text-primary">
              {{ editModal.isCreate ? t('scrape_sources.create') : t('scrape_sources.edit') }}
            </h3>
            <button @click="closeEdit" class="p-1.5 rounded-lg hover:bg-bg-elevate">
              <X class="w-4 h-4" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-4 space-y-4">
            <div v-if="editModal.isCreate">
              <label class="block text-xs text-text-secondary mb-1">{{ t('scrape_sources.field_key') }}</label>
              <input v-model="editModal.key" type="text"
                class="w-full p-2 bg-bg-elevate rounded-lg border border-border text-sm font-mono" />
              <p class="mt-1 text-[11px] text-text-tertiary">{{ t('scrape_sources.key_hint') }}</p>
            </div>
            <div>
              <label class="block text-xs text-text-secondary mb-1">{{ t('scrape_sources.field_display_name') }}</label>
              <input v-model="editModal.display_name" type="text"
                class="w-full p-2 bg-bg-elevate rounded-lg border border-border text-sm" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs text-text-secondary mb-1">{{ t('scrape_sources.field_priority') }}</label>
                <input v-model.number="editModal.priority" type="number"
                  class="w-full p-2 bg-bg-elevate rounded-lg border border-border text-sm" />
              </div>
              <div>
                <label class="block text-xs text-text-secondary mb-1">{{ t('scrape_sources.field_timeout') }}</label>
                <input v-model="editModal.timeout_secs" type="number" min="0"
                  class="w-full p-2 bg-bg-elevate rounded-lg border border-border text-sm" />
              </div>
            </div>
            <div>
              <label class="block text-xs text-text-secondary mb-1">{{ t('scrape_sources.field_color') }}</label>
              <div class="flex gap-2">
                <input v-model="editModal.color" type="text" placeholder="#E60026"
                  class="min-w-0 flex-1 p-2 bg-bg-elevate rounded-lg border border-border text-sm font-mono" />
                <label
                  class="relative w-11 shrink-0 rounded-lg border border-border cursor-pointer overflow-hidden focus-within:ring-2 focus-within:ring-primary"
                  :title="t('scrape_sources.choose_color')"
                  :style="{ backgroundColor: editModal.color || '#6366F1' }">
                  <span class="absolute inset-0 flex items-center justify-center bg-black/15">
                    <Palette class="w-4 h-4 text-white drop-shadow" />
                  </span>
                  <input v-model="editModal.color" type="color"
                    class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    :aria-label="t('scrape_sources.choose_color')" />
                </label>
              </div>
            </div>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="editModal.enabled" type="checkbox" class="rounded border-border text-primary" />
              {{ t('scrape_sources.field_enabled') }}
            </label>
            <div v-if="!editModal.is_builtin">
              <div class="mb-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                <div class="flex items-center gap-2 text-xs font-medium text-text-primary">
                  <Info class="w-4 h-4 text-primary shrink-0" />
                  {{ t('scrape_sources.template_guide_title') }}
                </div>
                <p class="mt-1.5 text-[11px] leading-relaxed text-text-secondary">
                  {{ t('scrape_sources.template_guide_desc') }}
                </p>
                <ul class="mt-2 pl-4 list-disc space-y-1 text-[11px] text-text-tertiary">
                  <li>{{ t('scrape_sources.template_guide_search') }}</li>
                  <li>{{ t('scrape_sources.template_guide_fields') }}</li>
                  <li>{{ t('scrape_sources.template_guide_optional') }}</li>
                </ul>
              </div>
              <label class="block text-xs text-text-secondary mb-1">{{ t('scrape_sources.field_template') }}</label>
              <textarea v-model="editModal.template_json" rows="12"
                class="w-full p-3 bg-bg-main rounded-lg border border-border text-xs font-mono leading-relaxed" />
            </div>
          </div>
          <div class="p-4 border-t border-border flex gap-3">
            <button @click="closeEdit" class="flex-1 py-2 rounded-xl text-sm bg-bg-elevate">{{ t('scrape.close') }}</button>
            <button @click="saveEdit" class="flex-1 py-2 rounded-xl text-sm bg-primary text-white">{{ t('common.save') }}</button>
          </div>
        </div>
      </transition>

      <transition name="fade">
        <div v-if="probeModalVisible"
          class="fixed inset-0 z-[120] bg-black/55 backdrop-blur-sm"
          @click.self="probeModalVisible = false">
          <div
            class="absolute inset-x-4 bottom-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[720px] max-h-[85vh] bg-bg-surface rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
            <div class="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 class="font-medium text-text-primary">{{ t('scrape_sources.probe_result_title') }}</h3>
                <p class="mt-0.5 text-xs text-text-tertiary">
                  {{ t('scrape_sources.probe_result_summary', { count: probeResults.length }) }}
                </p>
              </div>
              <button @click="probeModalVisible = false"
                class="p-1.5 rounded-lg hover:bg-bg-elevate"
                :aria-label="t('common.close')">
                <X class="w-4 h-4" />
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-4 space-y-3">
              <article v-for="item in probeResults" :key="item.key"
                class="rounded-xl border border-border bg-bg-main/40 overflow-hidden">
                <div class="flex items-start justify-between gap-3 p-3 border-b border-border">
                  <div class="min-w-0">
                    <div class="font-medium text-sm text-text-primary">{{ item.display_name }}</div>
                    <div class="text-[11px] text-text-tertiary font-mono">{{ item.key }}</div>
                  </div>
                  <div v-if="item.health" class="text-right shrink-0">
                    <span class="inline-flex text-[11px] font-medium px-2 py-1 rounded-full"
                      :class="healthStatusClass(item.health.status)">
                      {{ healthStatusLabel(item.health.status) }}
                    </span>
                    <div class="mt-1 text-[10px] text-text-tertiary">
                      {{ item.health.latency_ms }} ms
                    </div>
                  </div>
                </div>

                <div v-if="item.health" class="p-3">
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div v-for="check in probeChecks(item.health)" :key="check.label"
                      class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-bg-elevate/70 text-xs">
                      <span class="text-text-secondary">{{ check.label }}</span>
                      <span class="flex items-center gap-1 font-medium"
                        :class="check.value ? 'text-emerald-500' : 'text-red-500'">
                        <CircleCheck v-if="check.value" class="w-3.5 h-3.5" />
                        <CircleX v-else class="w-3.5 h-3.5" />
                        {{ check.value ? t('scrape_sources.available') : t('scrape_sources.unavailable') }}
                      </span>
                    </div>
                  </div>
                  <div v-if="item.health.error_message"
                    class="mt-3 p-2.5 rounded-lg bg-red-500/10 text-xs text-red-400 break-words">
                    {{ t('scrape_sources.probe_error') }}：{{ item.health.error_message }}
                  </div>
                </div>
                <div v-else class="p-4 text-xs text-text-tertiary">
                  {{ t('scrape_sources.not_probed') }}
                </div>
              </article>
            </div>

            <div class="p-4 border-t border-border">
              <button @click="probeModalVisible = false"
                class="w-full py-2 rounded-xl text-sm bg-primary text-white hover:bg-primary-hover">
                {{ t('common.close') }}
              </button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
    </template>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.3s; }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translateY(16px); }
</style>
