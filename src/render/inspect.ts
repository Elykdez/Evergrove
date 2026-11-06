import * as THREE from 'three/webgpu';
import type { Crown } from '../core/crown';
import { OUTSIDE_TOLERANCE, inspectTree, type Inspection } from '../core/inspect';
import type { Vec3 } from '../core/rng';
import type { TreeResult } from '../tree';

/** Scene > Debugger switches; display-only, like everything in src/render. */
export interface DebugSettings {
  enabled: boolean;
  /** Hide leaves and fruit while debugging, so the skeleton and markers are in plain sight. */
  hideFoliage: boolean;
  surface: boolean;
  opacity: number;
  ends: boolean;
  joints: boolean;
  bases: boolean;
  unreached: boolean;
  /** Markers draw on top of everything, even inside the bark. */
  xray: boolean;
}

export const DEBUG_DEFAULTS: DebugSettings = {
  enabled: false,
  hideFoliage: true,
  surface: true,
  opacity: 0.3,
  ends: true,
  joints: true,
  bases: true,
  unreached: true,
  xray: false,
};

const COLORS = {
  dip: new THREE.Color('#3f7fe0'),
  flat: new THREE.Color('#8fd19e'),
  bump: new THREE.Color('#f2a33a'),
  bare: new THREE.Color('#7a7f87'),
  deep: new THREE.Color('#3a6ee8'),
  onSurface: new THREE.Color('#38d36b'),
  outside: new THREE.Color('#ff3b30'),
  fork: new THREE.Color('#ffc21a'),
  multiway: new THREE.Color('#ff5ad1'),
  base: new THREE.Color('#ffffff'),
  unreached: new THREE.Color('#a45cff'),
};

/**
 * Algorithm debugger: the crown envelope as a semi-transparent solid (built on the CPU with
 * Crown.point itself, so it is the exact surface the growth sampled, coloured by the 1/f noise),
 * plus markers for where branches end, meet and stand, and for crown samples never reached.
 * Everything is built lazily, only while it is shown.
 */
export class DebugOverlay {
  readonly group = new THREE.Group();
  private result: TreeResult | null = null;
  private cut = -1;
  private inspection: Inspection | null = null;
  private surfaceBuilt = false;
  private markersBuilt = false;

  private readonly surfaceMaterial = new THREE.MeshStandardNodeMaterial({
    vertexColors: true,
    transparent: true,
    opacity: DEBUG_DEFAULTS.opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.6,
  });
  private readonly surface = new THREE.Mesh(new THREE.BufferGeometry(), this.surfaceMaterial);
  private readonly markerMaterial = new THREE.MeshBasicNodeMaterial({ color: '#ffffff' });
  private readonly markers = {
    ends: this.instanced(new THREE.OctahedronGeometry(1)),
    joints: this.instanced(new THREE.IcosahedronGeometry(1, 1)),
    bases: this.instanced(new THREE.TorusGeometry(1, 0.12, 6, 32).rotateX(Math.PI / 2)),
    unreached: this.instanced(new THREE.TetrahedronGeometry(1)),
  };

  constructor() {
    this.group.name = 'Debugger';
    this.surface.renderOrder = 2;
    this.group.add(this.surface);
  }

  /** New tree: everything shown is rebuilt on the next sync. */
  update(result: TreeResult, cut: number) {
    this.result = result;
    this.cut = cut;
    this.inspection = null;
    this.surfaceBuilt = this.markersBuilt = false;
  }

  /** The report for the HUD; computed on demand. */
  report(): Inspection | null {
    if (!this.result) return null;
    this.inspection ??= inspectTree(this.result.crown, this.result.graph, this.result.tips, this.result.unreached);
    return this.inspection;
  }

  sync(s: DebugSettings) {
    this.group.visible = s.enabled;
    if (!s.enabled || !this.result) return;
    this.surface.visible = s.surface;
    this.surfaceMaterial.opacity = s.opacity;
    if (s.surface && !this.surfaceBuilt) {
      this.surface.geometry.dispose();
      this.surface.geometry = envelopeGeometry(this.result.crown, this.cut);
      this.surfaceBuilt = true;
    }
    const anyMarker = s.ends || s.joints || s.bases || s.unreached;
    if (anyMarker && !this.markersBuilt) {
      this.buildMarkers(this.report()!);
      this.markersBuilt = true;
    }
    this.markers.ends.visible = s.ends;
    this.markers.joints.visible = s.joints;
    this.markers.bases.visible = s.bases;
    this.markers.unreached.visible = s.unreached;
    if (this.markerMaterial.depthTest === s.xray) {
      this.markerMaterial.depthTest = !s.xray;
      this.markerMaterial.needsUpdate = true;
    }
  }

  private instanced(geometry: THREE.BufferGeometry, capacity = 1) {
    const mesh = new THREE.InstancedMesh(geometry, this.markerMaterial, capacity);
    // Colours exist from the start, so the material compiles with them once.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.group.add(mesh);
    return mesh;
  }

  private buildMarkers(r: Inspection) {
    const deep = new THREE.Color();
    this.fill('ends', r.ends, (e) => [e.pos, 0.045], (e) =>
      e.depth > OUTSIDE_TOLERANCE
        ? COLORS.outside
        : deep.lerpColors(COLORS.deep, COLORS.onSurface, THREE.MathUtils.clamp(1 + e.depth * 2, 0, 1)),
    );
    this.fill('joints', r.joints, (j) => [j.pos, THREE.MathUtils.clamp(j.radius * 1.25, 0.04, 0.12)], (j) =>
      j.branches > 2 ? COLORS.multiway : COLORS.fork,
    );
    this.fill('bases', r.bases, (b) => [b.pos, Math.max(b.radius * 1.6, 0.12)], () => COLORS.base);
    this.fill('unreached', r.unreached, (p) => [p, 0.06], () => COLORS.unreached);
  }

  private fill<T>(key: keyof DebugOverlay['markers'], items: T[], place: (t: T) => [Vec3, number], color: (t: T) => THREE.Color) {
    let mesh = this.markers[key];
    if (mesh.instanceMatrix.count < items.length) {
      // Instance buffers cannot grow: replace the mesh with a larger one.
      this.group.remove(mesh);
      mesh.dispose();
      mesh = this.markers[key] = this.instanced(mesh.geometry, Math.ceil(items.length * 1.5));
    }
    const m = new THREE.Matrix4();
    items.forEach((t, i) => {
      const [p, s] = place(t);
      mesh.setMatrixAt(i, m.makeScale(s, s, s).setPosition(p[0], p[1], p[2]));
      mesh.setColorAt(i, color(t));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * The envelope as a solid: a unit sphere's directions pushed through Crown.point. Coloured by the
 * spectral noise (cool dips, warm bumps); directions below the tip cut, which grow no tips, are grey.
 */
function envelopeGeometry(crown: Crown, cut: number) {
  const g = new THREE.SphereGeometry(1, 96, 48);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const amount = crown.p.noiseAmount;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const d: Vec3 = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const p = crown.point(d);
    pos.setXYZ(i, p[0], p[1], p[2]);
    if (d[1] < cut) c.copy(COLORS.bare);
    else {
      // The noise has unit variance, so +-2 covers nearly all of it.
      const n = amount > 0 ? THREE.MathUtils.clamp(crown.noise(d) / 2, -1, 1) : 0;
      c.lerpColors(COLORS.flat, n < 0 ? COLORS.dip : COLORS.bump, Math.abs(n));
    }
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
