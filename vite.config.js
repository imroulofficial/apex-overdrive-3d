import { defineConfig } from 'vite';

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
});
