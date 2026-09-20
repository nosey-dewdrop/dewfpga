import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        tb: resolve(import.meta.dirname, 'tb.html'),
      },
    },
  },
  worker: { format: 'es' },
  // examples import templates/blink.* from the repo root, one level above the vite root
  server: { fs: { allow: ['..'] } },
});
