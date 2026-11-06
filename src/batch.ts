import { mulberry32 } from './core/rng';
import type { TreeParams } from './tree';

/**
 * sequential: seed, seed + 1, seed + 2, ... (the first tree is the one on screen).
 * hashed: seeds drawn from mulberry32(seed), scattered over the whole range.
 */
export type SeedMode = 'sequential' | 'hashed';

export interface BatchOptions {
  count: number;
  seedMode: SeedMode;
  /** 0 keeps every parameter; 0.2 jitters the shape scalars by up to about 20 %. */
  variation: number;
  /**
   * Fraction of trees that bear fruit, 0..1; exactly round(count * fruitChance) of them, picked
   * by seed. Fruit look comes from the base params. Leave undefined to keep base.fruit.enabled.
   */
  fruitChance?: number;
}

export interface Variant {
  index: number;
  seed: number;
  params: TreeParams;
}

export const MAX_BATCH = 500;
/** Seeds stay inside the GUI seed slider range. */
export const SEED_RANGE = 1_000_000;

type Group = 'crown' | 'colonize' | 'growth' | 'leaves' | 'fruit';

/**
 * Scalars that "variation" jitters, clamped to their GUI slider range.
 * scale multiplies by (1 + u * variation); shift adds u * variation * span, with u in [-1, 1].
 */
const JITTER: { group: Group; key: string; kind: 'scale' | 'shift'; span: number; min: number; max: number }[] = [
  { group: 'crown', key: 'radius', kind: 'scale', span: 1, min: 0.5, max: 8 },
  { group: 'crown', key: 'centerHeight', kind: 'scale', span: 1, min: 1, max: 15 },
  { group: 'crown', key: 'stretch', kind: 'scale', span: 1, min: 0.3, max: 3.5 },
  { group: 'crown', key: 'noiseAmount', kind: 'scale', span: 1, min: 0, max: 0.6 },
  { group: 'crown', key: 'offsetX', kind: 'shift', span: 1, min: -4, max: 4 },
  { group: 'crown', key: 'offsetZ', kind: 'shift', span: 1, min: -4, max: 4 },
  { group: 'colonize', key: 'tropism', kind: 'shift', span: 0.5, min: -1, max: 1 },
  { group: 'growth', key: 'gnarl', kind: 'shift', span: 0.5, min: 0, max: 1 },
  { group: 'leaves', key: 'size', kind: 'scale', span: 1, min: 0.03, max: 0.5 },
  { group: 'leaves', key: 'droop', kind: 'shift', span: 0.5, min: 0, max: 1 },
  { group: 'leaves', key: 'hue', kind: 'shift', span: 0.1, min: 0, max: 1 },
  { group: 'fruit', key: 'size', kind: 'scale', span: 1, min: 0.01, max: 0.2 },
];

export function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_BATCH, Math.round(count) || 1));
}

export function batchSeeds(start: number, count: number, mode: SeedMode): number[] {
  const n = clampCount(count);
  if (mode === 'sequential') return Array.from({ length: n }, (_, i) => (start + i) % SEED_RANGE);
  const rng = mulberry32(start ^ 0x1b873593);
  const seen = new Set<number>();
  while (seen.size < n) seen.add(Math.floor(rng() * SEED_RANGE));
  return [...seen];
}

/**
 * Which batch positions bear fruit: exactly round(count * chance) of them, chosen by a seeded
 * shuffle so they are spread through the batch rather than bunched at the start.
 */
export function fruitingIndices(count: number, chance: number, seed: number): Set<number> {
  const n = clampCount(count);
  const k = Math.round(n * Math.min(1, Math.max(0, chance)));
  const order = Array.from({ length: n }, (_, i) => i);
  const rng = mulberry32(seed ^ 0x27d4eb2f);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (n - i));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Set(order.slice(0, k));
}

/** Deterministic: the same base params and options always give the same variants. */
export function batchVariants(base: TreeParams, options: BatchOptions): Variant[] {
  const amount = Math.max(0, options.variation);
  const fruiting =
    options.fruitChance === undefined ? null : fruitingIndices(options.count, options.fruitChance, base.seed);
  return batchSeeds(base.seed, options.count, options.seedMode).map((seed, index) => {
    const params: TreeParams = structuredClone(base);
    params.seed = seed;
    if (fruiting) params.fruit.enabled = fruiting.has(index);
    if (amount > 0) {
      // Keyed on the tree's own seed, so one tree does not depend on its position in the batch.
      const rng = mulberry32(seed ^ 0x5bd1e995);
      for (const j of JITTER) {
        const group = params[j.group] as unknown as Record<string, number>;
        const u = rng() * 2 - 1;
        const v = j.kind === 'scale' ? group[j.key] * (1 + u * amount) : group[j.key] + u * amount * j.span;
        group[j.key] = Math.min(j.max, Math.max(j.min, v));
      }
    }
    return { index, seed, params };
  });
}

/** "007-tree-oak-123456": the index prefix keeps files in batch order and unique. */
export function variantName(prefix: string, variant: Variant, count: number): string {
  const width = String(clampCount(count)).length;
  return `${String(variant.index + 1).padStart(width, '0')}-${prefix}-${variant.seed}`;
}
