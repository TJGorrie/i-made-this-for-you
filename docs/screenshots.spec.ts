// Run: npm run screenshots. Builds a demo novel in the test server's own projects folder (never the real one)
// and photographs each feature into docs/img/ for the README.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { PROJECTS_DIR } from '../playwright.config.ts'
import { fakeCursor, record } from './gif.ts'

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
test.setTimeout(300_000)
test.describe.configure({ mode: 'serial' }) // the GIFs reuse the demo the first test builds

const SLUG = 'the-salt-road'
const shot = async (page: Page, name: string) => {
  await page.locator('.app > aside').evaluate((el) => (el.scrollTop = 0)) // same sidebar view in every picture
  await page.screenshot({ path: `docs/img/${name}.png` })
}

// Pictures drawn in the browser, so the demo needs no image files.
async function draw(page: Page, kind: 'map' | 'portrait') {
  const b64 = await page.evaluate((kind) => {
    const c = document.createElement('canvas')
    const g = c.getContext('2d')!
    if (kind === 'portrait') {
      Object.assign(c, { width: 300, height: 360 })
      const bg = g.createLinearGradient(0, 0, 0, 360); bg.addColorStop(0, '#5b7a8c'); bg.addColorStop(1, '#2f4452')
      g.fillStyle = bg; g.fillRect(0, 0, 300, 360)
      g.fillStyle = '#3b2a22'; g.beginPath(); g.ellipse(150, 150, 82, 96, 0, 0, Math.PI * 2); g.fill() // hair
      g.fillStyle = '#d9b48f'; g.beginPath(); g.ellipse(150, 160, 62, 78, 0, 0, Math.PI * 2); g.fill() // face
      g.fillStyle = '#3b2a22'; g.beginPath(); g.ellipse(150, 102, 70, 34, 0, Math.PI, Math.PI * 2); g.fill() // fringe
      g.fillStyle = '#7a3b2e'; g.beginPath(); g.moveTo(40, 360); g.quadraticCurveTo(150, 220, 260, 360); g.fill() // coat
    } else {
      Object.assign(c, { width: 1400, height: 900 })
      g.fillStyle = '#b8d0d8'; g.fillRect(0, 0, 1400, 900)
      g.fillStyle = '#eadfbd'; g.strokeStyle = '#7d6a48'; g.lineWidth = 4
      g.beginPath(); g.moveTo(0, 620)
      for (const [x, y] of [[180, 560], [330, 610], [430, 540], [560, 500], [700, 470], [820, 380], [960, 330], [1080, 230], [1220, 180], [1400, 120]]) g.lineTo(x, y)
      g.lineTo(1400, 0); g.lineTo(0, 0); g.closePath(); g.fill(); g.stroke()
      g.fillStyle = '#9fb28a'
      for (let i = 0; i < 60; i++) { g.beginPath(); g.arc(700 + Math.cos(i * 2.4) * 120 * Math.sqrt(i / 60), 330 + Math.sin(i * 2.4) * 70 * Math.sqrt(i / 60), 6, 0, Math.PI * 2); g.fill() }
      g.strokeStyle = '#6f93a3'; g.lineWidth = 5; g.beginPath(); g.moveTo(300, 0); g.bezierCurveTo(360, 200, 520, 300, 470, 540); g.stroke()
      g.fillStyle = '#5c4a30'; g.font = 'italic 54px Georgia'; g.fillText('The Salt Coast', 90, 110)
      g.font = '28px Georgia'; g.fillStyle = '#4c6f80'; g.fillText('Grey Sea', 950, 700)
      g.strokeStyle = '#5c4a30'; g.lineWidth = 2; g.beginPath(); g.moveTo(1250, 820); g.lineTo(1250, 720); g.stroke()
      g.fillStyle = '#5c4a30'; g.font = 'bold 28px Georgia'; g.fillText('N', 1240, 710)
    }
    return c.toDataURL('image/png').split(',')[1]
  }, kind)
  return Buffer.from(b64, 'base64')
}

