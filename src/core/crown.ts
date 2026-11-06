import { Rng, Vec3, clamp, mulberry32, normalize, smoothstep, unitVector } from './rng';

export type CrownShape = 'sphere' | 'cone' | 'umbrella';

export interface CrownParams {
  shape: CrownShape;
  /** Base radius of the crown envelope, world units (metres). */
  radius: number;
  /** Height of the crown centre above the ground. */
  centerHeight: number;
  /** Vertical scale of the envelope; above 1 is tall and narrow. */
  stretch: number;
  /** Crown placement relative to the trunk base; non-zero leans the tree. */
  offsetX: number;
  offsetZ: number;
  /**
   * Sphere only: -1..1. Positive pulls the top in and pushes the bottom out (an egg standing on
   * its wide end); negative does the opposite. 0 is a plain sphere.
   */
  sphereTaper: number;
  /**
   * Sphere only: superellipse exponent between height and width. 2 is round, higher is boxier
   * (flat top and sides), lower is pointier (a diamond at 1).
   */
  sphereSquareness: number;
  /** Umbrella only: width of the underside relative to the canopy top, 0..1. */
  umbrellaUnderside: number;
  /** Umbrella only: direction height (d.y, -1..1) where the underside turns into the canopy. */
  umbrellaRim: number;
  /** Umbrella only: how gradual that turn is, as a span of d.y. Small is a sharp brim. */
  umbrellaSoftness: number;
  /** Relative radius displacement from the spectral noise (0 = smooth envelope). */
  noiseAmount: number;
  /** Spectral slope beta: amplitude ~ f^-beta. Higher is smoother, lower is rougher. */
  spectralSlope: number;
  /** Number of random Fourier modes summed. */
  modes: number;
  minFrequency: number;
  maxFrequency: number;
  seed: number;
}

export interface SpectralMode {
  /** Unit wave direction. */
  w: Vec3;
  /** Frequency in cycles across the unit direction sphere. */
  f: number;
  /** Amplitude, f^-beta. */
  a: number;
  phase: number;
}

/**
 * Crown envelope: a base shape whose radius is displaced by spectral noise.
 * <p>
 * The noise is a sum of random plane waves with a power-law spectrum (amplitude ~ f^-beta), the
 * same synthesis an inverse FFT of a 1/f^beta spectrum performs, but evaluated directly on the
 * direction sphere so there are no seams or pole artefacts.
 */
export class Crown {
  readonly center: Vec3;
  readonly spectrum: SpectralMode[];
  /** Noise normalisation (sqrt of the summed mode variance); the GPU envelope view needs it too. */
  readonly norm: number;

  constructor(readonly p: CrownParams) {
    this.center = [p.offsetX, p.centerHeight, p.offsetZ];
    const rng: Rng = mulberry32(p.seed);
    const lo = Math.max(0.05, Math.min(p.minFrequency, p.maxFrequency));
    const hi = Math.max(lo + 1e-3, p.maxFrequency);
    this.spectrum = [];
    let variance = 0;
    for (let i = 0; i < Math.max(0, Math.round(p.modes)); i++) {
      // Log-uniform frequencies cover every octave evenly, as FFT bins do on a log axis.
      const f = lo * Math.pow(hi / lo, rng());
      const a = Math.pow(f, -p.spectralSlope);
      this.spectrum.push({ w: unitVector(rng), f, a, phase: rng() * Math.PI * 2 });
      variance += (a * a) / 2;
    }
    // Normalise to unit variance so noiseAmount reads the same for any slope or mode count.
    this.norm = variance > 0 ? Math.sqrt(variance) : 1;
  }

  /** Base envelope radius factor for a unit direction, before noise. */
  profile(d: Vec3): number {
    const y = d[1];
    switch (this.p.shape) {
      case 'cone':
        // Horizontal width only (see point): full at the base, tapering to the apex.
        return 0.03 + 0.97 * (1 - smoothstep(-1, 1, y));
      case 'umbrella':
        return umbrellaProfile(y, this.p.umbrellaUnderside, this.p.umbrellaRim, this.p.umbrellaSoftness);
      default:
        return sphereProfile(y, this.p.sphereTaper, this.p.sphereSquareness);
    }
  }

