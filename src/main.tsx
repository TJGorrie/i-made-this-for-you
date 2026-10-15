import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { aliasesOf, api, MANUSCRIPT_TYPES, type Calendar, type Row } from './api.ts'
import { Editor, type Highlight } from './Editor.tsx'
import type { Passage } from './Links.tsx'
import { DEFAULT_WORDS, type WordLists } from './prose.ts'
import { Manuscript } from './Manuscript.tsx'
import { Board } from './Board.tsx'
import { ProseView } from './Prose.tsx'
import { TypeTable } from './Wiki.tsx'
import { SearchResults } from './Search.tsx'
import { Timeline } from './Timeline.tsx'
import { Graph } from './Relationships.tsx'
import { DeletedItems } from './History.tsx'
import { TemplateEditor } from './Templates.tsx'
import { Today, WritingLog } from './Goals.tsx'
import { openCount, ReviewView, type ReviewEntry } from './Review.tsx'
import { Shortcuts } from './Help.tsx'
import { Cast } from './Cast.tsx'
import { Drafts } from './Drafts.tsx'
import { birthYears, type Link } from './continuity.ts'

type Project = { name: string; templates: Record<string, string[]>; calendar?: Calendar; words?: WordLists }
type Tool = 'board' | 'timeline' | 'graph' | 'templates' | 'deleted' | 'log' | 'review' | 'prose' | 'cast' | 'drafts'


// Theme: follows the system unless picked; remembered per browser (best effort, storage may be blocked).
type Theme = 'system' | 'light' | 'dark'
const THEMES: Theme[] = ['system', 'light', 'dark']
const storedTheme = (): Theme => { try { return (localStorage.getItem('theme') as Theme) || 'system' } catch { return 'system' } }
function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try { localStorage.setItem('theme', t) } catch {}
}
applyTheme(storedTheme())

function ThemeToggle() {
  const [theme, setTheme] = useState(storedTheme)
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
  return (
    <button className="mini theme-toggle" title={`Theme: ${theme} (click for ${next})`} aria-label={`Theme: ${theme}`}
      onClick={() => { applyTheme(next); setTheme(next) }}>
      {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}
    </button>
  )
}

function App() {
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([])
  const [slug, setSlug] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [folder, setFolder] = useState('') // projects folder; changing it reloads the list
  useEffect(() => void api('/projects').then(setProjects), [slug, folder])

  if (slug) return <ProjectView slug={slug} onClose={() => setSlug(null)} />
  const create = () =>
    api('/projects', 'POST', { name }).then((p) => setSlug(p.slug), (e) => setError(e.message))
  async function restore(file: File) {
    const res = await fetch('/api/projects/restore', { method: 'POST', body: file })
    if (!res.ok) return setError(await res.text())
    setSlug((await res.json()).slug)
  }
  return (
    <main className="projects">
      <h2>Projects <ThemeToggle /></h2>
      {projects.map((p) => (
        <div key={p.slug} className="project-row">
          <button className="link" onClick={() => setSlug(p.slug)}>{p.name}</button>
          <a className="mini" href={`/api/projects/${p.slug}/backup`} download title="Download the whole project, history included, as a .zip">back up</a>
        </div>
      ))}
      <p>
        <input placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} />{' '}
        <button onClick={create} disabled={!name.trim()}>Create</button>{' '}
        <label className="mini upload" title="Restore a backup .zip as a new project (existing projects are never changed)">
          Restore a backup
          <input type="file" accept=".zip" hidden aria-label="Restore a backup"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f) }} />
        </label>
      </p>
      {error && <p className="error">{error}</p>}
      <Settings onFolder={setFolder} />
    </main>
  )
}

type AppSettings = { projectsDir: string; locked: boolean; packaged: boolean }

