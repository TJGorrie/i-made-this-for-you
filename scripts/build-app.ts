// Run: npm run build:app. Builds the standalone app for the OS it runs on (CI runs it on each), into release/:
//   Windows: IMadeThisForYou-windows-x64.exe   macOS: IMadeThisForYou-macos-<arch>.zip (IMadeThisForYou.app)   Linux: IMadeThisForYou-linux-<arch>.tar.gz
// It's a Node single executable (nodejs.org/api/single-executable-applications.html): this Node binary with the
// bundled server and the built UI embedded, so people need nothing installed.
// It also writes THIRD-PARTY-NOTICES.txt: the license of Node.js and of every package that ends up in the app.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { build, type Plugin } from 'vite'
// @ts-expect-error postject ships no types
import { inject } from 'postject'

const root = path.join(import.meta.dirname, '..')
const out = path.join(root, 'build')
const release = path.join(root, 'release')
const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root })
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(release, { recursive: true })

// Which packages the bundles actually contain (not everything in node_modules), for the notices.
const used = new Set<string>()
const collect: Plugin = {
  name: 'collect-licenses',
  generateBundle(_, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk') continue
      for (const id of chunk.moduleIds) {
        // "\0" prefixes Vite's virtual modules; the last node_modules/<name> (or @scope/name) is the package.
        const pkg = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id.replace(/^\0/, ''))?.[1]
        if (pkg) used.add(pkg)
      }
    }
  },
}

// 1. The UI → dist/, and the server → one CommonJS file (single executables can't load ES modules or node_modules).
await build({ root, logLevel: 'warn', plugins: [collect] })
await build({
  root, configFile: false, logLevel: 'warn', plugins: [collect],
  ssr: { noExternal: true },
  build: { ssr: 'server/main.ts', outDir: out, target: 'node24', rolldownOptions: { output: { format: 'cjs', entryFileNames: 'server.cjs' } } },
})

// 2. Licenses: ours, and the third-party ones. The official Node.js downloads (used in CI) carry Node's LICENSE next to
//    the binary; an installed Node may not, so then it's fetched for this exact version.
const read = (f: string) => fs.readFileSync(f, 'utf8').trim()
const nodeLicense = [path.dirname(process.execPath), path.dirname(path.dirname(process.execPath))]
  .map((d) => path.join(d, 'LICENSE')).find((f) => fs.existsSync(f))
const nodeText = nodeLicense ? read(nodeLicense)
  : (await (await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`)).text()).trim()
const packages = new Map<string, string>() // "name version" → its license text
for (const dir of used) {
  const pkg = JSON.parse(read(path.join(dir, 'package.json')))
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
  if (!file) console.warn(`No license file in ${pkg.name}; listing its license field (${pkg.license}) only`)
  packages.set(`${pkg.name} ${pkg.version}`,
    file ? read(path.join(dir, file)) : `License: ${pkg.license ?? 'unknown'}${author ? `, by ${author}` : ''}`)
}
const rule = '\n\n' + '-'.repeat(78) + '\n\n'
fs.writeFileSync(path.join(out, 'LICENSE.txt'), read(path.join(root, 'LICENSE')) + '\n')
fs.writeFileSync(path.join(out, 'THIRD-PARTY-NOTICES.txt'), [
  'IMadeThisForYou includes the third-party software below, each used under its own license, reproduced here.',
  `Node.js ${process.version}\n\n${nodeText}`,
  ...[...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => `${name}\n\n${text}`),
].join(rule) + '\n')
console.log(`Notices: Node.js and ${packages.size} packages`)

// 3. The blob: server code plus every file of the UI as an asset (served by server/main.ts), and the licenses,
//    so even the bare Windows .exe carries them (linked from the projects page).
const dist = path.join(root, 'dist')
const assets = Object.fromEntries((fs.readdirSync(dist, { recursive: true }) as string[])
  .filter((f) => fs.statSync(path.join(dist, f)).isFile())
  .map((f) => [f.split(path.sep).join('/'), path.join(dist, f)]))
for (const f of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']) assets[f] = path.join(out, f)
const config = path.join(out, 'sea-config.json')
fs.writeFileSync(config, JSON.stringify({
  main: path.join(out, 'server.cjs'), output: path.join(out, 'app.blob'), disableExperimentalSEAWarning: true, assets,
}))
run(process.execPath, '--experimental-sea-config', config)

// 4. A copy of this Node with the blob injected. macOS: the copy's signature is removed first and redone after
//    (ad-hoc; Apple Silicon won't run unsigned code).
const mac = process.platform === 'darwin'
const bin = path.join(out, process.platform === 'win32' ? 'imadethisforyou.exe' : 'imadethisforyou')
fs.copyFileSync(process.execPath, bin)
fs.chmodSync(bin, 0o755)
if (mac) run('codesign', '--remove-signature', bin)
await inject(bin, 'NODE_SEA_BLOB', fs.readFileSync(path.join(out, 'app.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(mac ? { machoSegmentName: 'NODE_SEA' } : {}),
})

// 5. Package it, with the licenses next to the app in the Mac and Linux downloads.
const arch = process.arch
if (process.platform === 'win32') {
  fs.copyFileSync(bin, path.join(release, `IMadeThisForYou-windows-${arch}.exe`))
} else if (mac) {
  // A background app (LSUIElement): no Dock icon or window of its own; the UI is the browser tab, Quit is on the projects page.
  const app = path.join(out, 'IMadeThisForYou.app')
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true })
  for (const f of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']) fs.copyFileSync(path.join(out, f), path.join(app, 'Contents', 'Resources', f))
  fs.renameSync(bin, path.join(app, 'Contents', 'MacOS', 'imadethisforyou'))
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>imadethisforyou</string>
  <key>CFBundleIdentifier</key><string>app.imadethisforyou</string>
  <key>CFBundleName</key><string>IMadeThisForYou</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? '0.0.0'}</string>
  <key>NSHumanReadableCopyright</key><string>© TJGorrie</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`)
  run('codesign', '--sign', '-', '--force', '--deep', app)
  run('ditto', '-c', '-k', '--keepParent', app, path.join(release, `IMadeThisForYou-macos-${arch}.zip`))
} else {
  run('tar', '-czf', path.join(release, `IMadeThisForYou-linux-${arch}.tar.gz`), '-C', out, 'imadethisforyou', 'LICENSE.txt', 'THIRD-PARTY-NOTICES.txt')
}
console.log('Built:', fs.readdirSync(release).join(', '))
