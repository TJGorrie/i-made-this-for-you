// "Today" word count against a daily goal, with streak. Refreshes whenever the entity list does (after saves).
import { useEffect, useRef, useState } from 'react'
import { api, type Row } from './api.ts'
import { Help } from './Help.tsx'

type Day = { date: string; words: number }
type Sprint = { at: number; minutes: number; words: number }
type Stats = {
  total: number; today: number; daily: number | null; streak: number; days: Day[]; sprints: Sprint[]
  deadline: string | null; target: number; pace: number; left: number; finish: string | null // finish: projected from the pace
}

const dayMonth = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

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
      {stats.deadline && (
        <div className={stats.finish && stats.finish > stats.deadline ? 'behind' : ''}>
          {stats.target ? (stats.finish ? `on pace for ${dayMonth(stats.finish)}` : 'no pace yet') : 'no book target'} · deadline {dayMonth(stats.deadline)}
        </div>
      )}
      <SprintTimer slug={slug} total={stats.total} />
    </div>
  )
}

// Timed writing sprint: counts down, shows words written since it started, and logs the result.
// The running sprint is kept in localStorage, so reloading the tab carries on with it (finishing it if time ran out).
type Running = { at: number; minutes: number; start: number }
function SprintTimer({ slug, total }: { slug: string; total: number }) {
  const key = `sprint:${slug}`
  const [sprint, setRunning] = useState<Running | undefined>(() => { try { return JSON.parse(localStorage.getItem(key)!) ?? undefined } catch { return undefined } })
  const setSprint = (s?: Running) => {
    try { if (s) localStorage.setItem(key, JSON.stringify(s)); else localStorage.removeItem(key) } catch {}
    setRunning(s)
  }
  const [done, setDone] = useState('')
  const [, tick] = useState(0)
  const totalRef = useRef(total)
  totalRef.current = total
  useEffect(() => {
    if (!sprint) return
    const t = setInterval(() => {
      if (Date.now() < sprint.at + sprint.minutes * 60_000) return tick((n) => n + 1)
      finish(sprint)
    }, 1000)
    return () => clearInterval(t)
  }, [sprint])

  function start() {
    const v = prompt('Sprint length in minutes', '25')
    const minutes = Number(v)
    if (v === null) return
    if (!(minutes > 0)) return alert('Enter a number of minutes')
    setDone('')
    setSprint({ at: Date.now(), minutes, start: totalRef.current })
  }
  function finish(s: NonNullable<typeof sprint>) {
    const minutes = Math.max(1, Math.min(s.minutes, Math.round((Date.now() - s.at) / 60_000))) // tab reopened late: the sprint's length
    const words = totalRef.current - s.start
    setSprint(undefined)
    setDone(`Sprint done: ${words > 0 ? '+' : ''}${words.toLocaleString()} words in ${minutes} min`)
    api(`/projects/${slug}/sprints`, 'POST', { at: s.at, minutes, words }).catch((e) => setDone(e.message))
  }

  if (!sprint) return (
    <div className="sprint">
      <button className="link inline" onClick={start}>start a sprint</button>
      {done && <span className="streak" role="status"> {done}</span>}
    </div>
  )
  const left = Math.max(0, sprint.at + sprint.minutes * 60_000 - Date.now())
  const clock = `${Math.floor(left / 60_000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`
  const words = total - sprint.start
  return (
    <div className="sprint" role="timer" aria-label="Sprint">
      <b>{clock}</b> · {words > 0 ? '+' : ''}{words.toLocaleString()} words
      <button className="link inline" onClick={() => finish(sprint)}>stop</button>
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
  const load = () => api(`/projects/${slug}/stats`).then(setStats)
  useEffect(() => void load(), [slug])
  if (!stats) return null
  const setDeadline = (deadline: string) => api(`/projects/${slug}/goals`, 'PUT', { deadline: deadline || null }).then(load, (e) => alert(e.message))
  const days = allDays(stats.days)
  const max = Math.max(1, stats.daily ?? 0, ...days.map((d) => d.words))
  const written = days.reduce((n, d) => n + Math.max(0, d.words), 0)
  return (
    <div className="writing-log">
      <h2>Writing log <Help>
        <span>How many words you wrote each day, counting scenes only. Deleting text counts against the day, so it's your net progress.</span>
        <span>Set a daily goal with <b>set goal</b> at the top of the sidebar; it shows as a dashed line here, and meeting it day after day builds a streak.
          Hover a bar for that day's numbers.</span>
        <span><b>start a sprint</b> (under the goal) times a burst of writing; finished sprints are listed here with your pace.</span>
      </Help></h2>
      <p className="muted">
        {days.length} days · {written.toLocaleString()} words written
        {stats.daily ? ` · goal met on ${days.filter((d) => d.words >= stats.daily!).length}` : ''}
      </p>
      <p className="projection">
        <label>Deadline <input type="date" aria-label="Deadline" value={stats.deadline ?? ''} onChange={(e) => setDeadline(e.target.value)} /></label>{' '}
        {!stats.target ? "Set a word target on your book to see when you'll finish."
          : !stats.left ? `You've reached your target of ${stats.target.toLocaleString()} words.`
          : !stats.finish ? `${stats.left.toLocaleString()} words to go. No words in the last 14 days, so there's no pace to project from yet.`
          : `At ${stats.pace.toLocaleString()} words a day (the last 14 days), the ${stats.left.toLocaleString()} words left take you to ${dayMonth(stats.finish)}${
            stats.deadline ? `; your deadline is ${dayMonth(stats.deadline)}` : ''}.`}
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
      {stats.sprints.length > 0 && (
        <section aria-label="Sprints">
          <h3>Sprints</h3>
          <table>
            <tbody>
              {[...stats.sprints].reverse().map((s) => (
                <tr key={s.at}>
                  <td>{new Date(s.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{s.minutes} min</td>
                  <td>{s.words.toLocaleString()} words</td>
                  <td className="muted">{Math.round((s.words / s.minutes) * 60).toLocaleString()} / hour</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

export const Progress =({ value, max }: { value: number; max: number }) => (
  <progress className={value >= max ? 'done' : ''} value={Math.max(0, Math.min(value, max))} max={max} />
)
