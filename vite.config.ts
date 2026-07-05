// Vite config: relative base so the built site works at any GitHub Pages subpath.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
});
