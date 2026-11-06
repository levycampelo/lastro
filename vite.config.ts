import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['pdfjs-dist'] },
  server: {
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**'] },
  },
  preview: { proxy: { '/api': 'http://127.0.0.1:3001' } },
})
