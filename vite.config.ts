import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), cesium()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 6000 },
})
