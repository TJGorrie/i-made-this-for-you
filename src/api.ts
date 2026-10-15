// An index row: every frontmatter field plus path and word count (no body).
export type Row = {
  id: string; type: string; title: string; words: number
  parent?: string; order?: number; status?: string; [field: string]: unknown
}
export type Entity = { id: string; type: string; title: string; body: string; [field: string]: unknown }

export type Relationship = { to: string; kind: string }
export type Pin = { entity: string; x: number; y: number } // image pixels from top-left

export const MANUSCRIPT_TYPES = ['book', 'chapter', 'scene']
// Frontmatter keys the app manages itself; never shown as editable text fields.
export const RESERVED_FIELDS = ['id', 'type', 'title', 'body', 'parent', 'order', 'relationships', 'pins', 'path', 'words', 'review']

// Dialogue tagged with who says it (src/speaker.ts): {%the line%}{@[[Name|id]]}. The speaker is a link, so it's indexed like one.
export const SPEAKER = /\{%([\s\S]+?)%\}\{@\[\[([^\]|]*)\|([^\]]+)\]\]\}/g
export const speakerLines = (md: string) => [...md.matchAll(SPEAKER)].map((m) => ({ text: m[1], title: m[2], id: m[3] }))
// Text describing a property of an entry (src/described.ts): {^grey eyes^}{#[[Name|id]]:eyes}. index: nth description in the text.
export const DESCRIBED = /\{\^([\s\S]+?)\^\}\{#\[\[([^\]|]*)\|([^\]]+)\]\]:([^}]*)\}/g
export const descriptions = (md: string) =>
  [...md.matchAll(DESCRIBED)].map((m, index) => ({ text: m[1], title: m[2], id: m[3], prop: m[4], index }))
// Tagged dialogue and descriptions → just their text.
export const stripTags = (md: string) => md.replace(SPEAKER, '$1').replace(DESCRIBED, '$1')

// Markdown → plain text for previews and snippets: links become their titles, markup characters go.
export const plainText = (md: string) =>
  stripTags(md).replace(/\[\[([^\]|]*)\|[^\]]+\]\]/g, '$1').replace(/[#>*_`~]+|^-{3,}$/gm, ' ').replace(/\s+/g, ' ').trim()

// Stored markup as you'd read it: [[Name|id]] links show their name, inline comments and tagged dialogue just their text.
export const readable = (md: string) =>
  stripTags(md).replace(/\[\[([^\]|]*)\|[^\]]+\]\]/g, '$1').replace(/\{==([\s\S]+?)==\}\{>>[\s\S]*?<<\}/g, '$1')

// Template field spec:
//   "pov:character"        → `pov` holds one [[link]] to a character
//   "appears:character[]"  → `appears` holds a list of links to characters
//   "mentioned:*[]"        → a list of links to any wiki entity
export const parseField = (spec: string) => {
  const [name, type = ''] = spec.split(':')
  const multiple = type.endsWith('[]')
  return { name, linkType: type.replace('[]', '') || undefined, multiple }
}
export const parseLink = (v: string) => /^\[\[([^\]|]*)\|([^\]]+)\]\]$/.exec(v.trim())

export const fieldText = (v: unknown): string =>
  Array.isArray(v) ? v.map(fieldText).filter(Boolean).join(', ') : v == null || typeof v === 'object' ? '' : String(v)

// Comma-separated labels, lowercased: event `tags: war, politics`, scene `threads: heist, romance`.
export const tagList = (v: unknown) => fieldText(v).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)

// Suggested scene statuses, in workflow order (any other text is allowed too).
export const STATUSES = ['idea', 'draft', 'revised', 'done']

// Review items. Inline comment notes mark "done" with a [x] prefix ({==text==}{>>[x] note<<});
// whole-entity notes live in frontmatter as `review: [{ note, done }]`.
export type ReviewNote = { note: string; done: boolean }
export const parseNote = (raw: string) => (raw.startsWith('[x] ') ? { note: raw.slice(4), done: true } : { note: raw, done: false })
export const reviewNotes = (v: unknown): ReviewNote[] =>
  Array.isArray(v) ? v.filter((n) => typeof n?.note === 'string').map((n) => ({ note: n.note, done: !!n.done })) : []

// Other names for an entity ("Strider" for Aragorn): the comma-separated `aliases` field, or a list.
export const aliasesOf = (v: unknown) =>
  (Array.isArray(v) ? v.map(String) : fieldText(v).split(',')).map((s) => s.trim()).filter(Boolean)
// Text shown for a link: an alias it was written as stays; anything else (e.g. an old title) becomes the current title.
export const linkText = (stored: string, title: string, aliases: string[]) =>
  aliases.some((a) => a.toLowerCase() === stored.toLowerCase()) ? stored : title

// Fingerprint of a field value (sha-256 of its JSON, same as the server) to detect edits made elsewhere.
// improvement: crypto.subtle needs a secure context (localhost is fine); a LAN mode over plain http would need https or a JS hash.
export const fingerprint = async (v: unknown) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v ?? null))))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')

// Timeline dates: a plain number ("300", "-12.5") or year-month-day ("300-3-12", "-40-11").
export type Calendar = { months: string[]; era: string }
const YMD = /^(-?\d+)(?:-(\d+))?(?:-(\d+))?$/

// Sort key: [year, month, day]; undated sorts last.
export function dateKey(date: string): [number, number, number] {
  const m = YMD.exec(date.trim())
  if (m) return [+m[1], +(m[2] ?? 0), +(m[3] ?? 0)]
  const n = parseFloat(date)
  return [Number.isNaN(n) ? Infinity : n, 0, 0]
}
export const compareDates = (a: string, b: string) => {
  const [x, y] = [dateKey(a), dateKey(b)]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || 0 // Infinity - Infinity is NaN → equal
}

// "300-3-12" with months [.., .., Frostmoon] and era "Year" → "12 Frostmoon, Year 300". No calendar: shown as typed.
export function calendarLabel(date: string, cal?: Calendar) {
  const m = YMD.exec(date.trim())
  if (!cal || !m) return date
  const month = m[2] ? cal.months[+m[2] - 1] ?? `Month ${m[2]}` : ''
  const dayMonth = [m[3], month].filter(Boolean).join(' ')
  const year = [cal.era, m[1]].filter(Boolean).join(' ')
  return dayMonth ? `${dayMonth}, ${year}` : year
}

// Upload an image to the project's assets; returns the stored file name.
export async function uploadImage(assetsUrl: string, file: File): Promise<string> {
  const res = await fetch(`${assetsUrl}?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()).name
}

export async function api(url: string, method = 'GET', body?: unknown) {
  const res = await fetch('/api' + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.status === 204 ? null : res.json()
}
