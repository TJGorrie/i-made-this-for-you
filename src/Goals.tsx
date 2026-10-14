// "Today" word count against a daily goal, with streak. Refreshes whenever the entity list does (after saves).
import { useEffect, useState } from 'react'
import { api, type Row } from './api.ts'

type Day = { date: string; words: number }
type Stats = { total: number; today: number; daily: number | null; streak: number; days: Day[] }

export function Today({ slug, rows }: { slug: string; rows: Row[] }) {
  const [stats, setStats] = useState<Stats>()
  useEffect(() => void api(`/projects/${slug}/stats`).then(setStats), [slug, rows])
  if (!stats) return null

  async function setGoal() {
    const v = prompt('Daily word goal (empty to turn off)', stats?.daily ? String(stats.daily) : '500')
    if (v === null) return
    const daily = v.trim() ? parseInt(v, 10) : null
    if (daily !== null && !(daily > 0)) return alert('Enter a positive number of words')
    await api(`/projects/${slug}/goals`, 'PUT', { daily })
    setStats(await api(`/projects/${slug}/stats`))
  }

  const sign = stats.today > 0 ? '+' : ''
  return (
    <div className="today" aria-label="Today's writing">
      <div>
        <b>Today</b> {sign}{stats.today.toLocaleString()}{stats.daily ? ` / ${stats.daily.toLocaleString()}` : ''} words
        {stats.streak > 0 && <span className="streak" title="Days in a row meeting your goal"> · {stats.streak}-day streak</span>}
        <button className="link inline" onClick={setGoal}>{stats.daily ? 'edit goal' : 'set goal'}</button>
      </div>
      {stats.daily && <Progress value={stats.today} max={stats.daily} />}
    </div>
  )
}

// Every day from the first recorded one to the last, with unrecorded days (app not opened) as 0.
function allDays(days: Day[]) {
  const words = new Map(days.map((d) => [d.date, d.words]))
  const out: Day[] = []
  if (!days.length) return out
  for (const d = new Date(`${days[0].date}T12:00:00`); ; d.setDate(d.getDate() + 1)) { // noon: safe across DST
    const date = d.toLocaleDateString('sv-SE')
    if (date > days.at(-1)!.date) return out
    out.push({ date, words: words.get(date) ?? 0 })
  }
}

// Net words per day as bars, goal as a line. Hover a bar for its numbers; the table has them all.
export function WritingLog({ slug }: { slug: string }) {
  const [stats, setStats] = useState<Stats>()
  useEffect(() => void api(`/projects/${slug}/stats`).then(setStats), [slug])
  if (!stats) return null
  const days = allDays(stats.days)
  const max = Math.max(1, stats.daily ?? 0, ...days.map((d) => d.words))
  const written = days.reduce((n, d) => n + Math.max(0, d.words), 0)
  return (
    <div className="writing-log">
      <h2>Writing log</h2>
      <p className="muted">
        {days.length} days · {written.toLocaleString()} words written
        {stats.daily ? ` · goal met on ${days.filter((d) => d.words >= stats.daily!).length}` : ''}
      </p>
      <div className="chart">
      <div className="bars" role="img" aria-label={`Words per day, ${days[0]?.date ?? ''} to ${days.at(-1)?.date ?? ''}`}>
        <span className="y-max">{max.toLocaleString()}</span>
        {stats.daily && (
          <div className="goal-line" style={{ bottom: `${(stats.daily / max) * 100}%` }}><span>goal {stats.daily.toLocaleString()}</span></div>
        )}
        {days.map((d) => (
          <div key={d.date} className="bar-slot" title={`${d.date}: ${d.words.toLocaleString()} words`}>
            <div className="bar" style={{ height: `${(Math.max(0, d.words) / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="bars-axis muted"><span>{days[0]?.date}</span><span>{days.at(-1)?.date}</span></div>
      </div>
      <details>
        <summary>Table</summary>
        <table>
          <tbody>
            {[...days].reverse().map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.words.toLocaleString()}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  )
}

export const Progress =({ value, max }: { value: number; max: number }) => (
  <progress className={value >= max ? 'done' : ''} value={Math.max(0, Math.min(value, max))} max={max} />
)
