<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Plus, ListMusic, Loader2, Globe, Lock, Inbox } from 'lucide-vue-next';
import { playlistsApi } from '@/api/playlists';
import { useToast } from '@/composables/useToast';
import { usePlaylists } from '@/composables/usePlaylists';
import type { PlaylistSummary } from '@/types/playlist';
import CoverImage from '@/components/common/CoverImage.vue';
import PlaylistFormModal from '@/components/common/PlaylistFormModal.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const { invalidate } = usePlaylists();

const tab = ref<'mine' | 'public'>((route.query.tab as 'mine' | 'public') || 'mine');
const playlists = ref<PlaylistSummary[]>([]);
const loading = ref(true);
const showCreate = ref(false);

const fetchList = async () => {
  loading.value = true;
  try {
    const { data } = await playlistsApi.list({ scope: tab.value });
    playlists.value = data;
  } catch {
    toast.error(t('common.error'));
    playlists.value = [];
  } finally {
    loading.value = false;
  }
};

const setTab = (next: 'mine' | 'public') => {
  tab.value = next;
  router.replace({ query: { ...route.query, tab: next } });
};

watch(tab, () => {
  void fetchList();
});

onMounted(() => {
  void fetchList();
});

const openDetail = (id: number) => {
  router.push({ name: 'PlaylistDetail', params: { id } });
};

const onCreated = (pl: PlaylistSummary) => {
  invalidate();
  if (tab.value === 'mine' || pl.is_public) {
    playlists.value = [pl, ...playlists.value.filter((p) => p.id !== pl.id)];
  }
  openDetail(pl.id);
};
</script>

<template>
  <div class="p-4 md:p-8 space-y-6 pb-24">
    <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <h1 class="text-2xl md:text-3xl font-bold text-text-primary">{{ t('playlist.title') }}</h1>
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-white bg-primary-gradient hover:brightness-110 shadow-lg shadow-primary/20"
        @click="showCreate = true"
      >
        <Plus class="w-4 h-4" />
        {{ t('playlist.create') }}
      </button>
    </header>

    <div class="flex items-center gap-2 border-b border-border">
      <button
        class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="tab === 'mine' ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'"
        @click="setTab('mine')"
      >
        {{ t('playlist.tab_mine') }}
      </button>
      <button
        class="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="tab === 'public' ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'"
        @click="setTab('public')"
      >
        {{ t('playlist.tab_public') }}
      </button>
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <Loader2 class="w-10 h-10 animate-spin text-primary" />
    </div>

    <div v-else-if="playlists.length === 0" class="flex flex-col items-center justify-center py-16 text-text-secondary border border-dashed border-border rounded-xl">
      <Inbox class="w-12 h-12 mb-3 text-text-tertiary" />
      <p class="text-sm font-medium mb-4">{{ tab === 'mine' ? t('playlist.empty_mine') : t('playlist.empty_public') }}</p>
      <button
        v-if="tab === 'mine'"
        class="text-sm text-primary hover:underline"
        @click="showCreate = true"
      >
        {{ t('playlist.create') }}
      </button>
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-5">
      <button
        v-for="pl in playlists"
        :key="pl.id"
        type="button"
        class="group text-left space-y-2"
        @click="openDetail(pl.id)"
      >
        <div class="relative aspect-square rounded-xl overflow-hidden border border-border bg-bg-elevate group-hover:border-primary/40 transition-all shadow-md">
          <CoverImage :cover-id="pl.effective_cover_id ?? undefined" size="medium" lazy>
            <template #fallback>
              <div class="w-full h-full flex items-center justify-center">
                <ListMusic class="w-12 h-12 text-text-tertiary" />
              </div>
            </template>
          </CoverImage>
          <div class="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 text-white">
            <Globe v-if="pl.is_public" class="w-3.5 h-3.5" />
            <Lock v-else class="w-3.5 h-3.5" />
          </div>
        </div>
        <div class="px-0.5">
          <div class="font-semibold text-text-primary truncate group-hover:text-primary transition-colors">{{ pl.name }}</div>
          <div class="text-xs text-text-tertiary truncate">
            {{ t('playlist.song_count', { count: pl.song_count }) }}
            <span v-if="!pl.is_owner"> · {{ pl.owner_user_id }}</span>
          </div>
        </div>
      </button>
    </div>

    <PlaylistFormModal v-model="showCreate" @saved="onCreated" />
  </div>
</template>
