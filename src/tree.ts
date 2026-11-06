import * as THREE from 'three';
import {
  DetailLevel,
  LEAF_SHARE,
  MIN_DETAIL,
  barkDetail,
  clampBudget,
  fitDetail,
  fruitDetail,
  fruitKeep,
  leafDetail,
} from './core/budget';
import { ColonizeParams, colonize, sampleAttractors } from './core/colonize';
import { Crown, CrownParams, sampleTips } from './core/crown';
import { FruitParams, fruitColor, placeFruit } from './core/fruit';
import { applyGravity } from './core/gravity';
import { GrownTree, GrowthParams, TreeGraph, growTree, pruneTwigs, simplifyTree, smoothTree } from './core/growth';
import { Vec3, mulberry32 } from './core/rng';
import { BarkParams, buildBarkGeometry } from './mesh/bark';
import { buildFruitGeometry } from './mesh/fruit';
import { LeafParams, buildLeafGeometry } from './mesh/leaves';

export interface TipParams {
  count: number;
  /** Lowest crown direction (d.y) that carries tips; -1 is the whole envelope. */
  cut: number;
  /** Tips pushed up to this fraction inside the envelope. */
  depth: number;
  jitter: number;
}

export interface ShapeParams {
  smoothIterations: number;
  smoothStrength: number;
  /** Straight runs bending less than this are merged into one segment, degrees. */
  simplifyAngle: number;
  /** Branch sag under its own weight; thin branches bend most. Around 1 weeps. */
  gravity: number;
}

/**
 * colonize: space colonisation, growing up from the trunk toward attractors in the crown.
 * sweep: the 3D-print tree-support sweep, growing down from tips on the crown surface.
 */
export type GrowthAlgorithm = 'colonize' | 'sweep';

export interface TreeParams {
  seed: number;
  /** Upper limit on the tree's total triangles, 1000 to 10000; 0 means no limit. */
  triangleBudget: number;
  algorithm: GrowthAlgorithm;
  colonize: Omit<ColonizeParams, 'seed' | 'tipRadius' | 'pipeExponent' | 'thickening' | 'gnarl'>;
  crown: Omit<CrownParams, 'seed'>;
  tips: TipParams;
  growth: Omit<GrowthParams, 'seed'>;
  shape: ShapeParams;
  bark: BarkParams;
  leaves: LeafParams;
  fruit: FruitParams;
}

export interface TreeResult {
  crown: Crown;
  /** Crown samples that drove growth: attractors (colonize) or tips (sweep). */
  tips: Vec3[];
  /** Indices into tips that the growth never reached. */
  unreached: number[];
  graph: TreeGraph;
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  /** Empty (no triangles) when the tree bears no fruit. */
  fruit: THREE.BufferGeometry;
  fruitCount: number;
  /** Level of detail the meshes were built at (all 1 unless the budget cut them). */
  detail: DetailLevel;
  /** The budget was set and even the lowest detail could not meet it. */
  overBudget: boolean;
  millis: number;
}

export const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count / 3 : 0);

