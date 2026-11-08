import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), cesium()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    host: true,
    // Tuỳ chọn khi phát triển: chuyển tiếp API Supabase qua cùng cổng với giao diện
    // (đặt DEV_API_PROXY=http://localhost:54321 và VITE_SUPABASE_URL=same-origin)
    proxy: process.env.DEV_API_PROXY
      ? Object.fromEntries(['/auth/v1', '/rest/v1', '/storage/v1'].map((p) => [p, { target: process.env.DEV_API_PROXY, changeOrigin: true }]))
      : undefined,
  },
  build: { chunkSizeWarningLimit: 6000 },
})
