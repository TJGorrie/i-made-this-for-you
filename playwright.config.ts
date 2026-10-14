import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

// Tests get their own server and projects folder, never the real projects/ or a running `npm run dev`.
export const PROJECTS_DIR = path.join(os.tmpdir(), 'writing-tool-e2e')
const PORT = 5199

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    env: { PROJECTS_DIR },
  },
})
