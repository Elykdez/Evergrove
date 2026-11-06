import * as THREE from 'three';
import { Crown } from './core/crown';
import type { TreeParams, TreeResult } from './tree';

/**
 * A grown tree as plain data, to cross from a growth worker to the page. Geometry buffers are
 * transferred rather than copied; the crown is rebuilt from the params, which is cheap.
 */
type Arr = Float32Array | Uint16Array | Uint32Array;

export interface PackedGeometry {
  attributes: { name: string; array: Arr; itemSize: number; normalized: boolean }[];
  index: Arr | null;
}

export type PackedTree = Omit<TreeResult, 'crown' | 'bark' | 'leaves' | 'fruit'> & {
  bark: PackedGeometry;
  leaves: PackedGeometry;
  fruit: PackedGeometry;
};

function packGeometry(g: THREE.BufferGeometry, transfer: Set<ArrayBuffer>): PackedGeometry {
  const attributes = Object.entries(g.attributes).map(([name, a]) => {
    const attr = a as THREE.BufferAttribute;
    const array = attr.array as Arr;
    transfer.add(array.buffer as ArrayBuffer);
    return { name, array, itemSize: attr.itemSize, normalized: attr.normalized };
  });
  const index = g.index ? (g.index.array as Arr) : null;
  if (index) transfer.add(index.buffer as ArrayBuffer);
  return { attributes, index };
}

function unpackGeometry(p: PackedGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const a of p.attributes) g.setAttribute(a.name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
  if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1));
  return g;
}

/** The tree as plain data plus the buffers to transfer with it; the geometries are left empty. */
export function packTree(r: TreeResult): { tree: PackedTree; transfer: ArrayBuffer[] } {
  const transfer = new Set<ArrayBuffer>();
  const { crown: _crown, bark, leaves, fruit, ...rest } = r;
  const tree = { ...rest, bark: packGeometry(bark, transfer), leaves: packGeometry(leaves, transfer), fruit: packGeometry(fruit, transfer) };
  return { tree, transfer: [...transfer] };
}

/** Rebuilds the tree a worker grew from `p`, as generateTree(p) would have returned it. */
export function unpackTree(t: PackedTree, p: TreeParams): TreeResult {
  return {
    ...t,
    crown: new Crown({ ...p.crown, seed: p.seed }),
    bark: unpackGeometry(t.bark),
    leaves: unpackGeometry(t.leaves),
    fruit: unpackGeometry(t.fruit),
  };
}
