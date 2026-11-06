import {
  Fn,
  attribute,
  clamp,
  cos,
  dot,
  float,
  hash,
  max,
  min,
  mix,
  normalize,
  positionLocal,
  sin,
  smoothstep,
  sqrt,
  transformNormalToView,
  uniform,
  uv,
  vec2,
  vec3,
  vertexStage,
} from 'three/tsl';
import {
  BufferAttribute,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshLambertNodeMaterial,
  type Node,
} from 'three/webgpu';
import { mulberry32 } from '../core/rng';
import { wind } from './wind';
import { revealedAt } from './retro';

type F = Node<'float'>;

/** Per-instance attribute: (x, z, rotation, seed). */
const BLADE_ATTRIBUTE = 'grassBlade';
/** Rows of the blade below the tip; triangles per blade = 2 * (SEGMENTS - 1) + 1. */
const SEGMENTS = 3;
export const GRASS_TRIANGLES_PER_BLADE = 2 * (SEGMENTS - 1) + 1;
/** Hard cap so a typo in the GUI cannot allocate millions of blades. */
export const MAX_GRASS = 200000;

/** Plain settings the GUI binds to; sync() copies them into uniforms each frame. */
export interface GrassSettings {
  enabled: boolean;
  /** Number of blades. */
  count: number;
  /** Mean blade height, metres. */
  height: number;
  /** Mean blade width at the root, metres. */
  width: number;
  /** Base (root) colour, hex. */
  color: string;
  /** Tip colour, hex. */
  tipColor: string;
  /** How far the grass bends in the shared wind; 0 holds it still. */
  windResponse: number;
}

export interface GrassOptions extends Partial<GrassSettings> {
  /** Placement seed; the same seed always gives the same field. */
  seed?: number;
  /** Bare circle around the trunk base, metres. */
  clearing?: number;
  /** Outer radius of the field, metres; keep it inside the fog. */
  radius?: number;
}

export const GRASS_DEFAULTS: GrassSettings = {
  enabled: true,
  count: 70000,
  height: 0.5,
  width: 0.035,
  color: '#4e6b2a',
  tipColor: '#a9b964',
  windResponse: 1,
};

/** One tapered blade, one unit tall and one unit wide at the root, in the local xy plane. */
function bladeAttributes() {
  const pos: number[] = [];
  const uvs: number[] = [];
  const nrm: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const y = i / SEGMENTS;
    const hw = 0.5 * Math.pow(1 - y, 0.6);
    pos.push(-hw, y, 0, hw, y, 0);
    uvs.push(0.5 - hw, y, 0.5 + hw, y);
    nrm.push(0, 1, 0, 0, 1, 0);
  }
  pos.push(0, 1, 0);
  uvs.push(0.5, 1);
  nrm.push(0, 1, 0);
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = 2 * i;
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const top = 2 * (SEGMENTS - 1);
  index.push(top, top + 1, top + 2);
  return {
    position: new BufferAttribute(new Float32Array(pos), 3),
    uv: new BufferAttribute(new Float32Array(uvs), 2),
    normal: new BufferAttribute(new Float32Array(nrm), 3),
    index: new BufferAttribute(new Uint16Array(index), 1),
  };
}

/**
 * Display-only grass field (never exported): instanced blades scattered over the ground disc,
 * bent in the vertex shader by the same wind uniforms as the tree. Placement is seeded and
 * generated sequentially, so any count is a prefix of a larger one: lowering the count only
 * shrinks the draw, and only raising it past the allocated capacity rebuilds the buffer.
 */
export class Grass {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshLambertNodeMaterial>;
  readonly settings: GrassSettings;
  readonly uniforms = {
    height: uniform(GRASS_DEFAULTS.height),
    width: uniform(GRASS_DEFAULTS.width),
    color: uniform(new Color(GRASS_DEFAULTS.color)),
    tipColor: uniform(new Color(GRASS_DEFAULTS.tipColor)),
    windResponse: uniform(GRASS_DEFAULTS.windResponse),
    clearing: uniform(0.4),
    radius: uniform(30),
  };
  private readonly seed: number;
  private capacity = 0;
  private applied = -1;
  private appliedColor = '';
  private appliedTip = '';

