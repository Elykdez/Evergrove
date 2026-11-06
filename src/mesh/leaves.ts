import * as THREE from 'three';
import type { TreeGraph } from '../core/growth';
import { Rng, Vec3, add, cross, normalize, scale, sub, unitVector } from '../core/rng';
import { WIND_ATTRIBUTE } from './wind';

const fract = (x: number) => x - Math.floor(x);

export interface LeafParams {
  perTip: number;
  /** Leaves per metre along every twig thinner than twigRadius. */
  twigDensity: number;
  /** Twigs up to this radius carry leaves, metres. */
  twigRadius: number;
  /** Leaf length, metres. */
  size: number;
  sizeJitter: number;
  /** Leaf width relative to length (card aspect). */
  aspect: number;
  /** How far leaves spread from their twig, metres. */
  cluster: number;
  /** Downward bias of the leaf axis, 0..1. */
  droop: number;
  /** V-fold along the midrib, as a fraction of leaf width. */
  fold: number;
  /** Base hue 0..1 (0.25 to 0.35 is green). */
  hue: number;
  hueJitter: number;
  /** 0 summer, 1 full autumn. */
  season: number;
}

/**
 * Leaf cards on the twigs: a cluster at every tip, plus leaves along every branch thinner than
 * twigRadius, as on a real tree where foliage covers the whole outer twig network.
 * <p> Each leaf is a folded quad (two panels hinged on the midrib)
 * with its petiole on the twig, facing roughly outward from the crown. Colour is per-leaf vertex
 * colour, multiplied with the grey-scale leaf texture.
 */
export function buildLeafGeometry(g: TreeGraph, crownCenter: Vec3, p: LeafParams, rng: Rng): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  /** Per vertex: flutter weight (0 at the petiole, leaf length at the tip) and a per-leaf phase. */
  const winds: number[] = [];
  const indices: number[] = [];
  let leafIndex = 0;
  const color = new THREE.Color();
  const autumn = new THREE.Color();

  // Each entry is one twig segment and how many leaves it carries.
  const twigs: { from: Vec3; to: Vec3; count: number; tipBias: boolean }[] = [];
  for (const tipId of g.tips) {
    const tip = g.nodes[tipId];
    const from = tip.parent >= 0 ? g.nodes[tip.parent].pos : tip.pos;
    twigs.push({ from, to: tip.pos, count: Math.round(p.perTip * (0.7 + rng() * 0.6)), tipBias: true });
  }
  if (p.twigDensity > 0) {
    g.nodes.forEach((n) => {
      if (n.tip || n.parent < 0 || n.radius > p.twigRadius) return;
      const from = g.nodes[n.parent].pos;
      const len = Math.hypot(...sub(n.pos, from));
      const expected = len * p.twigDensity;
      // Stochastic rounding keeps short segments from all rounding to zero leaves.
      twigs.push({ from, to: n.pos, count: Math.floor(expected + rng()), tipBias: false });
    });
  }

  for (const twig of twigs) {
    for (let k = 0; k < twig.count; k++) {
      const t = twig.tipBias ? 0.35 + 0.65 * rng() : rng();
      const along = add(twig.from, scale(sub(twig.to, twig.from), t));
      const center = add(along, scale(unitVector(rng), p.cluster * rng()));
      const outward = normalize(sub(center, crownCenter));
      const axis = normalize(add(add(scale(outward, 0.8), scale(unitVector(rng), 0.7)), [0, -p.droop, 0]));
      const side = normalize(cross(axis, unitVector(rng)));
      const face = normalize(cross(side, axis));
      const len = p.size * (1 + (rng() * 2 - 1) * p.sizeJitter);
      const halfW = len * p.aspect * 0.5;
      const lift = scale(face, halfW * p.fold);

      // Six vertices: left rim, midrib, right rim at the petiole and at the tip.
      const tipC = add(center, scale(axis, len));
      const verts: Vec3[] = [
        add(center, scale(side, -halfW)),
        add(center, lift),
        add(center, scale(side, halfW)),
        add(tipC, scale(side, -halfW)),
        add(tipC, lift),
        add(tipC, scale(side, halfW)),
      ];
      const uvSet = [0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1];

      color.setHSL(
        (p.hue + (rng() * 2 - 1) * p.hueJitter + 1) % 1,
        0.45 + rng() * 0.2,
        0.32 + rng() * 0.14,
      );
      // Leaves turn individually: some stay green while others go amber or red.
      const turn = Math.min(1, Math.max(0, p.season * 1.4 - rng() * 0.4));
      autumn.setHSL(0.02 + rng() * 0.1, 0.75, 0.42 + rng() * 0.1);
      color.lerp(autumn, turn);

      const start = positions.length / 3;
      // Phase from a hash of the leaf index, not the rng, so adding wind data never moves a leaf.
      const phase = fract(Math.sin(++leafIndex * 12.9898) * 43758.5453);
      verts.forEach((v, i) => {
        positions.push(v[0], v[1], v[2]);
        normals.push(face[0], face[1], face[2]);
        uvs.push(uvSet[i * 2], uvSet[i * 2 + 1]);
        colors.push(color.r, color.g, color.b);
        winds.push(i < 3 ? 0 : len, phase);
      });
      indices.push(start, start + 1, start + 3, start + 1, start + 4, start + 3);
      indices.push(start + 1, start + 2, start + 4, start + 2, start + 5, start + 4);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute(WIND_ATTRIBUTE, new THREE.Float32BufferAttribute(winds, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
