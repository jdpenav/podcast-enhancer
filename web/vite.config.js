import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/** Los audios de prueba (public/mock) solo se incluyen en el build si VITE_MOCK=1. */
function dropMockAssets(enabled) {
  let outDir
  return {
    name: 'drop-mock-assets',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      if (enabled) fs.rmSync(path.join(outDir, 'mock'), { recursive: true, force: true })
    },
  }
}

// En desarrollo, /api se redirige al backend Fastify (docs/API.md).
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    plugins: [react(), dropMockAssets(env.VITE_MOCK !== '1')],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: 'http://localhost:3000', changeOrigin: true },
      },
    },
  }
})
