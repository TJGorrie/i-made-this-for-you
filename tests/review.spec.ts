import { test, expect, type Page } from '@playwright/test'
import { newProject, openProject, readFile } from './helpers.ts'

async function setup(page: Page, name: string) {
  const { slug, req, P } = await newProject(page, name)
  const post = (data: object) => req('post', P, data)
  const book = await post({ type: 'book', title: 'Book' })
  const ch = await post({ type: 'chapter', title: 'One', parent: book.id })
  const scene = await post({ type: 'scene', title: 'Opening', parent: ch.id, body: 'First line here.' })
  return { slug, req, P, post, book, ch, scene, scenePath: `${slug}/manuscript/book/one/opening.md` }
}

// Select with the mouse, like a person would: drag across the first paragraph and past its end.
async function dragSelectFirstParagraph(page: Page) {
  const b = (await page.locator('.ProseMirror p').first().boundingBox())!
  await page.mouse.move(b.x + 1, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width + 100, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('review panel: mouse-selected comment, whole-scene note, tick both off', async ({ page }) => {
  const { slug, scenePath } = await setup(page, 'review-panel')
  await openProject(page, slug)
  await page.locator('aside').getByRole('button', { name: 'Opening', exact: true }).click()
  await dragSelectFirstParagraph(page)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const input = page.getByLabel('Comment', { exact: true })
  await expect(input).toBeFocused()
  await input.fill('too abrupt?')
  await input.press('Enter')
  await expect(page.locator('.ProseMirror .comment')).toHaveAttribute('title', 'too abrupt?')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scenePath)).toContain('{==First line here.==}{>>too abrupt?<<}')

  // A note on the whole scene.
  await page.getByRole('button', { name: '+ Note' }).click()
  await page.getByLabel('Note', { exact: true }).fill('check the timeline')
  await page.getByLabel('Note', { exact: true }).press('Enter')
  const review = page.getByRole('region', { name: 'Review' })
  await expect(review).toContainText('2 open')

  // Tick both: they leave the list, the files keep them marked done, the comment highlight goes.
  await review.getByLabel('Done: too abrupt?').click()
  await review.getByLabel('Done: check the timeline').click()
  await expect(review).toContainText('0 open')
  await expect(review.locator('li')).toHaveCount(0)
  await expect(page.locator('.ProseMirror .comment[data-done]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  const file = readFile(scenePath)
  expect(file).toContain('{==First line here.==}{>>[x] too abrupt?<<}')
  expect(file).toMatch(/review:\n\s+- note: check the timeline\n\s+done: true/)
  await expect(page.locator('.tree-item', { hasText: 'Opening' })).toContainText('3') // notes aren't words

  // "show done" brings them back; un-ticking re-opens.
  await review.getByLabel('show done').check()
  await expect(review.locator('li.done')).toHaveCount(2)
  await review.getByLabel('Done: too abrupt?').uncheck()
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(scenePath)).toContain('{>>too abrupt?<<}')
  await page.screenshot({ path: 'test-results/review-panel.png' })
})

test('review view: items across scenes, tick from there, jump to the passage', async ({ page }) => {
  const { slug, post, ch, scenePath } = await setup(page, 'review-view')
  await post({ type: 'scene', title: 'Second', parent: ch.id, body: 'Rain {==fell hard==}{>>cliché<<} on the {==roof==}{>>[x] fixed<<}.' })
  await post({ type: 'character', title: 'Ana', body: '', review: [{ note: 'decide her age' }] })
  await openProject(page, slug)
  await page.locator('aside').getByRole('button', { name: 'Opening', exact: true }).click()
  await page.getByRole('button', { name: '+ Note' }).click()
  await page.getByLabel('Note', { exact: true }).fill('too slow')
  await page.getByLabel('Note', { exact: true }).press('Enter')
  await expect(page.locator('.statusbar')).toContainText('Saved')

  await page.getByRole('button', { name: 'Review (3 open)' }).click()
  const view = page.locator('.review-view')
  // Reading order: Opening, Second, then the wiki.
  await expect(view.locator('.review-entity h4 .link')).toHaveText(['Opening', 'Second', 'Ana'])
  await expect(view.locator('li')).toHaveCount(3) // the done one is hidden
  await view.getByLabel('show done').check()
  await expect(view.locator('li')).toHaveCount(4)
  await view.getByLabel('show done').uncheck()

  await view.getByLabel('Done: too slow').click()
  await expect(page.getByRole('button', { name: 'Review (2 open)' })).toBeVisible()
  expect(readFile(scenePath)).toMatch(/- note: too slow\n\s+done: true/)

  await view.getByRole('button', { name: /fell hard/ }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Second')
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('fell hard')
})

test('review: dark theme screenshot', async ({ page }) => {
  const { slug, post, ch } = await setup(page, 'review-dark')
  await post({ type: 'scene', title: 'Second', parent: ch.id, body: 'Rain {==fell hard==}{>>cliché<<} on the roof.', review: [{ note: 'tighten' }] })
  await page.emulateMedia({ colorScheme: 'dark' })
  await openProject(page, slug)
  await page.locator('aside').getByRole('button', { name: 'Second', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Review' })).toContainText('2 open')
  await page.screenshot({ path: 'test-results/review-panel-dark.png' })
  await page.getByRole('button', { name: 'Review (2 open)' }).click()
  await page.screenshot({ path: 'test-results/review-view-dark.png' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: 'test-results/review-view.png' })
})

test('review mode: text read-only, comments boxed in the margin beside their passage', async ({ page }) => {
  const { slug, post, ch } = await setup(page, 'review-mode')
  const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} goes on for a while.`)
  long[1] = 'Rain {==fell hard==}{>>cliché<<} on the roof.'
  long[9] = 'The {==door==}{>>which door?<<} creaked.'
  await post({ type: 'scene', title: 'Second', parent: ch.id, body: long.join('\n\n') })
  await openProject(page, slug)
  await page.locator('aside').getByRole('button', { name: 'Second', exact: true }).click()
  await expect(page.locator('.margin-note')).toHaveText(['cliché', 'which door?']) // shown while editing too
  await page.getByRole('button', { name: 'Review', exact: true }).click()

  // Typing does nothing.
  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.type('XYZ')
  await expect(page.locator('.ProseMirror')).not.toContainText('XYZ')

  // One box per open comment, level with its passage.
  const notes = page.locator('.margin-note')
  await expect(notes).toHaveText(['cliché', 'which door?'])
  for (const [i, text] of ['fell hard', 'door'].entries()) {
    const gap = async () => {
      const mark = (await page.locator('.ProseMirror .comment', { hasText: text }).boundingBox())!
      const box = (await notes.nth(i).boundingBox())!
      expect(box.x).toBeGreaterThan(mark.x)
      return Math.abs(box.y - mark.y)
    }
    await expect.poll(gap).toBeLessThan(12) // boxes slide into place
  }
  await page.screenshot({ path: 'test-results/review-mode.png' })

  // Tick one off from its box; it's saved and leaves the margin.
  await notes.first().getByLabel('Done: cliché').click()
  await expect(notes).toHaveText(['which door?'])
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(`${slug}/manuscript/book/one/second.md`)).toContain('{==fell hard==}{>>[x] cliché<<}')

  // Commenting still works while reviewing: mouse-select, Comment, type, Enter.
  await page.locator('.ProseMirror p').first().dblclick({ position: { x: 20, y: 10 } }) // on "Paragraph"
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(page.locator('.review-draft q')).toHaveText('Paragraph')
  await page.getByLabel('Comment', { exact: true }).fill('vague')
  await page.getByLabel('Comment', { exact: true }).press('Enter')
  await expect(notes).toHaveText(['vague', 'which door?'])

  // Focus mode hides them.
  await page.getByRole('button', { name: 'Focus', exact: true }).click()
  await expect(notes.first()).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(notes.first()).toBeVisible()

  // Leaving review mode: editable again, comments still beside the text.
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(notes).toHaveText(['vague', 'which door?'])
  await page.locator('.ProseMirror p').last().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' Done.')
  await expect(page.locator('.statusbar')).toContainText('Saved')
  expect(readFile(`${slug}/manuscript/book/one/second.md`)).toContain('creaked.\n\nParagraph 11')
  expect(readFile(`${slug}/manuscript/book/one/second.md`)).toContain(' Done.')
})
