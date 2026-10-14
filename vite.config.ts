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
        // Node closes idle keep-alive connections after 5s, which can race a client reusing one (ECONNRESET in tests).
        if (server.httpServer) (server.httpServer as import('node:http').Server).keepAliveTimeout = 60_000
        server.middlewares.use((req, res, next) => (req.url?.startsWith('/api/') ? api(req, res) : next()))
      },
    },
  ],
})
