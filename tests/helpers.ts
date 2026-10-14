// Shared by the UI tests. Files are read from the test server's own projects folder, never the real one.
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { PROJECTS_DIR } from '../playwright.config.ts'

const abs = (rel: string) => path.join(PROJECTS_DIR, rel)
export const readFile = (rel: string) => { try { return fs.readFileSync(abs(rel), 'utf8') } catch { return '' } }
export const writeFile = (rel: string, text: string) => fs.writeFileSync(abs(rel), text)
export const exists = (rel: string) => fs.existsSync(abs(rel))
// Simulate an edit made in another editor: replace the body, keep the frontmatter.
export const editBodyOnDisk = (rel: string, body: string) =>
  fs.writeFileSync(abs(rel), fs.readFileSync(abs(rel), 'utf8').replace(/\n---\n[\s\S]*$/, `\n---\n${body}`))

// A fresh project via the API; `req` sends JSON and returns the parsed reply.
export async function newProject(page: Page, name: string) {
  const slug = `e2e-${name}-${Date.now()}`
  const req = async (method: 'post' | 'put', url: string, data: object) => (await page.request[method](`/api${url}`, { data })).json()
  await req('post', '/projects', { name: slug })
  return { slug, req, P: `/projects/${slug}/entities` }
}

export async function openProject(page: Page, slug: string) {
  await page.goto('/')
  await page.getByRole('button', { name: slug, exact: true }).click()
}

// A small PNG drawn in the browser, for upload tests.
export async function png(page: Page, color = '#9cc') {
  const b64 = await page.evaluate((fill) => {
    const c = Object.assign(document.createElement('canvas'), { width: 120, height: 90 })
    const g = c.getContext('2d')!
    g.fillStyle = fill; g.fillRect(0, 0, 120, 90)
    return c.toDataURL('image/png').split(',')[1]
  }, color)
  return Buffer.from(b64, 'base64')
}

export async function typeAtEnd(page: Page, text: string) {
  await page.locator('.ProseMirror').first().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}
