import { describe, expect, it } from 'vitest';
import {
  MAX_BUDGET,
  MAX_EXTRA_SIMPLIFY,
  MAX_LEAF_GROWTH,
  MIN_BUDGET,
  MIN_DETAIL,
  barkDetail,
  clampBudget,
  fitDetail,
  fruitDetail,
  fruitKeep,
  leafDetail,
} from '../src/core/budget';
import { pruneTwigs, type TreeGraph } from '../src/core/growth';
import { WIND_ATTRIBUTE, withoutWind } from '../src/mesh/wind';
import { PRESETS } from '../src/presets';
import { generateTree, triangles, type TreeResult } from '../src/tree';

const total = (r: TreeResult) => triangles(r.bark) + triangles(r.leaves) + triangles(r.fruit);

describe('detail mapping', () => {
  const bark = PRESETS.Oak.params.bark;

  it('keeps full detail at d = 1', () => {
    expect(barkDetail(bark, 4, 1)).toEqual({
      radialSegments: bark.radialSegments,
      subdivisions: bark.subdivisions,
      simplifyAngle: 4,
      keep: 1,
      rootCount: bark.rootCount,
    });
    expect(leafDetail(PRESETS.Oak.params.leaves, 1)).toMatchObject({ perTip: PRESETS.Oak.params.leaves.perTip });
    expect(fruitDetail(14, 1)).toBe(14);
  });

  it('never goes below 3 sides or 0 subdivisions, then simplifies harder', () => {
    let lastAngle = 0;
    for (const d of [0.5, 0.1, 0.03, 0.01, MIN_DETAIL]) {
      const b = barkDetail(bark, 4, d);
      expect(b.radialSegments).toBeGreaterThanOrEqual(3);
      expect(b.subdivisions).toBeGreaterThanOrEqual(0);
      expect(b.simplifyAngle).toBeGreaterThanOrEqual(lastAngle);
      lastAngle = b.simplifyAngle;
    }
    expect(barkDetail(bark, 4, MIN_DETAIL).simplifyAngle).toBe(4 + MAX_EXTRA_SIMPLIFY);
  });

  it('prunes twigs and root flares only once simplification is at its maximum', () => {
    let lastKeep = 1;
    for (let d = 1; d >= MIN_DETAIL; d /= 1.5) {
      const b = barkDetail(bark, 4, d);
      if (b.keep < 1) expect(b.simplifyAngle).toBe(4 + MAX_EXTRA_SIMPLIFY);
      expect(b.keep).toBeLessThanOrEqual(lastKeep);
      expect(b.rootCount).toBeLessThanOrEqual(bark.rootCount);
      lastKeep = b.keep;
    }
    expect(barkDetail(bark, 4, MIN_DETAIL).keep).toBeLessThan(0.01);
    expect(barkDetail(bark, 4, MIN_DETAIL).rootCount).toBe(0);
  });

  it('thins fruit only once the facets are down to 3', () => {
    expect(fruitKeep(14, 1)).toBe(1);
    expect(fruitKeep(14, (3 / 14) ** 2)).toBeCloseTo(1, 9);
    expect(fruitKeep(14, (3 / 14) ** 2 / 4)).toBeCloseTo(0.25, 9);
  });

  it('clamps a set budget to its range and keeps 0 as no limit', () => {
    expect(clampBudget(0)).toBe(0);
    expect(clampBudget(-5)).toBe(0);
    expect(clampBudget(10)).toBe(MIN_BUDGET);
    expect(clampBudget(4321)).toBe(4321);
    expect(clampBudget(1e7)).toBe(MAX_BUDGET);
  });

  it('grows leaves to keep the canopy area, up to a cap', () => {
    const leaves = PRESETS.Oak.params.leaves;
    const quarter = leafDetail(leaves, 0.25);
    expect(quarter.perTip).toBeCloseTo(leaves.perTip / 4, 9);
    expect(quarter.size).toBeCloseTo(leaves.size * 2, 9);
    expect(leafDetail(leaves, 0.01).size).toBeCloseTo(leaves.size * MAX_LEAF_GROWTH, 9);
  });
});

describe('fitDetail', () => {
  it('returns full detail without a budget or when it already fits', () => {
    expect(fitDetail(() => 1e9, 0)).toEqual({ d: 1, over: false });
    expect(fitDetail((d) => 1000 * d, 5000)).toEqual({ d: 1, over: false });
  });

  it('finds the largest fitting factor on a stepped total', () => {
    // Steps every 0.1, like whole rings dropping out.
    const stepped = (d: number) => Math.ceil(d * 10) * 1000;
    const { d, over } = fitDetail(stepped, 4500, 12);
    expect(over).toBe(false);
    expect(stepped(d)).toBeLessThanOrEqual(4500);
    expect(d).toBeGreaterThan(0.38);
  });

  it('reports a budget that even the minimum cannot meet', () => {
    expect(fitDetail((d) => 500 + 1000 * d, 100)).toEqual({ d: MIN_DETAIL, over: true });
  });
});

