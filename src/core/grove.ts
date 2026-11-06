import { mulberry32 } from './rng';

/** Where one grove tree stands: ground position in metres and its turn about Y, in radians. */
export interface GroveSlot {
  x: number;
  z: number;
  rotation: number;
}

export const MAX_GROVE = 16;

export function clampGrove(count: number): number {
  return Math.max(0, Math.min(MAX_GROVE, Math.round(count) || 0));
}

/**
 * Seeded spots for `count` trees around the main tree at the origin, each at least `spacing`
 * metres from the trunk and from every other grove tree. Trees are placed one after another by
 * dart throwing in a disc that grows with each tree (and widens if a throw finds no room), so the
 * grove stays compact and a smaller count is always a prefix of a larger one: changing the count
 * never moves the trees already standing.
 */
export function groveLayout(count: number, spacing: number, seed: number): GroveSlot[] {
  const n = clampGrove(count);
  const s = Math.max(0.5, spacing);
  const rng = mulberry32(seed ^ 0x3c6ef372);
  const slots: GroveSlot[] = [];
  for (let i = 0; i < n; i++) {
    // Random sequential packing fills about half the disc, so this ring holds i + 2 trees.
    let outer = s * (0.5 + 0.75 * Math.sqrt(i + 2));
    for (let placed = false; !placed; outer += s * 0.5) {
      for (let k = 0; k < 24; k++) {
        // Uniform over the ring between the trunk clearance and the outer radius.
        const r = Math.sqrt(s * s + rng() * (outer * outer - s * s));
        const a = rng() * Math.PI * 2;
        const x = r * Math.cos(a);
        const z = r * Math.sin(a);
        if (slots.every((o) => Math.hypot(o.x - x, o.z - z) >= s)) {
          slots.push({ x, z, rotation: rng() * Math.PI * 2 });
          placed = true;
          break;
        }
      }
    }
  }
  return slots;
}

/** Farthest reach of the grove from the origin, in metres; 0 for an empty grove. */
export function groveRadius(slots: readonly GroveSlot[]): number {
  return Math.max(0, ...slots.map((p) => Math.hypot(p.x, p.z)));
}
