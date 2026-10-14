import { defineConfig } from 'vite'
import { getRequestListener } from '@hono/node-server'
import { app } from './server/app.ts'

// One process: Vite serves the UI, the Hono app handles /api. Restart `npm run dev` after editing server/.
export default defineConfig({
  server: { host: '127.0.0.1', watch: { ignored: ['**/projects/**'] } },
  plugins: [
    {
      name: 'api',
      configureServer(server) {
        const api = getRequestListener(app.fetch)
        server.middlewares.use((req, res, next) => (req.url?.startsWith('/api/') ? api(req, res) : next()))
      },
    },
  ],
})
