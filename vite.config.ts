import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

// GitHub Pages project site lives at /morning-desk/. Override with VITE_BASE=./ (relative)
// or VITE_BASE=/ for other hosts.
export default defineConfig({
  // IWER (in-page WebXR emulator) is injected in dev AND in the production build,
  // on every host, so the Pages site works on desktop without an extension.
  // Real headsets (OculusBrowser UA) skip it and use native WebXR.
  plugins: [iwsdkDev()], // emulator settings live in iwsdk.config.json (dev.emulator)
  base: process.env.VITE_BASE || '/morning-desk/',
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  resolve: {
    dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide', '@drawcall/uikitml'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
});
