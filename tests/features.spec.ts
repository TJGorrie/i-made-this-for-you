import { test, expect, type Page } from '@playwright/test'
import { newProject, openProject, readFile, typeAtEnd } from './helpers.ts'

async function setup(page: Page, name: string) {
  const { slug, req, P } = await newProject(page, name)
  const ana = await req('post', P, { type: 'character', title: 'Ana', body: '' })
  const book = await req('post', P, { type: 'book', title: 'Book', author: 'Mara Vell' })
  const one = await req('post', P, { type: 'chapter', title: 'One', parent: book.id })
  const two = await req('post', P, { type: 'chapter', title: 'Two', parent: book.id })
  const gate = await req('post', P, { type: 'scene', title: 'Gate', parent: one.id, threads: 'heist', status: 'draft',
    body: `[[Ana|${ana.id}]] waited. She ran quickly. She ran quickly home. She ran quickly again.` })
  const dock = await req('post', P, { type: 'scene', title: 'Dock', parent: one.id, threads: 'romance', body: 'Quiet water.' })
  await openProject(page, slug)
  return { slug, req, P, ana, book, one, two, gate, dock }
}

const card = (page: Page, title: string) => page.getByRole('article', { name: title })

test('corkboard: status badge, synopsis saved from the card, thread filter, drag to another chapter', async ({ page }) => {
  const { slug } = await setup(page, 'board')
  await expect(page.locator('.tree-item', { hasText: 'Gate' }).locator('.badge')).toHaveAttribute('data-status', 'draft')

  await page.getByRole('button', { name: 'Corkboard' }).click()
  await expect(page.getByRole('region', { name: 'Chapter One' }).getByRole('article')).toHaveCount(2)
  await card(page, 'Gate').getByLabel('Gate synopsis').fill('Ana breaks in.')
  await card(page, 'Gate').getByLabel('Gate synopsis').blur()
  await expect.poll(() => readFile(`${slug}/manuscript/book/one/gate.md`)).toContain('synopsis: Ana breaks in.')

  await page.getByLabel('Highlight').selectOption('thread:heist')
  await expect(card(page, 'Dock')).toHaveClass(/faded/)
  await expect(card(page, 'Gate')).not.toHaveClass(/faded/)

  await card(page, 'Dock').dragTo(page.getByRole('region', { name: 'Chapter Two' }).getByRole('heading'))
  await expect(page.getByRole('region', { name: 'Chapter Two' }).getByRole('article', { name: 'Dock' })).toBeVisible()
  await expect.poll(() => readFile(`${slug}/manuscript/book/two/dock.md`)).toContain('Quiet water.')
  await page.screenshot({ path: 'test-results/board.png' })
})

test('history: compare an old version with the current text', async ({ page }) => {
  await setup(page, 'diff')
  await page.locator('aside').getByRole('button', { name: 'Dock', exact: true }).click()
  await typeAtEnd(page, ' Gulls overhead.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  await page.getByRole('button', { name: 'History' }).click()
  const panel = page.getByRole('complementary', { name: 'Version history' })
  await panel.locator('.versions button').first().click()
  await panel.getByLabel('Compare with now').check()
  const changes = panel.getByLabel('Changes since this version')
  await expect(changes.locator('ins')).toHaveText('Gulls overhead.')
  await expect(changes.locator('del')).toHaveCount(0)
  await expect(changes).toHaveText('Quiet water. Gulls overhead.')
})

test('import a Markdown manuscript as a new book; export formats', async ({ page }) => {
  const { slug, book } = await setup(page, 'import')
  await page.getByLabel('Import a manuscript').setInputFiles({
    name: 'salt-road.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# The Salt Road\n\n## Arrival\n\nRain on the gate.\n\n* * *\n\nMorning.\n\n## Departure\n\nGone.'),
  })
  await expect(page.getByLabel('Title')).toHaveValue('The Salt Road')
  for (const t of ['Arrival', 'Departure']) await expect(page.locator('.tree-item', { hasText: t })).toBeVisible()
  expect(readFile(`${slug}/manuscript/the-salt-road/arrival/scene-2.md`)).toContain('Morning.')

  const res = await page.request.get(`/api/projects/${slug}/books/${book.id}/compile?format=submission`)
  expect(res.headers()['content-disposition']).toContain('book-submission.docx')
  const read = await page.request.get(`/api/projects/${slug}/books/${book.id}/compile?format=read`)
  expect(await read.text()).toMatch(/<nav><ol><li><a href="#ch1">One<\/a><\/li>/)
})

