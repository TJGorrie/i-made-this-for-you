// Entity editor: title + template fields + rich-text body, autosaved.
import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { WikiLink, type LinkTarget } from './wikiLink.ts'
import { Backlinks, LinkPreview } from './Links.tsx'
import { RelationshipList } from './Relationships.tsx'
import { MapView } from './MapView.tsx'
import { HistoryPanel } from './History.tsx'
import { api, fieldText, fingerprint, MANUSCRIPT_TYPES, parseField, parseLink, RESERVED_FIELDS, reviewNotes, STATUSES, uploadImage, type Entity } from './api.ts'
import { Comment, commentRanges } from './comment.ts'
import { Focus } from './focus.ts'
import { Overused } from './overused.ts'
import { ageAt } from './continuity.ts'
import { ReviewMargin, ReviewPanel, type Draft } from './Review.tsx'

const AUTOSAVE_MS = 800

type Props = {
  url: string; fields: string[]; targets: LinkTarget[]
  onSaved: () => void; onDeleted: () => void; onOpenType: (type: string) => void
  onOpen: (id: string, beside?: boolean) => void // beside: open in the split pane
  onFocusMode?: () => void; onClose?: () => void
  focusItem?: number // select the nth inline comment once loaded (opened from the Review view)
  born?: Map<string, number> // birth years, to show ages next to linked characters (from the entry's date)
  highlight?: boolean; onHighlight?: (on: boolean) => void // mark crutch words and -ly adverbs in the text
}
type Conflict = { fields: string[]; current: Entity }

const linkAt = (t: EventTarget) => (t as HTMLElement).closest?.<HTMLElement>('[data-wiki-link]')

export function Editor(props: Props) {
  // n counts completed loads, so the form remounts only once fresh data has arrived (reload after a conflict).
  const [loaded, setLoaded] = useState<{ entity: Entity; n: number }>()
  const load = () => api(props.url).then((entity) => setLoaded((p) => ({ entity, n: (p?.n ?? 0) + 1 })))
  useEffect(() => void load(), [props.url])
  return loaded ? <Form key={loaded.n} initial={loaded.entity} onReload={load} {...props} /> : null
}

