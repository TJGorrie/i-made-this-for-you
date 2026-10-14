import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { aliasesOf, api, MANUSCRIPT_TYPES, type Calendar, type Row } from './api.ts'
import { Editor } from './Editor.tsx'
import { Manuscript } from './Manuscript.tsx'
import { TypeTable } from './Wiki.tsx'
import { SearchResults } from './Search.tsx'
import { Timeline } from './Timeline.tsx'
import { Graph } from './Relationships.tsx'
import { DeletedItems } from './History.tsx'
import { TemplateEditor } from './Templates.tsx'
import { Today, WritingLog } from './Goals.tsx'
import { openCount, ReviewView, type ReviewEntry } from './Review.tsx'

type Project = { name: string; templates: Record<string, string[]>; calendar?: Calendar }
type Tool = 'timeline' | 'graph' | 'templates' | 'deleted' | 'log' | 'review'


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
  return (
    <main className="projects">
      <h2>Projects <ThemeToggle /></h2>
      {projects.map((p) => (
        <button key={p.slug} className="link" onClick={() => setSlug(p.slug)}>{p.name}</button>
      ))}
      <p>
        <input placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} />{' '}
        <button onClick={create} disabled={!name.trim()}>Create</button>
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
  const [focusItem, setFocusItem] = useState<number>() // inline comment to select when the editor opens
  const refresh = async () => {
    const [r, rv] = await Promise.all([api(`/projects/${slug}/entities`), api(`/projects/${slug}/review`)])
    setRows(r); setReview(rv)
  }
  useEffect(() => {
    api(`/projects/${slug}`).then(setProject)
    refresh()
    // Pick up files changed elsewhere (another editor, git, sync) when you come back to the app.
    const onFocus = () => refresh()
    addEventListener('focus', onFocus)
    return () => removeEventListener('focus', onFocus)
  }, [slug])
  useEffect(() => {
    if (!focus) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocus(false)
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [focus])

  if (!project) return null
  const open = (id: string, beside = false) => {
    if (beside) {
      if (id !== selected) setSide(id)
      return
    }
    setSelected(id); setTypeView(null); setTool(null); setFocusItem(undefined)
    if (side === id) setSide(null)
  }
  const openType = (t: string) => { setSelected(null); setTypeView(t); setTool(null) }
  const openTool = (t: Tool | null) => { setSelected(null); setTypeView(null); setTool(t) }
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
  const editorFor = (r: Row, inSide: boolean) => (
    <Editor
      key={r.id}
      url={`/projects/${slug}/entities/${r.id}`}
      fields={project.templates[r.type] ?? []}
      onSaved={refresh}
      onDeleted={() => { if (inSide) setSide(null); else openType(r.type); refresh() }}
      onOpenType={openType}
      onOpen={open}
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
    <div className={`app ${focus ? 'focus' : ''}`}>
      <aside>
        <div className="aside-head">
          <button className="link" onClick={onClose}>&larr; Projects</button>
          <ThemeToggle />
        </div>
        <h3>{project.name}</h3>
        <Today slug={slug} rows={rows} />
        <input
          type="search" className="filter" placeholder="Search everything…" value={query}
          onChange={(e) => { setQuery(e.target.value); openTool(null) }}
        />
        <Manuscript slug={slug} rows={rows} selected={selected} onSelect={open} refresh={refresh} />
        <h4>Views</h4>
        {viewLink('timeline', 'Timeline')}
        {viewLink('graph', 'Relationships')}
        {viewLink('review', `Review (${openCount(review)} open)`)}
        {viewLink('log', 'Writing log')}
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
          {tool === 'timeline' && (
            <Timeline slug={slug} rows={rows} calendar={project.calendar} onOpen={open} onCreate={create}
              onCalendar={(calendar) => setProject({ ...project, calendar })} />
          )}
          {tool === 'graph' && <Graph rows={rows} onOpen={open} />}
          {tool === 'templates' && (
            <TemplateEditor slug={slug} templates={project.templates} onSaved={(templates) => setProject({ ...project, templates })} />
          )}
          {tool === 'log' && <WritingLog slug={slug} />}
          {tool === 'review' && (
            <ReviewView slug={slug} rows={rows} review={review} refresh={refresh}
              onOpen={(id, item) => { open(id); setFocusItem(item) }} />
          )}
          {tool === 'deleted' && <DeletedItems slug={slug} onRestored={async (id) => { await refresh(); open(id) }} />}
          {query.trim() && !current && !typeView && !tool && <SearchResults slug={slug} q={query} onOpen={open} />}
          {typeView && (
            <TypeTable type={typeView} rows={rows} fields={project.templates[typeView] ?? []} onOpen={open} onCreate={create} />
          )}
        </div>
        {sideRow && <div className="pane side-pane" aria-label="Side pane">{editorFor(sideRow, true)}</div>}
      </main>
      {focus && <button className="mini exit-focus" onClick={() => setFocus(false)}>Exit focus (Esc)</button>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
