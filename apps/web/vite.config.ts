import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5001', changeOrigin: true, ws: true },
    },
  },
});
