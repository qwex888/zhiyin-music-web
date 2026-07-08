import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Song, Album, Artist } from '@/types';
import { offlineDb, hasLocalLibrary } from '@/offline/db';
import { querySongs, queryAlbums, queryArtists } from '@/offline/library-query';

export const useLibraryStore = defineStore('library', () => {
  const songs = ref<Song[]>([]);
  const albums = ref<Album[]>([]);
  const artists = ref<Artist[]>([]);
  const totalSongs = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // O(1) 查找 Map，响应式自动跟随 artists/albums 变化
  const artistNameMap = computed(() => new Map(artists.value.map(a => [a.id, a.name])));
  const albumNameMap = computed(() => new Map(albums.value.map(a => [a.id, a.name])));

  const hydrateLocalMetadata = async () => {
    if (!(await hasLocalLibrary())) return;
    artists.value = await offlineDb.artists.toArray();
    albums.value = await offlineDb.albums.toArray();
    totalSongs.value = await offlineDb.songs.count();
  };

  const fetchSongs = async (params: { limit?: number; offset?: number } = {}) => {
    loading.value = true;
    try {
      const data = await querySongs(params);
      songs.value = data.items;
      totalSongs.value = data.total;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'error';
    } finally {
      loading.value = false;
    }
  };

  const fetchAlbums = async (params: { limit?: number; offset?: number } = {}) => {
    loading.value = true;
    try {
      const data = await queryAlbums(params);
      albums.value = data.items;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'error';
    } finally {
      loading.value = false;
    }
  };
  
  const fetchArtists = async (params: { limit?: number; offset?: number } = {}) => {
    loading.value = true;
    try {
      const data = await queryArtists(params);
      artists.value = data.items;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : 'error';
    } finally {
      loading.value = false;
    }
  };

  const getArtistName = (id: number) => {
    return artistNameMap.value.get(id);
  };

  const getAlbumName = (id: number) => {
    return albumNameMap.value.get(id);
  };

  return {
    songs,
    albums,
    artists,
    totalSongs,
    loading,
    error,
    fetchSongs,
    fetchAlbums,
    fetchArtists,
    hydrateLocalMetadata,
    getArtistName,
    getAlbumName
  };
});
