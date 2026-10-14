import { test, expect, type Page } from '@playwright/test'
import { exists, newProject, openProject, readFile } from './helpers.ts'

async function setup(page: Page, name: string) {
  const { slug, req, P } = await newProject(page, name)
  const post = (url: string, data: object) => req('post', url, data)
  const ana = await post(P, { type: 'character', title: 'Ana', body: '' })
  const bram = await post(P, { type: 'character', title: 'Bram', relationships: [{ to: ana.id, kind: 'brother of' }], body: '' })
  const harbor = await post(P, { type: 'location', title: 'Harbor', body: '' })
  const open = () => openProject(page, slug)
  return { slug, post, P, ana, bram, harbor, open }
}

test('timeline: date order, labels, filter by linked entity', async ({ page }) => {
  const { post, P, ana, harbor, open } = await setup(page, 'timeline')
  await post(P, { type: 'event', title: 'Fall of the city', date: '300', dateLabel: 'Year 300', body: `[[Ana|${ana.id}]] flees.` })
  await post(P, { type: 'event', title: 'Founding', date: '-12.5', body: `Built at [[Harbor|${harbor.id}]].` })
  await post(P, { type: 'event', title: 'Rumours', body: '' })
  await open()
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()

  const items = page.locator('.timeline li')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('-12.5Founding')
  await expect(items.nth(1)).toContainText('Year 300Fall of the city')
  await expect(items.nth(2)).toContainText('UndatedRumours')

  await page.getByLabel('Filter by').selectOption({ label: 'Ana' })
  await expect(items).toHaveCount(1)
  await items.getByRole('button', { name: 'Ana' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Ana')
})

test('relationships: edit in entry, graph shows them', async ({ page }) => {
  const { slug, harbor, open } = await setup(page, 'rels')
  await open()
  await page.locator('aside').getByRole('button', { name: 'Ana', exact: true }).click()
  await page.getByRole('button', { name: '+ relationship' }).click()
  await page.getByLabel('Relationship', { exact: true }).fill('lives in')
  await page.getByLabel('Related to').selectOption({ label: 'Harbor' })
  await expect(page.locator('.statusbar')).toContainText('Saved')
  const file = readFile(`${slug}/wiki/character/ana.md`)
  expect(file).toContain('kind: lives in')
  expect(file).toContain(`to: ${harbor.id}`)
  // Bram's relationship points at Ana, so he's listed under her "Appears in".
  await expect(page.locator('.backlinks')).toContainText('Bram')

  await page.getByRole('button', { name: 'Relationships', exact: true }).click()
  await expect(page.locator('.graph')).toHaveAttribute('data-nodes', '3')
  await expect(page.locator('.graph')).toHaveAttribute('data-edges', '2')
  await expect(page.locator('.graph canvas').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/graph.png' })
})

test('map: upload image, place, open and remove pins', async ({ page }) => {
  const { slug, post, P, ana, open } = await setup(page, 'map')
  await post(P, { type: 'map', title: 'World', body: '' })
  await open()
  await page.locator('aside').getByRole('button', { name: 'World', exact: true }).click()

  // A 400x300 PNG drawn in the browser.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 400; c.height = 300
    const g = c.getContext('2d')!
    g.fillStyle = '#9cc'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#6a6'; g.fillRect(100, 80, 200, 140)
    return c.toDataURL('image/png').split(',')[1]
  })
  await page.locator('.map-view input[type=file]').setInputFiles({ name: 'My World.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.locator('.map .leaflet-image-layer')).toBeVisible()
  expect(exists(`${slug}/assets/my-world.png`)).toBe(true)

  await page.getByLabel('Pin entity').selectOption({ label: 'Ana' })
  await page.locator('.map').click({ position: { x: 200, y: 150 } })
  await expect(page.locator('.pin')).toHaveText('Ana')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  const file = readFile(`${slug}/wiki/map/world.md`)
  expect(file).toContain('image: my-world.png')
  expect(file).toContain(`entity: ${ana.id}`)
  await page.screenshot({ path: 'test-results/map.png' })

  // Pins link the map to Ana: she lists it under "Appears in". Clicking the pin opens her.
  await page.locator('.pin').click()
  await expect(page.getByLabel('Title')).toHaveValue('Ana')
  await expect(page.locator('.backlinks')).toContainText('World')

  // Back on the map, right-click removes the pin.
  await page.locator('.backlinks').getByRole('button', { name: /World/ }).click()
  page.once('dialog', (d) => d.accept())
  await page.locator('.pin').click({ button: 'right' })
  await expect(page.locator('.pin')).toHaveCount(0)
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(`${slug}/wiki/map/world.md`)).toContain('pins: []')
})

test('timeline: help tip, and "involves" makes an event filterable by who is in it', async ({ page }) => {
  const { post, P, open } = await setup(page, 'timeline-help')
  await post(P, { type: 'event', title: 'Storm', date: '12', body: '' })
  await open()
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(page.getByText("fill in an event's involves or tags field")).toBeVisible()
  const tip = page.locator('.timeline h2 .help')
  await expect(tip.getByRole('tooltip')).toBeHidden()
  await tip.hover()
  await expect(tip.getByRole('tooltip')).toContainText('involves')
  await page.screenshot({ path: 'test-results/timeline-help.png' })
  await page.mouse.move(0, 0)
  await expect(tip.getByRole('tooltip')).toBeHidden()

  // Pick Ana in the event's involves field → she's in the filter, and filtering shows the event.
  await page.locator('.timeline').getByRole('button', { name: 'Storm' }).click()
  await page.getByLabel('involves').selectOption({ label: 'Ana (character)' })
  await expect(page.locator('.statusbar')).toContainText('Saved')
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await page.getByLabel('Filter by').selectOption({ label: 'Ana' })
  await expect(page.locator('.timeline li')).toHaveText([/Storm/])
})