function Settings({ onFolder }: { onFolder: (dir: string) => void }) {
  const [settings, setSettings] = useState<AppSettings>()
  const [dir, setDir] = useState('')
  const [message, setMessage] = useState('')
  const [stopped, setStopped] = useState(false)
  const loaded = (s: AppSettings) => { setSettings(s); setDir(s.projectsDir); onFolder(s.projectsDir) }
  useEffect(() => void api('/settings').then(loaded), [])
  if (stopped) return <p className="stopped">IMadeThisForYou has stopped. You can close this tab; open the app again to keep writing.</p>
  if (!settings) return null
  const save = () => api('/settings', 'PUT', { projectsDir: dir }).then((s) => { loaded(s); setMessage('Now using this folder.') }, (e) => setMessage(e.message))
  return (
    <section className="settings">
      <h3>Settings</h3>
      <label>
        Projects folder
        <input aria-label="Projects folder" value={dir} disabled={settings.locked} onChange={(e) => setDir(e.target.value)} />
      </label>
      <button onClick={save} disabled={settings.locked || !dir.trim() || dir === settings.projectsDir}>Use this folder</button>
      <p className="muted">
        Each project is a folder of Markdown files in here (a synced folder like Dropbox or OneDrive works).
        Switching folders doesn't move your projects: copy their folders across yourself.
      </p>
      {settings.locked && <p className="muted">Set by the PROJECTS_DIR environment variable.</p>}
      {message && <p>{message}</p>}
      <p className="muted">
        This software is free, and if you paid for it you've been scammed. If you'd like to support me, please{' '}
        <a href="https://ko-fi.com/tgorrie" target="_blank" rel="noreferrer">buy me a coffee</a>!
      </p>
      {settings.packaged && (
        <>
          <p><button onClick={() => api('/quit', 'POST').then(() => setStopped(true), (e) => setMessage(e.message))}>Quit IMadeThisForYou</button></p>
          <p className="muted">
            © TJGorrie · <a href="/LICENSE.txt" target="_blank">License</a> · <a href="/THIRD-PARTY-NOTICES.txt" target="_blank">Third-party notices</a>
          </p>
        </>
      )}
    </section>
  )
}

