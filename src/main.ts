import GUI, { type Controller } from 'lil-gui';
import { uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { MAX_BATCH, batchVariants, variantName, type SeedMode } from './batch';
import type { Crown, CrownShape } from './core/crown';
import {
  currentLanguage,
  i18next,
  initI18n,
  languageNames,
  matchLanguage,
  rememberLanguage,
  tKey,
  translateDocument,
} from './i18n';
import type { LeafShape } from './mesh/textures';
import { withoutWind } from './mesh/wind';
import { CrownEnvelope, skeletonMaterial } from './render/debug';
import { GRASS_DEFAULTS, Grass } from './render/grass';
import { DEBUG_DEFAULTS, DebugOverlay } from './render/inspect';
import { createLensPipeline, lens, lensDefaults } from './render/post';
import { REVEAL_END, retro } from './render/retro';
import { advanceClouds, sky, skyDefaults, skyNode, sunDirection } from './render/sky';
import { TextureBaker } from './render/textures';
import { wind, windPosition } from './render/wind';
import { DICE_ICON, DOWNLOAD_ICON, GITHUB_ICON, PRESET_ICONS } from './icons';

/** The project's source, linked from the panel header. */
const REPO_URL = 'https://github.com/Elykdez/Evergrove';
import { PRESETS, type Look } from './presets';
import { MAX_BUDGET, MIN_BUDGET } from './core/budget';
import { MAX_GROVE, groveLayout, groveRadius, type GroveSlot } from './core/grove';
import { GROW_WORKERS, growTree, warmGrowth } from './growPool';
import { generateTree, triangles, type TreeParams, type TreeResult } from './tree';
import { log, logError, logWarn, stopwatch } from './log';
import { throttle } from './throttle';
import { ZipWriter } from './zip';
import './style.css';

/** Page load to the first tree on screen, reported when the intro reveals it. */
const startup = stopwatch();
initI18n();
translateDocument();
// The first growth worker loads alongside the renderer, so the first tree never waits for it.
warmGrowth();

// WebGPU only, by design: without it the app explains why and stops here.
const adapter = navigator.gpu
  ? await navigator.gpu.requestAdapter().catch((e: unknown) => {
      logError('System', 'WebGPU adapter request failed.', e);
      return null;
    })
  : null;
if (!adapter) {
  logError('System', navigator.gpu ? 'No WebGPU adapter available; stopping.' : 'This browser has no WebGPU; stopping.');
  document.body.classList.add('unsupported');
  document.body.classList.remove('intro', 'boot');
  const note = document.getElementById('unsupported')!;
  note.textContent = i18next.t('app.noWebgpu');
  note.hidden = false;
  // Halt the module without an error: nothing below can run.
  await new Promise<never>(() => {});
}

// ---------------------------------------------------------------- State

let presetName = 'Oak';
let params: TreeParams = structuredClone(PRESETS[presetName].params);
let look: Look = { ...PRESETS[presetName].look };
/** Scene > View > Retro look: replays the retro world on demand, e.g. to look at its sun. */
const retroLook = { on: false };
const view = { leaves: true, bark: true, fruit: true, crown: false, skeleton: false, tips: false, autoRotate: false };
/** Scene > Debugger: algorithm checks drawn over the tree (render/inspect.ts); display-only. */
const debugSettings = { ...DEBUG_DEFAULTS };
/**
 * Scene > Grove: seeded variants of the current tree standing around it. Shown in the view and
 * exported only through Export > grove GLB; the main tree's own exports never include it.
 */
const GROVE_DEFAULTS = { enabled: false, count: 6, spacing: 8, variation: 0.15 };
const groveSettings = { ...GROVE_DEFAULTS };
/** Wind is display-only: it never touches the geometry, the params or the exports. */
const windDefaults = { enabled: true, strength: 0.5, speed: 1, direction: 30, flutter: 0.5 };
const windSettings = { ...windDefaults };
/** Rendering tab: sky and lens, display-only like the wind. */
const skySettings = { ...skyDefaults };
const lensSettings = { ...lensDefaults };
/** Tree shapes what is exported; Scene is display-only; Export downloads. */
const PANEL_TABS = ['tree', 'scene', 'export'] as const;
type PanelTab = (typeof PANEL_TABS)[number];
let panelTab: PanelTab = 'tree';

// ---------------------------------------------------------------- Scene

const app = document.getElementById('app')!;
const renderer = new THREE.WebGPURenderer({ antialias: true });
const rendererInit = stopwatch();
await renderer.init();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
{
  const backend = 'isWebGPUBackend' in renderer.backend ? 'WebGPU' : 'WebGL 2';
  const gpu = adapter?.info;
  log(
    'System',
    `Renderer online in ${rendererInit()} ms; backend=${backend}, gpu=${gpu?.vendor || '?'}/${gpu?.architecture || '?'}, pixelRatio=${renderer.getPixelRatio()}.`,
  );
  // three.js falls back to WebGL 2 on its own; the app is built for WebGPU only.
  if (backend !== 'WebGPU') logWarn('System', 'three.js picked its WebGL 2 backend; rendering may differ.');
}
renderer.shadowMap.enabled = true;
// The WebGPU renderer has no PCFSoftShadowMap (it falls back to this with a warning).
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.backgroundNode = skyNode();
// Fog fades into the sky's horizon tone, so the far ground edge melts into the haze.
scene.fog = new THREE.Fog(sky.horizon.value, 30, 70);

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
camera.position.set(11, 6, 13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 4, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight('#e8f1ff', '#4d5a3c', 1.1));
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Square and centred, so the shadow still covers the tree when the sun is moved low or round.
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0005;
sun.target.position.set(0, 4, 0);
scene.add(sun, sun.target);
/** Half-size of the sun's shadow box in metres: the main tree alone, or the whole grove. */
let shadowReach = 14;

/** Grows the shadow box (and backs the sun off to match) so every grove tree casts a shadow. */
function fitShadow(reach: number) {
  shadowReach = Math.max(14, reach);
  const cam = sun.shadow.camera;
  Object.assign(cam, { left: -shadowReach, right: shadowReach, top: shadowReach, bottom: -shadowReach, far: 32 + 2 * shadowReach });
  cam.updateProjectionMatrix();
  sun.position.copy(sun.target.position).addScaledVector(sky.sunDir.value, 11 + shadowReach);
}

// Reaches past the fog's far distance, so its edge is never seen against the sky.
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(90, 96),
  new THREE.MeshStandardMaterial({ color: '#7d8a62', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/** Display-only grass: instanced blades bent by the shared wind uniforms; never exported. */
const grass = new Grass();
scene.add(grass.mesh);

const lensPass = createLensPipeline(renderer, scene, camera);

/** Pushes the sky settings to the sky shader, the fog and the sun light. */
function applySky() {
  sky.cover.value = skySettings.cover;
  sky.zenith.value.set(skySettings.zenith);
  sky.horizon.value.set(skySettings.horizon);
  (scene.fog as THREE.Fog).color.set(skySettings.horizon);
  sunDirection(skySettings.sunElevation, skySettings.sunAzimuth, sky.sunDir.value);
  sun.position.copy(sun.target.position).addScaledVector(sky.sunDir.value, 11 + shadowReach);
  retro.sunDir.value.copy(sky.sunDir.value);
}

function applyLens() {
  lens.bokeh.value = lensSettings.dof;
  lens.vignette.value = lensSettings.vignette;
  lens.grain.value = lensSettings.grain;
  lensPass.bloom.strength.value = lensSettings.bloom;
  renderer.toneMappingExposure = lensSettings.exposure;
}
applySky();
applyLens();

// ---------------------------------------------------------------- Materials

// Both textures are computed on the GPU (render/textures.ts) and land in these canvases.
// Baked before the textures exist: a WebGPU texture keeps the size of its first image, so later
// re-bakes (always the same size) can replace the canvas but a placeholder could not.
const baker = new TextureBaker(renderer);
const firstBake = stopwatch();
const [firstLeaf, firstBark] = await Promise.all([baker.leaf(look.leafShape), baker.bark(look.barkColor)]);
log('Load', `Textures baked in ${firstBake()} ms; leaf=${look.leafShape}, bark=${look.barkColor}.`);
const barkTexture = new THREE.CanvasTexture(firstBark);
const leafTexture = new THREE.CanvasTexture(firstLeaf);
for (const t of [barkTexture, leafTexture]) {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.getMaxAnisotropy();
}
barkTexture.wrapS = barkTexture.wrapT = THREE.RepeatWrapping;

const barkSettings = { name: 'Bark', map: barkTexture, bumpMap: barkTexture, bumpScale: 2, roughness: 0.95 };
const leafSettings = {
  name: 'Leaf',
  map: leafTexture,
  vertexColors: true,
  alphaTest: 0.5,
  // Antialiases the cutout edges under MSAA instead of hard aliasing on thin leaves.
  alphaToCoverage: true,
  side: THREE.DoubleSide,
  roughness: 0.75,
};
const fruitSettings = { name: 'Fruit', vertexColors: true, roughness: 0.45 };

/** On-screen materials: node materials whose vertices sway in the wind (shadows follow). */
const barkMaterial = new THREE.MeshStandardNodeMaterial(barkSettings);
barkMaterial.positionNode = windPosition(false);
const leafMaterial = new THREE.MeshStandardNodeMaterial(leafSettings);
leafMaterial.positionNode = windPosition(true);
const fruitMaterial = new THREE.MeshStandardNodeMaterial(fruitSettings);
fruitMaterial.positionNode = windPosition(false);

/** Export materials: the classic equivalents, which GLTFExporter understands. */
const exportMaterials = {
  bark: new THREE.MeshStandardMaterial(barkSettings),
  leaf: new THREE.MeshStandardMaterial(leafSettings),
  fruit: new THREE.MeshStandardMaterial(fruitSettings),
};

const barkMesh = new THREE.Mesh(new THREE.BufferGeometry(), barkMaterial);
barkMesh.name = 'Bark';
barkMesh.castShadow = barkMesh.receiveShadow = true;
const leafMesh = new THREE.Mesh(new THREE.BufferGeometry(), leafMaterial);
leafMesh.name = 'Leaves';
leafMesh.castShadow = leafMesh.receiveShadow = true;

const treeGroup = new THREE.Group();
treeGroup.name = 'Tree';
const fruitMesh = new THREE.Mesh(new THREE.BufferGeometry(), fruitMaterial);
fruitMesh.name = 'Fruit';
fruitMesh.castShadow = fruitMesh.receiveShadow = true;

treeGroup.add(barkMesh, leafMesh, fruitMesh);
scene.add(treeGroup);

// Debug views: crown envelope and skeleton colours are computed in their shaders (render/debug.ts).
const crownEnvelope = new CrownEnvelope();
const crownMesh = crownEnvelope.mesh;
const skeletonTop = uniform(1);
const skeleton = new THREE.LineSegments(new THREE.BufferGeometry(), skeletonMaterial(skeletonTop));
/** Attractor / tip samples as tiny instanced octahedra (WebGPU draws native points at 1 px). */
const tipGeometry = new THREE.OctahedronGeometry(0.035);
const tipMaterial = new THREE.MeshBasicNodeMaterial({ color: '#d4537e' });
let tipPoints = new THREE.InstancedMesh(tipGeometry, tipMaterial, 1);
scene.add(crownMesh, skeleton, tipPoints);
const debugOverlay = new DebugOverlay();
scene.add(debugOverlay.group);

/** Grove trees share the on-screen materials, so they sway in the same wind as the main tree. */
const groveGroup = new THREE.Group();
groveGroup.name = 'Grove';
scene.add(groveGroup);
type GroveTree = { seed: number; slot: GroveSlot; result: TreeResult; object: THREE.Group };
let groveTrees: GroveTree[] = [];

// ---------------------------------------------------------------- Generation

/**
 * Tree summary in the panel footer, above the download bar: preset and seed, the key figures, a
 * detail line, notes and the status line. Built once and moved into each rebuilt panel. Folded,
 * only its head line shows, and clicking it unfolds the panel.
 */
const summaryEl = el('div', 'eg-summary');
const summaryHead = el('button', 'eg-summary-head');
summaryHead.type = 'button';
const hudTreeEl = el('span', 'eg-summary-tree');
const hudSeedEl = el('span', 'eg-summary-seed');
const hudTrisEl = el('span', 'eg-summary-tris');
summaryHead.append(hudTreeEl, hudSeedEl, hudTrisEl);
const statsEl = el('div', 'eg-stats');
const detailEl = el('div', 'eg-summary-detail');
const notesEl = el('div', 'eg-notes');
const statusEl = el('div', 'eg-status');
statusEl.setAttribute('role', 'status');
statusEl.setAttribute('aria-live', 'polite');
summaryEl.append(summaryHead, statsEl, detailEl, notesEl, statusEl);
/** Crown noise spectrum: lives in the Outline noise section, next to the sliders that shape it. */
const spectrumCanvas = document.createElement('canvas');
spectrumCanvas.className = 'eg-spectrum';
let current: TreeResult | null = null;

/** Grows the current params into the scene on the page; if growth throws, the previous tree stays up. */
function regenerate() {
  let result: TreeResult;
  try {
    result = generateTree(params);
  } catch (e) {
    logError('Tree', `Growth failed for ${presetName} seed=${params.seed}; keeping the previous tree.`, e);
    return;
  }
  showTree(presetName, params, result);
}

/** Live regrows (a dragged slider) start at most this often. */
const LIVE_MS = 100;

/**
 * Main-tree growth in the workers, latest wins: a regrow starts at most every LIVE_MS in a free
 * worker without waiting for the last one, so a dragged slider updates the tree several times a
 * second, and a growth that finishes after a newer one landed is dropped. A failed growth keeps
 * the previous tree.
 */
const mainGrowth = throttle<{ preset: string; p: TreeParams; result: TreeResult } | null>({
  interval: LIVE_MS,
  parallel: GROW_WORKERS,
  start: async () => {
    const preset = presetName;
    const p = structuredClone(params);
    try {
      return { preset, p, result: await growTree(p) };
    } catch (e) {
      logError('Tree', `Growth failed for ${preset} seed=${p.seed}; keeping the previous tree.`, e);
      return null;
    }
  },
  land: (grown) => grown && showTree(grown.preset, grown.p, grown.result),
  drop: (grown) => grown && disposeTree(grown.result),
  fail: (e) => logError('Tree', 'Showing the grown tree failed.', e),
});

/** Grows the current params at once, off the page; resolves once the tree is on screen. */
function growMainNow() {
  mainGrowth.request(true);
  return mainGrowth.idle();
}

/** Puts a grown tree on screen as the main tree, freeing the one it replaces. */
function showTree(preset: string, p: TreeParams, result: TreeResult) {
  logGrowth(preset, p, result);
  barkMesh.geometry.dispose();
  leafMesh.geometry.dispose();
  fruitMesh.geometry.dispose();
  barkMesh.geometry = result.bark;
  leafMesh.geometry = result.leaves;
  fruitMesh.geometry = result.fruit;
  current = result;
  result.bark.computeBoundingBox();
  wind.height.value = Math.max(1, result.bark.boundingBox?.max.y ?? 8);
  crownEnvelope.update(result.crown);
  updateSkeleton(result);
  updateTips(result);
  debugOverlay.update(result, p.tips.cut);
  drawSpectrum(result.crown);
  applyView();
  renderStats(result);
}

function triangleCount(result: TreeResult) {
  return Math.round(triangles(result.bark) + triangles(result.leaves) + triangles(result.fruit));
}

/** One line per grown tree, plus a note when the triangle budget cut or missed it. */
function logGrowth(preset: string, p: TreeParams, result: TreeResult) {
  const { graph, detail } = result;
  log(
    'Tree',
    `${preset} seed=${p.seed} grown in ${result.millis.toFixed(1)} ms; algorithm=${p.algorithm}, ` +
      `tips=${graph.tips.length}, nodes=${graph.nodes.length}, triangles=${triangleCount(result)}, ` +
      `fruit=${result.fruitCount}, unreached=${result.unreached.length}/${result.tips.length}.`,
  );
  // Factors run down to MIN_DETAIL (1e-4), so fixed decimals would print 0.00.
  const cut = `bark=${detail.bark.toPrecision(3)}, leaves=${detail.leaves.toPrecision(3)}, fruit=${detail.fruit.toPrecision(3)}`;
  if (result.overBudget) {
    logWarn('Tree', `Budget of ${p.triangleBudget} triangles missed even at the lowest detail; ${cut}.`);
  } else if (detail.bark < 1 || detail.leaves < 1 || detail.fruit < 1) {
    log('Tree', `Detail cut to fit ${p.triangleBudget} triangles; ${cut}.`);
  }
}

/** One summary figure: a big value over a small label. */
function hudTile(label: string, value: string) {
  const tile = document.createElement('div');
  tile.className = 'eg-tile';
  const v = document.createElement('div');
  v.className = 'eg-tile-value';
  v.textContent = value;
  const l = document.createElement('div');
  l.className = 'eg-tile-label';
  l.textContent = label;
  tile.append(v, l);
  return tile;
}

/** Footer summary: which tree this is, its key figures, a detail line, then any notes (fruit, budget, debugger). */
function renderStats(result: TreeResult) {
  hudTreeEl.textContent = tKey(`presets.${presetName}`);
  hudSeedEl.textContent = i18next.t('hud.seed', { seed: params.seed });
  const trunk = Math.max(0, ...result.graph.roots.map((r) => result.graph.nodes[r].radius));
  const count = (value: number) => i18next.t('hud.value', { value });
  hudTrisEl.textContent = i18next.t('hud.triangles', { value: triangleCount(result) });
  statsEl.replaceChildren(
    hudTile(i18next.t('hud.tiles.tips'), count(result.graph.tips.length)),
    hudTile(i18next.t('hud.tiles.triangles'), count(triangleCount(result))),
    hudTile(i18next.t('hud.tiles.time'), i18next.t('hud.ms', { ms: Math.round(result.millis) })),
  );
  detailEl.textContent = i18next.t('hud.detail', {
    nodes: result.graph.nodes.length,
    count: result.graph.roots.length,
    radius: trunk.toFixed(2),
  });
  const notes: string[] = [];
  if (result.fruitCount) notes.push(i18next.t('hud.fruit', { count: result.fruitCount }));
  if (groveTrees.length) {
    const groveTris = groveTrees.reduce((sum, t) => sum + triangleCount(t.result), 0);
    notes.push(i18next.t('hud.grove', { count: groveTrees.length, triangles: groveTris }));
  }
  const check = debugSettings.enabled ? debugOverlay.report() : null;
  if (check) {
    notes.push(
      i18next.t('debug.report', {
        joints: check.joints.length,
        multiway: check.multiway,
        outside: check.outside,
        ends: check.ends.length,
        depth: Math.round(Math.max(0, check.maxDepth) * 100),
        unreached: check.unreached.length,
        samples: result.tips.length,
      }),
    );
  }
  if (result.overBudget) notes.push(i18next.t('hud.budgetOver', { budget: params.triangleBudget }));
  else if (result.detail.bark < 1 || result.detail.leaves < 1 || result.detail.fruit < 1) {
    notes.push(i18next.t('hud.budgetFit', { budget: params.triangleBudget }));
  }
  notesEl.replaceChildren(
    ...notes.map((text) => {
      const line = document.createElement('div');
      line.textContent = text;
      return line;
    }),
  );
}

/** HUD status line, kept as a key so it re-renders when the language changes. */
let status: { key: string; options?: Record<string, unknown> } | null = null;
function setStatus(key: string | null, options?: Record<string, unknown>) {
  status = key ? { key, options } : null;
  renderStatus();
}
function renderStatus() {
  statusEl.textContent = status ? tKey(status.key, status.options) : '';
}

/** Skeleton line positions only; the height colour ramp runs in its shader. */
function updateSkeleton(result: TreeResult) {
  const { nodes } = result.graph;
  const positions: number[] = [];
  for (const n of nodes) if (n.parent >= 0) positions.push(...nodes[n.parent].pos, ...n.pos);
  skeletonTop.value = Math.max(1e-3, ...nodes.map((n) => n.pos[1]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  skeleton.geometry.dispose();
  skeleton.geometry = geo;
}

function updateTips(result: TreeResult) {
  scene.remove(tipPoints);
  tipPoints.dispose();
  tipPoints = new THREE.InstancedMesh(tipGeometry, tipMaterial, Math.max(1, result.tips.length));
  const m = new THREE.Matrix4();
  result.tips.forEach((t, i) => tipPoints.setMatrixAt(i, m.makeTranslation(t[0], t[1], t[2])));
  tipPoints.count = result.tips.length;
  tipPoints.visible = view.tips;
  scene.add(tipPoints);
}

/** Spectrum CSS size; the canvas is drawn at device resolution so it stays crisp. */
const SPECTRUM_W = 272;
const SPECTRUM_H = 64;

/** Crown noise spectrum in the HUD, coloured from the current theme (see style.css). */
function drawSpectrum(crown: Crown) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (spectrumCanvas.width !== SPECTRUM_W * dpr) {
    spectrumCanvas.width = SPECTRUM_W * dpr;
    spectrumCanvas.height = SPECTRUM_H * dpr;
  }
  const g = spectrumCanvas.getContext('2d')!;
  const w = SPECTRUM_W;
  const h = SPECTRUM_H;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const modes = crown.spectrum;
  if (!modes.length) return;
  const theme = getComputedStyle(document.body);
  const color = (name: string, fallback: string) => theme.getPropertyValue(name).trim() || fallback;
  const lo = Math.log(Math.min(...modes.map((m) => m.f)));
  const hi = Math.log(Math.max(...modes.map((m) => m.f))) + 1e-6;
  const amax = Math.max(...modes.map((m) => m.a));
  const base = h - 16;
  g.strokeStyle = color('--eg-line', 'rgba(255,255,255,0.25)');
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(2, base + 0.5);
  g.lineTo(w - 2, base + 0.5);
  g.stroke();
  g.fillStyle = color('--eg-chart', '#7fc1ff');
  for (const m of modes) {
    const x = 4 + ((Math.log(m.f) - lo) / (hi - lo)) * (w - 8);
    const bh = Math.min(base - 2, (m.a / amax) * (base - 4) * params.crown.noiseAmount * 4);
    g.fillRect(x - 1, base - bh, 2, bh);
  }
  g.fillStyle = color('--eg-muted', 'rgba(255,255,255,0.7)');
  g.font = `10px ${color('--eg-font', 'system-ui, sans-serif')}`;
  g.fillText(i18next.t('hud.spectrum', { slope: params.crown.spectralSlope.toFixed(1) }), 2, h - 3);
}

function applyView() {
  const foliage = !(debugSettings.enabled && debugSettings.hideFoliage);
  // A part with no triangles stays hidden: before the first tree they are empty geometries (no
  // attributes for their shaders), and a tree without fruit would issue an empty draw.
  const has = (mesh: THREE.Mesh) => triangles(mesh.geometry) > 0;
  leafMesh.visible = view.leaves && foliage && has(leafMesh);
  fruitMesh.visible = view.fruit && foliage && has(fruitMesh);
  barkMesh.visible = view.bark && has(barkMesh);
  // Grove trees follow the part switches; the debugger only ever hides the main tree's foliage.
  for (const { object } of groveTrees) {
    for (const mesh of object.children as THREE.Mesh[]) {
      const on = { Bark: view.bark, Leaves: view.leaves, Fruit: view.fruit }[mesh.name] ?? true;
      mesh.visible = on && has(mesh);
    }
  }
  crownMesh.visible = view.crown;
  skeleton.visible = view.skeleton;
  tipPoints.visible = view.tips;
  controls.autoRotate = view.autoRotate;
  debugOverlay.sync(debugSettings);
}

/** Debugger switches: the overlay, the foliage it hides, and the report line all follow. */
function applyDebug() {
  applyView();
  debugOptions.forEach((c) => c.disable(!debugSettings.enabled));
  refreshToggles();
  if (current) renderStats(current);
}

/** Frames what was actually generated, not the nominal crown size. */
function frameTree() {
  const box = new THREE.Box3().setFromObject(treeGroup);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fit = Math.max(size.y, Math.hypot(size.x, size.z)) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  controls.target.copy(center);
  const dir = new THREE.Vector3(0.62, 0.18, 0.76).normalize();
  camera.position.copy(center).addScaledVector(dir, fit * 1.15);
}

let textureRequest = 0;
/**
 * Re-bakes both textures on the GPU; a newer request supersedes one still in flight. A failed bake
 * keeps the previous textures, so the tree still regrows.
 */
async function refreshTextures() {
  const request = ++textureRequest;
  const baking = stopwatch();
  const { leafShape, barkColor } = look;
  try {
    const [leaf, bark] = await Promise.all([baker.leaf(leafShape), baker.bark(barkColor)]);
    if (request !== textureRequest) return;
    leafTexture.image = leaf;
    leafTexture.needsUpdate = true;
    barkTexture.image = bark;
    barkTexture.needsUpdate = true;
    log('Load', `Textures baked in ${baking()} ms; leaf=${leafShape}, bark=${barkColor}.`);
  } catch (e) {
    logError('Load', `Texture bake failed after ${baking()} ms (leaf=${leafShape}, bark=${barkColor}); keeping the previous textures.`, e);
  }
}

/**
 * Parameter changes regrow the tree in place, throttled (mainGrowth), so a dragged slider updates
 * live. Only a new tree (a preset or a new seed) replays the retro loading look (runRegenerate
 * below). Requests that arrive while a regrow is running fold into it. Takes no arguments, so it
 * can be a lil-gui change handler.
 */
const regen = { lastRequest: 0, preset: false, sweep: false, run: null as Promise<void> | null };
function scheduleRegenerate() {
  regen.lastRequest = performance.now();
  regen.run ??= runRegenerate().finally(() => (regen.run = null));
}
/** As scheduleRegenerate, for a new tree of the same kind (a new seed): plays the retro sweep. */
function scheduleNewTreeRegenerate() {
  regen.sweep = true;
  scheduleRegenerate();
}
/** As scheduleNewTreeRegenerate, for a new preset: also re-bakes the textures and reframes the camera. */
function schedulePresetRegenerate() {
  regen.preset = true;
  scheduleNewTreeRegenerate();
}

// ---------------------------------------------------------------- Grove

/** Bumped by every grove request, so a newer one stops an older one between trees. */
let groveRequest = 0;
/** Aborted by every grove request, so trees an older grove queued never start growing. */
let groveJobs = new AbortController();

/**
 * Grove growth, latest wins: one grove at a time, after 400 ms without a request so a dragged
 * slider grows it once when released.
 */
const groveGrowth = throttle<void>({ quiet: 400, start: () => loadGrove(groveRequest) });

/**
 * Asks for the grove to regrow (`now` skips the quiet time). Stops a grove still growing at
 * once; its finished trees stay up until replaced.
 */
function scheduleGrove(now = false) {
  groveRequest++;
  groveJobs.abort();
  groveGrowth.request(now);
}

/**
 * Grows the grove under the retro loading look: sweeps into the grid world (a no-op when it is
 * already there, as after a new tree), grows, then sweeps the real render back out. A superseded
 * grove leaves the retro world up for the request that replaced it. With no grove it only sweeps
 * out, and with the Retro look on it only grows.
 */
async function loadGrove(request: number) {
  const reduced = reducedMotion();
  if (groveSettings.enabled && !retroLook.on) {
    await startSweep(false, reduced ? SWEEP_IN_MS / 4 : SWEEP_IN_MS);
    // Let a retro frame reach the screen before the blocking growth.
    await nextFrame();
  }
  if (request !== groveRequest) return;
  const done = await growGrove(request);
  if (done && intro.active && !retroLook.on) void startSweep(true, reduced ? SWEEP_MS / 4 : SWEEP_MS);
}

function disposeTree(result: TreeResult) {
  result.bark.dispose();
  result.leaves.dispose();
  result.fruit.dispose();
}

/** Puts a grove tree in slot i (or clears it), freeing the tree it replaces. */
function setGroveTree(i: number, tree: GroveTree | null) {
  const old = groveTrees[i];
  if (old) {
    groveGroup.remove(old.object);
    disposeTree(old.result);
  }
  if (tree) {
    groveTrees[i] = tree;
    groveGroup.add(tree.object);
  } else groveTrees.splice(i, 1);
}

/**
 * Grows the grove: variants of the current params (seed + 1, + 2, ..., as in a sequential batch,
 * with a little parameter variation) at seeded spots around the main tree. The trees grow in
 * parallel in the growth workers and each replaces the one in its slot, in slot order.
 * Resolves false when a newer request superseded it.
 */
async function growGrove(request: number): Promise<boolean> {
  const settings = { ...groveSettings };
  const slots = settings.enabled ? groveLayout(settings.count, settings.spacing, params.seed) : [];
  const preset = presetName;
  const base = params;
  const timer = stopwatch();
  while (groveTrees.length > slots.length) setGroveTree(groveTrees.length - 1, null);
  if (!slots.length) {
    fitShadow(0);
    if (current) renderStats(current);
    return true;
  }
  // Room for the farthest tree's crown as well as its trunk.
  fitShadow(groveRadius(slots) + base.crown.radius * 1.5 + 2);
  const variants = batchVariants(base, { count: slots.length + 1, seedMode: 'sequential', variation: settings.variation }).slice(1);
  log(
    'Grove',
    `Growing ${slots.length} ${preset} trees around seed=${base.seed}; spacing=${settings.spacing}, variation=${settings.variation}.`,
  );
  const signal = (groveJobs = new AbortController()).signal;
  const jobs = variants.map((v) => growTree(v.params, signal));
  // Jobs dropped by a newer grove reject; that is expected, not an error.
  for (const job of jobs) job.catch(() => {});
  for (let i = 0; i < slots.length; i++) {
    const v = variants[i];
    let result: TreeResult | null = null;
    let error: unknown;
    try {
      result = await jobs[i];
    } catch (e) {
      error = e;
    }
    if (request !== groveRequest) {
      log('Grove', `Superseded after ${i}/${slots.length} trees.`);
      return false;
    }
    if (!result) {
      // Stops here rather than leaving a gap, so slots stay in step with groveTrees.
      groveJobs.abort();
      logError('Grove', `Growth failed for grove tree ${i + 1} seed=${v.seed}; stopping the grove there.`, error);
      while (groveTrees.length > i) setGroveTree(groveTrees.length - 1, null);
      if (current) renderStats(current);
      return true;
    }
    logGrowth(`Grove ${i + 1}/${slots.length} ${preset}`, v.params, result);
    const object = groveObject(result, slots[i]);
    setGroveTree(i, { seed: v.seed, slot: slots[i], result, object });
    applyView();
  }
  const triangles = groveTrees.reduce((sum, t) => sum + triangleCount(t.result), 0);
  log('Grove', `Grove of ${groveTrees.length} grown in ${timer()} ms; triangles=${triangles}, reach=${shadowReach.toFixed(1)} m.`);
  if (current) renderStats(current);
  return true;
}

/** A grove tree for the view: the on-screen (wind) materials, placed and turned in its slot. */
function groveObject(result: TreeResult, slot: GroveSlot) {
  const group = new THREE.Group();
  const parts: [string, THREE.BufferGeometry, THREE.Material][] = [
    ['Bark', result.bark, barkMaterial],
    ['Leaves', result.leaves, leafMaterial],
    ['Fruit', result.fruit, fruitMaterial],
  ];
  for (const [name, geometry, material] of parts) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.position.set(slot.x, 0, slot.z);
  group.rotation.y = slot.rotation;
  return group;
}

// ---------------------------------------------------------------- Export

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** File names stay English identifiers whatever the UI language. */
const filePrefix = () => `tree-${presetName.toLowerCase()}`;
const baseName = () => `${filePrefix()}-${params.seed}`;

/**
 * Bark + Leaves (+ Fruit when the tree bears any) with the classic export materials and without
 * the display-only wind attribute. Built from the geometry alone, so view toggles and wind never
 * change what is exported.
 */
function treeObject(result: TreeResult) {
  const group = new THREE.Group();
  group.name = 'Tree';
  const bark = new THREE.Mesh(result.bark, exportMaterials.bark);
  bark.name = 'Bark';
  const leaves = new THREE.Mesh(withoutWind(result.leaves), exportMaterials.leaf);
  leaves.name = 'Leaves';
  group.add(bark, leaves);
  if (result.fruitCount > 0) {
    const fruit = new THREE.Mesh(result.fruit, exportMaterials.fruit);
    fruit.name = 'Fruit';
    group.add(fruit);
  }
  return group;
}

async function glbBytes(object: THREE.Object3D) {
  // trs: placed nodes (grove trees) keep a readable translation and rotation instead of a matrix.
  const data = await new GLTFExporter().parseAsync(object, { binary: true, onlyVisible: false, trs: true });
  return new Uint8Array(data as ArrayBuffer);
}

function pngBytes(texture: THREE.CanvasTexture) {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) =>
    (texture.image as HTMLCanvasElement).toBlob((b) =>
      b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('PNG encoding failed')),
    ),
  );
}

/**
 * Builds one export file and downloads it, logging its size and time, or the error if it fails.
 * `what` names the contents for the log, e.g. the meshes in a model.
 */
async function exportFile(file: string, type: string, what: string, bytes: () => Promise<BlobPart> | BlobPart) {
  const timer = stopwatch();
  log('Export', `Exporting '${file}'; ${what}.`);
  try {
    const blob = new Blob([await bytes()], { type });
    download(blob, file);
    log('Export', `Saved '${file}' in ${timer()} ms; bytes=${blob.size}.`);
  } catch (e) {
    logError('Export', `Export of '${file}' failed after ${timer()} ms.`, e);
  }
}

const meshNames = (object: THREE.Object3D) => `meshes=${object.children.map((c) => c.name).join('+')}`;

/** Exports only the tree (bark, leaves, fruit), never the ground or debug views. */
async function exportGLB() {
  if (!current) return;
  const object = treeObject(current);
  await exportFile(`${baseName()}.glb`, 'model/gltf-binary', meshNames(object), () => glbBytes(object));
}

async function exportOBJ() {
  if (!current) return;
  const object = treeObject(current);
  await exportFile(`${baseName()}.obj`, 'text/plain', meshNames(object), () => new OBJExporter().parse(object));
}

/**
 * The main tree at the origin plus every grove tree grown so far, each as its own node
 * (`Tree-<seed>`, holding Bark, Leaves and Fruit) at its place and turn. Materials and textures
 * are shared, so they are embedded once.
 */
async function exportGroveGLB() {
  if (!current) return;
  const grove = new THREE.Group();
  grove.name = 'Grove';
  const main = treeObject(current);
  main.name = `Tree-${params.seed}`;
  grove.add(main);
  for (const t of groveTrees) {
    const tree = treeObject(t.result);
    tree.name = `Tree-${t.seed}`;
    tree.position.set(t.slot.x, 0, t.slot.z);
    tree.rotation.y = t.slot.rotation;
    grove.add(tree);
  }
  const file = `grove-${presetName.toLowerCase()}-${params.seed}-${grove.children.length}x.glb`;
  await exportFile(file, 'model/gltf-binary', `trees=${grove.children.length}`, () => glbBytes(grove));
}

async function exportTexture(texture: THREE.CanvasTexture, suffix: string) {
  const { width, height } = texture.image as HTMLCanvasElement;
  await exportFile(`${baseName()}-${suffix}.png`, 'image/png', `size=${width}x${height}`, () => pngBytes(texture));
}

// ---------------------------------------------------------------- Batch

const batch = { count: 20, seedMode: 'sequential' as SeedMode, variation: 0, fruitChance: 0.1, glb: true, obj: false };
let batchRun: { cancelled: boolean; done: number; total: number } | null = null;

/** Yields to the event loop; unlike setTimeout it is not throttled in a background tab. */
function nextTask() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

/**
 * Grows batch.count variants of the current settings (seeds from the current seed) and
 * streams them into one ZIP with a manifest.json that records each tree's seed and params.
 * Pressing the button again while it runs cancels.
 */
async function runBatch() {
  if (batchRun) {
    batchRun.cancelled = true;
    return;
  }
  if (!batch.glb && !batch.obj) {
    log('Batch', 'No format picked; nothing to run.');
    setStatus('batch.noFormat');
    return;
  }
  const variants = batchVariants(params, batch);
  const run = (batchRun = { cancelled: false, done: 0, total: variants.length });
  const prefix = filePrefix();
  const preset = presetName;
  const startSeed = params.seed;
  const settings = { ...batch };
  const lookAtStart = { ...look };
  const zip = new ZipWriter();
  const trees: object[] = [];
  const timer = stopwatch();
  const formats = [settings.glb && 'glb', settings.obj && 'obj'].filter(Boolean).join('+');
  log(
    'Batch',
    `Starting ${variants.length} ${preset} trees from seed=${startSeed}; seedMode=${settings.seedMode}, ` +
      `variation=${settings.variation}, fruitChance=${settings.fruitChance}, formats=${formats}.`,
  );
  setStatus(null);
  refreshBatchControls();
  try {
    if (settings.obj) {
      zip.add(`textures/${prefix}-leaf.png`, await pngBytes(leafTexture), false);
      zip.add(`textures/${prefix}-bark.png`, await pngBytes(barkTexture), false);
    }
    // Trees grow in the workers a few ahead of the one being exported, in order.
    const jobs = new AbortController();
    const pending = new Map<number, Promise<TreeResult>>();
    const queueTree = (i: number) => {
      if (i >= variants.length || pending.has(i)) return;
      const job = growTree(variants[i].params, jobs.signal);
      job.catch(() => {});
      pending.set(i, job);
    };
    for (let i = 0; i < variants.length; i++) {
      if (run.cancelled) {
        jobs.abort();
        break;
      }
      for (let k = i; k <= i + GROW_WORKERS; k++) queueTree(k);
      const v = variants[i];
      const result = await pending.get(i)!;
      pending.delete(i);
      const object = treeObject(result);
      const name = variantName(prefix, v, variants.length);
      logGrowth(`Batch ${run.done + 1}/${run.total} ${name}`, v.params, result);
      const files: string[] = [];
      if (settings.glb) {
        zip.add(`${name}.glb`, await glbBytes(object));
        files.push(`${name}.glb`);
      }
      if (settings.obj) {
        zip.add(`${name}.obj`, new OBJExporter().parse(object));
        files.push(`${name}.obj`);
      }
      trees.push({
        files,
        seed: v.seed,
        tips: result.graph.tips.length,
        nodes: result.graph.nodes.length,
        triangles: triangleCount(result),
        fruit: result.fruitCount,
        params: v.params,
      });
      result.bark.dispose();
      result.leaves.dispose();
      result.fruit.dispose();
      run.done++;
      refreshBatchControls();
    }
    if (run.cancelled) {
      zip.abort();
      log('Batch', `Cancelled after ${run.done}/${run.total} trees in ${timer()} ms.`);
      setStatus('batch.cancelled');
      return;
    }
    setStatus('batch.zipping');
    await nextTask();
    zip.add(
      'manifest.json',
      JSON.stringify({ preset, startSeed, look: lookAtStart, batch: settings, trees }, null, 2),
    );
    const file = `trees-${preset.toLowerCase()}-${variants.length}x-seed${startSeed}.zip`;
    const blob = new Blob(await zip.finish(), { type: 'application/zip' });
    download(blob, file);
    log('Batch', `Saved '${file}' in ${timer()} ms; trees=${variants.length}, bytes=${blob.size}.`);
    setStatus('batch.saved', { count: variants.length, file });
  } catch (e) {
    zip.abort();
    logError('Batch', `Failed after ${run.done}/${run.total} trees in ${timer()} ms.`, e);
    setStatus('batch.failed', { message: e instanceof Error ? e.message : String(e) });
  } finally {
    batchRun = null;
    refreshBatchControls();
  }
}

// ---------------------------------------------------------------- UI

const ui = { language: currentLanguage() as string };
const actions = {
  resetScene: () => {
    Object.assign(skySettings, skyDefaults);
    Object.assign(windSettings, windDefaults);
    Object.assign(lensSettings, lensDefaults);
    Object.assign(grass.settings, GRASS_DEFAULTS);
    Object.assign(debugSettings, DEBUG_DEFAULTS);
    Object.assign(groveSettings, GROVE_DEFAULTS);
    scheduleGrove(true);
    applySky();
    applyLens();
    applyDebug();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  },
  randomSeed: () => {
    params.seed = Math.floor(Math.random() * 1e6);
    log('Tree', `Random seed ${params.seed}.`);
    refreshSeed();
    scheduleNewTreeRegenerate();
  },
  glb: () => void exportGLB(),
  obj: () => void exportOBJ(),
  groveGlb: () => void exportGroveGLB(),
  leafPng: () => void exportTexture(leafTexture, 'leaf'),
  barkPng: () => void exportTexture(barkTexture, 'bark'),
  batch: () => void runBatch(),
};

let gui: GUI;
let tuning: GUI | null = null;

/**
 * GUI view of params.triangleBudget (0 = no limit) as a checkbox plus a slider. The slider keeps its
 * value while the limit is off, and moving it turns the limit on.
 */
let budgetValue = 5000;
const budgetUi = {
  get limit() {
    return params.triangleBudget > 0;
  },
  set limit(on: boolean) {
    params.triangleBudget = on ? budgetValue : 0;
  },
  get value() {
    return params.triangleBudget > 0 ? params.triangleBudget : budgetValue;
  },
  set value(v: number) {
    budgetValue = v;
    params.triangleBudget = v;
  },
};
let batchButton: Controller | null = null;
/** The Batch section, so the folded Export bar can open the panel straight at it. */
let batchFolderRef: GUI | null = null;
let batchInputs: Controller[] = [];
/** Open/closed per folder key, so rebuilding the panel (language, preset) keeps the layout. */
const openFolders = new Map<string, boolean>();

function folder(parent: GUI, key: string, open: boolean) {
  const f = parent.addFolder(tKey(key));
  f.open(openFolders.get(key) ?? open);
  f.onOpenClose((changed) => {
    if (changed === f) openFolders.set(key, !f._closed);
  });
  return f;
}

/** Dropdown options as {translated label: stable value}. */
function choices<T extends string>(prefix: string, values: readonly T[]): Record<string, T> {
  return Object.fromEntries(values.map((v) => [tKey(`${prefix}.${v}`), v]));
}

function refreshBatchControls() {
  batchButton?.name(
    batchRun ? i18next.t('batch.cancel', { done: batchRun.done, total: batchRun.total }) : i18next.t('batch.run'),
  );
  batchInputs.forEach((c) => c.disable(!!batchRun));
}

/** Anything the tabs can show or hide: lil-gui folders and controllers, or our own blocks. */
type Showable = { show(visible?: boolean): unknown };

/** A plain element with a class and optional text. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A custom block in the panel's scrolling area, shown and hidden like a lil-gui item. */
function block(node: HTMLElement): Showable {
  return {
    show(visible = true) {
      node.hidden = !visible;
    },
  };
}

/** Builds the whole panel in the current language. */
function buildGui() {
  const scroll = gui?.$children.scrollTop ?? 0;
  gui?.destroy();
  tuning = null;
  gui = new GUI({ title: i18next.t('gui.title'), width: 320 });
  gui.domElement.classList.add('eg-panel');
  buildHeader();
  buildFooter();
  const picker = buildTreePicker();

  const viewFolder = folder(gui, 'view.folder', true);
  for (const key of ['leaves', 'bark', 'fruit', 'crown', 'skeleton', 'tips', 'autoRotate'] as const) {
    viewFolder.add(view, key).name(i18next.t(`view.${key}`)).onChange(applyView);
  }
  viewFolder.add(retroLook, 'on').name(i18next.t('view.retro')).onChange(setRetroLook);

  const skyFolder = folder(gui, 'sky.folder', false);
  const onSky = (c: Controller) => c.onChange(applySky);
  onSky(skyFolder.add(skySettings, 'cover', 0, 1, 0.01).name(i18next.t('sky.cover')));
  skyFolder.add(skySettings, 'cloudSpeed', 0, 5, 0.1).name(i18next.t('sky.cloudSpeed'));
  onSky(skyFolder.add(skySettings, 'sunElevation', 2, 89, 1).name(i18next.t('sky.sunElevation')));
  onSky(skyFolder.add(skySettings, 'sunAzimuth', 0, 360, 1).name(i18next.t('sky.sunAzimuth')));
  onSky(skyFolder.addColor(skySettings, 'zenith').name(i18next.t('sky.zenith')));
  onSky(skyFolder.addColor(skySettings, 'horizon').name(i18next.t('sky.horizon')));

  const windFolder = folder(gui, 'wind.folder', false);
  windFolder.add(windSettings, 'enabled').name(i18next.t('wind.enabled'));
  windFolder.add(windSettings, 'strength', 0, 2, 0.01).name(i18next.t('wind.strength'));
  windFolder.add(windSettings, 'speed', 0, 3, 0.01).name(i18next.t('wind.speed'));
  windFolder.add(windSettings, 'direction', 0, 360, 1).name(i18next.t('wind.direction'));
  windFolder.add(windSettings, 'flutter', 0, 1, 0.01).name(i18next.t('wind.flutter'));

  // Grass is scenery, not tree: it sits with the sky. grass.sync() reads these every frame.
  const grassFolder = folder(gui, 'grass.folder', false);
  grassFolder.add(grass.settings, 'enabled').name(i18next.t('grass.enabled'));
  grassFolder.add(grass.settings, 'count', 0, 150000, 1000).name(i18next.t('grass.count'));
  grassFolder.add(grass.settings, 'height', 0.05, 1.2, 0.01).name(i18next.t('grass.height'));
  grassFolder.add(grass.settings, 'width', 0.005, 0.1, 0.001).name(i18next.t('grass.width'));
  grassFolder.addColor(grass.settings, 'color').name(i18next.t('grass.color'));
  grassFolder.addColor(grass.settings, 'tipColor').name(i18next.t('grass.tipColor'));
  grassFolder.add(grass.settings, 'windResponse', 0, 3, 0.01).name(i18next.t('grass.windResponse'));

  // Grove trees regrow (once the sliders settle) whenever these change.
  const groveFolder = folder(gui, 'grove.folder', true);
  const onGrove = () => {
    refreshToggles();
    scheduleGrove();
  };
  groveFolder.add(groveSettings, 'enabled').name(i18next.t('grove.enabled')).onChange(onGrove);
  groveFolder.add(groveSettings, 'count', 1, MAX_GROVE, 1).name(i18next.t('grove.count')).onChange(onGrove);
  groveFolder.add(groveSettings, 'spacing', 3, 20, 0.5).name(i18next.t('grove.spacing')).onChange(onGrove);
  groveFolder.add(groveSettings, 'variation', 0, 0.5, 0.01).name(i18next.t('grove.variation')).onChange(onGrove);

  const lensFolder = folder(gui, 'lens.folder', false);
  const onLens = (c: Controller) => c.onChange(applyLens);
  lensFolder.add(lensSettings, 'enabled').name(i18next.t('lens.enabled')).onChange(refreshToggles);
  onLens(lensFolder.add(lensSettings, 'dof', 0, 4, 0.05).name(i18next.t('lens.dof')));
  onLens(lensFolder.add(lensSettings, 'bloom', 0, 1.5, 0.01).name(i18next.t('lens.bloom')));
  onLens(lensFolder.add(lensSettings, 'vignette', 0, 1, 0.01).name(i18next.t('lens.vignette')));
  onLens(lensFolder.add(lensSettings, 'grain', 0, 0.15, 0.005).name(i18next.t('lens.grain')));
  onLens(lensFolder.add(lensSettings, 'exposure', 0.3, 2.5, 0.01).name(i18next.t('lens.exposure')));

  const debugFolder = folder(gui, 'debug.folder', false);
  const debugKeys = ['enabled', 'hideFoliage', 'surface', 'ends', 'joints', 'bases', 'unreached', 'xray'] as const;
  debugOptions = [];
  for (const key of debugKeys) {
    const c = debugFolder.add(debugSettings, key).name(i18next.t(`debug.${key}`)).onChange(applyDebug);
    if (key !== 'enabled') debugOptions.push(c);
    if (key === 'surface') {
      debugOptions.push(
        debugFolder.add(debugSettings, 'opacity', 0.05, 0.9, 0.01).name(i18next.t('debug.opacity')).onChange(applyDebug),
      );
    }
  }
  debugOptions.forEach((c) => c.disable(!debugSettings.enabled));
  const resetCtrl = gui.add(actions, 'resetScene').name(i18next.t('gui.resetScene'));
  resetCtrl.domElement.classList.add('eg-quiet');

  const exportFolder = folder(gui, 'export.folder', true);
  for (const key of ['glb', 'obj', 'groveGlb', 'leafPng', 'barkPng'] as const) {
    exportFolder.add(actions, key).name(i18next.t(`export.${key}`));
  }

  const batchFolder = folder(gui, 'batch.folder', true);
  batchFolderRef = batchFolder;
  batchInputs = [
    batchFolder.add(batch, 'count', 1, MAX_BATCH, 1).name(i18next.t('batch.count')),
    batchFolder
      .add(batch, 'seedMode', choices<SeedMode>('options.seedMode', ['sequential', 'hashed']))
      .name(i18next.t('batch.seedMode')),
    batchFolder.add(batch, 'variation', 0, 0.5, 0.01).name(i18next.t('batch.variation')),
    batchFolder.add(batch, 'fruitChance', 0, 1, 0.01).name(i18next.t('batch.fruitChance')),
    batchFolder.add(batch, 'glb').name(i18next.t('batch.glb')),
    batchFolder.add(batch, 'obj').name(i18next.t('batch.obj')),
  ];
  batchButton = batchFolder.add(actions, 'batch');
  batchButton.domElement.classList.add('eg-primary');
  refreshBatchControls();

  tabItems = {
    tree: [picker],
    scene: [viewFolder, groveFolder, skyFolder, windFolder, grassFolder, lensFolder, debugFolder, resetCtrl],
    export: [exportFolder, batchFolder],
  };
  buildTuning();
  applyTab();
  gui.$children.scrollTop = scroll;
}

/** Panel items per tab; the parameters folder joins the tree tab whenever it is rebuilt. */
let tabItems: Record<PanelTab, Showable[]> = { tree: [], scene: [], export: [] };
/**
 * Settings folded away (header, summary line and the tab's action only); kept across panel
 * rebuilds. The app opens folded, so the tree has the screen first.
 */
let panelCollapsed = true;
/** Applies panelCollapsed to the current panel; set by buildHeader. */
let applyCollapsedState = () => {};
let tabButtons: Partial<Record<PanelTab, HTMLButtonElement>> = {};
let tabHint: HTMLElement | null = null;

/**
 * Fixed panel header above the scrolling area: the brand with the language picker, then the
 * Tree | Scene | Export switch and a line saying what the current tab affects.
 */
function buildHeader() {
  const header = el('div', 'eg-header');
  const brand = el('div', 'eg-brand');
  const words = el('div', 'eg-brand-words');
  words.append(el('div', 'eg-brand-name', i18next.t('app.title')), el('div', 'eg-brand-tag', i18next.t('intro.loading')));
  const language = el('select', 'eg-lang');
  language.setAttribute('aria-label', i18next.t('language.label'));
  for (const [label, code] of Object.entries(languageNames())) language.append(new Option(label, code));
  language.value = ui.language;
  // Deferred: changing language rebuilds this panel, which must not happen inside its own handler.
  language.addEventListener('change', () => {
    const lang = matchLanguage(language.value);
    rememberLanguage(lang);
    queueMicrotask(() => void i18next.changeLanguage(lang));
  });
  const mark = el('span', 'eg-mark');
  mark.setAttribute('aria-hidden', 'true');
  // Folds the settings away to the header and download bar, e.g. to see the tree on a phone.
  const collapse = el('button', 'eg-collapse');
  collapse.type = 'button';
  const applyCollapsed = () => {
    gui.domElement.classList.toggle('eg-collapsed', panelCollapsed);
    collapse.setAttribute('aria-expanded', String(!panelCollapsed));
    collapse.title = i18next.t(panelCollapsed ? 'gui.expand' : 'gui.collapse');
    collapse.setAttribute('aria-label', collapse.title);
    summaryHead.title = panelCollapsed ? collapse.title : '';
    summaryHead.tabIndex = panelCollapsed ? 0 : -1;
  };
  applyCollapsedState = applyCollapsed;
  collapse.addEventListener('click', () => {
    panelCollapsed = !panelCollapsed;
    applyCollapsed();
  });
  const source = el('a', 'eg-icon-link');
  source.href = REPO_URL;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.title = i18next.t('gui.github');
  source.setAttribute('aria-label', source.title);
  source.innerHTML = GITHUB_ICON;
  brand.append(mark, words, language);

  const strip = el('div', 'eg-tabs');
  strip.setAttribute('role', 'tablist');
  tabButtons = {};
  for (const tab of PANEL_TABS) {
    const button = el('button', 'eg-tab', tKey(`gui.tabs.${tab}`));
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => {
      panelTab = tab;
      // While folded, a tab only switches the action in the download bar.
      applyTab();
      gui.$children.scrollTop = 0;
    });
    strip.appendChild(button);
    tabButtons[tab] = button;
  }
  strip.append(source, collapse);
  applyCollapsed();
  header.append(brand, strip);
  gui.domElement.insertBefore(header, gui.$children);
  // The hint heads the scrolling area, so it reads as the tab's first line.
  tabHint = el('div', 'eg-tab-hint');
  gui.$children.prepend(tabHint);
}