test('prose stats and continuity warnings', async ({ page }) => {
  const { slug, req, P, ana, gate } = await setup(page, 'stats')
  await page.getByRole('button', { name: 'Prose stats' }).click()
  await expect(page.locator('.prose-numbers')).toContainText('Words15')
  await expect(page.locator('.prose-list', { hasText: '-ly adverbs' })).toContainText('quickly 3')
  await expect(page.locator('.prose-list', { hasText: 'Repeated phrases' })).toContainText('she ran quickly')

  await req('post', P, { type: 'event', title: 'Ana falls', date: '300', tags: 'death', involves: [`[[Ana|${ana.id}]]`] })
  await req('put', `${P}/${gate.id}`, { date: '301' })
  await openProject(page, slug) // pick up the entries made through the API
  await page.getByRole('button', { name: 'Timeline' }).click()
  await expect(page.getByRole('note', { name: 'Continuity warnings' })).toContainText('Gate is dated after Ana falls, but Ana is in it.')
  await expect(page.locator('.timeline li.scene')).toContainText('Gate')
})

test('sprint timer, shortcuts sheet, phone layout', async ({ page }) => {
  await setup(page, 'sprint')
  page.once('dialog', (d) => d.accept('5'))
  await page.getByRole('button', { name: 'start a sprint' }).click()
  await expect(page.getByRole('timer', { name: 'Sprint' })).toContainText(/4:5\d · 0 words/)
  await page.locator('aside').getByRole('button', { name: 'Dock', exact: true }).click()
  await typeAtEnd(page, ' Two more.')
  await expect(page.getByRole('timer', { name: 'Sprint' })).toContainText('+2 words')
  await page.getByRole('button', { name: 'stop' }).click()
  await expect(page.getByRole('status')).toContainText('Sprint done: +2 words in 1 min')
  await page.getByRole('button', { name: 'Writing log' }).click()
  await expect(page.getByRole('region', { name: 'Sprints' })).toContainText('2 words')

  await page.locator('body').press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()

  await page.setViewportSize({ width: 390, height: 800 })
  await expect(page.locator('aside')).toBeHidden()
  await page.getByRole('button', { name: /☰/ }).click()
  await page.locator('aside').getByRole('button', { name: 'Gate', exact: true }).click()
  await expect(page.locator('aside')).toBeHidden()
  await expect(page.getByLabel('Title')).toHaveValue('Gate')
  await page.screenshot({ path: 'test-results/phone.png' })
})

test('find & replace: preview counts, apply, links left alone', async ({ page }) => {
  const { slug, ana } = await setup(page, 'replace')
  await page.getByPlaceholder('Search everything…').fill('quickly')
  await page.getByText('Replace…').click()
  await page.getByLabel('Replace with').fill('fast')
  await page.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByRole('region', { name: 'Replace preview' })).toContainText('Gate scene · 3')
  await page.getByRole('button', { name: 'Replace 3 in 1 entry' }).click()
  await expect(page.getByRole('status')).toHaveText('Replaced 3 in 1 entry.')
  expect(readFile(`${slug}/manuscript/book/one/gate.md`)).toContain(`[[Ana|${ana.id}]] waited. She ran fast. She ran fast home.`)

  await page.getByPlaceholder('Search everything…').fill('Ana')
  await page.getByLabel('Match case').check()
  await page.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByRole('region', { name: 'Replace preview' })).toContainText('No matches outside links')
})

