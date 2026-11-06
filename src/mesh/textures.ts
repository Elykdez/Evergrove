/**
 * Leaf outline definitions shared by the GPU texture baker (src/render/textures.ts). Pure data and
 * math, no DOM or GPU, so the outline can be checked in Node.
 */
export type LeafShape = 'oval' | 'lance' | 'round' | 'maple';

export interface ShapeDef {
  /**
   * Half width at the widest point, as a fraction of leaf length. Every shape fills the texture
   * width; the card aspect sets the real proportions, so narrow leaves do not shrink to slivers.
   */
  width: number;
  /** Skews the widest point: below 1 toward the stem, above 1 toward the tip. */
  skew: number;
  /** Fullness of the outline; below 1 is rounder, above 1 is more pointed. */
  power: number;
  /** Edge teeth count and depth. */
  teeth: number;
  serration: number;
  /** Maple-style lobes. */
  lobes: number;
  veins: number;
}

export const SHAPES: Record<LeafShape, ShapeDef> = {
  oval: { width: 0.44, skew: 0.85, power: 0.75, teeth: 26, serration: 0.03, lobes: 0, veins: 7 },
  lance: { width: 0.44, skew: 0.8, power: 1.1, teeth: 34, serration: 0.04, lobes: 0, veins: 9 },
  round: { width: 0.46, skew: 1.0, power: 0.55, teeth: 20, serration: 0.02, lobes: 0, veins: 6 },
  maple: { width: 0.46, skew: 1.05, power: 0.6, teeth: 40, serration: 0.05, lobes: 5, veins: 5 },
};

/** Leaf layout inside a square texture of the given size, in pixels (y down, petiole at the bottom). */
export function leafLayout(size: number) {
  const base = size * 0.9;
  const tip = size * 0.04;
  return { cx: size / 2, base, tip, len: base - tip };
}

/**
 * Half width of the blade at t (0 petiole, 1 tip), as a fraction of leaf length. The shader
 * evaluates the same formula per pixel; this copy places the veins.
 */
export function halfWidth(def: ShapeDef, t: number): number {
  const tc = Math.min(1, Math.max(0, t));
  let w = def.width * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(tc, def.skew))), def.power);
  if (def.lobes > 0) w *= 0.55 + 0.45 * Math.pow(Math.abs(Math.cos(def.lobes * Math.PI * tc * 0.5)), 0.6);
  w *= 1 + def.serration * (Math.abs(Math.sin(def.teeth * Math.PI * tc)) - 0.5);
  return Math.max(0, w);
}
