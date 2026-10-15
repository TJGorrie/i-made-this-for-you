import { test, expect, type Page } from '@playwright/test'
import { newProject, openProject, png, readFile } from './helpers.ts'

async function setup(page: Page, name: string) {
  const { slug, req, P } = await newProject(page, name)
  const post = (data: object) => req('post', P, data)
  const book = await post({ type: 'book', title: 'Book' })
  const ch = await post({ type: 'chapter', title: 'One', parent: book.id })
  const scene = await post({ type: 'scene', title: 'Opening', parent: ch.id, body: 'First line here.' })
  const open = () => openProject(page, slug)
  const openItem = async (title: string) => {
    await page.locator('aside').getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByLabel('Title')).toHaveValue(title)
  }
  return { slug, req, P, post, book, scene, open, openItem, scenePath: `${slug}/manuscript/book/one/opening.md` }
}

test('comments: add on selected text, edit, not counted or compiled', async ({ page }) => {
  const { slug, req, P, book, scene, open, openItem, scenePath } = await setup(page, 'comments')
  await open()
  await openItem('Opening')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+Home')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight') // select "First"
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await page.getByLabel('Comment', { exact: true }).fill('too abrupt?')
  await page.getByLabel('Comment', { exact: true }).press('Enter')
  await expect(page.locator('.ProseMirror .comment')).toHaveAttribute('title', 'too abrupt?')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scenePath)).toContain('{==First==}{>>too abrupt?<<} line here.')
  await expect(page.locator('.tree-item', { hasText: 'Opening' })).toContainText('3') // the note isn't counted as words

  // Selection inside the comment → Comment edits it; empty removes it.
  await page.keyboard.press('Control+Home')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight') // "Fir"
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.getByLabel('Comment', { exact: true })).toHaveValue('too abrupt?')
  await page.getByLabel('Comment', { exact: true }).fill('')
  await page.getByLabel('Comment', { exact: true }).press('Enter')
  await expect(page.locator('.ProseMirror .comment')).toHaveCount(0)
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scenePath)).not.toContain('{==')

  // Compile drops comment markup.
  await req('put', `${P}/${scene.id}`, { body: 'A {==b==}{>>note<<} c.' })
  const md = await (await page.request.get(`/api/projects/${slug}/books/${book.id}/compile`)).text()
  expect(md).toContain('A b c.')
})

test('export: markdown, printable PDF page, Word, EPUB', async ({ page }) => {
  const { slug, book, open } = await setup(page, 'export')
  await open()
  const url = (f: string) => `/api/projects/${slug}/books/${book.id}/compile?format=${f}`
  expect(await (await page.request.get(url('md'))).text()).toContain('## One')
  const html = await (await page.request.get(url('html'))).text()
  expect(html).toContain('<h2>One</h2>')
  expect(html).toContain('print()')
  for (const [f, type] of [['docx', 'wordprocessingml'], ['epub', 'epub+zip']]) {
    const res = await page.request.get(url(f))
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain(type)
    expect((await res.body()).subarray(0, 2).toString()).toBe('PK') // a zip
  }
  await expect(page.getByLabel('Export Book')).toBeVisible()
})

test('calendar: month names and era label the timeline, y-m-d dates sort', async ({ page }) => {
  const { post, open } = await setup(page, 'calendar')
  await post({ type: 'event', title: 'Coronation', date: '300-3-12', body: '' })
  await post({ type: 'event', title: 'Thaw feast', date: '300-1', body: '' })
  await post({ type: 'event', title: 'Founding', date: '12', body: '' })
  await open()
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await page.getByText('Calendar', { exact: true }).click()
  await page.getByLabel('Month names').fill('Thaw\nBloom\nFrostmoon')
  await page.getByLabel('Era label').fill('Year')
  await page.getByRole('button', { name: 'Save calendar' }).click()
  await expect(page.locator('.timeline li')).toHaveText([/^Year 12Founding/, /^Thaw, Year 300Thaw feast/, /^12 Frostmoon, Year 300Coronation/])
})

test('family tree: filter relationships and switch to tree layout', async ({ page }) => {
  const { post, open } = await setup(page, 'tree')
  const kid = await post({ type: 'character', title: 'Kid', body: '' })
  const mum = await post({ type: 'character', title: 'Mum', relationships: [{ to: kid.id, kind: 'parent of' }], body: '' })
  await post({ type: 'character', title: 'Rival', relationships: [{ to: mum.id, kind: 'enemy of' }], body: '' })
  await open()
  await page.getByRole('button', { name: 'Relationships', exact: true }).click()
  const graph = page.locator('.graph')
  await expect(graph).toHaveAttribute('data-edges', '2')
  await page.getByLabel('Only relationships matching').fill('parent|child')
  await expect(graph).toHaveAttribute('data-edges', '1')
  await expect(graph).toHaveAttribute('data-nodes', '2')
  await page.getByLabel('Tree layout').check()
  await expect(graph).toHaveAttribute('data-layout', 'tree')
  await expect(graph.locator('canvas').first()).toBeVisible()
})

test('images: character portrait and location gallery', async ({ page }) => {
  const { slug, post, open } = await setup(page, 'images')
  await post({ type: 'character', title: 'Ana', body: '' })
  await post({ type: 'location', title: 'Harbor', body: '' })
  await open()
  await page.locator('aside').getByRole('button', { name: 'Ana', exact: true }).click()
  await page.getByLabel('portrait').setInputFiles({ name: 'Ana Face.png', mimeType: 'image/png', buffer: await png(page) })
  await expect(page.locator('.image-field img')).toHaveCount(1)
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(`${slug}/wiki/character/ana.md`)).toContain('portrait: ana-face.png')
  await expect(page.getByLabel('portrait')).toHaveCount(0) // one portrait: upload hidden until removed

  await page.locator('aside').getByRole('button', { name: 'Harbor', exact: true }).click()
  await page.getByLabel('gallery').setInputFiles([
    { name: 'dock.png', mimeType: 'image/png', buffer: await png(page, '#c96') },
    { name: 'lighthouse.png', mimeType: 'image/png', buffer: await png(page, '#69c') },
  ])
  await expect(page.locator('.image-field img')).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove dock.png' }).click()
  await expect(page.locator('.image-field img')).toHaveCount(1)
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(`${slug}/wiki/location/harbor.md`)).toMatch(/gallery:\n\s+- lighthouse\.png/)
  await page.screenshot({ path: 'test-results/gallery.png' })
})
