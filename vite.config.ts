import { defineConfig } from 'vite';

declare const process: { env: Record<string, string | undefined> }; // Node global; no @types/node needed

export default defineConfig({
  // game-ready assets (built sprite sheets, scene layers) are served as-is from /assets
  publicDir: 'assets',
  build: { target: 'es2022' },
  // the preview tooling may assign a port; otherwise Vite's default
  server: { port: Number(process.env.PORT) || 5173 },
});
