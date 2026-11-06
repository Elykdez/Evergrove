<p align="center"><img src="public/icon-512.png" alt="Evergrove icon" width="128" height="128" /></p>

<h1 align="center">Evergrove</h1>

<p align="center">A simple procedural tree generator: 3D trees in the browser, exported individually or batched.</p>

<p align="center"><b><a href="https://elykdez.github.io/Evergrove/">Try it online</a></b> (needs a browser with WebGPU)</p>

<p align="center"><b>Help:</b> <a href="docs/help.en.md">English</a> · <a href="docs/help.zh-CN.md">简体中文</a></p>

## Features

- Grows trees into a crown shape you control, by space colonisation or an inverted tree-support sweep
- Deterministic: the same seed and settings always give the same tree
- Eight presets: oak, maple, conifer, acacia, poplar, willow, apple and shrub
- Optional fruit, from faceted polygons to smooth spheres, with one colour per tree drawn within an adjustable range
- A 1k to 10k triangle budget that lowers detail just enough to fit, pruning the bark's finest twigs while the canopy keeps its shape
- WebGPU rendering with wind-animated branches, leaves and procedural grass; textures and debug views computed in shaders
- Textured GLB or OBJ export, in metres with Y up
- Batch generation of up to 500 variants, downloaded as one ZIP, with an adjustable share of fruiting trees
- A grove of up to 16 seeded variants around the tree, viewable in place and exportable as one placed GLB

## Quick start

```bash
npm install
npm run dev
```

Or double-click `Run Evergrove.cmd` (Windows) / `Run Evergrove.sh`, then open the printed URL in a browser with WebGPU (Chrome or Edge 113+, Safari 26+, Firefox 141+ on Windows).

| Command | Does |
| --- | --- |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `dist/` |

The help guide covers every control and parameter, batch generation, using the exports, and how the algorithms work.

## Deployment

Every push to `main` runs the tests, builds the app and publishes it to GitHub Pages at <https://elykdez.github.io/Evergrove/>, through `.github/workflows/pages.yml`. It needs one setting on GitHub: **Settings > Pages > Build and deployment > Source: GitHub Actions**. The build uses relative asset paths, so `dist/` also works from any other static host or folder.

To add a language, copy `src/locales/en.json`, translate it, and register it in `src/i18n/index.ts`. `npm test` checks that every locale matches the keys.

## Attribution

This project grew out of my two graphic algorithm studies: support generation for 3D printing, and ocean waves synthesised from a JONSWAP spectrum with FFTs.

The support sweep that builds branching supports, and the spectral noise that shapes waves are reworked here to shape crown.

- Built with [Claude Code](https://claude.com/claude-code): code, tests and documentation written with Claude (Opus 5.5) by [Anthropic](https://www.anthropic.com/).
- Space colonisation follows Runions, Lane and Prusinkiewicz, *Modeling Trees with a Space Colonization Algorithm* (2007).
- Built on [three.js](https://threejs.org/), [lil-gui](https://lil-gui.georgealways.com/), [i18next](https://www.i18next.com/) and [fflate](https://github.com/101arrowz/fflate).

## License

[MIT](LICENSE)

