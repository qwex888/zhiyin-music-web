import { ref, watch, type Ref } from 'vue';
import type { Song } from '@/types';

export type PlayMode = 'sequence' | 'repeat-all' | 'repeat-one' | 'shuffle';

export function useQueueManager(
  playMode: Ref<PlayMode>,
  currentIndex: Ref<number>,
) {
  const queue = ref<Song[]>([]);
  const shuffleHistory = ref<number[]>([]);
  const shuffleRemaining = ref<number[]>([]);

  const initShufflePool = () => {
    shuffleRemaining.value = queue.value.map((_, i) => i);
    if (currentIndex.value >= 0) {
      const idx = shuffleRemaining.value.indexOf(currentIndex.value);
      if (idx > -1) shuffleRemaining.value.splice(idx, 1);
    }
  };

  const getNextShuffleIndex = (): number => {
    if (shuffleRemaining.value.length === 0) initShufflePool();
    if (shuffleRemaining.value.length === 0) return currentIndex.value;
    const randomIdx = Math.floor(Math.random() * shuffleRemaining.value.length);
    const nextIndex = shuffleRemaining.value[randomIdx];
    shuffleRemaining.value.splice(randomIdx, 1);
    return nextIndex;
  };

  const resolveNextIndex = (): number | 'stop' => {
    if (queue.value.length === 0) return 'stop';
    let nextIndex = currentIndex.value + 1;

    if (playMode.value === 'shuffle') {
      nextIndex = getNextShuffleIndex();
      if (currentIndex.value >= 0) {
        shuffleHistory.value.push(currentIndex.value);
        if (shuffleHistory.value.length > 50) shuffleHistory.value.shift();
      }
    } else if (playMode.value === 'repeat-one') {
      nextIndex = currentIndex.value;
    } else if (playMode.value === 'repeat-all') {
      if (nextIndex >= queue.value.length) nextIndex = 0;
    } else {
      if (nextIndex >= queue.value.length) return 'stop';
    }
    return nextIndex;
  };

  const resolvePrevIndex = (): number => {
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
    return prevIndex;
  };

  const addToQueue = (song: Song) => {
    queue.value.push(song);
  };

  const setQueue = (songs: Song[], startIndex = 0) => {
    queue.value = [...songs];
    if (songs.length === 0) {
      currentIndex.value = -1;
    } else {
      const idx = Math.min(Math.max(0, startIndex), songs.length - 1);
      currentIndex.value = idx;
    }
    if (playMode.value === 'shuffle') initShufflePool();
  };

  watch(playMode, (newMode, oldMode) => {
    if (newMode === 'shuffle') {
      shuffleHistory.value = [];
      initShufflePool();
    } else if (oldMode === 'shuffle') {
      shuffleHistory.value = [];
      shuffleRemaining.value = [];
    }
  });

  watch(queue, () => {
    if (playMode.value === 'shuffle') initShufflePool();
  });

  return {
    queue,
    shuffleHistory,
    shuffleRemaining,
    addToQueue,
    setQueue,
    resolveNextIndex,
    resolvePrevIndex,
    initShufflePool,
  };
}
