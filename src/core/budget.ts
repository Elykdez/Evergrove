/**
 * Triangle budget. One detail factor d in (0, 1] drives every mesh's level of detail, and
 * fitDetail() searches for the largest d whose tree fits the budget. Detail goes down in stages:
 * tube resolution first, then harder path simplification, and at the lowest levels the thinnest
 * twigs are pruned from the bark. Leaves always come from the full skeleton, so the canopy keeps its
 * shape while the branches under it thin out; they get fewer and larger instead.
 */
export interface DetailLevel {
  bark: number;
  leaves: number;
  fruit: number;
}

export const FULL_DETAIL: Readonly<DetailLevel> = { bark: 1, leaves: 1, fruit: 1 };

/** Range of a set budget, triangles; 0 means no limit. */
export const MIN_BUDGET = 1000;
export const MAX_BUDGET = 10000;
/** Share of the budget kept for leaves and fruit while the bark is being cut, so they never starve. */
export const LEAF_SHARE = 0.4;
/** Smallest factor the search goes down to. */
export const MIN_DETAIL = 1e-4;
/** Leaves grow by at most this much to cover for their lower count. */
export const MAX_LEAF_GROWTH = 3;
/** Extra path simplification at the lowest detail, degrees on top of the preset's angle. */
export const MAX_EXTRA_SIMPLIFY = 40;

const clampDetail = (d: number) => Math.min(1, Math.max(MIN_DETAIL, d));

/** A set budget clamped to its range; 0 (or less) stays 0, no limit. */
export const clampBudget = (budget: number) => (budget > 0 ? Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, budget)) : 0);

/**
 * Bark tris ~ ring segments x rings. Segments and rings per segment (subdivisions + 1) both scale
 * by sqrt(d), so their product scales by d. Once the tube is down to 3 sides, lower d instead
 * simplifies the branch paths harder: nearly straight runs merge into single segments, which
 * removes rings while every fork and tip stays where it was. Halfway down that last stretch the
 * simplification is at its maximum, and below it `keep`, the fraction of twig tips the bark keeps,
 * falls in proportion to d: the thinnest twigs go first, and the root flares go with them.
 */
export function barkDetail(
  p: { radialSegments: number; subdivisions: number; rootCount: number },
  simplifyAngle: number,
  d: number,
) {
  const k = Math.sqrt(clampDetail(d));
  const floor = Math.min(1, 3 / Math.max(3, p.radialSegments));
  const s = k < floor ? k / floor : 1;
  const keep = Math.min(1, (2 * s) ** 2);
  return {
    radialSegments: Math.max(3, Math.round(p.radialSegments * k)),
    subdivisions: Math.max(0, Math.round((Math.round(p.subdivisions) + 1) * k) - 1),
    simplifyAngle: simplifyAngle + MAX_EXTRA_SIMPLIFY * Math.min(1, 2 * (1 - s)),
    keep,
    rootCount: Math.round(Math.round(p.rootCount) * keep),
  };
}

/**
 * Leaf tris are 4 per leaf, so the count scales by d. Each leaf grows by 1 / sqrt(d) (capped), which
 * keeps the canopy's total leaf area, and so its look from a distance, roughly constant.
 */
export function leafDetail(p: { perTip: number; twigDensity: number; size: number }, d: number) {
  const k = clampDetail(d);
  return {
    perTip: p.perTip * k,
    twigDensity: p.twigDensity * k,
    size: p.size * Math.min(MAX_LEAF_GROWTH, 1 / Math.sqrt(k)),
  };
}

/** Fruit tris ~ segments^2 (segments around, half as many rings). */
export function fruitDetail(segments: number, d: number) {
  return Math.max(3, Math.round(segments * Math.sqrt(clampDetail(d))));
}

/** Fraction of the fruit kept: all of it until the facets are down to 3, then in proportion to d. */
export function fruitKeep(segments: number, d: number) {
  const s = segments * Math.sqrt(clampDetail(d));
  return s >= 3 ? 1 : (s / 3) ** 2;
}

/**
 * Largest detail factor whose triangle total fits the budget, by bisection on log(d): totals step
 * in discrete jumps (whole rings and sides), so a single proportional cut lands well under the
 * budget, while a search fills it. `total` builds (or reuses) the meshes for a factor. Returns
 * over = true when even `min` does not fit; d is then `min`.
 */
export function fitDetail(
  total: (d: number) => number,
  budget: number,
  steps = 8,
  min = MIN_DETAIL,
): { d: number; over: boolean } {
  if (budget <= 0 || total(1) <= budget) return { d: 1, over: false };
  if (total(min) > budget) return { d: min, over: true };
  let lo = min;
  let hi = 1;
  for (let i = 0; i < steps; i++) {
    const mid = Math.sqrt(lo * hi);
    if (total(mid) <= budget) lo = mid;
    else hi = mid;
  }
  return { d: lo, over: false };
}
