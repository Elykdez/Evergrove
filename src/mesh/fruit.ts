import * as THREE from 'three';
import type { Fruit } from '../core/fruit';
import { Vec3, cross, normalize, sub } from '../core/rng';

/** At or below this many segments fruit are flat-shaded, so they read as faceted polygons. */
export const FACETED_MAX_SEGMENTS = 8;
const STEM_COLOR = '#5a4632';

/**
 * One merged mesh for all fruit: an ellipsoid per fruit (segments around, half as many rings)
 * and a thin four-sided stem up to its twig tip. Colour is vertex colour, the tree's single fruit
 * colour, slightly lighter toward the top so the shape still reads under flat light.
 */
export function buildFruitGeometry(fruits: Fruit[], segments: number, srgb: Vec3): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base = new THREE.Color().setRGB(srgb[0], srgb[1], srgb[2], THREE.SRGBColorSpace);
  const stem = new THREE.Color(STEM_COLOR);
  const around = Math.max(3, Math.round(segments));
  const rings = Math.max(2, Math.round(around / 2));
  const faceted = around <= FACETED_MAX_SEGMENTS;

  const vertex = (p: Vec3, n: Vec3, c: THREE.Color) => {
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    colors.push(c.r, c.g, c.b);
    return positions.length / 3 - 1;
  };
  const shade = (phi: number) => base.clone().multiplyScalar(0.8 + 0.2 * (1 - phi / Math.PI));

  for (const f of fruits) {
    // Grid of surface points: row i from the top pole (phi 0) to the bottom (phi pi).
    const grid: { p: Vec3; n: Vec3; phi: number }[][] = [];
    for (let i = 0; i <= rings; i++) {
      const phi = (i / rings) * Math.PI;
      const row: { p: Vec3; n: Vec3; phi: number }[] = [];
      for (let j = 0; j <= around; j++) {
        const theta = (j / around) * Math.PI * 2 + f.spin;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        row.push({
          p: [f.center[0] + x * f.radius, f.center[1] + y * f.height, f.center[2] + z * f.radius],
          n: normalize([x / f.radius, y / f.height, z / f.radius]),
          phi,
        });
      }
      grid.push(row);
    }

    if (faceted) {
      const tri = (a: (typeof grid)[0][0], b: (typeof grid)[0][0], c: (typeof grid)[0][0]) => {
        const n = normalize(cross(sub(b.p, a.p), sub(c.p, a.p)));
        if (!Number.isFinite(n[0])) return;
        const col = shade((a.phi + b.phi + c.phi) / 3);
        indices.push(vertex(a.p, n, col), vertex(b.p, n, col), vertex(c.p, n, col));
      };
      for (let i = 0; i < rings; i++) {
        for (let j = 0; j < around; j++) {
          const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j], d = grid[i + 1][j + 1];
          if (i > 0) tri(a, b, c);
          if (i < rings - 1) tri(b, d, c);
        }
      }
    } else {
      const ids = grid.map((row) => row.map((v) => vertex(v.p, v.n, shade(v.phi))));
      for (let i = 0; i < rings; i++) {
        for (let j = 0; j < around; j++) {
          const a = ids[i][j], b = ids[i][j + 1], c = ids[i + 1][j], d = ids[i + 1][j + 1];
          if (i > 0) indices.push(a, b, c);
          if (i < rings - 1) indices.push(b, d, c);
        }
      }
    }

    addStem(f, stem, vertex, indices);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/** A four-sided prism from the twig tip down into the top of the fruit. */
function addStem(
  f: Fruit,
  color: THREE.Color,
  vertex: (p: Vec3, n: Vec3, c: THREE.Color) => number,
  indices: number[],
) {
  const top = f.stemTop;
  // Sink the stem slightly into the fruit so no gap shows at the joint.
  const bottom: Vec3 = [f.attach[0], f.attach[1] - f.height * 0.15, f.attach[2]];
  if (Math.hypot(...sub(top, bottom)) < 1e-3) return;
  const r = Math.min(0.008, Math.max(0.002, f.radius * 0.08));
  const corners = [0, 1, 2, 3].map((k) => {
    const a = (k / 4) * Math.PI * 2 + f.spin;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  });
  for (let k = 0; k < 4; k++) {
    const [x0, z0] = corners[k];
    const [x1, z1] = corners[(k + 1) % 4];
    const quad: Vec3[] = [
      [top[0] + x0, top[1], top[2] + z0],
      [top[0] + x1, top[1], top[2] + z1],
      [bottom[0] + x0, bottom[1], bottom[2] + z0],
      [bottom[0] + x1, bottom[1], bottom[2] + z1],
    ];
    const n = normalize([(x0 + x1) / 2, 0, (z0 + z1) / 2]);
    const [a, b, c, d] = quad.map((p) => vertex(p, n, color));
    indices.push(a, b, c, b, d, c);
  }
}
