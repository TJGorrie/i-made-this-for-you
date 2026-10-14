// Prose stats view: the numbers from prose.ts for one book, plus the words and phrases you repeat most.
import { useEffect, useState } from 'react'
import { fieldText, parseLink, type Row } from './api.ts'
import { dialogueWords, proseStats, proseText, wordsOf, type Count, type ProseStats } from './prose.ts'
import { Help } from './Help.tsx'

const byOrder = (a: Row, b: Row) => (a.order ?? 0) - (b.order ?? 0)

export function ProseView({ slug, rows, onSearch }: { slug: string; rows: Row[]; onSearch: (q: string) => void }) {
  const books = rows.filter((r) => r.type === 'book').sort(byOrder)
  const [bookId, setBookId] = useState('')
  const [stats, setStats] = useState<ProseStats>()
  const [scenes, setScenes] = useState<Scene[]>([])
  const book = books.find((b) => b.id === bookId) ?? books[0]
  useEffect(() => {
    if (!book) return
    const url = `/api/projects/${slug}/books/${book.id}/compile?format=`
    fetch(url + 'md').then((r) => r.text()).then((md) => setStats(proseStats(md)))
    fetch(url + 'scenes').then((r) => r.json()).then(setScenes)
  }, [slug, book?.id, rows])
  // Flesch reading ease is an English formula.
  const english = /^en\b|^$/i.test(fieldText(book?.language).trim())
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
        <span><b>Dialogue</b> is the share of words inside quotation marks. Click any word or phrase to search for it.</span>
        <span><b>Readability</b> is the Flesch reading ease score (English only): 90+ very easy, 60 to 70 plain English, under 30 hard.</span>
        <span><b>Dialogue by point of view</b> is how much of each POV character's scenes is dialogue (not who is speaking).</span>
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
            <div><dt>Sentences</dt><dd>{stats.sentences.toLocaleString()}</dd></div>
            <div><dt>Average sentence</dt><dd>{stats.avgSentence.toFixed(1)} words</dd></div>
            <div><dt>Longest sentence</dt><dd>{stats.longestSentence} words</dd></div>
            <div><dt>Dialogue</dt><dd>{stats.dialogue}%</dd></div>
            {english && stats.words > 0 && (
              <div title="Flesch reading ease: higher is easier. Most novels for adults score 70 to 90.">
                <dt>Readability</dt><dd>{Math.round(stats.flesch)} <small className="muted">{ease(stats.flesch)}</small></dd>
              </div>
            )}
          </dl>
          <DialogueByPov scenes={scenes} byId={byId} />
          <div className="prose-lists">
            {list('Most used words', stats.topWords, 'Leaving out common words like "the" and "said".')}
            {list('Repeated phrases', stats.phrases, 'Three-word phrases used three times or more.')}
            {list('-ly adverbs', stats.adverbs)}
            {list('Words to check', stats.crutches, 'Often cut in revision: just, really, very, suddenly…')}
          </div>
        </>
      )}
    </div>
  )
}

type Scene = { id: string; chapter: string; title: string; pov: string; body: string }

const ease = (f: number) => f >= 90 ? 'very easy' : f >= 70 ? 'easy' : f >= 60 ? 'plain English' : f >= 30 ? 'fairly hard' : 'hard'

// Scenes grouped by their POV character: how many, how long, and the share of their words inside quotes.
function DialogueByPov({ scenes, byId }: { scenes: Scene[]; byId: Map<string, Row> }) {
  const groups = new Map<string, { title: string; scenes: number; words: number; dialogue: number }>()
  for (const s of scenes) {
    const link = parseLink(s.pov)
    const key = link?.[2] ?? ''
    const text = proseText(s.body)
    const g = groups.get(key) ?? { title: link ? byId.get(key)?.title ?? link[1] : 'No POV', scenes: 0, words: 0, dialogue: 0 }
    g.scenes++; g.words += wordsOf(text).length; g.dialogue += dialogueWords(text)
    groups.set(key, g)
  }
  const list = [...groups.values()].sort((a, b) => b.words - a.words)
  if (!list.length) return null
  return (
    <section aria-label="Dialogue by point of view" className="dialogue-pov">
      <h3>Dialogue by point of view</h3>
      <table>
        <tbody>
          {list.map((g) => (
            <tr key={g.title}>
              <td>{g.title}</td>
              <td className="muted">{g.scenes} scene{g.scenes === 1 ? '' : 's'}</td>
              <td className="muted">{g.words.toLocaleString()} words</td>
              <td>{g.words ? Math.round((g.dialogue / g.words) * 100) : 0}% dialogue</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
