import type { TreeGraph } from './growth';
import { Vec3, cross, dot, length, normalize, sub } from './rng';

type Quat = [number, number, number, number];

const qMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const qAxisAngle = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

function qRotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = cross(u, v).map((c) => c * 2) as Vec3;
  const c = cross(u, t);
  return [v[0] + q[3] * t[0] + c[0], v[1] + q[3] * t[1] + c[1], v[2] + q[3] * t[2] + c[2]];
}

/**
 * Sags branches under their own weight. Each segment is rotated toward straight down by an angle
 * that grows as the branch gets thinner (stiffness falls fast with radius), and the rotation is
 * inherited by everything above it, so bends accumulate along a limb and its outer twigs hang.
 * Gravity 0 leaves the tree untouched; around 1 gives a weeping habit.
 */
export function applyGravity(g: TreeGraph, gravity: number, referenceRadius: number): void {
  if (gravity <= 0 || g.nodes.length === 0) return;
  const down: Vec3 = [0, -1, 0];
  const original = g.nodes.map((n) => n.pos);
  const rotation: Quat[] = g.nodes.map(() => [0, 0, 0, 1]);

  // Parents before children, whichever algorithm built the graph.
  const order: number[] = [];
  order.push(...g.roots);
  for (let i = 0; i < order.length; i++) order.push(...g.nodes[order[i]].children);

  for (const id of order) {
    const n = g.nodes[id];
    if (n.parent < 0) continue;
    const segment = sub(original[id], original[n.parent]);
    const len = length(segment);
    if (len === 0) continue;
    const parentRotation = rotation[n.parent];
    const dir = normalize(qRotate(parentRotation, segment));
    const axisRaw = cross(dir, down);
    let q = parentRotation;
    if (length(axisRaw) > 1e-6) {
      // Beam stiffness rises with radius^4 while a limb's load rises more slowly; ^3 keeps limbs
      // rigid while twigs hang.
      const stiffness = Math.pow(Math.max(n.radius, 1e-5) / referenceRadius, 3);
      const toDown = Math.acos(Math.min(1, Math.max(-1, dot(dir, down))));
      const angle = Math.min(toDown, 0.35, (gravity * len) / (1 + stiffness));
      q = qMul(qAxisAngle(normalize(axisRaw), angle), parentRotation);
    }
    rotation[id] = q;
    const p = g.nodes[n.parent].pos;
    const d = qRotate(q, segment);
    n.pos = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  }
}
