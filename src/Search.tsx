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

export function SearchResults({ slug, q, onOpen }: { slug: string; q: string; onOpen: (id: string) => void }) {
  const [hits, setHits] = useState<Hit[]>()
  useEffect(() => {
    let live = true // ignore responses for older keystrokes
    api(`/projects/${slug}/search?q=${encodeURIComponent(q)}`).then((h) => live && setHits(h))
    return () => { live = false }
  }, [slug, q])
  return (
    <div className="search-results">
      <h2>Search</h2>
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
