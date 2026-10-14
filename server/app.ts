// HTTP API. Served by the Vite dev server (vite.config.ts) or server/main.ts, both bound to localhost only.
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  atomicWrite, createProject, listProjects, newEntityPath, newId, parseEntity, readEntity, renameWithRetry, slugify, writeEntity, type Entity,
} from './store.ts'
import {
  deletedEntities, historyBytes, historyMaxBytes, listSnapshots, readMeta, readSnapshot, snapshot, writeMeta,
} from './history.ts'
import { localDate, readGoals, recordDay, streak, writeGoals } from './goals.ts'
import { backlinks, indexFile, openIndex, reindexFolder, removePath, resolveLinks, search, stripComments, watchProject } from './indexer.ts'
import { spawnSync } from 'node:child_process'
import { marked } from 'marked'
import { createHash } from 'node:crypto'
import { RESERVED_FIELDS, reviewNotes } from '../src/api.ts'
import { setInline } from './review.ts'
import { locked, packaged, projectsDir, setProjectsDir } from './settings.ts'

// Same as fingerprint() in src/api.ts: sha-256 of the field's JSON.
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex')

let ROOT = projectsDir()
const indexes = new Map<string, { db: DatabaseSync; watcher: fs.FSWatcher }>()
// Manuscript hierarchy: which type each type must sit under.
const PARENT_TYPE: Record<string, string> = { chapter: 'book', scene: 'chapter' }

function project(slug: string) {
  const dir = path.join(ROOT, slug)
  if (!/^[a-z0-9-]+$/.test(slug) || !fs.existsSync(path.join(dir, 'project.json')))
    throw new HTTPException(404, { message: 'No such project' })
  let open = indexes.get(slug)
  if (!open) {
    const db = openIndex(dir)
    open = { db, watcher: watchProject(db, dir) }
    indexes.set(slug, open)
  }
  return { dir, db: open.db }
}

type Row = { id: string; type: string; title: string; path: string }
function row(db: DatabaseSync, id: unknown) {
  const r = db.prepare('select id, type, title, path from entities where id = ?').get(String(id)) as Row | undefined
  if (!r) throw new HTTPException(404, { message: 'No such entity' })
  return r
}

const children = (db: DatabaseSync, parent: string) =>
  db.prepare(`select id, title, path from entities where json_extract(fields, '$.parent') = ?
    order by json_extract(fields, '$.order')`).all(parent) as Row[]

export const app = new Hono().basePath('/api')

// Only this app's own page may call the API. Other websites can't (no cross-site form posts or fetches),
// and neither can a page reached through another hostname that points at this machine (DNS rebinding).
app.use(async (c, next) => {
  const host = c.req.header('host') ?? ''
  const origin = c.req.header('origin')
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (origin && origin !== `http://${host}`))
    throw new HTTPException(403, { message: 'Requests must come from the app itself' })
  await next()
})

// ---- Settings ----

app.get('/settings', (c) => c.json({ projectsDir: ROOT, locked, packaged }))

app.put('/settings', async (c) => {
  if (locked) throw new HTTPException(409, { message: 'The projects folder is set by PROJECTS_DIR' })
  const { projectsDir: dir } = await c.req.json()
  if (typeof dir !== 'string' || !dir.trim()) throw new HTTPException(400, { message: 'Folder required' })
  await setProjectsDir(dir.trim()).catch((e) => { throw new HTTPException(400, { message: e.message }) })
  for (const { db, watcher } of indexes.values()) { watcher.close(); db.close() }
  indexes.clear()
  ROOT = projectsDir()
  return c.json({ projectsDir: ROOT, locked, packaged })
})

// The standalone app has no window of its own to close (on a Mac it runs in the background).
app.post('/quit', (c) => {
  if (!packaged) throw new HTTPException(404, { message: 'Only the standalone app can be quit from here' })
  setTimeout(() => process.exit(0), 100) // after the reply is out
  return c.body(null, 204)
})

app.get('/projects', (c) => c.json(listProjects(ROOT)))

