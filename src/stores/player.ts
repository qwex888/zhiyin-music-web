import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { Song } from '@/types';
import { isStrmSong } from '@/types';
import { musicApi } from '@/api/music';
import { Howl, Howler } from 'howler';
import { useToast } from '@/composables/useToast';
import { useLibraryStore } from '@/stores/library';
import { useQueueManager } from '@/composables/useQueueManager';
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
import {
  attachMediaSessionHandlers,
  updateMediaSessionMetadata,
  setMediaSessionPlaybackState,
  updatePositionState,
} from '@/composables/useMediaSession';

type SparseFillResult = 'done' | 'cancelled' | 'need_token' | 'error';

const sparseFillWaiters = new Map<string, (result: SparseFillResult) => void>();
/** 完整缓存就绪后热切 blob（由 store 挂载） */
let audioCachedHandler: ((songId: number, quality: StreamQuality) => void) | null = null;

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'audio-cached') {
      const songId = Number(event.data.songId);
      const q = (event.data.quality || 'original') as StreamQuality;
      audioCachedHandler?.(songId, q);
    }
    if (event.data?.type === 'sparse-fill-result') {
      const songId = Number(event.data.songId);
      const q = (event.data.quality || 'original') as string;
      const k = `${songId}:${q}`;
      const result = event.data.result as SparseFillResult;
      sparseFillWaiters.get(k)?.(result);
    }
  });
}

