import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so decorator metadata (used by Nest DI) is emitted in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
});
