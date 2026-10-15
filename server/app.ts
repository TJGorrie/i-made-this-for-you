// HTTP API. Served by the Vite dev server (vite.config.ts) or server/main.ts, both bound to localhost only.
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  atomicWrite, createProject, listProjects, newEntityPath, newId, parseEntity, projectFiles, readEntity, renameWithRetry, restoreProject, slugify,
  writeEntity, type Entity,
} from './store.ts'
import {
  deletedEntities, historyBytes, historyMaxBytes, listSnapshots, readMeta, readSnapshot, snapshot, writeMeta,
} from './history.ts'
import { goalsTurn, localDate, projection, readGoals, recordDay, streak, writeGoals } from './goals.ts'
import {
  aliasRenames, backlinks, countWords, findPattern, indexFile, openIndex, proseMatches, reindexFolder, removePath, renameAliasLinks, resolveLinks,
  search, spliceMatches, stripComments, watchProject,
} from './indexer.ts'
import { marked } from 'marked'
import { createHash } from 'node:crypto'
import { aliasesOf, fieldText, RESERVED_FIELDS, reviewNotes, descriptions, speakerLines, stripTags } from '../src/api.ts'
import { setInline } from './review.ts'
import { docx, docxToMarkdown, epub, importMarkdown, langOf, unzip, zip, type Book } from './export.ts'
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

// A backup is restored as a new project, never over an existing one.
const MAX_BACKUP = 2 * 1024 ** 3
app.post('/projects/restore', async (c) => {
  const data = Buffer.from(await c.req.arrayBuffer())
  if (!data.length || data.length > MAX_BACKUP) throw new HTTPException(400, { message: 'Backup must be under 2 GB' })
  try {
    return c.json({ slug: await restoreProject(ROOT, unzip(data)) }, 201)
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message })
  }
})

app.get('/projects/:p', (c) => {
  const { dir } = project(c.req.param('p'))
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  return c.json({ ...read('project.json'), templates: read('templates.json') })
})

