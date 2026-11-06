import { Fn, attribute, clamp, dot, float, max, normalLocal, positionLocal, sin, uniform, vec2, vec3 } from 'three/tsl';
import { Vector2, type Node } from 'three/webgpu';
import { WIND_ATTRIBUTE } from '../mesh/wind';

type V3 = Node<'vec3'>;

/**
 * Wind uniforms shared by every material, so one update per frame drives bark, leaves, fruit and
 * (because WebGPU shadows reuse a material's positionNode) their shadows too.
 */
export const wind = {
  time: uniform(0),
  /** Sideways sway at the top of the tree, metres. 0 freezes the tree. */
  strength: uniform(0),
  speed: uniform(1),
  /** Unit wind direction in the ground plane (x, z). */
  dir: uniform(new Vector2(1, 0)),
  /** Tree height; sway grows with the square of height over this. */
  height: uniform(8),
  /** Leaf tip flutter as a fraction of leaf length. */
  flutter: uniform(0),
};

/**
 * Sway as a function of the rest position alone. Bark, twig and leaf vertices at the same spot
 * move identically, so joints never tear and leaves stay on their twigs; the trunk base stays put
 * and the crown moves most. Summed sines phased by position make gusts roll across the crown.
 */
function sway(p: V3) {
  const height = max(wind.height, 0.1);
  const h = clamp(p.y.div(height), 0, 1.5);
  const bend = h.mul(h).mul(wind.strength);
  const t = wind.time.mul(wind.speed);
  const ph = dot(p.xz, vec2(0.21, 0.17));
  const gust = float(0.55)
    .add(sin(t.mul(0.37).add(ph.mul(0.2))).mul(0.3))
    .add(sin(t.mul(0.91).add(ph.mul(0.5))).mul(0.15));
  const swing = sin(t.mul(1.3).add(ph)).mul(0.35).add(h.mul(0.15).mul(sin(t.mul(2.7).add(ph.mul(1.9)))));
  const along = wind.dir.mul(gust.add(swing)).mul(bend);
  const across = vec2(wind.dir.y.negate(), wind.dir.x).mul(bend.mul(0.25).mul(sin(t.mul(1.1).add(ph.mul(1.3)))));
  const off = along.add(across);
  // Bending sideways also lowers the end a little, as a real limb arcs.
  return vec3(off.x, dot(off, off).mul(-0.25).div(height), off.y);
}

/**
 * Vertex position node for a material. With flutter (leaf geometry, which carries the wind
 * attribute) leaves also flap about their petiole, faster than the sway and each in its own phase.
 * Purely visual: the geometry never changes, so exports are unaffected.
 */
export function windPosition(flutter: boolean) {
  return Fn(() => {
    const rest = positionLocal as unknown as V3;
    let moved = rest.add(sway(rest));
    if (flutter) {
      const w = attribute(WIND_ATTRIBUTE, 'vec2');
      const t = wind.time.mul(wind.speed);
      const h = clamp(rest.y.div(max(wind.height, 0.1)), 0, 1);
      const flap = sin(t.mul(7).add(w.y.mul(6.2831853)))
        .mul(0.7)
        .add(sin(t.mul(12.3).add(w.y.mul(17))).mul(0.3));
      moved = moved.add(normalLocal.mul(w.x.mul(wind.flutter).mul(h.mul(0.65).add(0.35)).mul(flap)));
    }
    return moved;
  })();
}
