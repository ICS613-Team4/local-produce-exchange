import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Make the dev server itself listen on 127.0.0.1, matching the backend.
    host: '127.0.0.1',
    // Send any /api request to the FastAPI backend dev server.
    // 127.0.0.1 (not localhost) avoids IPv6 lookup problems on Windows.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
