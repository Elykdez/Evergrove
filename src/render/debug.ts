import {
  Fn,
  Loop,
  abs,
  clamp,
  dot,
  float,
  int,
  ivec2,
  length,
  max,
  mod,
  normalize,
  positionLocal,
  pow,
  select,
  sin,
  smoothstep,
  textureLoad,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import {
  DataTexture,
  FloatType,
  LineBasicNodeMaterial,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  RGBAFormat,
  SphereGeometry,
  Vector3,
  type Node,
} from 'three/webgpu';
import type { Crown, CrownShape } from '../core/crown';

/** Matches the GUI's mode slider maximum, with headroom. */
const MAX_MODES = 256;
const SHAPE_INDEX: Record<CrownShape, number> = { sphere: 0, cone: 1, umbrella: 2 };

/**
 * Crown envelope wireframe, displaced entirely on the GPU: a static unit sphere whose vertices
 * evaluate the same profile and spectral-noise sum as Crown.point(). The modes live in a float
 * texture (two texels each), so a regenerate only uploads a few kilobytes instead of moving
 * vertices on the CPU.
 */
export class CrownEnvelope {
  readonly mesh: Mesh;
  private readonly data = new Float32Array(MAX_MODES * 2 * 4);
  private readonly modes = new DataTexture(this.data, MAX_MODES * 2, 1, RGBAFormat, FloatType);
  private readonly u = {
    count: uniform(0, 'int'),
    norm: uniform(1),
    noise: uniform(0),
    radius: uniform(1),
    stretch: uniform(1),
    shape: uniform(0, 'int'),
    center: uniform(new Vector3()),
    taper: uniform(0),
    squareness: uniform(2),
    underside: uniform(0.45),
    rim: uniform(-0.125),
    softness: uniform(0.75),
  };

  constructor() {
    this.modes.minFilter = this.modes.magFilter = NearestFilter;
    const { u, modes } = this;
    const material = new MeshBasicNodeMaterial({ color: '#2f6fb0', wireframe: true, transparent: true, opacity: 0.35 });
    material.positionNode = Fn(() => {
      const d = normalize(positionLocal as unknown as Node<'vec3'>);
      const s = float(0).toVar();
      Loop({ start: int(0), end: u.count, type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
        const a = textureLoad(modes, ivec2(i.mul(2), 0));
        const b = textureLoad(modes, ivec2(i.mul(2).add(1), 0));
        s.addAssign(b.x.mul(sin(a.w.mul(Math.PI * 2).mul(dot(a.xyz, d)).add(b.y))));
      });
      // Same profiles as Crown.profile (sphereProfile, umbrellaProfile in core/crown.ts).
      const cone = float(0.03).add(smoothstep(-1, 1, d.y).oneMinus().mul(0.97));
      const half = max(u.softness, 0.01).mul(0.5);
      const under = clamp(u.underside, 0, 1);
      const umbrella = under.add(under.oneMinus().mul(smoothstep(u.rim.sub(half), u.rim.add(half), d.y)));
      const n = max(u.squareness, 0.5);
      const w = max(length(d.xz), 1e-6);
      const square = pow(pow(w, n).add(pow(max(abs(d.y), 1e-6), n)), float(-1).div(n));
      const sphere = float(1).sub(clamp(u.taper, -1, 1).mul(d.y).mul(0.5)).mul(square);
      const profile = select(u.shape.equal(1), cone, select(u.shape.equal(2), umbrella, sphere));
      const r = max(profile.mul(s.div(u.norm).mul(u.noise).add(1)), 0.15).mul(u.radius);
      // A true cone keeps its height from d.y and only tapers the width (see Crown.point).
      const flat = length(d.xz);
      const out = select(flat.greaterThan(1e-6), d.xz.div(max(flat, 1e-6)), vec2(1, 0));
      const conePoint = vec3(out.x.mul(r), d.y.mul(u.radius).mul(u.stretch), out.y.mul(r));
      const roundPoint = vec3(d.x.mul(r), d.y.mul(r).mul(u.stretch), d.z.mul(r));
      return u.center.add(select(u.shape.equal(1), conePoint, roundPoint));
    })();
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), material);
    this.mesh.frustumCulled = false;
  }

  update(crown: Crown) {
    const modes = crown.spectrum.slice(0, MAX_MODES);
    this.data.fill(0);
    modes.forEach((m, i) => {
      this.data.set([m.w[0], m.w[1], m.w[2], m.f, m.a, m.phase, 0, 0], i * 8);
    });
    this.modes.needsUpdate = true;
    const p = crown.p;
    this.u.count.value = modes.length;
    this.u.norm.value = crown.norm;
    this.u.noise.value = p.noiseAmount;
    this.u.radius.value = p.radius;
    this.u.stretch.value = p.stretch;
    this.u.shape.value = SHAPE_INDEX[p.shape];
    this.u.center.value.set(...crown.center);
    this.u.taper.value = p.sphereTaper;
    this.u.squareness.value = p.sphereSquareness;
    this.u.underside.value = p.umbrellaUnderside;
    this.u.rim.value = p.umbrellaRim;
    this.u.softness.value = p.umbrellaSoftness;
  }
}

/**
 * Growth skeleton material: colour from height in the shader (blue low, red high), the same HSL
 * ramp the CPU used to bake per vertex.
 */
export function skeletonMaterial(top: Node<'float'>) {
  const material = new LineBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const h = clamp((positionLocal as unknown as Node<'vec3'>).y.div(max(top, 1e-3)), 0, 1);
    const hue = h.oneMinus().mul(240 / 360);
    // hsl(hue, 0.75, 0.5) to sRGB, then to linear for the node pipeline.
    const k = clamp(abs(mod(vec3(hue.mul(6)).add(vec3(0, 4, 2)), 6).sub(3)).sub(1), 0, 1);
    const srgb = k.sub(0.5).mul(0.75).add(0.5);
    return pow(srgb, vec3(2.2));
  })();
  return material;
}
