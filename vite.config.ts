import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 }, // three.js is most of the bundle
  test: {
    include: ['test/**/*.test.ts'],
  },
});
