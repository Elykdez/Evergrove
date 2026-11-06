import { Vec3, clamp, mulberry32, smoothstep } from './rng';

export interface GrowthParams {
  /** Vertical step of the downward sweep. */
  layerHeight: number;
  /** Maximum lean from vertical per step, degrees. */
  branchAngle: number;
  /** Horizontal reach within which branches pull toward each other. */
  mergeRadius: number;
  /** 0..1 pull toward the trunk axis below the crown. 0 grows a multi-stem shrub. */
  trunkPull: number;
  /**
   * Pull toward the axis inside the crown. Low lets neighbours merge into a branching hierarchy
   * (broadleaf); high sends every tip straight to the axis, so side branches join a single leader
   * all the way up (conifer).
   */
  crownPull: number;
  tipRadius: number;
  /**
   * Pipe-model exponent: merged radius^e = sum of child radius^e. 2 conserves cross-section
   * area (da Vinci's rule); real trees measure roughly 2 to 3.
   */
  pipeExponent: number;
  /** Radius gained per metre of descent, on top of merging. */
  thickening: number;
  /** Random lateral wobble per step, as a fraction of the step height. */
  gnarl: number;
  seed: number;
}

export interface TreeNode {
  pos: Vec3;
  radius: number;
  /** Toward the ground; -1 for a root (trunk base). */
  parent: number;
  /** Toward the tips. */
  children: number[];
  tip: boolean;
}

export interface TreeGraph {
  nodes: TreeNode[];
  roots: number[];
  tips: number[];
}

/** A freshly grown graph, plus the input samples (indices) the growth never reached. */
export interface GrownTree extends TreeGraph {
  unreached: number[];
}

interface Active {
  id: number;
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * Grows a tree downward from its tips: the 3D-print tree-support sweep, reused.
 * <p>
 * Tips join the sweep at their layer, highest first. Each layer every branch leans toward its
 * nearest neighbour and toward the trunk axis (base at the origin, top at the crown centre),
 * never more than branchAngle from vertical. Branches that meet merge by the pipe model. What
 * reaches the ground is the trunk (or trunks, with a weak pull).
 */
export function growTree(tips: Vec3[], crownCenter: Vec3, p: GrowthParams): GrownTree {
  const rng = mulberry32(p.seed ^ 0x9e3779b9);
  const nodes: TreeNode[] = [];
  const tipIds: number[] = [];
  const addNode = (pos: Vec3, radius: number, tip: boolean) => {
    nodes.push({ pos, radius, parent: -1, children: [], tip });
    return nodes.length - 1;
  };

  const h = Math.max(1e-3, p.layerHeight);
  const pending = tips.filter((t) => t[1] >= h).sort((a, b) => b[1] - a[1]);
  // Tips below the first layer never join the sweep.
  const unreached = tips.flatMap((t, i) => (t[1] >= h ? [] : [i]));
  if (pending.length === 0) return { nodes, roots: [], tips: [], unreached };

  const lean = Math.tan(clamp(p.branchAngle, 0, 85) * (Math.PI / 180));
  const exp = Math.max(1, p.pipeExponent);
  const layerOf = (y: number) => Math.floor(y / h + 1e-6);
  const topY = pending[0][1];
  const bottomY = pending[pending.length - 1][1];
  const cell = Math.max(p.mergeRadius, 1e-3);
  // Branches this close snap together even while their tubes are still thin.
  const snap = h * 0.35;

  let active: Active[] = [];
  let pi = 0;
  for (let layer = layerOf(topY); layer >= 1; layer--) {
    while (pi < pending.length && layerOf(pending[pi][1]) >= layer) {
      const t = pending[pi++];
      const id = addNode([t[0], t[1], t[2]], p.tipRadius, true);
      tipIds.push(id);
      active.push({ id, x: t[0], y: t[1], z: t[2], r: p.tipRadius });
    }
    if (active.length === 0) continue;

    const ty = (layer - 1) * h;
    // Trunk axis point at this height. Inside the crown the pull stays faint so neighbours merge
    // into a hierarchy first; below the lowest tip it ramps to full so the limbs gather into a
    // trunk. Pulling hard from the top makes every tip run straight to one point (a broom).
    const s = clamp(ty / Math.max(crownCenter[1], 1e-6), 0, 1);
    const ax = crownCenter[0] * s;
    const az = crownCenter[2] * s;
    const inner = clamp(p.crownPull, 0, 1);
    const below = smoothstep(bottomY, bottomY * 0.35, ty);
    const pull = clamp(p.trunkPull, 0, 1) * Math.max(inner, below);

    const grid = buildGrid(active, cell);
    const moved = active.map((n, i) => {
      const dy = n.y - ty;
      const maxMove = lean * dy;
      let dx = 0;
      let dz = 0;
      const j = nearest(active, grid, i, cell);
      if (j >= 0) {
        dx += (active[j].x - n.x) * 0.5;
        dz += (active[j].z - n.z) * 0.5;
      }
      dx += (ax - n.x) * pull;
      dz += (az - n.z) * pull;
      if (p.gnarl > 0) {
        dx += (rng() * 2 - 1) * p.gnarl * dy;
        dz += (rng() * 2 - 1) * p.gnarl * dy;
      }
      const len = Math.hypot(dx, dz);
      if (len > maxMove && len > 0) {
        dx *= maxMove / len;
        dz *= maxMove / len;
      }
      return { x: n.x + dx, z: n.z + dz, r: n.r + p.thickening * dy, from: n.id };
    });

    // Union branches whose tubes overlap after the step.
    const parent = moved.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    const movedGrid = buildGrid(moved, cell);
    moved.forEach((a, i) => {
      forNeighbours(movedGrid, a.x, a.z, cell, (j) => {
        if (j <= i) return;
        const b = moved[j];
        const reach = Math.max((a.r + b.r) * 0.75, snap);
        if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 <= reach * reach) parent[find(i)] = find(j);
      });
    });

    const groups = new Map<number, typeof moved>();
    moved.forEach((m, i) => {
      const root = find(i);
      const g = groups.get(root);
      if (g) g.push(m);
      else groups.set(root, [m]);
    });

    const next: Active[] = [];
    for (const members of groups.values()) {
      let w = 0;
      let x = 0;
      let z = 0;
      for (const m of members) {
        const k = Math.pow(m.r, exp);
        w += k;
        x += m.x * k;
        z += m.z * k;
      }
      const r = Math.pow(w, 1 / exp);
      const id = addNode([x / w, ty, z / w], r, false);
      for (const m of members) {
        nodes[m.from].parent = id;
        nodes[id].children.push(m.from);
      }
      next.push({ id, x: x / w, y: ty, z: z / w, r });
    }
    active = next;
  }

