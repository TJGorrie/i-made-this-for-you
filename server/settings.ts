// App settings (just the projects folder for now), kept in the user's config folder, not with the projects.
// Where projects live: PROJECTS_DIR (tests) wins, then the folder picked in Settings, then a default.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isSea } from 'node:sea'
import { atomicWrite } from './store.ts'

// Running as the standalone app (a Node single executable), not from the source with npm.
export const packaged = isSea()
export const locked = !!process.env.PROJECTS_DIR

const home = os.homedir()
const configBase =
  process.platform === 'win32' ? process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
  : process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
// Running from source keeps its own settings, so `npm run dev` never switches to the app's folder (or back).
const file = path.join(configBase, packaged ? 'IMadeThisForYou' : 'IMadeThisForYou (dev)', 'settings.json')

type Settings = { projectsDir?: string }
const read = (): Settings => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } }

const defaultDir = () => (packaged ? path.join(home, 'Documents', 'IMadeThisForYou') : path.join(import.meta.dirname, '..', 'projects'))
export const projectsDir = () => path.resolve(process.env.PROJECTS_DIR ?? read().projectsDir ?? defaultDir())

// Checks the folder is usable (creating it if needed) before saving it. Throws a message for the user.
export async function setProjectsDir(dir: string) {
  if (!path.isAbsolute(dir)) throw new Error('Give the full path of a folder, e.g. ' + path.join(home, 'Documents', 'Novels'))
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (!fs.statSync(dir).isDirectory()) throw new Error()
    fs.accessSync(dir, fs.constants.W_OK)
  } catch {
    throw new Error(`Can't use ${dir}: not a folder this app can write to`)
  }
  await atomicWrite(file, JSON.stringify({ ...read(), projectsDir: path.resolve(dir) }, null, 2))
}
