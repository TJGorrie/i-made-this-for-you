// Standalone server for everyday use: `npm start` builds the UI, then serves it and the API from one process.
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { app as api } from './app.ts'

const dist = path.relative(process.cwd(), path.join(import.meta.dirname, '..', 'dist'))
const port = Number(process.env.PORT ?? 5170)

const app = new Hono()
app.route('/', api)
app.use('/*', serveStatic({ root: dist }))

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`Writing tool running at http://127.0.0.1:${port}`))
