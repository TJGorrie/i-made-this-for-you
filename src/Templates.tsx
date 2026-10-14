// Edit templates.json from the app: types, their fields, and which fields link to other entries.
import { useState } from 'react'
import { api, MANUSCRIPT_TYPES, parseField } from './api.ts'

type Kind = 'text' | 'link' | 'links' | 'image' | 'images'
type Field = { name: string; kind: Kind; target: string }
type Draft = { type: string; fields: Field[] }[]

const toDraft = (t: Record<string, string[]>): Draft =>
  Object.entries(t).map(([type, specs]) => ({
    type,
    fields: specs.map((s) => {
      const { name, linkType, multiple } = parseField(s)
      const kind: Kind = !linkType ? 'text' : linkType === 'image' ? (multiple ? 'images' : 'image') : multiple ? 'links' : 'link'
      return { name, kind, target: linkType && linkType !== 'image' ? linkType : 'character' }
    }),
  }))

const toTemplates = (d: Draft) =>
  Object.fromEntries(d.map(({ type, fields }) => [
    type.trim(),
    fields.map((f) => f.name.trim() + ({ text: '', link: `:${f.target}`, links: `:${f.target}[]`, image: ':image', images: ':image[]' })[f.kind]),
  ]))

type Props = { slug: string; templates: Record<string, string[]>; onSaved: (t: Record<string, string[]>) => void }

export function TemplateEditor({ slug, templates, onSaved }: Props) {
  const [draft, setDraft] = useState(() => toDraft(templates))
  const [newType, setNewType] = useState('')
  const [error, setError] = useState('')
  const dirty = JSON.stringify(toTemplates(draft)) !== JSON.stringify(templates)
  const linkTargets = [...draft.map((d) => d.type).filter((t) => !MANUSCRIPT_TYPES.includes(t)), '*']

  const update = (ti: number, fields: Field[]) => setDraft(draft.map((d, i) => (i === ti ? { ...d, fields } : d)))
  const setField = (ti: number, fi: number, patch: Partial<Field>) =>
    update(ti, draft[ti].fields.map((f, i) => (i === fi ? { ...f, ...patch } : f)))
  const move = (ti: number, fi: number, by: number) => {
    const fields = [...draft[ti].fields]
    const [f] = fields.splice(fi, 1)
    fields.splice(fi + by, 0, f)
    update(ti, fields)
  }

  async function save() {
    setError('')
    try {
      onSaved(await api(`/projects/${slug}/templates`, 'PUT', toTemplates(draft)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="templates">
      <h2>Templates</h2>
      <p className="muted">
        The fields each type of entry gets. Renaming a field doesn't move values already saved under the old name;
        they stay in the file and show as extra fields.
      </p>
      <p className="sticky-save">
        <button onClick={save} disabled={!dirty}>Save templates</button>{' '}
        {dirty && <button onClick={() => setDraft(toDraft(templates))}>Discard changes</button>}{' '}
        {error && <span className="error">{error}</span>}
      </p>
      {draft.map(({ type, fields }, ti) => (
        <section key={ti} className="template-type" aria-label={`${type} template`}>
          <h3>
            {type}{' '}
            <button className="mini" aria-label={`Remove type ${type}`}
              onClick={() => confirm(`Remove the "${type}" template? Existing ${type} entries are kept.`) && setDraft(draft.filter((_, i) => i !== ti))}>
              ×
            </button>
          </h3>
          {fields.map((f, fi) => (
            <div key={fi} className="template-field">
              <input aria-label={`${type} field name`} value={f.name} onChange={(e) => setField(ti, fi, { name: e.target.value })} />
              <select aria-label={`${f.name} kind`} value={f.kind} onChange={(e) => setField(ti, fi, { kind: e.target.value as Kind })}>
                <option value="text">Text</option>
                <option value="link">Link to one…</option>
                <option value="links">Links to several…</option>
                <option value="image">Image</option>
                <option value="images">Images (gallery)</option>
              </select>
              {(f.kind === 'link' || f.kind === 'links') && (
                <select aria-label={`${f.name} links to`} value={f.target} onChange={(e) => setField(ti, fi, { target: e.target.value })}>
                  {[...new Set([...linkTargets, f.target])].map((t) => <option key={t} value={t}>{t === '*' ? 'any type' : t}</option>)}
                </select>
              )}
              <button className="mini" aria-label={`Move ${f.name} up`} disabled={fi === 0} onClick={() => move(ti, fi, -1)}>↑</button>
              <button className="mini" aria-label={`Move ${f.name} down`} disabled={fi === fields.length - 1} onClick={() => move(ti, fi, 1)}>↓</button>
              <button className="mini" aria-label={`Remove ${f.name}`} onClick={() => update(ti, fields.filter((_, i) => i !== fi))}>×</button>
            </div>
          ))}
          <button className="mini" onClick={() => update(ti, [...fields, { name: '', kind: 'text', target: 'character' }])}>+ field</button>
        </section>
      ))}
      <p>
        <input placeholder="New type, e.g. creature" value={newType} onChange={(e) => setNewType(e.target.value)} />{' '}
        <button disabled={!newType.trim() || draft.some((d) => d.type === newType.trim())}
          onClick={() => { setDraft([...draft, { type: newType.trim().toLowerCase(), fields: [] }]); setNewType('') }}>
          Add type
        </button>
      </p>
    </div>
  )
}