  constructor(options: GrassOptions = {}) {
    const { seed = 1337, clearing = 0.4, radius = 30, ...rest } = options;
    this.settings = { ...GRASS_DEFAULTS, ...rest };
    this.seed = seed;
    this.uniforms.clearing.value = clearing;
    this.uniforms.radius.value = radius;
    this.mesh = new Mesh(new InstancedBufferGeometry(), this.createMaterial());
    this.mesh.name = 'Grass';
    // The geometry's bounds are one blade at the origin; the field spans the whole disc.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.sync();
  }

  /** Sets the blade count; rebuilds the instance buffer only when it grows past capacity. */
  setCount(n: number) {
    const count = Math.max(0, Math.min(MAX_GRASS, Math.round(n)));
    this.settings.count = count;
    if (count > this.capacity) this.rebuild(count);
    this.mesh.geometry.instanceCount = count;
    this.applied = count;
  }

  /** Copies the settings into uniforms (cheap; call once per frame or after a GUI change). */
  sync() {
    const s = this.settings;
    const u = this.uniforms;
    this.mesh.visible = s.enabled && s.count > 0;
    if (s.count !== this.applied) this.setCount(s.count);
    u.height.value = Math.max(0, s.height);
    u.width.value = Math.max(0, s.width);
    u.windResponse.value = Math.max(0, s.windResponse);
    if (s.color !== this.appliedColor) {
      u.color.value.set(s.color);
      this.appliedColor = s.color;
    }
    if (s.tipColor !== this.appliedTip) {
      u.tipColor.value.set(s.tipColor);
      this.appliedTip = s.tipColor;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  /**
   * Seeded scatter by rejection: uniform over the disc, kept with a probability that is high near
   * the trunk, falls off outward to a sparse floor, fades to zero at the rim, and is zero inside
   * the clearing.
   */
  private rebuild(count: number) {
    const rng = mulberry32(this.seed);
    const clearing = this.uniforms.clearing.value;
    const radius = this.uniforms.radius.value;
    const data = new Float32Array(count * 4);
    const smooth = (e0: number, e1: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    for (let i = 0; i < count; ) {
      const r = radius * Math.sqrt(rng());
      const a = rng() * Math.PI * 2;
      const keep =
        (0.12 + 0.88 * Math.exp(-r / (radius * 0.27))) *
        smooth(clearing, clearing + 0.35, r) *
        smooth(radius, radius * 0.8, r);
      if (rng() >= keep) continue;
      data[i * 4] = r * Math.cos(a);
      data[i * 4 + 1] = r * Math.sin(a);
      data[i * 4 + 2] = rng() * Math.PI * 2;
      // Integer seed for the shader hash; small enough that seed * 16 + k stays exact in float32.
      data[i * 4 + 3] = Math.floor(rng() * 65536);
      i++;
    }
    const old = this.mesh.geometry;
    const geometry = new InstancedBufferGeometry();
    const blade = bladeAttributes();
    geometry.setAttribute('position', blade.position);
    geometry.setAttribute('uv', blade.uv);
    geometry.setAttribute('normal', blade.normal);
    geometry.setIndex(blade.index);
    geometry.setAttribute(BLADE_ATTRIBUTE, new InstancedBufferAttribute(data, 4));
    geometry.instanceCount = count;
    this.mesh.geometry = geometry;
    old.dispose();
    this.capacity = count;
  }

  private createMaterial() {
    const u = this.uniforms;
    const blade = attribute(BLADE_ATTRIBUTE, 'vec4');
    const rnd = (k: number) => hash(blade.w.mul(16).add(k)) as F;

    const material = new MeshLambertNodeMaterial({ side: DoubleSide });
    material.name = 'Grass';

    material.positionNode = Fn(() => {
      const local = positionLocal as unknown as Node<'vec3'>;
      const t = local.y;
      const base = vec2(blade.x, blade.y);
      const r = base.length();

      // Shape: per-blade height, width and forward lean, plus slow patches of taller grass.
      // Blades also shorten towards the clearing and the rim so neither edge looks cut.
      const patch = sin(base.x.mul(0.31).add(sin(base.y.mul(0.17)).mul(2)))
        .mul(sin(base.y.mul(0.27).add(sin(base.x.mul(0.13)).mul(2))))
        .mul(0.25)
        .add(0.85);
      const edge = smoothstep(u.clearing, u.clearing.add(0.6), r)
        .mul(smoothstep(u.radius, u.radius.mul(0.7), r))
        .mul(0.6)
        .add(0.4);
      // Zero until the intro scan front passes, so the blades sprout behind it.
      const height = u.height.mul(rnd(1).mul(0.8).add(0.6)).mul(patch).mul(edge).mul(revealedAt(r));
      const width = u.width.mul(rnd(2).mul(0.6).add(0.7));
      const lean = rnd(3).mul(0.3).add(0.05).mul(height);
      const px = local.x.mul(width);
      const pz = lean.mul(t).mul(t);
      const c = cos(blade.z);
      const s = sin(blade.z);
      const bent = vec2(px.mul(c).add(pz.mul(s)), pz.mul(c).sub(px.mul(s)));

      // Wind: the shared strength is metres at the tree top, so divide by tree height to get a
      // unitless push that does not grow with taller presets, then scale by blade height.
      const rel = wind.strength.div(max(wind.height, 0.1));
      const push = rel.mul(12).mul(u.windResponse);
      const live = smoothstep(0, 0.004, rel).mul(min(u.windResponse, 1));
      const time = wind.time.mul(wind.speed);
      const dir = wind.dir;
      const across = vec2(dir.y.negate(), dir.x);
      const down = dot(base, dir);
      const side = dot(base, across);
      // Waves travel downwind: phase falls with distance along the wind and rises with time.
      const gust = sin(down.mul(0.35).sub(time.mul(1.7)).add(sin(side.mul(0.11)).mul(1.5)))
        .mul(0.6)
        .add(sin(down.mul(0.9).add(side.mul(0.4)).sub(time.mul(2.9))).mul(0.4))
        .mul(0.5)
        .add(0.5);
      const phase = rnd(4).mul(6.2831853);
      const flutter = sin(time.mul(5.1).add(phase).add(down.mul(1.3)))
        .mul(0.06)
        .add(sin(time.mul(8.3).add(phase.mul(2.7))).mul(0.03))
        .mul(live)
        .mul(push.add(0.5));
      const flutterSide = sin(time.mul(4.3).add(phase.mul(1.9))).mul(0.05).mul(live).mul(push.add(0.5));
      // Tip displacement as a fraction of blade height, capped so a blade never folds flat.
      const amount = push.mul(gust.mul(0.55).add(0.45)).add(flutter);
      const tip = dir.mul(amount).add(across.mul(flutterSide));
      const tipLen = tip.length();
      const tipFrac = tip.mul(min(tipLen, 0.85).div(max(tipLen, 1e-5)));
      // More bend at the tip than the root, and the blade drops a little as it arcs over.
      const tt = t.mul(t);
      const sway = tipFrac.mul(height).mul(tt);
      const drop = sqrt(clamp(float(1).sub(dot(tipFrac, tipFrac).mul(0.6)), 0.2, 1));
      return vec3(base.x.add(bent.x).add(sway.x), t.mul(height).mul(drop), base.y.add(bent.y).add(sway.y));
    })();

    // Mostly-up normals (tilted slightly towards the blade face) light the field like the ground
    // and look the same from both sides, so thin blades never flip dark.
    const face = vec3(sin(blade.z).mul(0.3), 1, cos(blade.z).mul(0.3));
    material.normalNode = transformNormalToView(vertexStage(normalize(face)));

    const tint = vertexStage(vec3(rnd(5), rnd(6), rnd(7)));
    material.colorNode = Fn(() => {
      const t = uv().y;
      let color = mix(u.color, u.tipColor, t.mul(0.85).add(tint.z.mul(0.3).sub(0.15)).clamp(0, 1));
      // Per-blade brightness and a few drier, yellower blades.
      color = color.mul(tint.x.mul(0.35).add(0.8));
      color = mix(color, color.mul(vec3(1.18, 1.05, 0.55)), smoothstep(0.75, 1, tint.y).mul(0.6));
      // Darker at the root, as the blades shade each other.
      return color.mul(smoothstep(0, 0.45, t).mul(0.55).add(0.45));
    })();
    return material;
  }
}
