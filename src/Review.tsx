// Review checklist: inline comments on passages plus notes on a whole entity. Ticked items stay, marked done.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { api, MANUSCRIPT_TYPES, type ReviewNote, type Row } from './api.ts'
import { commentRanges } from './comment.ts'
import { manuscriptTree } from './Manuscript.tsx'
import { Help } from './Help.tsx'

// What the inline input adds or edits: a comment on a range, or (no range) a note on the whole entity.
export type Draft = { from: number; to: number; note: string; done: boolean } | { from?: undefined; note: string }

type PanelProps = {
  editor: Editor | null; notes: ReviewNote[]; onNotes: (n: ReviewNote[]) => void
  draft: Draft | null; onDraft: (d: Draft | null) => void
}

// The doc's comments, re-read only when they change.
const useComments = (editor: Editor | null) => useEditorState({
  editor, selector: ({ editor }) => (editor ? commentRanges(editor.state.doc) : []),
  equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
}) ?? []

// Set (or with null, remove) the comment on a range without moving the cursor. The edit autosaves like typing,
// and works in review mode too (read-only only blocks typing).
function setComment(editor: Editor | null, from: number, to: number, attrs: { note: string; done: boolean } | null) {
  const type = editor?.schema.marks.comment
  if (!editor || !type) return
  const tr = editor.state.tr.removeMark(from, to, type)
  editor.view.dispatch(attrs ? tr.addMark(from, to, type.create(attrs)) : tr)
}
const jumpTo = (editor: Editor | null, from: number, to: number) =>
  editor?.chain().focus().setTextSelection({ from, to }).scrollIntoView().run()

