import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the Go API runs on :8080; Vite proxies the BFF routes so the
// browser sees a single origin and session cookies stay first-party.
const api = process.env.ORBIT_API_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': api,
      '/auth': api,
      '/go': api,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
