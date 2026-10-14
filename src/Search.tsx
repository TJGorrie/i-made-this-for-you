// Full-text search results across manuscript and wiki.
import { useEffect, useState } from 'react'
import { api, plainText } from './api.ts'

type Hit = { id: string; type: string; title: string; snippet: string }

// Server marks matches with \u0001...\u0002; render them as <mark> without injecting HTML.
// Links first (a match can sit inside one), then markup per piece, keeping the snippet's own spaces between pieces.
const highlight = (s: string) =>
  s.replace(/\[\[([^\]|]*)\|[^\]]+\]\]/g, '$1').split(/(\u0001[^\u0002]*\u0002)/).map((part, i) => {
    if (part.startsWith('\u0001')) return <mark key={i}>{part.slice(1, -1)}</mark>
    const text = plainText(part)
    return text ? (/^\s/.test(part) ? ' ' : '') + text + (/\s$/.test(part) ? ' ' : '') : /\s/.test(part) ? ' ' : ''
  })

type Props = { slug: string; q: string; onOpen: (id: string) => void; onReplaced: () => void }

export function SearchResults({ slug, q, onOpen, onReplaced }: Props) {
  const [hits, setHits] = useState<Hit[]>()
  const [done, setDone] = useState(0) // replaces applied: search again afterwards
  useEffect(() => {
    let live = true // ignore responses for older keystrokes
    api(`/projects/${slug}/search?q=${encodeURIComponent(q)}`).then((h) => live && setHits(h))
    return () => { live = false }
  }, [slug, q, done])
  return (
    <div className="search-results">
      <h2>Search</h2>
      <Replace slug={slug} find={q} onOpen={onOpen} onReplaced={() => { setDone((n) => n + 1); onReplaced() }} />
      {hits?.length === 0 && <p className="muted">No matches for “{q}”.</p>}
      {hits?.map((h) => (
        <button key={h.id} className="hit" onClick={() => onOpen(h.id)}>
          <strong>{h.title}</strong> <small className="muted">{h.type}</small>
          <p>{highlight(h.snippet)}</p>
        </button>
      ))}
    </div>
  )
}

type Count = { id: string; type: string; title: string; count: number }

// Replace the search text everywhere: Preview counts the matches per entry, then Replace writes them.
// Links and comment notes are never changed; every changed entry keeps its old text in History.
function Replace({ slug, find, onOpen, onReplaced }: { slug: string; find: string; onOpen: (id: string) => void; onReplaced: () => void }) {
  const [to, setTo] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [preview, setPreview] = useState<Count[]>()
  const [message, setMessage] = useState('')
  useEffect(() => setPreview(undefined), [find, to, matchCase, wholeWord]) // a preview is only good for what it was made with
  const run = (apply: boolean) =>
    api(`/projects/${slug}/replace`, 'POST', { find, replace: to, matchCase, wholeWord, apply }).then((r: Count[]) => {
      if (!apply) return setPreview(r)
      setPreview(undefined)
      setMessage(`Replaced ${total(r).toLocaleString()} in ${r.length} ${r.length === 1 ? 'entry' : 'entries'}.`)
      onReplaced()
    }, (e) => setMessage(e.message))
  const total = (r: Count[]) => r.reduce((n, c) => n + c.count, 0)
  return (
    <details className="replace" onToggle={() => setMessage('')}>
      <summary>Replace…</summary>
      <div className="replace-row">
        <input aria-label="Replace with" placeholder={`Replace “${find}” with…`} value={to} onChange={(e) => setTo(e.target.value)} />
        <label><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        <label><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole words</label>
        <button onClick={() => run(false)}>Preview</button>
      </div>
      {preview && (
        <section className="replace-preview" aria-label="Replace preview">
          {preview.length === 0 ? <p className="muted">No matches outside links and comment notes.</p> : (
            <>
              <ul>
                {preview.map((c) => (
                  <li key={c.id}><button className="link" onClick={() => onOpen(c.id)}>{c.title}</button> <small className="muted">{c.type} · {c.count}</small></li>
                ))}
              </ul>
              <button onClick={() => run(true)}>Replace {total(preview).toLocaleString()} in {preview.length} {preview.length === 1 ? 'entry' : 'entries'}</button>
              <small className="muted"> Each entry's old text is kept in its History.</small>
            </>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  )
}
