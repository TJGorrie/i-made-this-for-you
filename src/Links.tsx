// Hover preview for [[links]] and the "Appears in" backlinks panel.
import { useEffect, useState } from 'react'
import { api, fieldText, plainText, RESERVED_FIELDS, type Entity, type Row } from './api.ts'

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

type Backlink = Row & { field: string; label: string | null }

// Which footer section a link belongs to, by the field it lives in on the linking entity.
// `appears` and `pov` are the scene template's field names; any other field or the body counts as a mention.
const APPEARS = ['appears', 'pov']
const SECTIONS: [string, (field: string) => boolean][] = [
  ['Appears in', (f) => APPEARS.includes(f)],
  ['Mentioned in', (f) => !APPEARS.includes(f) && f !== 'relationships' && f !== 'pins'],
  ['Relationships', (f) => f === 'relationships'],
  ['On maps', (f) => f === 'pins'],
]

export function Backlinks({ url, onOpen }: { url: string; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Backlink[]>([])
  useEffect(() => void api(url + '/backlinks').then(setRows), [url])
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

  if (!sections.length) return null
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
    </footer>
  )
}
