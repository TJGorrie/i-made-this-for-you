// Events in date order. `date` sorts ("300", or "300-3-12" with a calendar); `dateLabel`, if set, is shown instead.
// Filter by an entity the events link to, or by tag.
import { useEffect, useState } from 'react'
import { api, calendarLabel, compareDates, fieldText, type Calendar, type Row } from './api.ts'

type Props = {
  slug: string; rows: Row[]; calendar?: Calendar
  onOpen: (id: string) => void; onCreate: (type: string) => void; onCalendar: (c: Calendar) => void
}

// `tags: war, politics` (comma-separated, any entity can have them).
const tagsOf = (r: Row) => fieldText(r.tags).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)

export function Timeline({ slug, rows, calendar, onOpen, onCreate, onCalendar }: Props) {
  const [links, setLinks] = useState<{ from_id: string; to_id: string }[]>([])
  const [who, setWho] = useState('')
  useEffect(() => void api(`/projects/${slug}/links`).then(setLinks), [slug, rows])

  const byId = new Map(rows.map((r) => [r.id, r]))
  const linked = (id: string) =>
    [...new Set(links.filter((l) => l.from_id === id).map((l) => l.to_id))].flatMap((to) => byId.get(to) ?? [])
  const all = rows.filter((r) => r.type === 'event')
    .sort((a, b) => compareDates(fieldText(a.date), fieldText(b.date)) || a.title.localeCompare(b.title))
  const involved = [...new Map(all.flatMap((e) => linked(e.id)).map((r) => [r.id, r])).values()]
  const tags = [...new Set(all.flatMap(tagsOf))].sort()
  // Filter value is an entity id, or "#tag".
  const events = !who ? all
    : who.startsWith('#') ? all.filter((e) => tagsOf(e).includes(who.slice(1)))
    : all.filter((e) => linked(e.id).some((r) => r.id === who))

  return (
    <div className="timeline">
      <h2>Timeline</h2>
      <p>
        <select aria-label="Filter by" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone & everywhere</option>
          {involved.length > 0 && (
            <optgroup label="Involving">
              {involved.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </optgroup>
          )}
          {tags.length > 0 && (
            <optgroup label="Tagged">
              {tags.map((t) => <option key={t} value={`#${t}`}>#{t}</option>)}
            </optgroup>
          )}
        </select>{' '}
        <button onClick={() => onCreate('event')}>New event</button>
      </p>
      <CalendarSettings slug={slug} calendar={calendar} onSaved={onCalendar} />
      {!all.length && <p className="muted">No events yet. Events are sorted by their <b>date</b>: a year like 300, or 300-3-12 for year-month-day.</p>}
      <ol>
        {events.map((e) => (
          <li key={e.id}>
            <span className="when">{fieldText(e.dateLabel) || calendarLabel(fieldText(e.date), calendar) || 'Undated'}</span>
            <div>
              <button className="link" onClick={() => onOpen(e.id)}>{e.title}</button>
              {linked(e.id).map((r) => (
                <button key={r.id} className="chip" onClick={() => onOpen(r.id)}>{r.title}</button>
              ))}
              {tagsOf(e).map((t) => (
                <button key={t} className="chip tag" onClick={() => setWho(`#${t}`)}>#{t}</button>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// Your world's month names (one per line) and era label, so "300-3-12" shows as "12 <3rd month>, <era> 300".
function CalendarSettings({ slug, calendar, onSaved }: { slug: string; calendar?: Calendar; onSaved: (c: Calendar) => void }) {
  const [months, setMonths] = useState(calendar?.months.join('\n') ?? '')
  const [era, setEra] = useState(calendar?.era ?? 'Year')
  const [error, setError] = useState('')
  async function save() {
    setError('')
    const list = months.split('\n').map((m) => m.trim()).filter(Boolean)
    await api(`/projects/${slug}/calendar`, 'PUT', { months: list, era }).then(onSaved, (e) => setError(e.message))
  }
  return (
    <details className="calendar-settings">
      <summary>Calendar</summary>
      <label>Month names, one per line<textarea aria-label="Month names" rows={6} value={months} onChange={(e) => setMonths(e.target.value)} /></label>
      <label>Era label <input aria-label="Era label" value={era} onChange={(e) => setEra(e.target.value)} /></label>
      <button onClick={save}>Save calendar</button> {error && <small className="error">{error}</small>}
    </details>
  )
}
