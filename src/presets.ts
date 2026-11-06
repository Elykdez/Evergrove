import type { LeafShape } from './mesh/textures';
import type { TreeParams } from './tree';

export interface Look {
  leafShape: LeafShape;
  barkColor: string;
}

export interface Preset {
  params: TreeParams;
  look: Look;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const base: Preset = {
  look: { leafShape: 'oval', barkColor: '#6b5544' },
  params: {
    seed: 7,
    triangleBudget: 0,
    algorithm: 'colonize',
    colonize: { attractors: 2600, influence: 1.5, kill: 0.28, step: 0.16, tropism: 0.12, maxIterations: 500 },
    crown: {
      shape: 'sphere',
      radius: 3.2,
      centerHeight: 6,
      stretch: 0.85,
      offsetX: 0,
      offsetZ: 0,
      sphereTaper: 0,
      sphereSquareness: 2,
      umbrellaUnderside: 0.45,
      umbrellaRim: -0.125,
      umbrellaSoftness: 0.75,
      noiseAmount: 0.18,
      spectralSlope: 1.6,
      modes: 48,
      minFrequency: 0.6,
      maxFrequency: 6,
    },
    tips: { count: 900, cut: -0.35, depth: 0.35, jitter: 0.08 },
    growth: {
      layerHeight: 0.12,
      branchAngle: 55,
      mergeRadius: 0.9,
      trunkPull: 0.9,
      crownPull: 0.08,
      tipRadius: 0.012,
      pipeExponent: 2.4,
      thickening: 0.004,
      gnarl: 0.25,
    },
    shape: { smoothIterations: 3, smoothStrength: 0.5, simplifyAngle: 4, gravity: 0.2 },
    bark: { radialSegments: 14, rootCount: 5, rootLength: 3.5, barkTiling: 1, subdivisions: 3 },
    leaves: {
      perTip: 6,
      twigDensity: 18,
      twigRadius: 0.04,
      size: 0.2,
      sizeJitter: 0.25,
      aspect: 0.6,
      cluster: 0.18,
      droop: 0.2,
      fold: 0.25,
      hue: 0.27,
      hueJitter: 0.03,
      season: 0,
    },
    fruit: {
      enabled: false,
      density: 0.3,
      size: 0.045,
      sizeJitter: 0.15,
      segments: 14,
      elongation: 1,
      hang: 0.05,
      color: '#c8302a',
      colorRange: 0.05,
    },
  },
};

function merge<T>(target: T, patch: DeepPartial<T>): T {
  const out = structuredClone(target) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v as DeepPartial<unknown>) : v;
  }
  return out as T;
}

const variant = (patch: DeepPartial<Preset>): Preset => merge(base, patch);

export const PRESETS: Record<string, Preset> = {
  Oak: base,
  Maple: variant({
    look: { leafShape: 'maple', barkColor: '#5d5048' },
    params: {
      seed: 21,
      crown: { radius: 3, centerHeight: 5.6, stretch: 0.95, noiseAmount: 0.24 },
      leaves: { size: 0.2, aspect: 0.95, perTip: 5, season: 0.85, fold: 0.15 },
    },
  }),
  Conifer: variant({
    look: { leafShape: 'lance', barkColor: '#5a4033' },
    params: {
      seed: 3,
      crown: { shape: 'cone', radius: 2.3, centerHeight: 6.8, stretch: 2.3, noiseAmount: 0.08, spectralSlope: 2 },
      tips: { count: 1400, cut: -0.85, depth: 0.15 },
      algorithm: 'sweep',
      shape: { gravity: 0.3, smoothIterations: 2 },
      growth: {
        layerHeight: 0.1,
        branchAngle: 76,
        mergeRadius: 0.35,
        trunkPull: 1,
        crownPull: 0.75,
        tipRadius: 0.008,
        pipeExponent: 2.2,
        gnarl: 0.08,
      },
      leaves: { size: 0.14, aspect: 0.2, perTip: 12, twigDensity: 30, cluster: 0.12, hue: 0.37, droop: 0.4, fold: 0.1 },
    },
  }),
  Acacia: variant({
    look: { leafShape: 'round', barkColor: '#6e5a48' },
    params: {
      seed: 11,
      crown: { shape: 'umbrella', radius: 4.6, centerHeight: 5.6, stretch: 0.45, noiseAmount: 0.12 },
      tips: { count: 800, cut: 0, depth: 0.1 },
      colonize: { attractors: 2200, influence: 2, kill: 0.3, tropism: 0.35 },
      shape: { gravity: 0.05 },
      growth: { branchAngle: 50, mergeRadius: 1.6, trunkPull: 0.7, gnarl: 0.45 },
      bark: { rootCount: 4 },
      leaves: { size: 0.09, aspect: 0.7, perTip: 10, hue: 0.24, droop: 0.05 },
    },
  }),
  Poplar: variant({
    look: { leafShape: 'round', barkColor: '#8a8478' },
    params: {
      seed: 5,
      crown: { radius: 1.6, centerHeight: 7, stretch: 2.6 },
      tips: { count: 900, cut: -0.6 },
      colonize: { influence: 1.1, tropism: 0.45 },
      shape: { gravity: 0.05 },
      growth: { branchAngle: 35, mergeRadius: 0.6, trunkPull: 1 },
      leaves: { size: 0.12, aspect: 0.85, hue: 0.28 },
    },
  }),
  Willow: variant({
    look: { leafShape: 'lance', barkColor: '#5f5649' },
    params: {
      seed: 14,
      colonize: { attractors: 2800, influence: 1.6, tropism: 0.15, step: 0.15 },
      shape: { gravity: 1.3 },
      crown: { radius: 3.2, centerHeight: 4.6, stretch: 0.9, noiseAmount: 0.14 },
      tips: { cut: -0.75 },
      growth: { gnarl: 0.15 },
      leaves: { size: 0.2, aspect: 0.22, perTip: 9, twigDensity: 26, droop: 0.85, hue: 0.25, fold: 0.1 },
    },
  }),
  Apple: variant({
    look: { leafShape: 'oval', barkColor: '#5b4a3c' },
    params: {
      seed: 4,
      crown: { radius: 2.6, centerHeight: 3.4, stretch: 0.75, noiseAmount: 0.16 },
      colonize: { attractors: 2200, influence: 1.4, tropism: 0.02 },
      shape: { gravity: 0.35 },
      growth: { gnarl: 0.4 },
      bark: { rootCount: 3 },
      leaves: { size: 0.17, aspect: 0.55, perTip: 9, twigDensity: 26, cluster: 0.2, hue: 0.28 },
      fruit: { enabled: true, density: 0.45, size: 0.04, color: '#c42a22', colorRange: 0.06 },
    },
  }),
  Shrub: variant({
    params: {
      seed: 9,
      crown: { radius: 1.6, centerHeight: 1.6, stretch: 0.8 },
      tips: { count: 700, cut: -0.2 },
      algorithm: 'sweep',
      growth: { branchAngle: 45, mergeRadius: 0.5, trunkPull: 0.15, tipRadius: 0.008, layerHeight: 0.06 },
      bark: { rootCount: 0 },
      leaves: { size: 0.1, perTip: 7, cluster: 0.12 },
    },
  }),
};
