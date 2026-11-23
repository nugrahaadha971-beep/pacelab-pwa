import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relatif: berfungsi di subpath GitHub Pages tanpa mengganti nama repositori
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // memakai public/manifest.json
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,json,woff2}'] },
    }),
  ],
});
