// Prose stats view: the numbers from prose.ts for one book, plus the words and phrases you repeat most.
import { useEffect, useMemo, useState } from 'react'
import { aliasesOf, api, MANUSCRIPT_TYPES, readable, type Row } from './api.ts'
import { CRUTCHES, proseStats, wordsOf, type Count, type WordLists } from './prose.ts'
import { Help } from './Help.tsx'

const byOrder = (a: Row, b: Row) => (a.order ?? 0) - (b.order ?? 0)

export function ProseView({ slug, rows, onSearch, words, onWords }: {
  slug: string; rows: Row[]; onSearch: (q: string) => void; words: WordLists; onWords: (w: WordLists) => void
}) {
  const books = rows.filter((r) => r.type === 'book').sort(byOrder)
  const [bookId, setBookId] = useState('')
  const [md, setMd] = useState<string>()
  const [scenes, setScenes] = useState<Scene[]>([])
  const book = books.find((b) => b.id === bookId) ?? books[0]
  useEffect(() => {
    if (!book) return
    const url = `/api/projects/${slug}/books/${book.id}/compile?format=`
    fetch(url + 'md').then((r) => r.text()).then(setMd)
    fetch(url + 'scenes').then((r) => r.json()).then(setScenes)
  }, [slug, book?.id, rows])
  const names = useMemo(() => rows.filter((r) => !MANUSCRIPT_TYPES.includes(r.type)).flatMap((r) => [r.title, ...aliasesOf(r.aliases)]), [rows])
  const stats = useMemo(() => (md === undefined ? undefined : proseStats(md, words, names)), [md, words, names])
  const byId = new Map(rows.map((r) => [r.id, r]))

  const list = (title: string, items: Count[], help?: string) => (
    <section className="prose-list">
      <h3>{title}</h3>
      {help && <p className="muted">{help}</p>}
      {!items.length && <p className="muted">None.</p>}
      <ol>
        {items.map(([w, n]) => (
          <li key={w}><button className="link" onClick={() => onSearch(w)} title="Find it in the book">{w}</button> <small>{n}</small></li>
        ))}
      </ol>
    </section>
  )

  return (
    <div className="prose-view">
      <h2>Prose stats <Help>
        <span>Numbers for the whole book (scenes only, comments left out), to spot habits while you revise.</span>
        <span>Click any word or phrase to search for it.</span>
        <span><b>Dialogue by speaker</b> counts the lines you've tagged: select a line in a scene and click <b>Speaker</b>.
          Each character's entry lists everything they say.</span>
      </Help></h2>
      {books.length > 1 && (
        <p><select aria-label="Book" value={book?.id} onChange={(e) => setBookId(e.target.value)}>
          {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select></p>
      )}
      {!book && <p className="muted">Add a book to see its stats.</p>}
      {book && stats && (
        <>
          <dl className="prose-numbers">
            <div><dt>Words</dt><dd>{stats.words.toLocaleString()}</dd></div>
          </dl>
          <DialogueBySpeaker scenes={scenes} byId={byId} />
          <div className="prose-lists">
            {list('Most used words', stats.topWords, 'Leaving out common words like "the" and "said", and the names of your characters, places and other entries.')}
            {list('Repeated phrases', stats.phrases, 'Three-word phrases used three times or more.')}
            {list('-ly adverbs', stats.adverbs)}
            {list('Words to check', stats.crutches, 'Your list of words to look at again. Edit it below.')}
          </div>
        </>
      )}
      <WordSettings slug={slug} words={words} onSaved={onWords} />
    </div>
  )
}

// The project's word lists, one per line: what Prose stats and Highlight check, and -ly words that aren't adverbs.
function WordSettings({ slug, words, onSaved }: { slug: string; words: WordLists; onSaved: (w: WordLists) => void }) {
  const [check, setCheck] = useState(words.check.join('\n'))
  const [notAdverbs, setNotAdverbs] = useState(words.notAdverbs.join('\n'))
  const [status, setStatus] = useState('')
  const lines = (s: string) => s.split('\n').map((w) => w.trim()).filter(Boolean)
  const save = () => api(`/projects/${slug}/words`, 'PUT', { check: lines(check), notAdverbs: lines(notAdverbs) })
    .then((w) => { onSaved(w); setStatus('Saved') }, (e) => setStatus(e.message))
  return (
    <details className="calendar-settings word-settings">
      <summary>Edit word lists</summary>
      <label>Words to check, one per line (phrases are fine: "a beat", "nodded")
        <textarea aria-label="Words to check" rows={8} value={check} onChange={(e) => { setCheck(e.target.value); setStatus('') }} /></label>
      <label>Not adverbs: -ly words never to flag, one per line (names, invented words)
        <textarea aria-label="Not adverbs" rows={4} value={notAdverbs} onChange={(e) => { setNotAdverbs(e.target.value); setStatus('') }} /></label>
      <button onClick={save}>Save lists</button>{' '}
      <button onClick={() => { setCheck(CRUTCHES.join('\n')); setStatus('') }}>Reset words to check</button> <small>{status}</small>
    </details>
  )
}

type Scene = { id: string; chapter: string; title: string; body: string; lines: { id: string; title: string; text: string }[] }

// Tagged dialogue grouped by speaker: lines, words, and their share of all tagged dialogue.
function DialogueBySpeaker({ scenes, byId }: { scenes: Scene[]; byId: Map<string, Row> }) {
  const groups = new Map<string, { title: string; lines: number; words: number; scenes: Set<string> }>()
  let tagged = 0
  for (const s of scenes) {
    for (const l of s.lines) {
      const g = groups.get(l.id) ?? { title: byId.get(l.id)?.title ?? l.title, lines: 0, words: 0, scenes: new Set() }
      const n = wordsOf(readable(l.text)).length
      g.lines++; g.words += n; g.scenes.add(s.id); tagged += n
      groups.set(l.id, g)
    }
  }
  const list = [...groups.values()].sort((a, b) => b.words - a.words)
  return (
    <section aria-label="Dialogue by speaker" className="dialogue-pov">
      <h3>Dialogue by speaker</h3>
      {!list.length && <p className="muted">No tagged dialogue yet. Select a line in a scene and click Speaker.</p>}
      {list.length > 0 && (
        <table>
          <tbody>
            {list.map((g) => (
              <tr key={g.title}>
                <td>{g.title}</td>
                <td className="muted">{g.lines} line{g.lines === 1 ? '' : 's'} in {g.scenes.size} scene{g.scenes.size === 1 ? '' : 's'}</td>
                <td className="muted">{g.words.toLocaleString()} words</td>
                <td>{Math.round((g.words / tagged) * 100)}% of tagged dialogue</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
