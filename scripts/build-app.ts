// Run: npm run build:app. Builds the standalone app for the OS it runs on (CI runs it on each), into release/:
//   Windows: IMadeThisForYou-windows-x64.exe   macOS: IMadeThisForYou-macos-<arch>.zip (IMadeThisForYou.app)   Linux: IMadeThisForYou-linux-<arch>.tar.gz
// It's a Node single executable (nodejs.org/api/single-executable-applications.html): this Node binary with the
// bundled server and the built UI embedded, so people need nothing installed.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { build } from 'vite'
// @ts-expect-error postject ships no types
import { inject } from 'postject'

const root = path.join(import.meta.dirname, '..')
const out = path.join(root, 'build')
const release = path.join(root, 'release')
const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root })
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(release, { recursive: true })

// 1. The UI → dist/, and the server → one CommonJS file (single executables can't load ES modules or node_modules).
await build({ root, logLevel: 'warn' })
await build({
  root, configFile: false, logLevel: 'warn',
  ssr: { noExternal: true },
  build: { ssr: 'server/main.ts', outDir: out, target: 'node24', rolldownOptions: { output: { format: 'cjs', entryFileNames: 'server.cjs' } } },
})

// 2. The blob: server code plus every file of the UI as an asset (served by server/main.ts).
const dist = path.join(root, 'dist')
const assets = Object.fromEntries((fs.readdirSync(dist, { recursive: true }) as string[])
  .filter((f) => fs.statSync(path.join(dist, f)).isFile())
  .map((f) => [f.split(path.sep).join('/'), path.join(dist, f)]))
const config = path.join(out, 'sea-config.json')
fs.writeFileSync(config, JSON.stringify({
  main: path.join(out, 'server.cjs'), output: path.join(out, 'app.blob'), disableExperimentalSEAWarning: true, assets,
}))
run(process.execPath, '--experimental-sea-config', config)

// 3. A copy of this Node with the blob injected. macOS: the copy's signature is removed first and redone after
//    (ad-hoc; Apple Silicon won't run unsigned code).
const mac = process.platform === 'darwin'
const bin = path.join(out, process.platform === 'win32' ? 'imadethisforyou.exe' : 'imadethisforyou')
fs.copyFileSync(process.execPath, bin)
fs.chmodSync(bin, 0o755)
if (mac) run('codesign', '--remove-signature', bin)
await inject(bin, 'NODE_SEA_BLOB', fs.readFileSync(path.join(out, 'app.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(mac ? { machoSegmentName: 'NODE_SEA' } : {}),
})

// 4. Package it.
const arch = process.arch
if (process.platform === 'win32') {
  fs.copyFileSync(bin, path.join(release, `IMadeThisForYou-windows-${arch}.exe`))
} else if (mac) {
  // A background app (LSUIElement): no Dock icon or window of its own; the UI is the browser tab, Quit is on the projects page.
  const app = path.join(out, 'IMadeThisForYou.app')
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
  fs.renameSync(bin, path.join(app, 'Contents', 'MacOS', 'imadethisforyou'))
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>imadethisforyou</string>
  <key>CFBundleIdentifier</key><string>app.imadethisforyou</string>
  <key>CFBundleName</key><string>IMadeThisForYou</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? '0.0.0'}</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`)
  run('codesign', '--sign', '-', '--force', '--deep', app)
  run('ditto', '-c', '-k', '--keepParent', app, path.join(release, `IMadeThisForYou-macos-${arch}.zip`))
} else {
  run('tar', '-czf', path.join(release, `IMadeThisForYou-linux-${arch}.tar.gz`), '-C', out, 'imadethisforyou')
}
console.log('Built:', fs.readdirSync(release).join(', '))