function Form({ initial, url, fields: specs, targets, onSaved, onDeleted, onOpenType, onOpen, onReload, onFocusMode, onClose, focusItem, born, highlight, onHighlight }: Props & { initial: Entity; onReload: () => void }) {
  const [values, setValues] = useState(initial)
  const [status, setStatus] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const forceSnapshot = useRef(false) // next save keeps a version first (set when overwriting an outside edit)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [reviewing, setReviewing] = useState(false) // review mode: text read-only
  const targetsRef = useRef(targets) // the @ menu reads the latest list without recreating the editor
  targetsRef.current = targets
  // Only changed fields are sent, so a save never overwrites what drag-reorder changed (parent/order).
  const pending = useRef<Record<string, unknown>>({})
  const bodyDirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const chain = useRef(Promise.resolve()) // saves go out one at a time, in order
  const inFlight = useRef(0)
  const conflictRef = useRef(conflict)
  conflictRef.current = conflict
  // Fingerprint of each field as last loaded/saved; the server refuses a save if the file no longer matches.
  const base = useRef<Record<string, string>>({})
  const baseOf = async (k: string) => (base.current[k] ??= await fingerprint(initial[k]))
  const unsaved = () => bodyDirty.current || Object.keys(pending.current).length > 0 || inFlight.current > 0 || !!conflictRef.current

  // Save on switching entity and on closing the tab. Declared before useEditor so this cleanup runs before the editor is destroyed.
  const flushRef = useRef<(keepalive: boolean) => void>(() => {})
  useEffect(() => {
    const onHide = () => flushRef.current(true)
    // keepalive requests are capped at 64KB, so a long scene may not make it out while the tab closes:
    // if anything is unsaved, start saving and have the browser ask "Leave site?".
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsaved()) return
      flushRef.current(true)
      e.preventDefault()
    }
    addEventListener('pagehide', onHide)
    addEventListener('beforeunload', onBeforeUnload)
    return () => {
      removeEventListener('pagehide', onHide)
      removeEventListener('beforeunload', onBeforeUnload)
      flushRef.current(false)
    }
  }, [])

  const editor = useEditor({
    extensions: [StarterKit, Markdown, WikiLink.configure({ targets: () => targetsRef.current }), Comment, Focus, Overused],
    content: initial.body,
    contentType: 'markdown',
    onUpdate: () => {
      bodyDirty.current = true
      schedule()
      setDraft((d) => (d?.from === undefined ? d : null)) // the text changed under a comment being written: its range is stale
    },
  })

  useEffect(() => editor?.setEditable(!reviewing, false), [editor, reviewing]) // false: not an edit, don't save

  useEffect(() => {
    const r = focusItem === undefined || !editor ? undefined : commentRanges(editor.state.doc)[focusItem]
    if (r) editor!.chain().focus().setTextSelection({ from: r.from, to: r.to }).scrollIntoView().run()
  }, [editor])

  function schedule() {
    if (!conflictRef.current) setStatus('Unsaved')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(false), AUTOSAVE_MS)
  }

  function flush(keepalive: boolean) {
    clearTimeout(timer.current)
    if (bodyDirty.current && editor) pending.current.body = editor.getMarkdown()
    bodyDirty.current = false
    if (conflictRef.current) return // hold edits until the user resolves the conflict
    const patch = pending.current
    pending.current = {}
    if (!Object.keys(patch).length) return
    inFlight.current++
    chain.current = chain.current.then(async () => {
      setStatus('Saving…')
      const $snapshot = forceSnapshot.current
      try {
        const $base = Object.fromEntries(await Promise.all(Object.keys(patch).map(async (k) => [k, await baseOf(k)])))
        const res = await fetch('/api' + url, {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...patch, $base, $snapshot }), keepalive,
        })
        if (res.status === 409) {
          const { conflict: fields, current } = await res.json()
          pending.current = { ...patch, ...pending.current } // keep the user's edits
          setConflict({ fields, current })
          setStatus('Not saved: changed elsewhere')
          return
        }
        if (!res.ok) throw new Error(await res.text())
        for (const [k, v] of Object.entries(patch)) base.current[k] = await fingerprint(v)
        if ($snapshot) forceSnapshot.current = false
        setStatus('Saved')
        onSaved()
      } catch (err) {
        // Put the unsaved changes back (newer edits win) and retry; never drop text.
        pending.current = { ...patch, ...pending.current }
        setStatus(`Save failed, retrying: ${(err as Error).message}`)
        timer.current = setTimeout(() => flush(false), 3000)
      } finally {
        inFlight.current--
      }
    })
  }

  flushRef.current = flush

  const set = (k: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [k]: v }))
    pending.current[k] = v
    schedule()
  }
  const discardEdits = () => { clearTimeout(timer.current); pending.current = {}; bodyDirty.current = false }
  const remove = () =>
    confirm(`Delete "${values.title}"?`) && api(url, 'DELETE').then(() => { discardEdits(); onDeleted() }, (e) => alert(e.message))

  // Before restoring a version: save pending edits so they land in history too.
  async function settle() {
    if (conflictRef.current) { alert('Resolve the "changed elsewhere" notice first.'); return false }
    flush(false)
    await chain.current
    if (unsaved()) { alert("Your latest edits couldn't be saved yet; try again in a moment."); return false }
    return true
  }

  const resolveConflict = async (keepMine: boolean) => {
    if (!conflict) return
    if (!keepMine) { discardEdits(); setConflict(null); return onReload() }
    for (const k of conflict.fields) base.current[k] = await fingerprint(conflict.current[k]) // overwrite what's on disk
    forceSnapshot.current = true // ...but keep the outside edit in history
    conflictRef.current = null
    setConflict(null)
    flush(false)
  }

  const assetsUrl = '/api' + url.replace(/entities\/[^/]+$/, 'assets')

  // Select text → Comment opens the note input in the review panel; inside an existing comment it edits that one.
  // The range is captured now, so focus moving to the input can't lose the selection.
  function comment() {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    const inside = commentRanges(editor.state.doc).find((r) => r.from <= from && to <= r.to)
    if (inside) setDraft({ from: inside.from, to: inside.to, note: inside.note, done: inside.done })
    else if (empty) alert('Select some text to comment on.')
    else setDraft({ from, to, note: '', done: false })
  }

  // Template fields first, then any extra text fields this entity has (added here or by hand in the file).
  const fields = specs.map(parseField)
  const extra = Object.keys(values)
    .filter((k) => !RESERVED_FIELDS.includes(k) && !fields.some((f) => f.name === k) && typeof values[k] !== 'object')
    .map((name) => ({ name, linkType: undefined, multiple: false }))
  const ageOf = (id: string) => { const a = born && ageAt(born, id, fieldText(values.date)); return a === undefined ? '' : `age ${a}` }
  const optionsFor = (linkType: string) => (linkType === '*' ? targets : targets.filter((t) => t.type === linkType))
  const addField = () => {
    const name = prompt('Field name')?.trim()
    if (name && !RESERVED_FIELDS.includes(name) && !(name in values)) set(name, '')
  }

  return (
    <div className={`editor ${reviewing ? 'reviewing' : ''}`}>
      <div className="statusbar">
        <button className="link type-link" onClick={() => onOpenType(values.type)}>{values.type}</button>
        <small>{status}</small>
        {onFocusMode && <button className="mini focus-hide" onClick={() => { setReviewing(false); onFocusMode() }} title="Hide everything but the text (Esc to leave)">Focus</button>}
        {/* preventDefault on mousedown: the click mustn't take focus (and the selection) away from the text. */}
        <button className="mini focus-hide" onMouseDown={(e) => e.preventDefault()} onClick={comment} title="Comment on the selected text (or edit the comment under the cursor)">Comment</button>
        <button className="mini focus-hide" onClick={() => setReviewing((r) => !r)} aria-pressed={reviewing}
          title="Review mode: make the text read-only while you go through comments">Review</button>
        <ReadAloud editor={editor} />
        {onHighlight && <button className="mini focus-hide" onClick={() => onHighlight(!highlight)} aria-pressed={!!highlight}
          title="Mark crutch words (just, really, suddenly…) and -ly adverbs in the text">Highlight</button>}
        <button className="mini focus-hide" onClick={() => setShowHistory((s) => !s)} aria-pressed={showHistory}>History</button>
        <button className="mini focus-hide" onClick={remove}>Delete</button>
        {onClose && <button className="mini" onClick={onClose} aria-label="Close side pane">×</button>}
      </div>
      {showHistory && (
        <HistoryPanel url={url} beforeRestore={settle} onClose={() => setShowHistory(false)}
          onRestored={() => { discardEdits(); onReload(); onSaved() }} />
      )}
      {conflict && (
        <div className="conflict" role="alert">
          <b>{conflict.fields.join(', ')}</b> changed outside the app since you opened this (another editor, tab or sync).
          Your recent edits are not saved yet.
          <div>
            <button onClick={() => resolveConflict(false)}>Load the file's version</button>{' '}
            <button onClick={() => resolveConflict(true)}>Keep mine (overwrite)</button>
          </div>
        </div>
      )}
      <input className="title" aria-label="Title" value={values.title} onChange={(e) => set('title', e.target.value)} />
      <div className="fields">
        {[...fields, ...extra].map(({ name, linkType, multiple }) => (
          <div key={name} className="field-row">
            <span>{name}</span>
            {linkType === 'image'
              ? <ImageField name={name} value={values[name]} multiple={multiple} assetsUrl={assetsUrl} onChange={(v) => set(name, v)} />
              : linkType && multiple
              ? <LinkListField name={name} value={values[name]} options={optionsFor(linkType)} showType={linkType === '*'}
                  onChange={(v) => set(name, v)} onOpen={onOpen} note={ageOf} />
              : linkType
              ? <LinkField name={name} value={fieldText(values[name])} options={optionsFor(linkType)}
                  onChange={(v) => set(name, v)} onOpen={onOpen} note={ageOf} />
              : name === 'status'
              ? <><input list="statuses" aria-label={name} value={fieldText(values[name])} onChange={(e) => set(name, e.target.value)} />
                  <datalist id="statuses">{STATUSES.map((s) => <option key={s} value={s} />)}</datalist></>
              : <textarea rows={1} aria-label={name} value={fieldText(values[name])} onChange={(e) => set(name, e.target.value)} />}
          </div>
        ))}
        <button className="mini add-field" onClick={addField}>+ field</button>
      </div>
      <ReviewPanel editor={editor} notes={reviewNotes(values.review)} onNotes={(n) => set('review', n)} draft={draft} onDraft={setDraft} />
      {values.type === 'map' && (
        <MapView
          assetsUrl={assetsUrl}
          image={fieldText(values.image)} pins={values.pins} targets={targets.filter((t) => t.id !== values.id)}
          onImage={(name) => set('image', name)} onPins={(pins) => set('pins', pins)} onOpen={onOpen}
        />
      )}
      {!MANUSCRIPT_TYPES.includes(values.type) && (
        <RelationshipList
          value={values.relationships} targets={targets.filter((t) => t.id !== values.id)}
          onChange={(rels) => set('relationships', rels)}
        />
      )}
      <div
        className={`prose-wrap ${reviewing ? 'reviewing' : ''}`}
        onMouseOver={(e) => {
          const l = linkAt(e.target)
          if (l && l.dataset.wikiLink !== hover?.id) {
            const r = l.getBoundingClientRect()
            setHover({ id: l.dataset.wikiLink!, x: r.left, y: r.bottom })
          }
        }}
        onMouseOut={(e) => linkAt(e.target) && setHover(null)}
        onClick={(e) => {
          const l = linkAt(e.target)
          if (l && (e.ctrlKey || e.metaKey)) onOpen(l.dataset.wikiLink!)
          else if (l && e.shiftKey) { e.preventDefault(); onOpen(l.dataset.wikiLink!, true) }
        }}
      >
        <EditorContent editor={editor} className="prose" />
        <ReviewMargin editor={editor} />
      </div>
      {hover && <LinkPreview key={hover.id} url={url.replace(/[^/]+$/, hover.id)} x={hover.x} y={hover.y} />}
      <Backlinks url={url} onOpen={onOpen} unlinked={!MANUSCRIPT_TYPES.includes(values.type)} />
    </div>
  )
}

