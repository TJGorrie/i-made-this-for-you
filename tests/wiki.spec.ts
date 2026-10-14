import { test, expect } from '@playwright/test'
import { readFile } from './helpers.ts'

test('wiki: create from type page, template + custom fields, filter', async ({ page }) => {
  const slug = `e2e-wiki-${Date.now()}`
  const answers: string[] = []
  page.on('dialog', (d) => d.accept(answers.shift()))

  await page.goto('/')
  await page.getByPlaceholder('New project name').fill(slug)
  await page.getByRole('button', { name: 'Create' }).click()

  // Empty template types are listed so you can start them; open the character page.
  await page.locator('.type-heading').getByRole('button', { name: 'character', exact: true }).click()
  await expect(page.getByText('No character entries yet.')).toBeVisible()

  answers.push('Ana Vale')
  await page.getByRole('button', { name: 'New character' }).click()
  await page.getByLabel('role').fill('Smuggler')
  await page.getByLabel('appearance').fill('Tall.\nScar over left eye.')
  answers.push('nickname')
  await page.getByRole('button', { name: '+ field' }).click()
  await page.getByLabel('nickname').fill('The Fox')
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('Born in the harbor district.')
  await expect(page.locator('.statusbar')).toContainText('Saved')

  const file = readFile(`${slug}/wiki/character/ana-vale.md`)
  expect(file).toContain('role: Smuggler')
  expect(file).toContain('nickname: The Fox')
  expect(file).toContain('Scar over left eye.')
  expect(file).toContain('Born in the harbor district.')

  // A second character, then the table shows both with field columns, and filter narrows it.
  answers.push('Bram')
  await page.locator('.type-heading').getByTitle('Add character').click()
  await expect(page.getByLabel('Title')).toHaveValue('Bram')
  await page.locator('.statusbar').getByRole('button', { name: 'character' }).click()
  const table = page.locator('.type-table tbody tr')
  await expect(table).toHaveCount(2)
  await expect(table.first()).toContainText('Smuggler')
  await page.getByPlaceholder('Filter character…').fill('smug')
  await expect(table).toHaveCount(1)

  // Sidebar filter hides non-matching entries and empty types.
  await page.getByPlaceholder('Filter wiki…').fill('bram')
  await expect(page.locator('aside .entry')).toHaveText(['Bram'])
  await expect(page.locator('.type-heading')).toHaveCount(1)

  await table.first().click()
  await expect(page.getByLabel('nickname')).toHaveValue('The Fox')
  await page.screenshot({ path: 'test-results/wiki.png' })
})