// In the editor, under the fields.
export function ReviewPanel({ editor, notes, onNotes, draft, onDraft }: PanelProps) {
  const [showDone, setShowDone] = useState(false)
  const ranges = useComments(editor)
  const mark = (from: number, to: number, attrs: { note: string; done: boolean } | null) => setComment(editor, from, to, attrs)
  const jump = (from: number, to: number) => jumpTo(editor, from, to)

  function commit() {
    if (!draft) return
    const note = draft.note.trim()
    if (draft.from === undefined) {
      if (note) onNotes([...notes, { note, done: false }])
    } else {
      mark(draft.from, draft.to, note ? { note, done: draft.done } : null) // empty note removes the comment
      editor?.chain().focus().setTextSelection(draft.to).run()
    }
    onDraft(null)
  }

  const open = ranges.filter((r) => !r.done).length + notes.filter((n) => !n.done).length
  const shown = <T extends { done: boolean }>(xs: T[]) => xs.map((x, i) => ({ ...x, i })).filter((x) => showDone || !x.done)
  return (
    <section className={`review ${draft ? 'drafting' : ''}`} aria-label="Review">
      <div className="review-head">
        <b>Review</b> <small>{open} open</small>
        <button className="mini" onClick={() => onDraft({ note: '' })} title="A note on this whole entry">+ Note</button>
        <label><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> show done</label>
      </div>
      {draft && (
        <div className="review-draft">
          {draft.from !== undefined && <q>{editor?.state.doc.textBetween(draft.from, draft.to, ' ')}</q>}
          <input autoFocus aria-label={draft.from === undefined ? 'Note' : 'Comment'} value={draft.note}
            placeholder={draft.from === undefined ? 'Note on this whole entry… (Enter to save)' : 'Comment… (Enter to save, empty removes)'}
            onChange={(e) => onDraft({ ...draft, note: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') onDraft(null) }} />
          <button className="mini" onClick={commit}>Save</button>
          <button className="mini" onClick={() => onDraft(null)}>Cancel</button>
        </div>
      )}
      <ul className="review-items">
        {shown(ranges).map((r) => (
          <li key={`p${r.i}`} className={r.done ? 'done' : ''}>
            <input type="checkbox" checked={r.done} aria-label={`Done: ${r.note}`}
              onChange={() => mark(r.from, r.to, { note: r.note, done: !r.done })} />
            <button className="link" onClick={() => jump(r.from, r.to)} title="Show in the text"><q>{r.text}</q> {r.note}</button>
            <button className="mini" aria-label={`Remove comment ${r.note}`} title="Remove the comment (keeps the text)"
              onClick={() => mark(r.from, r.to, null)}>×</button>
          </li>
        ))}
        {shown(notes).map((n) => (
          <li key={`n${n.i}`} className={n.done ? 'done' : ''}>
            <input type="checkbox" checked={n.done} aria-label={`Done: ${n.note}`}
              onChange={() => onNotes(notes.map((x, j) => (j === n.i ? { ...x, done: !x.done } : x)))} />
            <span>{n.note}</span>
            <button className="mini" aria-label={`Remove note ${n.note}`} onClick={() => onNotes(notes.filter((_, j) => j !== n.i))}>×</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Review mode: open comments as boxes in the right margin, each level with its passage (pushed down to not overlap).
export function ReviewMargin({ editor }: { editor: Editor | null }) {
  const ranges = useComments(editor).map((r, i) => ({ ...r, i })).filter((r) => !r.done)
  const box = useRef<HTMLDivElement>(null)
  const [tops, setTops] = useState<number[]>([])
  const layout = () => {
    const el = box.current
    if (!el || !editor) return
    const base = el.getBoundingClientRect().top
    let next = 0
    const t = [...el.children].map((c, k) => {
      const top = Math.max(editor.view.coordsAtPos(ranges[k].from).top - base, next)
      next = top + (c as HTMLElement).offsetHeight + 6
      return Math.round(top)
    })
    setTops((old) => (old.join() === t.join() ? old : t))
  }
  useLayoutEffect(layout) // after every render: comments, panel above or box heights may have moved things
  // Re-place the boxes whenever the text reflows: window resized, or the comment column appearing narrows it.
  useEffect(() => {
    if (!editor) return
    const ro = new ResizeObserver(() => layout())
    ro.observe(editor.view.dom)
    return () => ro.disconnect()
  })
  return (
    <div ref={box} className="review-margin" aria-label="Comments in the margin">
      {ranges.map((r, k) => (
        <div key={r.i} className="margin-note" style={{ top: tops[k] ?? 0 }} title="Show in the text"
          onClick={() => jumpTo(editor, r.from, r.to)}>
          <input type="checkbox" checked={false} aria-label={`Done: ${r.note}`} onClick={(e) => e.stopPropagation()}
            onChange={() => setComment(editor, r.from, r.to, { note: r.note, done: true })} />
          <span>{r.note}</span>
        </div>
      ))}
    </div>
  )
}

// As server/review.ts sends them.
export type ReviewItem = { kind: 'passage' | 'note'; index: number; text?: string; note: string; done: boolean }
export type ReviewEntry = { id: string; items: ReviewItem[] }
export const openCount = (review: ReviewEntry[]) => review.reduce((n, e) => n + e.items.filter((i) => !i.done).length, 0)

// Project-wide: every entity with review items, the manuscript in reading order first, then the wiki.
export function ReviewView({ slug, rows, review, onOpen, refresh }: {
  slug: string; rows: Row[]; review: ReviewEntry[]; onOpen: (id: string, item?: number) => void; refresh: () => void
}) {
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState('')
  const items = new Map(review.map((e) => [e.id, e.items]))
  const tree = manuscriptTree(rows)
  const inTree = new Set(tree.map((t) => t.row.id))
  const wikiLast = (r: Row) => +!MANUSCRIPT_TYPES.includes(r.type) // unfiled chapters/scenes before the wiki
  const ordered = [...tree, ...rows.filter((r) => !inTree.has(r.id)).sort((a, b) => wikiLast(a) - wikiLast(b)).map((row) => ({ row, depth: 0 }))]
  const tick = (id: string, i: ReviewItem) =>
    api(`/projects/${slug}/entities/${id}/review`, 'PATCH', { kind: i.kind, index: i.index, done: !i.done })
      .then(() => { setError(''); refresh() }, (e) => setError(e.message))
  return (
    <div className="review-view">
      <h2>Review <small className="muted">{openCount(review)} open</small> <Help>
        <span>Your to-do list of edits, across the whole project: book order first, then the wiki.</span>
        <span>Add them in an entry: select text and click <b>Comment</b> for a note on that passage, or <b>+ Note</b> in its Review box for
          a note on the whole entry.</span>
        <span>Tick an item when it's dealt with; it stays (marked done) so you can re-open it with <b>show done</b>.
          Click an item to open it, with the passage selected.</span>
      </Help></h2>
      <label><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> show done</label>
      {error && <p className="error">{error}</p>}
      {ordered.map(({ row, depth }) => {
        const list = (items.get(row.id) ?? []).filter((i) => showDone || !i.done)
        if (!list.length) return null
        return (
          <section key={row.id} className={`review-entity depth-${depth}`}>
            <h4><button className="link" onClick={() => onOpen(row.id)}>{row.title}</button> <small>{row.type}</small></h4>
            <ul className="review-items">
              {list.map((i) => (
                <li key={i.kind + i.index} className={i.done ? 'done' : ''}>
                  <input type="checkbox" checked={i.done} aria-label={`Done: ${i.note}`} onChange={() => tick(row.id, i)} />
                  <button className="link" onClick={() => onOpen(row.id, i.kind === 'passage' ? i.index : undefined)}>
                    {i.text !== undefined && <q>{i.text}</q>} {i.note}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {!openCount(review) && !showDone && <p className="muted">Nothing to review. Select text and click Comment, or add a note to an entry.</p>}
    </div>
  )
}
