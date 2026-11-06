import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { float, fract, hash, max, mix, pass, renderOutput, screenCoordinate, screenUV, smoothstep, time, uniform, vec4 } from 'three/tsl';
import { RenderPipeline, type Node, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { retroComposite } from './retro';

/** Display-only lens settings; the defaults give the cinematic look, 0 switches an effect off. */
export const lensDefaults = { enabled: true, dof: 1.2, bloom: 0.2, vignette: 0.3, grain: 0.03, exposure: 1 };

export const lens = {
  /** Distance along the view to the sharp plane, metres; follow the orbit target each frame. */
  focus: uniform(17),
  /** Distance from the sharp plane at which blur is full, metres. */
  range: uniform(10),
  bokeh: uniform(lensDefaults.dof),
  vignette: uniform(lensDefaults.vignette),
  grain: uniform(lensDefaults.grain),
};

/**
 * Scene pass, then depth of field and a soft bloom in linear light, then tone mapping, then a
 * vignette and film grain in display space so the grain stays even across shadows and highlights.
 *
 * It starts in the retro look (render/retro.ts) composited over that same image; setRetro(false)
 * swaps to the plain output so the retro pass costs nothing while it is off.
 */
export function createLensPipeline(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const viewZ = scenePass.getViewZNode();

  // The typings declare the DOF node untyped; it outputs vec4 like the other display nodes.
  const sharp = dof(color, viewZ, lens.focus, lens.range, lens.bokeh) as unknown as Node<'vec4'>;
  // Threshold above the sky's brightness, so only the sun glow and sunlit highlights bloom.
  const glow = bloom(color, lensDefaults.bloom, 0.4, 1.1);
  const hdr = vec4(sharp.rgb.add(glow.rgb), 1);
  const display = renderOutput(hdr);

  const edge = smoothstep(0.45, 1, screenUV.sub(0.5).length().mul(1.3));
  const shade = mix(float(1), float(1).sub(lens.vignette), edge);
  const seed = screenCoordinate.x.add(screenCoordinate.y.mul(1931)).add(fract(time.mul(0.37)).mul(7919));
  const noise = hash(seed).sub(0.5).mul(lens.grain);
  const finish = (image: Node<'vec3'>) => vec4(max(image.mul(shade).add(noise), 0), 1);

  const retro = retroComposite({ depth: scenePass.getTextureNode('depth'), real: display.rgb, camera });
  // The neon glow: a wide bloom of the still-retro part only, so it fades with the sweep. The
  // threshold sits above the bright sunset sky, so only the grid, the sun and the scan ring glow.
  const neonGlow = bloom(vec4(retro.neon, 1), 0.75, 0.45, 0.5);
  const introOut = finish(retro.image.add(neonGlow.rgb));
  const plainOut = finish(display.rgb);

  const pipeline = new RenderPipeline(renderer, introOut);
  // Tone mapping and colour space are already applied above, before the display-space effects.
  pipeline.outputColorTransform = false;
  const setRetro = (on: boolean) => {
    pipeline.outputNode = on ? introOut : plainOut;
    pipeline.needsUpdate = true;
  };
  return { pipeline, bloom: glow, setRetro };
}
