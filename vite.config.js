import { defineConfig } from 'vite';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// public/ is copied into dist/ verbatim, and dist/ becomes assets/public/ inside the AAB. The
// CREDITS.md / README.md files that sit next to the assets they describe are for the repo, not
// the game, so they are dropped from the build output.
const DOCS_ONLY = /\.md$/i;
function stripDocs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) stripDocs(p);
    else if (DOCS_ONLY.test(entry.name)) rmSync(p);
  }
}

export default defineConfig({
  // Relative asset paths so the bundle loads from the Capacitor WebView's local origin.
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true },
  plugins: [
    {
      name: 'strip-docs-from-bundle',
      apply: 'build',
      writeBundle(options) {
        stripDocs(options.dir);
      },
    },
  ],
});
