import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts', 'media/**/*.test.ts'],
    // Node by default; DOM-dependent files opt in via a per-file
    // `@vitest-environment happy-dom` docblock.
    environment: 'node',
  },
});
