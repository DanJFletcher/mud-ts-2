import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const e2eAuth = process.env.MUDD_E2E_AUTH === '1';
const e2eApiPort = process.env.MUDD_E2E_API_PORT ?? '5001';
const e2eWebPort = Number(process.env.MUDD_E2E_WEB_PORT ?? '5000');

export default defineConfig({
  resolve: {
    alias: e2eAuth ? [
      {
        find: /^@clerk\/react\/internal$/,
        replacement: fileURLToPath(new URL('./src/e2e/clerk-internal.ts', import.meta.url)),
      },
      {
        find: /^@clerk\/react$/,
        replacement: fileURLToPath(new URL('./src/e2e/clerk-react.tsx', import.meta.url)),
      },
      {
        find: /^@clerk\/themes$/,
        replacement: fileURLToPath(new URL('./src/e2e/clerk-themes.ts', import.meta.url)),
      },
    ] : [],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['mudd-mark.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'MUDD — The Waystone Path',
        short_name: 'MUDD',
        description: 'A persistent text adventure.',
        theme_color: '#356b51',
        background_color: '#f3f1e9',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: [
          '**/WorldPlayPage-*.js',
          '**/CharacterDetailPage-*.js',
          '**/CodexScreen-*.js',
          '**/CodexScreen-*.css',
        ],
        runtimeCaching: [{
          urlPattern: ({ request, url }) =>
            url.origin === self.location.origin
            && url.pathname.startsWith('/assets/')
            && (request.destination === 'script' || request.destination === 'style'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'mudd-versioned-assets',
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        }],
      },
    }),
  ],
  server: {
    host: e2eAuth ? '127.0.0.1' : '0.0.0.0',
    port: e2eAuth ? e2eWebPort : 5000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${e2eAuth ? e2eApiPort : '5001'}`, changeOrigin: true, ws: true },
    },
  },
  preview: {
    host: e2eAuth ? '127.0.0.1' : '0.0.0.0',
    port: e2eAuth ? e2eWebPort : 5000,
    strictPort: true,
  },
});
