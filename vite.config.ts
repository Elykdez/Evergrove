import { defineConfig } from 'vite';

// The app requires WebGPU, and every browser with WebGPU supports ES2022 (top-level await included).
export default defineConfig({
  // Relative asset URLs, so the build runs from any folder: the site root, a GitHub Pages
  // project page (/Evergrove/), or a copied dist/.
  base: './',
  build: { target: 'es2022' },
  // Growth workers (src/grow.worker.ts) import the tree pipeline as ES modules.
  worker: { format: 'es' },
});
