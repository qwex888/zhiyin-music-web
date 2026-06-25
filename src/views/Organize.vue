
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, computed, onMounted, watch } from 'vue';
import {
  FolderTree, ArrowRight, AlertTriangle, CheckCircle2, RefreshCw,
  RotateCcw, Play, Layers, FileText, ChevronDown,
} from 'lucide-vue-next';
import { organizeApi } from '@/api/organize';
import { musicApi } from '@/api/music';
import { useToast } from '@/composables/useToast';
import type { Song } from '@/types';
import type { PreviewItemInput, PreviewItemOutput, OrganizeApplyResponse } from '@/types/scrape';

const { t } = useI18n();
const toast = useToast();

// ── 根目录选择 ───────────────────────────────────────────────

const rootOptions = ref<string[]>([]);
const rootPath = ref('');
const isLoadingRoots = ref(false);

const loadRoots = async () => {
  isLoadingRoots.value = true;
  try {
    const { data } = await organizeApi.getRoots();
    rootOptions.value = data.roots;
    if (data.roots.length === 1) {
      rootPath.value = data.roots[0];
    }
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isLoadingRoots.value = false;
  }
};

// ── 目录规则 ─────────────────────────────────────────────────

const template = ref('{Artist}/{Album}');

const dirPresets = [
  { label: 'dir_preset_artist_album', value: '{Artist}/{Album}' },
  { label: 'dir_preset_artist', value: '{Artist}' },
  { label: 'dir_preset_genre_artist', value: '{Genre}/{Artist}' },
  { label: 'dir_preset_year_album', value: '{Year}/{Album}' },
];

const templateVars = ['{Artist}', '{Album}', '{Title}', '{TrackNo}', '{Genre}', '{Year}', '{DiscNo}'];

const selectDirPreset = (value: string) => {
  template.value = value;
};

// ── 文件命名规则 ─────────────────────────────────────────────

const fileTemplate = ref('{Title} - {Artist}');

const filePresets = [
  { label: 'file_preset_title_artist', value: '{Title} - {Artist}' },
  { label: 'file_preset_artist_title', value: '{Artist} - {Title}' },
  { label: 'file_preset_track_title', value: '{TrackNo} - {Title}' },
  { label: 'file_preset_track_title_artist', value: '{TrackNo} - {Title} - {Artist}' },
  { label: 'file_preset_title', value: '{Title}' },
];

const selectFilePreset = (value: string) => {
  fileTemplate.value = value;
};

// ── 歌曲选择 ─────────────────────────────────────────────────

const songs = ref<Song[]>([]);
const filteredSongs = computed(() => {
  if (!rootPath.value) return [];
  return songs.value.filter(s => s.file_path.startsWith(rootPath.value));
});
const selectedIds = ref<Set<number>>(new Set());
const isLoadingSongs = ref(false);
const songsLoaded = ref(false);

const selectedSongs = computed(() =>
  filteredSongs.value.filter(s => selectedIds.value.has(s.id))
);

const isAllSelected = computed(() =>
  filteredSongs.value.length > 0 && selectedIds.value.size === filteredSongs.value.length
);

const loadSongs = async () => {
  isLoadingSongs.value = true;
  try {
    const pageSize = 1000;
    let offset = 0;
    const allSongs: Song[] = [];
    while (true) {
      const { data } = await musicApi.getSongs({ limit: pageSize, offset });
      allSongs.push(...data.items);
      if (!data.has_next) break;
      offset += data.items.length;
    }
    songs.value = allSongs;
    songsLoaded.value = true;
    showSongList.value = true;
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isLoadingSongs.value = false;
  }
};

watch(rootPath, (newVal) => {
  if (newVal) {
    selectedIds.value = new Set();
    previewItems.value = [];
    showPreview.value = false;
    if (!songsLoaded.value) {
      loadSongs();
    }
  }
});

const toggleSong = (id: number) => {
  const newSet = new Set(selectedIds.value);
  if (newSet.has(id)) {
    newSet.delete(id);
  } else {
    newSet.add(id);
  }
  selectedIds.value = newSet;
};

const toggleAll = () => {
  if (isAllSelected.value) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(filteredSongs.value.map(s => s.id));
  }
};

// ── 预览 ─────────────────────────────────────────────────────

const previewItems = ref<PreviewItemOutput[]>([]);
const isPreviewing = ref(false);
const showPreview = ref(false);

const conflictCount = computed(() =>
  previewItems.value.filter(i => i.conflict).length
);

const buildPreviewInput = (): PreviewItemInput[] => {
  return selectedSongs.value.map(s => ({
    old_path: s.file_path,
    artist: s.artist || s.artist_name || undefined,
    album: s.album || s.album_name || undefined,
    track_no: s.track_no || undefined,
    title: s.title || undefined,
  }));
};

