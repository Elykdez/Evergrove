import { describe, expect, it } from 'vitest';
import { batchVariants, fruitingIndices } from '../src/batch';
import { fruitColor, hexToRgb, hslToRgb, placeFruit, rgbToHsl, type FruitParams } from '../src/core/fruit';
import type { TreeGraph } from '../src/core/growth';
import { mulberry32 } from '../src/core/rng';
import { FACETED_MAX_SEGMENTS, buildFruitGeometry } from '../src/mesh/fruit';
import { PRESETS } from '../src/presets';
import { generateTree } from '../src/tree';

const base: FruitParams = { ...PRESETS.Oak.params.fruit, enabled: true };

/** A fan of 40 tips at 3 m on a 1 m trunk. */
function fan(): TreeGraph {
  const nodes: TreeGraph['nodes'] = [
    { pos: [0, 0, 0], radius: 0.2, parent: -1, children: [], tip: false },
    { pos: [0, 1, 0], radius: 0.15, parent: 0, children: [], tip: false },
  ];
  nodes[0].children.push(1);
  const tips: number[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    nodes.push({ pos: [Math.cos(a) * 2, 3, Math.sin(a) * 2], radius: 0.01, parent: 1, children: [], tip: true });
    nodes[1].children.push(nodes.length - 1);
    tips.push(nodes.length - 1);
  }
  return { nodes, roots: [0], tips };
}

describe('fruit placement', () => {
  const g = fan();

  it('is deterministic and empty when disabled or at zero density', () => {
    expect(placeFruit(g, base, mulberry32(1))).toEqual(placeFruit(g, base, mulberry32(1)));
    expect(placeFruit(g, { ...base, enabled: false }, mulberry32(1))).toEqual([]);
    expect(placeFruit(g, { ...base, density: 0 }, mulberry32(1))).toEqual([]);
    expect(placeFruit(g, { ...base, density: 1 }, mulberry32(1))).toHaveLength(40);
  });

  it('keeps existing fruit in place when the density rises', () => {
    const sparse = placeFruit(g, { ...base, density: 0.2 }, mulberry32(5));
    const dense = placeFruit(g, { ...base, density: 0.7 }, mulberry32(5));
    expect(dense.length).toBeGreaterThan(sparse.length);
    for (const f of sparse) expect(dense).toContainEqual(f);
  });

  it('hangs each fruit below its tip by the stem length, within the size jitter', () => {
    const p = { ...base, density: 1, hang: 0.1, sizeJitter: 0.2, elongation: 1.5 };
    for (const f of placeFruit(g, p, mulberry32(2))) {
      expect(f.attach[1]).toBeCloseTo(f.stemTop[1] - 0.1, 9);
      expect(f.radius).toBeGreaterThanOrEqual(p.size * 0.8 - 1e-12);
      expect(f.radius).toBeLessThanOrEqual(p.size * 1.2 + 1e-12);
      expect(f.height).toBeCloseTo(f.radius * 1.5, 12);
      expect(f.center[1]).toBeCloseTo(f.attach[1] - f.height, 12);
    }
  });

  it('skips fruit that would reach into the ground', () => {
    const low = fan();
    low.nodes.forEach((n) => n.tip && (n.pos = [n.pos[0], 0.05, n.pos[2]]));
    expect(placeFruit(low, { ...base, density: 1 }, mulberry32(3))).toEqual([]);
  });
});

describe('fruit colour', () => {
  it('round-trips hex, RGB and HSL', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('#f80')).toEqual(hexToRgb('#ff8800'));
    expect(hexToRgb('nonsense')).toEqual([0.5, 0.5, 0.5]);
    const rgb = hexToRgb('#c8302a');
    hslToRgb(rgbToHsl(rgb)).forEach((c, i) => expect(c).toBeCloseTo(rgb[i], 9));
  });

  it('is the base colour when the range is 0', () => {
    const rgb = hexToRgb(base.color);
    fruitColor({ ...base, colorRange: 0 }, 42).forEach((c, i) => expect(c).toBeCloseTo(rgb[i], 9));
  });

  it('varies per tree but stays within the hue threshold', () => {
    const range = 0.08;
    const [h0] = rgbToHsl(hexToRgb(base.color));
    const colours = Array.from({ length: 60 }, (_, seed) => fruitColor({ ...base, colorRange: range }, seed));
    expect(new Set(colours.map((c) => c.join())).size).toBe(60);
    expect(fruitColor({ ...base, colorRange: range }, 7)).toEqual(colours[7]);
    for (const c of colours) {
      const [h] = rgbToHsl(c);
      const d = Math.min(Math.abs(h - h0), 1 - Math.abs(h - h0));
      expect(d).toBeLessThanOrEqual(range + 1e-9);
    }
  });
});

