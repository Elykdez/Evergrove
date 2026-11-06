import * as THREE from 'three';

/**
 * Leaf vertex attribute read by the wind shader (src/render/wind.ts): x = flutter weight
 * (0 at the petiole, leaf length in metres at the tip), y = per-leaf phase 0..1.
 */
export const WIND_ATTRIBUTE = 'wind';

/** The same geometry without the wind attribute, sharing every other buffer: for export. */
export function withoutWind(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.getAttribute(WIND_ATTRIBUTE)) return geo;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) if (name !== WIND_ATTRIBUTE) out.setAttribute(name, attr);
  out.setIndex(geo.index);
  out.boundingSphere = geo.boundingSphere;
  return out;
}