test('unlinked mentions: a plain-text name becomes a link', async ({ page }) => {
  const { slug, req, P, ana, one } = await setup(page, 'unlinked')
  await req('post', P, { type: 'scene', title: 'Pier', parent: one.id, body: 'At dusk ana waits by the pier. Banana boats.' })
  await openProject(page, slug)
  await page.locator('aside').getByRole('button', { name: 'Ana', exact: true }).click()
  const mentions = page.getByRole('region', { name: 'Unlinked mentions' })
  await expect(mentions).toContainText('Pier')
  await expect(mentions.locator('mark')).toHaveText(['ana']) // Gate links Ana already; "Banana" isn't her
  await mentions.getByRole('button', { name: 'Link' }).click()
  await expect(mentions).toBeHidden()
  await expect.poll(() => readFile(`${slug}/manuscript/book/one/pier.md`)).toContain(`At dusk [[ana|${ana.id}]] waits`)
  await expect(page.getByRole('region', { name: 'Mentioned in' })).toContainText('Pier')
})

test('cast grid with POV and ages; age next to the POV in the scene', async ({ page }) => {
  const { slug, req, P, ana, dock } = await setup(page, 'cast')
  const link = `[[Ana|${ana.id}]]`
  await req('put', `${P}/${dock.id}`, { pov: link, date: '300' })
  await req('post', P, { type: 'event', title: 'Ana is born', date: '280', tags: 'birth', involves: [link] })
  await openProject(page, slug)
  await page.getByRole('button', { name: 'Cast' }).click()
  const grid = page.getByRole('table', { name: 'Cast grid' })
  await expect(grid.getByRole('button', { name: 'Ana: Gate' })).toHaveText('●')
  await expect(grid.getByRole('button', { name: 'Ana: Dock · POV · age 20' })).toHaveText('◉')
  await expect(grid.locator('tr', { hasText: 'Ana' }).locator('.last-seen')).toHaveText('in the latest scene')
  await page.screenshot({ path: 'test-results/cast.png' })
  await grid.getByRole('button', { name: 'Ana: Dock · POV · age 20' }).click()
  await expect(page.locator('.field-row', { hasText: 'pov' })).toContainText('age 20')
})

test('drafts: save one, then compare it with the book now', async ({ page }) => {
  const { slug, req, P, dock } = await setup(page, 'drafts')
  await page.getByRole('button', { name: 'Drafts' }).click()
  page.once('dialog', (d) => d.accept('Sent to agent'))
  await page.getByRole('button', { name: 'Save draft…' }).click()
  const date = new Date().toLocaleDateString('sv-SE')
  await page.getByRole('button', { name: `${date}-sent-to-agent` }).click()
  await expect(page.getByRole('region', { name: 'Changes since this draft' })).toContainText('Nothing has changed.')
  expect(readFile(`${slug}/drafts/book/${date}-sent-to-agent.md`)).toContain('Quiet water.')

  await req('put', `${P}/${dock.id}`, { body: 'Quiet water. Gulls overhead.' })
  await page.getByRole('button', { name: `${date}-sent-to-agent` }).click()
  const changes = page.getByRole('region', { name: 'Changes since this draft' })
  await expect(changes.locator('ins')).toHaveText('Gulls overhead.')
  await expect(changes.locator('h4')).toHaveText(['One'])
  await page.screenshot({ path: 'test-results/drafts.png' })
})

test('backup, then restore it as a new project', async ({ page }) => {
  const { slug } = await setup(page, 'backup')
  const res = await page.request.get(`/api/projects/${slug}/backup`)
  expect(res.headers()['content-type']).toBe('application/zip')
  await page.goto('/')
  await page.getByLabel('Restore a backup').setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: await res.body() })
  await expect(page.locator('aside').getByRole('button', { name: 'Gate', exact: true })).toBeVisible()
  expect(readFile(`${slug}-2/manuscript/book/one/gate.md`)).toBe(readFile(`${slug}/manuscript/book/one/gate.md`))
  expect(readFile(`${slug}-2/project.json`)).toBe(readFile(`${slug}/project.json`))
})