/** Download bar pinned under the scrolling area, on every tab: the main thing people come for. */
function buildFooter() {
  const footer = el('div', 'eg-footer');
  const buttons = el('div', 'eg-footer-actions');
  const glb = el('button', 'eg-btn eg-btn-primary');
  glb.type = 'button';
  glb.title = i18next.t('gui.downloadHint');
  glb.innerHTML = DOWNLOAD_ICON;
  glb.append(el('span', '', i18next.t('gui.download')));
  glb.addEventListener('click', actions.glb);
  const obj = el('button', 'eg-btn', i18next.t('gui.downloadObj'));
  obj.type = 'button';
  obj.title = i18next.t('export.obj');
  obj.addEventListener('click', actions.obj);
  glb.classList.add('eg-act-glb');
  obj.classList.add('eg-act-obj');
  // Folded actions: the main move of each tab, one tap away while the tree has the screen.
  const random = el('button', 'eg-btn eg-btn-primary eg-act-random');
  random.type = 'button';
  random.innerHTML = DICE_ICON;
  random.append(el('span', '', i18next.t('gui.randomSeed')));
  random.addEventListener('click', actions.randomSeed);
  // Scene tab: on/off switches for the two views people flip most.
  // Export tab, folded: Batch lives in the panel, so this opens the panel right at it.
  const batchJump = el('button', 'eg-btn eg-act-batch', i18next.t('gui.batch'));
  batchJump.type = 'button';
  batchJump.title = i18next.t('gui.batchHint');
  batchJump.addEventListener('click', () => {
    panelCollapsed = false;
    applyCollapsedState();
    panelTab = 'export';
    applyTab();
    openFolders.set('batch.folder', true);
    batchFolderRef?.open();
    batchFolderRef?.domElement.scrollIntoView({ block: 'nearest' });
  });
  footerToggles = [
    footerToggle('grove.folder', () => groveSettings.enabled, (on) => {
      groveSettings.enabled = on;
      scheduleGrove(true);
    }),
    footerToggle('debug.folder', () => debugSettings.enabled, (on) => {
      debugSettings.enabled = on;
      applyDebug();
    }),
    footerToggle('lens.enabled', () => lensSettings.enabled, (on) => {
      lensSettings.enabled = on;
    }),
  ];
  buttons.append(glb, obj, batchJump, random, segmented(footerToggles.map((t) => t.button), 'eg-act-scene'));
  summaryHead.onclick = () => {
    if (!panelCollapsed) return;
    panelCollapsed = false;
    applyCollapsedState();
  };
  footer.append(summaryEl, buttons);
  gui.domElement.append(footer);
}

