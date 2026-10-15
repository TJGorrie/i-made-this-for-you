// Writing goals: a daily word target, with each day's manuscript word count at start and latest, in goals.json.
// "Words today" is net (latest − start), so deleting text counts against it, like most writing apps.
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './store.ts'

export type Sprint = { at: number; minutes: number; words: number } // timed writing session; at = when it started (ms)
export type Goals = { daily?: number; deadline?: string; days: Record<string, { start: number; end: number }>; sprints?: Sprint[] }

export const localDate = (d = new Date()) => d.toLocaleDateString('sv-SE') // YYYY-MM-DD in local time

export function readGoals(dir: string): Goals {
  try { return { days: {}, ...JSON.parse(fs.readFileSync(path.join(dir, 'goals.json'), 'utf8')) } } catch { return { days: {} } }
}
export const writeGoals = (dir: string, g: Goals) => atomicWrite(path.join(dir, 'goals.json'), JSON.stringify(g, null, 2))

// Requests that read goals.json, change it and write it back (a save's stats refresh, a finished sprint) take turns,
// so neither overwrites the other's change. One queue for every project: these are a few milliseconds each.
let queue: Promise<unknown> = Promise.resolve()
export function goalsTurn<T>(f: () => Promise<T>) {
  const run = queue.then(f)
  queue = run.catch(() => {})
  return run
}

// Record today's total; returns true if goals.json needs saving.
export function recordDay(g: Goals, date: string, total: number) {
  const day = g.days[date]
  if (day && day.end === total) return false
  g.days[date] = { start: day?.start ?? total, end: total }
  return true
}

// Consecutive days meeting the goal, ending today (or yesterday, so the streak isn't "lost" before you write today).
export function streak(g: Goals, date: string) {
  if (!g.daily) return 0
  const met = (d: string) => { const x = g.days[d]; return !!x && x.end - x.start >= g.daily! }
  const day = new Date(`${date}T12:00:00`) // noon: safe across DST shifts
  if (!met(date)) day.setDate(day.getDate() - 1)
  let n = 0
  while (met(localDate(day))) { n++; day.setDate(day.getDate() - 1) }
  return n
}

// Finish-date projection. Pace = net words a day over the last 14 days (today included);
// the words left take ceil(left / pace) more days. finish is null while there's no pace to go on.
export function projection(g: Goals, date: string, total: number, target: number) {
  const day = new Date(`${date}T12:00:00`)
  let words = 0
  for (let i = 0; i < 14; i++, day.setDate(day.getDate() - 1)) {
    const d = g.days[localDate(day)]
    if (d) words += d.end - d.start
  }
  const left = Math.max(0, target - total)
  let finish: string | null = left ? null : date
  if (left && words > 0) {
    const f = new Date(`${date}T12:00:00`)
    f.setDate(f.getDate() + Math.ceil((left * 14) / words)) // integers: no float rounding at whole days
    finish = localDate(f)
  }
  return { pace: Math.round(words / 14), left, finish }
}
