// File store: Markdown + YAML frontmatter on disk is the source of truth.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import YAML from 'yaml'

export type Entity = { id: string; type: string; title: string; body: string; [field: string]: unknown }

export const newId = () => randomBytes(6).toString('base64url')
export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'

// Field names may carry a link type: "pov:character" holds one [[link]] to a character,
// "appears:character[]" a list of them, "mentioned:*[]" a list of links to any wiki entity, "portrait:image" an
// uploaded picture, "gallery:image[]" several. See parseField in src/api.ts.
const DEFAULT_TEMPLATES = {
  book: ['author', 'target', 'dedication', 'acknowledgements', 'cover:image', 'language'],
  chapter: ['target'],
  scene: ['status', 'synopsis', 'threads', 'date', 'target', 'pov:character', 'appears:character[]', 'mentioned:*[]'],
  character: ['portrait:image', 'aliases', 'age', 'role', 'appearance', 'personality', 'goals'],
  location: ['aliases', 'region', 'climate', 'gallery:image[]'],
  item: ['owner:character', 'origin'],
  faction: ['leader:character', 'goals'],
  lore: ['category'],
  event: ['date', 'dateLabel', 'involves:*[]', 'tags'],
  map: ['image'],
}

// Temp files from a write that was cut short (crash, kill). Never the real data, safe to delete.
export const STALE_TMP = /\.tmp-[\w-]{8}$/

// Windows: rename fails with EPERM/EBUSY while antivirus or an editor briefly holds the target.
export async function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fsp.rename(from, to)
    } catch (err: any) {
      if (attempt >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err
      await new Promise((r) => setTimeout(r, 50))
    }
  }
}

// Write to a temp file, fsync, then rename over the target: a crash leaves the old or new file, never half of one.
export async function atomicWrite(file: string, text: string | Uint8Array) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${newId()}`
  const fh = await fsp.open(tmp, 'w')
  try {
    await fh.writeFile(text)
    await fh.sync()
  } finally {
    await fh.close()
  }
  await renameWithRetry(tmp, file).catch(async (err) => {
    await fsp.rm(tmp, { force: true })
    throw err
  })
}

export function parseEntity(text: string): Entity {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text)
  return m ? { ...YAML.parse(m[1]), body: m[2] } : ({ body: text } as Entity)
}

export const readEntity = (file: string) => parseEntity(fs.readFileSync(file, 'utf8'))

export function writeEntity(dir: string, rel: string, { id, type, title, body = '', ...fields }: Entity) {
  return atomicWrite(path.join(dir, rel), `---\n${YAML.stringify({ id, type, title, ...fields })}---\n${body}`)
}

// Books and chapters are folders holding their own metadata file; scenes live in their chapter's folder.
const FOLDER_FILE: Record<string, string> = { book: '_book.md', chapter: '_chapter.md' }

// Path for a new entity (suffixed -2, -3... if taken):
//   wiki/character/ana.md, manuscript/my-book/_book.md, manuscript/my-book/ch-1/_chapter.md, manuscript/my-book/ch-1/opening.md
export function newEntityPath(dir: string, type: string, title: string, parentRel?: string) {
  const base = type === 'book' ? 'manuscript' : parentRel ? path.posix.dirname(parentRel) : `wiki/${slugify(type)}`
  const file = FOLDER_FILE[type]
  const at = (slug: string) => (file ? `${base}/${slug}/${file}` : `${base}/${slug}.md`)
  const taken = (rel: string) => fs.existsSync(path.join(dir, file ? path.posix.dirname(rel) : rel))
  let slug = slugify(title)
  for (let n = 2; taken(at(slug)); n++) slug = `${slugify(title)}-${n}`
  return at(slug)
}

export function listProjects(root: string) {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root)
    .filter((slug) => fs.existsSync(path.join(root, slug, 'project.json')))
    .map((slug) => ({ slug, ...JSON.parse(fs.readFileSync(path.join(root, slug, 'project.json'), 'utf8')) }))
}

export async function createProject(root: string, name: string) {
  const slug = slugify(name)
  const dir = path.join(root, slug)
  if (fs.existsSync(dir)) throw new Error(`Project "${slug}" already exists`)
  for (const sub of ['manuscript', 'wiki', 'assets']) await fsp.mkdir(path.join(dir, sub), { recursive: true })
  await atomicWrite(path.join(dir, 'templates.json'), JSON.stringify(DEFAULT_TEMPLATES, null, 2))
  await atomicWrite(path.join(dir, 'project.json'), JSON.stringify({ name }, null, 2))
  return { slug, dir }
}

// ---- Backup and restore ----

// Every file in the project except the index (a cache, rebuilt on open) and temp files: history, goals and drafts included.
// improvement: the zip writer has no zip64, so a project over 4 GB or 65,535 files can't be backed up this way.
export function projectFiles(dir: string) {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => !/^\.index\.sqlite/.test(f) && !STALE_TMP.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) }))
}

// Unpack a backup into a new project folder (suffixed -2, -3... if the name is taken); never touches an existing project.
// Every path is checked before anything is written: no "..", no absolute paths or drive letters, nothing outside the new folder.
export async function restoreProject(root: string, files: Map<string, Buffer>) {
  const names = [...files.keys()].filter((n) => !n.endsWith('/') && !/^\.index\.sqlite/.test(n))
  for (const n of names)
    if (/^[\\/]|:/.test(n) || n.split(/[\\/]/).some((part) => part === '..' || part === '.'))
      throw new Error(`Unsafe path in backup: ${n}`)
  let name: string
  try { name = String(JSON.parse(files.get('project.json')!.toString('utf8')).name ?? '').trim() } catch { name = '' }
  if (!name) throw new Error('Not a project backup (no project.json)')
  let slug = slugify(name)
  for (let n = 2; fs.existsSync(path.join(root, slug)); n++) slug = `${slugify(name)}-${n}`
  const dir = path.resolve(root, slug)
  for (const n of names) {
    const file = path.resolve(dir, n)
    if (!file.startsWith(dir + path.sep)) throw new Error(`Unsafe path in backup: ${n}`)
  }
  try {
    for (const n of names) await atomicWrite(path.join(dir, n), files.get(n)!)
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true }) // our own new folder, half written
    throw e
  }
  return slug
}
