import type { Song } from '@/types';
import { ensureCachedCoverObjectUrl } from '@/offline/media-cache';

type PlayerCallbacks = {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (position: number) => void;
  getPosition: () => number;
  getDuration: () => number;
};

let callbacks: PlayerCallbacks | null = null;
let positionTimer: ReturnType<typeof setInterval> | null = null;
/** Media Session artwork 专用 blob:，切歌时 revoke */
let artworkObjectUrl: string | null = null;
/** 防止异步封面回写覆盖已切走的歌曲 */
let metadataGen = 0;

const isMediaSessionSupported = () =>
  typeof navigator !== 'undefined' && 'mediaSession' in navigator;

function revokeArtworkObjectUrl() {
  if (artworkObjectUrl) {
    URL.revokeObjectURL(artworkObjectUrl);
    artworkObjectUrl = null;
  }
}

export function attachMediaSessionHandlers(cbs: PlayerCallbacks) {
  if (!isMediaSessionSupported()) return;
  callbacks = cbs;

  const actions: Array<[MediaSessionAction, (() => void) | null]> = [
    ['play', () => callbacks?.play()],
    ['pause', () => callbacks?.pause()],
    ['previoustrack', () => callbacks?.previous()],
    ['nexttrack', () => callbacks?.next()],
    ['stop', () => callbacks?.pause()],
    ['seekbackward', () => {
      const pos = callbacks?.getPosition() ?? 0;
      callbacks?.seek(Math.max(0, pos - 10));
    }],
    ['seekforward', () => {
      const pos = callbacks?.getPosition() ?? 0;
      const dur = callbacks?.getDuration() ?? 0;
      callbacks?.seek(Math.min(dur, pos + 10));
    }],
    ['seekto', null],
  ];

  for (const [action, handler] of actions) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // 部分浏览器不支持特定 action
    }
  }

  try {
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) callbacks?.seek(details.seekTime);
    });
  } catch { /* noop */ }

  if (!positionTimer) {
    positionTimer = setInterval(updatePositionState, 1000);
  }
}

/**
 * 更新 Media Session 元数据。
 * 封面只用已缓存的 blob:（经 ensureCachedCoverObjectUrl，与 CoverImage 共享去重），
 * 禁止直接塞 /api/covers/{id}，避免系统再打一遍网络。
 */
export function updateMediaSessionMetadata(song: Song | null) {
  if (!isMediaSessionSupported()) return;

  const gen = ++metadataGen;
  revokeArtworkObjectUrl();

  if (!song) {
    navigator.mediaSession.metadata = null;
    return;
  }

  const artist = song.artist || song.artist_name || '';
  const album = song.album || song.album_name || '';
  const title = song.title || 'Unknown';

  // 先无网络封面，避免浏览器立刻请求 /api/covers
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album,
    artwork: [],
  });

  const coverId = song.cover_id;
  if (!coverId) return;

  void (async () => {
    const blobUrl = await ensureCachedCoverObjectUrl(coverId);
    if (gen !== metadataGen) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return;
    }
    if (!blobUrl) return;

    artworkObjectUrl = blobUrl;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: [
          { src: blobUrl, sizes: '512x512', type: 'image/jpeg' },
          { src: blobUrl, sizes: '256x256', type: 'image/jpeg' },
        ],
      });
    } catch {
      // 个别环境可能拒绝 blob artwork，保持无封面元数据即可
    }
  })();
}

export function setMediaSessionPlaybackState(playing: boolean) {
  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  } catch { /* noop */ }
}

export function updatePositionState() {
  if (!isMediaSessionSupported() || !callbacks) return;
  const duration = callbacks.getDuration();
  if (!duration || !isFinite(duration) || duration <= 0) return;
  const position = callbacks.getPosition();
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: 1,
      position: Math.min(position, duration),
    });
  } catch { /* noop */ }
}

export function detachMediaSession() {
  if (positionTimer) {
    clearInterval(positionTimer);
    positionTimer = null;
  }
  callbacks = null;
  metadataGen += 1;
  revokeArtworkObjectUrl();
  if (isMediaSessionSupported()) {
    navigator.mediaSession.metadata = null;
    try {
      navigator.mediaSession.playbackState = 'none';
    } catch { /* noop */ }
  }
}
