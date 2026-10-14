import { test, expect, type Page } from '@playwright/test'
import { exists, readFile } from './helpers.ts'

const treeItem = (page: Page, title: string) =>
  page.locator('.tree-item', { has: page.getByRole('button', { name: title, exact: true }) })

test('manuscript: create, autosave, save on switch, drag to another chapter', async ({ page }) => {
  const slug = `e2e-${Date.now()}`
  const titles: string[] = []
  page.on('dialog', (d) => d.accept(titles.shift()))
  const add = async (button: ReturnType<Page['locator']>, title: string) => {
    titles.push(title)
    await button.click()
    await expect(treeItem(page, title)).toBeVisible()
  }

  await page.goto('/')
  await page.getByPlaceholder('New project name').fill(slug)
  await page.getByRole('button', { name: 'Create' }).click()

  await add(page.getByTitle('Add book'), 'Book')
  await add(treeItem(page, 'Book').getByTitle('Add chapter'), 'One')
  await add(treeItem(page, 'Book').getByTitle('Add chapter'), 'Two')
  await add(treeItem(page, 'One').getByTitle('Add scene'), 'Opening')

  // Autosave after typing stops.
  const scene = `${slug}/manuscript/book/one/opening.md`
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('Rain fell on the gate.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scene)).toContain('Rain fell on the gate.')
  await expect(treeItem(page, 'Book')).toContainText('5')

  // Text survives a reload.
  await page.reload()
  await page.getByRole('button', { name: slug }).click()
  await treeItem(page, 'Opening').getByRole('button').first().click()
  await expect(page.locator('.ProseMirror')).toContainText('Rain fell on the gate.')

  // Switching scene mid-typing (before the autosave delay) still saves.
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Then silence.')
  await add(treeItem(page, 'One').getByTitle('Add scene'), 'Second')
  await expect.poll(() => readFile(scene)).toContain('Then silence.')

  // Drag the scene onto chapter Two: its file moves into Two's folder, text intact.
  await treeItem(page, 'Opening').dragTo(treeItem(page, 'Two'))
  const moved = `${slug}/manuscript/book/two/opening.md`
  await expect.poll(() => readFile(moved)).toContain('Rain fell on the gate. Then silence.')
  await expect.poll(() => exists(scene)).toBe(false) // old copy is removed after the new one is written

  await page.screenshot({ path: 'test-results/manuscript.png' })
})
