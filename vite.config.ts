import { defineConfig } from 'vite';
import { pwa } from './tools/pwa.mjs';

declare const process: { env: Record<string, string | undefined> }; // Node global; no @types/node needed

export default defineConfig({
  // every URL relative, so the built game runs from any folder (GitHub Pages serves it at /fairy-wings/)
  base: './',
  // game-ready assets (built sprite sheets, scene layers) are served as-is from /assets
  publicDir: 'assets',
  build: { target: 'es2022' },
  // production builds get the offline service worker (see tools/pwa.mjs)
  plugins: [pwa()],
  // the preview tooling may assign a port; otherwise Vite's default
  server: { port: Number(process.env.PORT) || 5173 },
  preview: { port: Number(process.env.PORT) || 4173 },
});
