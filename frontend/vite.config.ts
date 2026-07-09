import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Make the dev server itself listen on 127.0.0.1, matching the backend.
    host: '127.0.0.1',
    // Tell the browser never to cache anything from the dev server, so a
    // page reload always shows the latest code instead of a stale copy.
    headers: {
      'Cache-Control': 'no-store',
    },
    // Send any /api request to the FastAPI backend dev server.
    // 127.0.0.1 (not localhost) avoids IPv6 lookup problems on Windows.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  // Same no-cache rule for "npm run preview", which serves the built
  // production bundle locally.
  preview: {
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
})