  return { nodes, roots: active.map((a) => a.id), tips: tipIds, unreached };
}

type Grid = Map<number, number[]>;
const key = (ix: number, iz: number) => ix * 100003 + iz;

function buildGrid(items: { x: number; z: number }[], cell: number): Grid {
  const grid: Grid = new Map();
  items.forEach((n, i) => {
    const k = key(Math.floor(n.x / cell), Math.floor(n.z / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  return grid;
}

function forNeighbours(grid: Grid, x: number, z: number, cell: number, visit: (i: number) => void) {
  const cx = Math.floor(x / cell);
  const cz = Math.floor(z / cell);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) grid.get(key(cx + dx, cz + dz))?.forEach(visit);
}

function nearest(items: Active[], grid: Grid, index: number, radius: number): number {
  const n = items[index];
  let best = radius * radius;
  let found = -1;
  forNeighbours(grid, n.x, n.z, radius, (j) => {
    if (j === index) return;
    const d = (items[j].x - n.x) ** 2 + (items[j].z - n.z) ** 2;
    if (d < best && d > 1e-12) {
      best = d;
      found = j;
    }
  });
  return found;
}

/** Laplacian smoothing of chain nodes; tips, roots and forks stay put. */
export function smoothTree(g: TreeGraph, iterations: number, strength: number): void {
  for (let it = 0; it < iterations; it++) {
    const next = g.nodes.map((n) => n.pos);
    g.nodes.forEach((n, i) => {
      if (n.tip || n.parent < 0 || n.children.length !== 1) return;
      const a = g.nodes[n.parent].pos;
      const b = g.nodes[n.children[0]].pos;
      next[i] = [
        n.pos[0] + ((a[0] + b[0]) / 2 - n.pos[0]) * strength,
        n.pos[1] + ((a[1] + b[1]) / 2 - n.pos[1]) * strength,
        n.pos[2] + ((a[2] + b[2]) / 2 - n.pos[2]) * strength,
      ];
    });
    g.nodes.forEach((n, i) => (n.pos = next[i]));
  }
}

/**
 * Drops chain nodes that barely bend, so straight runs become one long segment. Keeps every
 * fork, tip and root, and never makes a segment longer than maxLength.
 */
export function simplifyTree(g: TreeGraph, maxAngleDeg: number, maxLength: number): TreeGraph {
  const cosTol = Math.cos((maxAngleDeg * Math.PI) / 180);
  const removed = new Uint8Array(g.nodes.length);
  const nodes = g.nodes.map((n) => ({ ...n, children: [...n.children] }));

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.tip || n.parent < 0 || n.children.length !== 1) continue;
    const p = nodes[n.parent];
    const c = nodes[n.children[0]];
    const a = [n.pos[0] - p.pos[0], n.pos[1] - p.pos[1], n.pos[2] - p.pos[2]];
    const b = [c.pos[0] - n.pos[0], c.pos[1] - n.pos[1], c.pos[2] - n.pos[2]];
    const la = Math.hypot(a[0], a[1], a[2]);
    const lb = Math.hypot(b[0], b[1], b[2]);
    if (la === 0 || lb === 0) continue;
    const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
    const span = Math.hypot(c.pos[0] - p.pos[0], c.pos[1] - p.pos[1], c.pos[2] - p.pos[2]);
    if (cos < cosTol || span > maxLength) continue;
    // Splice n out: its child hangs straight from its parent.
    const child = n.children[0];
    nodes[child].parent = n.parent;
    p.children[p.children.indexOf(i)] = child;
    removed[i] = 1;
  }

  const remap = new Int32Array(nodes.length).fill(-1);
  const out: TreeNode[] = [];
  nodes.forEach((n, i) => {
    if (!removed[i]) remap[i] = out.push(n) - 1;
  });
  for (const n of out) {
    n.parent = n.parent >= 0 ? remap[n.parent] : -1;
    n.children = n.children.map((c) => remap[c]);
  }
  return {
    nodes: out,
    roots: g.roots.map((r) => remap[r]),
    tips: g.tips.map((t) => remap[t]),
  };
}

/**
 * Cuts the thinnest twigs until at most `maxTips` branch ends remain, but never the thickest stem.
 * A node survives when it is at least as thick as one threshold radius and its parent survived, so
 * whole twigs go at once; the threshold is the smallest one that meets the count. Branches left
 * without their twigs taper to a point at their new end. Returns a copy.
 */
export function pruneTwigs(g: TreeGraph, maxTips: number): TreeGraph {
  if (g.tips.length <= maxTips) return g;
  const kept = new Uint8Array(g.nodes.length);
  const mark = (threshold: number) => {
    kept.fill(0);
    let tips = 0;
    const stack = [...g.roots];
    for (const r of g.roots) kept[r] = 1;
    while (stack.length) {
      const id = stack.pop()!;
      let children = 0;
      for (const c of g.nodes[id].children) {
        if (g.nodes[c].radius < threshold) continue;
        kept[c] = 1;
        children++;
        stack.push(c);
      }
      if (children === 0) tips++;
    }
    return tips;
  };
  // Raising the threshold never adds tips, so bisect over the distinct radii for the lowest that fits.
  // Only branch radii count: when nothing fits, the thickest stem still stays as the trunk.
  const radii = [...new Set(g.nodes.filter((n) => n.parent >= 0).map((n) => n.radius))].sort((a, b) => a - b);
  let lo = 0;
  let hi = radii.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (mark(radii[mid]) <= maxTips) hi = mid;
    else lo = mid + 1;
  }
  mark(radii[Math.min(lo, radii.length - 1)] ?? Infinity);

  const remap = new Int32Array(g.nodes.length).fill(-1);
  const nodes: TreeNode[] = [];
  g.nodes.forEach((n, i) => {
    if (kept[i]) remap[i] = nodes.push({ ...n, children: [] }) - 1;
  });
  g.nodes.forEach((n, i) => {
    if (!kept[i]) return;
    const out = nodes[remap[i]];
    out.parent = n.parent >= 0 ? remap[n.parent] : -1;
    out.children = n.children.filter((c) => kept[c]).map((c) => remap[c]);
  });
  const tips: number[] = [];
  nodes.forEach((n, i) => {
    if (n.children.length > 0 || n.parent < 0) return;
    if (!n.tip) n.radius *= 0.35;
    n.tip = true;
    tips.push(i);
  });
  return { nodes, roots: g.roots.map((r) => remap[r]), tips };
}
