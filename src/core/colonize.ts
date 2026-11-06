import type { Crown } from './crown';
import type { GrownTree, TreeNode } from './growth';
import { Vec3, mulberry32, normalize, unitVector } from './rng';

export interface ColonizeParams {
  /** Attraction points scattered through the crown volume. */
  attractors: number;
  /** A node only sees attractors within this distance, metres. */
  influence: number;
  /** An attractor is consumed once a node comes this close, metres. */
  kill: number;
  /** Length of one growth step, metres. */
  step: number;
  /** Constant bias added to every growth direction: + grows upward, - weeps. */
  tropism: number;
  /** Random wobble added to each step direction. */
  gnarl: number;
  tipRadius: number;
  /** Pipe model: parent radius^e = sum of child radius^e. */
  pipeExponent: number;
  /** Extra radius per metre of branch length, so long limbs taper. */
  thickening: number;
  maxIterations: number;
  seed: number;
}

/** Points uniformly through the crown volume, skipping directions below the cut. */
export function sampleAttractors(crown: Crown, count: number, cut: number, seed: number): Vec3[] {
  const rng = mulberry32(seed ^ 0x3c6ef372);
  const out: Vec3[] = [];
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const d = unitVector(rng);
    if (d[1] < cut) continue;
    // r * cbrt(u) is uniform by volume; plain r * u would crowd the centre.
    const p = crown.point(d, 1 - Math.cbrt(rng()));
    if (p[1] > 0.1) out.push(p);
  }
  return out;
}

interface GrowNode extends TreeNode {
  dir: Vec3;
}

/**
 * Space colonisation (Runions, Lane and Prusinkiewicz 2007). The tree grows upward from the trunk
 * base: every attractor pulls the single nearest node within the influence radius; each pulled node
 * sprouts one step toward the mean of its attractors (plus tropism); attractors that a node reaches
 * are consumed. Competition for attractors is what spaces branches naturally and makes the
 * hierarchy. Until the crown is in reach the trunk keeps growing toward the crown centre.
 */
export function colonize(attractors: Vec3[], crownCenter: Vec3, p: ColonizeParams): GrownTree {
  const rng = mulberry32(p.seed ^ 0x7f4a7c15);
  const nodes: GrowNode[] = [{ pos: [0, 0, 0], dir: [0, 1, 0], radius: 0, parent: -1, children: [], tip: false }];
  const cell = Math.max(p.influence, 1e-3);
  const grid = new Map<string, number[]>();
  const keyOf = (v: Vec3) => `${Math.floor(v[0] / cell)},${Math.floor(v[1] / cell)},${Math.floor(v[2] / cell)}`;
  const insert = (id: number) => {
    const k = keyOf(nodes[id].pos);
    const list = grid.get(k);
    if (list) list.push(id);
    else grid.set(k, [id]);
  };
  insert(0);

  const alive = attractors.map(() => true);
  let aliveCount = attractors.length;
  const kill2 = p.kill * p.kill;
  const infl2 = p.influence * p.influence;
  let stall = 0;

  const addNode = (from: number, dir: Vec3) => {
    const parent = nodes[from];
    const pos: Vec3 = [parent.pos[0] + dir[0] * p.step, parent.pos[1] + dir[1] * p.step, parent.pos[2] + dir[2] * p.step];
    // Two attractors either side of a node can pull it back and forth onto the same spot.
    for (const c of parent.children) {
      const q = nodes[c].pos;
      if ((q[0] - pos[0]) ** 2 + (q[1] - pos[1]) ** 2 + (q[2] - pos[2]) ** 2 < (p.step * 0.3) ** 2) return false;
    }
    nodes.push({ pos, dir, radius: 0, parent: from, children: [], tip: false });
    const id = nodes.length - 1;
    parent.children.push(id);
    insert(id);
    return true;
  };

  const jitter = (d: Vec3): Vec3 => {
    if (p.gnarl <= 0) return d;
    const j = unitVector(rng);
    return normalize([d[0] + j[0] * p.gnarl * 0.35, d[1] + j[1] * p.gnarl * 0.35, d[2] + j[2] * p.gnarl * 0.35]);
  };

  for (let iter = 0; iter < p.maxIterations && aliveCount > 0; iter++) {
    const pulls = new Map<number, Vec3>();
    attractors.forEach((a, ai) => {
      if (!alive[ai]) return;
      const cx = Math.floor(a[0] / cell);
      const cy = Math.floor(a[1] / cell);
      const cz = Math.floor(a[2] / cell);
      let best = infl2;
      let found = -1;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!list) continue;
            for (const id of list) {
              const q = nodes[id].pos;
              const d = (q[0] - a[0]) ** 2 + (q[1] - a[1]) ** 2 + (q[2] - a[2]) ** 2;
              if (d < best) {
                best = d;
                found = id;
              }
            }
          }
      if (found < 0) return;
      if (best <= kill2) {
        alive[ai] = false;
        aliveCount--;
        return;
      }
      const q = nodes[found].pos;
      const v = normalize([a[0] - q[0], a[1] - q[1], a[2] - q[2]]);
      const acc = pulls.get(found) ?? [0, 0, 0];
      pulls.set(found, [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]]);
    });

    let grew = false;
    if (pulls.size === 0) {
      // Crown out of reach: extend the newest node toward the crown centre (the trunk).
      const last = nodes.length - 1;
      const n = nodes[last];
      const toCrown = normalize([crownCenter[0] - n.pos[0], crownCenter[1] - n.pos[1], crownCenter[2] - n.pos[2]]);
      grew = addNode(last, jitter(normalize([n.dir[0] * 0.6 + toCrown[0] * 0.4, n.dir[1] * 0.6 + toCrown[1] * 0.4, n.dir[2] * 0.6 + toCrown[2] * 0.4])));
    } else {
      for (const [id, sum] of pulls) {
        const d = normalize(sum);
        grew = addNode(id, jitter(normalize([d[0], d[1] + p.tropism, d[2]]))) || grew;
      }
    }
    stall = grew ? 0 : stall + 1;
    if (stall > 3) break;
  }

  // Pipe-model radii from the tips down. Children are always created after their parent, so a
  // reverse sweep sees every child before its parent.
  const e = Math.max(1, p.pipeExponent);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.children.length === 0) {
      n.radius = p.tipRadius;
      n.tip = true;
      continue;
    }
    let sum = 0;
    for (const c of n.children) sum += Math.pow(nodes[c].radius, e);
    n.radius = Math.pow(sum, 1 / e) + p.thickening * p.step;
  }

  const tips: number[] = [];
  nodes.forEach((n, i) => n.tip && tips.push(i));
  return {
    nodes: nodes.map(({ pos, radius, parent, children, tip }) => ({ pos, radius, parent, children, tip })),
    roots: [0],
    tips,
    // Attractors still alive were never consumed: gaps in the crown the branches did not fill.
    unreached: alive.flatMap((a, i) => (a ? [i] : [])),
  };
}
