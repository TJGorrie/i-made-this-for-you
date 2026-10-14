// Run: npm run check. Kills a process mid-save over and over and checks the file is never left half-written.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readEntity, writeEntity } from './store.ts'

const ROUNDS = 25

if (process.argv[2] === 'child') {
  // Save forever. Each version's body begins and ends with its own number, so a torn file is detectable.
  const [dir, rel] = process.argv.slice(3)
  const filler = 'lorem ipsum '.repeat(50_000) // ~600KB, so writes take long enough to be interrupted
  for (let n = 1; ; n++) await writeEntity(dir, rel, { id: 'x', type: 'scene', title: 'T', n, body: `start ${n}\n${filler}\nend ${n}` })
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writing-tool-crash-'))
const rel = 'manuscript/scene.md'
await writeEntity(dir, rel, { id: 'x', type: 'scene', title: 'T', n: 0, body: 'start 0\nend 0' })
try {
  let versions = 0
  for (let round = 0; round < ROUNDS; round++) {
    const child = spawn(process.execPath, [import.meta.filename, 'child', dir, rel], { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 250))
    child.kill('SIGKILL') // no chance to finish or clean up
    await new Promise((r) => child.once('exit', r))
    const e = readEntity(path.join(dir, rel))
    assert.ok(e.body.startsWith(`start ${e.n}\n`) && e.body.endsWith(`\nend ${e.n}`), `round ${round}: torn file (n=${e.n})`)
    versions += Number(e.n) > 0 ? 1 : 0
  }
  assert.ok(versions > 0, 'child never completed a save; the test proved nothing')
  console.log(`crashcheck ok (${ROUNDS} kills mid-save, file always complete)`)
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}