test('screenshots', async ({ page }) => {
  fs.rmSync(path.join(PROJECTS_DIR, SLUG), { recursive: true, force: true }) // only this script's own demo project
  fs.mkdirSync('docs/img', { recursive: true })
  await page.goto('/')
  const api = async (method: 'post' | 'put', url: string, data: object) => {
    const res = await page.request[method](`/api${url}`, { data })
    expect(res.ok(), await res.text()).toBe(true)
    return res.json()
  }
  await api('post', '/projects', { name: 'The Salt Road' })
  const P = `/projects/${SLUG}`
  const E = `${P}/entities`
  const add = (data: object) => api('post', E, { body: '', ...data })
  const upload = async (name: string, data: Buffer) =>
    (await (await page.request.post(`/api${P}/assets?name=${name}`, { data })).json()).name
  const link = (e: { id: string; title: string }, text = e.title) => `[[${text}|${e.id}]]`
  const says = (e: { id: string; title: string }, line: string) => `{%${line}%}{@${link(e)}}` // dialogue tagged with its speaker

  // ---- The world ----
  const portrait = await upload('mara.png', await draw(page, 'portrait'))
  const mara = await add({
    type: 'character', title: 'Mara Vell', portrait, aliases: 'The Fox, Mara', age: '19', role: 'Smuggler, reluctant heir',
    appearance: 'Salt-bleached hair, a sailmaker’s hands, one boot always unlaced.',
    personality: 'Patient until she isn’t. Counts things when she is afraid.', goals: 'Keep her brother out of the Tithe Guild’s books.',
    body: 'Raised above the net lofts in Harrowmouth. Knows the tide tables by heart and the marsh paths only in her dreams.',
  })
  const tomas = await add({ type: 'character', title: 'Tomas Vell', age: '15', role: 'Mara’s brother', body: 'Talks too much, rows too well.' })
  const ines = await add({ type: 'character', title: 'Old Ines', aliases: 'Grandmother Vell', age: '81', role: 'The family’s memory', body: 'Has not left her chair by the stove in three winters.' })
  const elsa = await add({ type: 'character', title: 'Elsa Vell', role: 'Mara’s mother (lost in the marsh)', body: '' })
  const harrow = await add({ type: 'location', title: 'Harrowmouth', region: 'The Salt Coast', climate: 'Wet, windy, smells of tar', body: 'A port of net lofts and slate roofs, built where the river gives up and the sea begins.' })
  const marsh = await add({ type: 'location', title: 'The Glass Marsh', aliases: 'the Marsh', region: 'The Salt Coast', climate: 'Fog most mornings', body: 'Reed country. The water is so clear you can see the old road under it.' })
  const spire = await add({ type: 'location', title: 'Saltspire', region: 'The Northern Reach', body: 'The Guild’s tower, white with salt to the third storey.' })
  const guild = await add({ type: 'faction', title: 'The Tithe Guild', goals: 'A share of every catch, forever.', body: 'Collectors, record-keepers, and worse.' })
  const rook = await add({
    type: 'character', title: 'Captain Rook', aliases: 'the Grey Captain', role: 'Tithe collector', body: 'Walks the quay the way other men walk their gardens.',
    relationships: [{ to: guild.id, kind: 'captain of' }, { to: mara.id, kind: 'hunts' }],
  })
  const rel = (from: { id: string }, rels: { to: string; kind: string }[]) => api('put', `${E}/${from.id}`, { relationships: rels })
  await rel(ines, [{ to: elsa.id, kind: 'parent of' }])
  await rel(elsa, [{ to: mara.id, kind: 'parent of' }, { to: tomas.id, kind: 'parent of' }])
  await rel(mara, [{ to: tomas.id, kind: 'sister of' }, { to: harrow.id, kind: 'lives in' }])
  await rel(tomas, [{ to: harrow.id, kind: 'lives in' }])
  await rel(guild, [{ to: spire.id, kind: 'based in' }])
  await add({ type: 'item', title: 'The Vell Ledger', owner: link(ines), origin: 'Kept since the Drowning Year', body: 'Every debt the family ever owed, in five different hands.' })
  await add({
    type: 'map', title: 'Map of the Coast', image: await upload('salt-coast.png', await draw(page, 'map')),
    pins: [{ entity: harrow.id, x: 450, y: 560 }, { entity: marsh.id, x: 700, y: 330 }, { entity: spire.id, x: 1110, y: 175 }],
  })

  // Timeline, with the world's own calendar.
  await api('put', `${P}/calendar`, { months: ['Thaw', 'Seedfall', 'Brightwane', 'Highsun', 'Emberfall', 'Frostmoon'], era: 'Year' })
  const event = (title: string, date: string, involves: { id: string; title: string }[], tags = '', body = '') =>
    add({ type: 'event', title, date, involves: involves.map((e) => link(e)), tags, body })
  await event('Harrowmouth is founded', '-112', [harrow], 'history')
  await event('The Drowning Year', '12', [harrow, marsh], 'history, floods', 'The sea comes over the wall; the old marsh road goes under.')
  await event('The Tithe Guild takes Saltspire', '140-5', [guild, spire], 'politics')
  await event('Mara is born', '281-4-9', [mara, elsa, harrow])
  await event('Elsa vanishes in the marsh', '294-6-2', [elsa, marsh, mara], 'mystery')
  await event('The tithe ship arrives', '300-3-12', [rook, mara, tomas, harrow], 'politics')
  await event('Into the Glass Marsh', '300-3-13', [mara, tomas, marsh])

  // ---- The manuscript ----
  const book = await add({ type: 'book', title: 'The Salt Road', target: '90000' })
  const ch1 = await add({ type: 'chapter', title: 'Low Tide', parent: book.id, target: '600' })
  const ch2 = await add({ type: 'chapter', title: 'The Glass Marsh', parent: book.id, target: '600' })
  const ch3 = await add({ type: 'chapter', title: 'Saltspire', parent: book.id, target: '600' })
  const tithe = await add({
    type: 'scene', title: 'The Tithe Ship', parent: ch1.id, status: 'revised', pov: link(mara), synopsis: 'Rook arrives to collect. Mara counts the guards.', threads: 'tithe, family', appears: [link(mara), link(tomas), link(rook)],
    mentioned: [link(harrow), link(guild)], review: [{ note: 'Check the tide times match chapter two', done: false }],
    body: `The tithe ship came in on the morning tide, black-sailed and riding low, and by the time it tied up at the long quay half of ${link(harrow)} had found a reason to be somewhere else.

${link(mara, 'Mara')} stayed. She sat on the sea wall with her boots hanging over the water and counted the guards as they came down the gangplank: six, then eight, then a tall man in a grey coat who did not need guards at all.

“That’s {==him==}{>>Hint at Rook earlier? Readers need to know the name before this.<<},” said ${link(tomas, 'Tomas')}, too loudly. “That’s ${link(rook)}.”

${says(mara, '“I know who it is.”')} She did not look away. Rook walked the quay the way other men walked their own gardens, and wherever he stopped, people found their purses.

Up on the hill the bells began to ring the tithe hour, slow and flat, {==like a door being knocked on by someone who already has the key==}{>>Love this. Keep.<<}.`,
  })
  await add({
    type: 'scene', title: 'What the Marsh Keeps', parent: ch1.id, status: 'draft', pov: link(mara), appears: [link(mara), link(ines)],
    synopsis: 'Ines tells Mara the marsh holds the Vell share.', threads: 'family, marsh',
    body: `${link(ines)} had not left her chair by the stove in three winters, but she knew about the ship before Mara had her coat off.

${says(ines, '“He’ll want the Vell share,”')} she said. ${says(ines, '“In salt, or in something worse.”')}

“We don’t have it.”

${says(ines, '“No.”')} Ines turned a cup in her hands. “But ${link(marsh, 'the Marsh')} does. Your mother knew the way through. I expect you remember more of it than you think.”

Mara remembered mist, and the sound of reeds closing behind a boat like a curtain. {==She remembered being told never to go back.==}{>>Too on the nose? Show it instead.<<}`,
  })
  await add({
    type: 'scene', title: 'Reeds', parent: ch2.id, status: 'draft', pov: link(mara), appears: [link(mara), link(tomas)],
    synopsis: 'Into the marsh at dusk, following the pale stones.', threads: 'marsh',
    body: `They went at dusk, when the tide was turning and the marsh breathed out its cold. Tomas rowed. Mara watched the water for the pale stones their mother used to follow, and found the first one where she had always known it would be.

Under the water, the old road ran on without them, straight as a ruled line.`,
  })
  await add({ type: 'scene', title: 'The White Tower', parent: ch3.id, status: 'outline', pov: link(rook), synopsis: 'Rook finds a name in the ledger.', threads: 'tithe', body: `${link(rook)} reads the Vell ledger and finds a name he did not expect.` })

  // A few saved versions of the first scene, for the History panel.
  const sceneUrl = `${E}/${tithe.id}`
  const current = (await (await page.request.get(`/api${sceneUrl}`)).json()).body as string
  await api('put', sceneUrl, { body: current.replace('black-sailed and riding low', 'riding low'), $snapshot: true })
  await api('put', sceneUrl, { body: current.replace('black-sailed and riding low', 'black-sailed'), $snapshot: true })
  await api('put', sceneUrl, { body: current, $snapshot: true })

  // Three weeks of writing, most days past a 500-word goal, 812 words so far today.
  await api('put', `${P}/goals`, { daily: 500 })
  const { total } = await (await page.request.get(`/api${P}/stats`)).json()
  const words = [420, 610, 0, 530, 780, 350, 0, 0, 640, 920, 505, 300, 710, 0, 560, 830, 515, 640, 1020, 590]
  const days: Record<string, { start: number; end: number }> = {}
  let c = total - 812 - words.reduce((a, b) => a + b, 0)
  words.forEach((w, i) => {
    const d = new Date(); d.setDate(d.getDate() - words.length + i)
    days[d.toLocaleDateString('sv-SE')] = { start: c, end: c + w }
    c += w
  })
  days[new Date().toLocaleDateString('sv-SE')] = { start: total - 812, end: total }
  fs.writeFileSync(path.join(PROJECTS_DIR, SLUG, 'goals.json'), JSON.stringify({ daily: 500, days }))

  // ---- Photos ----
  await page.goto('/')
  await page.getByRole('button', { name: 'The Salt Road', exact: true }).click()
  const aside = page.locator('aside')
  const openEntry = async (title: string) => {
    await aside.getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByLabel('Title')).toHaveValue(title)
  }
  const view = (name: RegExp | string) => aside.getByRole('button', { name, exact: typeof name === 'string' }).click()
  const settle = () => page.waitForTimeout(400) // margin notes and the graph slide into place

  await openEntry('The Tithe Ship')
  await expect(page.locator('.margin-note')).toHaveCount(2)
  await settle()
  await shot(page, 'editor')


  await aside.getByRole('button', { name: 'Mara Vell', exact: true }).click({ modifiers: ['Shift'] })
  await expect(page.getByLabel('Side pane', { exact: true })).toBeVisible()
  await settle()
  await shot(page, 'split')
  await page.getByRole('button', { name: 'Close side pane' }).click()

  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  await settle()
  await shot(page, 'focus')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.locator('.versions button').nth(1).click()
  await settle()
  await shot(page, 'history')
  await page.getByRole('button', { name: 'Close history' }).click()

  await page.emulateMedia({ colorScheme: 'dark' })
  await settle()
  await shot(page, 'editor-dark')
  await page.emulateMedia({ colorScheme: 'light' })

  await openEntry('Mara Vell')
  await expect(page.locator('.backlinks')).toContainText('The Tithe Ship')
  await shot(page, 'character')


  await openEntry('Map of the Coast')
  await expect(page.locator('.pin')).toHaveCount(3)
  await settle()
  await shot(page, 'map')

  await view('Timeline')
  await expect(page.locator('.timeline li')).toHaveCount(7)

  await view('Relationships')
  await page.getByLabel('Only relationships matching').fill('parent|sister')
  await page.getByLabel('Tree layout').check()
  await settle()
  await shot(page, 'family-tree')


  await view('Writing log')
  await expect(page.locator('.bar').first()).toBeVisible()
  await shot(page, 'writing-log')

  await page.getByPlaceholder('Search everything…').fill('marsh road')
  await expect(page.locator('.hit').first()).toBeVisible()
  await shot(page, 'search')
  await page.getByPlaceholder('Search everything…').fill('')
})

