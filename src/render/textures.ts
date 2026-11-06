import { abs, clamp, cos, float, floor, hash, max, mix, mod, pow, select, sin, smoothstep, step, uv, vec2, vec4 } from 'three/tsl';
import { Color, MeshBasicNodeMaterial, NoBlending, QuadMesh, RenderTarget, type Node, type WebGPURenderer } from 'three/webgpu';
import { hexToRgb } from '../core/fruit';
import { SHAPES, halfWidth, leafLayout, type LeafShape, type ShapeDef } from '../mesh/textures';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V4 = Node<'vec4'>;

/**
 * Procedural textures computed per pixel on the GPU. Each one is a fragment shader rendered into
 * a render target once, then read back into a canvas: the canvas feeds the CanvasTexture used for
 * rendering, GLB embedding and PNG download alike.
 */
export class TextureBaker {
  /** Whether readback rows come out bottom-up; probed once, since it differs per backend. */
  private flip: boolean | null = null;

  constructor(private readonly renderer: WebGPURenderer) {}

  /**
   * Grey-scale leaf with the outline in alpha (alpha-tested cutout). Per-leaf vertex colours
   * multiply it, so one texture serves every hue and season. Petiole at the bottom, tip at the top.
   */
  leaf(shape: LeafShape, size = 512) {
    return this.bake(leafNode(SHAPES[shape], size), size, size);
  }

  /** Vertical fibres cut by darker fissures, tileable both ways so it wraps the tube seam. */
  bark(color: string, width = 256, height = 512) {
    return this.bake(barkNode(hexToRgb(color)), width, height);
  }

