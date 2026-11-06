import type { Crown } from './crown';
import type { TreeGraph } from './growth';
import { Vec3, normalize } from './rng';

/** Branch ends further out than this (relative to the envelope radius on their ray) count as outside. */
export const OUTSIDE_TOLERANCE = 0.02;

/**
 * Where a point sits relative to the crown envelope, measured along the ray from the crown centre:
 * 0 on the surface, -1 at the centre, 0.1 means 10% beyond the surface. Uses Crown.point itself,
 * so it checks the exact envelope the growth sampled, noise included. Where the surface folds and a
 * ray crosses it more than once (strong noise on a cone), the outermost crossing counts.
 */
export function envelopeDepth(crown: Crown, p: Vec3): number {
  const c = crown.center;
  const t: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const len = Math.hypot(t[0], t[1], t[2]);
  if (len < 1e-9) return -1;
  const r = envelopeReach(crown, t);
  if (r === null) {
    // The cone's apex and base are open discs that no ray direction reaches: compare heights instead.
    return Math.abs(t[1]) / Math.max(crown.p.radius * crown.p.stretch, 1e-9) - 1;
  }
  return len / Math.max(r, 1e-9) - 1;
}

/** Distance from the crown centre to the outermost envelope point on the ray along t. */
function envelopeReach(crown: Crown, t: Vec3): number | null {
  const { shape, radius, stretch } = crown.p;
  const c = crown.center;
  const reach = (d: Vec3) => {
    const s = crown.point(d);
    return Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2]);
  };
  if (shape !== 'cone') {
    // point() scales (d.x, d.y * stretch, d.z), so undoing the stretch gives the direction exactly.
    return reach(normalize([t[0], t[1] / Math.max(stretch, 1e-6), t[2]]));
  }
  // A cone keeps the horizontal heading and maps d.y to height while the noise sets the width, so
  // only d.y is unknown: find every d.y whose height-to-width ratio matches the ray's.
  const flat = Math.hypot(t[0], t[2]);
  const u = flat > 1e-9 ? [t[0] / flat, t[2] / flat] : [1, 0];
  const dir = (y: number): Vec3 => {
    const h = Math.sqrt(Math.max(0, 1 - y * y));
    return [u[0] * h, y, u[1] * h];
  };
  const miss = (y: number) => y * radius * stretch * flat - t[1] * crown.radiusAt(dir(y));
  const edge = 1 - 1e-6;
  const steps = 96;
  const ys = Array.from({ length: steps + 1 }, (_, i) => -edge + (2 * edge * i) / steps);
  const ms = ys.map(miss);
  let best: number | null = null;
  const crossing = (lo: number, hi: number) => {
    const rising = miss(hi) > miss(lo);
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (miss(mid) < 0 === rising) lo = mid;
      else hi = mid;
    }
    best = Math.max(best ?? 0, reach(dir((lo + hi) / 2)));
  };
  for (let i = 1; i <= steps; i++) {
    if (ms[i - 1] === 0 || ms[i - 1] < 0 !== ms[i] < 0) crossing(ys[i - 1], ys[i]);
    // A lobe the ray only just grazes crosses twice inside one step, leaving no sign change: a dip
    // of |miss| toward zero gets a closer look.
    if (i < steps && Math.abs(ms[i]) < Math.abs(ms[i - 1]) && Math.abs(ms[i]) < Math.abs(ms[i + 1])) {
      const sign = Math.sign(ms[i]);
      if (sign !== Math.sign(ms[i - 1]) || sign !== Math.sign(ms[i + 1])) continue;
      let lo = ys[i - 1];
      let hi = ys[i + 1];
      for (let k = 0; k < 40; k++) {
        const a = lo + (hi - lo) / 3;
        const b = hi - (hi - lo) / 3;
        if (sign * miss(a) < sign * miss(b)) hi = b;
        else lo = a;
      }
      const y = (lo + hi) / 2;
      if (sign * miss(y) <= 0) {
        crossing(ys[i - 1], y);
        crossing(y, ys[i + 1]);
      }
    }
  }
  return best;
}

export interface Joint {
  pos: Vec3;
  radius: number;
  /** Branches that meet here: 2 is a plain fork, more is a multi-way merge. */
  branches: number;
}

export interface Inspection {
  /** Branch ends of the final skeleton and their envelope depth (see envelopeDepth). */
  ends: { pos: Vec3; depth: number }[];
  /** Where branches meet: forks (colonisation) or merges (sweep). */
  joints: Joint[];
  /** Trunk bases on the ground. */
  bases: { pos: Vec3; radius: number }[];
  /** Crown samples (attractors or tips) the growth never reached. */
  unreached: Vec3[];
  /** Branch ends beyond OUTSIDE_TOLERANCE. */
  outside: number;
  /** Largest envelope depth over the ends; above 0 means something pokes out. */
  maxDepth: number;
  /** Joints where three or more branches meet. */
  multiway: number;
}

/** Algorithm check of a grown tree: where its branches end, meet and stand, against its crown. */
export function inspectTree(crown: Crown, graph: TreeGraph, samples: Vec3[], unreached: number[]): Inspection {
  const ends = graph.tips.map((i) => {
    const pos = graph.nodes[i].pos;
    return { pos, depth: envelopeDepth(crown, pos) };
  });
  const joints: Joint[] = [];
  for (const n of graph.nodes) {
    if (n.children.length >= 2) joints.push({ pos: n.pos, radius: n.radius, branches: n.children.length });
  }
  return {
    ends,
    joints,
    bases: graph.roots.map((i) => ({ pos: graph.nodes[i].pos, radius: graph.nodes[i].radius })),
    unreached: unreached.map((i) => samples[i]),
    outside: ends.filter((e) => e.depth > OUTSIDE_TOLERANCE).length,
    maxDepth: ends.reduce((m, e) => Math.max(m, e.depth), -1),
    multiway: joints.filter((j) => j.branches > 2).length,
  };
}
