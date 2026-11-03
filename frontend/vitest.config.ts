import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', '../harness/mobile-input/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // The palette guard reads the fallback sheet's text (`?raw`); other CSS stays stubbed.
    css: { include: [/cc-theme-fallback\.css/] },
  },
}));
