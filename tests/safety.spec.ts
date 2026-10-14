import { test, expect, type Page } from '@playwright/test'
import { editBodyOnDisk, exists, newProject, openProject, readFile, typeAtEnd } from './helpers.ts'

async function setup(page: Page, name: string) {
  const { slug, req, P } = await newProject(page, name)
  const ana = await req('post', P, { type: 'character', title: 'Ana', body: '' })
  const book = await req('post', P, { type: 'book', title: 'Book' })
  const one = await req('post', P, { type: 'chapter', title: 'One', parent: book.id })
  const two = await req('post', P, { type: 'chapter', title: 'Two', parent: book.id })
  const scene = await req('post', P, { type: 'scene', title: 'Opening', parent: one.id, body: 'First line.' })
  const open = async (title = 'Opening') => {
    await openProject(page, slug)
    await page.getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByLabel('Title')).toHaveValue(title) // loaded, so later disk edits happen after load
  }
  return { slug, req, P, ana, book, one, two, scene, open, scenePath: `${slug}/manuscript/book/one/opening.md` }
}

test('conflict: an outside edit is never silently overwritten', async ({ page }) => {
  const { scenePath, open } = await setup(page, 'conflict')
  await open()

  // Someone edits the file elsewhere, then we type: save is refused, our text is kept on screen.
  editBodyOnDisk(scenePath, 'Edited in another editor.')
  await typeAtEnd(page, ' Mine.')
  await expect(page.getByRole('alert')).toContainText('body')
  expect(readFile(scenePath)).toContain('Edited in another editor.')
  await expect(page.locator('.ProseMirror')).toContainText('First line. Mine.')

  // "Load the file's version" shows the outside edit.
  await page.getByRole('button', { name: "Load the file's version" }).click()
  await expect(page.locator('.ProseMirror')).toHaveText('Edited in another editor.')

  // Again, but "Keep mine" overwrites.
  editBodyOnDisk(scenePath, 'Second outside edit.')
  await typeAtEnd(page, ' Final.')
  await page.getByRole('button', { name: 'Keep mine (overwrite)' }).click()
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scenePath)).toContain('Edited in another editor. Final.')
  expect(readFile(scenePath)).not.toContain('Second outside edit.')
})