let presetButtons = new Map<string, HTMLButtonElement>();
/** Debugger options that only matter while it is on. */
let debugOptions: Controller[] = [];

/**
 * Segmented control: one rounded container split into equal sections by hairlines, for two or
 * more related buttons. Only the outer corners are rounded; style.css draws it.
 */
function segmented(sections: HTMLElement[], className = ''): HTMLElement {
  const group = el('div', `eg-segmented ${className}`.trim());
  group.setAttribute('role', 'group');
  group.append(...sections);
  return group;
}

/** An on/off section for the folded Scene bar, mirroring a switch in the panel. */
type FooterToggle = { button: HTMLButtonElement; get: () => boolean };
let footerToggles: FooterToggle[] = [];

function footerToggle(labelKey: string, get: () => boolean, set: (on: boolean) => void): FooterToggle {
  const button = el('button', 'eg-seg eg-toggle');
  button.type = 'button';
  button.append(el('span', 'eg-dot'), el('span', 'eg-seg-label', tKey(labelKey)));
  button.addEventListener('click', () => {
    set(!get());
    // Keeps the matching switch in the panel in step.
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    refreshToggles();
  });
  const toggle = { button, get };
  paintToggle(toggle);
  return toggle;
}

function paintToggle(t: FooterToggle) {
  t.button.classList.toggle('on', t.get());
  t.button.setAttribute('aria-pressed', String(t.get()));
}

