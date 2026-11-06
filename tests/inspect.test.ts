import { describe, expect, it } from 'vitest';
import { colonize, sampleAttractors } from '../src/core/colonize';
import { Crown, type CrownShape } from '../src/core/crown';
import { growTree } from '../src/core/growth';
import { OUTSIDE_TOLERANCE, envelopeDepth, inspectTree } from '../src/core/inspect';
import { mulberry32, unitVector, type Vec3 } from '../src/core/rng';
import { PRESETS } from '../src/presets';

const oak = PRESETS.Oak.params;

describe('envelope depth', () => {
  it.each<CrownShape>(['sphere', 'umbrella'])('is 0 on the %s surface, negative inside, positive outside', (shape) => {
    const crown = new Crown({ ...oak.crown, shape, stretch: 1.4, seed: 11 });
    const rng = mulberry32(5);
    for (let i = 0; i < 60; i++) {
      const s = crown.point(unitVector(rng));
      expect(envelopeDepth(crown, s)).toBeCloseTo(0, 6);
      expect(envelopeDepth(crown, along(crown, s, 0.5))).toBeCloseTo(-0.5, 6);
      expect(envelopeDepth(crown, along(crown, s, 1.2))).toBeCloseTo(0.2, 6);
    }
    expect(envelopeDepth(crown, crown.center)).toBe(-1);
  });

  it('measures a folded cone against its outermost surface', () => {
    const crown = new Crown({ ...oak.crown, shape: 'cone', stretch: 1.4, seed: 11 });
    const rng = mulberry32(5);
    let onSurface = 0;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const d = unitVector(rng);
      // Away from the open apex and base discs, where no ray meets the surface.
      if (Math.abs(d[1]) > 0.9) continue;
      const s = crown.point(d);
      const depth = envelopeDepth(crown, s);
      // On the surface, or on an inner fold of it: never outside.
      expect(depth).toBeLessThan(1e-4);
      // Depth is linear along the ray.
      expect(envelopeDepth(crown, along(crown, s, 1.5))).toBeCloseTo(1.5 * (1 + depth) - 1, 4);
      total++;
      if (Math.abs(depth) < 1e-4) onSurface++;
    }
    expect(onSurface / total).toBeGreaterThan(0.8);
  });
});

/** The point k times as far from the crown centre as p, on the same ray. */
function along(crown: Crown, p: Vec3, k: number): Vec3 {
  const c = crown.center;
  return [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k, c[2] + (p[2] - c[2]) * k];
}

describe('inspectTree', () => {
  const crown = new Crown({ ...oak.crown, seed: oak.seed });

  it('finds the joints, ends and bases of a colonised tree', () => {
    const attractors = sampleAttractors(crown, 800, oak.tips.cut, oak.seed);
    const graph = colonize(attractors, crown.center, {
      ...oak.colonize,
      tipRadius: oak.growth.tipRadius,
      pipeExponent: oak.growth.pipeExponent,
      thickening: oak.growth.thickening,
      gnarl: oak.growth.gnarl,
      seed: oak.seed,
    });
    const report = inspectTree(crown, graph, attractors, graph.unreached);
    expect(report.ends.length).toBe(graph.tips.length);
    expect(report.joints.length).toBe(graph.nodes.filter((n) => n.children.length >= 2).length);
    expect(report.joints.length).toBeGreaterThan(10);
    expect(report.bases).toHaveLength(1);
    expect(report.bases[0].pos).toEqual([0, 0, 0]);
    expect(report.outside).toBe(report.ends.filter((e) => e.depth > OUTSIDE_TOLERANCE).length);
    // Attractors fill the volume, so the branches chasing them end inside it, give or take a step.
    expect(report.outside / report.ends.length).toBeLessThan(0.2);
    // Unreached attractors are the ones still alive: none of them is within the kill distance of a node.
    for (const p of report.unreached) {
      const near = graph.nodes.some((n) => Math.hypot(n.pos[0] - p[0], n.pos[1] - p[1], n.pos[2] - p[2]) <= oak.colonize.kill);
      expect(near).toBe(false);
    }
  });

  it('reports sweep tips below the first layer as unreached', () => {
    const h = oak.growth.layerHeight;
    const tips: Vec3[] = [
      [0.5, 6, 0],
      [-0.5, 6.2, 0.3],
      [1, h * 0.5, 0],
    ];
    const graph = growTree(tips, crown.center, { ...oak.growth, seed: 1 });
    expect(graph.unreached).toEqual([2]);
    expect(inspectTree(crown, graph, tips, graph.unreached).unreached).toEqual([tips[2]]);
  });
});
