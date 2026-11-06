import { describe, expect, it } from 'vitest';
import { colonize, sampleAttractors } from '../src/core/colonize';
import { Crown, sampleTips } from '../src/core/crown';
import { applyGravity } from '../src/core/gravity';
import { growTree, simplifyTree, smoothTree, type GrowthParams } from '../src/core/growth';
import { mulberry32 } from '../src/core/rng';
import { buildBarkGeometry } from '../src/mesh/bark';
import { buildLeafGeometry } from '../src/mesh/leaves';
import { PRESETS } from '../src/presets';

const oak = PRESETS.Oak.params;
const crown = new Crown({ ...oak.crown, seed: oak.seed });
const tips = sampleTips(crown, 400, oak.tips.cut, oak.tips.depth, oak.tips.jitter, oak.seed);
const growth: GrowthParams = { ...oak.growth, seed: oak.seed };

describe('crown', () => {
  it('is deterministic per seed and stays positive', () => {
    const again = new Crown({ ...oak.crown, seed: oak.seed });
    for (let i = 0; i < 50; i++) {
      const d: [number, number, number] = [Math.cos(i), Math.sin(i * 0.7), Math.sin(i)];
      expect(crown.radiusAt(d)).toBeGreaterThan(0);
      expect(again.point(d)).toEqual(crown.point(d));
    }
  });

  it('keeps the noise at unit variance whatever the slope', () => {
    for (const slope of [0, 1.5, 3]) {
      const c = new Crown({ ...oak.crown, spectralSlope: slope, seed: 3 });
      const rng = mulberry32(1);
      let sum = 0;
      let sq = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const v = c.noise([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
        sum += v;
        sq += v * v;
      }
      const variance = sq / n - (sum / n) ** 2;
      expect(variance).toBeGreaterThan(0.3);
      expect(variance).toBeLessThan(2);
    }
  });

  it('samples the requested tip count above the cut', () => {
    expect(tips.length).toBe(400);
    for (const t of tips) expect(t[1]).toBeGreaterThan(0);
  });
});

describe('growth', () => {
  const graph = growTree(tips, crown.center, growth);

  it('connects every tip to a root on the ground', () => {
    expect(graph.tips.length).toBe(tips.length);
    for (const t of graph.tips) {
      let id = t;
      let guard = 0;
      while (graph.nodes[id].parent >= 0 && guard++ < 10000) id = graph.nodes[id].parent;
      expect(graph.roots).toContain(id);
      expect(graph.nodes[id].pos[1]).toBeCloseTo(0, 6);
    }
  });

  it('converges into a single trunk with a strong pull', () => {
    expect(graph.roots.length).toBe(1);
  });

  it('grows several stems when the trunk pull is off', () => {
    const shrub = growTree(tips, crown.center, { ...growth, trunkPull: 0, mergeRadius: 0.3 });
    expect(shrub.roots.length).toBeGreaterThan(1);
  });

  it('follows the pipe model at every fork', () => {
    const e = growth.pipeExponent;
    for (const n of graph.nodes) {
      if (n.children.length < 2) continue;
      const sum = n.children.reduce((s, c) => s + Math.pow(graph.nodes[c].radius + growth.thickening * (graph.nodes[c].pos[1] - n.pos[1]), e), 0);
      expect(n.radius).toBeCloseTo(Math.pow(sum, 1 / e), 6);
    }
  });

  it('never leans past the branch angle', () => {
    const limit = Math.tan((growth.branchAngle * Math.PI) / 180) + 1e-6;
    for (const n of graph.nodes) {
      if (n.parent < 0) continue;
      const p = graph.nodes[n.parent].pos;
      const dy = n.pos[1] - p[1];
      expect(dy).toBeGreaterThan(0);
      // Merging recentres each member onto the fork by up to the overlap reach, which is bounded
      // by the merged (parent) radius, so allow that on top of the lean.
      const slack = Math.max(graph.nodes[n.parent].radius * 1.5, growth.layerHeight * 0.35);
      expect(Math.hypot(n.pos[0] - p[0], n.pos[2] - p[2])).toBeLessThanOrEqual(limit * dy + slack + 1e-9);
    }
  });

  it('simplifies without losing tips, forks or roots', () => {
    const copy = growTree(tips, crown.center, growth);
    smoothTree(copy, 3, 0.5);
    const simple = simplifyTree(copy, 4, 1);
    expect(simple.nodes.length).toBeLessThan(copy.nodes.length);
    expect(simple.tips.length).toBe(copy.tips.length);
    expect(simple.roots.length).toBe(copy.roots.length);
    for (const n of simple.nodes) {
      if (n.parent >= 0) expect(simple.nodes[n.parent].children).toContain(simple.nodes.indexOf(n));
    }
  });
});

describe('space colonisation', () => {
  const attractors = sampleAttractors(crown, 1200, oak.tips.cut, oak.seed);
  const params = {
    ...oak.colonize,
    tipRadius: oak.growth.tipRadius,
    pipeExponent: oak.growth.pipeExponent,
    thickening: oak.growth.thickening,
    gnarl: oak.growth.gnarl,
    seed: oak.seed,
  };
  const graph = colonize(attractors, crown.center, params);

  it('grows one connected tree from the origin', () => {
    expect(graph.roots).toEqual([0]);
    expect(graph.nodes[0].pos).toEqual([0, 0, 0]);
    for (let i = 1; i < graph.nodes.length; i++) {
      const parent = graph.nodes[i].parent;
      expect(parent).toBeGreaterThanOrEqual(0);
      expect(parent).toBeLessThan(i);
      expect(graph.nodes[parent].children).toContain(i);
    }
  });

  it('reaches into the crown and branches', () => {
    const top = Math.max(...graph.nodes.map((n) => n.pos[1]));
    expect(top).toBeGreaterThan(oak.crown.centerHeight);
    expect(graph.tips.length).toBeGreaterThan(50);
    expect(graph.nodes.filter((n) => n.children.length > 1).length).toBeGreaterThan(20);
  });

  it('assigns pipe-model radii from the tips down', () => {
    const e = params.pipeExponent;
    for (const n of graph.nodes) {
      if (n.children.length === 0) {
        expect(n.radius).toBe(params.tipRadius);
        continue;
      }
      const sum = n.children.reduce((s, c) => s + Math.pow(graph.nodes[c].radius, e), 0);
      expect(n.radius).toBeCloseTo(Math.pow(sum, 1 / e) + params.thickening * params.step, 9);
    }
    expect(graph.nodes[0].radius).toBe(Math.max(...graph.nodes.map((n) => n.radius)));
  });

  it('sags thin branches under gravity, keeping segment lengths', () => {
    const bent = colonize(attractors, crown.center, params);
    applyGravity(bent, 1.2, params.tipRadius * 6);
    const tipY = (g: typeof graph) => g.tips.reduce((s, t) => s + g.nodes[t].pos[1], 0) / g.tips.length;
    expect(tipY(bent)).toBeLessThan(tipY(graph) - 0.2);
    for (let i = 1; i < bent.nodes.length; i++) {
      const seg = (g: typeof graph) => {
        const a = g.nodes[i].pos;
        const b = g.nodes[g.nodes[i].parent].pos;
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      };
      expect(seg(bent)).toBeCloseTo(seg(graph), 6);
    }
    // The trunk is stiff: its base segment barely moves.
    expect(bent.nodes[1].pos[1]).toBeCloseTo(graph.nodes[1].pos[1], 2);
  });
});

describe('meshing', () => {
  const graph = simplifyTree(growTree(tips, crown.center, growth), 4, 1);

  it('builds finite bark and leaf geometry', () => {
    const bark = buildBarkGeometry(graph, oak.bark, mulberry32(1));
    const leaves = buildLeafGeometry(graph, crown.center, oak.leaves, mulberry32(2));
    for (const geo of [bark, leaves]) {
      const pos = geo.attributes.position.array as Float32Array;
      expect(pos.length).toBeGreaterThan(0);
      expect(pos.every(Number.isFinite)).toBe(true);
      const index = geo.index!.array;
      const count = geo.attributes.position.count;
      for (let i = 0; i < index.length; i++) expect(index[i]).toBeLessThan(count);
    }
    expect(leaves.attributes.color.count).toBe(leaves.attributes.position.count);
  });
});
