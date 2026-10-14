// Run: npm run check. Exercises the store and indexer against a throwaway project.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createProject, newEntityPath, newId, parseEntity, readEntity, writeEntity } from './store.ts'
import { backlinks, countWords, indexFile, linkTargets, openIndex, resolveLinks, search } from './indexer.ts'
import { enforceCap, historyBytes, listSnapshots, prune, readSnapshot, snapshot } from './history.ts'
import { recordDay, streak, type Goals } from './goals.ts'
import { calendarLabel, compareDates, linkText } from '../src/api.ts'
import { reviewItems, setInline } from './review.ts'
import { stripComments } from './indexer.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writing-tool-'))
try {
  const { dir } = await createProject(root, 'Test Novel')
  await assert.rejects(createProject(root, 'Test Novel'))

  // Round trip: what we write is exactly what we read back, including body whitespace.
  const ana = { id: newId(), type: 'character', title: 'Ana', age: 30, body: '\nHero of the story.\n\n' }
  const anaPath = newEntityPath(dir, 'character', 'Ana')
  await writeEntity(dir, anaPath, ana)
  assert.deepEqual(readEntity(path.join(dir, anaPath)), ana)
  assert.equal(newEntityPath(dir, 'character', 'Ana'), 'wiki/character/ana-2.md')
  assert.deepEqual(parseEntity('no frontmatter'), { body: 'no frontmatter' })
  assert.equal(newEntityPath(dir, 'book', 'Book 1'), 'manuscript/book-1/_book.md')
  assert.equal(newEntityPath(dir, 'scene', 'Gate!', 'manuscript/b/ch/_chapter.md'), 'manuscript/b/ch/gate.md')
  assert.equal(countWords("She didn't see [[Ana Vale|x1]] --- at all.\n\n> *Twice*"), 8)
  assert.equal(countWords('One {==two three==}{>>this note is not counted<<} four.'), 4) // comment notes aren't prose
  assert.equal(countWords('One {==two==}{>>[x] done note<<} three.'), 3)
  assert.equal(stripComments('A {==b==}{>>[x] note<<} c.'), 'A b c.')

  // Review: inline comments (done = [x] prefix) and frontmatter notes, ticked off by index.
  const body = 'A {==b==}{>>first<<} c {==d **e**==}{>>[x] second<<}.'
  assert.deepEqual(reviewItems({ id: 'r', type: 'scene', title: 'R', body, review: [{ note: 'whole scene' }, 'junk'] }), [
    { kind: 'passage', index: 0, text: 'b', note: 'first', done: false },
    { kind: 'passage', index: 1, text: 'd e', note: 'second', done: true },
    { kind: 'note', index: 0, note: 'whole scene', done: false },
  ])
  assert.equal(setInline(body, 0, { done: true }), 'A {==b==}{>>[x] first<<} c {==d **e**==}{>>[x] second<<}.')
  assert.equal(setInline(body, 1, { done: false }), 'A {==b==}{>>first<<} c {==d **e**==}{>>second<<}.') // round trip
  assert.equal(setInline(body, 1, { remove: true }), 'A {==b==}{>>first<<} c d **e**.') // text kept
  assert.equal(setInline(body, 2, { done: true }), null)

  // Link text: an alias stays, a stale old title becomes the current one; case-insensitive.
  assert.equal(linkText('Strider', 'Aragorn', ['Strider']), 'Strider')
  assert.equal(linkText('strider', 'Aragorn', ['Strider']), 'strider')
  assert.equal(linkText('Old Name', 'Aragorn', ['Strider']), 'Aragorn')

  // Timeline dates: plain numbers and year-month-day sort together; calendar labels.
  const dates = ['300-3-12', 'Undated', '-12.5', '300', '300-3-2', '299-12']
  assert.deepEqual(dates.sort(compareDates), ['-12.5', '299-12', '300', '300-3-2', '300-3-12', 'Undated'])
  const cal = { months: ['Thaw', 'Bloom', 'Frostmoon'], era: 'Year' }
  assert.equal(calendarLabel('300-3-12', cal), '12 Frostmoon, Year 300')
  assert.equal(calendarLabel('300-2', cal), 'Bloom, Year 300')
  assert.equal(calendarLabel('300', cal), 'Year 300')
  assert.equal(calendarLabel('300-14-1', cal), '1 Month 14, Year 300')
  assert.equal(calendarLabel('300-3-12'), '300-3-12') // no calendar: as typed

  const fox = { id: newId(), type: 'character', title: 'Ana Vale', aliases: 'The Fox, Vixen', body: '' }
  await writeEntity(dir, 'wiki/character/fox.md', fox)
  const scene = {
    id: newId(), type: 'scene', title: 'Opening',
    relationships: [{ to: ana.id, kind: 'pov' }],
    body: 'Then [[Ana|' + ana.id + ']] arrived at the gate.',
  }
  await writeEntity(dir, 'manuscript/book-1/chapter-1/opening.md', scene)
  fs.writeFileSync(path.join(dir, 'wiki/notes.md'), 'stray file without frontmatter')

  let db = openIndex(dir)
  const ids = (rows: unknown[]) => rows.map((r) => Object.values(r as object)[0])
  assert.deepEqual(ids(db.prepare('select distinct to_id from links where from_id = ?').all(scene.id)), [ana.id])
  assert.deepEqual(ids(db.prepare('select id from fts where fts match ?').all('gate')), [scene.id])
  assert.equal((db.prepare('select count(*) n from entities').get() as { n: number }).n, 3)
  // Backlinks say which field the link is in, and carry the relationship label.
  const bl = (backlinks(db, ana.id) as { id: string; field: string; label: string | null }[])
    .map((r) => `${r.id}:${r.field}:${r.label ?? ''}`).sort()
  assert.deepEqual(bl, [`${scene.id}:body:`, `${scene.id}:relationships:pov`])
  assert.deepEqual(ids(search(db, 'arr')), [scene.id]) // prefix match
  assert.match(String((search(db, 'gate')[0] as { snippet: string }).snippet), /\u0001gate\u0002/)
  assert.deepEqual(search(db, '"( -NEAR* ^'), []) // FTS syntax in user text doesn't throw
  assert.deepEqual(search(db, ''), [])
  // Compile shows current titles even if the stored one is stale; unknown ids keep the stored title.
  assert.equal(resolveLinks(db, `Saw [[Old Name|${ana.id}]] and [[Ghost|nope]].`), 'Saw Ana and Ghost.')
  assert.equal(resolveLinks(db, `[[the fox|${fox.id}]] met [[Fox|${fox.id}]].`), 'the fox met Ana Vale.') // alias kept
  // Links inside fields (e.g. pov) count too.
  assert.deepEqual(
    linkTargets({ id: 'q', type: 'scene', title: 'Q', pov: `[[Ana|${ana.id}]]`, appears: [`[[Ana|${ana.id}]]`, '[[B|b1]]'], body: '[[B|b1]] [[B|b1]]' }),
    [{ to: ana.id, field: 'pov' }, { to: ana.id, field: 'appears' }, { to: 'b1', field: 'appears' }, { to: 'b1', field: 'body' }],
  )

  // Re-indexing an edited file replaces its links instead of duplicating them.
  await writeEntity(dir, 'manuscript/book-1/chapter-1/opening.md', { ...scene, relationships: [] })
  indexFile(db, dir, 'manuscript/book-1/chapter-1/opening.md')
  assert.equal(db.prepare('select * from links').all().length, 1)

  // Index is disposable: delete it, reopen, get the same contents.
  const indexDump = () => JSON.stringify([
    db.prepare('select id, type, title, path, fields from entities order by id').all(),
    db.prepare('select * from links order by from_id, to_id, field').all(),
  ])
  const before = indexDump()
  db.close()
  fs.rmSync(path.join(dir, '.index.sqlite'))
  db = openIndex(dir)
  assert.equal(indexDump(), before)
  db.close()

  // ---- Version history: only real changes, throttled, thinned, capped ----
  const H = 60 * 60_000
  const D = 24 * H
  const t0 = Date.UTC(2026, 0, 1)
  const hrel = 'wiki/character/ana.md'
  // Like the server's PUT: keep the current file as a version, then overwrite it.
  const edit = async (text: string, now: number, force = false) => {
    await snapshot(dir, ana.id, hrel, { title: 'Ana', type: 'character' }, { now, force })
    await writeEntity(dir, hrel, { ...ana, body: text })
  }
  const count = () => listSnapshots(dir, ana.id).length
  await edit('v1', t0) // keeps the original
  await edit('v2', t0 + 10 * H) // keeps v1
  await edit('v3', t0 + 10 * H + 60_000) // within 5 min of the last version → throttled
  assert.equal(count(), 2)
  await edit('v4', t0 + 10 * H + 120_000, true) // forced (delete, restore, overwrite) ignores the throttle
  assert.equal(count(), 3)
  assert.match(readSnapshot(dir, ana.id, t0 + 10 * H + 120_000), /\nv3$/) // the text *before* the change
  await edit('v4', t0 + 20 * H) // keeps v4; the two versions from 10h ago share an hour, so thinning keeps one
  assert.equal(count(), 3)
  await edit('v4', t0 + 30 * H) // file still equals the last version → nothing new
  assert.equal(count(), 3)

  // Thinning: a month of edits every 6 minutes keeps ~1/hour for a day, ~1/day for 30 days.
  for (let t = t0 + 2 * D; t < t0 + 35 * D; t += 6 * 60_000) {
    fs.mkdirSync(path.join(dir, '.history', ana.id), { recursive: true })
    fs.writeFileSync(path.join(dir, '.history', ana.id, `${t}.md.gz`), 'x')
  }
  prune(dir, ana.id, t0 + 35 * D)
  const kept = listSnapshots(dir, ana.id).length
  assert.ok(kept >= 30 && kept <= 70, `thinning kept ${kept}`)

  // Hard cap: oldest go first, but every entity keeps its newest version.
  fs.mkdirSync(path.join(dir, '.history', 'other'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.history', 'other', `${t0}.md.gz`), Buffer.alloc(5000))
  enforceCap(dir, 1000)
  assert.equal(listSnapshots(dir, 'other').length, 1) // oldest overall, but it's 'other's only version
  assert.equal(listSnapshots(dir, ana.id).length, 1) // ana trimmed down to her newest
  assert.ok(historyBytes(dir) > 1000) // can't go lower without losing an entity's last version

  // ---- Goals: net words per day, streaks ----
  const g: Goals = { daily: 100, days: {} }
  recordDay(g, '2026-03-01', 1000); recordDay(g, '2026-03-01', 1150)
  recordDay(g, '2026-03-02', 1150); recordDay(g, '2026-03-02', 1300)
  recordDay(g, '2026-03-03', 1300); recordDay(g, '2026-03-03', 1320) // today, goal not yet met
  assert.deepEqual(g.days['2026-03-01'], { start: 1000, end: 1150 })
  assert.equal(streak(g, '2026-03-03'), 2) // yesterday's streak still counts until today ends
  recordDay(g, '2026-03-03', 1400)
  assert.equal(streak(g, '2026-03-03'), 3)
  assert.equal(streak(g, '2026-03-05'), 0) // missed a day
  assert.equal(streak({ days: g.days }, '2026-03-03'), 0) // no goal set

  console.log('selfcheck ok')
} finally {
  // Best effort: on failure the index may still be open, and Windows won't delete open files.
  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
}
