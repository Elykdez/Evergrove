import { describe, expect, it } from 'vitest';
import { MAX_GROVE, clampGrove, groveLayout, groveRadius } from '../src/core/grove';

describe('grove layout', () => {
  it('is deterministic per seed', () => {
    expect(groveLayout(8, 7, 42)).toEqual(groveLayout(8, 7, 42));
    expect(groveLayout(8, 7, 42)).not.toEqual(groveLayout(8, 7, 43));
  });

  it('keeps every tree clear of the trunk and of each other', () => {
    for (const seed of [1, 7, 99, 123456]) {
      const slots = groveLayout(MAX_GROVE, 6, seed);
      expect(slots).toHaveLength(MAX_GROVE);
      slots.forEach((a, i) => {
        expect(Math.hypot(a.x, a.z)).toBeGreaterThanOrEqual(6 - 1e-9);
        slots.slice(i + 1).forEach((b) => expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(6 - 1e-9));
      });
    }
  });

  it('keeps standing trees in place when the count changes', () => {
    expect(groveLayout(10, 8, 5).slice(0, 4)).toEqual(groveLayout(4, 8, 5));
  });

  it('stays compact', () => {
    // Sixteen trees 8 m apart fit well inside the 30 m fog start.
    expect(groveRadius(groveLayout(MAX_GROVE, 8, 7))).toBeLessThan(30);
    expect(groveRadius([])).toBe(0);
  });

  it('clamps the count', () => {
    expect(clampGrove(-3)).toBe(0);
    expect(clampGrove(Number.NaN)).toBe(0);
    expect(clampGrove(99)).toBe(MAX_GROVE);
    expect(groveLayout(0, 8, 1)).toEqual([]);
  });
});