describe('fruit mesh', () => {
  const fruits = placeFruit(fan(), { ...base, density: 0.5 }, mulberry32(4));

  type V = [number, number, number];
  /** Triangles of the mesh whose three corners all lie on one fruit's ellipsoid (so not stems). */
  function bodyTriangles(geo: ReturnType<typeof buildFruitGeometry>) {
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const idx = geo.index!;
    const at = (a: typeof pos, i: number): V => [a.getX(i), a.getY(i), a.getZ(i)];
    const onSurface = (p: V) =>
      fruits.find((f) => {
        const e = ((p[0] - f.center[0]) / f.radius) ** 2 + ((p[1] - f.center[1]) / f.height) ** 2 + ((p[2] - f.center[2]) / f.radius) ** 2;
        return Math.abs(e - 1) < 1e-3;
      });
    const out: { v: V[]; n: V[]; fruit: (typeof fruits)[0] }[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const ids = [0, 1, 2].map((k) => idx.getX(t + k));
      const v = ids.map((i) => at(pos, i));
      const fruit = onSurface(v[0]);
      if (fruit && v.every((p) => onSurface(p) === fruit)) out.push({ v, n: ids.map((i) => at(nrm, i)), fruit });
    }
    return out;
  }

  it.each([3, 6, 14, 24])('faces outward with finite data at %i segments', (segments) => {
    const geo = buildFruitGeometry(fruits, segments, [0.8, 0.2, 0.1]);
    const pos = geo.getAttribute('position');
    expect(geo.index!.count % 3).toBe(0);
    expect(geo.getAttribute('color').count).toBe(pos.count);
    for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    const tris = bodyTriangles(geo);
    expect(tris.length).toBeGreaterThan(fruits.length * 4);
    for (const { v: [a, b, c], fruit: f } of tris) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const o = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3 - f.center[k]);
      expect(n[0] * o[0] + n[1] * o[1] + n[2] * o[2]).toBeGreaterThan(0);
    }
  });

  it('flat-shades low segment counts, smooth-shades high ones, and is empty without fruit', () => {
    const same = (n: V[]) => n.every((x) => x.every((c, k) => Math.abs(c - n[0][k]) < 1e-6));
    expect(bodyTriangles(buildFruitGeometry(fruits, FACETED_MAX_SEGMENTS, [1, 0, 0])).every((t) => same(t.n))).toBe(true);
    expect(bodyTriangles(buildFruitGeometry(fruits, 16, [1, 0, 0])).some((t) => !same(t.n))).toBe(true);
    expect(buildFruitGeometry([], 12, [1, 0, 0]).index!.count).toBe(0);
  });
});

describe('fruit in the pipeline and batches', () => {
  it('leaves bark and leaves unchanged when fruit is switched on', () => {
    const off = generateTree({ ...PRESETS.Shrub.params, fruit: { ...base, enabled: false } });
    const on = generateTree({ ...PRESETS.Shrub.params, fruit: { ...base, enabled: true, density: 0.5 } });
    expect(off.fruitCount).toBe(0);
    expect(off.fruit.index!.count).toBe(0);
    expect(on.fruitCount).toBeGreaterThan(0);
    expect(on.bark.getAttribute('position').array).toEqual(off.bark.getAttribute('position').array);
    expect(on.leaves.getAttribute('position').array).toEqual(off.leaves.getAttribute('position').array);
  });

  it('gives the Apple preset fruit', () => {
    expect(generateTree(PRESETS.Apple.params).fruitCount).toBeGreaterThan(20);
  });

  it('makes exactly round(count * chance) trees fruit, deterministically', () => {
    expect(fruitingIndices(20, 0.1, 7).size).toBe(2);
    expect(fruitingIndices(20, 0.1, 7)).toEqual(fruitingIndices(20, 0.1, 7));
    expect(fruitingIndices(50, 0, 7).size).toBe(0);
    expect(fruitingIndices(50, 1, 7).size).toBe(50);
    const variants = batchVariants(PRESETS.Oak.params, { count: 40, seedMode: 'sequential', variation: 0, fruitChance: 0.25 });
    expect(variants.filter((v) => v.params.fruit.enabled)).toHaveLength(10);
  });

  it('keeps the base fruit setting when no chance is given', () => {
    const variants = batchVariants(PRESETS.Apple.params, { count: 5, seedMode: 'sequential', variation: 0 });
    expect(variants.every((v) => v.params.fruit.enabled)).toBe(true);
  });
});