  private async bake(node: V4, width: number, height: number): Promise<HTMLCanvasElement> {
    const flip = await this.orientation();
    const px = await this.render(node, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (flip ? height - 1 - y : y) * row;
      img.data.set(px.subarray(src, src + row), y * row);
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  /** Renders "red where uv.y > 0.5" into a 1 x 2 target; red in the first row means rows are top-down. */
  private async orientation() {
    if (this.flip === null) {
      const px = await this.render(vec4(step(0.5, uv().y), 0, 0, 1), 1, 2);
      this.flip = px[0] < 128;
    }
    return this.flip;
  }

  private async render(node: V4, width: number, height: number): Promise<Uint8Array> {
    const material = new MeshBasicNodeMaterial();
    material.fragmentNode = node;
    material.blending = NoBlending;
    material.toneMapped = false;
    const quad = new QuadMesh(material);
    const target = new RenderTarget(width, height, { depthBuffer: false });
    const r = this.renderer;
    const previous = r.getRenderTarget();
    const clearColor = r.getClearColor(new Color());
    const clearAlpha = r.getClearAlpha();
    try {
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear();
      quad.render(r);
      r.setRenderTarget(previous);
      return new Uint8Array((await r.readRenderTargetPixelsAsync(target, 0, 0, width, height)).buffer);
    } finally {
      r.setRenderTarget(previous);
      r.setClearColor(clearColor, clearAlpha);
      target.dispose();
      material.dispose();
    }
  }
}

/** Texture-space pixel position, y down (canvas convention): the readback is arranged to match. */
function pixel(width: number, height: number): V2 {
  return vec2(uv().x.mul(width), uv().y.oneMinus().mul(height));
}

/** Value noise on a lattice, smooth-interpolated. Wraps every gx by gy cells when tile is set. */
function valueNoise(x: F, y: F, seed: number, gx = 0, gy = 0): F {
  const ix = floor(x);
  const iy = floor(y);
  const fx = x.sub(ix);
  const fy = y.sub(iy);
  const sx = fx.mul(fx).mul(fx.mul(-2).add(3));
  const sy = fy.mul(fy).mul(fy.mul(-2).add(3));
  const at = (ax: F, ay: F) => {
    const cx = gx > 0 ? mod(ax, gx) : ax.add(4096);
    const cy = gy > 0 ? mod(ay, gy) : ay.add(4096);
    return hash(cy.mul(8192).add(cx).add(seed * 7919)) as unknown as F;
  };
  const a = mix(at(ix, iy), at(ix.add(1), iy), sx);
  const b = mix(at(ix, iy.add(1)), at(ix.add(1), iy.add(1)), sx);
  return mix(a, b, sy);
}

function leafNode(def: ShapeDef, size: number): V4 {
  const { cx, base, tip, len } = leafLayout(size);
  const p = pixel(size, size);
  const dx = abs(p.x.sub(cx));
  const t = p.y.mul(-1).add(base).div(len);
  const inLength = step(0, t).mul(step(t, 1));

  // Same outline formula as halfWidth() in mesh/textures.ts, per pixel.
  const tc = clamp(t, 0, 1);
  let w: F = pow(max(sin(pow(tc, def.skew).mul(Math.PI)), 0), def.power).mul(def.width);
  if (def.lobes > 0) w = w.mul(pow(abs(cos(tc.mul(def.lobes * Math.PI * 0.5))), 0.6).mul(0.45).add(0.55));
  w = w.mul(abs(sin(tc.mul(def.teeth * Math.PI))).sub(0.5).mul(def.serration).add(1));
  const hw = max(w, 0).mul(len).mul(inLength);
  const edge = hw.sub(dx);
  const blade = clamp(edge.add(0.5), 0, 1).mul(inLength);

  // Blade: brighter along the midrib, darker toward the rim, with fine mottling.
  let grey: F = mix(float(168 / 255), float(240 / 255), clamp(dx.div(size * 0.45).oneMinus(), 0, 1));
  grey = grey.add(valueNoise(p.x.div(3), p.y.div(3), 5).sub(0.5).mul(0.06));

  // Side veins: quadratic curves from the midrib toward the rim and tip, solved for y given x.
  let vein: F = float(0);
  for (let k = 1; k <= def.veins; k++) {
    const tk = k / (def.veins + 1.2);
    const yk = base - tk * len;
    const reach = halfWidth(def, Math.min(1, tk + 0.1)) * len * 0.95;
    if (reach <= 0) continue;
    const lw = Math.max(1.5, size * 0.007 * (1 - tk * 0.6));
    const q = clamp(dx.div(reach), 0, 1);
    const s = q.mul(0.4).add(0.81).sqrt().sub(0.9).div(0.2);
    const vy = s.oneMinus().mul(s).mul(0.06).add(s.mul(s).mul(0.1)).mul(-len).add(yk);
    const on = smoothstep(lw / 2 + 0.5, lw / 2 - 0.5, abs(p.y.sub(vy))).mul(step(dx, reach));
    vein = max(vein, on);
  }
  grey = mix(grey, float(1), vein.mul(0.75));
  // Rim shading inside the edge.
  grey = mix(grey, float(70 / 255), smoothstep(size * 0.01 + 0.5, size * 0.01 - 0.5, edge).mul(0.35));

  // Midrib and petiole, drawn over the blade and past it.
  const petiole = step(base, p.y).mul(step(p.y, size * 0.995)).mul(smoothstep(size * 0.008 + 0.5, size * 0.008 - 0.5, dx));
  const midrib = step(p.y, base)
    .mul(step(tip + len * 0.06, p.y))
    .mul(smoothstep(size * 0.0055 + 0.5, size * 0.0055 - 0.5, dx));
  const rib = max(petiole, midrib);
  grey = mix(grey, float(250 / 255), rib);
  return vec4(grey, grey, grey, max(blade, rib));
}

function barkNode([r, g, b]: [number, number, number]): V4 {
  const p = uv();
  const u = p.x;
  const v = p.y.oneMinus();
  const fibres = valueNoise(u.mul(48), v.mul(6), 11, 48, 6);
  const fissures = valueNoise(u.mul(10), v.mul(4), 23, 10, 4);
  const grain = valueNoise(u.mul(128), v.mul(64), 37, 128, 64);
  const ridge = abs(fissures.sub(0.5)).mul(2);
  const crack = select(ridge.lessThan(0.12), ridge.mul(3).add(0.45), float(1));
  const shade = fibres.mul(0.5).add(0.7).add(grain.sub(0.5).mul(0.15)).mul(crack);
  return vec4(clamp(shade.mul(r), 0, 1), clamp(shade.mul(g), 0, 1), clamp(shade.mul(b), 0, 1), 1);
}

