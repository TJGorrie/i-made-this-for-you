// Version history: gzipped copies of an entity's file in <project>/.history/<id>/<timestamp>.md.gz.
// Space is bounded four ways: only real changes are kept, at most one per THROTTLE while typing,
// old versions are thinned (see prune), and the whole project is capped at historyMaxMB (project.json).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { atomicWrite } from './store.ts'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const THROTTLE = 5 * MIN
const DEFAULT_MAX_MB = 200

export type Snapshot = { ts: number; size: number }
type HistoryMeta = { path: string; title: string; type: string; deletedAt?: number }

const root = (dir: string) => path.join(dir, '.history')
const entityDir = (dir: string, id: string) => path.join(root(dir), id)

export function listSnapshots(dir: string, id: string): Snapshot[] {
  const d = entityDir(dir, id)
  if (!fs.existsSync(d)) return []
  return fs.readdirSync(d)
    .filter((f) => /^\d+\.md\.gz$/.test(f))
    .map((f) => ({ ts: parseInt(f), size: fs.statSync(path.join(d, f)).size }))
    .sort((a, b) => b.ts - a.ts)
}

export const readSnapshot = (dir: string, id: string, ts: number) =>
  zlib.gunzipSync(fs.readFileSync(path.join(entityDir(dir, id), `${ts}.md.gz`))).toString('utf8')

export function readMeta(dir: string, id: string): HistoryMeta | undefined {
  try { return JSON.parse(fs.readFileSync(path.join(entityDir(dir, id), 'meta.json'), 'utf8')) } catch { return undefined }
}
export const writeMeta = (dir: string, id: string, meta: HistoryMeta) =>
  atomicWrite(path.join(entityDir(dir, id), 'meta.json'), JSON.stringify(meta, null, 2))

export const historyMaxBytes = (dir: string) => {
  try { return (JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).historyMaxMB ?? DEFAULT_MAX_MB) * 1024 * 1024 } catch { return DEFAULT_MAX_MB * 1024 * 1024 }
}

// Save the file at `rel` as it is now (call before changing it). Throttled unless forced; skipped if unchanged.
export async function snapshot(dir: string, id: string, rel: string, meta: Omit<HistoryMeta, 'path'>, { force = false, now = Date.now() } = {}) {
  const file = path.join(dir, rel)
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf8')
  const latest = listSnapshots(dir, id)[0]
  if (latest && !force && now - latest.ts < THROTTLE) return
  if (latest && readSnapshot(dir, id, latest.ts) === text) return
  await atomicWrite(path.join(entityDir(dir, id), `${now}.md.gz`), zlib.gzipSync(text))
  await writeMeta(dir, id, { ...meta, path: rel })
  prune(dir, id, now)
  enforceCap(dir, historyMaxBytes(dir))
}

// Thin out old versions: keep everything from the last hour, the newest per hour for a day,
// the newest per day for 30 days, then the newest per week.
export function prune(dir: string, id: string, now = Date.now()) {
  const seen = new Set<string>()
  for (const s of listSnapshots(dir, id)) { // newest first
    const age = now - s.ts
    const bucket = age < HOUR ? `all:${s.ts}` : age < DAY ? `h:${Math.floor(s.ts / HOUR)}`
      : age < 30 * DAY ? `d:${Math.floor(s.ts / DAY)}` : `w:${Math.floor(s.ts / WEEK)}`
    if (seen.has(bucket)) fs.rmSync(path.join(entityDir(dir, id), `${s.ts}.md.gz`), { force: true })
    else seen.add(bucket)
  }
}

function historyUsage(dir: string) {
  if (!fs.existsSync(root(dir))) return []
  return fs.readdirSync(root(dir)).flatMap((id) => listSnapshots(dir, id).map((s, i) => ({ id, ...s, newest: i === 0 })))
}

// Hard cap for the whole project: delete the oldest versions first, but every entity keeps its newest one.
export function enforceCap(dir: string, max: number) {
  const all = historyUsage(dir)
  let total = all.reduce((n, s) => n + s.size, 0)
  for (const s of all.filter((s) => !s.newest).sort((a, b) => a.ts - b.ts)) {
    if (total <= max) break
    fs.rmSync(path.join(entityDir(dir, s.id), `${s.ts}.md.gz`), { force: true })
    total -= s.size
  }
}

export const historyBytes = (dir: string) => historyUsage(dir).reduce((n, s) => n + s.size, 0)

// Entities with history but no file any more: the "deleted items" list.
export function deletedEntities(dir: string, exists: (id: string) => boolean) {
  if (!fs.existsSync(root(dir))) return []
  return fs.readdirSync(root(dir)).flatMap((id) => {
    const meta = readMeta(dir, id)
    const latest = listSnapshots(dir, id)[0]
    return meta && latest && !exists(id) ? [{ id, ...meta, ts: latest.ts, deletedAt: meta.deletedAt ?? latest.ts }] : []
  }).sort((a, b) => b.deletedAt - a.deletedAt)
}
