import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Single-island Vite config. Vite/Rollup forbid `inlineDynamicImports` with
 * multiple inputs (and IIFE format requires a single self-contained bundle),
 * so the build script invokes Vite once per island and selects which one via
 * the ISLAND env var.
 */
const ISLAND = process.env.ISLAND;
if (!ISLAND) {
  throw new Error('ISLAND env var required (e.g. ISLAND=CoursesCatalog vite build)');
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'assets/islands/dist',
    emptyOutDir: false,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, `apps/web/src/islands/${ISLAND}.jsx`),
      // Island name may include a subdirectory (e.g. "dashboards/CreatorShell").
      // Strip the path prefix for the IIFE global + output filename so the
      // built bundle still lives at assets/islands/dist/<basename>.iife.js.
      name: `TknIsland_${ISLAND.split('/').pop().replace(/[^A-Za-z0-9_]/g, '_')}`,
      formats: ['iife'],
      fileName: () => `${ISLAND.split('/').pop()}.iife.js`,
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    minify: 'esbuild',
    target: 'es2019',
  },
  resolve: {
    alias: {
      '@ui': path.resolve(__dirname, 'packages/ui/src'),
      '@lib': path.resolve(__dirname, 'apps/web/src/lib'),
    },
  },
  esbuild: { jsx: 'automatic' },
  // React reads process.env.NODE_ENV at runtime; lib mode doesn't define it,
  // so we inline the production literal to avoid a ReferenceError in browsers.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
