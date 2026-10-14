import { test, expect } from '@playwright/test'
import { newProject, openProject, readFile } from './helpers.ts'

test('links: @mention, hover preview, backlinks, rename, search', async ({ page }) => {
  const { slug, req, P } = await newProject(page, 'links')
  const post = (url: string, data: object) => req('post', url, data)
  const ana = await post(P, { type: 'character', title: 'Ana Vale', role: 'Smuggler', body: 'Grew up by the docks.' })
  await post(P, { type: 'location', title: 'Harbor', body: '' })
  const book = await post(P, { type: 'book', title: 'Book' })
  const ch = await post(P, { type: 'chapter', title: 'One', parent: book.id })
  await post(P, { type: 'scene', title: 'Opening', parent: ch.id, body: '' })

  await openProject(page, slug)
  await page.getByRole('button', { name: 'Opening', exact: true }).click()

  // Type @ana → menu → Enter inserts the link; typing continues after it.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('Then @ana')
  await expect(page.locator('.suggest button')).toHaveCount(1)
  await expect(page.locator('.suggest button')).toContainText('Ana Vale')
  await page.keyboard.press('Enter')
  await page.keyboard.type('reached the @harb')
  await page.keyboard.press('Enter')
  await page.keyboard.type('at dawn.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  const scene = `${slug}/manuscript/book/one/opening.md`
  expect(readFile(scene)).toContain(`Then [[Ana Vale|${ana.id}]] reached the [[Harbor|`)
  expect(readFile(scene)).toContain('at dawn.')

  // Hover shows a preview with fields and body.
  await page.locator('.wiki-link', { hasText: 'Ana Vale' }).hover()
  await expect(page.locator('.preview')).toContainText('Smuggler')
  await expect(page.locator('.preview')).toContainText('Grew up by the docks.')

  // Ctrl+click opens Ana; her backlinks list the scene.
  await page.locator('.wiki-link', { hasText: 'Ana Vale' }).click({ modifiers: ['Control'] })
  await expect(page.getByLabel('Title')).toHaveValue('Ana Vale')
  await expect(page.locator('.backlinks')).toContainText('Opening')

  // Rename Ana; the scene shows the new name and saves it on next edit.
  await page.getByLabel('Title').fill('Ana Thorne')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  await page.locator('.backlinks').getByRole('button', { name: /Opening/ }).click()
  await expect(page.locator('.wiki-link').first()).toHaveText('Ana Thorne')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' Rain.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scene)).toContain(`[[Ana Thorne|${ana.id}]]`)

  // Search finds body text (prefix match) and highlights it.
  await page.getByPlaceholder('Search everything…').fill('doc')
  await expect(page.locator('.hit')).toHaveCount(1)
  await expect(page.locator('.hit mark')).toHaveText('docks')
  await page.getByPlaceholder('Search everything…').fill('dawn')
  await expect(page.locator('.hit')).toHaveText([/Opening/]) // wait for this query's results, not the previous one's
  await page.locator('.hit').first().click()
  await expect(page.getByLabel('Title')).toHaveValue('Opening')
  await page.screenshot({ path: 'test-results/links.png' })
})

test('aliases: @ by any name, alias text survives renames and compile', async ({ page }) => {
  const { slug, req, P } = await newProject(page, 'aliases')
  const post = (data: object) => req('post', P, data)
  const ana = await post({ type: 'character', title: 'Ana', aliases: 'The Fox, Vixen', body: '' })
  const book = await post({ type: 'book', title: 'Book' })
  const ch = await post({ type: 'chapter', title: 'One', parent: book.id })
  await post({ type: 'scene', title: 'Opening', parent: ch.id, body: '' })
  await openProject(page, slug)
  await page.getByRole('button', { name: 'Opening', exact: true }).click()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('@fox')
  await expect(page.locator('.suggest button')).toHaveText(['The Fox → Anacharacter'])
  await page.keyboard.press('Enter')
  await page.keyboard.type('met @ana')
  await page.keyboard.press('Enter')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  const scene = `${slug}/manuscript/book/one/opening.md`
  expect(readFile(scene)).toContain(`[[The Fox|${ana.id}]] met [[Ana|${ana.id}]]`)

  // Sidebar filter finds her by alias.
  await page.getByPlaceholder('Filter wiki…').fill('vix')
  await expect(page.locator('aside .entry')).toHaveText(['Ana'])
  await page.getByPlaceholder('Filter wiki…').fill('')

  // Rename: the plain link follows, the alias link stays.
  await req('put', `${P}/${ana.id}`, { title: 'Ana Thorne' })
  await openProject(page, slug) // pick up the new title
  await page.getByRole('button', { name: 'Opening', exact: true }).click()
  await expect(page.locator('.wiki-link')).toHaveText(['The Fox', 'Ana Thorne'])
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' Rain.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scene)).toContain(`[[The Fox|${ana.id}]] met [[Ana Thorne|${ana.id}]]`)
  const md = await (await page.request.get(`/api/projects/${slug}/books/${book.id}/compile`)).text()
  expect(md).toContain('The Fox met Ana Thorne')
})