app.post('/projects', async (c) => {
  const { name } = await c.req.json()
  if (!name?.trim()) throw new HTTPException(400, { message: 'Name required' })
  const { slug } = await createProject(ROOT, name.trim()).catch((e) => {
    throw new HTTPException(409, { message: e.message })
  })
  return c.json({ slug }, 201)
})

app.get('/projects/:p', (c) => {
  const { dir } = project(c.req.param('p'))
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  return c.json({ ...read('project.json'), templates: read('templates.json') })
})

app.get('/projects/:p/entities', (c) => {
  const { db } = project(c.req.param('p'))
  const rows = db.prepare('select id, type, title, path, words, fields from entities order by type, title collate nocase').all() as { fields: string }[]
  return c.json(rows.map(({ fields, ...r }) => ({ ...JSON.parse(fields), ...r })))
})

app.get('/projects/:p/entities/:id', (c) => {
  const { dir, db } = project(c.req.param('p'))
  return c.json(readEntity(path.join(dir, row(db, c.req.param('id')).path)))
})

app.get('/projects/:p/entities/:id/backlinks', (c) => {
  const { db } = project(c.req.param('p'))
  return c.json(backlinks(db, c.req.param('id')))
})

app.get('/projects/:p/links', (c) => {
  const { db } = project(c.req.param('p'))
  return c.json(db.prepare('select from_id, to_id from links').all())
})

// Images for maps (and later portraits). Raster only: an SVG served from this origin could run script.
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const MAX_UPLOAD = 50 * 1024 * 1024

app.post('/projects/:p/assets', async (c) => {
  const { dir } = project(c.req.param('p'))
  const name = c.req.query('name') ?? ''
  const ext = path.extname(name).slice(1).toLowerCase()
  if (!IMAGE_TYPES[ext]) throw new HTTPException(400, { message: 'Upload a PNG, JPEG, WebP or GIF image' })
  const data = new Uint8Array(await c.req.arrayBuffer())
  if (!data.length || data.length > MAX_UPLOAD) throw new HTTPException(400, { message: 'Image must be under 50 MB' })
  const base = slugify(path.basename(name, path.extname(name)))
  let file = `${base}.${ext}`
  for (let n = 2; fs.existsSync(path.join(dir, 'assets', file)); n++) file = `${base}-${n}.${ext}`
  await atomicWrite(path.join(dir, 'assets', file), data)
  return c.json({ name: file }, 201)
})

app.get('/projects/:p/assets/:name', (c) => {
  const { dir } = project(c.req.param('p'))
  const name = c.req.param('name')
  const ext = /^[a-z0-9-]+\.([a-z]+)$/.exec(name)?.[1]
  const file = path.join(dir, 'assets', name)
  if (!ext || !IMAGE_TYPES[ext] || !fs.existsSync(file)) throw new HTTPException(404, { message: 'No such image' })
  return c.body(fs.readFileSync(file), 200, { 'content-type': IMAGE_TYPES[ext] })
})

app.get('/projects/:p/search', (c) => {
  const { db } = project(c.req.param('p'))
  return c.json(search(db, c.req.query('q') ?? ''))
})

app.post('/projects/:p/entities', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const e = (await c.req.json()) as Entity
  if (!e.type || !e.title) throw new HTTPException(400, { message: 'type and title required' })
  const manuscript = e.type === 'book' || PARENT_TYPE[e.type]
  const parent = PARENT_TYPE[e.type] ? row(db, e.parent) : undefined
  if (parent && parent.type !== PARENT_TYPE[e.type])
    throw new HTTPException(400, { message: `A ${e.type} must go in a ${PARENT_TYPE[e.type]}` })
  const entity: Entity = { ...e, id: newId() }
  if (manuscript && entity.order === undefined) {
    // Append after the last sibling.
    const max = `select max(json_extract(fields, '$.order')) n from entities where `
    const last = parent
      ? db.prepare(max + `json_extract(fields, '$.parent') = ?`).get(parent.id)
      : db.prepare(max + `type = 'book'`).get()
    entity.order = ((last as { n: number | null }).n ?? 0) + 1
  }
  const rel = newEntityPath(dir, e.type, e.title, parent?.path)
  await writeEntity(dir, rel, entity)
  indexFile(db, dir, rel)
  return c.json(entity, 201)
})

