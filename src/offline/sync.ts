import { musicApi } from '@/api/music';
import type { PaginatedResponse } from '@/types';
import type { Song, Album, Artist } from '@/types';
import {
  offlineDb,
  upsertSongs,
  upsertAlbums,
  upsertArtists,
  setLibraryMeta,
} from './db';
import { isBrowserOnline } from './network';

const PAGE_SIZE = 500;

async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<{ data: PaginatedResponse<T> }>
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let hasNext = true;

  while (hasNext) {
    const { data } = await fetchPage(offset);
    all.push(...data.items);
    hasNext = data.has_next;
    offset += data.limit || PAGE_SIZE;
    if (data.items.length === 0) break;
  }

  return all;
}

export interface LibrarySyncResult {
  songCount: number;
  albumCount: number;
  artistCount: number;
  syncedAt: string;
}

export async function syncFullLibrary(): Promise<LibrarySyncResult> {
  if (!isBrowserOnline()) {
    throw new Error('OFFLINE');
  }

  const [songs, albums, artists] = await Promise.all([
    fetchAllPages<Song>((offset) =>
      musicApi.getSongs({ limit: PAGE_SIZE, offset })
    ),
    fetchAllPages<Album>((offset) =>
      musicApi.getAlbums({ limit: PAGE_SIZE, offset })
    ),
    fetchAllPages<Artist>((offset) =>
      musicApi.getArtists({ limit: PAGE_SIZE, offset })
    ),
  ]);

  // diff-sync: 先 bulkPut 新数据，再删除远程不存在的旧记录，避免 clear 导致数据丢失
  await offlineDb.transaction('rw', offlineDb.songs, offlineDb.albums, offlineDb.artists, async () => {
    await upsertSongs(songs);
    await upsertAlbums(albums);
    await upsertArtists(artists);

    const remoteSongIds = new Set(songs.map(s => s.id));
    const remotAlbumIds = new Set(albums.map(a => a.id));
    const remoteArtistIds = new Set(artists.map(a => a.id));

    const localSongIds = await offlineDb.songs.toCollection().primaryKeys();
    const localAlbumIds = await offlineDb.albums.toCollection().primaryKeys();
    const localArtistIds = await offlineDb.artists.toCollection().primaryKeys();

    const orphanSongs = localSongIds.filter(id => !remoteSongIds.has(id as number));
    const orphanAlbums = localAlbumIds.filter(id => !remotAlbumIds.has(id as number));
    const orphanArtists = localArtistIds.filter(id => !remoteArtistIds.has(id as number));

    if (orphanSongs.length) await offlineDb.songs.bulkDelete(orphanSongs);
    if (orphanAlbums.length) await offlineDb.albums.bulkDelete(orphanAlbums);
    if (orphanArtists.length) await offlineDb.artists.bulkDelete(orphanArtists);
  });

  const syncedAt = new Date().toISOString();
  await setLibraryMeta({
    lastSyncedAt: syncedAt,
    songCount: songs.length,
    albumCount: albums.length,
    artistCount: artists.length,
  });

  return {
    songCount: songs.length,
    albumCount: albums.length,
    artistCount: artists.length,
    syncedAt,
  };
}
