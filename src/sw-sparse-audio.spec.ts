import { describe, expect, it } from 'vitest';
import { findHoles, isFullyCovered, planFillTasks } from '@/sw-sparse-audio';

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
