import type { TreeGraph } from './growth';
import { Rng, Vec3, mulberry32 } from './rng';

export interface FruitParams {
  enabled: boolean;
  /** Chance that a branch tip carries a fruit, 0..1. */
  density: number;
  /** Fruit radius, metres. */
  size: number;
  sizeJitter: number;
  /** Segments around the fruit: 3 to 8 reads as a faceted polygon, 16 and up as a smooth sphere. */
  segments: number;
  /** Vertical scale of the fruit: below 1 is flattened, above 1 elongated (pear, lemon). */
  elongation: number;
  /** Stem length between the twig tip and the fruit, metres. */
  hang: number;
  /** Base colour, sRGB hex. */
  color: string;
  /**
   * Per-tree colour threshold. Each tree shifts the hue by up to this fraction of the colour
   * wheel (and saturation and lightness by half as much); every fruit on that tree shares it.
   */
  colorRange: number;
}

export interface Fruit {
  /** Twig tip the stem hangs from. */
  stemTop: Vec3;
  /** Top of the fruit, where the stem meets it. */
  attach: Vec3;
  center: Vec3;
  /** Horizontal radius. */
  radius: number;
  /** Vertical half-height (radius * elongation). */
  height: number;
  /** Rotation about Y, so faceted fruit don't all line up. */
  spin: number;
}

/**
 * Hangs fruit below a random subset of branch tips. Every tip draws the same random numbers
 * whether or not it fruits, so changing the density adds or removes fruit without moving the rest.
 * Fruit that would reach into the ground are skipped.
 */
export function placeFruit(g: TreeGraph, p: FruitParams, rng: Rng): Fruit[] {
  if (!p.enabled || p.density <= 0 || p.size <= 0) return [];
  const fruits: Fruit[] = [];
  for (const id of g.tips) {
    const roll = rng();
    const jitter = rng() * 2 - 1;
    const spin = rng() * Math.PI * 2;
    const swayAngle = rng() * Math.PI * 2;
    const sway = rng() * 0.35 * p.hang;
    if (roll >= p.density) continue;
    const tip = g.nodes[id].pos;
    const radius = p.size * Math.max(0.2, 1 + jitter * p.sizeJitter);
    const height = radius * p.elongation;
    const attach: Vec3 = [tip[0] + Math.cos(swayAngle) * sway, tip[1] - p.hang, tip[2] + Math.sin(swayAngle) * sway];
    const center: Vec3 = [attach[0], attach[1] - height, attach[2]];
    if (center[1] - height < 0) continue;
    fruits.push({ stemTop: tip, attach, center, radius, height, spin });
  }
  return fruits;
}

/** The one colour every fruit on this tree shares, as sRGB 0..1. Deterministic per seed. */
export function fruitColor(p: FruitParams, seed: number): Vec3 {
  const [h, s, l] = rgbToHsl(hexToRgb(p.color));
  const rng = mulberry32(seed ^ 0x3c6ef372);
  const u = () => rng() * 2 - 1;
  const r = Math.max(0, p.colorRange);
  return hslToRgb([(((h + u() * r) % 1) + 1) % 1, clamp01(s + u() * r * 0.5), clamp01(l + u() * r * 0.5)]);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** "#rgb" or "#rrggbb" to sRGB 0..1; anything unparsable is mid grey. */
export function hexToRgb(hex: string): Vec3 {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0.5, 0.5, 0.5];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHsl([r, g, b]: Vec3): Vec3 {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]: Vec3): Vec3 {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}