// ---- GIFs: the same demo, in motion (1x, main pane only, with a visible pointer) ----
test.describe('gifs', () => {
  test.use({ deviceScaleFactor: 1 })
  const CLIP = { x: 260, y: 0, width: 1020, height: 800 } // everything right of the sidebar

  test('gifs', async ({ page }) => {
    await page.addInitScript(fakeCursor)
    await page.goto('/')
    await page.getByRole('button', { name: 'The Salt Road', exact: true }).click()
    const aside = page.locator('.app > aside')
    const openEntry = async (title: string) => {
      await aside.getByRole('button', { name: title, exact: true }).click()
      await expect(page.getByLabel('Title')).toHaveValue(title)
    }
    // Move the pointer like a hand would, so the GIF shows where it goes.
    let at = { x: 900, y: 500 }
    await page.mouse.move(at.x, at.y)
    const glide = async (x: number, y: number) => {
      for (let i = 1; i <= 14; i++) {
        await page.mouse.move(at.x + ((x - at.x) * i) / 14, at.y + ((y - at.y) * i) / 14)
        await page.waitForTimeout(25)
      }
      at = { x, y }
    }
    const centre = async (l: ReturnType<Page['locator']>) => {
      const b = (await l.boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    const glideTo = async (l: ReturnType<Page['locator']>) => { const c = await centre(l); await glide(c.x, c.y) }
    const clickOn = async (l: ReturnType<Page['locator']>) => { await glideTo(l); await page.mouse.down(); await page.mouse.up() }
    // Screen rectangle of some text in the editor (for selecting it with the mouse).
    const textRect = (text: string) => page.evaluate((text) => {
      const walk = document.createTreeWalker(document.querySelector('.ProseMirror')!, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const i = n.textContent!.indexOf(text)
        if (i < 0) continue
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + text.length)
        const b = r.getBoundingClientRect()
        return { left: b.left, right: b.right, y: b.top + b.height / 2 }
      }
      throw new Error(`"${text}" not on screen`)
    }, text)
    const pause = (ms: number) => page.waitForTimeout(ms)
    const saved = () => expect(page.locator('.pane').first().locator('.statusbar')).toContainText('Saved') // the main pane's

    // 1. Write, and @-link a character by one of their other names; hover to see who it is.
    await openEntry('Reeds')
    let stop = record(page, CLIP)
    await pause(600)
    const end = await textRect('straight as a ruled line.')
    await glide(end.right + 2, end.y); await page.mouse.down(); await page.mouse.up()
    await page.keyboard.press('End')
    await page.keyboard.type(' Behind them, on the quay, @grey', { delay: 70 })
    await expect(page.locator('.suggest button').first()).toContainText('the Grey Captain → Captain Rook')
    await pause(900)
    await page.keyboard.press('Enter')
    await page.keyboard.type('was watching.', { delay: 70 })
    await pause(500)
    await glideTo(page.locator('.ProseMirror .wiki-link', { hasText: 'the Grey Captain' }))
    await expect(page.locator('.preview')).toContainText('Tithe collector')
    await pause(1800)
    console.log('writing.gif', await stop('docs/img/writing.gif'))
    await glide(1200, 700)
    await saved()

    // 2. Select a passage with the mouse, comment on it, tick it off.
    stop = record(page, CLIP)
    await pause(500)
    const line = await textRect('straight as a ruled line')
    await glide(line.left + 1, line.y); await page.mouse.down()
    for (let i = 1; i <= 12; i++) { await page.mouse.move(line.left + ((line.right - 1 - line.left) * i) / 12, line.y); await pause(30) }
    at = { x: line.right - 1, y: line.y }
    await page.mouse.up()
    await pause(400)
    await clickOn(page.getByRole('button', { name: 'Comment', exact: true }))
    await page.keyboard.type('Lovely. Echo this in the last chapter?', { delay: 55 })
    await pause(400)
    await page.keyboard.press('Enter')
    const note = page.locator('.margin-note', { hasText: 'Echo this' })
    await expect(note).toBeVisible()
    await pause(1400)
    await clickOn(note.getByRole('checkbox'))
    await expect(note).toHaveCount(0)
    await pause(1500)
    console.log('comments.gif', await stop('docs/img/comments.gif'))
    await saved()

    // 3. The timeline in the world's own calendar; click a tag to filter.
    await aside.getByRole('button', { name: 'Timeline', exact: true }).click()
    await expect(page.locator('.timeline li')).toHaveCount(7)
    stop = record(page, CLIP)
    await pause(1200)
    await clickOn(page.locator('.timeline .chip.tag', { hasText: '#politics' }).first())
    await expect(page.locator('.timeline li')).toHaveCount(2)
    await pause(1500)
    await glideTo(page.getByLabel('Filter by')) // the menu's own list doesn't show in screenshots, so pick from it directly
    await page.getByLabel('Filter by').selectOption('#history')
    await expect(page.locator('.timeline li')).toHaveCount(2)
    await pause(1500)
    await page.getByLabel('Filter by').selectOption('')
    await expect(page.locator('.timeline li')).toHaveCount(7)
    await pause(1200)
    console.log('timeline.gif', await stop('docs/img/timeline.gif'))

    // 4. Work through the review list: tick one off, jump to another in the text.
    await aside.getByRole('button', { name: /^Review \(/ }).click()
    const view = page.locator('.review-view')
    await expect(view.locator('li').first()).toBeVisible()
    stop = record(page, CLIP)
    await pause(1200)
    await clickOn(view.getByLabel('Done: Check the tide times match chapter two'))
    await expect(view.getByLabel('Done: Check the tide times match chapter two')).toHaveCount(0)
    await pause(1000)
    await clickOn(view.getByRole('button', { name: /like a door/ }))
    await expect(page.getByLabel('Title')).toHaveValue('The Tithe Ship')
    await pause(2200)
    console.log('review.gif', await stop('docs/img/review.gif'))

    // Drag-select some text in the editor, the way a hand would.
    const selectText = async (text: string) => {
      const r = await textRect(text)
      await glide(r.left + 1, r.y); await page.mouse.down()
      for (let i = 1; i <= 12; i++) { await page.mouse.move(r.left + ((r.right - 1 - r.left) * i) / 12, r.y); await pause(30) }
      at = { x: r.right - 1, y: r.y }
      await page.mouse.up()
      await pause(400)
    }
    const menu = page.locator('.bubble-menu')

    // Scroll the page with the wheel until something is comfortably on screen (x: which pane to scroll).
    const scrollTo = async (l: ReturnType<Page['locator']>, x = 800) => {
      await glide(x, 500)
      const top = () => l.evaluate((el) => el.getBoundingClientRect().top)
      for (let was = Infinity, now = await top(); now > 540 && now < was; was = now, now = await top()) { // until it's up or can't go further
        await page.mouse.wheel(0, 60); await pause(120)
      }
      await l.scrollIntoViewIfNeeded() // in case the wheel stalled (e.g. smooth scrolling hadn't started yet)
      await pause(800)
    }

    // 5. Describe: mark a phrase as describing a character, with his entry open beside the scene;
    // it appears there, linked back to the passage.
    await aside.getByRole('button', { name: 'Captain Rook', exact: true }).click({ modifiers: ['Shift'] })
    const side = page.getByLabel('Side pane', { exact: true })
    await expect(side.getByLabel('Title')).toHaveValue('Captain Rook')
    stop = record(page, CLIP)
    await pause(1000)
    await selectText('in a grey coat')
    await clickOn(menu.getByRole('button', { name: 'Describe' }))
    await glideTo(page.getByLabel('Entry', { exact: true }))
    await page.getByLabel('Entry', { exact: true }).selectOption({ label: 'Captain Rook (character)' })
    await pause(800)
    await clickOn(page.getByLabel('Property'))
    await page.keyboard.type('appearance', { delay: 80 })
    await pause(600)
    await clickOn(page.locator('form.describe').getByRole('button', { name: 'Add' }))
    await expect(page.locator('.ProseMirror .described', { hasText: 'in a grey coat' })).toBeVisible()
    await saved()
    const described = side.getByRole('region', { name: 'Described in the text' })
    await expect(described).toContainText('in a grey coat')
    await pause(600)
    await scrollTo(described, 1100)
    const passage = described.getByRole('button', { name: /in a grey coat/ })
    await glideTo(passage)
    await pause(1500)
    const away = await textRect('somewhere else.')
    await glide(away.right - 4, away.y); await page.mouse.down(); await page.mouse.up() // click away: the selection goes
    await pause(800)
    await clickOn(passage)
    await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe('in a grey coat')
    await pause(2500)
    console.log('describe.gif', await stop('docs/img/describe.gif'))
    await side.getByRole('button', { name: 'Close side pane' }).click()

    // 6. Speaker: tag a line of dialogue, then read everything that character says.
    await openEntry('What the Marsh Keeps')
    await page.getByLabel('Highlight in text').selectOption('dialogue') // untagged lines tinted, so the tag visibly lands
    const untagged = page.locator('.ProseMirror .untagged', { hasText: 'We don’t have it' })
    await untagged.scrollIntoViewIfNeeded()
    stop = record(page, CLIP)
    await pause(1500)
    await glideTo(untagged)
    await pause(800)
    await selectText('“We don’t have it.”')
    await pause(600)
    await clickOn(menu.getByRole('button', { name: 'Speaker' }))
    // Native dropdowns don't show in screenshots: open it as a list on the page and click the name.
    const who = page.getByLabel('Who says it')
    await who.evaluate((el: HTMLSelectElement) => (el.size = el.options.length))
    await pause(1000)
    await clickOn(who.getByRole('option', { name: 'Mara Vell' }))
    await expect(page.locator('.ProseMirror .speaker', { hasText: 'We don’t have it' })).toBeVisible()
    await glide(at.x + 120, at.y + 60)
    await pause(2000)
    await saved()
    await openEntry('Mara Vell')
    await pause(1200)
    const lines = page.locator('.spoken-lines')
    await expect(lines).toContainText('2 in 2 scenes')
    await scrollTo(lines)
    await clickOn(lines.locator('summary'))
    await expect(lines.locator('li')).toHaveCount(2)
    await pause(1000)
    await glideTo(lines.locator('li', { hasText: 'We don’t have it' }))
    await pause(3000)
    console.log('speaker.gif', await stop('docs/img/speaker.gif'))

    // 7. Highlight words to check, then dialogue nobody has been tagged as saying.
    await openEntry('The Tithe Ship')
    const highlight = page.getByLabel('Highlight in text')
    await highlight.selectOption('') // still on from the speaker GIF
    stop = record(page, CLIP)
    await pause(800)
    await glideTo(highlight)
    await highlight.selectOption('words')
    await pause(2200)
    await highlight.selectOption('dialogue')
    await pause(2200)
    await highlight.selectOption('')
    await pause(600)
    console.log('highlight.gif', await stop('docs/img/highlight.gif'))

    // 8. Prose stats: who talks most, and the words you lean on; click one to find it.
    await aside.getByRole('button', { name: 'Prose stats', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Dialogue by speaker' }).locator('tr')).toHaveCount(2)
    stop = record(page, CLIP)
    await pause(1600)
    await clickOn(page.locator('.prose-list', { hasText: 'Most used words' }).getByRole('button').first())
    await expect(page.locator('.hit').first()).toBeVisible()
    await pause(2200)
    console.log('prose.gif', await stop('docs/img/prose.gif'))
    await page.getByPlaceholder('Search everything…').fill('')

    // 9. The corkboard, picking out one plot thread.
    await aside.getByRole('button', { name: 'Corkboard', exact: true }).click()
    await expect(page.locator('.card')).toHaveCount(4)
    const pick = page.getByLabel('Highlight', { exact: true })
    stop = record(page, CLIP)
    await pause(1200)
    await glideTo(pick)
    await pick.selectOption('thread:marsh')
    await pause(1800)
    await pick.selectOption('thread:tithe')
    await pause(1800)
    await pick.selectOption('')
    await pause(800)
    console.log('corkboard.gif', await stop('docs/img/corkboard.gif'))
  })
})
