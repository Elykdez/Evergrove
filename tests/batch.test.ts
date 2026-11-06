import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { MAX_BATCH, SEED_RANGE, batchSeeds, batchVariants, clampCount, variantName } from '../src/batch';
import { PRESETS } from '../src/presets';
import { ZipWriter } from '../src/zip';

const oak = PRESETS.Oak.params;

describe('batch seeds', () => {
  it('runs sequentially from the current seed and wraps at the slider range', () => {
    expect(batchSeeds(7, 4, 'sequential')).toEqual([7, 8, 9, 10]);
    expect(batchSeeds(SEED_RANGE - 1, 2, 'sequential')).toEqual([SEED_RANGE - 1, 0]);
  });

  it('scatters deterministic, unique seeds', () => {
    const a = batchSeeds(7, 200, 'hashed');
    expect(a).toEqual(batchSeeds(7, 200, 'hashed'));
    expect(new Set(a).size).toBe(200);
    expect(a.every((s) => Number.isInteger(s) && s >= 0 && s < SEED_RANGE)).toBe(true);
    expect(batchSeeds(8, 200, 'hashed')).not.toEqual(a);
  });

  it('clamps the count to 1..MAX_BATCH', () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(MAX_BATCH + 50)).toBe(MAX_BATCH);
    expect(batchSeeds(1, 10_000, 'sequential')).toHaveLength(MAX_BATCH);
  });
});

describe('batch variants', () => {
  it('only changes the seed when variation is 0', () => {
    const variants = batchVariants(oak, { count: 3, seedMode: 'sequential', variation: 0 });
    variants.forEach((v, i) => {
      expect(v.seed).toBe(oak.seed + i);
      expect({ ...v.params, seed: oak.seed }).toEqual(oak);
    });
    // The base preset is never mutated.
    expect(PRESETS.Oak.params.seed).toBe(7);
  });

  it('jitters deterministically and stays inside the slider ranges', () => {
    const opts = { count: 50, seedMode: 'hashed' as const, variation: 0.5 };
    const a = batchVariants(oak, opts);
    expect(a).toEqual(batchVariants(oak, opts));
    const radii = new Set(a.map((v) => v.params.crown.radius));
    expect(radii.size).toBeGreaterThan(40);
    for (const v of a) {
      expect(v.params.crown.radius).toBeGreaterThanOrEqual(0.5);
      expect(v.params.crown.radius).toBeLessThanOrEqual(8);
      expect(v.params.growth.gnarl).toBeGreaterThanOrEqual(0);
      expect(v.params.growth.gnarl).toBeLessThanOrEqual(1);
      expect(v.params.leaves.hue).toBeGreaterThanOrEqual(0);
      expect(v.params.leaves.hue).toBeLessThanOrEqual(1);
      // Integers and structure are left alone.
      expect(v.params.colonize.attractors).toBe(oak.colonize.attractors);
      expect(v.params.algorithm).toBe(oak.algorithm);
    }
  });

  it('keys a tree on its own seed, not its position in the batch', () => {
    const short = batchVariants(oak, { count: 2, seedMode: 'sequential', variation: 0.3 });
    const long = batchVariants(oak, { count: 9, seedMode: 'sequential', variation: 0.3 });
    expect(long[1].params).toEqual(short[1].params);
  });

  it('names files in batch order with a padded index', () => {
    const [v] = batchVariants(oak, { count: 1, seedMode: 'sequential', variation: 0 });
    expect(variantName('tree-oak', v, 120)).toBe('001-tree-oak-7');
    expect(variantName('tree-oak', v, 5)).toBe('1-tree-oak-7');
  });
});

describe('zip writer', () => {
  it('round-trips deflated and stored entries', async () => {
    const zip = new ZipWriter();
    const bin = new Uint8Array(4096).map((_, i) => i % 7);
    zip.add('a/model.obj', 'v 0 0 0\n'.repeat(500));
    zip.add('b.bin', bin, false);
    zip.add('manifest.json', JSON.stringify({ ok: true }));
    const chunks = await zip.finish();
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['a/model.obj', 'b.bin', 'manifest.json']);
    expect(strFromU8(files['a/model.obj'])).toBe('v 0 0 0\n'.repeat(500));
    expect(files['b.bin']).toEqual(bin);
    expect(JSON.parse(strFromU8(files['manifest.json']))).toEqual({ ok: true });
  });
});