export const usePlayerStore = defineStore('player', () => {
  const libraryStore = useLibraryStore();
  // State
  const currentSong = ref<Song | null>(null);
  const currentIndex = ref(-1);
  const isPlaying = ref(false);
  const isBuffering = ref(false);
  const volume = ref(1.0);
  const playMode = ref<'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle'>('sequence');
  const quality = ref<'low' | 'medium' | 'high' | 'lossless' | 'original'>('original');
  const progress = ref(0);
  const duration = ref(0);
  const playingFromCache = ref(false);
  const canSeek = computed(() => !isStrmSong(currentSong.value) || playingFromCache.value);

  // 队列管理委托给 useQueueManager
  const {
    queue,
    addToQueue,
    setQueue,
    resolveNextIndex,
    resolvePrevIndex,
  } = useQueueManager(playMode, currentIndex);
  
  let sound: Howl | null = null;
  let soundGeneration = 0;
  let skipThrottleUntil = 0;
  const SKIP_THROTTLE_MS = 300;
  const STRM_MAX_RETRIES = 3;
  const STRM_RETRY_DELAYS = [2000, 4000, 8000];
  /** 在 token 过期前提前续签的秒数，给弱网续签请求留余量 */
  const TOKEN_RENEW_AHEAD_SECS = 30;
  const TOKEN_RENEW_MAX_ATTEMPTS = 3;
  let strmRetryCount = 0;
  let tokenRenewAttempts = 0;
  let tokenRenewTimer: ReturnType<typeof setTimeout> | null = null;
  let tokenRenewInProgress = false;
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  let activeObjectUrl: string | null = null;
  type PauseSource = 'user' | 'system';
  let pendingPauseSource: PauseSource | null = null;
  let wasUnexpectedlyPaused = false;
  let listenersAttachedForGen = -1;
  let playLock = false;
  let hotSwapInProgress = false;
  /** 预热中的 blob Howl（未提交前不影响正在播放的 sound） */
  let warmupHowl: Howl | null = null;
  let warmupObjectUrl: string | null = null;
  // ─────────────────────────────────────────────────────────────
  // 【热切时序调优区】以下常量集中控制「缓存完成 → 切到 blob」的时序与间隔。
  // 手动调优时只改这里即可，数值越小越激进（越快切、但越容易 underrun/错位）。
  // ─────────────────────────────────────────────────────────────
  /** 仅当新流与旧流偏差超过此值才二次对齐；调小=对齐更精准但可能多一次 seek。默认 0.12s */
  const HOT_SWAP_RESYNC_THRESHOLD_SEC = 0.12;
  /** 交接前要求 buffered 至少超前这么多秒，避免「playing 但马上 underrun」。调小=切得更快但更易卡顿。默认 0.4s */
  const HOT_SWAP_BUFFER_AHEAD_SEC = 0.7;
  /** 新流起始位置相对旧流的「提前量」，补偿 play/seek 启动延迟；听到轻微重复则调大，听到跳过则调小。默认 0.12s */
  const HOT_SWAP_START_LEAD_SEC = 0.12;
  /** 等待新流目标位置缓冲就绪的超时；超时即放弃热切保旧流。默认 12s */
  const HOT_SWAP_BUFFER_TIMEOUT_MS = 12_000;
  /** 等待新流 play() 后真正出声的超时。默认 4s */
  const HOT_SWAP_PLAYING_TIMEOUT_MS = 4_000;
  /** 等待新流 currentTime 确实在推进的超时（确认没有卡在 seek）。默认 2.5s */
  const HOT_SWAP_ADVANCE_TIMEOUT_MS = 2_500;
  // 在 initSound 之后赋值，供 bgCache / SW 消息调用
  let tryHotSwapToBlob: (songId: number, q: StreamQuality) => Promise<void> = async () => {};

  const consumePauseIntent = (): PauseSource | null => {
    const source = pendingPauseSource;
    pendingPauseSource = null;
    return source;
  };
  const toast = useToast();
  const cachingInProgress = new Set<string>();

  const revokeObjectUrl = () => {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  };

  const cancelWarmupHowl = () => {
    if (warmupHowl) {
      try { warmupHowl.unload(); } catch { /* ignore */ }
      warmupHowl = null;
    }
    if (warmupObjectUrl) {
      URL.revokeObjectURL(warmupObjectUrl);
      warmupObjectUrl = null;
    }
  };

  const clearTokenRenewTimer = () => {
    if (tokenRenewTimer) {
      clearTimeout(tokenRenewTimer);
      tokenRenewTimer = null;
    }
  };

  /**
   * 根据 expires_in 安排提前续签，避免临近过期才请求导致弱网续签失败。
   */
  const scheduleTokenRenew = (expiresInSec: number, song: Song) => {
    clearTokenRenewTimer();
    if (playingFromCache.value || activeObjectUrl) return;
    if (!expiresInSec || expiresInSec <= 0) return;

    const ahead = Math.min(TOKEN_RENEW_AHEAD_SECS, Math.max(15, Math.floor(expiresInSec * 0.2)));
    const delayMs = Math.max(5_000, (expiresInSec - ahead) * 1000);
    const songId = song.id;

    tokenRenewTimer = setTimeout(() => {
      if (currentSong.value?.id !== songId) return;
      if (playingFromCache.value || activeObjectUrl) return;
      void renewStreamAndRebuild(song, 'proactive');
    }, delayMs);
  };

  /**
   * 换新 stoken 并重建 Howl，保留进度（提前续签 / 401 恢复共用）。
   */
  const renewStreamAndRebuild = async (
    song: Song,
    reason: 'proactive' | 'error',
  ): Promise<boolean> => {
    if (tokenRenewInProgress || hotSwapInProgress) return false;
    if (playingFromCache.value || activeObjectUrl) return false;
    if (currentSong.value?.id !== song.id) return false;
    if (!isAppOnline()) return false;

    if (reason === 'error' && tokenRenewAttempts >= TOKEN_RENEW_MAX_ATTEMPTS) {
      return false;
    }

    tokenRenewInProgress = true;
    if (reason === 'error') tokenRenewAttempts++;

    try {
      let resumeAt = progress.value;
      try {
        const s = sound?.seek();
        if (typeof s === 'number' && isFinite(s) && s >= 0) resumeAt = s;
      } catch { /* keep progress.value */ }
      const wasPlaying = isPlaying.value || reason === 'error';

      pendingPauseSource = 'system';
      clearTokenRenewTimer();
      const gen = await initSound(song, false);
      if (gen !== soundGeneration || !sound || currentSong.value?.id !== song.id) return false;

      // 已热切到 blob，无需再播 stream
      if (activeObjectUrl) {
        tokenRenewAttempts = 0;
        const loaded = await waitForHowlLoad(sound, gen);
        if (!loaded || gen !== soundGeneration || !sound) return false;
        const maxDur = duration.value > 0 ? duration.value : resumeAt;
        const clamped = Math.max(0, Math.min(resumeAt, maxDur));
        if (clamped > 0) {
          pendingPauseSource = 'system';
          sound.seek(clamped);
          progress.value = clamped;
        }
        if (wasPlaying) {
          try { sound.play(); } catch { /* ignore */ }
        }
        return true;
      }

      const loaded = await waitForHowlLoad(sound, gen);
      if (!loaded || gen !== soundGeneration || !sound) return false;

      const maxDur = duration.value > 0 ? duration.value : resumeAt;
      const clamped = Math.max(0, Math.min(resumeAt, maxDur));
      if (clamped > 0) {
        pendingPauseSource = 'system';
        sound.seek(clamped);
        progress.value = clamped;
      }

      if (wasPlaying) {
        try {
          sound.play();
        } catch {
          isPlaying.value = false;
          isBuffering.value = false;
        }
      } else {
        isPlaying.value = false;
        isBuffering.value = false;
        setMediaSessionPlaybackState(false);
      }

      if (reason === 'error') {
        console.warn('[Player] stream token 续签恢复', { songId: song.id, resumeAt: clamped });
      }
      return true;
    } catch (err) {
      console.warn('[Player] stream token 续签失败', err);
      return false;
    } finally {
      tokenRenewInProgress = false;
    }
  };

  /** onloaderror / onplayerror / audio error：优先尝试续签重建 */
  const tryRecoverFromStreamError = (song: Song, gen: number): boolean => {
    if (gen !== soundGeneration) return false;
    if (playingFromCache.value || activeObjectUrl) return false;
    if (tokenRenewAttempts >= TOKEN_RENEW_MAX_ATTEMPTS) return false;
    if (hotSwapInProgress || tokenRenewInProgress) return false;
    void renewStreamAndRebuild(song, 'error');
    return true;
  };

  async function bgCache(songId: number, quality: StreamQuality): Promise<void> {
    const key = `${songId}:${quality}`;
    if (cachingInProgress.has(key)) return;
    cachingInProgress.add(key);

    try {
      if (await hasCachedAudio(songId, quality)) {
        void tryHotSwapToBlob(songId, quality);
        return;
      }

      const ac = new AbortController();
      const unwatch = watch(currentSong, () => {
        if (currentSong.value?.id !== songId) ac.abort();
      });

      // 路径 B（STRM）：eager pump 负责整文件 Cache，只等待 audio-cached，勿 fill-audio-gaps
      const isStrm = isStrmSong(currentSong.value) && currentSong.value?.id === songId;
      if (isStrm) {
        try {
          while (!ac.signal.aborted) {
            if (await hasCachedAudio(songId, quality)) {
              void tryHotSwapToBlob(songId, quality);
              return;
            }
            await new Promise((r) => setTimeout(r, 500));
          }
        } finally {
          unwatch();
        }
        return;
      }

      const waitFillResult = () => new Promise<SparseFillResult>((resolve, reject) => {
        const onAbort = () => {
          sparseFillWaiters.delete(key);
          cancelSwDownload(songId, quality);
          reject(new DOMException('cancelled'));
        };
        if (ac.signal.aborted) {
          onAbort();
          return;
        }
        sparseFillWaiters.set(key, (result) => {
          ac.signal.removeEventListener('abort', onAbort);
          resolve(result);
        });
        ac.signal.addEventListener('abort', onAbort, { once: true });
      });

      try {
        // 路径 A：最多续 token 几次，覆盖大文件闲时补洞超过 TTL 的情况
        for (let attempt = 0; attempt < 8; attempt++) {
          if (ac.signal.aborted || currentSong.value?.id !== songId) return;
          if (await hasCachedAudio(songId, quality)) {
            void tryHotSwapToBlob(songId, quality);
            return;
          }

          const { data } = await musicApi.getStreamToken(songId, quality);
          const url = musicApi.buildStreamUrl(songId, quality, data.stream_token);

          if (!navigator.serviceWorker?.controller) {
            await cacheAudioFromStreamUrl(url, songId, quality, ac.signal);
            if (!ac.signal.aborted && await hasCachedAudio(songId, quality)) {
              void tryHotSwapToBlob(songId, quality);
            }
            return;
          }

          const resultPromise = waitFillResult();
          navigator.serviceWorker.controller.postMessage({
            type: 'fill-audio-gaps',
            songId,
            quality,
            url,
          });

          const result = await resultPromise;
          sparseFillWaiters.delete(key);

          if (result === 'done') {
            void tryHotSwapToBlob(songId, quality);
            return;
          }
          if (result === 'need_token') continue;
          if (result === 'error' && attempt < 7) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          return;
        }
      } finally {
        sparseFillWaiters.delete(key);
        unwatch();
      }
    } catch { /* cancelled or error, silently skip */ }
    finally { cachingInProgress.delete(key); }
  }

  let visibilityHandler: (() => void) | null = null;

  const cancelSwDownload = (songId: number, songQuality: StreamQuality) => {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'cancel-audio-download',
        songId,
        quality: songQuality,
      });
    }
  };

  const destroySound = () => {
    clearTokenRenewTimer();
    cancelWarmupHowl();
    if (sound) {
      sound.unload();
      sound = null;
    }
    listenersAttachedForGen = -1;
    stopProgressTimer();
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  };

  const ensureAudioNodeListeners = (song: Song, gen: number) => {
    if (listenersAttachedForGen === gen) return;
    listenersAttachedForGen = gen;

    try {
      const node = (sound as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
      if (!node) return;

      node.onwaiting = () => { if (gen === soundGeneration) isBuffering.value = true; };
      node.onplaying = () => {
        if (gen !== soundGeneration) return;
        isBuffering.value = false;
        if (!isPlaying.value) {
          console.log('[Player] 浏览器自动恢复播放，同步状态');
          isPlaying.value = true;
          wasUnexpectedlyPaused = false;
          setMediaSessionPlaybackState(true);
          startProgressTimer();
        }
      };

      node.addEventListener('pause', () => {
        if (gen !== soundGeneration) return;
        const pauseSource = consumePauseIntent();
        if (pauseSource) {
          console.log('[Player] 预期暂停 (audio node)', { source: pauseSource });
          return;
        }
        if (isPlaying.value) {
          console.warn('[Player] 意外暂停 (audio node)', { reason: 'device_disconnect_or_system_interrupt' });
          wasUnexpectedlyPaused = true;
          isPlaying.value = false;
          isBuffering.value = false;
          stopProgressTimer();
        }
      });

      // 播放中途 stream 失败（常见于 stoken 过期后的 Range）：尝试续签重建
      node.addEventListener('error', () => {
        if (gen !== soundGeneration) return;
        if (tryRecoverFromStreamError(song, gen)) return;
      });

      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
      visibilityHandler = () => {
        if (!document.hidden && gen === soundGeneration && sound) {
          const audioNode = (sound as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
          if (audioNode?.paused && isPlaying.value) {
            console.warn('[Player] visibilitychange: 检测到音频已暂停，同步状态');
            isPlaying.value = false;
            stopProgressTimer();
          }
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    } catch { /* ignore */ }
  };

  const HOWL_FORMATS = ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'opus', 'webm', 'weba', 'mp4'];

  /**
   * 给已存在的 Howl 挂上生命周期（热切提交后用；initSound 仍走构造参数）。
   * blob 热切实例在预热阶段无这些回调，提交后必须补绑。
   */
  const bindHowlLifecycle = (
    h: Howl,
    song: Song,
    gen: number,
    needsCache: boolean,
    cacheTargetId: number,
    cacheTargetQuality: StreamQuality,
  ) => {
    h.on('load', () => {
      if (gen !== soundGeneration) return;
      duration.value = h.duration() || 0;
      if (isStrmSong(song) && duration.value > 0 && isFinite(duration.value)) {
        const hasMissing = !song.duration_secs
          || song.bitrate == null
          || song.sample_rate == null
          || song.channels == null
          || song.bit_depth == null
          || !song?.codec
          || song.codec == null;
        if (hasMissing) {
          musicApi.reportMetadata(song.id, { duration_secs: duration.value }).then(() => {
            songEvents.emitSongUpdated([song.id]);
            setTimeout(() => songEvents.emitSongUpdated([song.id]), 5000);
          }).catch(() => {});
        }
      }
    });
    h.on('play', () => {
      if (gen !== soundGeneration) return;
      isBuffering.value = false;
      isPlaying.value = true;
      strmRetryCount = 0;
      tokenRenewAttempts = 0;
      setMediaSessionPlaybackState(true);
      updateMediaSessionMetadata(song);
      startProgressTimer();
      if (needsCache) {
        void bgCache(cacheTargetId, cacheTargetQuality);
      }
      ensureAudioNodeListeners(song, gen);
    });
    h.on('pause', () => {
      if (gen !== soundGeneration) return;
      if (pendingPauseSource) return;
      isBuffering.value = false;
      isPlaying.value = false;
      setMediaSessionPlaybackState(false);
      stopProgressTimer();
    });
    h.on('end', () => {
      if (gen !== soundGeneration) return;
      isBuffering.value = false;
      isPlaying.value = false;
      stopProgressTimer();
      next();
    });
    // 已是完整 blob：不再走 stream 续签 / STRM 重试
    h.on('loaderror', () => {
      if (gen !== soundGeneration) return;
      console.warn('[Player] blob howl loaderror after hot-swap', { songId: song.id });
    });
    h.on('playerror', () => {
      if (gen !== soundGeneration) return;
      console.warn('[Player] blob howl playerror after hot-swap', { songId: song.id });
    });
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
      playingFromCache.value = true;
      clearTokenRenewTimer();
      tokenRenewAttempts = 0;
    } else if (isAppOnline()) {
      try {
        const { data } = await musicApi.getStreamToken(song.id, q);
        if (gen !== soundGeneration) return gen;
        src = musicApi.buildStreamUrl(song.id, q, data.stream_token, {
          progressive: isStrmSong(song),
        });
        playingFromCache.value = false;
        scheduleTokenRenew(data.expires_in ?? 300, song);
        if (song.cover_id) cacheCoverInBackground(song.cover_id);
      } catch (err: any) {
        if (gen !== soundGeneration) return gen;
        isBuffering.value = false;
        isPlaying.value = false;
        clearTokenRenewTimer();
        if (err?.response?.status !== 401) {
          toast.error(i18n.global.t('offline.play_token_failed'));
        }
        return gen;
      }
    } else {
      toast.error(i18n.global.t('offline.play_not_cached'));
      isBuffering.value = false;
      isPlaying.value = false;
      clearTokenRenewTimer();
      return gen;
    }

    if (gen !== soundGeneration) return gen;

    const needsCache = !activeObjectUrl;
    const cacheTargetId = song.id;
    const cacheTargetQuality = q;

    sound = new Howl({
      src: [src],
      html5: true,
      format: [...HOWL_FORMATS],
      volume: volume.value,
      onload: () => {
        console.log('[Player] onload', {
          songId: song?.id,
          progress: progress.value,
          isStrm: isStrmSong(song),
          strmRetryCount: strmRetryCount,
          STRM_MAX_RETRIES: STRM_MAX_RETRIES,
          STRM_RETRY_DELAYS: STRM_RETRY_DELAYS,
        });
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
            musicApi.reportMetadata(song.id, { duration_secs: duration.value }).then(() => {
              songEvents.emitSongUpdated([song.id]);
              setTimeout(() => songEvents.emitSongUpdated([song.id]), 5000);
            }).catch(() => {});
          }
        }
        console.log('[Player] onload end', {
          songId: song?.id,
          progress: progress.value,
          isStrm: isStrmSong(song),
          strmRetryCount: strmRetryCount,
          STRM_MAX_RETRIES: STRM_MAX_RETRIES,
          STRM_RETRY_DELAYS: STRM_RETRY_DELAYS,
        });
      },
      onplay: () => {
        console.log('[Player] onplay', {
          songId: song?.id,
          progress: progress.value,
          isStrm: isStrmSong(song),
          strmRetryCount,
        });
        if (gen !== soundGeneration) return;
        isBuffering.value = false;
        isPlaying.value = true;
        strmRetryCount = 0;
        tokenRenewAttempts = 0;
        setMediaSessionPlaybackState(true);
        updateMediaSessionMetadata(song);
        startProgressTimer();
        if (needsCache) {
          void bgCache(cacheTargetId, cacheTargetQuality);
        }
        ensureAudioNodeListeners(song, gen);
      },
      onpause: () => {
        if (gen !== soundGeneration) return;
        // 如果有 pending system pause（如 seek 触发），跳过状态变更，
        // 由 DOM pause listener 统一消费意图
        if (pendingPauseSource) return;
        isBuffering.value = false;
        isPlaying.value = false;
        setMediaSessionPlaybackState(false);
        stopProgressTimer();
      },
      onend: () => {
        console.log('[Player] onend', {
          songId: song?.id,
          progress: progress.value,
          isStrm: isStrmSong(song),
          strmRetryCount: strmRetryCount,
          STRM_MAX_RETRIES: STRM_MAX_RETRIES,
          STRM_RETRY_DELAYS: STRM_RETRY_DELAYS,
        });
        if (gen !== soundGeneration) return;
        isBuffering.value = false;
        isPlaying.value = false;
        stopProgressTimer();
        next();
      },
      onloaderror: () => {
        console.log('[Player] onloaderror', {
          songId: song?.id,
          progress: progress.value,
          isStrm: isStrmSong(song),
          strmRetryCount: strmRetryCount,
          STRM_MAX_RETRIES: STRM_MAX_RETRIES,
          STRM_RETRY_DELAYS: STRM_RETRY_DELAYS,
        });
        if (gen !== soundGeneration) return;
        // stream token 过期等：优先续签重建 Howl
        if (tryRecoverFromStreamError(song, gen)) return;
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
        console.log('[Player] onplayerror', {
          songId: song?.id,
          progress: progress.value,
          isStrm: isStrmSong(song),
          strmRetryCount: strmRetryCount,
          STRM_MAX_RETRIES: STRM_MAX_RETRIES,
          STRM_RETRY_DELAYS: STRM_RETRY_DELAYS,
        });
        if (gen !== soundGeneration) return;
        if (tryRecoverFromStreamError(song, gen)) return;
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

  const waitForHowlLoad = (h: Howl, gen: number): Promise<boolean> => {
    return new Promise((resolve) => {
      if (h.state() === 'loaded') {
        resolve(gen === soundGeneration);
        return;
      }
      const onLoad = () => {
        h.off('loaderror', onErr);
        resolve(gen === soundGeneration);
      };
      const onErr = () => {
        h.off('load', onLoad);
        resolve(false);
      };
      h.once('load', onLoad);
      h.once('loaderror', onErr);
    });
  };

  /** 预热 Howl：不依赖 soundGeneration（切歌由调用方校验） */
  const waitForHowlReady = (h: Howl): Promise<boolean> => {
    return new Promise((resolve) => {
      if (h.state() === 'loaded') {
        resolve(true);
        return;
      }
      const onLoad = () => {
        h.off('loaderror', onErr);
        resolve(true);
      };
      const onErr = () => {
        h.off('load', onLoad);
        resolve(false);
      };
      h.once('load', onLoad);
      h.once('loaderror', onErr);
    });
  };

  /**
   * 等待 Howl 真正开始播放。
   * html5 模式下 play() 会置 _playLock，此时 fade/seek 会被排队；
   * 若旧流先 fade 而新流尚未出声，就会听成「断一下再恢复」。
   */
  const waitForHowlPlaying = (h: Howl, timeoutMs = 4000): Promise<boolean> => {
    return new Promise((resolve) => {
      if (typeof h.playing === 'function' && h.playing()) {
        resolve(true);
        return;
      }
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        h.off('play', onPlay);
        h.off('playerror', onErr);
        resolve(ok);
      };
      const onPlay = () => {
        // 再等 audio 节点 playing，避免 play 事件早于实际出声
        const node = (h as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
        if (!node) {
          finish(true);
          return;
        }
        if (!node.paused && node.readyState >= 2) {
          finish(true);
          return;
        }
        const onPlaying = () => {
          node.removeEventListener('playing', onPlaying);
          finish(true);
        };
        node.addEventListener('playing', onPlaying);
        setTimeout(() => {
          node.removeEventListener('playing', onPlaying);
          finish(typeof h.playing === 'function' && h.playing());
        }, 1500);
      };
      const onErr = () => finish(false);
      const timer = setTimeout(() => finish(typeof h.playing === 'function' && h.playing()), timeoutMs);
      h.once('play', onPlay);
      h.once('playerror', onErr);
    });
  };

  /** 播放中对齐进度：直接改 currentTime，避免 Howler seek 先 pause 再 play 造成缺口 */
  const syncHowlCurrentTime = (h: Howl, sec: number) => {
    const node = (h as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
    const dur = node && isFinite(node.duration) && node.duration > 0
      ? node.duration
      : (h.duration() || 0);
    const clamped = dur > 0
      ? Math.max(0, Math.min(sec, Math.max(0, dur - 0.05)))
      : Math.max(0, sec);
    if (node && isFinite(clamped)) {
      try {
        node.currentTime = clamped;
        return;
      } catch { /* fall through */ }
    }
    try { h.seek(clamped); } catch { /* ignore */ }
  };

  const mediaBufferedEnough = (
    node: HTMLAudioElement,
    atSec: number,
    aheadSec: number,
  ): boolean => {
    if (node.seeking) return false;
    if (node.readyState < 3) return false;
    try {
      const needEnd = atSec + aheadSec;
      for (let i = 0; i < node.buffered.length; i++) {
        if (node.buffered.start(i) <= atSec + 0.05 && node.buffered.end(i) >= needEnd) {
          return true;
        }
      }
    } catch { /* ignore */ }
    return node.readyState >= 4;
  };

  /** fade 前等待目标进度附近已有可播缓冲（旧流保持原音量） */
  const waitForMediaBuffered = (
    h: Howl,
    atSec: number,
    timeoutMs = 12_000,
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const node = (h as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
      if (!node) {
        resolve(true);
        return;
      }
      const check = () => mediaBufferedEnough(node, atSec, HOT_SWAP_BUFFER_AHEAD_SEC);
      if (check()) {
        resolve(true);
        return;
      }
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const ev of ['canplay', 'canplaythrough', 'seeked', 'progress', 'playing', 'timeupdate'] as const) {
          node.removeEventListener(ev, onEvt);
        }
        resolve(ok);
      };
      const onEvt = () => {
        if (check()) finish(true);
      };
      const timer = setTimeout(() => finish(check()), timeoutMs);
      for (const ev of ['canplay', 'canplaythrough', 'seeked', 'progress', 'playing', 'timeupdate'] as const) {
        node.addEventListener(ev, onEvt);
      }
    });
  };

  /** 确认 currentTime 在推进，避免 stuck on seek / underrun */
  const waitForPlaybackAdvancing = async (
    h: Howl,
    timeoutMs = 2500,
  ): Promise<boolean> => {
    const node = (h as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
    if (!node) return typeof h.playing === 'function' && h.playing();
    const t0 = node.currentTime;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise<void>((r) => setTimeout(r, 40));
      if (node.paused) return false;
      if (node.currentTime >= t0 + 0.03) return true;
    }
    return !node.paused && node.readyState >= 3 && !node.seeking;
  };

  /**
   * 流式播放期间 Cache 写完后，双 Howl 预热 + 短 crossfade 热切到 blob。
   * 预热失败则保持旧流；与 token 续签互斥；切歌时 cancelWarmupHowl。
   */
  tryHotSwapToBlob = async (songId: number, q: StreamQuality): Promise<void> => {
    if (hotSwapInProgress || tokenRenewInProgress || !sound || activeObjectUrl || playingFromCache.value) return;
    const song = currentSong.value;
    if (!song || song.id !== songId) return;

    const expectedQ = (isStrmSong(song) ? 'original' : quality.value) as StreamQuality;
    if (q !== expectedQ) return;
    if (!(await hasCachedAudio(songId, q))) return;

    if (hotSwapInProgress || tokenRenewInProgress || !sound || activeObjectUrl || playingFromCache.value) return;
    if (currentSong.value?.id !== songId) return;

    hotSwapInProgress = true;
    const startGen = soundGeneration;

    try {
      const blobUrl = await getCachedAudioObjectUrl(songId, q);
      if (
        !blobUrl
        || soundGeneration !== startGen
        || !sound
        || activeObjectUrl
        || playingFromCache.value
        || currentSong.value?.id !== songId
        || tokenRenewInProgress
      ) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }

      cancelWarmupHowl();
      warmupObjectUrl = blobUrl;
      warmupHowl = new Howl({
        src: [blobUrl],
        html5: true,
        format: [...HOWL_FORMATS],
        volume: 0,
      });

      const ready = await waitForHowlReady(warmupHowl);
      if (
        !ready
        || soundGeneration !== startGen
        || !sound
        || activeObjectUrl
        || currentSong.value?.id !== songId
        || !warmupHowl
      ) {
        // 预热失败：保持旧流，勿卸正在播的 Howl
        cancelWarmupHowl();
        return;
      }

      let resumeAt = progress.value;
      try {
        const s = sound.seek();
        if (typeof s === 'number' && isFinite(s) && s >= 0) resumeAt = s;
      } catch { /* keep progress.value */ }

      const wasPlaying = isPlaying.value || (typeof sound.playing === 'function' && sound.playing());
      const targetVol = volume.value;

      // 只 seek 一次（未播放时），避免二次 seek 丢掉缓冲、拉出一串 blob 206
      // 起始位置略微领先旧流，补偿 play 启动延迟，交接时更易对齐
      pendingPauseSource = 'system';
      syncHowlCurrentTime(warmupHowl, resumeAt + HOT_SWAP_START_LEAD_SEC);

      const bufferedOk = await waitForMediaBuffered(warmupHowl, resumeAt, HOT_SWAP_BUFFER_TIMEOUT_MS);
      if (
        !bufferedOk
        || soundGeneration !== startGen
        || !sound
        || currentSong.value?.id !== songId
        || !warmupHowl
      ) {
        // 缓冲未就绪：放弃热切，保持旧流（不制造静音缺口）
        cancelWarmupHowl();
        return;
      }

      let warmId: number | undefined;
      if (wasPlaying) {
        // 预热阶段强制静音，防止与旧流叠音
        try { warmupHowl.volume(0); } catch { /* ignore */ }
        try { warmupHowl.mute(true); } catch { /* ignore */ }
        try {
          warmId = warmupHowl.play() as number;
        } catch {
          cancelWarmupHowl();
          return;
        }
        const playingOk = await waitForHowlPlaying(warmupHowl, HOT_SWAP_PLAYING_TIMEOUT_MS);
        if (
          !playingOk
          || soundGeneration !== startGen
          || !sound
          || currentSong.value?.id !== songId
          || !warmupHowl
        ) {
          cancelWarmupHowl();
          return;
        }

        // 仅当偏差较大才二次对齐，并对齐后再等缓冲
        let nowAt = resumeAt;
        try {
          const s = sound.seek();
          if (typeof s === 'number' && isFinite(s) && s >= 0) nowAt = s;
        } catch { /* keep */ }
        const warmNode = (warmupHowl as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
        const warmAt = warmNode?.currentTime ?? resumeAt;
        if (Math.abs(nowAt - warmAt) > HOT_SWAP_RESYNC_THRESHOLD_SEC) {
          // 二次对齐同样加入领先量，抵消对齐后到交接之间旧流继续前进的漂移
          pendingPauseSource = 'system';
          syncHowlCurrentTime(warmupHowl, nowAt + HOT_SWAP_START_LEAD_SEC);
          const reBuf = await waitForMediaBuffered(warmupHowl, nowAt, HOT_SWAP_BUFFER_TIMEOUT_MS);
          if (!reBuf || soundGeneration !== startGen || !warmupHowl) {
            cancelWarmupHowl();
            return;
          }
          resumeAt = nowAt;
        } else {
          resumeAt = warmAt;
        }

        const advancing = await waitForPlaybackAdvancing(warmupHowl, HOT_SWAP_ADVANCE_TIMEOUT_MS);
        if (
          !advancing
          || soundGeneration !== startGen
          || !sound
          || currentSong.value?.id !== songId
          || !warmupHowl
        ) {
          cancelWarmupHowl();
          return;
        }
        // 预热期间可能被 play 路径改写音量，再锁一次静音
        try { warmupHowl.volume(0); } catch { /* ignore */ }
        try { warmupHowl.mute(true); } catch { /* ignore */ }
      }

      // 瞬间交接：先静音旧流、再开新流，禁止双边 fade 叠音
      pendingPauseSource = 'system';
      try { sound.volume(0); } catch { /* ignore */ }
      try { sound.mute(true); } catch { /* ignore */ }
      try { warmupHowl.mute(false); } catch { /* ignore */ }
      try {
        if (typeof warmId === 'number') warmupHowl.volume(targetVol, warmId);
        else warmupHowl.volume(targetVol);
      } catch {
        try { warmupHowl.volume(targetVol); } catch { /* ignore */ }
      }

      if (
        soundGeneration !== startGen
        || currentSong.value?.id !== songId
        || !warmupHowl
        || !sound
      ) {
        cancelWarmupHowl();
        if (soundGeneration === startGen && sound) {
          try { sound.mute(false); } catch { /* ignore */ }
          try { sound.volume(targetVol); } catch { /* ignore */ }
        }
        return;
      }

      // 提交：先作废旧回调，再切换引用，最后 unload 旧实例
      const oldSound = sound;
      const newHowl = warmupHowl;
      const newUrl = warmupObjectUrl;
      warmupHowl = null;
      warmupObjectUrl = null;

      soundGeneration += 1;
      const gen = soundGeneration;
      listenersAttachedForGen = -1;

      sound = newHowl;
      activeObjectUrl = newUrl;
      playingFromCache.value = true;
      clearTokenRenewTimer();
      tokenRenewAttempts = 0;

      try { newHowl.mute(false); } catch { /* ignore */ }
      try { newHowl.volume(targetVol); } catch { /* ignore */ }
      duration.value = newHowl.duration() || duration.value;
      try {
        const s = newHowl.seek();
        if (typeof s === 'number' && isFinite(s) && s >= 0) {
          progress.value = s;
        } else {
          progress.value = resumeAt;
        }
      } catch {
        progress.value = resumeAt;
      }

      bindHowlLifecycle(newHowl, song, gen, false, songId, q);

      pendingPauseSource = 'system';
      try { oldSound.unload(); } catch { /* ignore */ }

      if (wasPlaying) {
        isBuffering.value = false;
        isPlaying.value = true;
        setMediaSessionPlaybackState(true);
        updateMediaSessionMetadata(song);
        startProgressTimer();
        ensureAudioNodeListeners(song, gen);
        // 若 crossfade 后预热意外停了，补一次 play
        if (typeof newHowl.playing === 'function' && !newHowl.playing()) {
          try { newHowl.play(); } catch { /* ignore */ }
        }
      } else {
        try { newHowl.pause(); } catch { /* ignore */ }
        isPlaying.value = false;
        isBuffering.value = false;
        setMediaSessionPlaybackState(false);
        stopProgressTimer();
      }
    } finally {
      hotSwapInProgress = false;
    }
  };

  audioCachedHandler = (songId, q) => {
    void tryHotSwapToBlob(songId, q);
  };

  const play = async (song?: Song) => {
    if (playLock) return;
    playLock = true;
    try {
      await _playInternal(song);
    } finally {
      playLock = false;
    }
  };

  const _playInternal = async (song?: Song) => {
    strmRetryCount = 0;

    if (song && (!song.duration_secs || !song.bitrate || !song.channels || !song.codec)) {
      musicApi.getSong(song.id).then(({ data }) => {
        const idx = queue.value.findIndex(s => s.id === data.id);
        if (idx >= 0) queue.value[idx] = { ...queue.value[idx], ...data };
        if (currentSong.value?.id === data.id) currentSong.value = { ...currentSong.value, ...data };
      }).catch(() => {});
    }

    if (song) {
      // 同曲再点：直接返回，禁止二次 Howl.play（pool 可能叠出第二个实例）
      if (currentSong.value?.id === song.id && sound) {
        return;
      }

      const needsInit = currentSong.value?.id !== song.id || !sound;
      if (needsInit) {
        // 切歌时取消上一首歌的闲时补洞（必须在 currentSong 更新前执行）
        if (currentSong.value && currentSong.value.id !== song.id) {
          const prevQ = (isStrmSong(currentSong.value) ? 'original' : quality.value) as StreamQuality;
          cancelSwDownload(currentSong.value.id, prevQ);
        }

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
    } else if (currentSong.value && sound) {
      // 恢复已有实例：先检查 audio element 的真实状态
      const node = (sound as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;

      if (node && !node.paused) {
        console.log('[Player] audio element 已在播放，同步状态');
        isPlaying.value = true;
        isBuffering.value = false;
        wasUnexpectedlyPaused = false;
        setMediaSessionPlaybackState(true);
        startProgressTimer();
        return;
      }

      if (wasUnexpectedlyPaused) {
        wasUnexpectedlyPaused = false;
        const savedProgress = progress.value;
        const isStrm = isStrmSong(currentSong.value);
        const q = (isStrm ? 'original' : quality.value) as StreamQuality;
        const isCached = await hasCachedAudio(currentSong.value.id, q);
        const canSeek = !isStrm || isCached;

        console.warn('[Player] 意外暂停后恢复，重新初始化', { savedProgress, canSeek, reason: 'device_disconnect' });
        const genBefore = soundGeneration;
        await initSound(currentSong.value, !canSeek);
        if (soundGeneration !== genBefore + 1) return;
        if (sound && canSeek && savedProgress > 0) {
          (sound as Howl).seek(savedProgress);
        }
      }
    } else if (currentSong.value && !sound) {
      // 从持久化恢复（页面刷新后）
      const isStrm = isStrmSong(currentSong.value);
      const q = (isStrm ? 'original' : quality.value) as StreamQuality;
      const isCached = isStrm ? await hasCachedAudio(currentSong.value.id, q) : true;
      const canResume = !isStrm || isCached;
      const resetProg = !canResume;
      const savedProgress = canResume ? progress.value : 0;

      const genBefore = soundGeneration;
      await initSound(currentSong.value, resetProg);
      if (soundGeneration !== genBefore + 1) return;
      if (sound && savedProgress > 0) {
        (sound as Howl).seek(savedProgress);
      }
    }

    if (sound) {
      console.log('[Player] sound.play()', {
        songId: currentSong.value?.id,
        progress: progress.value,
        resume: !song,
      });
      sound.play();
    }
  };

  const pause = (source: PauseSource = 'user') => {
    pendingPauseSource = source;
    sound?.pause();
    if (!sound) {
      pendingPauseSource = null;
      isPlaying.value = false;
      setMediaSessionPlaybackState(false);
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

    const nextIdx = resolveNextIndex();
    if (nextIdx === 'stop') { stopPlayback(); return; }
    if (nextIdx === currentIndex.value) { replayCurrentSong(); return; }
    currentIndex.value = nextIdx;
    play(queue.value[nextIdx]);
  };

  const prev = () => {
    if (queue.value.length === 0) return;
    const now = Date.now();
    if (now < skipThrottleUntil) return;
    skipThrottleUntil = now + SKIP_THROTTLE_MS;

    const prevIdx = resolvePrevIndex();
    if (prevIdx === currentIndex.value) { replayCurrentSong(); return; }
    currentIndex.value = prevIdx;
    play(queue.value[prevIdx]);
  };

  const seek = (time: number) => {
    if (!canSeek.value) return;
    if (!sound || !duration.value || !isFinite(time) || time < 0) return;
    const clampedTime = Math.min(time, duration.value);

    if (isPlaying.value) {
      pendingPauseSource = 'system';
    }
    sound.seek(clampedTime);
    progress.value = clampedTime;

    setTimeout(() => {
      if (!sound) return;
      const node = (sound as any)?._sounds?.[0]?._node as HTMLAudioElement | undefined;
      if (!node) return;
      const actual = node.currentTime;
      if (Math.abs(actual - clampedTime) > 1) {
        console.warn('[Player] seek 回退: Howler 未生效，直接设置 currentTime', { target: clampedTime, actual });
        try { node.currentTime = clampedTime; } catch { /* ignore */ }
      }
    }, 50);
  };

  const setVolume = (vol: number) => {
    volume.value = vol;
    Howler.volume(vol);
  };

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

  attachMediaSessionHandlers({
    play: () => { void play(); },
    pause: () => pause('system'),
    next: () => next(),
    previous: () => prev(),
    seek: (time: number) => seek(time),
    getPosition: () => progress.value,
    getDuration: () => duration.value,
  });

  watch(currentSong, (song) => {
    updateMediaSessionMetadata(song);
  }, { immediate: true });

  watch(isPlaying, (playing) => {
    setMediaSessionPlaybackState(playing);
    if (playing) updatePositionState();
  });

  const clearQueue = () => {
    ++soundGeneration;
    destroySound();
    revokeObjectUrl();
    currentSong.value = null;
    queue.value = [];
    currentIndex.value = -1;
    isBuffering.value = false;
    isPlaying.value = false;
    playingFromCache.value = false;
    progress.value = 0;
    duration.value = 0;
  };

  const removeOrphanSongs = (orphanIdSet: Set<number>): number => {
    if (orphanIdSet.size === 0) return 0;
    const beforeLen = queue.value.length;
    const currentIsOrphan = currentSong.value && orphanIdSet.has(currentSong.value.id);

    if (currentIsOrphan) {
      ++soundGeneration;
      destroySound();
      revokeObjectUrl();
      isPlaying.value = false;
      isBuffering.value = false;
      playingFromCache.value = false;
      progress.value = 0;
      duration.value = 0;
      currentSong.value = null;
    }

    queue.value = queue.value.filter(s => !orphanIdSet.has(s.id));
    const removed = beforeLen - queue.value.length;

    if (removed > 0) {
      if (currentSong.value) {
        currentIndex.value = queue.value.findIndex(s => s.id === currentSong.value!.id);
      } else if (queue.value.length > 0) {
        currentIndex.value = 0;
        currentSong.value = queue.value[0];
      } else {
        currentIndex.value = -1;
      }
    }

    return removed;
  };

  return {
    currentSong,
    queue,
    currentIndex,
    isPlaying,
    isBuffering,
    canSeek,
    volume,
    playMode,
    quality,
    progress,
    duration,
    playingFromCache,
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
    removeOrphanSongs,
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
