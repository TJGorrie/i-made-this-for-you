// Standalone server for everyday use: `npm start` builds the UI, then serves it and the API from one process.
// Also the entry point of the standalone app (scripts/build-app.ts), where the UI is embedded in the executable.
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getAsset } from 'node:sea'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { app as api } from './app.ts'
import { packaged } from './settings.ts'

const port = Number(process.env.PORT ?? 5170)
const url = `http://127.0.0.1:${port}`

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', json: 'application/json',
}

const app = new Hono()
app.route('/', api)
if (packaged) {
  app.get('/*', (c) => {
    const file = c.req.path === '/' ? 'index.html' : c.req.path.slice(1)
    try {
      return c.body(new Uint8Array(getAsset(file)), 200, { 'content-type': TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream' })
    } catch {
      return c.notFound()
    }
  })
} else {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), path.join(import.meta.dirname, '..', 'dist')) }))
}

const openBrowser = () => {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Writing tool running at ${url}`)
  if (packaged) {
    console.log('Keep this window open while you write; use Quit on the projects page (or close this window) to stop.')
    openBrowser()
  }
})
// Started twice (double-clicked again): the app is already running, so just show it.
// ponytail: assumes whatever holds the port is this app; a setting for the port if that ever clashes.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE' || !packaged) throw err
  openBrowser()
  setTimeout(() => process.exit(0), 500)
})
