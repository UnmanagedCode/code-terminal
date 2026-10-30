import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
// `npm run dev` proxies the API to the backend running standalone (`npm start`).
const backend = process.env.PLUGIN_BACKEND || 'http://127.0.0.1:4000';

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': path.join(here, 'src') } },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true },
  server: { proxy: { '/api': { target: backend, ws: true } } },
});
