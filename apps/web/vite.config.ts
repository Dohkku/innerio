import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const AUTH_SERVER = process.env.VITE_AUTH_SERVER ?? 'http://localhost:6543';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // Proxy auth + token endpoints to the Bun auth+triplit server so the
    // browser sees them as same-origin. Keeps Better Auth cookies working
    // without cross-origin SameSite gymnastics. Only the API; the WebSocket
    // for Triplit sync still talks to VITE_TRIPLIT_SERVER directly.
    proxy: {
      '/api/auth': {
        target: AUTH_SERVER,
        changeOrigin: false,
      },
    },
  },
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
