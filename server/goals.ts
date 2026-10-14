// Writing goals: a daily word target, with each day's manuscript word count at start and latest, in goals.json.
// "Words today" is net (latest − start), so deleting text counts against it, like most writing apps.
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './store.ts'

export type Goals = { daily?: number; days: Record<string, { start: number; end: number }> }

export const localDate = (d = new Date()) => d.toLocaleDateString('sv-SE') // YYYY-MM-DD in local time

export function readGoals(dir: string): Goals {
  try { return { days: {}, ...JSON.parse(fs.readFileSync(path.join(dir, 'goals.json'), 'utf8')) } } catch { return { days: {} } }
}
export const writeGoals = (dir: string, g: Goals) => atomicWrite(path.join(dir, 'goals.json'), JSON.stringify(g, null, 2))

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
