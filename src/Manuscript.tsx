// Book > chapter > scene tree with word counts, targets, and native drag-and-drop reordering.
import { useState } from 'react'
import { api, type Row } from './api.ts'
import { Progress } from './Goals.tsx'

type Props = {
  slug: string; rows: Row[]; selected: string | null
  onSelect: (id: string, beside?: boolean) => void; refresh: () => Promise<void>
}

const byOrder = (a: Row, b: Row) => (a.order ?? 0) - (b.order ?? 0)

// Books, their chapters and scenes in reading order, with tree depth.
export function manuscriptTree(rows: Row[]) {
  const kids = (id: string) => rows.filter((r) => r.parent === id).sort(byOrder)
  return rows.filter((r) => r.type === 'book').sort(byOrder).flatMap((b) => [
    { row: b, depth: 0 },
    ...kids(b.id).flatMap((ch) => [{ row: ch, depth: 1 }, ...kids(ch.id).map((s) => ({ row: s, depth: 2 }))]),
  ])
}

export function Manuscript({ slug, rows, selected, onSelect, refresh }: Props) {
  const [drag, setDrag] = useState<Row | null>(null)
  const books = rows.filter((r) => r.type === 'book').sort(byOrder)
  const kids = (id: string) => rows.filter((r) => r.parent === id).sort(byOrder)
  const siblings = (r: Row) => (r.type === 'book' ? books : kids(r.parent!))
  const words = (r: Row): number => (r.type === 'scene' ? r.words : kids(r.id).reduce((n, k) => n + words(k), 0))
  // Chapters/scenes whose parent is missing (made before the tree existed, or edited outside the app).
  const ids = new Set(rows.map((r) => r.id))
  const unfiled = rows.filter((r) => (r.type === 'chapter' || r.type === 'scene') && !(r.parent && ids.has(r.parent)))

  async function add(type: string, parent?: string) {
    const title = prompt(`New ${type} title`)?.trim()
    if (!title) return
    const e = await api(`/projects/${slug}/entities`, 'POST', { type, title, parent, body: '' })
    await refresh()
    onSelect(e.id)
  }

  // Drop on a same-type item: insert before it (moving to its parent if different).
  // Drop a scene on a chapter, or a chapter on a book: append to it.
  async function drop(target: Row) {
    if (!drag || drag.id === target.id || unfiled.includes(target)) return
    let parent = target.parent
    let order: number
    if (drag.type === target.type) {
      const sibs = siblings(target).filter((s) => s.id !== drag.id)
      const prev = sibs[sibs.indexOf(target) - 1]
      // ponytail: fractional order means one file write per move; renumber siblings if ~50 drops into the same gap ever exhaust float precision.
      order = prev ? ((prev.order ?? 0) + (target.order ?? 0)) / 2 : (target.order ?? 0) - 1
    } else if ((drag.type === 'scene' && target.type === 'chapter') || (drag.type === 'chapter' && target.type === 'book')) {
      parent = target.id
      order = (kids(target.id).filter((s) => s.id !== drag.id).at(-1)?.order ?? 0) + 1
    } else return
    await api(`/projects/${slug}/entities/${drag.id}`, 'PUT', { parent, order }).catch((e) => alert(e.message))
    await refresh()
  }

  // Books and chapters can have a `target` word count; shown as "4,210 / 80,000" with a bar.
  const target = (r: Row) => { const n = parseInt(String(r.target ?? ''), 10); return n > 0 ? n : 0 }

  const item = (r: Row, depth: number) => (
    <div
      key={r.id}
      className={`tree-item depth-${depth}`}
      draggable
      onDragStart={() => setDrag(r)}
      onDragEnd={() => setDrag(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => drop(r)}
    >
      <button className={`link ${r.id === selected ? 'active' : ''}`} onClick={(e) => onSelect(r.id, e.shiftKey)}
        title="Shift+click to open beside">{r.title}</button>
      {r.status && <span className="badge">{r.status}</span>}
      <small>{words(r).toLocaleString()}{target(r) ? ` / ${target(r).toLocaleString()}` : ''}</small>
      {target(r) > 0 && <Progress value={words(r)} max={target(r)} />}
      {r.type === 'book' && <button className="mini" onClick={() => add('chapter', r.id)} title="Add chapter">+</button>}
      {r.type === 'book' && (
        <select className="mini export" aria-label={`Export ${r.title}`} value=""
          onChange={(e) => { open(`/api/projects/${slug}/books/${r.id}/compile?format=${e.target.value}`); e.target.value = '' }}>
          <option value="">⇩</option>
          <option value="md">Markdown</option>
          <option value="docx">Word (needs pandoc)</option>
          <option value="epub">EPUB (needs pandoc)</option>
          <option value="html">PDF (print)</option>
        </select>
      )}
      {r.type === 'chapter' && <button className="mini" onClick={() => add('scene', r.id)} title="Add scene">+</button>}
    </div>
  )

  return (
    <section>
      <h4>Manuscript <button className="mini" onClick={() => add('book')} title="Add book">+</button></h4>
      {manuscriptTree(rows).map(({ row, depth }) => item(row, depth))}
      {unfiled.length > 0 && <h5 title="Drag scenes onto a chapter to file them">Unfiled</h5>}
      {unfiled.map((r) => item(r, 1))}
    </section>
  )
}