test('drag-reorder while editing is not a conflict', async ({ page }) => {
  const { slug, open } = await setup(page, 'dragedit')
  await open()
  await typeAtEnd(page, ' Before move.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  await page.locator('.tree-item', { has: page.getByRole('button', { name: 'Opening', exact: true }) })
    .dragTo(page.locator('.tree-item', { has: page.getByRole('button', { name: 'Two', exact: true }) }))
  await expect.poll(() => readFile(`${slug}/manuscript/book/two/opening.md`)).toContain('Before move.')
  await typeAtEnd(page, ' After move.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(readFile(`${slug}/manuscript/book/two/opening.md`)).toContain('Before move. After move.')
})

test('server down: edits are retried until saved', async ({ page }) => {
  const { scenePath, open } = await setup(page, 'offline')
  await open()
  await page.route('**/api/projects/*/entities/*', (route) => (route.request().method() === 'PUT' ? route.abort() : route.continue()))
  await typeAtEnd(page, ' Typed while offline.')
  await expect(page.locator('.statusbar')).toContainText('Save failed, retrying')
  await page.unrouteAll()
  await expect(page.locator('.statusbar')).toContainText('Saved', { timeout: 10_000 })
  expect(readFile(scenePath)).toContain('First line. Typed while offline.')
})

test('closing the tab with unsaved text asks first and still saves', async ({ page }) => {
  const { scenePath, open } = await setup(page, 'unload')
  await open()
  await typeAtEnd(page, ' Closing now.')
  const dialog = page.waitForEvent('dialog')
  void page.close({ runBeforeUnload: true })
  const d = await dialog
  expect(d.type()).toBe('beforeunload')
  await d.accept()
  await expect.poll(() => readFile(scenePath)).toContain('Closing now.')
})

test('chapters move between books with their scenes', async ({ page }) => {
  const { slug, req, P, open } = await setup(page, 'chmove')
  await req('post', P, { type: 'book', title: 'Sequel' })
  await open()
  await page.locator('.tree-item', { has: page.getByRole('button', { name: 'One', exact: true }) })
    .dragTo(page.locator('.tree-item', { has: page.getByRole('button', { name: 'Sequel', exact: true }) }))
  await expect.poll(() => readFile(`${slug}/manuscript/sequel/one/opening.md`)).toContain('First line.')
  expect(readFile(`${slug}/manuscript/sequel/one/_chapter.md`)).toContain('title: One')
  expect(exists(`${slug}/manuscript/book/one`)).toBe(false)
  // The tree shows it under the new book, and the scene still opens and saves.
  await expect(page.locator('.tree-item')).toHaveText([/^Book/, /^Two/, /^Sequel/, /^One/, /^Opening/])
  await page.getByRole('button', { name: 'Opening', exact: true }).click()
  await typeAtEnd(page, ' Moved.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(`${slug}/manuscript/sequel/one/opening.md`)).toContain('First line. Moved.')
})

test('POV links to a character; compile uses current names', async ({ page }) => {
  const { slug, req, P, ana, book, scene, scenePath, open } = await setup(page, 'pov')
  await open()
  await page.getByLabel('pov').selectOption({ label: 'Ana' })
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scenePath)).toContain(`[[Ana|${ana.id}]]`)
  await page.getByRole('button', { name: 'open', exact: true }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Ana')
  await expect(page.locator('.backlinks')).toContainText('Opening')

  // A stale stored title in the scene body still compiles to the current name.
  await req('put', `${P}/${scene.id}`, { body: `[[Ana|${ana.id}]] waits.` })
  await req('put', `${P}/${ana.id}`, { title: 'Ana Vale' })
  const compiled = await (await page.request.get(`/api/projects/${slug}/books/${book.id}/compile`)).text()
  expect(compiled).toContain('Ana Vale waits.')
})

test('scenes have Appears and Mentioned pickers that link entities', async ({ page }) => {
  const { req, P, ana, scenePath, open } = await setup(page, 'appears')
  const bram = await req('post', P, { type: 'character', title: 'Bram', body: '' })
  const harbor = await req('post', P, { type: 'location', title: 'Harbor', body: '' })
  await open()

  // Appears offers only characters; Mentioned offers any wiki entry.
  await expect(page.getByLabel('appears').locator('option')).toHaveText(['+ add…', 'Ana', 'Bram'])
  await page.getByLabel('appears').selectOption({ label: 'Ana' })
  await page.getByLabel('appears').selectOption({ label: 'Bram' })
  await expect(page.getByLabel('appears').locator('option')).toHaveText(['+ add…']) // no duplicates offered
  await page.getByLabel('mentioned').selectOption({ label: 'Harbor (location)' })
  await expect(page.locator('.statusbar')).toContainText('Saved')
  let file = readFile(scenePath)
  expect(file).toContain(`[[Ana|${ana.id}]]`)
  expect(file).toContain(`[[Bram|${bram.id}]]`)
  expect(file).toContain(`[[Harbor|${harbor.id}]]`)

  // Remove one; the chip opens the entity, which lists the scene under "Appears in".
  await page.getByRole('button', { name: 'Remove Bram' }).click()
  await expect(page.locator('.statusbar')).toContainText('Saved')
  file = readFile(scenePath)
  expect(file).not.toContain('Bram')
  await page.locator('.link-list').getByRole('button', { name: 'Harbor', exact: true }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Harbor')
  await expect(page.locator('.backlinks')).toContainText('Opening')
})

test('wiki footer separates Appears in / Mentioned in / Relationships', async ({ page }) => {
  const { req, P, ana, scene, open } = await setup(page, 'footer')
  const bram = await req('post', P, { type: 'character', title: 'Bram', relationships: [{ to: ana.id, kind: 'brother of' }], body: '' })
  const cal = await req('post', P, { type: 'character', title: 'Cal', body: '' })
  const harbor = await req('post', P, { type: 'location', title: 'Harbor', body: '' })
  await req('put', `${P}/${scene.id}`, {
    pov: `[[Bram|${bram.id}]]`,
    appears: [`[[Ana|${ana.id}]]`],
    mentioned: [`[[Harbor|${harbor.id}]]`],
    body: `[[Ana|${ana.id}]] thinks of [[Cal|${cal.id}]].`, // Ana is also mentioned, but she appears: listed once
  })
  const footer = (title: string) => page.locator('.backlinks').getByRole('region', { name: title })
  const visit = async (title: string) => {
    await page.locator('aside').getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByLabel('Title')).toHaveValue(title)
  }
  await open('Ana')

  await expect(footer('Appears in')).toContainText('Opening')
  await expect(footer('Mentioned in')).toHaveCount(0)
  await expect(footer('Relationships')).toContainText('Bram')
  await expect(footer('Relationships')).toContainText('brother of')

  await visit('Bram')
  await expect(footer('Appears in')).toContainText('POV')

  await visit('Cal')
  await expect(footer('Mentioned in')).toContainText('Opening')
  await expect(footer('Appears in')).toHaveCount(0)

  await visit('Harbor')
  await expect(footer('Mentioned in')).toContainText('Opening')
  await page.screenshot({ path: 'test-results/footer.png' })
})

test('timeline filters by tag', async ({ page }) => {
  const { req, P, open } = await setup(page, 'tags')
  await req('post', P, { type: 'event', title: 'Siege', date: '1', tags: 'War, politics', body: '' })
  await req('post', P, { type: 'event', title: 'Wedding', date: '2', tags: 'politics', body: '' })
  await open()
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(page.locator('.timeline li')).toHaveCount(2)
  await page.getByLabel('Filter by').selectOption('#war')
  await expect(page.locator('.timeline li')).toHaveText([/Siege/])
  await page.locator('.timeline li').getByRole('button', { name: '#politics' }).click()
  await expect(page.locator('.timeline li')).toHaveCount(2)
})