const handlePreview = async () => {
  if (selectedIds.value.size === 0) {
    toast.error(t('organize.no_songs_selected'));
    return;
  }
  isPreviewing.value = true;
  try {
    const items = buildPreviewInput();
    const { data } = await organizeApi.preview(template.value, fileTemplate.value, items);
    previewItems.value = data.items;
    showPreview.value = true;
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isPreviewing.value = false;
  }
};

// ── 执行 ─────────────────────────────────────────────────────

const isApplying = ref(false);
const applyResult = ref<OrganizeApplyResponse | null>(null);

const handleApply = async () => {
  if (previewItems.value.length === 0) {
    toast.error(t('organize.no_preview'));
    return;
  }
  if (!rootPath.value) {
    toast.error(t('organize.no_root_selected'));
    return;
  }
  if (!confirm(t('organize.apply_confirm'))) return;

  isApplying.value = true;
  try {
    const items = buildPreviewInput();

    const { data: planData } = await organizeApi.createPlan(template.value, fileTemplate.value, rootPath.value, items);
    const planId = planData.plan_id;

    const { data } = await organizeApi.apply(planId, rootPath.value, template.value, fileTemplate.value, items);
    applyResult.value = data;
    toast.success(t('organize.apply_success', { moved: data.moved_count, errors: data.error_count }));
    historySessions.value.unshift({
      session_id: data.session_id,
      plan_id: data.plan_id,
      status: data.status,
      moved_count: data.moved_count,
      error_count: data.error_count,
    });
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isApplying.value = false;
  }
};

// ── 历史 & 回滚 ──────────────────────────────────────────────

interface HistoryItem {
  session_id: number;
  plan_id: number;
  status: string;
  moved_count: number;
  error_count: number;
}

const historySessions = ref<HistoryItem[]>([]);
const isRollingBack = ref<number | null>(null);

const handleRollback = async (sessionId: number) => {
  if (!confirm(t('organize.rollback_confirm'))) return;

  isRollingBack.value = sessionId;
  try {
    const { data } = await organizeApi.rollback(sessionId);
    toast.success(t('organize.rollback_success', { restored: data.restored_count, errors: data.error_count }));
    historySessions.value = historySessions.value.filter(h => h.session_id !== sessionId);
  } catch (e) {
    console.error(e);
    toast.error(t('common.error'));
  } finally {
    isRollingBack.value = null;
  }
};

// ── 歌曲列表展示控制 ────────────────────────────────────────

const showSongList = ref(false);

onMounted(() => {
  loadRoots();
});
</script>

