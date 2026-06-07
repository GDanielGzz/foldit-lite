import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/predict': 'http://localhost:8001',
      '/health': 'http://localhost:8001',
      '/puzzles': 'http://localhost:8001',
      '/tutor': 'http://localhost:8001',
    },
  },
})
