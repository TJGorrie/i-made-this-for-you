// Table of all entities of one type, with template fields as columns and a text filter.
import { useState } from 'react'
import { aliasesOf, fieldText, parseField, plainText, type Row } from './api.ts'

type Props = { type: string; rows: Row[]; fields: string[]; onOpen: (id: string) => void; onCreate: (type: string) => void }

export function TypeTable({ type, rows, fields: specs, onOpen, onCreate }: Props) {
  const [q, setQ] = useState('')
  const fields = specs.map((s) => parseField(s).name)
  const cell = (r: Row, f: string) => plainText(fieldText(r[f]))
  const items = rows.filter(
    (r) => r.type === type && [r.title, ...aliasesOf(r.aliases), ...fields.map((f) => cell(r, f))].join(' ').toLowerCase().includes(q.toLowerCase()),
  )
  return (
    <div className="type-table">
      <h2>{type}</h2>
      <p>
        <input placeholder={`Filter ${type}…`} value={q} onChange={(e) => setQ(e.target.value)} />{' '}
        <button onClick={() => onCreate(type)}>New {type}</button>
      </p>
      <table>
        <thead>
          <tr><th>Title</th>{fields.map((f) => <th key={f}>{f}</th>)}</tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} onClick={() => onOpen(r.id)}>
              <td>{r.title}</td>
              {fields.map((f) => <td key={f}>{cell(r, f)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="muted">{q ? 'No matches.' : `No ${type} entries yet.`}</p>}
    </div>
  )
}