test('front and back matter in every export, language, deadline', async ({ page }) => {
  const { slug, req, P, book } = await setup(page, 'matter')
  await req('put', `${P}/${book.id}`, { dedication: 'For M.', acknowledgements: 'Thanks, all.', language: 'fr' })
  const get = (format: string) => page.request.get(`/api/projects/${slug}/books/${book.id}/compile?format=${format}`)
  expect(await (await get('md')).text()).toMatch(/^# Book\n\nFor M\.\n\n## One[\s\S]*\n## Acknowledgements\n\nThanks, all\.\n$/)
  const read = await (await get('read')).text()
  expect(read).toMatch(/<html lang="fr">[\s\S]*<h1>Book<\/h1>\n<section class="dedication"><p>For M\.<\/p>\n<\/section>\n<nav>/)
  expect(read).toMatch(/<a href="#ack">Acknowledgements<\/a>[\s\S]*<h2 id="ack">Acknowledgements<\/h2>\n<p>Thanks, all\.<\/p>/)
  expect(await (await get('html')).text()).toMatch(/class="dedication"[\s\S]*Two[\s\S]*Acknowledgements/)
  for (const f of ['docx', 'submission', 'review', 'epub']) expect((await get(f)).status()).toBe(200)
  expect((await get('review')).headers()['content-disposition']).toContain('book-review.docx')

  await page.getByRole('button', { name: 'Writing log' }).click()
  await page.getByLabel('Deadline').fill('2030-01-01')
  await expect(page.locator('.projection')).toContainText('Set a word target on your book')
  await expect.poll(() => readFile(`${slug}/goals.json`)).toContain('"deadline": "2030-01-01"')
})

test('focus mode: dim all but the current paragraph, typewriter toggle', async ({ page }) => {
  const { slug, req, P, dock } = await setup(page, 'focus')
  await req('put', `${P}/${dock.id}`, { body: 'One line.\n\nTwo lines.\n\nThree lines.' })
  await openProject(page, slug)
  await page.locator('aside').getByRole('button', { name: 'Dock', exact: true }).click()
  await page.getByRole('button', { name: 'Focus' }).click()
  await page.getByRole('button', { name: 'Dim' }).click()
  await page.getByRole('button', { name: 'Typewriter' }).click()
  await expect(page.getByRole('button', { name: 'Typewriter' })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.ProseMirror p', { hasText: 'Two lines.' }).click()
  await expect(page.locator('.ProseMirror p.current')).toHaveText('Two lines.')
  await expect(page.locator('.ProseMirror p').first()).toHaveCSS('opacity', '0.3')
  await expect(page.locator('.ProseMirror p.current')).toHaveCSS('opacity', '1')
  await expect(page.getByRole('button', { name: 'History' })).toBeHidden() // toolbar buttons hide in focus mode
  await page.screenshot({ path: 'test-results/focus-dim.png' })
})

test('scene grid: any type, and plot threads', async ({ page }) => {
  const { slug, req, P, dock } = await setup(page, 'grid')
  const harbor = await req('post', P, { type: 'location', title: 'Harbor', body: '' })
  await req('put', `${P}/${dock.id}`, { body: `Quiet water at the [[Harbor|${harbor.id}]].` })
  await openProject(page, slug)
  await page.getByRole('button', { name: 'Cast' }).click()
  const grid = page.getByRole('table', { name: 'Cast grid' })
  await page.getByLabel('Rows').selectOption('location')
  await expect(grid.getByRole('button', { name: 'Harbor: Dock' })).toHaveText('●')
  await expect(grid.getByRole('button', { name: /^Harbor: Gate/ })).toHaveCount(0)
  await page.getByLabel('Rows').selectOption({ label: 'Threads' })
  await expect(grid.locator('tbody th')).toHaveText(['heist', 'romance'])
  await expect(grid.getByRole('button', { name: 'heist: Gate' })).toBeVisible()
  await expect(grid.locator('tr', { hasText: 'heist' }).locator('.last-seen')).toHaveText('1 scene ago')
  await page.screenshot({ path: 'test-results/threads-grid.png' })
})

test('corkboard pacing chart and story beats', async ({ page }) => {
  const { slug, req, P, dock } = await setup(page, 'pacing')
  await req('put', `${P}/${dock.id}`, { body: 'Quiet water lapped at the stones while the gulls argued over the nets.' }) // 13 words, like Gate
  await openProject(page, slug)
  await page.getByRole('button', { name: 'Corkboard' }).click()
  const pacing = page.getByRole('region', { name: 'Pacing' })
  await expect(pacing.getByRole('button')).toHaveCount(2)
  await expect(pacing.getByRole('button', { name: 'Dock: 13 words' })).toBeVisible()
  await expect(card(page, 'Gate').locator('.beat-badge')).toHaveText(['¼', 'Midpoint'])
  await expect(card(page, 'Dock').locator('.beat-badge')).toHaveText(['¾'])
  await page.screenshot({ path: 'test-results/pacing.png' })
  await pacing.getByRole('button', { name: 'Dock: 13 words' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Dock')
})

test('tag dialogue with its speaker: saved, counted per speaker, listed on the character', async ({ page }) => {
  const { slug, req, P, dock } = await setup(page, 'dialogue')
  await req('put', `${P}/${dock.id}`, { body: '"Hello there," she said. "Bye." Quiet water.' })
  await openProject(page, slug)
  await page.locator('.tree-item', { hasText: 'Dock' }).click()
  await page.locator('.ProseMirror p').first().click()
  // Select '"Hello there,"' (the first 14 characters).
  await page.locator('.ProseMirror p').first().evaluate((p) => {
    const text = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()! // inside the untagged-dialogue decoration
    const r = document.createRange()
    r.setStart(text, 0); r.setEnd(text, 14)
    getSelection()!.removeAllRanges(); getSelection()!.addRange(r)
  })
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe('"Hello there,"')
  await page.getByRole('button', { name: 'Speaker' }).click()
  await page.getByLabel('Who says it').selectOption({ label: 'Ana' })
  await expect(page.locator('.ProseMirror .speaker')).toHaveText('"Hello there,"')
  await expect.poll(() => readFile(`${slug}/manuscript/book/one/dock.md`)).toMatch(/\{%"Hello there,"%\}\{@\[\[Ana\|[^\]]+\]\]\} she said\./)

  await page.getByRole('button', { name: 'Prose stats' }).click()
  const table = page.getByRole('region', { name: 'Dialogue by speaker' })
  await expect(table.locator('tr', { hasText: 'Ana' })).toHaveText(/Ana\s*1 line in 1 scene\s*2 words\s*100% of tagged dialogue/)
  await expect(table).toContainText("About 1 word of quoted dialogue aren't tagged")

  await page.locator('aside').getByRole('button', { name: 'Ana', exact: true }).click()
  const lines = page.locator('.spoken-lines')
  await expect(lines).toContainText('1 in 1 scene')
  await lines.locator('summary').click()
  await expect(lines.locator('li')).toHaveText('"Hello there,"')
})

test('describe an entry from selected text: marked in the scene, listed on the entry, linked back', async ({ page }) => {
  const { slug, req, P, dock, ana } = await setup(page, 'describe')
  await req('put', `${P}/${dock.id}`, { body: 'Her grey eyes narrowed. She wore a red coat.' })
  await openProject(page, slug)
  await page.locator('.tree-item', { hasText: 'Dock' }).click()
  await expect(page.locator('.statusbar')).not.toContainText('Read aloud')
  const select = async (text: string) => {
    await page.locator('.ProseMirror p').first().click()
    await page.locator('.ProseMirror p').first().evaluate((p, text) => {
      const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walk.nextNode()) && !node.textContent!.includes(text));
      const at = node!.textContent!.indexOf(text)
      const r = document.createRange()
      r.setStart(node!, at); r.setEnd(node!, at + text.length)
      getSelection()!.removeAllRanges(); getSelection()!.addRange(r)
    }, text)
    await page.locator('.bubble-menu').getByRole('button', { name: 'Describe' }).click()
  }
  const describe = async (text: string, prop: string) => {
    await select(text)
    await page.getByLabel('Entry').selectOption({ label: 'Ana (character)' })
    await page.getByLabel('Property').fill(prop)
    await page.getByLabel('Property').press('Enter')
    await expect(page.getByLabel('Property')).toBeHidden()
  }
  const scene = () => readFile(`${slug}/manuscript/book/one/dock.md`)
  await describe('grey eyes', 'look')
  await describe('red coat', 'look')
  await expect(page.locator('.ProseMirror .described')).toHaveText(['grey eyes', 'red coat'])
  await expect.poll(scene).toContain(`Her {^grey eyes^}{#[[Ana|${ana.id}]]:look} narrowed. She wore a {^red coat^}{#[[Ana|${ana.id}]]:look}.`)

  // Ana's entry lists them from the text; each goes back to its passage.
  await page.locator('aside').getByRole('button', { name: 'Ana', exact: true }).click()
  const list = page.getByRole('region', { name: 'Described in the text' })
  await expect(list).toContainText('look')
  await expect(list.getByRole('button')).toHaveText(['grey eyes · Dock', 'red coat · Dock'])
  await list.getByRole('button', { name: 'red coat · Dock' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Dock')
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe('red coat')

  // Selecting a described passage edits that description: re-file it, then remove one.
  await page.locator('.bubble-menu').getByRole('button', { name: 'Describe' }).click()
  await expect(page.getByLabel('Property')).toHaveValue('look')
  await page.getByLabel('Property').fill('clothes')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(scene).toContain(`{^red coat^}{#[[Ana|${ana.id}]]:clothes}`)
  await select('grey eyes')
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect.poll(scene).toContain('Her grey eyes narrowed.')
  await page.locator('aside').getByRole('button', { name: 'Ana', exact: true }).click()
  await expect(list.getByRole('button')).toHaveText(['red coat · Dock'])
  await expect(list).toContainText('clothes')
})

test('highlight overused words while writing (light and dark)', async ({ page }) => {
  const { slug, req, P, gate } = await setup(page, 'overused')
  await req('put', `${P}/${gate.id}`, { body: 'Suddenly she ran quickly. Her family really waited.' })
  await openProject(page, slug)
  await page.locator('aside').getByRole('button', { name: 'Gate', exact: true }).click()
  const marks = page.locator('.ProseMirror .overused')
  await expect(marks).toHaveText(['Suddenly', 'quickly', 'really'])
  await expect(marks.first()).not.toHaveCSS('text-decoration-style', 'wavy') // off by default
  await page.getByLabel('Highlight in text').selectOption('words')
  await expect(marks.first()).toHaveCSS('text-decoration-style', 'wavy')
  await expect(marks.nth(1)).toHaveAttribute('title', '-ly adverb')
  await page.screenshot({ path: 'test-results/overused-light.png' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: 'test-results/overused-dark.png' })
})

test('highlight untagged dialogue; edit the words-to-check list', async ({ page }) => {
  const { slug, req, P, ana, gate } = await setup(page, 'untagged')
  await req('put', `${P}/${gate.id}`, { body: `{%"Run."%}{@[[Ana|${ana.id}]]} "Where?" He nodded. A beat.` })
  await openProject(page, slug)
  await page.locator('aside').getByRole('button', { name: 'Gate', exact: true }).click()
  const untagged = page.locator('.ProseMirror .untagged')
  await expect(untagged).toHaveText(['"Where?"']) // the tagged line isn't marked
  await page.getByLabel('Highlight in text').selectOption('dialogue')
  await expect(untagged.first()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.ProseMirror .overused')).toHaveCount(0) // nothing on the default list here

  await page.getByRole('button', { name: 'Prose stats' }).click()
  await page.getByText('Edit word lists').click()
  await page.getByLabel('Words to check').fill('nodded\na beat')
  await page.getByRole('button', { name: 'Save lists' }).click()
  await expect(page.locator('.prose-list', { hasText: 'Words to check' })).toContainText('a beat 1')
  expect(JSON.parse(readFile(`${slug}/project.json`)).words.check).toEqual(['nodded', 'a beat'])

  await page.locator('aside').getByRole('button', { name: 'Gate', exact: true }).click()
  await expect(page.locator('.ProseMirror .overused')).toHaveText(['nodded', 'A beat'])
})
