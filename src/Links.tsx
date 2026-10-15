// Hover preview for [[links]] and the "Appears in" backlinks panel.
import { useEffect, useState } from 'react'
import { api, fieldText, plainText, readable, RESERVED_FIELDS, type Entity, type Row } from './api.ts'

export function LinkPreview({ url, x, y }: { url: string; x: number; y: number }) {
  const [e, setE] = useState<Entity | null>()
  useEffect(() => void api(url).then(setE, () => setE(null)), [url])
  const fields = e ? Object.entries(e).filter(([k, v]) => !RESERVED_FIELDS.includes(k) && fieldText(v)).slice(0, 4) : []
  return (
    <div className="preview" role="tooltip" style={{ left: x, top: y + 4 }}>
      {e === undefined ? '…' : e === null ? <em>Missing entry (deleted?)</em> : (
        <>
          <strong>{e.title}</strong> <small className="muted">{e.type}</small>
          {fields.map(([k, v]) => <div key={k}><small className="muted">{k}:</small> {fieldText(v)}</div>)}
          {e.body && <p>{plainText(e.body).slice(0, 240)}</p>}
          <small className="muted">Ctrl+click to open · Shift+click to open beside</small>
        </>
      )}
    </div>
  )
}

// Everything this entry says: dialogue tagged with it as the speaker, scene by scene in reading order.
export function SpokenLines({ url, onOpen }: { url: string; onOpen: (id: string) => void }) {
  const [scenes, setScenes] = useState<{ id: string; title: string; lines: string[] }[]>([])
  useEffect(() => void api(url + '/lines').then(setScenes), [url])
  if (!scenes.length) return null
  const total = scenes.reduce((n, s) => n + s.lines.length, 0)
  return (
    <details className="spoken-lines" aria-label="Lines">
      <summary><h4>Lines <small className="muted">{total} in {scenes.length} scene{scenes.length === 1 ? '' : 's'}</small></h4></summary>
      {scenes.map((s) => (
        <section key={s.id}>
          <button className="link" onClick={() => onOpen(s.id)}>{s.title}</button>
          <ul>{s.lines.map((l, i) => <li key={i}>{readable(l)}</li>)}</ul>
        </section>
      ))}
    </details>
  )
}

type Backlink = Row &{ field: string; label: string | null }

// Which footer section a link belongs to, by the field it lives in on the linking entity.
// `appears` and `pov` are the scene template's field names; any other field or the body counts as a mention.
const APPEARS = ['appears', 'pov']
const SECTIONS: [string, (field: string) => boolean][] = [
  ['Appears in', (f) => APPEARS.includes(f)],
  ['Mentioned in', (f) => !APPEARS.includes(f) && f !== 'relationships' && f !== 'pins'],
  ['Relationships', (f) => f === 'relationships'],
  ['On maps', (f) => f === 'pins'],
]

type Mention = { id: string; type: string; title: string; index: number; text: string; before: string; after: string }

// unlinked: also list places that name this entry in plain text (wiki entries only), each with a Link button.
export function Backlinks({ url, onOpen, unlinked }: { url: string; onOpen: (id: string) => void; unlinked: boolean }) {
  const [rows, setRows] = useState<Backlink[]>([])
  const [mentions, setMentions] = useState<Mention[]>([])
  const load = () => {
    api(url + '/backlinks').then(setRows)
    if (unlinked) api(url + '/unlinked').then(setMentions)
  }
  useEffect(load, [url])
  const link = (m: Mention) => api(url + '/unlinked', 'PATCH', { scene: m.id, index: m.index }).then(load, (e) => { alert(e.message); load() })
  const appearsIn = new Set(rows.filter((r) => APPEARS.includes(r.field)).map((r) => r.id))

  const sections = SECTIONS.map(([heading, match]) => {
    const items = new Map<string, { row: Backlink; notes: Set<string> }>() // one entry per entity
    for (const r of rows) {
      if (!match(r.field)) continue
      if (heading === 'Mentioned in' && appearsIn.has(r.id)) continue // appearing beats being mentioned
      const item = items.get(r.id) ?? { row: r, notes: new Set<string>() }
      if (r.field === 'pov') item.notes.add('POV')
      if (r.label) item.notes.add(r.label)
      items.set(r.id, item)
    }
    return { heading, items: [...items.values()] }
  }).filter((s) => s.items.length)

  if (!sections.length && !mentions.length) return null
  return (
    <footer className="backlinks">
      {sections.map(({ heading, items }) => (
        <section key={heading} aria-label={heading}>
          <h4>{heading}</h4>
          {items.map(({ row, notes }) => (
            <button key={row.id} className="link" onClick={() => onOpen(row.id)}>
              {row.title} <small className="muted">{[row.type, ...notes].join(' · ')}</small>
            </button>
          ))}
        </section>
      ))}
      {mentions.length > 0 && (
        <section aria-label="Unlinked mentions" className="unlinked">
          <h4>Unlinked mentions</h4>
          {mentions.map((m) => (
            <div key={`${m.id}:${m.index}`} className="mention">
              <button className="link" onClick={() => onOpen(m.id)}>{m.title}</button>
              <small>{readable(m.before)}<mark>{m.text}</mark>{readable(m.after)}</small>
              <button className="mini" onClick={() => link(m)} title={`Turn this "${m.text}" into a link`}>Link</button>
            </div>
          ))}
        </section>
      )}
    </footer>
  )
}

// This entry's properties as described in the text (select a passage → Describe), grouped by property.
// Each links to its passage, so editing the text there is how a description changes.
export type Passage = { mark: string; index: number } // the nth stretch with this mark, to select when an entry opens
type Description = { from: string; fromTitle: string; prop: string; text: string; index: number }
// reload: changes whenever the project's entries are refreshed (after any save), so a side pane stays current.
export function Descriptions({ url, onOpenAt, reload }: { url: string; onOpenAt: (id: string, at: Passage) => void; reload: unknown }) {
  const [list, setList] = useState<Description[]>([])
  useEffect(() => void api(url + '/descriptions').then(setList), [url, reload])
  if (!list.length) return null
  const props = [...new Set(list.map((d) => d.prop))]
  return (
    <section className="descriptions" aria-label="Described in the text">
      <h4>Described in the text</h4>
      {props.map((p) => (
        <div key={p} className="field-row">
          <span>{p}</span>
          <div>
            {list.filter((d) => d.prop === p).map((d) => (
              <button key={`${d.from}:${d.index}`} className="link" title={`Go to the passage in ${d.fromTitle}`}
                onClick={() => onOpenAt(d.from, { mark: 'described', index: d.index })}>
                {readable(d.text)} <small className="muted">· {d.fromTitle}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