// Merge the given fields into the entity. Fields not sent are kept, so the editor and drag-reorder can't clobber each other.
app.put('/projects/:p/entities/:id', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const id = c.req.param('id')
  const rel = row(db, id).path
  const old = readEntity(path.join(dir, rel))
  const { $base, $snapshot, ...patch } = (await c.req.json()) as Partial<Entity> & { $base?: Record<string, string>; $snapshot?: boolean }
  // $base holds fingerprints of the fields as the editor last saw them. If any changed since (another editor,
  // git, a second tab), refuse instead of silently overwriting; the editor asks the user what to do.
  const conflict = Object.keys($base ?? {}).filter((k) => fingerprint(old[k]) !== $base![k])
  if (conflict.length) return c.json({ conflict, current: old }, 409)
  // Keep the version we're about to replace ($snapshot forces it, e.g. when overwriting an outside edit).
  await snapshot(dir, id, rel, { title: old.title, type: old.type }, { force: !!$snapshot })

  const entity: Entity = { ...old, ...patch, id, type: old.type }
  let target = rel
  if (entity.parent !== old.parent) {
    const parent = row(db, entity.parent)
    if (parent.type !== PARENT_TYPE[old.type])
      throw new HTTPException(400, { message: PARENT_TYPE[old.type] ? `A ${old.type} must go in a ${PARENT_TYPE[old.type]}` : `A ${old.type} can't be moved` })
    if (old.type === 'chapter') {
      // Move the whole chapter folder (scenes included) under the new book, then re-sync the index.
      const from = path.posix.dirname(rel)
      const to = path.posix.dirname(newEntityPath(dir, 'chapter', entity.title, parent.path))
      await renameWithRetry(path.join(dir, from), path.join(dir, to))
      await writeEntity(dir, `${to}/_chapter.md`, entity)
      reindexFolder(db, dir, from)
      reindexFolder(db, dir, to)
      return c.json(entity)
    }
    target = newEntityPath(dir, 'scene', entity.title, parent.path) // keep folders matching the tree
  }
  await writeEntity(dir, target, entity)
  indexFile(db, dir, target)
  if (target !== rel) fs.rmSync(path.join(dir, rel)) // only after the new copy is safely written
  return c.json(entity)
})

// ---- Review: comments and notes as a checklist ----

app.get('/projects/:p/review', (c) => {
  const { db } = project(c.req.param('p'))
  const rows = db.prepare(`select id, review from entities where review != '[]'`).all() as { id: string; review: string }[]
  return c.json(rows.map((r) => ({ id: r.id, items: JSON.parse(r.review) })))
})

// Tick off / re-open / remove one item: { kind: 'passage' | 'note', index, done?, remove? }.
app.patch('/projects/:p/entities/:id/review', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const id = c.req.param('id')
  const rel = row(db, id).path
  const old = readEntity(path.join(dir, rel))
  const { kind, index, done, remove } = await c.req.json()
  if (!Number.isInteger(index)) throw new HTTPException(400, { message: 'index must be a whole number' })
  const entity: Entity = { ...old }
  const missing = () => { throw new HTTPException(404, { message: 'No such review item' }) }
  if (kind === 'passage') entity.body = setInline(old.body, index, { done: !!done, remove: !!remove }) ?? missing()
  else if (kind === 'note') {
    const notes = reviewNotes(old.review)
    if (!notes[index]) missing()
    entity.review = remove ? notes.filter((_, i) => i !== index) : notes.map((n, i) => (i === index ? { ...n, done: !!done } : n))
  } else throw new HTTPException(400, { message: 'kind must be passage or note' })
  await snapshot(dir, id, rel, { title: old.title, type: old.type })
  await writeEntity(dir, rel, entity)
  indexFile(db, dir, rel)
  return c.json(entity)
})