describe('triangle budget in the pipeline', () => {
  const oak = PRESETS.Oak.params;

  it('changes nothing when the budget is 0', () => {
    const free = generateTree({ ...oak, triangleBudget: 0 });
    expect(free.overBudget).toBe(false);
    expect(free.detail).toEqual({ bark: 1, leaves: 1, fruit: 1 });
  });

  it.each([10000, 5000, 1000])('fits %i triangles closely and deterministically', (budget) => {
    const a = generateTree({ ...oak, triangleBudget: budget });
    const b = generateTree({ ...oak, triangleBudget: budget });
    expect(a.overBudget).toBe(false);
    expect(total(a)).toBeLessThanOrEqual(budget);
    expect(total(a)).toBeGreaterThan(budget * 0.9);
    expect(total(b)).toBe(total(a));
    expect(a.bark.getAttribute('position').array).toEqual(b.bark.getAttribute('position').array);
  });

  it.each(Object.keys(PRESETS))('fits %s into the smallest budget, leaves included', (name) => {
    const r = generateTree({ ...PRESETS[name].params, triangleBudget: MIN_BUDGET });
    expect(r.overBudget).toBe(false);
    expect(total(r)).toBeLessThanOrEqual(MIN_BUDGET);
    expect(triangles(r.leaves)).toBeGreaterThan(0);
  });

  it('clamps budgets outside the range', () => {
    const huge = generateTree({ ...oak, triangleBudget: 1e7 });
    expect(total(huge)).toBe(total(generateTree({ ...oak, triangleBudget: MAX_BUDGET })));
  }, 20000);

  it('keeps the canopy on the full skeleton while the bark thins', () => {
    const free = generateTree({ ...oak, triangleBudget: 0 });
    const tight = generateTree({ ...oak, triangleBudget: MIN_BUDGET });
    expect(tight.graph.tips.length).toBe(free.graph.tips.length);
    tight.leaves.computeBoundingBox();
    free.leaves.computeBoundingBox();
    expect(tight.leaves.boundingBox!.max.y).toBeCloseTo(free.leaves.boundingBox!.max.y, 0);
    expect(tight.leaves.boundingBox!.min.y).toBeCloseTo(free.leaves.boundingBox!.min.y, 0);
  }, 20000);
});

describe('pruneTwigs', () => {
  // A trunk forking into two limbs, each carrying a thicker and a thinner twig.
  const node = (y: number, radius: number, parent: number, children: number[]) => ({
    pos: [0, y, 0] as [number, number, number],
    radius,
    parent,
    children,
    tip: children.length === 0,
  });
  const g: TreeGraph = {
    nodes: [
      node(0, 1, -1, [1]),
      node(1, 0.9, 0, [2, 3]),
      node(2, 0.5, 1, [4, 5]),
      node(2, 0.4, 1, [6, 7]),
      node(3, 0.3, 2, []),
      node(3, 0.1, 2, []),
      node(3, 0.2, 3, []),
      node(3, 0.05, 3, []),
    ],
    roots: [0],
    tips: [4, 5, 6, 7],
  };

  it('leaves the graph alone when it already has few enough tips', () => {
    expect(pruneTwigs(g, 4)).toBe(g);
  });

  it('cuts the thinnest twigs first and keeps the graph consistent', () => {
    const two = pruneTwigs(g, 2);
    expect(two.tips.map((t) => two.nodes[t].radius).sort()).toEqual([0.2, 0.3]);
    expect(g.nodes.length).toBe(8);
    for (const [i, n] of two.nodes.entries()) {
      for (const c of n.children) expect(two.nodes[c].parent).toBe(i);
      expect(n.tip).toBe(n.children.length === 0);
    }
  });

  it('turns stripped limbs into tapered tips, down to the bare trunk', () => {
    expect(pruneTwigs(g, 1).tips.length).toBe(1);
    const bare = pruneTwigs(g, 0);
    expect(bare.nodes.length).toBe(2);
    expect(bare.nodes[bare.tips[0]].radius).toBeCloseTo(0.9 * 0.35, 9);
  });
});

describe('wind data', () => {
  it('gives each leaf a still petiole and a weighted tip, and strips cleanly for export', () => {
    const r = generateTree(PRESETS.Shrub.params);
    const wind = r.leaves.getAttribute(WIND_ATTRIBUTE);
    expect(wind.itemSize).toBe(2);
    expect(wind.count).toBe(r.leaves.getAttribute('position').count);
    for (let v = 0; v < Math.min(wind.count, 600); v += 6) {
      for (let k = 0; k < 3; k++) expect(wind.getX(v + k)).toBe(0);
      for (let k = 3; k < 6; k++) expect(wind.getX(v + k)).toBeGreaterThan(0);
      expect(wind.getY(v)).toBe(wind.getY(v + 5));
    }
    const plain = withoutWind(r.leaves);
    expect(plain.getAttribute(WIND_ATTRIBUTE)).toBeUndefined();
    expect(plain.getAttribute('position')).toBe(r.leaves.getAttribute('position'));
    expect(plain.index).toBe(r.leaves.index);
  });
});
