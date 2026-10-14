// Continuity checks against the timeline: a scene dated after a character's death, or before their birth,
// that still has them in it (as POV, in "appears", or linked in the text).
import { compareDates, dateKey, fieldText, tagList, type Row } from './api.ts'

export type Link = { from_id: string; to_id: string; field?: string }
export type Warning = { scene: Row; who: Row; event: Row; kind: 'death' | 'birth' }

// Events tagged `death` or `birth` mark when the entries they involve die or are born.
export function continuity(rows: Row[], links: Link[]): Warning[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const linked = (id: string) => new Set(links.filter((l) => l.from_id === id).map((l) => l.to_id))
  const marks: { kind: Warning['kind']; event: Row; who: string; date: string }[] = rows
    .filter((r) => r.type === 'event' && fieldText(r.date))
    .flatMap((event) => (['death', 'birth'] as const).filter((k) => tagList(event.tags).includes(k))
      .flatMap((kind) => [...linked(event.id)].map((who) => ({ kind, event, who, date: fieldText(event.date) }))))
  return rows.filter((r) => r.type === 'scene' && fieldText(r.date)).flatMap((scene) => {
    const inScene = linked(scene.id)
    return marks.filter((m) => inScene.has(m.who) && byId.has(m.who)
      && (m.kind === 'death' ? compareDates(fieldText(scene.date), m.date) > 0 : compareDates(fieldText(scene.date), m.date) < 0))
      .map((m) => ({ scene, who: byId.get(m.who)!, event: m.event, kind: m.kind }))
  })
}

// Year of birth per entry, from events tagged `birth` (the year of their date). An age is then scene year − birth year.
export function birthYears(rows: Row[], links: Link[]) {
  const born = new Map<string, number>()
  for (const e of rows) {
    const year = dateKey(fieldText(e.date))[0]
    if (e.type !== 'event' || !tagList(e.tags).includes('birth') || !Number.isFinite(year)) continue
    for (const l of links) if (l.from_id === e.id) born.set(l.to_id, year)
  }
  return born
}

export function ageAt(born: Map<string, number>, who: string, date: string) {
  const year = dateKey(date)[0]
  return born.has(who) && Number.isFinite(year) ? year - born.get(who)! : undefined
}