function ProjectView({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [project, setProject] = useState<Project>()
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [side, setSide] = useState<string | null>(null) // entity open in the split pane
  const [typeView, setTypeView] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [query, setQuery] = useState('')
  const [tool, setTool] = useState<Tool | null>(null)
  const [focus, setFocus] = useState(false)
  const [review, setReview] = useState<ReviewEntry[]>([])
  const [focusItem, setFocusItem] = useState<Passage>() // passage to select when the editor opens
  const [menu, setMenu] = useState(false) // narrow screens: the sidebar opens over the page
  const [hideSide, setHideSide] = useState(() => { try { return localStorage.getItem('sidebar') === 'hidden' } catch { return false } }) // wide screens
  const [shortcuts, setShortcuts] = useState(false)
  const [links, setLinks] = useState<Link[]>([])
  const [epoch, setEpoch] = useState(0) // bumped when files change behind open editors (find & replace): they reload
  const [typewriter, setTypewriter] = useState(false) // focus mode: keep the caret mid-screen
  const [dim, setDim] = useState(false) // focus mode: fade all but the current paragraph
  const [highlight, setHighlight] = useState<Highlight>('') // what to mark in the text
  const searchRef = useRef<HTMLInputElement>(null)
  const refresh = async () => {
    const [r, rv, l] = await Promise.all([api(`/projects/${slug}/entities`), api(`/projects/${slug}/review`), api(`/projects/${slug}/links`)])
    setRows(r); setReview(rv); setLinks(l)
  }
  useEffect(() => {
    api(`/projects/${slug}`).then(setProject)
    refresh()
    // Pick up files changed elsewhere (another editor, git, sync) when you come back to the app.
    const onFocus = () => refresh()
    addEventListener('focus', onFocus)
    return () => removeEventListener('focus', onFocus)
  }, [slug])
  useEffect(() => { try { localStorage.setItem('sidebar', hideSide ? 'hidden' : 'shown') } catch {} }, [hideSide])
  useEffect(() => {
    if (!focus) return
    const pm = document.querySelector('.prose .ProseMirror')
    pm?.setAttribute('spellcheck', 'false') // no red squiggles while writing
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocus(false)
    addEventListener('keydown', onKey)
    return () => { removeEventListener('keydown', onKey); pm?.removeAttribute('spellcheck') }
  }, [focus])
  // Ctrl/⌘+K: search. Ctrl/⌘+\: hide/show the sidebar. "?" (when not typing): the shortcuts sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setFocus(false); setMenu(true); setHideSide(false)
        setTimeout(() => searchRef.current?.focus()) // after focus mode / the menu has shown the sidebar
      } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        setHideSide((h) => !h)
      } else if (e.key === '?' && !typing) setShortcuts(true)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  if (!project) return null
  const open = (id: string, beside = false) => {
    if (beside) {
      if (id !== selected) setSide(id)
      return
    }
    setSelected(id); setTypeView(null); setTool(null); setFocusItem(undefined); setMenu(false)
    if (side === id) setSide(null)
  }
  const openAt = (id: string, at: Passage) => { open(id); setFocusItem(at) }
  const openType = (t: string) => { setSelected(null); setTypeView(t); setTool(null); setMenu(false) }
  const openTool = (t: Tool | null) => { setSelected(null); setTypeView(null); setTool(t); if (t) setMenu(false) }
  const create = async (type: string) => {
    const title = prompt(`New ${type} title`)?.trim()
    if (!title) return
    const e = await api(`/projects/${slug}/entities`, 'POST', { type, title, body: '' })
    await refresh()
    open(e.id)
  }
  // Template types (even if empty) plus any type found in files; manuscript types live in the tree.
  const types = [...new Set([...Object.keys(project.templates), ...rows.map((r) => r.type)])]
    .filter((t) => !MANUSCRIPT_TYPES.includes(t))
  const matches = (r: Row) => [r.title, ...aliasesOf(r.aliases)].some((n) => n.toLowerCase().includes(filter.toLowerCase()))
  const current = rows.find((r) => r.id === selected)
  const sideRow = rows.find((r) => r.id === side)
  const targets = rows.filter((r) => !MANUSCRIPT_TYPES.includes(r.type)).map((r) => ({ ...r, aliases: aliasesOf(r.aliases) }))
  const born = birthYears(rows, links)
  const editorFor = (r: Row, inSide: boolean) => (
    <Editor
      key={`${r.id}:${epoch}`}
      born={born}
      highlight={highlight}
      onHighlight={setHighlight}
      words={project.words}
      url={`/projects/${slug}/entities/${r.id}`}
      fields={project.templates[r.type] ?? []}
      onSaved={refresh}
      onDeleted={() => { if (inSide) setSide(null); else openType(r.type); refresh() }}
      onOpenType={openType}
      onOpen={open}
      onOpenAt={openAt}
      targets={targets}
      onFocusMode={inSide ? undefined : () => setFocus(true)}
      onClose={inSide ? () => setSide(null) : undefined}
      focusItem={inSide ? undefined : focusItem}
    />
  )
  const viewLink = (t: Tool, label: string) => (
    <button className={`link view-link ${tool === t ? 'active' : ''}`} onClick={() => openTool(t)}>{label}</button>
  )

  return (
    <div className={`app ${focus ? 'focus' : ''} ${menu ? 'menu-open' : ''} ${hideSide ? 'side-hidden' : ''} ${typewriter ? 'typewriter' : ''} ${dim ? 'dim' : ''} ${highlight ? `highlight-${highlight}` : ''}`}>
      <button className="mini menu-toggle" aria-expanded={menu}
        onClick={() => matchMedia('(max-width: 760px)').matches ? setMenu(!menu) : setHideSide(false)}
        title="Show the sidebar">☰ <span className="menu-name">{project.name}</span></button>
      <aside>
        <div className="aside-head">
          <button className="link" onClick={onClose}>&larr; Projects</button>
          <span>
            <button className="mini" onClick={() => setShortcuts(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">⌨</button>{' '}
            <ThemeToggle />{' '}
            <button className="mini side-collapse" onClick={() => setHideSide(true)} title="Hide the sidebar (Ctrl+\)" aria-label="Hide the sidebar">«</button>
          </span>
        </div>
        <h3>{project.name}</h3>
        <Today slug={slug} rows={rows} />
        <input
          ref={searchRef} type="search" className="filter" placeholder="Search everything…" value={query}
          onChange={(e) => { setQuery(e.target.value); openTool(null) }}
          onKeyDown={(e) => e.key === 'Enter' && setMenu(false)}
        />
        <Manuscript slug={slug} rows={rows} selected={selected} onSelect={open} refresh={refresh} />
        <h4>Views</h4>
        {viewLink('board', 'Corkboard')}
        {viewLink('timeline', 'Timeline')}
        {viewLink('graph', 'Relationships')}
        {viewLink('cast', 'Cast')}
        {viewLink('review', `Review (${openCount(review)} open)`)}
        {viewLink('log', 'Writing log')}
        {viewLink('prose', 'Prose stats')}
        {viewLink('drafts', 'Drafts')}
        {viewLink('templates', 'Templates')}
        {viewLink('deleted', 'Deleted items')}
        <h4>Wiki</h4>
        <input className="filter" placeholder="Filter wiki…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {types.map((t) => {
          const items = rows.filter((r) => r.type === t && matches(r))
          if (filter && !items.length) return null
          return (
            <div key={t}>
              <div className="type-heading">
                <button className={`link ${t === typeView ? 'active' : ''}`} onClick={() => openType(t)}>{t}</button>
                <button className="mini" title={`Add ${t}`} onClick={() => create(t)}>+</button>
              </div>
              {items.map((r) => (
                <button key={r.id} className={`link entry ${r.id === selected ? 'active' : ''}`}
                  onClick={(e) => open(r.id, e.shiftKey)} title="Shift+click to open beside">
                  {r.title}
                </button>
              ))}
            </div>
          )
        })}
      </aside>
      <main className={sideRow ? 'split' : ''}>
        <div className="pane">
          {current && editorFor(current, false)}
          {tool === 'board' && <Board slug={slug} rows={rows} onOpen={open} refresh={refresh} />}
          {tool === 'timeline' && (
            <Timeline slug={slug} rows={rows} calendar={project.calendar} onOpen={open} onCreate={create}
              onCalendar={(calendar) => setProject({ ...project, calendar })} />
          )}
          {tool === 'graph' && <Graph rows={rows} onOpen={open} />}
          {tool === 'cast' && <Cast rows={rows} links={links} onOpen={open} />}
          {tool === 'drafts' && <Drafts slug={slug} rows={rows} />}
          {tool === 'templates' && (
            <TemplateEditor slug={slug} templates={project.templates} onSaved={(templates) => setProject({ ...project, templates })} />
          )}
          {tool === 'log' && <WritingLog slug={slug} />}
          {tool === 'prose' && <ProseView slug={slug} rows={rows} onSearch={(q) => { setQuery(q); openTool(null) }}
            words={project.words ?? DEFAULT_WORDS} onWords={(words) => setProject({ ...project, words })} />}
          {tool === 'review' && (
            <ReviewView slug={slug} rows={rows} review={review} refresh={refresh}
              onOpen={(id, item) => item === undefined ? open(id) : openAt(id, { mark: 'comment', index: item })} />
          )}
          {tool === 'deleted' && <DeletedItems slug={slug} onRestored={async (id) => { await refresh(); open(id) }} />}
          {query.trim() && !current && !typeView && !tool && <SearchResults slug={slug} q={query} onOpen={open} onReplaced={() => { setEpoch((n) => n + 1); refresh() }} />}
          {typeView && (
            <TypeTable type={typeView} rows={rows} fields={project.templates[typeView] ?? []} onOpen={open} onCreate={create} />
          )}
        </div>
        {sideRow && <div className="pane side-pane" aria-label="Side pane">{editorFor(sideRow, true)}</div>}
      </main>
      {focus && (
        <div className="focus-bar">
          {/* preventDefault on mousedown: keep the cursor in the text. */}
          <button className="mini" aria-pressed={typewriter} onMouseDown={(e) => e.preventDefault()} onClick={() => setTypewriter(!typewriter)}
            title="Keep the line you're typing in the middle of the screen">Typewriter</button>
          <button className="mini" aria-pressed={dim} onMouseDown={(e) => e.preventDefault()} onClick={() => setDim(!dim)}
            title="Fade every paragraph but the one you're in">Dim</button>
          <button className="mini" onClick={() => setFocus(false)}>Exit focus (Esc)</button>
        </div>
      )}
      <Shortcuts open={shortcuts} onClose={() => setShortcuts(false)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