  noise(d: Vec3): number {
    let s = 0;
    for (const m of this.spectrum) {
      const t = m.w[0] * d[0] + m.w[1] * d[1] + m.w[2] * d[2];
      s += m.a * Math.sin(2 * Math.PI * m.f * t + m.phase);
    }
    return s / this.norm;
  }

  radiusAt(d: Vec3): number {
    const r = this.profile(d) * (1 + this.p.noiseAmount * this.noise(d));
    return Math.max(0.15, r) * this.p.radius;
  }

  /** Surface point for a direction (normalised internally). */
  point(dir: Vec3, depth = 0): Vec3 {
    const d = normalize(dir);
    if (this.p.shape === 'cone') {
      // A true cone: height comes straight from d.y and only the width tapers. Scaling the whole
      // ray, as the other shapes do, would also squash the apex down into a dome.
      const flat = Math.hypot(d[0], d[2]);
      const u: Vec3 = flat > 1e-6 ? [d[0] / flat, 0, d[2] / flat] : [1, 0, 0];
      const k = 1 - depth;
      const w = this.radiusAt(d) * k;
      const h = d[1] * this.p.radius * this.p.stretch * k;
      return [this.center[0] + u[0] * w, this.center[1] + h, this.center[2] + u[2] * w];
    }
    const r = this.radiusAt(d) * (1 - depth);
    return [this.center[0] + d[0] * r, this.center[1] + d[1] * r * this.p.stretch, this.center[2] + d[2] * r];
  }
}

/**
 * Sphere radius factor for a unit direction with height y. Taper scales the radius linearly with
 * y; squareness is a superellipse |w|^n + |y|^n = 1 between the horizontal and vertical parts of
 * the direction. render/debug.ts evaluates the same formula on the GPU.
 */
export function sphereProfile(y: number, taper: number, squareness: number): number {
  const tapered = 1 - 0.5 * clamp(taper, -1, 1) * y;
  // The defaults are exact: no rounding drift for existing presets and seeds.
  if (squareness === 2) return tapered;
  const n = Math.max(0.5, squareness);
  const w = Math.sqrt(Math.max(0, 1 - y * y));
  return tapered * Math.pow(Math.pow(w, n) + Math.pow(Math.abs(y), n), -1 / n);
}

/**
 * Umbrella radius factor: the underside width below the rim, full width above it, blended by a
 * smoothstep centred on the rim. Defaults (0.45, -0.125, 0.75) give the original 0.45 + 0.55 *
 * smoothstep(-0.5, 0.25, y).
 */
export function umbrellaProfile(y: number, underside: number, rim: number, softness: number): number {
  const u = clamp(underside, 0, 1);
  const half = Math.max(0.01, softness) / 2;
  return u + (1 - u) * smoothstep(rim - half, rim + half, y);
}

/**
 * Branch tips on the crown: Fibonacci-sphere directions (even coverage), jittered, optionally
 * pushed inside the envelope so leaves fill a volume instead of a shell. Directions below
 * <paramref name="cut"/> (d.y) are skipped: the underside of a crown carries no foliage.
 */
export function sampleTips(crown: Crown, count: number, cut: number, depth: number, jitter: number, seed: number): Vec3[] {
  const rng = mulberry32(seed ^ 0x51ed270b);
  const keep = Math.max(0.02, (1 - cut) / 2);
  const total = Math.ceil(count / keep);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const tips: Vec3[] = [];
  for (let i = 0; i < total && tips.length < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / total;
    if (y < cut) continue;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    const j = unitVector(rng);
    const d: Vec3 = [r * Math.cos(a) + j[0] * jitter, y + j[1] * jitter, r * Math.sin(a) + j[2] * jitter];
    const p = crown.point(d, depth * rng());
    if (p[1] > 0.05) tips.push(p);
  }
  return tips;
}