app.delete('/projects/:p/entities/:id', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const { id, type, title, path: rel } = row(db, c.req.param('id'))
  if (children(db, id).length) throw new HTTPException(409, { message: `Delete what's inside this ${type} first` })
  // Always keep a last copy so it can be restored from "Deleted items".
  await snapshot(dir, id, rel, { title, type }, { force: true })
  await writeMeta(dir, id, { path: rel, title, type, deletedAt: Date.now() })
  fs.rmSync(path.join(dir, rel), { force: true })
  removePath(db, rel)
  // Remove the now-empty folder; leave it if the user keeps other files in there.
  if (type === 'book' || type === 'chapter') try { fs.rmdirSync(path.join(dir, path.dirname(rel))) } catch {}
  return c.body(null, 204)
})

// ---- Version history ----

const exists = (db: DatabaseSync, id: string) => !!db.prepare('select 1 from entities where id = ?').get(id)
const safeId = (id: string) => {
  if (!/^[\w-]+$/.test(id)) throw new HTTPException(400, { message: 'Bad id' }) // ids become folder names under .history
  return id
}
const safeTs = (ts: string) => {
  if (!/^\d+$/.test(ts)) throw new HTTPException(400, { message: 'Bad version' })
  return Number(ts)
}
function readVersion(dir: string, id: string, ts: number) {
  try { return parseEntity(readSnapshot(dir, id, ts)) } catch { throw new HTTPException(404, { message: 'No such version' }) }
}

app.get('/projects/:p/history', (c) => {
  const { dir, db } = project(c.req.param('p'))
  return c.json({ bytes: historyBytes(dir), maxBytes: historyMaxBytes(dir), deleted: deletedEntities(dir, (id) => exists(db, id)) })
})

app.get('/projects/:p/entities/:id/history', (c) => {
  const { dir } = project(c.req.param('p'))
  return c.json(listSnapshots(dir, safeId(c.req.param('id'))))
})

app.get('/projects/:p/entities/:id/history/:ts', (c) => {
  const { dir } = project(c.req.param('p'))
  return c.json(readVersion(dir, safeId(c.req.param('id')), safeTs(c.req.param('ts'))))
})

// Restore a version. The current text is saved as a version first, so a restore can itself be undone.
// A deleted entity comes back under its old parent if that still exists (otherwise it shows as unfiled).
app.post('/projects/:p/entities/:id/history/:ts/restore', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const id = safeId(c.req.param('id'))
  const version = readVersion(dir, id, safeTs(c.req.param('ts')))
  let rel: string
  let entity: Entity
  if (exists(db, id)) {
    rel = row(db, id).path
    const cur = readEntity(path.join(dir, rel))
    await snapshot(dir, id, rel, { title: cur.title, type: cur.type }, { force: true })
    entity = { ...version, id, type: cur.type, parent: cur.parent, order: cur.order } // keep its place in the tree
  } else {
    const meta = readMeta(dir, id)
    const parent = version.parent && exists(db, String(version.parent)) ? row(db, version.parent) : undefined
    entity = { ...version, id, parent: parent?.id }
    if (!parent) delete entity.parent
    rel = parent ? newEntityPath(dir, version.type, version.title, parent.path)
      : meta && !fs.existsSync(path.join(dir, meta.path)) && !PARENT_TYPE[version.type] ? meta.path
      : newEntityPath(dir, version.type, version.title)
    if (meta) await writeMeta(dir, id, { path: rel, title: version.title, type: version.type })
  }
  await writeEntity(dir, rel, entity)
  indexFile(db, dir, rel)
  return c.json(entity)
})

// ---- Templates ----

const FIELD_SPEC = /^([^:\s][^:]*?)(?::([\w-]+|\*)(\[\])?)?$/

app.put('/projects/:p/templates', async (c) => {
  const { dir } = project(c.req.param('p'))
  const t = await c.req.json()
  const bad = (message: string) => { throw new HTTPException(400, { message }) }
  if (!t || typeof t !== 'object' || Array.isArray(t)) bad('Expected an object of types')
  for (const [type, fields] of Object.entries(t)) {
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(type)) bad(`Bad type name "${type}"`)
    if (!Array.isArray(fields)) bad(`Fields of "${type}" must be a list`)
    const names = (fields as unknown[]).map((f) => {
      const m = typeof f === 'string' ? FIELD_SPEC.exec(f) : null
      if (!m) return bad(`Bad field "${f}" in "${type}"`)
      if (RESERVED_FIELDS.includes(m[1])) bad(`"${m[1]}" is used by the app itself; pick another field name`)
      return m[1]
    })
    if (new Set(names).size !== names.length) bad(`Duplicate field name in "${type}"`)
  }
  await atomicWrite(path.join(dir, 'templates.json'), JSON.stringify(t, null, 2))
  return c.json(t)
})

