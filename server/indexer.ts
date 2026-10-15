// SQLite index: a derived cache of the Markdown files. Safe to delete; rebuilt on every open.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readEntity, STALE_TMP, type Entity } from './store.ts'
import { reviewItems } from './review.ts'
import { aliasesOf, linkText, stripTags } from '../src/api.ts'

const CONTENT_DIRS = ['manuscript', 'wiki']
const toRel = (p: string) => p.split(path.sep).join('/')

const LINK = /\[\[([^\]|]*)\|([^\]]+)\]\]/g

// A link from this entity, tagged with the field it lives in ('body', 'pov', 'appears', 'relationships', 'pins', ...)
// so backlinks can say *how* something is referenced. label = relationship kind ("brother of").
export type Link = { to: string; field: string; label?: string }

export function linkTargets(e: Entity): Link[] {
  const { id, type, title, relationships, pins, ...rest } = e
  const links: Link[] = [
    ...Object.entries(rest).flatMap(([field, v]) =>
      [...JSON.stringify(v ?? null).matchAll(LINK)].map((m) => ({ to: m[2], field }))),
    ...((relationships as { to: string; kind?: string }[]) ?? []).map((r) => ({ to: r.to, field: 'relationships', label: r.kind || undefined })),
    ...((pins as { entity: string }[]) ?? []).map((p) => ({ to: p.entity, field: 'pins' })),
  ]
  // One row per (target, field, label).
  return [...new Map(links.filter((l) => l.to).map((l) => [`${l.to}\0${l.field}\0${l.label ?? ''}`, l])).values()]
}

const stripLinks = (md: string) => md.replace(LINK, '$1')
// Inline comments ({==text==}{>>note<<}, see src/comment.ts) → just the text. Notes aren't manuscript.
export const stripComments = (md: string) => md.replace(/\{==([\s\S]+?)==\}\{>>[\s\S]*?<<\}/g, '$1')
export const countWords = (md: string) => stripLinks(stripComments(stripTags(md))).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0

