// Scene grid: scenes across in reading order, and down the side the entries of one type (characters by default,
// or locations, items...) or the plot threads. A filled cell means the scene links to that entry (POV, appears, or
// @-linked in the text) or has that thread; ◉ marks a character's POV scenes. Hover a cell for the scene and their age.
import { useState } from 'react'
import { fieldText, MANUSCRIPT_TYPES, tagList, type Row } from './api.ts'
import { manuscriptTree } from './Manuscript.tsx'
import { ageAt, birthYears, type Link } from './continuity.ts'
import { Help } from './Help.tsx'

type Mark = 'pov' | 'in'
type GridRow = { id: string; title: string; open?: string; cells: Map<string, Mark> } // cells by scene id
const THREADS = '\u0000threads'

export function Cast({ rows, links, onOpen }: { rows: Row[]; links: Link[]; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState('character')
  const scenes = manuscriptTree(rows).map((t) => t.row).filter((r) => r.type === 'scene')
  const types = [...new Set(rows.map((r) => r.type))].filter((t) => !MANUSCRIPT_TYPES.includes(t)).sort()
  const born = birthYears(rows, links)

  const grid: GridRow[] = kind === THREADS
    ? [...new Set(scenes.flatMap((s) => tagList(s.threads)))].sort().map((t) => ({
        id: t, title: t, cells: new Map(scenes.filter((s) => tagList(s.threads).includes(t)).map((s) => [s.id, 'in' as Mark])),
      }))
    : rows.filter((r) => r.type === kind).map((r) => {
        const cells = new Map<string, Mark>()
        for (const l of links) {
          if (l.to_id !== r.id) continue
          if (l.field === 'pov' && kind === 'character') cells.set(l.from_id, 'pov')
          else if (!cells.has(l.from_id)) cells.set(l.from_id, 'in')
        }
        return { id: r.id, title: r.title, open: r.id, cells }
      })
  const lastSeen = (g: GridRow) => {
    const i = scenes.findLastIndex((s) => g.cells.has(s.id))
    const ago = scenes.length - 1 - i
    return i < 0 ? 'not in a scene yet' : ago === 0 ? 'in the latest scene' : `${ago} scene${ago === 1 ? '' : 's'} ago`
  }

  return (
    <div className="cast">
      <h2>Cast <Help>
        <span>Which scenes each character, place or other entry is in, in reading order. A scene counts an entry when it's
          the <b>pov</b>, in <b>appears</b> or <b>mentioned</b>, or @-linked in the text. <b>◉</b> marks a character's point-of-view scenes.</span>
        <span>Pick <b>Threads</b> to see where each plot thread (a scene's <b>threads</b> field) runs through the book.</span>
        <span>Give a character a <b>birth</b> event (an event tagged <code>birth</code> that involves them) and date your scenes,
          and hovering a cell shows their age.</span>
      </Help></h2>
      <p>
        <select aria-label="Rows" value={kind} onChange={(e) => setKind(e.target.value)}>
          {[...new Set(['character', ...types])].map((t) => <option key={t} value={t}>{t}</option>)}
          <option value={THREADS}>Threads</option>
        </select>
      </p>
      {!scenes.length || !grid.length
        ? <p className="muted">{!scenes.length ? 'Add scenes to see who and what is where.' : kind === THREADS
            ? 'No threads yet: write them in a scene’s threads field, comma-separated.' : `No ${kind} entries yet.`}</p>
        : (
          <div className="cast-scroll">
            <table aria-label="Cast grid">
              <thead>
                <tr>
                  <th />
                  {scenes.map((s, n) => <th key={s.id} scope="col" title={s.title} aria-label={s.title}>{n + 1}</th>)}
                  <th scope="col">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((g) => (
                  <tr key={g.id}>
                    <th scope="row">{g.open ? <button className="link" onClick={() => onOpen(g.open!)}>{g.title}</button> : g.title}</th>
                    {scenes.map((s) => {
                      const mark = g.cells.get(s.id)
                      const age = kind === 'character' ? ageAt(born, g.id, fieldText(s.date)) : undefined
                      const label = [s.title, mark === 'pov' && 'POV', age !== undefined && `age ${age}`].filter(Boolean).join(' · ')
                      return (
                        <td key={s.id} className={mark ?? ''}>
                          {mark && <button onClick={() => onOpen(s.id)} title={label} aria-label={`${g.title}: ${label}`}>{mark === 'pov' ? '◉' : '●'}</button>}
                        </td>
                      )
                    })}
                    <td className="muted last-seen">{lastSeen(g)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
