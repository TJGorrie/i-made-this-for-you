// Corkboard: one column per chapter, one card per scene with its synopsis. Drag cards to reorder or move them.
// Filter by plot thread, status or POV: scenes that don't match fade out, so you still see where the thread sits.
import { useState } from 'react'
import { api, fieldText, parseLink, STATUSES, tagList, type Row } from './api.ts'
import { dropOn } from './Manuscript.tsx'
import { Help } from './Help.tsx'
import { beats } from './prose.ts'

type Props = { slug: string; rows: Row[]; onOpen: (id: string, beside?: boolean) => void; refresh: () => Promise<void> }

const byOrder = (a: Row, b: Row) => (a.order ?? 0) - (b.order ?? 0)
const povOf = (r: Row) => parseLink(fieldText(r.pov))?.[2] ?? ''

export function Board({ slug, rows, onOpen, refresh }: Props) {
  const books = rows.filter((r) => r.type === 'book').sort(byOrder)
  const [bookId, setBookId] = useState('')
  const [filter, setFilter] = useState('') // "thread:x", "status:x" or "pov:<id>"
  const [drag, setDrag] = useState<Row | null>(null)
  const book = books.find((b) => b.id === bookId) ?? books[0]
  const kids = (id: string) => rows.filter((r) => r.parent === id).sort(byOrder)
  const chapters = book ? kids(book.id) : []
  const scenes = chapters.flatMap((ch) => kids(ch.id))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const beatOf = new Map<string, string[]>()
  for (const b of beats(scenes)) beatOf.set(b.sceneId, [...(beatOf.get(b.sceneId) ?? []), b.beat])

  const threads = [...new Set(scenes.flatMap((s) => tagList(s.threads)))].sort()
  const statuses = [...new Set([...STATUSES, ...scenes.map((s) => fieldText(s.status).toLowerCase()).filter(Boolean)])]
  const povs = [...new Set(scenes.map(povOf).filter((id) => byId.has(id)))]
  const [kind, value] = [filter.slice(0, filter.indexOf(':')), filter.slice(filter.indexOf(':') + 1)]
  const matches = (s: Row) => !filter
    || (kind === 'thread' && tagList(s.threads).includes(value))
    || (kind === 'status' && fieldText(s.status).toLowerCase() === value)
    || (kind === 'pov' && povOf(s) === value)

  const save = async (s: Row, field: string, v: string) => {
    if (v === fieldText(s[field])) return
    await api(`/projects/${slug}/entities/${s.id}`, 'PUT', { [field]: v }).catch((e) => alert(e.message))
    await refresh()
  }
  const drop = async (target: Row) => {
    if (!drag) return
    setDrag(null)
    await dropOn(slug, rows, drag, target)
    await refresh()
  }

  return (
    <div className="board">
      <h2>Corkboard <Help>
        <span>Your scenes as index cards, one column per chapter. Drag a card onto another to put it before that one,
          or onto a chapter heading to move it to the end of that chapter.</span>
        <span>Write a short <b>synopsis</b> on each card. <b>threads</b> are your plot lines, comma-separated (<code>heist, romance</code>):
          pick one in the filter to see where it runs through the book.</span>
      </Help></h2>
      <p>
        {books.length > 1 && (
          <select aria-label="Book" value={book?.id} onChange={(e) => setBookId(e.target.value)}>
            {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        )}{' '}
        <select aria-label="Highlight" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All scenes</option>
          {threads.length > 0 && <optgroup label="Thread">{threads.map((t) => <option key={t} value={`thread:${t}`}>{t}</option>)}</optgroup>}
          <optgroup label="Status">{statuses.map((t) => <option key={t} value={`status:${t}`}>{t}</option>)}</optgroup>
          {povs.length > 0 && <optgroup label="Point of view">{povs.map((id) => <option key={id} value={`pov:${id}`}>{byId.get(id)!.title}</option>)}</optgroup>}
        </select>
        {filter && <small className="muted"> {scenes.filter(matches).length} of {scenes.length} scenes</small>}
      </p>
      {!book && <p className="muted">Add a book in the sidebar to see its scenes here.</p>}
      {scenes.length > 0 && <Pacing chapters={chapters.map((ch) => ({ ch, scenes: kids(ch.id) }))} beatOf={beatOf} onOpen={onOpen} />}
      <div className="columns">
        {chapters.map((ch) => (
          <section key={ch.id} className="column" aria-label={`Chapter ${ch.title}`}
            onDragOver={(e) => e.preventDefault()} onDrop={() => drop(ch)}>
            <h3><button className="link" onClick={() => onOpen(ch.id)}>{ch.title}</button></h3>
            {kids(ch.id).map((s) => (
              <article key={s.id} className={`card ${matches(s) ? '' : 'faded'}`} draggable aria-label={s.title}
                onDragStart={() => setDrag(s)} onDragEnd={() => setDrag(null)}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); drop(s) }}>
                <div className="card-head">
                  <button className="link" onClick={(e) => onOpen(s.id, e.shiftKey)} title="Shift+click to open beside">{s.title}</button>
                  {beatOf.get(s.id)?.map((b) => <span key={b} className="beat-badge" title="Where this point of the book's word count falls">{b}</span>)}
                  {fieldText(s.status) && <span className="badge" data-status={fieldText(s.status).toLowerCase()}>{fieldText(s.status)}</span>}
                </div>
                {/* Keyed on the saved value, so an edit made in the scene itself shows up here. */}
                <textarea key={`s${fieldText(s.synopsis)}`} aria-label={`${s.title} synopsis`} placeholder="Synopsis…"
                  defaultValue={fieldText(s.synopsis)} onBlur={(e) => save(s, 'synopsis', e.target.value)} />
                <input key={`t${fieldText(s.threads)}`} aria-label={`${s.title} threads`} placeholder="threads"
                  defaultValue={fieldText(s.threads)} onBlur={(e) => save(s, 'threads', e.target.value)} />
                <small className="muted">
                  {s.words.toLocaleString()} words{byId.get(povOf(s)) ? ` · ${byId.get(povOf(s))!.title}` : ''}
                </small>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

// One bar per scene (height = words), chapters side by side; dashed lines mark the quarter, midpoint and three-quarter beats.
function Pacing({ chapters, beatOf, onOpen }: {
  chapters: { ch: Row; scenes: Row[] }[]; beatOf: Map<string, string[]>; onOpen: (id: string, beside?: boolean) => void
}) {
  const all = chapters.flatMap((c) => c.scenes)
  const max = Math.max(1, ...all.map((s) => s.words))
  const avg = all.reduce((n, s) => n + s.words, 0) / all.length
  return (
    <section className="pacing" aria-label="Pacing">
      <h3>Pacing</h3>
      <div className="chart">
        <div className="bars" role="img" aria-label="Words per scene, in book order">
          <span className="y-max">{max.toLocaleString()}</span>
          <div className="goal-line" style={{ bottom: `${(avg / max) * 100}%` }}><span>average {Math.round(avg).toLocaleString()}</span></div>
          {chapters.map(({ ch, scenes }) => (
            <div key={ch.id} className="bar-chapter" title={ch.title}>
              {scenes.map((s) => (
                <button key={s.id} className={`bar-slot ${beatOf.has(s.id) ? 'beat' : ''}`} data-beat={beatOf.get(s.id)?.map((b) => (b === 'Midpoint' ? '½' : b)).join('')}
                  title={`${s.title} · ${s.words.toLocaleString()} words`} aria-label={`${s.title}: ${s.words.toLocaleString()} words`}
                  onClick={(e) => onOpen(s.id, e.shiftKey)}>
                  <div className="bar" style={{ height: `${(s.words / max) * 100}%` }} />
                </button>
              ))}
              <small className="bar-chapter-label">{ch.title}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