<template>
  <div class="p-4 md:p-8 pb-24 max-w-5xl mx-auto animate-fade-in">
    <!-- 页头 -->
    <header class="mb-8 md:mb-12">
      <h1 class="text-3xl md:text-4xl font-bold text-text-primary tracking-tight mb-2 flex items-center gap-3">
        <FolderTree class="w-8 h-8 md:w-10 md:h-10 text-primary" />
        {{ t('organize.title') }}
      </h1>
      <p class="text-text-secondary text-sm md:text-base max-w-2xl">
        {{ t('organize.subtitle') }}
      </p>
    </header>

    <div class="space-y-8">

      <!-- 模板配置 -->
      <section>
        <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2 mb-6 flex items-center gap-2">
          <Layers class="w-5 h-5 text-primary" />
          {{ t('organize.template_config') }}
        </h3>

        <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm p-6 space-y-6">
          <!-- 根目录选择 -->
          <div>
            <label class="block text-text-secondary text-xs mb-1.5">{{ t('organize.root_path') }}</label>
            <div class="relative">
              <select
                v-model="rootPath"
                :disabled="isLoadingRoots || rootOptions.length === 0"
                class="w-full p-2.5 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none text-sm appearance-none pr-8"
              >
                <option value="" disabled>{{ t('organize.select_root_path') }}</option>
                <option v-for="root in rootOptions" :key="root" :value="root">{{ root }}</option>
              </select>
              <ChevronDown class="w-4 h-4 text-text-tertiary absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <p v-if="isLoadingRoots" class="text-xs text-text-tertiary mt-1">{{ t('common.loading') }}</p>
          </div>

          <!-- 目录命名规则 -->
          <div class="space-y-3">
            <div>
              <label class="block text-text-secondary text-xs mb-1.5">{{ t('organize.dir_template') }}</label>
              <input
                v-model="template"
                type="text"
                :placeholder="t('organize.dir_template_placeholder')"
                class="w-full p-2.5 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none text-sm font-mono"
              />
            </div>
            <div>
              <label class="block text-text-secondary text-xs mb-1.5">{{ t('organize.dir_presets') }}</label>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="p in dirPresets"
                  :key="p.value"
                  @click="selectDirPreset(p.value)"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
                  :class="template === p.value
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-bg-main text-text-secondary border-border hover:border-primary/20'"
                >
                  {{ t(`organize.${p.label}`) }}
                </button>
              </div>
            </div>
          </div>

          <!-- 文件命名规则 -->
          <div class="space-y-3">
            <div>
              <label class="block text-text-secondary text-xs mb-1.5">{{ t('organize.file_template') }}</label>
              <input
                v-model="fileTemplate"
                type="text"
                :placeholder="t('organize.file_template_placeholder')"
                class="w-full p-2.5 bg-bg-elevate rounded-lg border border-border text-text-primary focus:border-primary outline-none text-sm font-mono"
              />
              <p class="text-[10px] text-text-tertiary mt-1">{{ t('organize.file_template_hint') }}</p>
            </div>
            <div>
              <label class="block text-text-secondary text-xs mb-1.5">{{ t('organize.file_presets') }}</label>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="p in filePresets"
                  :key="p.value"
                  @click="selectFilePreset(p.value)"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
                  :class="fileTemplate === p.value
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-bg-main text-text-secondary border-border hover:border-primary/20'"
                >
                  {{ t(`organize.${p.label}`) }}
                </button>
              </div>
            </div>
          </div>

          <!-- 可用变量 -->
          <div>
            <label class="block text-text-secondary text-xs mb-1.5">{{ t('organize.template_vars') }}</label>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="v in templateVars"
                :key="v"
                class="text-[10px] font-mono px-2 py-1 rounded bg-bg-elevate text-text-primary border border-border cursor-pointer hover:border-primary/30 hover:text-primary transition-colors"
                @click="template += v"
              >
                {{ v }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- 歌曲选择（仅在选择根目录后显示） -->
      <section v-if="rootPath">
        <div class="flex items-center justify-between border-b border-border pb-2 mb-6">
          <h3 class="text-lg font-semibold text-text-primary flex items-center gap-2">
            <FileText class="w-5 h-5 text-primary" />
            {{ t('organize.select_songs') }}
            <span v-if="selectedIds.size > 0" class="text-sm font-normal text-primary">
              ({{ t('organize.selected_count', { count: selectedIds.size }) }})
            </span>
          </h3>
          <div class="flex items-center gap-2">
            <template v-if="isLoadingSongs">
              <span class="flex items-center gap-2 text-sm text-text-secondary">
                <RefreshCw class="w-4 h-4 animate-spin" />
                {{ t('organize.loading_songs') }}
              </span>
            </template>
            <template v-else-if="songsLoaded">
              <span class="text-xs text-text-tertiary">
                {{ t('organize.songs_in_path', { count: filteredSongs.length }) }}
              </span>
              <button
                @click="toggleAll"
                class="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevate text-text-secondary hover:text-primary border border-border transition-colors"
              >
                {{ isAllSelected ? t('organize.deselect_all') : t('organize.select_all') }}
              </button>
              <button
                @click="showSongList = !showSongList"
                class="p-2 rounded-lg hover:bg-bg-elevate text-text-secondary hover:text-primary transition-colors"
              >
                <ChevronDown class="w-4 h-4 transition-transform duration-200" :class="{ 'rotate-180': showSongList }" />
              </button>
            </template>
          </div>
        </div>

        <!-- 歌曲列表 -->
        <div
          v-if="songsLoaded"
          class="grid transition-all duration-300 ease-in-out"
          :class="showSongList ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
        >
          <div class="overflow-hidden">
            <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm max-h-[400px] overflow-y-auto">
              <div
                v-for="song in filteredSongs"
                :key="song.id"
                class="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 cursor-pointer transition-colors"
                :class="selectedIds.has(song.id) ? 'bg-primary/5' : 'hover:bg-bg-elevate'"
                @click="toggleSong(song.id)"
              >
                <input
                  type="checkbox"
                  :checked="selectedIds.has(song.id)"
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary flex-shrink-0"
                  @click.stop
                  @change="toggleSong(song.id)"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-text-primary truncate">{{ song.title }}</p>
                  <p class="text-xs text-text-secondary truncate">
                    {{ song.artist || song.artist_name || t('common.unknown_artist') }}
                    <span v-if="song.album || song.album_name"> · {{ song.album || song.album_name }}</span>
                  </p>
                </div>
                <span class="text-[10px] text-text-tertiary font-mono truncate max-w-[200px]" :title="song.file_path">
                  {{ song.file_path.split('/').pop() }}
                </span>
              </div>
              <div v-if="filteredSongs.length === 0" class="text-center py-8 text-text-secondary text-sm">
                {{ t('common.no_data') }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 未选择根目录的提示 -->
      <section v-else class="bg-bg-surface rounded-2xl border border-border p-8 text-center">
        <FolderTree class="w-10 h-10 text-text-tertiary mx-auto mb-3" />
        <p class="text-text-secondary text-sm">{{ t('organize.no_root_selected') }}</p>
      </section>

      <!-- 预览 & 执行 -->
      <section>
        <div class="flex items-center gap-3 mb-6">
          <button
            @click="handlePreview"
            :disabled="isPreviewing || selectedIds.size === 0"
            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            :class="!isPreviewing && selectedIds.size > 0
              ? 'bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/20'
              : 'bg-bg-elevate text-text-tertiary cursor-not-allowed border border-border'"
          >
            <RefreshCw v-if="isPreviewing" class="w-4 h-4 animate-spin" />
            {{ isPreviewing ? t('organize.previewing') : t('organize.preview') }}
          </button>

          <button
            v-if="showPreview && previewItems.length > 0"
            @click="handleApply"
            :disabled="isApplying"
            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            :class="!isApplying
              ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
              : 'bg-bg-elevate text-text-tertiary cursor-not-allowed border border-border'"
          >
            <RefreshCw v-if="isApplying" class="w-4 h-4 animate-spin" />
            <Play v-else class="w-4 h-4" />
            {{ isApplying ? t('organize.applying') : t('organize.apply') }}
          </button>
        </div>

        <!-- 冲突提示 -->
        <div v-if="showPreview && conflictCount > 0" class="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm">
          <AlertTriangle class="w-4 h-4 flex-shrink-0" />
          {{ t('organize.preview_has_conflicts', { count: conflictCount }) }}
        </div>

        <!-- 预览表格 -->
        <div v-if="showPreview && previewItems.length > 0" class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm">
          <div class="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 px-4 py-3 text-xs font-medium text-text-secondary border-b border-border bg-bg-surface/80">
            <span>{{ t('organize.preview_old_path') }}</span>
            <span></span>
            <span>{{ t('organize.preview_new_path') }}</span>
            <span class="text-center">{{ t('organize.status') }}</span>
          </div>

          <div class="max-h-[400px] overflow-y-auto divide-y divide-border">
            <div
              v-for="(item, idx) in previewItems"
              :key="idx"
              class="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center px-4 py-2.5 text-sm"
              :class="item.conflict ? 'bg-red-500/5' : ''"
            >
              <span class="text-text-secondary truncate font-mono text-xs" :title="item.old_path">
                {{ item.old_path }}
              </span>
              <ArrowRight class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0 mx-1" />
              <span class="text-text-primary truncate font-mono text-xs" :title="item.new_path">
                {{ item.new_path }}
              </span>
              <span class="flex-shrink-0 text-center">
                <AlertTriangle v-if="item.conflict" class="w-3.5 h-3.5 text-amber-500 inline" />
                <CheckCircle2 v-else class="w-3.5 h-3.5 text-emerald-500 inline" />
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- 历史 & 回滚 -->
      <section v-if="historySessions.length > 0">
        <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2 mb-6 flex items-center gap-2">
          <RotateCcw class="w-5 h-5 text-primary" />
          {{ t('organize.history') }}
        </h3>

        <div class="bg-bg-surface rounded-2xl border border-border overflow-hidden shadow-sm">
          <div class="grid grid-cols-[auto_auto_auto_auto_1fr] gap-x-4 px-4 py-3 text-xs font-medium text-text-secondary border-b border-border bg-bg-surface/80">
            <span>{{ t('organize.session_id') }}</span>
            <span>{{ t('organize.plan_id') }}</span>
            <span>{{ t('organize.moved_count') }}</span>
            <span>{{ t('organize.error_count') }}</span>
            <span></span>
          </div>
          <div class="divide-y divide-border">
            <div
              v-for="h in historySessions"
              :key="h.session_id"
              class="grid grid-cols-[auto_auto_auto_auto_1fr] gap-x-4 items-center px-4 py-3 text-sm"
            >
              <span class="font-mono text-text-primary text-xs">#{{ h.session_id }}</span>
              <span class="font-mono text-text-secondary text-xs">#{{ h.plan_id }}</span>
              <span class="text-emerald-500 font-medium text-xs">{{ h.moved_count }}</span>
              <span class="text-xs" :class="h.error_count > 0 ? 'text-red-500 font-medium' : 'text-text-tertiary'">
                {{ h.error_count }}
              </span>
              <div class="flex justify-end">
                <button
                  @click="handleRollback(h.session_id)"
                  :disabled="isRollingBack === h.session_id"
                  class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                  :class="isRollingBack !== h.session_id
                    ? 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-500/20'
                    : 'bg-bg-elevate text-text-tertiary cursor-not-allowed border border-border'"
                >
                  <RefreshCw v-if="isRollingBack === h.session_id" class="w-3 h-3 animate-spin" />
                  <RotateCcw v-else class="w-3 h-3" />
                  {{ isRollingBack === h.session_id ? t('organize.rolling_back') : t('organize.rollback') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