// The whole project folder as a zip, version history included (the index is rebuilt on open, so it's left out).
app.get('/projects/:p/backup', (c) => {
  const slug = c.req.param('p')
  const { dir } = project(slug)
  return c.body(new Uint8Array(zip(projectFiles(dir))), 200,
    { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${slug}-backup-${localDate()}.zip"` })
})

// Find & replace in every entry's text (links and comment notes are left alone). Without `apply` it only counts.
// Each changed file keeps a version first, so a replace can be undone from History.
app.post('/projects/:p/replace', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const { find, replace = '', matchCase, wholeWord, apply } = await c.req.json()
  if (typeof find !== 'string' || !find || typeof replace !== 'string') throw new HTTPException(400, { message: 'Expected find and replace text' })
  const re = findPattern(find, { matchCase: !!matchCase, wholeWord: !!wholeWord })
  const out = []
  for (const r of db.prepare('select id, type, title, path from entities order by type, title collate nocase').all() as Row[]) {
    const old = readEntity(path.join(dir, r.path))
    const hits = proseMatches(old.body ?? '', re)
    if (!hits.length) continue
    out.push({ id: r.id, type: r.type, title: r.title, count: hits.length })
    if (!apply) continue
    await snapshot(dir, r.id, r.path, { title: old.title, type: old.type }, { force: true })
    await writeEntity(dir, r.path, { ...old, body: spliceMatches(old.body, hits, () => replace) })
    indexFile(db, dir, r.path)
  }
  return c.json(out)
})

// Unlinked mentions: the entry's title or an alias written as plain text in other entries (whole words, any case).
// Candidates come from the full-text index, then each file is checked for matches outside links and comment notes.
const namesOf = (dir: string, r: Row) => [r.title, ...aliasesOf(readEntity(path.join(dir, r.path)).aliases)]

app.get('/projects/:p/entities/:id/unlinked', (c) => {
  const { dir, db } = project(c.req.param('p'))
  const r = row(db, c.req.param('id'))
  const names = namesOf(dir, r)
  const re = findPattern(names, { wholeWord: true })
  const ids = new Set(names.flatMap((n) => (search(db, n) as { id: string }[]).map((h) => h.id)))
  ids.delete(r.id)
  return c.json([...ids].map((id) => row(db, id)).flatMap((s) => {
    const body = readEntity(path.join(dir, s.path)).body ?? ''
    return proseMatches(body, re).map((m, index) => ({
      id: s.id, type: s.type, title: s.title, index, text: m.text,
      // ~60 characters either side, cut at a word.
      before: m.at > 60 ? body.slice(m.at - 60, m.at).replace(/^\S*\s/, '') : body.slice(0, m.at),
      after: body.slice(m.at + m.text.length).replace(/^([\s\S]{60}\S*)[\s\S]*$/, '$1'),
    }))
  }))
})

// Link one unlinked mention: { scene, index } (the index-th match in that entry) becomes [[text|id]].
app.patch('/projects/:p/entities/:id/unlinked', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const id = c.req.param('id')
  const { scene, index } = await c.req.json()
  if (!Number.isInteger(index) || scene === id) throw new HTTPException(400, { message: 'Expected another entry and a match index' })
  const s = row(db, scene)
  const old = readEntity(path.join(dir, s.path))
  const hit = proseMatches(old.body ?? '', findPattern(namesOf(dir, row(db, id)), { wholeWord: true }))[index]
  if (!hit) throw new HTTPException(404, { message: 'That mention is gone (the text changed); reload the list' })
  await snapshot(dir, s.id, s.path, { title: old.title, type: old.type }, { force: true })
  await writeEntity(dir, s.path, { ...old, body: spliceMatches(old.body, [hit], (m) => `[[${m.text}|${id}]]`) })
  indexFile(db, dir, s.path)
  return c.body(null, 204)
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

// What the text says about this entry, from every entry whose text links to it: scenes in reading order, then the rest.
// lines: dialogue tagged with it as the speaker, by scene. descriptions: passages describing its properties
// ({^grey eyes^}{#[[Ana|id]]:eyes}); index: nth description in that text.
app.get('/projects/:p/entities/:id/tagged', (c) => {
  const { dir, db } = project(c.req.param('p'))
  const id = c.req.param('id')
  const from = new Set((db.prepare(`select distinct from_id from links where to_id = ? and field = 'body'`).all(id) as { from_id: string }[]).map((l) => l.from_id))
  const books = db.prepare(`select id from entities where type = 'book' order by json_extract(fields, '$.order')`).all() as { id: string }[]
  const scenes = new Set(books.flatMap((b) => children(db, b.id).flatMap((ch) => children(db, ch.id).map((s) => s.id))))
  const bodies = [...[...scenes].filter((s) => from.has(s)), ...[...from].filter((f) => !scenes.has(f))]
    .map((f) => row(db, f)).map((s) => ({ id: s.id, title: s.title, body: readEntity(path.join(dir, s.path)).body ?? '' }))
  return c.json({
    lines: bodies.map((s) => ({ id: s.id, title: s.title, lines: speakerLines(s.body).filter((l) => l.id === id).map((l) => l.text) }))
      .filter((s) => s.lines.length),
    descriptions: bodies.flatMap((s) => descriptions(s.body).filter((d) => d.id === id)
      .map((d) => ({ from: s.id, fromTitle: s.title, prop: d.prop, text: d.text, index: d.index }))),
  })
})

app.get('/projects/:p/links', (c) => {
  const { db } = project(c.req.param('p'))
  return c.json(db.prepare('select from_id, to_id, field from links').all())
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
  return c.json(await createEntity(dir, db, (await c.req.json()) as Entity), 201)
})

async function createEntity(dir: string, db: DatabaseSync, e: { type: string; title: string; body: string; [field: string]: unknown }) {
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
  return entity
}

// A manuscript from elsewhere (.md / .txt / .docx) becomes a new book: chapters and scenes as importMarkdown splits it.
// Scenes are titled "Scene 1", "Scene 2"... within each chapter.
app.post('/projects/:p/import', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const name = c.req.query('name') ?? ''
  const ext = path.extname(name).toLowerCase()
  const data = Buffer.from(await c.req.arrayBuffer())
  if (!data.length || data.length > MAX_UPLOAD) throw new HTTPException(400, { message: 'File must be under 50 MB' })
  let md: string
  try {
    if (ext === '.docx') md = docxToMarkdown(data)
    else if (['.md', '.markdown', '.txt'].includes(ext)) md = data.toString('utf8').replace(/^﻿/, '')
    else throw new Error('Import a Word (.docx), Markdown (.md) or text (.txt) file')
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message })
  }
  const book = importMarkdown(md, path.basename(name, ext) || 'Imported book')
  if (!book.chapters.length) throw new HTTPException(400, { message: 'That file has no text to import' })
  const b = await createEntity(dir, db, { type: 'book', title: book.title, body: '' })
  for (const ch of book.chapters) {
    const chapter = await createEntity(dir, db, { type: 'chapter', title: ch.title, parent: b.id, body: '' })
    for (const [n, body] of ch.scenes.entries())
      await createEntity(dir, db, { type: 'scene', title: `Scene ${n + 1}`, parent: chapter.id, body: body + '\n' })
  }
  return c.json(b, 201)
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
  // A renamed alias: links written as the old one take the new one everywhere (each changed file keeps a version first).
  const renames = 'aliases' in patch ? aliasRenames(old.aliases, entity.aliases) : new Map()
  for (const from of renames.size ? new Set((backlinks(db, id) as Row[]).map((r) => r.id)) : []) {
    if (from === id) continue // this entry's own text is with the editor
    const r = row(db, from)
    const e = readEntity(path.join(dir, r.path))
    const renamed = renameAliasLinks(e, id, renames) as Entity
    if (JSON.stringify(renamed) === JSON.stringify(e)) continue
    await snapshot(dir, r.id, r.path, { title: e.title, type: e.type }, { force: true })
    await writeEntity(dir, r.path, renamed)
    indexFile(db, dir, r.path)
  }
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
  const date = localDate()
  const g = await goalsTurn(async () => { const g = readGoals(dir); if (recordDay(g, date, total)) await writeGoals(dir, g); return g })
  const days = Object.entries(g.days).sort().map(([date, d]) => ({ date, words: d.end - d.start }))
  // Words still to write: the books' targets, against everything written so far.
  const target = (db.prepare(`select fields from entities where type = 'book'`).all() as { fields: string }[])
    .reduce((n, b) => n + (parseInt(String(JSON.parse(b.fields).target ?? ''), 10) || 0), 0)
  return c.json({
    total, today: total - g.days[date].start, daily: g.daily ?? null, streak: streak(g, date), days, sprints: g.sprints ?? [],
    deadline: g.deadline ?? null, target, ...projection(g, date, total, target),
  })
})

