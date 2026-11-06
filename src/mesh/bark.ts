import * as THREE from 'three';
import type { TreeGraph } from '../core/growth';
import { Rng, Vec3, add, cross, dot, normalize, scale, sub } from '../core/rng';

export interface BarkParams {
  /** Ring segments on the thickest branch; thinner branches use proportionally fewer. */
  radialSegments: number;
  rootCount: number;
  /** Root reach, in trunk radii. */
  rootLength: number;
  /** Texture repeats per circumference along the branch. */
  barkTiling: number;
  /** Catmull-Rom subdivisions per segment; 0 keeps the raw polyline. */
  subdivisions: number;
}

interface Builder {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/**
 * Bark as continuous tubes. The tree is split into chains: each chain follows the thickest child
 * upward and every other child starts its own chain at the fork, so a branch reads as one smooth
 * tube instead of a stack of segments. Rings are oriented by parallel transport to avoid twisting.
 */
export function buildBarkGeometry(g: TreeGraph, p: BarkParams, rng: Rng): THREE.BufferGeometry {
  const b: Builder = { positions: [], normals: [], uvs: [], indices: [] };
  const maxRadius = Math.max(1e-4, ...g.roots.map((r) => g.nodes[r].radius));

  const stack: { start: number; fork: number }[] = g.roots.map((r) => ({ start: r, fork: -1 }));
  while (stack.length) {
    const { start, fork } = stack.pop()!;
    const pts: Vec3[] = [];
    const radii: number[] = [];
    if (fork >= 0) {
      // Start inside the parent at the fork so the joint is covered.
      pts.push(g.nodes[fork].pos);
      radii.push(g.nodes[start].radius);
    }
    let cur = start;
    for (;;) {
      const n = g.nodes[cur];
      pts.push(n.pos);
      radii.push(n.radius);
      if (n.children.length === 0) break;
      let next = n.children[0];
      for (const c of n.children) if (g.nodes[c].radius > g.nodes[next].radius) next = c;
      for (const c of n.children) if (c !== next) stack.push({ start: c, fork: cur });
      cur = next;
    }
    const segs = Math.max(3, Math.round(p.radialSegments * Math.sqrt(radii[0] / maxRadius)));
    const curve = catmullRom(pts, radii, Math.round(p.subdivisions));
    tube(b, curve.pts, curve.radii, segs, p.barkTiling, true);
  }

  for (const r of g.roots) addRoots(b, g.nodes[r].pos, g.nodes[r].radius, p, rng);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
  geo.setIndex(b.indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Resamples a branch polyline as a Catmull-Rom spline through its nodes, so branches bend in
 * smooth curves instead of kinking at every growth step. Radii interpolate linearly.
 */
function catmullRom(pts: Vec3[], radii: number[], subdivisions: number): { pts: Vec3[]; radii: number[] } {
  if (subdivisions <= 0 || pts.length < 3) return { pts, radii };
  const n = pts.length;
  const at = (i: number) => pts[Math.max(0, Math.min(n - 1, i))];
  const outPts: Vec3[] = [];
  const outRadii: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let k = 0; k <= subdivisions; k++) {
      if (k === subdivisions && i < n - 2) break;
      const t = k / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      const point: Vec3 = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        point[c] =
          0.5 *
          (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      }
      outPts.push(point);
      outRadii.push(radii[i] + (radii[i + 1] - radii[i]) * t);
    }
  }
  return { pts: outPts, radii: outRadii };
}

function tube(b: Builder, pts: Vec3[], radii: number[], segs: number, tiling: number, capTip: boolean) {
  const n = pts.length;
  if (n < 2) return;
  const tangents: Vec3[] = pts.map((_, i) => normalize(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let normal = normalize(cross(tangents[0], Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const startVertex = b.positions.length / 3;
  let v = 0;

  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    // Parallel transport: keep the previous normal, minus its component along the new tangent.
    normal = normalize(sub(normal, scale(t, dot(normal, t))));
    const binormal = cross(t, normal);
    if (i > 0) {
      const seg = Math.hypot(...sub(pts[i], pts[i - 1]));
      const avg = Math.max(1e-4, (radii[i] + radii[i - 1]) / 2);
      v += (seg / (2 * Math.PI * avg)) * tiling;
    }
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const dir = add(scale(normal, Math.cos(a)), scale(binormal, Math.sin(a)));
      const pos = add(pts[i], scale(dir, radii[i]));
      b.positions.push(pos[0], pos[1], pos[2]);
      b.normals.push(dir[0], dir[1], dir[2]);
      b.uvs.push(j / segs, v);
    }
  }
  const ring = segs + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = startVertex + i * ring + j;
      const c = a + ring;
      b.indices.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  if (capTip) {
    // Close the open end with a short cone so tips do not show a hole.
    const last = pts[n - 1];
    const t = tangents[n - 1];
    const tipPos = add(last, scale(t, radii[n - 1] * 1.5));
    const tipIndex = b.positions.length / 3;
    b.positions.push(tipPos[0], tipPos[1], tipPos[2]);
    b.normals.push(t[0], t[1], t[2]);
    b.uvs.push(0.5, v + 0.1);
    const lastRing = startVertex + (n - 1) * ring;
    for (let j = 0; j < segs; j++) b.indices.push(lastRing + j, tipIndex, lastRing + j + 1);
  }
}

/** Buttress roots: short tapering arcs that leave the trunk base and dip under the ground. */
function addRoots(b: Builder, base: Vec3, radius: number, p: BarkParams, rng: Rng) {
  const count = Math.round(p.rootCount);
  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const dir: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
    const reach = radius * p.rootLength * (0.7 + rng() * 0.6);
    const pts: Vec3[] = [];
    const radii: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const out = radius * 0.35 + reach * t;
      const y = radius * 1.4 * (1 - t) * (1 - t) - radius * 0.5 * t;
      pts.push([base[0] + dir[0] * out, base[1] + y, base[2] + dir[2] * out]);
      radii.push(radius * (0.55 * Math.pow(1 - t, 1.4) + 0.06));
    }
    tube(b, pts, radii, Math.max(5, Math.round(p.radialSegments * 0.6)), p.barkTiling, true);
  }
}
