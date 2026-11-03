import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': path.join(here, '../../frontend/src') } },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: path.join(here, 'index.html'), capture: path.join(here, 'capture.html'), scroll: path.join(here, 'scroll.html') },
    },
  },
});