// Find & replace and unlinked mentions only look at the prose itself: never inside a [[link]], a comment's note
// or a description's property name.
const PROTECTED = /\{#\[\[[^\]|]*\|[^\]]+\]\]:[^}]*\}|\[\[[^\]|]*\|[^\]]+\]\]|\{>>[\s\S]*?<<\}/g
export type Match = { at: number; text: string }

// Literal text as a pattern (any of several, longest first); wholeWord: not part of a longer word.
export function findPattern(find: string | string[], { matchCase = false, wholeWord = false } = {}) {
  const alts = [find].flat().filter(Boolean).sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const any = `(?:${alts.join('|')})`
  return new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])${any}(?![\\p{L}\\p{N}_])` : any, matchCase ? 'gu' : 'giu')
}

export function proseMatches(body: string, re: RegExp): Match[] {
  const out: Match[] = []
  let from = 0
  const scan = (to: number) => { for (const m of body.slice(from, to).matchAll(re)) if (m[0]) out.push({ at: from + m.index, text: m[0] }) }
  for (const p of body.matchAll(PROTECTED)) { scan(p.index); from = p.index + p[0].length }
  scan(body.length)
  return out
}

// Rewrite the given matches (in order, from proseMatches) with `to(match)`.
export function spliceMatches(body: string, matches: Match[], to: (m: Match) => string) {
  let out = '', from = 0
  for (const m of matches) { out += body.slice(from, m.at) + to(m); from = m.at + m.text.length }
  return out + body.slice(from)
}

// Links → the linked entity's current title, or the alias they were written as (stored text if it was deleted).
export function resolveLinks(db: DatabaseSync, md: string) {
  const get = db.prepare('select title, fields from entities where id = ?')
  return md.replace(LINK, (_, stored: string, id: string) => {
    const r = get.get(id) as { title: string; fields: string } | undefined
    return r ? linkText(stored, r.title, aliasesOf(JSON.parse(r.fields).aliases)) : stored
  })
}

// .md files under a project-relative folder, as project-relative paths.
// On open (no saves in flight yet) it also deletes temp files left by a write that was cut short.
function mdFiles(dir: string, relDir: string, cleanTmp = false) {
  const abs = path.join(dir, relDir)
  if (!fs.existsSync(abs)) return []
  return (fs.readdirSync(abs, { recursive: true }) as string[]).flatMap((f) => {
    if (cleanTmp && STALE_TMP.test(f)) fs.rmSync(path.join(abs, f), { force: true })
    return f.endsWith('.md') ? [toRel(path.join(relDir, f))] : []
  })
}

// Re-sync everything under a folder after it was moved or renamed.
export function reindexFolder(db: DatabaseSync, dir: string, relDir: string) {
  const prefix = relDir + '/'
  const stale = db.prepare('select path from entities where substr(path, 1, ?) = ?').all(prefix.length, prefix) as { path: string }[]
  for (const { path: p } of stale) removePath(db, p)
  for (const rel of mdFiles(dir, relDir)) indexFile(db, dir, rel)
}

export function openIndex(dir: string) {
  const db = new DatabaseSync(path.join(dir, '.index.sqlite'))
  db.exec(`
    drop table if exists entities; drop table if exists links; drop table if exists fts;
    create table entities(id text primary key, type text, title text, path text unique, fields text, words integer, updated_at integer, review text);
    create table links(from_id text, to_id text, field text, label text);
    create index links_from on links(from_id);
    create index links_to on links(to_id);
    create virtual table fts using fts5(id unindexed, title, body);
  `)
  db.exec('begin')
  for (const sub of CONTENT_DIRS) for (const rel of mdFiles(dir, sub, true)) indexFile(db, dir, rel)
  db.exec('commit')
  return db
}

function removeId(db: DatabaseSync, id: string) {
  db.prepare('delete from entities where id = ?').run(id)
  db.prepare('delete from links where from_id = ?').run(id)
  db.prepare('delete from fts where id = ?').run(id)
}

export function removePath(db: DatabaseSync, rel: string) {
  const row = db.prepare('select id from entities where path = ?').get(rel) as { id: string } | undefined
  if (row) removeId(db, row.id)
}

export function indexFile(db: DatabaseSync, dir: string, rel: string) {
  let e: Entity
  try {
    e = readEntity(path.join(dir, rel))
  } catch (err: any) {
    if (err.code !== 'ENOENT') console.warn(`Skipping ${rel}: ${err.message}`)
    return removePath(db, rel)
  }
  if (!e.id) return removePath(db, rel)
  const { id, type, title, body, ...fields } = e
  removePath(db, rel)
  removeId(db, id)
  db.prepare('insert into entities values (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, type ?? '', title ?? '', rel, JSON.stringify(fields), countWords(body), fs.statSync(path.join(dir, rel)).mtimeMs,
    JSON.stringify(reviewItems(e)),
  )
  for (const l of linkTargets(e)) db.prepare('insert into links values (?, ?, ?, ?)').run(id, l.to, l.field, l.label ?? null)
  db.prepare('insert into fts values (?, ?, ?)').run(id, title ?? '', body)
}

// Entities that link to this one, one row per field the link is in (the client groups them).
export const backlinks = (db: DatabaseSync, id: string) =>
  db.prepare(`select e.id, e.type, e.title, l.field, l.label from links l join entities e on e.id = l.from_id
    where l.to_id = ? and e.id != ? order by e.type, e.title collate nocase`).all(id, id)

// Full-text search. User text becomes quoted prefix terms, so FTS syntax characters can't cause errors.
// Snippet marks hits with \u0001...\u0002 so the client can highlight without trusting HTML.
export function search(db: DatabaseSync, q: string) {
  const terms = q.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)
  if (!terms) return []
  return db.prepare(`select e.id, e.type, e.title, snippet(fts, 2, char(1), char(2), '…', 16) snippet
    from fts join entities e on e.id = fts.id where fts match ? order by rank limit 50`)
    .all(terms.map((t) => `"${t}"*`).join(' '))
}

// Pick up edits made outside the app (another editor, git pull, sync tools).
export function watchProject(db: DatabaseSync, dir: string) {
  return fs.watch(dir, { recursive: true }, (_event, file) => {
    if (!file) return
    const rel = toRel(file)
    if (rel.endsWith('.md') && CONTENT_DIRS.some((d) => rel.startsWith(d + '/'))) indexFile(db, dir, rel)
  })
}
