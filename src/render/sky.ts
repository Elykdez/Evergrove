import { Fn, clamp, dot, float, max, mix, mx_fractal_noise_float, normalize, positionLocal, pow, smoothstep, time, uniform, vec2, vec3 } from 'three/tsl';
import { Color, Vector2, Vector3, type Node } from 'three/webgpu';

type V3 = Node<'vec3'>;

/**
 * Display-only sky, evaluated per pixel on the background sphere: a zenith-to-horizon gradient,
 * a glow around the sun and a drifting layer of soft clouds. It never reaches the exports.
 */
export const sky = {
  zenith: uniform(new Color('#5f8ee8')),
  horizon: uniform(new Color('#cfdcf0')),
  /** Unit vector towards the sun; keep it in step with the directional light. */
  sunDir: uniform(new Vector3(0.4, 0.8, 0.3).normalize()),
  sunColor: uniform(new Color('#fff6e4')),
  /** 0 = clear sky, 1 = overcast. */
  cover: uniform(0.45),
  /** Cloud layer offset in the ground plane; advanced on the CPU so speed changes never jump. */
  offset: uniform(new Vector2()),
};

/** Display-only sky settings; the panel edits these and applySky pushes them to the uniforms. */
export const skyDefaults = {
  cover: 0.45,
  cloudSpeed: 1,
  sunElevation: 58,
  sunAzimuth: 37,
  zenith: '#5f8ee8',
  horizon: '#cfdcf0',
};

/** Cloud drift at speed 1, sky units per second. */
const DRIFT = new Vector2(0.004, 0.0015);

export function advanceClouds(seconds: number, speed: number) {
  sky.offset.value.addScaledVector(DRIFT, seconds * speed);
}

/** Unit vector towards a sun at the given elevation and azimuth (degrees; azimuth 0 = +X, 90 = +Z). */
export function sunDirection(elevation: number, azimuth: number, out = new Vector3()) {
  const e = (elevation * Math.PI) / 180;
  const a = (azimuth * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
}

export const skyNode = Fn(() => {
  // The background sphere is centred on the camera, so its local position is the view ray.
  const dir = normalize(positionLocal) as unknown as V3;
  const up = max(dir.y, 0);

  // Gradient: a short haze band at the horizon, then a slow climb to the zenith colour.
  const base = mix(sky.horizon, sky.zenith, pow(up, 0.55));

  // Sun: a wide soft halo, a tighter glow and a small soft-edged disc (about 1.3 degrees across),
  // bright enough in linear light for the lens bloom to catch it.
  const toSun = max(dot(dir, sky.sunDir), 0);
  const halo = pow(toSun, 6).mul(0.18).add(pow(toSun, 64).mul(0.45)).add(pow(toSun, 900).mul(1.2));
  const disc = smoothstep(0.99972, 0.99982, toSun).mul(6);
  let color = base.add(sky.sunColor.mul(halo.add(disc)));

  // Clouds: project the ray onto a flat layer overhead so they flatten towards the horizon.
  const plane = dir.xz.div(max(dir.y, 0.04)).mul(1.4);
  const p = plane.add(vec2(sky.offset));
  const n = mx_fractal_noise_float(vec3(p.x, p.y, time.mul(0.003)), 5, 2.1, 0.5, 1);
  const thresh = mix(float(0.3), float(-0.4), sky.cover);
  const density = smoothstep(thresh, thresh.add(0.35), n);
  // Fade the layer out near the horizon, where the projection would alias.
  const fade = smoothstep(0.02, 0.25, dir.y);
  const lit = mix(vec3(0.82, 0.86, 0.94), vec3(1, 1, 1), clamp(toSun.mul(1.4), 0, 1));
  color = mix(color, lit, density.mul(fade).mul(0.75));

  // Below the horizon, settle on the horizon colour so the fogged ground edge disappears.
  return mix(sky.horizon, color, smoothstep(-0.02, 0.01, dir.y));
});
