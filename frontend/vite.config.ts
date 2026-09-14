import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    cors: true,
    // @ts-ignore - for Arena preview
    allowedHosts: true as any,
    // NOTE: no X-Frame-Options header on purpose — the preview embeds this
    // app in an iframe, and 'ALLOWALL' is not a valid token (browsers ignore
    // it, but some preview proxies flag the header as embedding-blocked).
    hmr: {
      clientPort: 443,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    cors: true,
  },
});
