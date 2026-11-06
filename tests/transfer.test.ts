import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { PRESETS } from '../src/presets';
import { packTree, unpackTree } from '../src/transfer';
import { generateTree } from '../src/tree';

type Arr = ArrayLike<number> & { buffer: ArrayBufferLike; byteLength: number };
const sameArray = (a: Arr, b: Arr) => a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i]);

function expectSameGeometry(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  expect(Object.keys(a.attributes).sort()).toEqual(Object.keys(b.attributes).sort());
  for (const [name, attr] of Object.entries(a.attributes)) {
    const other = b.getAttribute(name);
    expect(other.itemSize, name).toBe(attr.itemSize);
    expect(sameArray(attr.array as Arr, other.array as Arr), name).toBe(true);
  }
  expect(!!a.index).toBe(!!b.index);
  if (a.index && b.index) expect(sameArray(a.index.array as Arr, b.index.array as Arr)).toBe(true);
}

describe('worker transfer', () => {
  it('rebuilds exactly the tree generateTree grows on the page', () => {
    // Apple bears fruit, so all three meshes carry data.
    const params = { ...PRESETS.Apple.params, seed: 31 };
    const here = generateTree(params);
    const { tree, transfer } = packTree(generateTree(params));
    // As postMessage does: a structured clone that moves the buffers instead of copying them.
    const moved = structuredClone(tree, { transfer });
    expect(transfer.every((b) => b.byteLength === 0)).toBe(true);
    const there = unpackTree(moved, structuredClone(params));

    expectSameGeometry(here.bark, there.bark);
    expectSameGeometry(here.leaves, there.leaves);
    expectSameGeometry(here.fruit, there.fruit);
    expect(there.fruitCount).toBeGreaterThan(0);
    expect(there.fruitCount).toBe(here.fruitCount);
    expect(there.graph).toEqual(here.graph);
    expect(there.tips).toEqual(here.tips);
    expect(there.unreached).toEqual(here.unreached);
    expect(there.detail).toEqual(here.detail);
    expect(there.crown.spectrum).toEqual(here.crown.spectrum);
    expect(there.crown.norm).toBe(here.crown.norm);
    expect(there.crown.center).toEqual(here.crown.center);
  });
});
