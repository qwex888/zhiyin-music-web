import { musicApi } from '@/api/music';
import type { PaginatedResponse, Song, Album, Artist } from '@/types';
import {
  offlineDb,
  hasLocalLibrary,
  upsertSongs,
  upsertAlbums,
  upsertArtists,
} from './db';
import { isAppOnline } from './network';
import { getCachedSongIds } from './media-cache';

export interface ListQueryParams {
  limit?: number;
  offset?: number;
  q?: string;
  sort_by?: string;
  sort_order?: string;
  artist_id?: number;
  album_id?: number;
}

function paginate<T>(
  items: T[],
  limit: number,
  offset: number
): PaginatedResponse<T> {
  const total = items.length;
  const pageItems = items.slice(offset, offset + limit);
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  const page = Math.floor(offset / limit) + 1;
  return {
    items: pageItems,
    total,
    limit,
    offset,
    page,
    total_pages: totalPages,
    has_next: offset + limit < total,
    has_prev: offset > 0,
  };
}

function matchQuery(text: string, q: string): boolean {
  return text.toLowerCase().includes(q.toLowerCase());
}

async function querySongsLocal(
  params: ListQueryParams
): Promise<PaginatedResponse<Song>> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const cachedIds = await getCachedSongIds();

  if (cachedIds.size === 0) {
    return paginate([], limit, offset);
  }

  let items = await offlineDb.songs
    .where('id')
    .anyOf([...cachedIds])
    .toArray();

  if (params.q?.trim()) {
    const q = params.q.trim();
    items = items.filter((s) => {
      const artist = s.artist_name || s.artist || '';
      const album = s.album_name || s.album || '';
      return (
        matchQuery(s.title, q) ||
        matchQuery(artist, q) ||
        matchQuery(album, q)
      );
    });
  }

  items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  return paginate(items, limit, offset);
}

async function queryAlbumsLocal(
  params: ListQueryParams
): Promise<PaginatedResponse<Album>> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const cachedIds = await getCachedSongIds();

  if (cachedIds.size === 0) {
    return paginate([], limit, offset);
  }

  const cachedSongs = await offlineDb.songs
    .where('id')
    .anyOf([...cachedIds])
    .toArray();
  const cachedAlbumIds = new Set(
    cachedSongs.map((s) => s.album_id).filter((id): id is number => id != null)
  );

  if (cachedAlbumIds.size === 0) {
    return paginate([], limit, offset);
  }

  let items = await offlineDb.albums
    .where('id')
    .anyOf([...cachedAlbumIds])
    .toArray();

  if (params.q?.trim()) {
    const q = params.q.trim();
    items = items.filter(
      (a) =>
        matchQuery(a.name, q) ||
        matchQuery(a.artist_name || '', q)
    );
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return paginate(items, limit, offset);
}

async function queryArtistsLocal(
  params: ListQueryParams
): Promise<PaginatedResponse<Artist>> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const cachedIds = await getCachedSongIds();

  if (cachedIds.size === 0) {
    return paginate([], limit, offset);
  }

  const cachedSongs = await offlineDb.songs
    .where('id')
    .anyOf([...cachedIds])
    .toArray();
  const cachedArtistIds = new Set(
    cachedSongs.map((s) => s.artist_id).filter((id): id is number => id != null)
  );

  if (cachedArtistIds.size === 0) {
    return paginate([], limit, offset);
  }

  let items = await offlineDb.artists
    .where('id')
    .anyOf([...cachedArtistIds])
    .toArray();

  if (params.q?.trim()) {
    const q = params.q.trim();
    items = items.filter((a) => matchQuery(a.name, q));
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return paginate(items, limit, offset);
}

async function fetchWithOfflineFallback<T>(
  onlineFetch: () => Promise<{ data: PaginatedResponse<T> }>,
  localFetch: (params: ListQueryParams) => Promise<PaginatedResponse<T>>,
  upsert: (items: T[]) => Promise<void>,
  params: ListQueryParams
): Promise<PaginatedResponse<T>> {
  if (isAppOnline()) {
    try {
      const { data } = await onlineFetch();
      await upsert(data.items);
      return data;
    } catch {
      if (await hasLocalLibrary()) return localFetch(params);
      throw new Error('FETCH_FAILED');
    }
  }

  if (await hasLocalLibrary()) return localFetch(params);
  throw new Error('NO_LOCAL_LIBRARY');
}

export async function querySongs(
  params: ListQueryParams = {}
): Promise<PaginatedResponse<Song>> {
  return fetchWithOfflineFallback(
    () => musicApi.getSongs(params),
    querySongsLocal,
    upsertSongs,
    params
  );
}

export async function queryAlbums(
  params: ListQueryParams = {}
): Promise<PaginatedResponse<Album>> {
  return fetchWithOfflineFallback(
    () => musicApi.getAlbums(params),
    queryAlbumsLocal,
    upsertAlbums,
    params
  );
}

export async function queryArtists(
  params: ListQueryParams = {}
): Promise<PaginatedResponse<Artist>> {
  return fetchWithOfflineFallback(
    () => musicApi.getArtists(params),
    queryArtistsLocal,
    upsertArtists,
    params
  );
}

export async function queryArtistById(id: number): Promise<Artist | null> {
  if (isAppOnline()) {
    try {
      const { data } = await musicApi.getArtist(id);
      await upsertArtists([data]);
      return data;
    } catch {
      if (await hasLocalLibrary()) {
        return (await offlineDb.artists.get(id)) || null;
      }
      throw new Error('FETCH_FAILED');
    }
  }

  if (await hasLocalLibrary()) {
    return (await offlineDb.artists.get(id)) || null;
  }
  throw new Error('NO_LOCAL_LIBRARY');
}

export async function queryAlbumById(id: number): Promise<Album | null> {
  if (isAppOnline()) {
    try {
      const { data } = await musicApi.getAlbum(id);
      await upsertAlbums([data]);
      return data;
    } catch {
      if (await hasLocalLibrary()) {
        return (await offlineDb.albums.get(id)) || null;
      }
      throw new Error('FETCH_FAILED');
    }
  }

  if (await hasLocalLibrary()) {
    return (await offlineDb.albums.get(id)) || null;
  }
  throw new Error('NO_LOCAL_LIBRARY');
}

export async function queryBatchSongs(ids: number[]): Promise<Song[]> {
  if (ids.length === 0) return [];

  if (isAppOnline()) {
    try {
      const { data } = await musicApi.getBatchSongs(ids);
      await upsertSongs(data);
      return data;
    } catch {
      if (await hasLocalLibrary()) {
        const local = await offlineDb.songs.bulkGet(ids);
        return local.filter((s): s is Song => s !== undefined);
      }
      throw new Error('FETCH_FAILED');
    }
  }

  if (await hasLocalLibrary()) {
    const local = await offlineDb.songs.bulkGet(ids);
    return local.filter((s): s is Song => s !== undefined);
  }

  throw new Error('NO_LOCAL_LIBRARY');
}
