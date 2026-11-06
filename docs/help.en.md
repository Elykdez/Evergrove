<p align="center"><img src="../public/icon-512.png" alt="" width="96" height="96" /></p>

# Evergrove help

**English** | [简体中文](help.zh-CN.md)

Evergrove is a simple procedural tree generator. It grows a 3D tree inside a crown shape you control, then exports it for Blender, game engines or any glTF/OBJ tool. Everything runs in the browser, and the same settings and seed always give the same tree.

- [Getting started](#getting-started)
- [The screen](#the-screen)
- [A typical workflow](#a-typical-workflow)
- [The control panel](#the-control-panel)
- [Parameters](#parameters)
- [Batch generation](#batch-generation)
- [Using the exports](#using-the-exports)
- [How it works](#how-it-works)
- [Tips and troubleshooting](#tips-and-troubleshooting)

## Getting started

To try it without installing anything, open the online version at <https://elykdez.github.io/Evergrove/> in a browser with WebGPU (see below). To run it locally, you need [Node.js](https://nodejs.org/) 18 or newer, and a browser with **WebGPU**: Chrome or Edge 113 or later, Safari 26 or later, or Firefox 141 or later on Windows. Without WebGPU the app shows a message and does not start.

```bash
npm install
npm run dev
```

Then open the address it prints (http://127.0.0.1:5173 by default). On Windows you can double-click `Run Evergrove.cmd` instead; on macOS or Linux, run `Run Evergrove.sh`.

## The screen

While the app starts, the view shows a synthwave grid world: a cyan grid under a purple sunset sky, with the first tree as a dark silhouette. A scan ring then sweeps out from the trunk and the normal view takes over behind it. This plays once per page load and changes nothing you export; **Retro look** under Scene > View brings it back. The same sweep plays whenever a new tree loads (another preset or seed) and whenever the grove regrows, and the control panel switches to a matching neon look while it does, returning to its clear natural look once the tree and its grove are shown.

The small counter in the top-left corner of the view shows the frame rate (frames per second), so you can see how hard a preset, a large grove or the lens effects work the GPU. Progress and timings for every step (growth, grove, textures, exports) go to the browser's developer console (F12).

- **3D view:** drag with the left mouse button to orbit, the right button to pan, and the wheel to zoom.
- **Control panel** (right): everything lives here.
  - **Header:** the language picker, and the **Tree** (what shapes the tree you export), **Scene** (how the view looks, never exported) and **Export** (downloads and batch) tabs. Each tab opens with a line saying what it affects. The GitHub button at the end of the tabs opens the project's source code in a new tab.
  - **Sections:** each tab's settings, in sections you open or close by clicking their title. Each section starts with a one-line hint.
  - **Summary and download bar** (bottom, on every tab): the current tree's preset and seed, its key figures, and the **Download GLB** and **OBJ** buttons.
  - **Fold button** (round, at the end of the tabs): folds the settings away, leaving the tree on screen with just the header, a one-line summary and the current tab's quick actions: **Random seed** on Tree, **Grove**, **Debugger** and **Post-processing** on/off toggles on Scene, and **Download GLB** and **Batch** on Export (Batch unfolds the panel at the Batch section). Switching tabs while folded switches the actions. Click the summary line or the fold button to unfold. The panel starts folded; on a phone it sits at the bottom of the screen.

The summary shows, for example, **Tips** 457, **Triangles** 74,145, **Build** 322 ms, then `1,726 nodes · 1 trunk · trunk radius 0.25 m`:

| Item | Meaning |
| --- | --- |
| Tips | Branch ends, where most leaves grow |
| Triangles | Size of the mesh you will export |
| Build | Time taken to grow and mesh the tree |
| nodes | Points in the branch skeleton |
| trunk, trunk radius | Number of stems reaching the ground, and the thickest trunk radius in metres |

## A typical workflow

1. Pick a **Preset** chip close to the tree you want.
2. Press **Random seed** (the dice) until the overall shape looks right. The seed changes the details, not the species.
3. Adjust the **Crown shape** to set the size and silhouette, then **Leaves** and **Bark** for the look.
4. Press **Download GLB** (one file with textures) or **OBJ** at the bottom of the panel.
5. To see the tree among its variations, turn **Grove** on (Scene tab); to download many variations at once, use **Batch** on the Export tab (with the panel folded, the **Batch** button next to Download GLB opens it).

The tree regrows in place as you drag a slider.

## The control panel

| Tab | Holds |
| --- | --- |
| Tree | Preset chips, Seed and all the [Parameters](#parameters) |
| Scene | View, Grove, Sky, Wind, Grass, Lens and Debugger |
| Export | Export buttons and Batch |

The summary and download bar sit under every tab.

### Language, Preset, Seed

- **Language:** English or 简体中文, picked at the top right of the panel. On first visit the app follows your browser's preferred languages, taking the first one it has and falling back to English. A language you pick is remembered and wins over the browser from then on. You can also open the app with `?lang=en` or `?lang=zh-CN` in the address.
- **Preset:** the picture chips at the top of the Tree tab, a starting point for each species. Choosing one replaces all parameters.

  | Preset | Character |
  | --- | --- |
  | Oak, Maple, Poplar, Acacia | Broadleaf trees grown by space colonisation |
  | Willow | Space colonisation with strong gravity, so branches weep |
  | Apple | A low, rounded fruit tree with red apples |
  | Conifer | Support sweep with a central leader inside a cone |
  | Shrub | Support sweep without a trunk, giving several stems |

- **Seed** and **Random seed:** type a seed, or press the dice for a random one. The same seed and settings always give the same tree.

### View (Scene tab)

These only change what you see, never what you export.

| Option | Shows |
| --- | --- |
| Leaves, Bark, Fruit | The parts of the tree |
| Crown envelope | The blue wireframe the tree grows into |
| Growth skeleton | The branch graph, coloured blue (low) to red (high) |
| Attractors / tips | The points that guided growth |
| Auto rotate | Turns the view slowly |
| Retro look | Sweeps back into the startup grid world; a striped synthwave sun sits where the real sun is (set it under Sky). Untick to sweep out again |

### Grove (Scene tab)

The grove grows variations of the current tree around it, so you can judge a preset as a group rather than one specimen. Grove trees use the next seeds (seed + 1, + 2, ...) like a sequential batch, with a little parameter variation, and stand at seeded spots: the same seed and settings always give the same grove. They grow one by one under the retro loading look, and the normal view sweeps back once the last one stands; they regrow the same way when you change a parameter, the seed, the preset or a grove setting (after a slider is released). The Leaves, Bark and Fruit view switches apply to them too; the debugger and debug views show only the main tree.

| Option | Effect |
| --- | --- |
| Show grove | Turns the grove on or off (off by default, so the view starts with the one tree; also on the folded Scene bar) |
| Trees | How many trees stand around the main one (1 to 16). Changing it keeps the trees already standing in place |
| Spacing (m) | Least distance between any two trunks, the main one included |
| Variation | How far grove trees differ from the main tree: 0 changes only the seed. Works like Batch's Parameter variation |

The summary shows the grove's tree and triangle count under the main tree's figures, which stay the main tree's own. Each grove tree takes about as long to grow as the main tree, so a large grove of a heavy preset takes a few seconds to load. Trees grow in background workers, several at once, so the view and the panel stay responsive meanwhile; the same goes for the main tree and for Batch. The normal downloads export only the main tree; **Download grove GLB** on the Export tab exports them all.

### Debugger (Scene tab)

An algorithm checker drawn over the tree. It measures the real geometry on the CPU (the same `Crown.point` the growth sampled, and the final skeleton after gravity, smoothing and simplification), so what it reports is what the algorithm actually produced. Tick **Debug the algorithm** to switch it on (or use the **Debugger** button on the folded Scene tab); its other options apply only while it is on, and grey out while it is off; the wind holds still while it is on, so the markers stay on their branches. The summary at the bottom of the panel adds a check line: joints (and how many are 3+ way), branch ends outside the crown with the worst overshoot, and crown samples never reached.

| Option | Shows |
| --- | --- |
| Hide leaves and fruit | Clears the foliage away while debugging (the View switches come back when the debugger is off) |
| Crown surface, Surface opacity | The envelope as a semi-transparent solid, coloured by the 1/f noise: warm where it bulges, cool where it dips, green where flat. Grey marks directions below the tip cut, where no tips or attractors are placed |
| Branch ends | Every end of the final skeleton, coloured by depth along the ray from the crown centre: green on the surface, fading to blue deeper inside, red more than 2% outside. Where a strongly noised cone folds over itself, the outermost layer counts |
| Joints | Where branches meet: yellow for a plain fork, pink where three or more meet at once (a sweep merging many branches in one layer, for example) |
| Trunk bases | A white ring where each trunk meets the ground; more than one means a multi-stem tree |
| Unreached samples | Attractors that space colonisation never consumed (gaps in the crown), or sweep tips below the first layer |
| Markers through bark | Draws the markers on top, so joints inside thick limbs show |

Reading it: ends outside the crown usually come from **Gravity**, which turns rising branches toward the ground and swings their ends out past the crown's sides, or from a colonisation **Step length** larger than the crown's dips. Many unreached attractors mean the **Influence** radius is too small or **Max iterations** ran out.

### Sky, Grass, Wind and Lens (Scene tab)

Everything on the Scene tab changes only how the view looks: never the tree, the parameters or the exports (the grove reaches a file only through **Download grove GLB**). **Reset scene** restores the grove, sky, grass, wind and lens defaults.

**Sky**

| Setting | Effect |
| --- | --- |
| Cloud cover | 0 is a clear sky, 1 overcast |
| Cloud speed | How fast the clouds drift; 0 stops them |
| Sun elevation, Sun direction | Where the sun sits, in degrees; the sun light and shadows follow it |
| Sky colour, Horizon colour | The colour overhead and at the horizon; the distance haze uses the horizon colour |

**Grass**

Grass scatters instanced grass blades over the ground, densest near the trunk and thinning toward the horizon. The blades bend with the same wind as the tree, in waves that roll across the field. Grass is display only: it is never exported and does not count toward the triangle budget.

| Option | Effect |
| --- | --- |
| Show grass | Turns the grass on or off |
| Blades | Number of blades (5 triangles each, all drawn in one call) |
| Height (m), Blade width (m) | Average blade size; each blade varies around it |
| Base colour, Tip colour | Colour at the root and at the tip |
| Wind response | How strongly the grass reacts to the wind |

**Lens**

The default look is a light cinematic finish. Set any effect to 0 to switch it off, or untick **Post-processing** to see the plain render.

| Setting | Effect |
| --- | --- |
| Depth of field | Blurs what lies in front of or behind the point you orbit around, which stays sharp |
| Bloom | A soft glow around the sun and brightly lit surfaces |
| Vignette | Darkens the corners of the frame |
| Film grain | Fine moving noise |
| Exposure | Overall brightness |

**Wind**

Wind animates the tree on the GPU: branches sway, more toward the top, and leaves flutter about their stems. It is display only and never changes the exports.

| Option | Effect |
| --- | --- |
| Animate | Turns the wind on or off |
| Strength | How far the crown sways; scaled to the tree's height |
| Speed | How fast the gusts move |
| Direction (degrees) | Where the wind blows toward, around the vertical axis |
| Leaf flutter | How much each leaf flaps |


### Export (Export tab)

| Button | File |
| --- | --- |
| Download GLB (textured) | `tree-<preset>-<seed>.glb` with bark, leaves, fruit (if any) and both textures embedded |
| Download OBJ (geometry) | `tree-<preset>-<seed>.obj`, geometry only |
| Download grove GLB (all trees) | `grove-<preset>-<seed>-<n>x.glb`: the main tree and every grove tree in one file, placed as in the view, with the textures embedded once |
| Download leaf / bark texture | The PNG textures, for use with the OBJ |

## Parameters

Lengths are in metres. The headings below match the sections on the Tree tab, which runs: Crown shape, Branches, Leaves, Fruit, Bark, Growth method, Outline noise, and Detail and smoothing.

### Growth method

- **Algorithm:**
  - **Space colonisation** grows up from the trunk toward points scattered in the crown. Most broadleaf presets use it.
  - **Support sweep (inverse)** grows down from tips on the crown surface and merges them into a trunk. Conifer and Shrub use it.

Only the active algorithm's settings show: the **Space colonisation** group, or the **Tips (sweep)** and **Support sweep** groups. *Lowest direction* applies to both and always shows.

### Crown shape

The envelope the tree fills.

| Parameter | Effect |
| --- | --- |
| Shape | Sphere, cone or umbrella |
| Radius (m) | Overall crown size |
| Centre height (m) | Height of the crown centre above the ground |
| Vertical stretch | Above 1 is tall and narrow, below 1 is flat and wide |
| Offset X / Z (lean) | Moves the crown sideways, so the trunk leans |
| Taper (+ wide base) | Sphere only. Positive pulls the top in and pushes the bottom out, an egg on its wide end; negative makes the top the wide end. 0 is a plain sphere |
| Squareness (2 = round) | Sphere only. 2 is round; higher flattens the top, bottom and sides into a rounded box; lower pulls the crown to points at the top, bottom and equator (a diamond at 1) |
| Underside width | Umbrella only. Width of the underside as a fraction of the canopy top; 1 is as wide as the top, low values make a thin stalk-like underside |
| Rim height | Umbrella only. Where the underside turns into the canopy, from -0.9 (low, a deep canopy) to 0.9 (high, a shallow cap) |
| Rim softness | Umbrella only. How gradually it turns: small is a sharp brim, large a smooth dome |

The sphere and umbrella sliders show only for their own shape. Their defaults reproduce the original shapes, so existing seeds grow the same trees. Changing any parameter regrows the tree in place: while you drag a slider it regrows up to ten times a second, several growths overlapping in the background, and always ends on where you let go. The retro sweep plays only for a new tree: when you pick another preset, press **Random seed** or change **Seed**.

### Outline noise

Makes the crown outline irregular, like a real canopy. The section opens with a plot of the noise spectrum: one bar per wave, placed by frequency and sized by amplitude.

| Parameter | Effect |
| --- | --- |
| Amount | How far the outline bulges and dents (0 is a smooth shape) |
| Slope beta | Higher gives large smooth lobes, lower gives small rough bumps |
| Modes | Number of waves summed; more gives a richer outline |
| Min / Max frequency | Size range of the bumps, from big lobes to fine detail |

### Space colonisation (Growth method)

| Parameter | Effect |
| --- | --- |
| Attractors | Points scattered in the crown. More gives denser branching (and slower growth) |
| Influence radius (m) | How far a branch can sense points. Larger gives longer, straighter limbs |
| Kill distance (m) | A point is used up once a branch gets this close. Smaller fills the crown more finely |
| Step length (m) | Length of each growth step. Smaller is smoother but slower |
| Tropism (+up / -weep) | Constant bias: positive grows upward, negative droops |
| Max iterations | Upper limit on growth steps. Raise it if the tree stops before filling the crown |

### Tips (sweep, Growth method)

| Parameter | Effect |
| --- | --- |
| Count | Number of branch tips on the crown surface |
| Lowest direction | How far down the crown carries tips or attractors (-1 is the whole crown, 0 the upper half). Used by both algorithms |
| Inset depth | How far tips may sit inside the surface |
| Jitter | Random displacement of tips |

### Branches

| Parameter | Effect |
| --- | --- |
| Gnarl | Random wobble at each step. 0 is straight, 1 is twisted |
| Tip radius (m) | Thickness of the finest twigs |
| Pipe exponent | How fast branches thicken where they join. 2 conserves cross-section (da Vinci's rule); real trees fall between 2 and 3. Lower gives a thicker trunk |
| Thickening / m | Extra radius per metre of branch length, so long limbs taper |
| Gravity (sag) | Branches bend under their own weight. Thin ones bend most; around 1 weeps |

### Support sweep (Growth method)

| Parameter | Effect |
| --- | --- |
| Layer height (m) | Vertical step of the downward sweep |
| Branch angle | Maximum lean from vertical per step, in degrees |
| Merge radius (m) | How far apart branches can be and still pull together |
| Trunk pull | Pull toward a single trunk below the crown. 0 gives a multi-stem shrub |
| Crown pull (leader) | Pull toward the axis inside the crown. High gives a conifer's single leader |

### Detail and smoothing

- **Limit triangles** and **Triangle budget:** the most triangles the whole tree may use, from 1,000 to 10,000; with the box unticked there is no limit, and moving the slider ticks it. If the tree is over, the app lowers the detail just enough, in stages: fewer sides and rings on the bark, then simpler branch paths, then, at the smallest budgets, the thinnest twigs and the root flares are pruned from the bark. Leaves always grow on the full skeleton, so the canopy keeps its shape: they just get fewer and larger (up to 3x), and fruit get fewer facets and then fewer fruit. While the bark is cut, 40% of the budget stays reserved for leaves and fruit. The summary says *fitted to a ... budget* when detail was lowered, or *over the ... budget* if even the lowest detail is too much. In batches the budget applies to each tree.

| Parameter | Effect |
| --- | --- |
| Iterations, Strength | How much the branch paths are smoothed |
| Simplify angle | Nearly straight runs bending less than this are merged, which lowers the triangle count |

### Bark

| Parameter | Effect |
| --- | --- |
| Colour | Bark tint |
| Segments | Sides around the trunk; thinner branches use fewer |
| Curve subdivisions | Extra rings that smooth curves. 0 keeps sharp corners |
| Roots | Number of buttress roots |
| Root reach | Root length, in trunk radii |
| Texture tiling | How many times the bark texture repeats around a branch |

### Leaves

| Parameter | Effect |
| --- | --- |
| Shape | Oval, lance, round or maple leaf texture |
| Per tip | Leaves at each branch end |
| Along twigs / m | Leaves per metre along thin twigs |
| Twig radius (m) | Twigs up to this thickness carry leaves |
| Size (m), Size jitter | Leaf length and how much it varies |
| Aspect | Width relative to length |
| Cluster spread | How far leaves spread from their twig |
| Droop | How much leaves hang down |
| Midrib fold | V-fold along the leaf's centre line |
| Hue, Hue jitter | Leaf colour (0.25 to 0.35 is green) and its variation |
| Season (autumn) | 0 is summer, 1 is full autumn colour |

### Fruit

Fruit hang from the branch tips on short stems. All the fruit on one tree share a single colour.

| Parameter | Effect |
| --- | --- |
| Bear fruit | Turns fruit on or off for this tree |
| Density | Chance that a branch tip carries a fruit (0 to 1) |
| Size (m), Size jitter | Fruit radius and how much it varies |
| Facets (3 = polygon) | Segments around each fruit. 3 to 8 gives a faceted, low-poly shape; 16 or more a smooth sphere |
| Elongation | Below 1 is flattened, above 1 elongated (pear, lemon) |
| Stem length (m) | How far the fruit hangs below its tip |
| Colour | Base fruit colour |
| Colour variation | How far each tree's fruit colour may drift from the base colour. Each tree picks one shift from its seed, so batches show a range of shades |

## Batch generation

The **Batch** folder grows many variations of the current settings and downloads them all as one ZIP.

| Setting | Effect |
| --- | --- |
| Trees | How many to generate (1 to 500) |
| Seeds | **Sequential** uses the current seed, then seed + 1, and so on, so the first tree is the one on screen. **Scattered** spreads seeds over the whole range |
| Parameter variation | 0 changes only the seed. Higher values also vary crown size, height, stretch, outline, lean, tropism, gnarl, leaf size, droop, hue and fruit size, within each slider's range |
| Fruiting trees | Fraction of the batch that bears fruit (default 0.1, so 2 of 20). Exactly that share of trees get fruit, picked by seed; the rest have none. The fruit look comes from the **Fruit** settings, even if *Bear fruit* is off |
| Include GLB / Include OBJ | Which formats to put in the ZIP. Choose at least one |

Press **Generate and download ZIP**. While it runs, the button shows the progress, for example `Cancel (12 / 50)`. Press it again to stop; nothing is downloaded after a cancel.

The ZIP is named like `trees-oak-50x-seed7.zip` and contains:

- `001-tree-oak-7.glb`, `002-tree-oak-8.glb`, ... numbered in order
- the matching `.obj` files and a `textures/` folder, if OBJ is included
- `manifest.json`, with the seed, statistics (including the fruit count) and every parameter of each tree

The same settings always produce the same batch. To rebuild one tree from the batch in the app, choose the same preset, set the seed from the manifest and, if variation was above 0, copy its parameter values from the manifest.

GLB is about four times smaller than OBJ, so prefer it for large batches.

## Using the exports

- **Units and axes:** metres, Y up, with the trunk base at the origin.
- **GLB:** the meshes `Bark` and `Leaves`, plus `Fruit` when the tree bears any. The leaf material is double-sided and uses an alpha mask (cutout) with vertex colours, so each leaf has its own shade. Fruit use vertex colours too. Blender: *File > Import > glTF 2.0*. Unity, Unreal and Godot import it directly.
- **Grove GLB:** a `Grove` node holding one `Tree-<seed>` node per tree, each with its own translation and turn about Y and the same `Bark`, `Leaves` and `Fruit` meshes as a single-tree GLB. The main tree is at the origin.
- **OBJ:** positions, normals and UVs only, without colours. Assign the bark and leaf PNGs yourself, set the leaf material to alpha clip (cutout) and double-sided, and give the fruit a plain colour.

## How it works

1. **Crown surface:** a base shape (sphere, cone or umbrella) whose radius per direction comes from a profile (the sphere's taper and superellipse squareness, the umbrella's underside, rim and softness), and is displaced by spectral noise. The noise sums random plane waves with amplitude ~ f^-beta, the same synthesis as an inverse FFT of a 1/f^beta spectrum but evaluated directly on the sphere, so it has no seams. Its variance is normalised, so *Amount* means the same at any slope. The Outline noise section plots the spectrum.
2. **Growth**, one of two algorithms:
   - **Space colonisation** (Runions, Lane and Prusinkiewicz, 2007): attractor points fill the crown. Each pulls the nearest branch node within the influence radius, pulled nodes grow one step toward their attractors, and attractors a branch reaches are removed. Competition for attractors spaces the branches and creates the hierarchy.
   - **Support sweep:** the 3D-printing tree-support algorithm run upside down. Tips on the crown surface descend layer by layer, lean toward their neighbours within the branch-angle limit, and merge. A pull toward the axis gathers them into a trunk.
3. **Radii** follow the pipe model: parent r^e = sum of child r^e.
4. **Gravity:** stiffness scales with radius cubed, so limbs stay rigid while twigs hang. The bend is passed outward along each limb, which is what makes a willow weep.
5. **Cleanup:** smoothing, then nearly straight runs are merged.
6. **Meshing:** bark tubes follow each chain of branches, resampled into smooth curves, with buttress roots at the base. Leaves are folded cards at every tip and along thin twigs, coloured per leaf.
7. **Fruit:** each branch tip rolls against *Density*; fruit hang below their tips on a thin stem and are skipped if they would touch the ground. The tree's fruit colour is the base colour with a hue, saturation and lightness shift drawn from the seed, bounded by *Colour variation*. Fruit use their own random stream, so switching them on never changes the branches or leaves.
8. **Triangle budget:** a single detail factor sets the bark's sides and rings, extra path simplification, how many twig tips the bark keeps, the leaf count and the fruit facets. Pruning removes every branch thinner than one threshold radius, the lowest that leaves few enough tips; stripped limbs taper to a point. A short search finds the largest factor that fits for the bark, with part of the budget held back for the leaves. Leaves and fruit then fill whatever is left, which usually lands within a few percent of the budget.
9. **Textures** are computed per pixel on the GPU, as shaders, then read back once so they can be embedded in exports. The leaf texture is grey with a cutout, so one texture serves any colour; the bark tiles seamlessly.
10. **Rendering** uses WebGPU. Wind, the crown envelope view and the skeleton colours are computed in shaders. Tree growth and meshing stay on the CPU, which keeps every tree exactly reproducible from its seed on any GPU, and is what gets exported.

## Tips and troubleshooting

- **Slow to regenerate:** lower *Attractors*, *Count* or *Max iterations*, or raise *Step length*. Leaves are cheap; branches cost the most.
- **Too many triangles:** tick *Limit triangles*. To tune by hand, lower *Per tip* and *Along twigs / m*, reduce bark *Segments* and *Curve subdivisions*, raise *Simplify angle*, or lower fruit *Facets*.
- **The tree doesn't fill its crown:** raise *Max iterations* or *Influence radius*.
- **The trunk looks too thin or too thick:** change *Pipe exponent* (lower is thicker) or *Thickening / m*.
- **Branches hang too much or too little:** change *Gravity (sag)* and *Tropism*.
- **Wrong language on start:** pick it in *Language*, or open the app with `?lang=en`.
- **A large batch uses a lot of memory:** use GLB only, or split it into several smaller batches.