app.post('/projects/:p/sprints', async (c) => {
  const { dir } = project(c.req.param('p'))
  const { at, minutes, words } = await c.req.json()
  if (![at, minutes, words].every(Number.isFinite) || minutes <= 0) throw new HTTPException(400, { message: 'Expected at, minutes and words' })
  return c.json(await goalsTurn(async () => {
    const g = readGoals(dir)
    g.sprints = [...(g.sprints ?? []), { at, minutes, words }]
    await writeGoals(dir, g)
    return g.sprints
  }), 201)
})

app.put('/projects/:p/goals', async (c) => {
  const { dir } = project(c.req.param('p'))
  // Either or both: { daily: n | null } and { deadline: 'YYYY-MM-DD' | null }. A field not sent is kept.
  const body = await c.req.json()
  if ('daily' in body && body.daily !== null && !(Number.isInteger(body.daily) && body.daily > 0))
    throw new HTTPException(400, { message: 'Daily goal must be a positive whole number' })
  if ('deadline' in body && body.deadline !== null && !(typeof body.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.deadline)))
    throw new HTTPException(400, { message: 'Deadline must be a date like 2027-03-01' })
  const g = await goalsTurn(async () => {
    const g = readGoals(dir)
    if ('daily' in body) g.daily = body.daily ?? undefined
    if ('deadline' in body) g.deadline = body.deadline ?? undefined
    await writeGoals(dir, g)
    return g
  })
  return c.json({ daily: g.daily ?? null, deadline: g.deadline ?? null })
})

// Whole book: chapters as headings, scenes separated by * * *, comments and link markup removed.
// ?format=md (default) | html (printable: the browser's "Save as PDF") | read (one web page for beta readers)
// | docx | submission (Word in standard manuscript format) | review (Word, comments kept as Word comments)
// | epub (written by server/export.ts) | scenes (JSON: each scene's text and POV, for the app's own views).
// The book's dedication gets a page after the title, acknowledgements come last.
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const EXPORTS: Record<string, [type: string, ext: string, write: (b: Book) => Buffer]> = {
  docx: [DOCX, 'docx', (b) => docx(b)],
  submission: [DOCX, 'docx', (b) => docx(b, true)],
  review: [DOCX, 'docx', (b) => docx(b)],
  epub: ['application/epub+zip', 'epub', epub],
}

