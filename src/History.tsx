// Version history for one entity, and the project's "Deleted items" list.
import { useEffect, useState } from 'react'
import { api, fieldText, readable, RESERVED_FIELDS, type Entity } from './api.ts'
import { Help } from './Help.tsx'
import { diffWords } from './diff.ts'

type Snapshot = { ts: number; size: number }

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

type PanelProps = { url: string; beforeRestore: () => Promise<boolean>; onRestored: () => void; onClose: () => void }

export function HistoryPanel({ url, beforeRestore, onRestored, onClose }: PanelProps) {
  const [versions, setVersions] = useState<Snapshot[]>()
  const [picked, setPicked] = useState<{ ts: number; entity: Entity }>()
  const [comparing, setComparing] = useState(false)
  const [current, setCurrent] = useState<Entity>() // the saved text now, to compare against
  useEffect(() => void api(url + '/history').then(setVersions), [url])

  const pick = async (ts: number) => setPicked({ ts, entity: await api(`${url}/history/${ts}`) })
  const compare = async (on: boolean) => { setComparing(on); if (on) setCurrent(await api(url)) }
  async function restore() {
    if (!picked || !confirm(`Restore the version from ${when(picked.ts)}?\nYour current text is kept in history, so you can undo this.`)) return
    if (!(await beforeRestore())) return
    await api(`${url}/history/${picked.ts}/restore`, 'POST')
    onRestored()
  }
  const fields = picked ? Object.entries(picked.entity).filter(([k, v]) => !RESERVED_FIELDS.includes(k) && fieldText(v)) : []

  return (
    <aside className="history-panel" aria-label="Version history">
      <div className="history-head">
        <b>Version history</b>
        <button className="mini" onClick={onClose} aria-label="Close history">×</button>
      </div>
      {versions?.length === 0 && <p className="muted">No earlier versions yet. One is kept before edits (at most every 5 minutes), deletes and restores.</p>}
      <ol className="versions">
        {versions?.map((v) => (
          <li key={v.ts}>
            <button className={`link ${picked?.ts === v.ts ? 'active' : ''}`} onClick={() => pick(v.ts)}>{when(v.ts)}</button>
          </li>
        ))}
      </ol>
      {picked && (
        <div className="version-preview">
          <button onClick={restore}>Restore this version</button>{' '}
          <label><input type="checkbox" checked={comparing} onChange={(e) => compare(e.target.checked)} /> Compare with now</label>
          <h3>{picked.entity.title}</h3>
          {fields.map(([k, v]) => <div key={k}><small className="muted">{k}:</small> {readable(fieldText(v))}</div>)}
          {comparing && current ? (
            <div className="version-body diff" aria-label="Changes since this version">
              {diffWords(readable(picked.entity.body), readable(current.body)).map((p, i) =>
                p.op === '=' ? <span key={i}>{p.text}</span> : p.op === '-' ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>)}
            </div>
          ) : <div className="version-body">{readable(picked.entity.body)}</div>}
        </div>
      )}
    </aside>
  )
}

type Deleted = { id: string; title: string; type: string; ts: number; deletedAt: number }

export function DeletedItems({ slug, onRestored }: { slug: string; onRestored: (id: string) => void }) {
  const [info, setInfo] = useState<{ bytes: number; maxBytes: number; deleted: Deleted[] }>()
  const load = () => api(`/projects/${slug}/history`).then(setInfo)
  useEffect(() => void load(), [slug])

  async function restore(d: Deleted) {
    await api(`/projects/${slug}/entities/${d.id}/history/${d.ts}/restore`, 'POST')
    onRestored(d.id)
  }

  return (
    <div className="deleted-items">
      <h2>Deleted items <Help>
        <span>Everything you've deleted, newest first. <b>Restore</b> brings it back where it was (or unfiled, if its chapter is gone).</span>
        <span>For an older version of something that still exists, open it and click <b>History</b>.</span>
      </Help></h2>
      {info && (
        <p className="muted">
          Version history uses {formatBytes(info.bytes)} of {formatBytes(info.maxBytes)}.
          Older versions are thinned automatically; change the limit with <code>historyMaxMB</code> in project.json.
        </p>
      )}
      {info?.deleted.length === 0 && <p className="muted">Nothing deleted.</p>}
      <table>
        <tbody>
          {info?.deleted.map((d) => (
            <tr key={d.id}>
              <td>{d.title}</td>
              <td className="muted">{d.type}</td>
              <td className="muted">deleted {when(d.deletedAt)}</td>
              <td><button className="mini" onClick={() => restore(d)}>Restore</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
