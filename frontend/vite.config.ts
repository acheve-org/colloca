import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// The build goes straight into the Python package, which serves it (git-ignored).
const outDir = resolve(import.meta.dirname, '../src/corpora/static');
// emptyOutDir wipes outDir before each build: refuse to run unless it is exactly
// <repo>/src/corpora/static, so a wrong path can never delete anything else.
const repoRoot = resolve(import.meta.dirname, '..');
if (outDir !== resolve(repoRoot, 'src', 'corpora', 'static')) {
  throw new Error(`Refusing to build into ${outDir}: expected <repo>/src/corpora/static`);
}

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: { outDir, emptyOutDir: true },
  test: {
    environment: 'jsdom',
    css: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    setupFiles: ['tests/setup.ts'],
  },
});