function compile(dir: string, db: DatabaseSync, id: string, keepComments = false) {
  const book = row(db, id)
  const entity = readEntity(path.join(dir, book.path))
  // Each scene as written (links resolved), with its POV link and tagged dialogue, for per-scene views like dialogue by speaker.
  const list = children(db, book.id).flatMap((ch) => children(db, ch.id).map((s) => {
    const e = readEntity(path.join(dir, s.path))
    const body = stripTags(e.body)
    return { id: s.id, chapterId: ch.id, chapter: ch.title, title: s.title, pov: fieldText(e.pov), lines: speakerLines(e.body),
      body: resolveLinks(db, keepComments ? body : stripComments(body)).trim() }
  }))
  const chapters = children(db, book.id).map((ch) => ({ title: ch.title, scenes: list.filter((s) => s.chapterId === ch.id).map((s) => s.body) }))
  const [dedication, acknowledgements] = [fieldText(entity.dedication).trim(), fieldText(entity.acknowledgements).trim()]
  const body = chapters.map((ch) => `\n## ${ch.title}\n\n${ch.scenes.join('\n\n* * *\n\n')}\n`).join('')
  const md = `# ${book.title}\n${dedication ? `\n${dedication}\n` : ''}${body}${acknowledgements ? `\n## Acknowledgements\n\n${acknowledgements}\n` : ''}`
  return { book, entity, list, chapters, dedication, acknowledgements, body, md }
}

// ---- Drafts: the compiled book saved as plain Markdown in drafts/<book folder>/<date>-<name>.md ----

const draftsDir = (dir: string, bookPath: string) => path.join(dir, 'drafts', path.posix.basename(path.posix.dirname(bookPath)))

