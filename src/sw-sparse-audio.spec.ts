import { describe, expect, it } from 'vitest';
import {
  findHoles,
  isFullyCovered,
  planFillTasks,
  planPriorityFillTasks,
  resolvePlayheadBytes,
  resolveWindowBytes,
  PLAY_FILL_CONCURRENCY,
  PLAY_SERVE_CHUNK,
  URGENT_FALLBACK_BYTES,
  AHEAD_FALLBACK_BYTES,
  IDLE_FILL_CHUNK,
} from '@/sw-sparse-audio';

describe('sparse range helpers', () => {
  it('findHoles returns full range when empty', () => {
    expect(findHoles([], 0, 99)).toEqual([{ start: 0, end: 99 }]);
  });

  it('findHoles skips covered middle', () => {
    expect(findHoles([{ start: 10, end: 19 }], 0, 29)).toEqual([
      { start: 0, end: 9 },
      { start: 20, end: 29 },
    ]);
  });

  it('findHoles returns empty when fully covered', () => {
    expect(findHoles([{ start: 0, end: 99 }], 0, 99)).toEqual([]);
  });

  it('isFullyCovered', () => {
    expect(isFullyCovered([{ start: 0, end: 9 }], 10)).toBe(true);
    expect(isFullyCovered([{ start: 0, end: 8 }], 10)).toBe(false);
    expect(isFullyCovered([{ start: 0, end: 4 }, { start: 5, end: 9 }], 10)).toBe(true);
  });

  it('planFillTasks splits holes into chunk-sized jobs', () => {
    const tasks = planFillTasks([{ start: 0, end: 9 }], 4);
    expect(tasks).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 9 },
    ]);
  });
});

describe('playhead window / priority fill', () => {
  const totalSize = 40 * 1024 * 1024; // 40MB
  const durationSec = 320;

  it('resolvePlayheadBytes：有 duration 时按秒比例换算', () => {
    expect(resolvePlayheadBytes({
      totalSize,
      positionSec: 160,
      durationSec,
    })).toBe(Math.floor((160 / 320) * totalSize));
  });

  it('resolvePlayheadBytes：优先显式 positionBytes', () => {
    expect(resolvePlayheadBytes({
      totalSize,
      positionSec: 10,
      durationSec,
      positionBytes: 12345,
    })).toBe(12345);
  });

  it('resolvePlayheadBytes：缺 duration 时回退到 0', () => {
    expect(resolvePlayheadBytes({
      totalSize,
      positionSec: 10,
      durationSec: null,
    })).toBe(0);
  });

  it('resolveWindowBytes：秒优先', () => {
    const w = resolveWindowBytes({ totalSize, durationSec });
    expect(w.mode).toBe('seconds');
    const bps = totalSize / durationSec;
    expect(w.urgentBytes).toBe(Math.floor(bps * 12));
    expect(w.aheadBytes).toBe(Math.floor(bps * 75));
  });

  it('resolveWindowBytes：无 duration 时 fallback MB', () => {
    const w = resolveWindowBytes({ totalSize, durationSec: null });
    expect(w.mode).toBe('bytes');
    expect(w.urgentBytes).toBe(URGENT_FALLBACK_BYTES);
    expect(w.aheadBytes).toBe(AHEAD_FALLBACK_BYTES);
  });

  it('planPriorityFillTasks：playhead 居中时后方洞先于左侧 P2', () => {
    const playhead = 20 * 1024 * 1024;
    const holes = [
      { start: 0, end: 5 * 1024 * 1024 - 1 },
      { start: playhead, end: totalSize - 1 },
    ];
    const window = resolveWindowBytes({ totalSize, durationSec });
    const tasks = planPriorityFillTasks(holes, playhead, totalSize, {
      urgentBytes: window.urgentBytes,
      aheadBytes: window.aheadBytes,
      chunkSize: IDLE_FILL_CHUNK,
    });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].priority).toBe(0);
    expect(tasks[0].start).toBeGreaterThanOrEqual(playhead);
    const firstP2 = tasks.findIndex((t) => t.priority === 2);
    const lastP0orP1 = Math.max(
      ...tasks.map((t, i) => (t.priority <= 1 ? i : -1)),
    );
    expect(firstP2).toBeGreaterThan(lastP0orP1);
  });

  it('planPriorityFillTasks：urgent 窗内块为 P0', () => {
    const playhead = 10 * 1024 * 1024;
    const window = resolveWindowBytes({ totalSize, durationSec });
    const holes = [{ start: playhead, end: totalSize - 1 }];
    const tasks = planPriorityFillTasks(holes, playhead, totalSize, {
      urgentBytes: window.urgentBytes,
      aheadBytes: window.aheadBytes,
      chunkSize: IDLE_FILL_CHUNK,
    });
    const urgentEnd = playhead + window.urgentBytes;
    const p0 = tasks.filter((t) => t.priority === 0);
    expect(p0.length).toBeGreaterThan(0);
    expect(p0.every((t) => t.start < urgentEnd)).toBe(true);
    expect(tasks[0].priority).toBe(0);
  });

  it('seek 后重规划：首任务覆盖新 playhead 分片', () => {
    const holes = [{ start: 0, end: totalSize - 1 }];
    const window = resolveWindowBytes({ totalSize, durationSec });
    const before = planPriorityFillTasks(holes, 0, totalSize, {
      urgentBytes: window.urgentBytes,
      aheadBytes: window.aheadBytes,
      chunkSize: IDLE_FILL_CHUNK,
    });
    const seekTo = 25 * 1024 * 1024;
    const after = planPriorityFillTasks(holes, seekTo, totalSize, {
      urgentBytes: window.urgentBytes,
      aheadBytes: window.aheadBytes,
      chunkSize: IDLE_FILL_CHUNK,
    });
    expect(before[0].start).toBe(0);
    expect(after[0].priority).toBe(0);
    expect(after[0].start).toBeLessThanOrEqual(seekTo);
    expect(after[0].end).toBeGreaterThanOrEqual(seekTo);
  });

  it('弱网语义：P0 排在全部 P2 之前（不会先大量补左侧）', () => {
    const playhead = 15 * 1024 * 1024;
    const holes = [
      { start: 0, end: playhead - 1 },
      { start: playhead + 1024, end: totalSize - 1 },
    ];
    const window = resolveWindowBytes({ totalSize, durationSec: null });
    const tasks = planPriorityFillTasks(holes, playhead, totalSize, {
      urgentBytes: window.urgentBytes,
      aheadBytes: window.aheadBytes,
      chunkSize: PLAY_SERVE_CHUNK,
    });
    let seenP2 = false;
    for (const t of tasks) {
      if (t.priority === 2) seenP2 = true;
      if (t.priority === 0) expect(seenP2).toBe(false);
    }
    expect(tasks.some((t) => t.priority === 0)).toBe(true);
    expect(tasks.some((t) => t.priority === 2)).toBe(true);
  });

  it('播放态补洞并发约束为 1', () => {
    expect(PLAY_FILL_CONCURRENCY).toBe(1);
  });

  it('IDLE_FILL_CHUNK 为 2MB 量级（跟 playhead 重规划）', async () => {
    const { IDLE_FILL_CHUNK, SPARSE_PROTOCOL } = await import('@/sw-sparse-audio');
    expect(IDLE_FILL_CHUNK).toBe(2 * 1024 * 1024);
    expect(SPARSE_PROTOCOL).toBe('playhead-v2');
  });
});
