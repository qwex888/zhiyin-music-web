import { ref } from 'vue';
import { playlistsApi } from '@/api/playlists';
import type { PlaylistSummary } from '@/types/playlist';

const myPlaylists = ref<PlaylistSummary[]>([]);
const loading = ref(false);
let lastFetchedAt = 0;

export function usePlaylists() {
  const refreshMine = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchedAt < 5000 && myPlaylists.value.length > 0) {
      return myPlaylists.value;
    }
    loading.value = true;
    try {
      const { data } = await playlistsApi.list({ scope: 'mine' });
      myPlaylists.value = data;
      lastFetchedAt = Date.now();
      return data;
    } finally {
      loading.value = false;
    }
  };

  const invalidate = () => {
    lastFetchedAt = 0;
  };

  return {
    myPlaylists,
    loading,
    refreshMine,
    invalidate,
  };
}