app.get('/projects/:p/books/:id/drafts', (c) => {
  const { dir, db } = project(c.req.param('p'))
  const d = draftsDir(dir, row(db, c.req.param('id')).path)
  return c.json(fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.md')).sort().reverse() : [])
})

app.post('/projects/:p/books/:id/drafts', async (c) => {
  const { dir, db } = project(c.req.param('p'))
  const { name } = await c.req.json()
  if (typeof name !== 'string' || !name.trim()) throw new HTTPException(400, { message: 'Name the draft' })
  const { book, md } = compile(dir, db, c.req.param('id'))
  const d = draftsDir(dir, book.path)
  const base = `${localDate()}-${slugify(name)}`
  let file = `${base}.md`
  for (let n = 2; fs.existsSync(path.join(d, file)); n++) file = `${base}-${n}.md`
  await atomicWrite(path.join(d, file), md)
  return c.json({ file }, 201)
})

app.get('/projects/:p/books/:id/drafts/:file', (c) => {
  const { dir, db } = project(c.req.param('p'))
  const file = c.req.param('file')
  const full = path.join(draftsDir(dir, row(db, c.req.param('id')).path), file)
  if (!/^[\w-]+\.md$/.test(file) || !fs.existsSync(full)) throw new HTTPException(404, { message: 'No such draft' })
  return c.text(fs.readFileSync(full, 'utf8'))
})

// Beta-reader page: a contents list, comfortable reading width, light/dark, no app needed to open it.
const READ_CSS = `:root{color-scheme:light dark}body{font:19px/1.7 Georgia,serif;max-width:34em;margin:3em auto;padding:0 1.2em;
background:light-dark(#fbfaf7,#1b1d1f);color:light-dark(#222,#ddd)}h1{text-align:center;font-size:2.2em}h2{margin-top:3em;text-align:center}
nav{margin:2em 0 4em}nav ol{padding-left:1.4em}a{color:light-dark(#2a5d9f,#8ab4f8)}hr{border:0;text-align:center;margin:2em 0}hr::after{content:'* * *'}`

app.get('/projects/:p/books/:id/compile', (c) => {
  const { dir, db } = project(c.req.param('p'))
  const format = c.req.query('format') ?? 'md'
  const { book, entity, list, chapters, dedication, acknowledgements, body, md } = compile(dir, db, c.req.param('id'), format === 'review')
  const name = slugify(book.title)
  const lang = langOf(fieldText(entity.language))
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`)
  const html = (md: string) => marked.parse(md, { async: false })
  const front = dedication ? `<section class="dedication">${html(dedication)}</section>\n` : ''
  const back = acknowledgements ? `<h2 id="ack">Acknowledgements</h2>\n${html(acknowledgements)}\n` : ''
  if (format === 'scenes') return c.json(list.map(({ chapterId, ...s }) => s))
  if (format === 'md')
    return c.text(md, 200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${name}.md"` })
  if (format === 'html') {
    return c.html(`<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>${esc(book.title)}</title>
<style>body{font:12pt/1.6 Georgia,serif;max-width:36em;margin:2em auto;padding:0 1em}h2{break-before:page}hr{border:0;text-align:center}hr::after{content:'* * *'}
.dedication{break-before:page;padding-top:30vh;text-align:center;font-style:italic}</style>
<h1>${esc(book.title)}</h1>\n${front}${html(body)}${back}<script>print()</script></html>`)
  }
  if (format === 'read') {
    const toc = [...chapters.map((ch, n) => `<li><a href="#ch${n + 1}">${esc(ch.title)}</a></li>`), ...(back ? ['<li><a href="#ack">Acknowledgements</a></li>'] : [])]
    let page = `<h1>${esc(book.title)}</h1>\n${front}<nav><ol>${toc.join('')}</ol></nav>\n`
    chapters.forEach((ch, n) => { page += `<h2 id="ch${n + 1}">${esc(ch.title)}</h2>\n${html(ch.scenes.join('\n\n* * *\n\n'))}\n` })
    return c.body(`<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(book.title)}</title><style>${READ_CSS}</style>\n${page}${back}</html>`, 200,
      { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${name}.html"` })
  }
  if (!EXPORTS[format]) throw new HTTPException(400, { message: 'Unknown format' })
  const [type, ext, write] = EXPORTS[format]
  // Submissions quote the length rounded to the nearest hundred, as is customary.
  const words = Math.round(chapters.flatMap((ch) => ch.scenes).reduce((n, s) => n + countWords(s), 0) / 100) * 100
  // The cover: an uploaded image in assets/ (EPUB only).
  const coverFile = fieldText(entity.cover)
  const coverType = IMAGE_TYPES[path.extname(coverFile).slice(1).toLowerCase()]
  const coverPath = path.join(dir, 'assets', path.basename(coverFile))
  const cover = coverType && fs.existsSync(coverPath) ? { file: coverFile, type: coverType, data: fs.readFileSync(coverPath) } : undefined
  const out = write({ title: book.title, chapters, author: fieldText(entity.author), words, dedication, acknowledgements, language: lang, cover })
  const suffix = format === 'submission' || format === 'review' ? `-${format}` : ''
  return c.body(new Uint8Array(out), 200, { 'content-type': type, 'content-disposition': `attachment; filename="${name}${suffix}.${ext}"` })
})

// Set one key of project.json, returning its new value.
async function setProjectKey(dir: string, key: string, value: unknown) {
  const file = path.join(dir, 'project.json')
  await atomicWrite(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), [key]: value }, null, 2))
  return value
}

// Prose stats / Highlight word lists: { check, notAdverbs }, stored in project.json as `words`.
app.put('/projects/:p/words', async (c) => {
  const { dir } = project(c.req.param('p'))
  const { check, notAdverbs } = await c.req.json()
  const list = (v: unknown) => Array.isArray(v) && v.every((w) => typeof w === 'string')
  if (!list(check) || !list(notAdverbs)) throw new HTTPException(400, { message: 'Expected two lists of words' })
  const clean = (ws: string[]) => [...new Set(ws.map((w) => w.trim().replace(/\s+/g, ' ')).filter(Boolean))]
  return c.json(await setProjectKey(dir, 'words', { check: clean(check), notAdverbs: clean(notAdverbs) }))
})

// Timeline calendar: month names and an era label, stored in project.json.
app.put('/projects/:p/calendar', async (c) => {
  const { dir } = project(c.req.param('p'))
  const { months, era } = await c.req.json()
  if (!Array.isArray(months) || !months.every((m) => typeof m === 'string' && m.trim()) || typeof era !== 'string')
    throw new HTTPException(400, { message: 'Expected month names and an era label' })
  return c.json(await setProjectKey(dir, 'calendar', { months: months.map((m: string) => m.trim()), era: era.trim() }))
})
