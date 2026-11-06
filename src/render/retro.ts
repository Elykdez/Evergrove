import {
  abs,
  atan,
  clamp,
  cross,
  dot,
  exp,
  float,
  fract,
  fwidth,
  getViewPosition,
  length,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  pow,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { Vector3, type Node, type PerspectiveCamera, type TextureNode } from 'three/webgpu';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/**
 * Startup look: an 80s neon "grid world" drawn over the real render in the lens pass. The real
 * scene is still rendered underneath; this pass rebuilds world positions from its depth buffer to
 * draw an endless grid on the ground plane, a dark sky with a synthwave sun, and the tree as glowing
 * edges. A scan front then sweeps out from the trunk and the real render takes over behind it.
 */
export const retro = {
  /** Scan front radius from the trunk base, metres: 0 = all retro, REVEAL_END = all real. */
  reveal: uniform(0),
  /** Unit vector towards the sun; keep it in step with the real sun (sky.sunDir). */
  sunDir: uniform(new Vector3(0.4, 0.8, 0.3).normalize()),
};

/** Sky pixels count as this far away (plus height), so the sky flips last, horizon first. */
const SKY_NEAR = 110;
const SKY_SPAN = 200;
export const REVEAL_END = SKY_NEAR + SKY_SPAN + 10;

/** 0 to 1 as the scan front passes a point at horizontal distance r; grass grows with it. */
export function revealedAt(r: F) {
  return smoothstep(r, r.add(3), retro.reveal);
}

const CYAN = vec3(0.1, 0.9, 1);
const MAGENTA = vec3(1, 0.16, 0.55);
/** Synthwave sky: deep indigo overhead to a hot lilac-pink at the horizon. */
const ZENITH = vec3(0.1, 0.05, 0.36);
const HORIZON = vec3(0.72, 0.3, 0.9);
const VIOLET = vec3(0.16, 0.04, 0.3);
/** Tree silhouettes: flat dark indigo, as palms against a sunset. */
const SILHOUETTE = vec3(0.06, 0.03, 0.2);

/** Antialiased grid lines over a world-space coordinate, cell size in metres. */
function gridLines(p: V2, cell: number, width: number) {
  const q = p.div(cell);
  const d = abs(fract(q.sub(0.5)).sub(0.5));
  const w = fwidth(q);
  const line = vec2(
    float(1).sub(smoothstep(width, width + 1, d.x.div(max(w.x, 1e-4)))),
    float(1).sub(smoothstep(width, width + 1, d.y.div(max(w.y, 1e-4)))),
  );
  // Fade where a cell shrinks below a few pixels, instead of shimmering into moire.
  const fade = float(1).sub(smoothstep(0.08, 0.35, max(w.x, w.y)));
  return max(line.x, line.y).mul(fade) as F;
}

/** Angular radius of the retro sun, radians: large, as on an 80s album cover. */
const SUN_RADIUS = 0.2;

/**
 * The synthwave sun, centred on the real sun's direction: a yellow-to-pink disc with horizontal
 * cut-outs that thicken towards its bottom, a pink halo and thin rays fanning out behind it.
 * Returns the colour to blend in and its coverage.
 */
function synthwaveSun(dir: V3) {
  const s = normalize(retro.sunDir) as unknown as V3;
  const right = normalize(cross(s, vec3(0, 1, 0)));
  const upT = cross(right, s);
  // Disc-local coordinates, in sun radii (small-angle projection onto the sun's tangent plane).
  const u = vec2(dot(dir, right), dot(dir, upT)).div(SUN_RADIUS);
  const r = u.length();
  const facing = step(0, dot(dir, s));

  const aa = max(fwidth(r), 1e-4);
  const disc = float(1).sub(smoothstep(float(1).sub(aa), float(1).add(aa), r));
  const hot = vec3(1, 0.92, 0.38);
  const orange = vec3(1, 0.5, 0.14);
  const pink = vec3(1, 0.18, 0.5);
  const body = mix(mix(pink, orange, smoothstep(-0.95, -0.25, u.y)), hot, smoothstep(0.2, 0.95, u.y));
  // Cut-outs: none above the middle, widening gaps towards the bottom.
  const gapWidth = smoothstep(0.1, -1, u.y).mul(0.6);
  const gaps = step(fract(u.y.mul(5.5)), gapWidth);
  const sunCover = disc.mul(float(1).sub(gaps)).mul(facing);

  // Halo and rays outside the disc.
  const outside = max(r.sub(1), 0);
  const halo = exp(outside.mul(-2.2)).mul(0.55);
  const angle = atan(u.y, u.x).div(Math.PI * 2);
  const spoke = abs(fract(angle.mul(28)).sub(0.5)).mul(2);
  const rays = smoothstep(0.86, 1, spoke).mul(exp(outside.mul(-0.45))).mul(step(1, r)).mul(0.55);
  const glow = MAGENTA.mul(halo.add(rays)).mul(facing);
  return { color: body, cover: sunCover, glow };
}

/** Indigo-to-pink sunset sky with faint horizontal bands and the synthwave sun where the real sun is. */
function retroSky(dir: V3) {
  const up = max(dir.y, 0);
  let color = mix(HORIZON, ZENITH, pow(up, 0.45)) as V3;
  color = color.add(MAGENTA.mul(exp(up.mul(-40)).mul(0.35)));
  // Thin lighter bands, strongest low in the sky, like an 80s airbrushed backdrop.
  const bands = step(0.82, fract(dir.y.mul(38))).mul(float(1).sub(smoothstep(0, 0.6, up))).mul(0.07);
  color = color.add(vec3(1, 0.8, 1).mul(bands));
  const sun = synthwaveSun(dir);
  color = color.add(sun.glow);
  return mix(color, sun.color, sun.cover) as V3;
}

export interface RetroInputs {
  /** Depth texture of the scene pass. */
  depth: TextureNode;
  /** The finished real image in display space (tone mapped, sRGB). */
  real: V3;
  camera: PerspectiveCamera;
}

/**
 * Composites the retro look over the real image (display space). Returns the mixed image and the
 * still-retro neon part, which the caller blooms so the glow fades out with the sweep.
 */
export function retroComposite({ depth, real, camera }: RetroInputs) {
  const projInv = uniform(camera.projectionMatrixInverse);
  const camWorld = uniform(camera.matrixWorld);
  const near = float(camera.near);
  const far = float(camera.far);

  {
    const uv = screenUV;
    const d = depth.sample(uv).x as F;
    const camPos = camWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const world = (u: V2, z: F) => camWorld.mul(vec4(getViewPosition(u, z, projInv), 1)).xyz;
    const dir = normalize(world(uv, float(1)).sub(camPos)) as unknown as V3;
    const hitPos = world(uv, d);
    const sceneDist = length(hitPos.sub(camPos));
    const isSky = d.greaterThanEqual(0.99999);

    // Ground plane hit along the ray (y = 0), when looking down.
    const down = dir.y.lessThan(-1e-4);
    const t = camPos.y.negate().div(min(dir.y, -1e-4));
    const ground = camPos.add(dir.mul(t));
    // Geometry standing clearly in front of the plane is an object (tree, fruit, debug views).
    const isObject = isSky.not().and(down.not().or(sceneDist.lessThan(t.mul(0.995).sub(0.05))));

    // Depth edges: compare linear depth with the four neighbours.
    const px = vec2(1).div(screenSize);
    const lin = (u: V2) => perspectiveDepthToViewZ(depth.sample(u).x, near, far).negate() as F;
    const zc = lin(uv);
    const dz = abs(lin(uv.add(vec2(px.x, 0))).sub(zc))
      .add(abs(lin(uv.sub(vec2(px.x, 0))).sub(zc)))
      .add(abs(lin(uv.add(vec2(0, px.y))).sub(zc)))
      .add(abs(lin(uv.sub(vec2(0, px.y))).sub(zc)));
    const edge = smoothstep(0.03, 0.12, dz.div(max(zc, 0.1)));

    // Ground: deep violet floor, a fine 1 m grid and a brighter 5 m grid fading into the haze.
    const gp = ground.xz;
    const haze = smoothstep(15, 85, t);
    const lines = max(gridLines(gp, 1, 0.6).mul(0.35), gridLines(gp, 5, 1.2));
    const pulse = sin(gp.length().mul(0.6).sub(time.mul(3))).mul(0.5).add(0.5).mul(0.25).add(0.75);
    const floorColor = mix(vec3(0.03, 0.0, 0.08), mix(VIOLET, HORIZON, 0.45), haze)
      .add(CYAN.mul(lines).mul(pulse).mul(float(1).sub(haze.mul(0.8))));

    // Objects: near-black fill hinting at their shading, with hot orange outlines.
    // Objects: flat silhouettes, faintly hazed with distance so far ones read lighter.
    const silhouetteHaze = smoothstep(12, 80, sceneDist).mul(0.55);
    const objectColor = mix(SILHOUETTE, HORIZON.mul(0.7), silhouetteHaze).add(MAGENTA.mul(edge).mul(0.06));

    const skyColor = retroSky(dir);
    const backdrop = select(down, floorColor, skyColor);
    let color = select(isObject, objectColor, backdrop) as V3;

    // CRT scanlines.
    color = color.mul(sin(screenCoordinate.y.mul(Math.PI)).mul(0.08).add(0.92));

    // Distance the scan front must reach to flip this pixel.
    const objDist = length(hitPos);
    // Capped so the endless grid past the real ground flips together with the horizon.
    const groundDist = min(ground.xz.length(), SKY_NEAR);
    const skyDist = float(SKY_NEAR).add(max(dir.y, 0).mul(SKY_SPAN));
    const dist = select(isObject, objDist, select(down, groundDist, skyDist));
    const shown = smoothstep(dist, dist.add(0.6), retro.reveal);
    const ring = exp(abs(dist.sub(retro.reveal)).mul(-1.5)).mul(step(0.5, retro.reveal));
    const ringFade = float(1).sub(smoothstep(REVEAL_END - 40, REVEAL_END, retro.reveal));

    const front = vec3(0.6, 0.95, 1).mul(ring).mul(ringFade).mul(0.9);
    const image = clamp(mix(color, real, shown).add(front), 0, 4) as V3;
    const neon = color.mul(float(1).sub(shown)).add(front) as V3;
    return { image, neon };
  }
}
