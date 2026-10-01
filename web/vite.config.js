import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const easSrc = fileURLToPath(new URL('../eas/src', import.meta.url));

export default defineConfig({
  // The dashboard is served from reactnativefeel.com/deploy/dashboard — /deploy
  // itself is the marketing page — so every asset URL has to be prefixed.
  // Getting this wrong produces a page that works in dev and 404s every chunk in
  // production.
  base: '/deploy/dashboard/',
  plugins: [react()],
  resolve: {
    alias: {
      // The Build record mapper is shared with the CLI rather than reimplemented.
      // One mapping means `eas build:list --json` and this UI can never disagree
      // about what a build's status or duration is.
      '@eas': easSrc,
    },
  },
  server: {
    fs: {
      // ../eas lives outside the Vite root, so it has to be explicitly allowed.
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
