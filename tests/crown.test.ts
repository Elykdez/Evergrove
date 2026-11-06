import { describe, expect, it } from 'vitest';
import { Crown, sphereProfile, umbrellaProfile } from '../src/core/crown';
import { envelopeDepth } from '../src/core/inspect';
import { mulberry32, smoothstep, unitVector } from '../src/core/rng';
import { PRESETS } from '../src/presets';

const oak = PRESETS.Oak.params;
const heights = Array.from({ length: 41 }, (_, i) => -1 + i / 20);

describe('crown profiles', () => {
  it('reproduce the original sphere and umbrella exactly at their defaults', () => {
    const { sphereTaper, sphereSquareness, umbrellaUnderside, umbrellaRim, umbrellaSoftness } = oak.crown;
    for (const y of heights) {
      expect(sphereProfile(y, sphereTaper, sphereSquareness)).toBe(1);
      expect(umbrellaProfile(y, umbrellaUnderside, umbrellaRim, umbrellaSoftness)).toBe(
        0.45 + 0.55 * smoothstep(-0.5, 0.25, y),
      );
    }
  });

  it('taper narrows the top and widens the bottom', () => {
    expect(sphereProfile(1, 0.6, 2)).toBeCloseTo(0.7, 12);
    expect(sphereProfile(-1, 0.6, 2)).toBeCloseTo(1.3, 12);
    expect(sphereProfile(0, 0.6, 2)).toBe(1);
    expect(sphereProfile(1, -0.6, 2)).toBeCloseTo(1.3, 12);
  });

  it('squareness bulges the diagonals out when boxy and pulls them in when pointy', () => {
    const diagonal = Math.SQRT1_2;
    expect(sphereProfile(diagonal, 0, 4)).toBeGreaterThan(1.15);
    expect(sphereProfile(diagonal, 0, 1)).toBeCloseTo(diagonal, 12);
    // The poles and the equator stay on the unit sphere.
    for (const n of [1, 3, 6]) {
      expect(sphereProfile(1, 0, n)).toBeCloseTo(1, 12);
      expect(sphereProfile(0, 0, n)).toBeCloseTo(1, 12);
    }
  });

  it('umbrella runs from the underside width below the rim to full width above it', () => {
    expect(umbrellaProfile(-1, 0.2, 0.3, 0.2)).toBe(0.2);
    expect(umbrellaProfile(1, 0.2, 0.3, 0.2)).toBe(1);
    expect(umbrellaProfile(0.3, 0.2, 0.3, 0.2)).toBeCloseTo(0.6, 12);
    // A sharp brim is nearly a step at the rim.
    expect(umbrellaProfile(0.25, 0.2, 0.3, 0.05)).toBe(0.2);
    expect(umbrellaProfile(0.35, 0.2, 0.3, 0.05)).toBe(1);
  });

  it('keep the debugger depth check exact on reshaped crowns', () => {
    const shaped = [
      { shape: 'sphere' as const, sphereTaper: 0.7, sphereSquareness: 4.5 },
      { shape: 'sphere' as const, sphereTaper: -0.4, sphereSquareness: 1.2 },
      { shape: 'umbrella' as const, umbrellaUnderside: 0.15, umbrellaRim: 0.4, umbrellaSoftness: 0.2 },
    ];
    for (const over of shaped) {
      const crown = new Crown({ ...oak.crown, ...over, stretch: 1.3, seed: 4 });
      const rng = mulberry32(9);
      for (let i = 0; i < 40; i++) {
        expect(envelopeDepth(crown, crown.point(unitVector(rng)))).toBeCloseTo(0, 6);
      }
    }
  });
});
