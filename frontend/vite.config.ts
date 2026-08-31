import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

export default defineConfig(({ mode }) => {
  // The repo root's .env, the same file app.py reads -- so the key, host and port are
  // configured in one place. The '' prefix disables Vite's default VITE_ filter, which
  // would otherwise hide every variable in that file.
  const env = loadEnv(mode, repoRoot, '')

  const apiKey = env.API_KEY ?? ''
  const target = `http://${env.HOST || '127.0.0.1'}:${env.PORT || 5000}`

  if (!apiKey) {
    // Without this the first symptom is a 500 carrying "Server is not configured for
    // authentication" -- true, but it points at the API rather than at this file.
    console.warn(
      `\n[sigma] API_KEY is empty in ${path.join(repoRoot, '.env')}.` +
        '\n[sigma] Every /api request will come back 401/500 until it is set.\n',
    )
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        // The browser calls same-origin /api/*; the key is attached here, on the server
        // side of the dev server, and never enters the bundle. See auth.py -- a shared
        // key shipped to a browser is readable in DevTools, so it is not a secret.
        // This is a dev-only bridge, replaced by session auth rather than extended.
        '/api': {
          target,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) proxyReq.setHeader('X-API-Key', apiKey)
            })
          },
        },
      },
    },
  }
})
