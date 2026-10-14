import { test, expect, type Page } from '@playwright/test'
import { newProject, openProject, readFile, typeAtEnd, writeFile } from './helpers.ts'

async function setup(page: Page, name: string) {
  const { slug, req, P } = await newProject(page, name)
  const ana = await req('post', P, { type: 'character', title: 'Ana', body: 'Ana notes.' })
  const book = await req('post', P, { type: 'book', title: 'Book' })
  const ch = await req('post', P, { type: 'chapter', title: 'One', parent: book.id })
  const scene = await req('post', P, { type: 'scene', title: 'Opening', parent: ch.id, body: 'First line.' })
  await openProject(page, slug)
  const openItem = async (title: string) => {
    await page.locator('aside').getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByLabel('Title')).toHaveValue(title)
  }
  return { slug, req, P, ana, book, scene, openItem, scenePath: `${slug}/manuscript/book/one/opening.md` }
}

const saved = (page: Page) => expect(page.locator('.statusbar').first()).toContainText('Saved')

test('history: browse and restore a version; restore is itself undoable', async ({ page }) => {
  const { openItem, scenePath } = await setup(page, 'history')
  await openItem('Opening')
  await typeAtEnd(page, ' Second line.')
  await saved(page)

  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'History' }).click()
  const panel = page.getByRole('complementary', { name: 'Version history' })
  await expect(panel.locator('.versions li')).toHaveCount(1) // the text before the first edit
  await panel.locator('.versions button').first().click()
  await expect(panel.locator('.version-body')).toHaveText('First line.')
  await panel.getByRole('button', { name: 'Restore this version' }).click()

  await expect(page.locator('.ProseMirror')).toHaveText('First line.')
  expect(readFile(scenePath)).not.toContain('Second line.')
  await page.getByRole('button', { name: 'History' }).click()
  await expect(panel.locator('.versions li')).toHaveCount(2) // the pre-restore text was kept
})

test('deleted items can be restored', async ({ page }) => {
  const { slug, openItem } = await setup(page, 'trash')
  await openItem('Ana')
  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('aside').getByRole('button', { name: 'Ana', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Deleted items' }).click()
  await expect(page.getByText(/Version history uses .* of 200\.0 MB/)).toBeVisible()
  await page.getByRole('row', { name: /Ana/ }).getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Ana')
  await expect(page.locator('.ProseMirror')).toHaveText('Ana notes.')
  expect(readFile(`${slug}/wiki/character/ana.md`)).toContain('Ana notes.')
})

test('template editor: add a link field, reject reserved names', async ({ page }) => {
  const { slug, openItem } = await setup(page, 'templates')
  await page.getByRole('button', { name: 'Templates' }).click()
  const character = page.getByRole('region', { name: 'character template' })
  await character.getByRole('button', { name: '+ field' }).click()
  await character.getByLabel('character field name').last().fill('nemesis')
  await character.getByLabel('nemesis kind').selectOption('link')
  await character.getByLabel('nemesis links to').selectOption('character')
  await page.getByRole('button', { name: 'Save templates' }).click()
  await expect(page.getByRole('button', { name: 'Save templates' })).toBeDisabled()
  expect(readFile(`${slug}/templates.json`)).toContain('"nemesis:character"')

  await openItem('Ana')
  await expect(page.getByLabel('nemesis')).toHaveJSProperty('tagName', 'SELECT')

  await page.getByRole('button', { name: 'Templates' }).click()
  await character.getByRole('button', { name: '+ field' }).click()
  await character.getByLabel('character field name').last().fill('title')
  await page.getByRole('button', { name: 'Save templates' }).click()
  await expect(page.locator('.templates .error')).toContainText('"title" is used by the app itself')
})

test('focus mode, dark mode, split view', async ({ page }) => {
  const { slug, openItem } = await setup(page, 'comfort')
  await openItem('Opening')

  await page.getByRole('button', { name: 'Focus' }).click()
  await expect(page.locator('aside')).toBeHidden()
  await expect(page.getByLabel('pov')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.locator('aside')).toBeVisible()

  // Theme cycles system → light → dark, applies, and survives a reload.
  const toggle = page.locator('aside .theme-toggle')
  await toggle.click()
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(27, 29, 31)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'test-results/dark.png' })
  await page.getByRole('button', { name: slug, exact: true }).click()
  await openItem('Opening')

  // Shift+click opens a character beside the scene; both stay editable.
  await page.locator('aside').getByRole('button', { name: 'Ana', exact: true }).click({ modifiers: ['Shift'] })
  const side = page.getByLabel('Side pane')
  await expect(side.getByLabel('Title')).toHaveValue('Ana')
  await expect(page.locator('.pane').first().getByLabel('Title')).toHaveValue('Opening')
  await side.getByLabel('role').fill('Smuggler')
  await expect(side.locator('.statusbar')).toContainText('Saved')
  await page.screenshot({ path: 'test-results/split.png' })
  await side.getByRole('button', { name: 'Close side pane' }).click()
  await expect(side).toHaveCount(0)
})

test('goals: daily word count with streak, book target in the tree', async ({ page }) => {
  const { openItem } = await setup(page, 'goals')
  page.once('dialog', (d) => d.accept('5'))
  await page.getByRole('button', { name: 'set goal' }).click()
  const today = page.getByLabel("Today's writing")
  await expect(today).toContainText('0 / 5 words')

  await openItem('Opening')
  await typeAtEnd(page, ' one two three four five six')
  await saved(page)
  await expect(today).toContainText('+6 / 5 words')
  await expect(today).toContainText('1-day streak')

  await openItem('Book')
  await page.getByLabel('target').fill('100')
  await saved(page)
  await expect(page.locator('.tree-item', { hasText: 'Book' }).first()).toContainText('8 / 100')
})

test('writing log: one bar per day, unopened days shown as zero', async ({ page }) => {
  const { slug } = await newProject(page, 'log')
  const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('sv-SE') }
  writeFile(`${slug}/goals.json`, JSON.stringify({ daily: 5, days: { [day(-2)]: { start: 0, end: 12 } } }))
  await openProject(page, slug) // records today
  await page.getByRole('button', { name: 'Writing log' }).click()

  await expect(page.locator('.bar-slot')).toHaveCount(3) // two days ago, yesterday (not opened: 0), today
  await expect(page.locator('.bar-slot').first()).toHaveAttribute('title', `${day(-2)}: 12 words`)
  await expect(page.locator('.writing-log')).toContainText('goal met on 1')
  await expect(page.locator('.goal-line')).toContainText('goal 5')
  await page.getByText('Table').click()
  await expect(page.locator('.writing-log tr')).toHaveText([`${day(0)}0`, `${day(-1)}0`, `${day(-2)}12`])
  await page.screenshot({ path: 'test-results/log.png' })
})

test('settings: shows the projects folder (fixed by PROJECTS_DIR in tests), no Quit outside the standalone app', async ({ page }) => {
  await page.goto('/')
  const folder = page.getByLabel('Projects folder')
  await expect(folder).toHaveValue(/writing-tool-e2e/)
  await expect(folder).toBeDisabled()
  await expect(page.getByText('Set by the PROJECTS_DIR environment variable.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quit Writing Tool' })).toHaveCount(0)
  // Other websites can't use the API.
  const res = await page.request.post('/api/projects', { data: { name: 'evil' }, headers: { origin: 'http://evil.example' } })
  expect(res.status()).toBe(403)
})