// ---- Goals ----

app.get('/projects/:p/stats', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const total = (db.prepare(`select coalesce(sum(words), 0) n from entities where type = 'scene'`).get() as { n: number }).n
  const g = readGoals(dir)
  const date = localDate()
  if (recordDay(g, date, total)) await writeGoals(dir, g)
  const days = Object.entries(g.days).sort().map(([date, d]) => ({ date, words: d.end - d.start }))
  return c.json({ total, today: total - g.days[date].start, daily: g.daily ?? null, streak: streak(g, date), days })
})

app.put('/projects/:p/goals', async (c) => {
  const { dir } = project(c.req.param('p'))
  const { daily } = await c.req.json()
  if (daily !== null && !(Number.isInteger(daily) && daily > 0)) throw new HTTPException(400, { message: 'Daily goal must be a positive whole number' })
  const g = readGoals(dir)
  g.daily = daily ?? undefined
  await writeGoals(dir, g)
  return c.json({ daily: g.daily ?? null })
})

// Whole book: chapters as headings, scenes separated by * * *, comments and link markup removed.
// ?format=md (default) | html (printable: the browser's "Save as PDF") | docx | epub (these two need pandoc).
const EXPORT_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
}

app.get('/projects/:p/books/:id/compile', (c) => {
  const { dir, db } = project(c.req.param('p'))
  const book = row(db, c.req.param('id'))
  let md = `# ${book.title}\n`
  for (const ch of children(db, book.id)) {
    const scenes = children(db, ch.id).map((s) => resolveLinks(db, stripComments(readEntity(path.join(dir, s.path)).body)).trim())
    md += `\n## ${ch.title}\n\n${scenes.join('\n\n* * *\n\n')}\n`
  }
  const name = slugify(book.title)
  const format = c.req.query('format') ?? 'md'
  if (format === 'md')
    return c.text(md, 200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${name}.md"` })
  if (format === 'html') {
    const title = book.title.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`)
    return c.html(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:12pt/1.6 Georgia,serif;max-width:36em;margin:2em auto;padding:0 1em}h2{break-before:page}hr{border:0;text-align:center}hr::after{content:'* * *'}</style>
${marked.parse(md, { async: false })}<script>print()</script>`)
  }
  if (!EXPORT_TYPES[format]) throw new HTTPException(400, { message: 'Unknown format' })
  // ponytail: synchronous pandoc call blocks the server during conversion (a second or two for a novel); fine for one user.
  const out = spawnSync('pandoc', ['-f', 'markdown', '-t', format, '-o', '-', '--metadata', `title=${book.title}`],
    { input: md, maxBuffer: 512 * 1024 * 1024 })
  if (out.error) throw new HTTPException(501, { message: 'Word and EPUB export need pandoc: install it from pandoc.org, then restart the app.' })
  if (out.status !== 0) throw new HTTPException(500, { message: `pandoc failed: ${out.stderr}` })
  return c.body(out.stdout, 200, { 'content-type': EXPORT_TYPES[format], 'content-disposition': `attachment; filename="${name}.${format}"` })
})

// Timeline calendar: month names and an era label, stored in project.json.
app.put('/projects/:p/calendar', async (c) => {
  const { dir } = project(c.req.param('p'))
  const { months, era } = await c.req.json()
  if (!Array.isArray(months) || !months.every((m) => typeof m === 'string' && m.trim()) || typeof era !== 'string')
    throw new HTTPException(400, { message: 'Expected month names and an era label' })
  const file = path.join(dir, 'project.json')
  const p = JSON.parse(fs.readFileSync(file, 'utf8'))
  p.calendar = { months: months.map((m: string) => m.trim()), era: era.trim() }
  await atomicWrite(file, JSON.stringify(p, null, 2))
  return c.json(p.calendar)
})