function refreshToggles() {
  footerToggles.forEach(paintToggle);
}
let seedInput: HTMLInputElement | null = null;

/** Tree tab head: presets as picture chips, then the seed with a dice button. */
function buildTreePicker(): Showable {
  const wrap = el('div', 'eg-block');
  const grid = el('div', 'eg-presets');
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', i18next.t('gui.preset'));
  presetButtons = new Map();
  for (const name of Object.keys(PRESETS)) {
    const chip = el('button', 'eg-preset');
    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.innerHTML = PRESET_ICONS[name] ?? PRESET_ICONS.Oak;
    chip.append(el('span', '', tKey(`presets.${name}`)));
    chip.addEventListener('click', () => {
      if (name === presetName) return;
      log('Tree', `Preset ${presetName} -> ${name}.`);
      presetName = name;
      applyPreset();
      schedulePresetRegenerate();
    });
    grid.append(chip);
    presetButtons.set(name, chip);
  }

  const seed = el('div', 'eg-seed');
  const label = el('label', 'eg-label', i18next.t('gui.seed'));
  const input = el('input', 'eg-input');
  input.type = 'number';
  input.min = '0';
  input.max = '999999';
  input.step = '1';
  input.id = 'eg-seed-input';
  label.htmlFor = input.id;
  input.addEventListener('change', () => {
    const value = Math.round(Number(input.value));
    if (!Number.isFinite(value)) return refreshSeed();
    params.seed = THREE.MathUtils.clamp(value, 0, 999999);
    log('Tree', `Seed ${params.seed}.`);
    refreshSeed();
    scheduleNewTreeRegenerate();
  });
  seedInput = input;
  const dice = el('button', 'eg-btn eg-dice');
  dice.type = 'button';
  dice.innerHTML = DICE_ICON;
  dice.append(el('span', '', i18next.t('gui.randomSeed')));
  dice.addEventListener('click', actions.randomSeed);
  seed.append(label, input, dice);

  wrap.append(el('div', 'eg-label', i18next.t('gui.preset')), grid, seed);
  gui.$children.append(wrap);
  refreshPresetPicker();
  refreshSeed();
  return block(wrap);
}

