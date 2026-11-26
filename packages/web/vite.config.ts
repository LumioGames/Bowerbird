import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The shell compiles plugin-sdk/web from source (one shared instance, exposed to plugins at runtime).
// `pnpm dev` proxies the API to a running `bb serve` (default 127.0.0.1:7420).
const api = process.env.BOWERBIRD_API ?? 'http://127.0.0.1:7420'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@bowerbird\/plugin-sdk\/web$/, replacement: path.resolve(__dirname, '../plugin-sdk/src/web/index.ts') },
      { find: /^@\//, replacement: path.resolve(__dirname, 'src') + '/' }
    ]
  },
  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: true }
})
