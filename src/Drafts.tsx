// Named drafts: the compiled book saved as a Markdown file (drafts/<book>/<date>-<name>.md), and what changed since.
// The comparison goes chapter by chapter, so a long book stays inside the word diff's size limit.
// Bringing back one scene's old text is History's job; this only shows the changes.
import { useEffect, useState } from 'react'
import { api, type Row } from './api.ts'
import { diffWords } from './diff.ts'
import { Help } from './Help.tsx'

const byOrder = (a: Row, b: Row) => (a.order ?? 0) - (b.order ?? 0)

// "## Heading" sections by title ("Title (2)" for a repeated one); the title page and dedication are the '' section.
function sections(md: string) {
  const out = new Map<string, string>()
  for (const s of md.split(/^(?=## )/m)) {
    const title = s.startsWith('## ') ? s.split('\n')[0].slice(3).trim() : ''
    let key = title
    for (let n = 2; out.has(key); n++) key = `${title} (${n})`
    out.set(key, (title ? s.slice(s.indexOf('\n') + 1) : s).trim()) // the heading is shown above the diff
  }
  return out
}

export function Drafts({ slug, rows }: { slug: string; rows: Row[] }) {
  const books = rows.filter((r) => r.type === 'book').sort(byOrder)
  const [bookId, setBookId] = useState('')
  const book = books.find((b) => b.id === bookId) ?? books[0]
  const url = book && `/projects/${slug}/books/${book.id}/drafts`
  const [drafts, setDrafts] = useState<string[]>([])
  const [picked, setPicked] = useState<{ file: string; old: string; now: string }>()
  const load = () => url && api(url).then(setDrafts)
  useEffect(() => { setPicked(undefined); load() }, [url])

  async function save() {
    const name = prompt('Name this draft (e.g. "sent to agent")')?.trim()
    if (!name || !url) return
    await api(url, 'POST', { name }).catch((e) => alert(e.message))
    load()
  }
  async function pick(file: string) {
    const text = (u: string) => fetch(u).then((r) => r.text())
    const [old, now] = await Promise.all([text(`/api${url}/${file}`), text(`/api/projects/${slug}/books/${book!.id}/compile?format=md`)])
    setPicked({ file, old, now })
  }

  const [a, b] = picked ? [sections(picked.old), sections(picked.now)] : [new Map<string, string>(), new Map<string, string>()]
  const titles = [...new Set([...b.keys(), ...a.keys()])] // current order, then chapters that are gone
  const changed = titles.filter((t) => a.get(t) !== b.get(t))

  return (
    <div className="drafts">
      <h2>Drafts <Help>
        <span><b>Save draft</b> keeps the whole book as it is now, under a name, as a Markdown file in the project's
          <code>drafts</code> folder. Pick a draft to see what you've changed since, chapter by chapter.</span>
        <span>To bring back an old version of one scene, open it and use <b>History</b>.</span>
      </Help></h2>
      {!book && <p className="muted">Add a book to save drafts of it.</p>}
      {book && (
        <p>
          {books.length > 1 && (
            <select aria-label="Book" value={book.id} onChange={(e) => setBookId(e.target.value)}>
              {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
          )}{' '}
          <button onClick={save}>Save draft…</button>
        </p>
      )}
      {book && !drafts.length && <p className="muted">No drafts of {book.title} yet.</p>}
      <ul className="draft-list">
        {drafts.map((f) => (
          <li key={f}><button className={`link ${picked?.file === f ? 'active' : ''}`} onClick={() => pick(f)}>{f.replace(/\.md$/, '')}</button></li>
        ))}
      </ul>
      {picked && (
        <section aria-label="Changes since this draft">
          <h3>Changes since {picked.file.replace(/\.md$/, '')}</h3>
          {!changed.length && <p className="muted">Nothing has changed.</p>}
          {changed.map((t) => (
            <div key={t} className="draft-chapter">
              <h4>{t || 'Title page'}{!a.has(t) ? ' (new)' : !b.has(t) ? ' (removed)' : ''}</h4>
              <div className="version-body diff">
                {diffWords(a.get(t) ?? '', b.get(t) ?? '').map((p, i) =>
                  p.op === '=' ? <span key={i}>{p.text}</span> : p.op === '-' ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>)}
              </div>
            </div>
          ))}
          {changed.length > 0 && changed.length < titles.length && <p className="muted">{titles.length - changed.length} unchanged.</p>}
        </section>
      )}
    </div>
  )
}