function refreshPresetPicker() {
  for (const [name, chip] of presetButtons) {
    chip.classList.toggle('active', name === presetName);
    chip.setAttribute('aria-checked', String(name === presetName));
  }
}

function refreshSeed() {
  if (seedInput) seedInput.value = String(params.seed);
}

function applyTab() {
  for (const tab of PANEL_TABS) {
    tabItems[tab].forEach((item) => item.show(tab === panelTab));
    tabButtons[tab]?.classList.toggle('active', tab === panelTab);
    tabButtons[tab]?.setAttribute('aria-selected', String(tab === panelTab));
  }
  tuning?.show(panelTab === 'tree');
  if (tabHint) tabHint.textContent = tKey(`gui.tabHints.${panelTab}`);
  // Picks the folded panel's single action (see style.css): Random seed, Debugger or GLB.
  gui.domElement.dataset.tab = panelTab;
}

type ParamGroup = 'crown' | 'colonize' | 'tips' | 'growth' | 'shape' | 'bark' | 'leaves' | 'fruit';

/**
 * Tree parameters in plain-language sections, each with a one-line hint. The wrapping folder is
 * drawn flat (no title), so the sections read as one list under the preset picker.
 */
function buildTuning() {
  tuning?.destroy();
  const flat = folder(gui, 'folders.parameters', true);
  tuning = flat;
  flat.domElement.classList.add('eg-flat');
  flat.show(panelTab === 'tree');
  const on = (c: Controller) => c.onChange(scheduleRegenerate);
  /** A slider labelled by its parameter path, e.g. params.crown.radius. */
  const num = (f: GUI, group: ParamGroup, key: string, min: number, max: number, step: number) =>
    on(f.add(params[group] as Record<string, number>, key, min, max, step).name(tKey(`params.${group}.${key}`)));
  /** A section with its hint line under the title. */
  const section = (key: string, open: boolean) => {
    const f = folder(flat, `folders.${key}`, open);
    f.$children.append(el('div', 'eg-hint', tKey(`hints.${key}`)));
    return f;
  };
  /** A small heading inside a section, shown and hidden with the controls under it. */
  const subhead = (f: GUI, key: string) => {
    const node = el('div', 'eg-subhead', tKey(key));
    f.$children.append(node);
    return block(node);
  };

  const crown = section('crown', true);
  // Outline sliders that only shape one crown shape are shown only for that shape.
  const shapeOnly: [Controller, CrownShape][] = [];
  const showShapeControls = () => shapeOnly.forEach(([c, shape]) => c.show(params.crown.shape === shape));
  crown
    .add(params.crown, 'shape', choices('options.crownShape', ['sphere', 'cone', 'umbrella'] as const))
    .name(i18next.t('params.crown.shape'))
    .onChange(() => {
      showShapeControls();
      scheduleRegenerate();
    });
  num(crown, 'crown', 'radius', 0.5, 8, 0.05);
  num(crown, 'crown', 'centerHeight', 1, 15, 0.1);
  num(crown, 'crown', 'stretch', 0.3, 3.5, 0.05);
  shapeOnly.push(
    [num(crown, 'crown', 'sphereTaper', -1, 1, 0.01), 'sphere'],
    [num(crown, 'crown', 'sphereSquareness', 1, 6, 0.05), 'sphere'],
    [num(crown, 'crown', 'umbrellaUnderside', 0, 1, 0.01), 'umbrella'],
    [num(crown, 'crown', 'umbrellaRim', -0.9, 0.9, 0.01), 'umbrella'],
    [num(crown, 'crown', 'umbrellaSoftness', 0.05, 1.5, 0.01), 'umbrella'],
  );
  num(crown, 'crown', 'offsetX', -4, 4, 0.05);
  num(crown, 'crown', 'offsetZ', -4, 4, 0.05);
  showShapeControls();

  const branches = section('branches', false);
  num(branches, 'growth', 'gnarl', 0, 1, 0.01);
  num(branches, 'shape', 'gravity', 0, 2, 0.01);
  num(branches, 'growth', 'tipRadius', 0.002, 0.05, 0.001);
  num(branches, 'growth', 'thickening', 0, 0.03, 0.001);
  num(branches, 'growth', 'pipeExponent', 1.5, 3.5, 0.05);

  const leaves = section('leaves', false);
  leaves
    .add(look, 'leafShape', choices<LeafShape>('options.leafShape', ['oval', 'lance', 'round', 'maple']))
    .name(i18next.t('params.leaves.shape'))
    .onChange(refreshTextures);
  num(leaves, 'leaves', 'size', 0.03, 0.5, 0.005);
  num(leaves, 'leaves', 'hue', 0, 1, 0.005);
  num(leaves, 'leaves', 'season', 0, 1, 0.01);
  num(leaves, 'leaves', 'perTip', 0, 20, 1);
  num(leaves, 'leaves', 'twigDensity', 0, 60, 1);
  num(leaves, 'leaves', 'twigRadius', 0.005, 0.1, 0.001);
  num(leaves, 'leaves', 'sizeJitter', 0, 0.8, 0.01);
  num(leaves, 'leaves', 'aspect', 0.15, 1.2, 0.01);
  num(leaves, 'leaves', 'cluster', 0, 0.6, 0.01);
  num(leaves, 'leaves', 'droop', 0, 1, 0.01);
  num(leaves, 'leaves', 'fold', 0, 0.8, 0.01);
  num(leaves, 'leaves', 'hueJitter', 0, 0.15, 0.005);

  const fruit = section('fruit', params.fruit.enabled);
  on(fruit.add(params.fruit, 'enabled').name(i18next.t('params.fruit.enabled')));
  on(fruit.addColor(params.fruit, 'color').name(i18next.t('params.fruit.color')));
  num(fruit, 'fruit', 'density', 0, 1, 0.01);
  num(fruit, 'fruit', 'size', 0.01, 0.2, 0.001);
  num(fruit, 'fruit', 'sizeJitter', 0, 0.6, 0.01);
  num(fruit, 'fruit', 'segments', 3, 32, 1);
  num(fruit, 'fruit', 'elongation', 0.4, 2.5, 0.01);
  num(fruit, 'fruit', 'hang', 0, 0.3, 0.005);
  num(fruit, 'fruit', 'colorRange', 0, 0.5, 0.01);

  const bark = section('bark', false);
  bark.addColor(look, 'barkColor').name(i18next.t('params.bark.color')).onChange(refreshTextures);
  num(bark, 'bark', 'rootCount', 0, 10, 1);
  num(bark, 'bark', 'rootLength', 1, 8, 0.1);
  num(bark, 'bark', 'barkTiling', 0.25, 4, 0.05);
  num(bark, 'bark', 'radialSegments', 4, 32, 1);
  num(bark, 'bark', 'subdivisions', 0, 6, 1);

  // Growth method: only the active algorithm's settings are shown.
  const method = section('growth', false);
  const colonizeOnly: Showable[] = [];
  const sweepOnly: Showable[] = [];
  const showMethod = () => {
    colonizeOnly.forEach((c) => c.show(params.algorithm === 'colonize'));
    sweepOnly.forEach((c) => c.show(params.algorithm === 'sweep'));
  };
  method
    .add(params, 'algorithm', choices('options.algorithm', ['colonize', 'sweep'] as const))
    .name(i18next.t('params.algorithm'))
    .onChange(() => {
      showMethod();
      scheduleRegenerate();
    });
  num(method, 'tips', 'cut', -1, 0.8, 0.01);
  colonizeOnly.push(
    subhead(method, 'folders.colonize'),
    num(method, 'colonize', 'attractors', 100, 8000, 50),
    num(method, 'colonize', 'influence', 0.3, 4, 0.05),
    num(method, 'colonize', 'kill', 0.05, 1, 0.01),
    num(method, 'colonize', 'step', 0.05, 0.5, 0.01),
    num(method, 'colonize', 'tropism', -1, 1, 0.01),
    num(method, 'colonize', 'maxIterations', 50, 1500, 10),
  );
  sweepOnly.push(
    subhead(method, 'folders.tips'),
    num(method, 'tips', 'count', 20, 3000, 10),
    num(method, 'tips', 'depth', 0, 0.8, 0.01),
    num(method, 'tips', 'jitter', 0, 0.4, 0.01),
    subhead(method, 'folders.sweep'),
    num(method, 'growth', 'layerHeight', 0.03, 0.5, 0.01),
    num(method, 'growth', 'branchAngle', 5, 85, 1),
    num(method, 'growth', 'mergeRadius', 0.1, 3, 0.05),
    num(method, 'growth', 'trunkPull', 0, 1, 0.01),
    num(method, 'growth', 'crownPull', 0, 1, 0.01),
  );
  showMethod();

  const spectral = section('spectral', false);
  // The same canvas moves into each rebuilt section, so it keeps its last drawing.
  spectral.$children.append(spectrumCanvas);
  num(spectral, 'crown', 'noiseAmount', 0, 0.6, 0.01);
  num(spectral, 'crown', 'spectralSlope', 0, 3, 0.05);
  num(spectral, 'crown', 'modes', 0, 160, 1);
  num(spectral, 'crown', 'minFrequency', 0.1, 4, 0.05);
  num(spectral, 'crown', 'maxFrequency', 1, 16, 0.1);

  const detail = section('detail', false);
  const limitCtrl = on(detail.add(budgetUi, 'limit').name(i18next.t('params.limitTriangles')));
  // lil-gui keeps one change handler per controller, so this one also regenerates.
  detail
    .add(budgetUi, 'value', MIN_BUDGET, MAX_BUDGET, 100)
    .name(i18next.t('params.triangleBudget'))
    .onChange(() => {
      limitCtrl.updateDisplay();
      scheduleRegenerate();
    });
  subhead(detail, 'folders.smoothing');
  num(detail, 'shape', 'smoothIterations', 0, 10, 1);
  num(detail, 'shape', 'smoothStrength', 0, 1, 0.01);
  num(detail, 'shape', 'simplifyAngle', 0, 20, 0.5);
}

