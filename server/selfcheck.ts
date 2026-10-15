// Run: npm run check. Exercises the store and indexer against a throwaway project.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createProject, newEntityPath, newId, parseEntity, projectFiles, readEntity, restoreProject, writeEntity } from './store.ts'
import { backlinks, countWords, findPattern, indexFile, linkTargets, openIndex, proseMatches, resolveLinks, search, spliceMatches } from './indexer.ts'
import { enforceCap, historyBytes, listSnapshots, prune, readSnapshot, snapshot } from './history.ts'
import { projection, recordDay, streak, type Goals } from './goals.ts'
import { calendarLabel, compareDates, linkText, readable, descriptions, speakerLines, stripTags } from '../src/api.ts'
import { reviewItems, setInline } from './review.ts'
import { stripComments } from './indexer.ts'
import { docx, docxToMarkdown, epub, importMarkdown, unzip as unzipFiles, zip } from './export.ts'
import { diffWords } from '../src/diff.ts'
import { beats, dialogueWords, overusedRanges, proseStats, proseText } from '../src/prose.ts'
import { ageAt, birthYears, continuity } from '../src/continuity.ts'
import { inflateRawSync, crc32 } from 'node:zlib'

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
  // Tagged dialogue: the speaker's name isn't prose; the line is.
  const said = 'She turned. {%"Not 50% sure," she said%}{@[[Ana|a1]]} and {%"Go."%}{@[[Bea|b2]]}'
  assert.equal(countWords(said), 9)
  assert.equal(stripTags(said), 'She turned. "Not 50% sure," she said and "Go."')
  assert.deepEqual(speakerLines(said), [{ text: '"Not 50% sure," she said', title: 'Ana', id: 'a1' }, { text: '"Go."', title: 'Bea', id: 'b2' }])
  assert.equal(readable(said), stripTags(said))
  // Descriptions: the text is prose, the entry and property aren't; nested in dialogue too.
  const desc = 'Her {^grey eyes^}{#[[Ana|a1]]:eyes} met {%"{^Hi^}{#[[Bea|b2]]:voice}"%}{@[[Bea|b2]]}'
  assert.equal(stripTags(desc), 'Her grey eyes met "Hi"')
  assert.equal(countWords(desc), 5)
  assert.deepEqual(descriptions(desc).map((d) => [d.text, d.id, d.prop, d.index]), [['grey eyes', 'a1', 'eyes', 0], ['Hi', 'b2', 'voice', 1]])

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

  // Export: Word and EPUB are valid zips (every entry's CRC checks out) holding the text, escaped.
  const unzip = (buf: Buffer) => {
    const files: Record<string, string> = {}
    for (let at = 0; buf.readUInt32LE(at) === 0x04034b50;) { // local file headers, in order
      const start = at + 30 + buf.readUInt16LE(at + 26)
      const body = buf.subarray(start, start + buf.readUInt32LE(at + 18))
      const data = buf.readUInt16LE(at + 8) ? inflateRawSync(body) : body
      assert.equal(data.length, buf.readUInt32LE(at + 22))
      assert.equal(crc32(data), buf.readUInt32LE(at + 14))
      files[buf.toString('utf8', at + 30, start)] = data.toString('utf8')
      at = start + body.length
    }
    return files
  }
  const book = { title: 'Ash & Ember', chapters: [{ title: 'Gate', scenes: ['A **b** *c*.', 'Next <scene>.'] }] }
  const word = unzip(docx(book))
  const paragraphs = [...word['word/document.xml'].matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((p) =>
    [...p[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''))
  assert.deepEqual(paragraphs, ['Ash &#38; Ember', 'Gate', 'A b c.', '* * *', 'Next &#60;scene&#62;.']) // angle brackets kept as typed
  assert.match(word['word/document.xml'], /<w:b\/><\/w:rPr><w:t xml:space="preserve">b</)
  const book2 = unzip(epub(book))
  assert.equal(Object.keys(book2)[0], 'mimetype') // first and stored, as EPUB requires
  assert.equal(book2.mimetype, 'application/epub+zip')
  assert.match(book2['OEBPS/chapter-1.xhtml'], /<h2>Gate<\/h2>\n<p>A <strong>b<\/strong> <em>c<\/em>\.<\/p>\n<p class="break">/)

  // Submission format: double-spaced, title page with word count, running header "Surname / TITLE / page".
  const sub = unzip(docx({ ...book, author: 'Mara Vell', words: 1200 }, true))
  assert.match(sub['word/styles.xml'], /w:line="480"/)
  assert.match(sub['word/header1.xml'], /Vell \/ ASH &#38; EMBER \/ <\/w:t><\/w:r><w:fldSimple w:instr="PAGE">/)
  assert.match(sub['word/document.xml'], /About 1,200 words/)
  assert.match(sub['word/document.xml'], /<w:headerReference w:type="default" r:id="rH"\/><w:titlePg\/>/)
  assert.match(sub['word/_rels/document.xml.rels'], /Target="header1.xml"/)
  assert.ok(!('word/header1.xml' in word)) // plain Word export unchanged

  // Import: Markdown splits into chapters and scenes; Word round-trips our own export.
  assert.deepEqual(importMarkdown('# Salt\n\n## One\n\nA.\n\n* * *\n\nB.\n\n## Two\n\nC.\n#\nD.', 'file'), {
    title: 'Salt', chapters: [{ title: 'One', scenes: ['A.', 'B.'] }, { title: 'Two', scenes: ['C.', 'D.'] }],
  })
  assert.deepEqual(importMarkdown('Just text.\n\n---\n\nMore.', 'notes'), { title: 'notes', chapters: [{ title: 'Chapter 1', scenes: ['Just text.', 'More.'] }] })
  assert.deepEqual(importMarkdown('Prologue text.\n\n## One\n\nA.', 'f').chapters.map((c) => c.title), ['Untitled chapter', 'One'])
  const back = importMarkdown(docxToMarkdown(docx(book)), 'x')
  assert.deepEqual(back, { title: 'Ash & Ember', chapters: [{ title: 'Gate', scenes: ['A **b** *c*.', 'Next <scene>.'] }] })
  // Word splits runs freely: neighbours with the same style merge, and markdown characters in the text are escaped.
  const runsXml = '<w:document><w:body><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>He</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">llo </w:t></w:r>' +
    '<w:r><w:t>2*3 &amp; </w:t></w:r><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>x</w:t></w:r></w:p><w:p><w:r><w:t>#</w:t></w:r></w:p></w:body></w:document>'
  assert.equal(docxToMarkdown(zip([{ name: 'word/document.xml', data: runsXml }])), '*Hello* 2\\*3 & x\n\n* * *')
  assert.throws(() => docxToMarkdown(zip([{ name: 'other.xml', data: '' }])), /Word document/)

  // Word diff: unchanged words kept, changes marked, whitespace preserved.
  assert.deepEqual(diffWords('The grey cat sat.', 'The black cat sat down.'), [
    { op: '=', text: 'The ' }, { op: '-', text: 'grey' }, { op: '+', text: 'black' }, { op: '=', text: ' cat ' },
    { op: '-', text: 'sat.' }, { op: '+', text: 'sat down.' },
  ])
  assert.deepEqual(diffWords('same', 'same'), [{ op: '=', text: 'same' }])
  assert.deepEqual(diffWords('', 'new text'), [{ op: '+', text: 'new text' }])
  const rebuilt = (parts: { op: string; text: string }[], skip: string) => parts.filter((p) => p.op !== skip).map((p) => p.text).join('')
  const [va, vb] = ['one two three four five six', 'one 2 three five six seven']
  assert.equal(rebuilt(diffWords(va, vb), '+'), va)
  assert.equal(rebuilt(diffWords(va, vb), '-'), vb)

  // Prose stats.
  const ps = proseStats('# Book\n\n## One\n\nShe ran quickly. "Run," he said, "run really fast."\n\n* * *\n\nShe ran quickly home. She ran quickly again.')
  assert.equal(ps.words, 17)
  assert.deepEqual(ps.adverbs, [['quickly', 3]])
  assert.deepEqual(ps.phrases, [['she ran quickly', 3]])
  assert.deepEqual(ps.topWords.slice(0, 3), [['quickly', 3], ['ran', 3], ['run', 2]])
  assert.deepEqual(ps.crutches, [['really', 1]])

  assert.equal(dialogueWords(proseText('She ran quickly. "Run," he said, "run really fast."')), 4)

  // Beats: the scene where the running total crosses ¼, ½, ¾; empty scenes never get one.
  const bs = (ws: number[]) => beats(ws.map((words, i) => ({ id: `s${i}`, words }))).map((b) => `${b.sceneId}:${b.beat}`)
  assert.deepEqual(bs([100, 100, 100, 100]), ['s0:¼', 's1:Midpoint', 's2:¾'])
  assert.deepEqual(bs([0, 400, 0, 100]), ['s1:¼', 's1:Midpoint', 's1:¾'])
  assert.deepEqual(bs([50]), ['s0:¼', 's0:Midpoint', 's0:¾'])
  assert.deepEqual(bs([0, 0]), [])

  // Overused words while writing: crutch words (whole words only) and -ly adverbs, with positions.
  const ov = 'Suddenly she just ran quickly, unjustly? Her family began to stare. Justice.'
  assert.deepEqual(overusedRanges(ov).map((r) => `${ov.slice(r.from, r.to)}:${r.why}`),
    ['Suddenly:on your words-to-check list', 'just:on your words-to-check list', 'quickly:-ly adverb', 'unjustly:-ly adverb',
      'began to:on your words-to-check list'])
  // "that" is off the default list; -ly adjectives and nouns aren't adverbs.
  const ok = 'She knew that the lovely, elderly, costly butterfly flew weekly.'
  assert.deepEqual(overusedRanges(ok), [])
  // A project's own lists: phrases match across spacing and case, never inside a longer word; notAdverbs are left alone.
  const mine = { check: ['nodded', 'a beat'], notAdverbs: ['Kelvanly'] }
  const ov2 = 'He nodded. A  beat. Abeat. Kelvanly smiled warmly.'
  assert.deepEqual(overusedRanges(ov2, mine).map((r) => ov2.slice(r.from, r.to)), ['nodded', 'A  beat', 'warmly'])
  assert.deepEqual(proseStats(ov2, mine).crutches, [['a beat', 1], ['nodded', 1]])
  assert.deepEqual(proseStats(ov2, mine).adverbs, [])
  assert.deepEqual(proseStats(`${ov2} ${ov2}`, mine).adverbs, [['warmly', 2]])

  // Continuity: a scene after a character's death (or before their birth) that still has them in it.
  const r = (id: string, type: string, extra = {}) => ({ id, type, title: id, words: 0, ...extra })
  const crows = [r('ana', 'character'), r('bo', 'character'), r('dies', 'event', { date: '300-5', tags: 'Death, war' }),
    r('born', 'event', { date: '280', tags: 'birth' }), r('s1', 'scene', { date: '300-4' }), r('s2', 'scene', { date: '301' }),
    r('s3', 'scene', { date: '279' }), r('s4', 'scene')]
  const clinks = [['dies', 'ana'], ['born', 'bo'], ['s1', 'ana'], ['s2', 'ana'], ['s2', 'bo'], ['s3', 'bo'], ['s4', 'ana']]
    .map(([from_id, to_id]) => ({ from_id, to_id }))
  assert.deepEqual(continuity(crows, clinks).map((w) => `${w.scene.id}:${w.who.id}:${w.kind}`), ['s2:ana:death', 's3:bo:birth'])

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

  // Deadline projection: 400 net words in the last 14 days → 1,400 words left take 49 days.
  assert.deepEqual(projection(g, '2026-03-03', 1400, 2800), { pace: 29, left: 1400, finish: '2026-04-21' })
  assert.deepEqual(projection(g, '2026-03-03', 2800, 2800), { pace: 29, left: 0, finish: '2026-03-03' }) // done
  assert.equal(projection(g, '2026-06-01', 1400, 2800).finish, null) // nothing written lately: no pace

  // ---- Find & replace: prose only, never inside links or comment notes ----
  const prose = 'Ana met [[Ana|a1]]. {==ana smiled==}{>>Ana? check<<} Banana. ANA.'
  const hits = proseMatches(prose, findPattern('ana', { wholeWord: true }))
  assert.deepEqual(hits.map((h) => h.text), ['Ana', 'ana', 'ANA'])
  assert.equal(spliceMatches(prose, hits, () => 'Bea'), 'Bea met [[Ana|a1]]. {==Bea smiled==}{>>Ana? check<<} Banana. Bea.')
  assert.equal(proseMatches(prose, findPattern('ana', { matchCase: true })).length, 2) // "ana" smiled, Banana
  assert.equal(proseMatches('a.b axb', findPattern('a.b')).length, 1) // literal text, not a regex
  assert.deepEqual(proseMatches('The Fox and the fox', findPattern(['Fox', 'The Fox'], { wholeWord: true })).map((h) => h.text), ['The Fox', 'the fox'])

  // ---- Word comments survive export → import ----
  const reviewed = { title: 'R', author: 'Mara Vell', chapters: [{ title: 'One', scenes: ['A {==b **c**==}{>>tighten<<} d.', 'E {==f==}{>>[x] done<<}.'] }] }
  const rw = unzip(docx(reviewed))
  assert.match(rw['word/comments.xml'], /<w:comment w:id="0" w:author="Mara Vell"><w:p><w:r><w:t xml:space="preserve">tighten</)
  assert.match(rw['word/document.xml'], /<w:commentRangeStart w:id="1"\/><w:r><w:t xml:space="preserve">f<\/w:t><\/w:r><w:commentRangeEnd w:id="1"\/>/)
  assert.match(rw['[Content_Types].xml'], /comments\+xml/)
  assert.deepEqual(importMarkdown(docxToMarkdown(docx(reviewed)), 'x').chapters[0].scenes, reviewed.chapters[0].scenes)
  assert.ok(!('word/comments.xml' in word)) // no comments, no comments part

  // ---- Front and back matter, EPUB cover and language ----
  const matter = { ...book, dedication: 'For *M*.', acknowledgements: 'Thanks, all.', language: 'fr', cover: { file: 'art.png', type: 'image/png', data: Buffer.from('png') } }
  const mw = unzip(docx(matter))['word/document.xml']
  assert.ok(mw.indexOf('w:val="Title"') < mw.indexOf('w:val="Dedication"') && mw.indexOf('w:val="Dedication"') < mw.indexOf('>Gate<'))
  assert.match(mw, /<w:br w:type="page"\/>[\s\S]*<w:i\/><\/w:rPr><w:t xml:space="preserve">M</) // dedication on its own page, italics kept
  assert.ok(mw.indexOf('>Acknowledgements<') > mw.indexOf('Next &#60;scene&#62;'))
  assert.match(unzip(docx(matter, true))['word/document.xml'], /Dedication[\s\S]*Acknowledgements/) // submission too
  const me = unzip(epub(matter))
  assert.match(me['OEBPS/content.opf'], /<dc:language>fr<\/dc:language>/)
  assert.match(me['OEBPS/content.opf'], /<item id="cover-image" href="cover.png" media-type="image\/png" properties="cover-image"\/>/)
  assert.match(me['OEBPS/content.opf'], /<spine>(<itemref idref="c\d"\/>){5}<\/spine>/) // cover, title, dedication, chapter, acknowledgements
  assert.equal(me['OEBPS/cover.png'], 'png')
  assert.match(me['OEBPS/cover.xhtml'], /lang="fr"[\s\S]*<img src="cover.png" alt="Cover"\/>/)
  assert.match(me['OEBPS/dedication.xhtml'], /For <em>M<\/em>\./)
  assert.match(me['OEBPS/nav.xhtml'], /<a href="acknowledgements.xhtml">Acknowledgements<\/a>/)
  assert.match(unzip(epub({ ...book, language: '"><x' }))['OEBPS/content.opf'], /<dc:language>en<\/dc:language>/) // junk → en
  assert.ok(!('OEBPS/cover.xhtml' in book2))

  // ---- Ages: scene year minus the year of a birth event ----
  const born = birthYears(crows, clinks)
  assert.deepEqual([...born], [['bo', 280]])
  assert.equal(ageAt(born, 'bo', '301'), 21)
  assert.equal(ageAt(born, 'bo', '300-4-2'), 20)
  assert.equal(ageAt(born, 'bo', ''), undefined) // undated scene
  assert.equal(ageAt(born, 'ana', '301'), undefined) // no birth event

  // ---- Backup → restore: a new project with every file identical; unsafe paths refused ----
  const backupFiles = projectFiles(dir)
  assert.ok(backupFiles.some((f) => f.name.startsWith('.history/')) && !backupFiles.some((f) => f.name.includes('.index.sqlite')))
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'writing-tool-restore-'))
  try {
    const slug = await restoreProject(root2, unzipFiles(zip(backupFiles)))
    assert.equal(slug, 'test-novel')
    assert.deepEqual(projectFiles(path.join(root2, slug)), backupFiles)
    assert.equal(await restoreProject(root2, unzipFiles(zip(backupFiles))), 'test-novel-2') // never over an existing project
    for (const bad of ['../evil.md', 'wiki/../../evil.md', '/abs.md', 'C:/x.md', 'a\\..\\..\\evil.md']) {
      const files = new Map([['project.json', Buffer.from('{"name":"Evil"}')], [bad, Buffer.from('x')]])
      await assert.rejects(restoreProject(root2, files), /Unsafe path/)
    }
    assert.ok(!fs.existsSync(path.join(root2, 'evil')) && !fs.existsSync(path.join(root2, 'evil.md')) && !fs.existsSync(path.join(os.tmpdir(), 'evil.md')))
    await assert.rejects(restoreProject(root2, new Map([['notes.md', Buffer.from('x')]])), /Not a project backup/)
  } finally {
    fs.rmSync(root2, { recursive: true, force: true })
  }

  console.log('selfcheck ok')
} finally {
  // Best effort: on failure the index may still be open, and Windows won't delete open files.
  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
}