/** Crown envelope, tips, growth, cleanup, then meshing of bark, leaves and fruit. */
export function generateTree(p: TreeParams): TreeResult {
  const t0 = performance.now();
  const crown = new Crown({ ...p.crown, seed: p.seed });
  let tips: Vec3[];
  let graph: TreeGraph;
  let grown: GrownTree;
  if (p.algorithm === 'colonize') {
    tips = sampleAttractors(crown, p.colonize.attractors, p.tips.cut, p.seed);
    grown = colonize(tips, crown.center, {
      ...p.colonize,
      tipRadius: p.growth.tipRadius,
      pipeExponent: p.growth.pipeExponent,
      thickening: p.growth.thickening,
      gnarl: p.growth.gnarl,
      seed: p.seed,
    });
  } else {
    tips = sampleTips(crown, p.tips.count, p.tips.cut, p.tips.depth, p.tips.jitter, p.seed);
    grown = growTree(tips, crown.center, { ...p.growth, seed: p.seed });
  }
  const { unreached } = grown;
  graph = grown;
  applyGravity(graph, p.shape.gravity, p.growth.tipRadius * 6);
  smoothTree(graph, p.shape.smoothIterations, p.shape.smoothStrength);
  const segment = p.algorithm === 'colonize' ? p.colonize.step : p.growth.layerHeight;
  // simplifyTree copies its input, so the smoothed graph can be re-simplified per detail level.
  const smoothed = graph;
  const simplified = memo((angle: number) => simplifyTree(smoothed, angle, segment * 8));
  graph = simplified(p.shape.simplifyAngle);
  // Own random stream, so turning fruit on or off never changes the bark or leaves.
  const fruits = placeFruit(graph, p.fruit, mulberry32(p.seed ^ 0x7f4a7c15));
  const color = fruitColor(p.fruit, p.seed);

  // Each part is built from its discrete settings at a detail factor and cached under them, so the
  // budget search only rebuilds what actually changes. Every build reseeds its own stream.
  const barkAt = (d: number) => {
    const { keep, ...rest } = barkDetail(p.bark, p.shape.simplifyAngle, d);
    return { ...rest, tips: Math.max(1, Math.round(smoothed.tips.length * keep)) };
  };
  // Pruned twigs leave straight runs behind, so the bark is pruned first and simplified after.
  const barkGraph = memo((key: string) => {
    const [tips, angle] = key.split('|').map(Number);
    return tips >= smoothed.tips.length ? simplified(angle) : simplifyTree(pruneTwigs(smoothed, tips), angle, segment * 8);
  });
  // Leaves always grow on the full skeleton: the canopy stays put while the bark under it thins.
  const leafGraph = (d: number) => simplified(barkAt(d).simplifyAngle);
  const fruitAt = (d: number) => {
    const keep = fruitKeep(p.fruit.segments, d);
    return keep >= 1 ? fruits : fruits.filter((_, i) => Math.floor((i + 1) * keep) > Math.floor(i * keep));
  };
  const parts = {
    bark: cached(
      (d: number) => JSON.stringify(barkAt(d)),
      (d: number) => {
        const { simplifyAngle, tips, ...mesh } = barkAt(d);
        const g = barkGraph(`${tips}|${simplifyAngle}`);
        return buildBarkGeometry(g, { ...p.bark, ...mesh }, mulberry32(p.seed ^ 0x2545f491));
      },
    ),
    leaves: cached(
      (d: number) => `${d}|${barkAt(d).simplifyAngle}`,
      (d: number) =>
        buildLeafGeometry(leafGraph(d), crown.center, { ...p.leaves, ...leafDetail(p.leaves, d) }, mulberry32(p.seed ^ 0x68e31da4)),
    ),
    fruit: cached(
      (d: number) => `${fruitDetail(p.fruit.segments, d)}|${fruitAt(d).length}`,
      (d: number) => buildFruitGeometry(fruitAt(d), fruitDetail(p.fruit.segments, d), color),
    ),
  };
  const budget = clampBudget(p.triangleBudget || 0);
  const leafTris = (e: number) => triangles(parts.leaves.get(e)) + triangles(parts.fruit.get(e));
  // Pass 1 searches the bark level, predicting leaves and fruit as linear in the factor (they are,
  // up to rounding) so the search builds only bark. Pass 2 fixes the bark and fits leaves and fruit,
  // which scale smoothly, to whatever budget the bark's coarse steps (whole rings, sides) left.
  // While the bark is being cut, a share of the budget stays reserved for leaves and fruit.
  const full = leafTris(1);
  const reserve = Math.min(full, budget * LEAF_SHARE);
  const fit = fitDetail((d) => triangles(parts.bark.get(d)) + Math.max(full * d, reserve), budget, 10);
  const fill = budget > 0 ? fillLinear(leafTris, budget - triangles(parts.bark.get(fit.d)), MIN_DETAIL) : { d: 1, over: false };
  const bark = parts.bark.take(fit.d);
  const leaves = parts.leaves.take(fill.d);
  const fruit = parts.fruit.take(fill.d);

  return {
    crown,
    tips,
    unreached,
    graph,
    bark,
    leaves,
    fruit,
    fruitCount: fruitAt(fill.d).length,
    detail: { bark: fit.d, leaves: fill.d, fruit: fill.d },
    overBudget: budget > 0 && triangles(bark) + triangles(leaves) + triangles(fruit) > budget,
    millis: performance.now() - t0,
  };
}

/**
 * Largest factor e in [min, 1] with used(e) <= room, for a used() that is close to linear in e:
 * a proportional guess plus a few corrections, each one real build. Fruit facets step in whole
 * segments and leaf counts round per twig, so a bisection then closes whatever gap is left.
 */
function fillLinear(used: (e: number) => number, room: number, min: number): { d: number; over: boolean } {
  if (used(1) <= room) return { d: 1, over: false };
  let best = -1;
  let over = 1;
  let e = Math.min(1, Math.max(min, (room / Math.max(1, used(1))) * 0.995));
  const close = (v: number) => room - v <= room * 0.01;
  for (let i = 0; i < 4; i++) {
    const v = used(e);
    if (v <= room) {
      best = Math.max(best, e);
      if (close(v)) return { d: best, over: false };
    } else over = Math.min(over, e);
    const next = Math.min(1, Math.max(min, e * (room / Math.max(1, v)) * (v > room ? 0.99 : 1)));
    if (next === e) break;
    e = next;
  }
  if (best < 0 && used(min) > room) return { d: min, over: true };
  let lo = Math.max(best, min);
  for (let i = 0; i < 10 && !close(used(lo)); i++) {
    const mid = Math.sqrt(lo * over);
    if (used(mid) <= room) lo = mid;
    else over = mid;
  }
  return { d: lo, over: false };
}

function memo<K, V>(make: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, make(key));
    return cache.get(key)!;
  };
}

/** Geometry cache keyed by a part's discrete settings; take() keeps one result and frees the rest. */
function cached(key: (d: number) => string, build: (d: number) => THREE.BufferGeometry) {
  const cache = new Map<string, THREE.BufferGeometry>();
  const get = (d: number) => {
    const k = key(d);
    if (!cache.has(k)) cache.set(k, build(d));
    return cache.get(k)!;
  };
  return {
    get,
    take(d: number) {
      const keep = get(d);
      for (const g of cache.values()) if (g !== keep) g.dispose();
      cache.clear();
      return keep;
    },
  };
}