/** Loads the preset's parameters and look into the panel; growing and texturing come after. */
function applyPreset() {
  params = structuredClone(PRESETS[presetName].params);
  look = { ...PRESETS[presetName].look };
  buildTuning();
  refreshPresetPicker();
  refreshSeed();
}

i18next.on('languageChanged', () => {
  ui.language = currentLanguage();
  log('i18n', `Language changed to ${ui.language}.`);
  translateDocument();
  buildGui();
  renderStatus();
  if (current) {
    renderStats(current);
    drawSpectrum(current.crown);
  }
});

buildGui();

// ---------------------------------------------------------------- Loop

function resize() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/** Frame rate in the top-left corner, averaged over half a second so it stays readable. */
const fpsEl = el('div', 'eg-fps');
fpsEl.setAttribute('aria-hidden', 'true');
document.body.append(fpsEl);
const fps = { frames: 0, since: performance.now() };
function countFrame(now: number) {
  fps.frames++;
  const span = now - fps.since;
  if (span < 500) return;
  fpsEl.textContent = i18next.t('hud.fps', { fps: Math.round((fps.frames * 1000) / span) });
  fps.frames = 0;
  fps.since = now;
}

const clock = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  clock.update(time);
  countFrame(time);
  stepIntro(time);
  controls.update();
  updateWind(clock.getElapsed());
  grass.sync();
  advanceClouds(clock.getDelta(), skySettings.cloudSpeed);
  // The intro lives in the lens pipeline, so it runs even with post-processing switched off.
  if (lensSettings.enabled || intro.active) {
    // Keep the orbit target sharp; the blur ramps in over a depth that grows with zoom distance.
    const focus = camera.position.distanceTo(controls.target);
    lens.focus.value = focus;
    lens.range.value = Math.max(4, focus * 0.6);
    lensPass.pipeline.render();
  } else {
    renderer.render(scene, camera);
  }
});