// One uploaded image (e.g. a portrait) or several (a gallery). Click a picture to open it full size.
function ImageField({ name, value, multiple, assetsUrl, onChange }: {
  name: string; value: unknown; multiple: boolean; assetsUrl: string; onChange: (v: string | string[]) => void
}) {
  const [error, setError] = useState('')
  const names = (Array.isArray(value) ? value : fieldText(value) ? [value] : []).map(String)
  async function add(files: FileList) {
    setError('')
    try {
      const added = await Promise.all([...files].map((f) => uploadImage(assetsUrl, f)))
      onChange(multiple ? [...names, ...added] : added[0])
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="image-field">
      {names.map((n, i) => (
        <figure key={n}>
          <a href={`${assetsUrl}/${n}`} target="_blank"><img src={`${assetsUrl}/${n}`} alt={`${name} ${i + 1}`} /></a>
          <button className="mini" aria-label={`Remove ${n}`} onClick={() => onChange(multiple ? names.filter((_, j) => j !== i) : '')}>×</button>
        </figure>
      ))}
      {(multiple || !names.length) && (
        <label className="mini upload">
          {multiple ? '+ add images' : 'Upload image'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple={multiple} hidden aria-label={name}
            onChange={(e) => e.target.files?.length && add(e.target.files)} />
        </label>
      )}
      {error && <small className="error">{error}</small>}
    </div>
  )
}

// A field holding a list of [[links]] (e.g. characters appearing in a scene): chips plus an "add" dropdown.
function LinkListField({ name, value, options, showType, onChange, onOpen, note }: {
  name: string; value: unknown; options: LinkTarget[]; showType: boolean; onChange: (v: string[]) => void; onOpen: (id: string) => void
  note: (id: string) => string
}) {
  // Tolerate a single string from a hand-edited file.
  const items = (Array.isArray(value) ? value : fieldText(value) ? [value] : []).map(String)
  const links = items.map((raw) => ({ raw, link: parseLink(raw) }))
  const label = ({ raw, link }: (typeof links)[number]) =>
    link ? options.find((o) => o.id === link[2])?.title ?? `${link[1]} (missing)` : raw
  return (
    <div className="link-list">
      {links.map((l, i) => (
        <span key={i} className="chip">
          <button className="chip-open" onClick={() => l.link && onOpen(l.link[2])}>
            {label(l)}{l.link && note(l.link[2]) && <small className="muted"> · {note(l.link[2])}</small>}
          </button>
          <button className="chip-x" aria-label={`Remove ${label(l)}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}
      <select aria-label={name} value=""
        onChange={(e) => {
          const t = options.find((o) => o.id === e.target.value)
          if (t) onChange([...items, `[[${t.title}|${t.id}]]`])
        }}>
        <option value="">+ add…</option>
        {options.filter((o) => !links.some((l) => l.link?.[2] === o.id)).map((o) => (
          <option key={o.id} value={o.id}>{showType ? `${o.title} (${o.type})` : o.title}</option>
        ))}
      </select>
    </div>
  )
}

// A field holding a [[link]] to one entity of a given type (e.g. a scene's POV character).
function LinkField({ name, value, options, onChange, onOpen, note }: {
  name: string; value: string; options: LinkTarget[]; onChange: (v: string) => void; onOpen: (id: string) => void
  note: (id: string) => string
}) {
  const link = parseLink(value)
  const id = link?.[2] ?? ''
  return (
    <div className="link-field">
      <select aria-label={name} value={link ? id : value ? '\u0000raw' : ''}
        onChange={(e) => {
          const t = options.find((o) => o.id === e.target.value)
          onChange(t ? `[[${t.title}|${t.id}]]` : '')
        }}>
        <option value="">—</option>
        {/* Keep showing values that aren't a known entity instead of silently blanking them. */}
        {value && !link && <option value={'\u0000raw'}>{value}</option>}
        {link && !options.some((o) => o.id === id) && <option value={id}>{link[1]} (missing)</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
      </select>
      {link && <button className="mini" onClick={() => onOpen(id)}>open</button>}
      {link && note(id) && <small className="muted">{note(id)}</small>}
    </div>
  )
}

// Read the selection aloud, or from the cursor to the end, with the browser's own speech.
function ReadAloud({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => () => speechSynthesis?.cancel(), []) // stop when the entry closes
  if (!('speechSynthesis' in window)) return null
  function toggle() {
    speechSynthesis.cancel()
    if (speaking || !editor) return setSpeaking(false)
    const { from, to, empty } = editor.state.selection
    const text = editor.state.doc.textBetween(from, empty ? editor.state.doc.content.size : to, '\n')
    if (!text.trim()) return
    const u = new SpeechSynthesisUtterance(text)
    u.onend = u.onerror = () => setSpeaking(false)
    speechSynthesis.speak(u)
    setSpeaking(true)
  }
  return (
    <button className="mini focus-hide" onMouseDown={(e) => e.preventDefault()} onClick={toggle} aria-pressed={speaking}
      title="Read the selection aloud, or from the cursor to the end">{speaking ? 'Stop' : 'Read aloud'}</button>
  )
}
