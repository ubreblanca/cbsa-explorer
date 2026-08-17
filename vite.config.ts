// Vite config: relative base so the built site works at any GitHub Pages subpath.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Per-build id baked into data-file URLs (?v=…): data/*.json keep stable names and
// GitHub Pages caches them for 10 min, so without this a fresh deploy serves the new
// content-hashed JS bundle alongside stale cached data (the v1.1→v1.2 boot crash).
const buildId = Date.now().toString(36);

export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
});