// ---------------------------------------------------------------- Intro

/**
 * Startup sequence: the neon grid world shows while the first tree grows; the tree appears as
 * glowing edges while the camera glides in to frame it; then a scan front sweeps out from the
 * trunk and the real render takes over behind it (render/retro.ts). Plays once per page load.
 */
const intro = {
  /** The retro pass is in the pipeline (intro, sweep, or the Retro look switch). */
  active: true,
  /** Camera glide towards the framed tree, null when idle. */
  glide: null as null | { start: number; from: THREE.Vector3; fromTarget: THREE.Vector3; to: THREE.Vector3; toTarget: THREE.Vector3 },
  /** Scan sweep in progress: out reveals the real scene, in brings the retro world back. */
  sweep: null as null | { start: number; ms: number; out: boolean; done: () => void },
};
const SWEEP_MS = 850;
/** Sweep back into the retro world before a regrow: quicker than the reveal. */
const SWEEP_IN_MS = 400;
/** Retro hold after the last new-tree request, so quick clicks grow once when they settle. */
const SETTLE_MS = 120;
const GLIDE_MS = 450;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (x: number) => x * x * (3 - 2 * x);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// Grabbing the view cancels the glide, so the intro never fights the user.
controls.addEventListener('start', () => (intro.glide = null));

