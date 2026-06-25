import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { Song } from '@/types';
import { isStrmSong } from '@/types';
import { musicApi } from '@/api/music';
import { Howl, Howler } from 'howler';
import { useToast } from '@/composables/useToast';
import { useLibraryStore } from '@/stores/library';
import i18n from '@/i18n';
import {
  getCachedAudioObjectUrl,
  hasCachedAudio,
  cacheAudioFromStreamUrl,
  cacheCoverInBackground,
  type StreamQuality,
} from '@/offline/media-cache';
import { isAppOnline } from '@/offline/network';
import { songEvents } from '@/utils/songEvents';

const swCacheNotifier = new Map<string, () => void>();
if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'audio-cached') {
      const k = `${event.data.songId}:${event.data.quality}`;
      swCacheNotifier.get(k)?.();
    }
  });
}

export const usePlayerStore = defineStore('player', () => {
  const libraryStore = useLibraryStore();
  // State
  const currentSong = ref<Song | null>(null);
  const queue = ref<Song[]>([]);
  const currentIndex = ref(-1);
  const isPlaying = ref(false);
  const isBuffering = ref(false);
  const volume = ref(1.0);
  const playMode = ref<'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle'>('sequence');
  const quality = ref<'low' | 'medium' | 'high' | 'lossless' | 'original'>('original');
  const progress = ref(0);
  const duration = ref(0);
  
  // 随机播放相关状态
  const shuffleHistory = ref<number[]>([]); // 随机播放历史记录（索引）
  const shuffleRemaining = ref<number[]>([]); // 剩余未播放的歌曲索引
  
  let sound: Howl | null = null;
  let soundGeneration = 0;
  let skipThrottleUntil = 0;
  const SKIP_THROTTLE_MS = 300;
  const STRM_MAX_RETRIES = 3;
  const STRM_RETRY_DELAYS = [2000, 4000, 8000];
  let strmRetryCount = 0;
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  let activeObjectUrl: string | null = null;
  const toast = useToast();
  const cachingInProgress = new Set<string>();

  const revokeObjectUrl = () => {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  };
  async function bgCache(songId: number, quality: StreamQuality): Promise<void> {
    const key = `${songId}:${quality}`;
    if (cachingInProgress.has(key)) return;
    cachingInProgress.add(key);

    try {
      const ac = new AbortController();

      const unwatch = watch(currentSong, () => {
        if (currentSong.value?.id !== songId) ac.abort();
      });
      const onVis = () => { if (document.hidden) ac.abort(); };
      document.addEventListener('visibilitychange', onVis);

      try {
        const cachedBySw = await Promise.race([
          new Promise<boolean>(resolve => {
            swCacheNotifier.set(key, () => resolve(true));
          }),
          new Promise<boolean>(resolve => {
            setTimeout(() => resolve(false), 180_000);
          }),
          new Promise<boolean>((_, reject) => {
            ac.signal.addEventListener('abort', () => reject(new DOMException('cancelled')));
          }),
        ]);

        if (cachedBySw) return;
        if (await hasCachedAudio(songId, quality)) return;

        if (currentSong.value?.id !== songId) return;
        const { data } = await musicApi.getStreamToken(songId, quality);
        const url = musicApi.buildStreamUrl(songId, quality, data.stream_token);
        await cacheAudioFromStreamUrl(url, songId, quality);
      } finally {
        swCacheNotifier.delete(key);
        unwatch();
        document.removeEventListener('visibilitychange', onVis);
      }
    } catch { /* cancelled or error, silently skip */ }
    finally { cachingInProgress.delete(key); }
  }

  const destroySound = () => {
    if (sound) {
      sound.unload();
      sound = null;
    }
    stopProgressTimer();
  };

  const initSound = async (song: Song, resetProgress = true): Promise<number> => {
    const gen = ++soundGeneration;

    destroySound();
    revokeObjectUrl();
    isBuffering.value = true;

    if (resetProgress) {
      progress.value = 0;
      duration.value = 0;
    }

    let src: string;
    const q = (isStrmSong(song) ? 'original' : quality.value) as StreamQuality;
    const cachedUrl = await getCachedAudioObjectUrl(song.id, q);

    if (gen !== soundGeneration) return gen;

    if (cachedUrl) {
      src = cachedUrl;
      activeObjectUrl = cachedUrl;
    } else if (isAppOnline()) {
      try {
        const { data } = await musicApi.getStreamToken(song.id, q);
        if (gen !== soundGeneration) return gen;
        src = musicApi.buildStreamUrl(song.id, q, data.stream_token);
        if (song.cover_id) cacheCoverInBackground(song.cover_id);
      } catch (err: any) {
        if (gen !== soundGeneration) return gen;
        isBuffering.value = false;
        isPlaying.value = false;
        if (err?.response?.status !== 401) {
          toast.error(i18n.global.t('offline.play_token_failed'));
        }
        return gen;
      }
    } else {
      toast.error(i18n.global.t('offline.play_not_cached'));
      isBuffering.value = false;
      isPlaying.value = false;
      return gen;
    }

    if (gen !== soundGeneration) return gen;

    const needsCache = !activeObjectUrl;
    const cacheTargetId = song.id;
    const cacheTargetQuality = q;

    sound = new Howl({
      src: [src],
      html5: true,
      format: ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'opus', 'webm', 'weba', 'mp4'],
      volume: volume.value,
      onload: () => {
        if (gen !== soundGeneration) return;
        duration.value = sound?.duration() || 0;
        // STRM 歌曲存在缺失音频属性时，上报浏览器能获取到的数据，后端会异步 ffprobe 补全其余字段
        if (isStrmSong(song) && duration.value > 0 && isFinite(duration.value)) {
          const hasMissing = !song.duration_secs
            || song.bitrate == null
            || song.sample_rate == null
            || song.channels == null
            || song.bit_depth == null
            || !song?.codec
            || song.codec == null;
          if (hasMissing) {
            musicApi.reportMetadata(song.id, { duration_secs: duration.value }).catch(() => {});
          }
        }
      },
      onplay: () => {
        if (gen !== soundGeneration) return;
        isBuffering.value = false;
        isPlaying.value = true;
        strmRetryCount = 0;
        startProgressTimer();
        if (needsCache) {
          void bgCache(cacheTargetId, cacheTargetQuality);
        }
        // 监听 HTML5 audio 的 waiting/playing 事件以检测播放中缓冲
        try {
          const node = (sound as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
          if (node) {
            node.onwaiting = () => { if (gen === soundGeneration) isBuffering.value = true; };
            node.onplaying = () => { if (gen === soundGeneration) isBuffering.value = false; };
          }
        } catch { /* ignore */ }
      },
      onpause: () => {
        if (gen !== soundGeneration) return;
        isBuffering.value = false;
        isPlaying.value = false;
        stopProgressTimer();
      },
      onend: () => {
        if (gen !== soundGeneration) return;
        isBuffering.value = false;
        isPlaying.value = false;
        stopProgressTimer();
        next();
      },
      onloaderror: () => {
        if (gen !== soundGeneration) return;
        if (isStrmSong(song) && progress.value > 0) {
          destroySound();
          isBuffering.value = false;
          isPlaying.value = false;
          stopProgressTimer();
          next();
          return;
        }
        if (isStrmSong(song) && strmRetryCount < STRM_MAX_RETRIES) {
          const delay = STRM_RETRY_DELAYS[strmRetryCount] ?? 8000;
          strmRetryCount++;
          toast.info(i18n.global.t('player.strm_retrying', { attempt: strmRetryCount, max: STRM_MAX_RETRIES }));
          destroySound();
          setTimeout(() => {
            if (gen !== soundGeneration) return;
            progress.value = 0;
            initSound(song, true).then((g) => {
              if (g === soundGeneration && sound) sound.play();
            });
          }, delay);
          return;
        }
        destroySound();
        isBuffering.value = false;
        isPlaying.value = false;
        strmRetryCount = 0;
        const msg = isStrmSong(song)
          ? i18n.global.t('player.error_strm_unavailable')
          : i18n.global.t('player.error_local_not_found');
        toast.error(msg);
      },
      onplayerror: () => {
        if (gen !== soundGeneration) return;
        if (isStrmSong(song) && progress.value > 0) {
          destroySound();
          isBuffering.value = false;
          isPlaying.value = false;
          stopProgressTimer();
          next();
          return;
        }
        if (isStrmSong(song) && strmRetryCount < STRM_MAX_RETRIES) {
          const delay = STRM_RETRY_DELAYS[strmRetryCount] ?? 8000;
          strmRetryCount++;
          toast.info(i18n.global.t('player.strm_retrying', { attempt: strmRetryCount, max: STRM_MAX_RETRIES }));
          destroySound();
          setTimeout(() => {
            if (gen !== soundGeneration) return;
            progress.value = 0;
            initSound(song, true).then((g) => {
              if (g === soundGeneration && sound) sound.play();
            });
          }, delay);
          return;
        }
        destroySound();
        isBuffering.value = false;
        isPlaying.value = false;
        strmRetryCount = 0;
        const msg = isStrmSong(song)
          ? i18n.global.t('player.error_strm_unavailable')
          : i18n.global.t('player.error_local_not_found');
        toast.error(msg);
      },
      onseek: () => {}
    });

    return gen;
  };

  const play = async (song?: Song) => {
    strmRetryCount = 0;

    if (song) {
      const needsInit = currentSong.value?.id !== song.id || !sound;
      if (needsInit) {
        const enrichedSong = { ...song };
        if (!enrichedSong.artist) {
          if (enrichedSong.artist_name) {
            enrichedSong.artist = enrichedSong.artist_name;
          } else {
            const artistName = libraryStore.getArtistName(song.artist_id);
            if (artistName) enrichedSong.artist = artistName;
          }
        }
        currentSong.value = enrichedSong;

        if (!queue.value.find(s => s.id === song.id)) addToQueue(song);
        currentIndex.value = queue.value.findIndex(s => s.id === song.id);

        const genBefore = soundGeneration;
        await initSound(song);
        if (soundGeneration !== genBefore + 1) return;
      }
    } else if (currentSong.value && !sound) {
      const isStrm = isStrmSong(currentSong.value);
      // STRM 歌曲从持久化恢复时从头播放，避免远程流 seek 失败
      const resetProg = isStrm;
      const savedProgress = isStrm ? 0 : progress.value;

      const genBefore = soundGeneration;
      await initSound(currentSong.value, resetProg);
      if (soundGeneration !== genBefore + 1) return;
      if (sound && savedProgress > 0) {
        (sound as Howl).seek(savedProgress);
      }
    }

    if (sound) sound.play();
  };

  const pause = () => {
    sound?.pause();
    // Force update state if sound is not initialized (e.g. after refresh)
    if (!sound) {
      isPlaying.value = false;
    }
  };

  const togglePlay = () => {
    if (isBuffering.value) return;
    if (isPlaying.value) {
      pause();
    } else {
      play();
    }
  };

  // 初始化随机播放池
  const initShufflePool = () => {
    shuffleRemaining.value = Array.from({ length: queue.value.length }, (_, i) => i);
    // 移除当前正在播放的歌曲
    if (currentIndex.value >= 0) {
      const idx = shuffleRemaining.value.indexOf(currentIndex.value);
      if (idx > -1) {
        shuffleRemaining.value.splice(idx, 1);
      }
    }
  };

  // 获取下一首随机歌曲的索引
  const getNextShuffleIndex = (): number => {
    // 如果剩余池为空，重新初始化（排除当前歌曲）
    if (shuffleRemaining.value.length === 0) {
      initShufflePool();
    }
    
    // 如果还是空（只有一首歌的情况），返回当前索引
    if (shuffleRemaining.value.length === 0) {
      return currentIndex.value;
    }
    
    // 从剩余池中随机选择
    const randomIdx = Math.floor(Math.random() * shuffleRemaining.value.length);
    const nextIndex = shuffleRemaining.value[randomIdx];
    
    // 从剩余池中移除
    shuffleRemaining.value.splice(randomIdx, 1);
    
    return nextIndex;
  };

  const replayCurrentSong = () => {
    if (sound) {
      sound.seek(0);
      progress.value = 0;
      sound.play();
    }
  };

  const stopPlayback = () => {
    ++soundGeneration;
    destroySound();
    progress.value = 0;
    isPlaying.value = false;
  };

  const next = () => {
    if (queue.value.length === 0) return;
    const now = Date.now();
    if (now < skipThrottleUntil) return;
    skipThrottleUntil = now + SKIP_THROTTLE_MS;
    
    let nextIndex = currentIndex.value + 1;
    
    if (playMode.value === 'shuffle') {
      nextIndex = getNextShuffleIndex();
      if (currentIndex.value >= 0) {
        shuffleHistory.value.push(currentIndex.value);
        if (shuffleHistory.value.length > 50) {
          shuffleHistory.value.shift();
        }
      }
    } else if (playMode.value === 'repeat-one') {
      nextIndex = currentIndex.value;
    } else if (playMode.value === 'repeat-all') {
      if (nextIndex >= queue.value.length) {
        nextIndex = 0;
      }
    } else {
      // 顺序播放：播放完最后一首后停止
      if (nextIndex >= queue.value.length) {
        stopPlayback();
        return;
      }
    }
    
    if (nextIndex === currentIndex.value) {
      replayCurrentSong();
      return;
    }
    
    currentIndex.value = nextIndex;
    play(queue.value[nextIndex]);
  };

  const prev = () => {
    if (queue.value.length === 0) return;
    const now = Date.now();
    if (now < skipThrottleUntil) return;
    skipThrottleUntil = now + SKIP_THROTTLE_MS;
    
    let prevIndex = currentIndex.value - 1;
    
    if (playMode.value === 'shuffle') {
      if (shuffleHistory.value.length > 0) {
        prevIndex = shuffleHistory.value.pop()!;
        if (currentIndex.value >= 0 && !shuffleRemaining.value.includes(currentIndex.value)) {
          shuffleRemaining.value.push(currentIndex.value);
        }
      } else {
        prevIndex = getNextShuffleIndex();
      }
    } else {
      if (prevIndex < 0) prevIndex = queue.value.length - 1;
    }
    
    if (prevIndex === currentIndex.value) {
      replayCurrentSong();
      return;
    }
    
    currentIndex.value = prevIndex;
    play(queue.value[prevIndex]);
  };

  const seek = (time: number) => {
    sound?.seek(time);
    progress.value = time;
  };

  const setVolume = (vol: number) => {
    volume.value = vol;
    Howler.volume(vol);
  };

  const addToQueue = (song: Song) => {
    queue.value.push(song);
  };

  const setQueue = (songs: Song[]) => {
    queue.value = [...songs];
    currentIndex.value = 0;
    // 初始化随机播放池
    if (playMode.value === 'shuffle') {
      initShufflePool();
    }
  };
  
  // 监听播放模式变化
  watch(playMode, (newMode, oldMode) => {
    if (newMode === 'shuffle') {
      // 切换到随机模式时，初始化随机播放池
      shuffleHistory.value = [];
      initShufflePool();
    } else if (oldMode === 'shuffle') {
      // 离开随机模式时，清空历史和剩余池
      shuffleHistory.value = [];
      shuffleRemaining.value = [];
    }
  });
  
  // 监听队列变化
  watch(queue, () => {
    if (playMode.value === 'shuffle') {
      // 队列改变时，重新初始化随机播放池
      initShufflePool();
    }
  });
  
  const startProgressTimer = () => {
    stopProgressTimer();
    progressInterval = setInterval(() => {
      if (sound && isPlaying.value) {
        progress.value = sound.seek() as number;
      }
    }, 250);
  };
  
  const stopProgressTimer = () => {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  };

  const refreshSong = async (songId: number) => {
    try {
      const { data: updated } = await musicApi.getSong(songId);
      const idx = queue.value.findIndex(s => s.id === songId);
      if (idx >= 0) {
        queue.value[idx] = { ...queue.value[idx], ...updated };
      }
      if (currentSong.value?.id === songId) {
        currentSong.value = { ...currentSong.value, ...updated };
      }
    } catch { /* 静默处理 */ }
  };

  const refreshSongs = async (songIds: number[]) => {
    if (songIds.length === 0) return;
    const relevant = songIds.filter(id =>
      currentSong.value?.id === id || queue.value.some(s => s.id === id)
    );
    if (relevant.length === 0) return;
    try {
      const { data: songs } = await musicApi.getBatchSongs(relevant);
      for (const updated of songs) {
        const idx = queue.value.findIndex(s => s.id === updated.id);
        if (idx >= 0) {
          queue.value[idx] = { ...queue.value[idx], ...updated };
        }
        if (currentSong.value?.id === updated.id) {
          currentSong.value = { ...currentSong.value, ...updated };
        }
      }
    } catch { /* 静默处理 */ }
  };

  songEvents.onSongUpdated((ids) => refreshSongs(ids));

  const clearQueue = () => {
    ++soundGeneration;
    destroySound();
    revokeObjectUrl();
    currentSong.value = null;
    queue.value = [];
    currentIndex.value = -1;
    isBuffering.value = false;
    isPlaying.value = false;
    progress.value = 0;
    duration.value = 0;
  };

  return {
    currentSong,
    queue,
    currentIndex,
    isPlaying,
    isBuffering,
    volume,
    playMode,
    quality,
    progress,
    duration,
    play,
    pause,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    addToQueue,
    setQueue,
    clearQueue,
    refreshSong,
    refreshSongs
  };
}, {
  persist: {
    paths: ['currentSong', 'queue', 'currentIndex', 'volume', 'playMode', 'quality', 'progress', 'duration'],
    afterRestore: (ctx: any) => {
      ctx.store.isPlaying = false;
      ctx.store.isBuffering = false;
    }
  } as any
});