function stepIntro(now: number) {
  const g = intro.glide;
  if (g) {
    const k = easeInOut(Math.min(1, (now - g.start) / GLIDE_MS));
    camera.position.lerpVectors(g.from, g.to, k);
    controls.target.lerpVectors(g.fromTarget, g.toTarget, k);
    if (k >= 1) intro.glide = null;
  }
  const sweep = intro.sweep;
  if (!sweep) return;
  const p = Math.min(1, (now - sweep.start) / sweep.ms);
  // Ease in: slow while the front crosses the tree, fast across the far ground and sky.
  retro.reveal.value = REVEAL_END * Math.pow(sweep.out ? p : 1 - p, 2.4);
  if (p < 1) return;
  intro.sweep = null;
  if (sweep.out) {
    intro.active = false;
    lensPass.setRetro(false);
  }
  sweep.done();
}

let themeShift = 0;
/**
 * The panel and HUD keep one layout and switch skin with the scene: the neon retro skin while the
 * retro world is on screen (loading a tree, or the Retro look), the clear natural skin otherwise
 * (body.intro, see style.css). Colours cross-fade only during the switch, so hover stays instant.
 * The big title over the view belongs to the first load only (body.boot).
 */
function setRetroTheme(on: boolean) {
  const body = document.body;
  if (body.classList.contains('intro') === on) return;
  body.classList.add('theme-shift');
  body.classList.toggle('intro', on);
  if (!on) body.classList.remove('boot');
  window.clearTimeout(themeShift);
  themeShift = window.setTimeout(() => body.classList.remove('theme-shift'), 450);
  if (current) drawSpectrum(current.crown);
}

/**
 * Starts a scan sweep from wherever the front is now, so reversing one mid-way never jumps.
 * Resolves when it completes or another sweep replaces it.
 */
function startSweep(out: boolean, ms: number) {
  intro.sweep?.done();
  if (!out && !intro.active) {
    intro.active = true;
    lensPass.setRetro(true);
  }
  // The skin fades back as the real render starts to sweep out, and snaps to retro going in.
  setRetroTheme(!out);
  const k = Math.pow(retro.reveal.value / REVEAL_END, 1 / 2.4);
  const start = performance.now() - (out ? k : 1 - k) * ms;
  return new Promise<void>((done) => (intro.sweep = { start, ms, out, done }));
}

function setRetroLook(on: boolean) {
  void startSweep(!on, SWEEP_MS);
}

/** Frames the tree, gliding the camera there unless `animate` is false. */
function frameWithGlide(animate: boolean) {
  const from = camera.position.clone();
  const fromTarget = controls.target.clone();
  frameTree();
  if (!animate) return;
  intro.glide = { start: performance.now(), from, fromTarget, to: camera.position.clone(), toTarget: controls.target.clone() };
  camera.position.copy(from);
  controls.target.copy(fromTarget);
}

async function playIntro() {
  const reduced = reducedMotion();
  // Let the grid world render (and its shaders compile) before the blocking first growth.
  await nextFrame();
  await nextFrame();
  await wait(reduced ? 50 : 325);

  applyPreset();
  void refreshTextures();
  await growMainNow();
  frameWithGlide(!reduced);
  log('System', `Evergrove online in ${startup()} ms; preset=${presetName}, seed=${params.seed}.`);
  await wait(reduced ? 75 : 375);

  // The grove grows under the retro world too; the real render sweeps out once it stands.
  scheduleGrove(true);
}

/**
 * Regrows until no request is newer than the last growth. A parameter change regrows through
 * mainGrowth with no transition, throttled to a few growths a second while a slider moves. A new
 * tree plays the loading look again: sweep back into the retro world, regrow under it once the
 * changes settle, then load the grove there and sweep the real render back out (with the Retro
 * look on it just regrows).
 */
async function runRegenerate() {
  await introDone;
  let grownAt = -Infinity;
  while (regen.lastRequest > grownAt) {
    const reduced = reducedMotion();
    const sweep = regen.sweep && !retroLook.on;
    if (sweep) {
      await startSweep(false, reduced ? SWEEP_IN_MS / 4 : SWEEP_IN_MS);
      for (let idle = performance.now() - regen.lastRequest; idle < SETTLE_MS; idle = performance.now() - regen.lastRequest) {
        await wait(SETTLE_MS - idle);
      }
    }
    // Folds every change made within one frame into one request.
    await nextFrame();
    // A new tree picked while waiting for a plain regrow still gets its sweep.
    if (regen.sweep && !sweep && !retroLook.on) continue;
    const preset = regen.preset;
    const fresh = preset || regen.sweep;
    regen.preset = regen.sweep = false;
    grownAt = performance.now();
    if (!fresh) {
      mainGrowth.request();
      scheduleGrove();
      continue;
    }
    if (preset) await refreshTextures();
    await growMainNow();
    if (preset) frameWithGlide(!reduced);
    // A new tree keeps the retro world up while its grove grows, then sweeps out.
    scheduleGrove(sweep);
  }
}

// The debug views start hidden; until now only the first regenerate applied the view toggles.
applyView();
const introDone = playIntro();

/** Feeds the wind uniforms; strength is scaled by tree height so every preset sways alike. */
function updateWind(seconds: number) {
  // The debugger's markers sit on the still skeleton, so the tree holds still while it is open.
  const on = windSettings.enabled && !debugSettings.enabled;
  wind.time.value = seconds;
  wind.speed.value = windSettings.speed;
  wind.strength.value = on ? windSettings.strength * 0.05 * wind.height.value : 0;
  wind.flutter.value = on ? windSettings.flutter * 0.35 : 0;
  const a = THREE.MathUtils.degToRad(windSettings.direction);
  wind.dir.value.set(Math.cos(a), Math.sin(a));
}

// Exposed for console inspection and automated checks.
Object.assign(window, {
  treeApp: {
    get current() { return current; },
    get grove() { return groveTrees; },
    params: () => params,
    regenerate,
    batch,
    runBatch,
    groveSettings,
    i18next,
  },
});
