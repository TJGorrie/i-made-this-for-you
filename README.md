# Writing Tool

A local app for writing novels: manuscript, wiki, timeline, review comments. Your work is plain Markdown files in a folder you choose.

## Running it (no install needed)

Download the file for your computer from the latest release, then:

- **Windows:** run `Writing-Tool-windows-x64.exe`. If Windows says "Windows protected your PC", click **More info → Run anyway** (the app isn't code-signed). Keep the black window open while you write; closing it stops the app.
- **Mac:** unzip, move **Writing Tool.app** to Applications and open it. The first time, macOS blocks it because it isn't from an identified developer: open **System Settings → Privacy & Security** and click **Open Anyway**. It runs in the background (no Dock icon); stop it with **Quit Writing Tool** on the projects page.
- **Linux:** `tar -xzf Writing-Tool-linux-x64.tar.gz && ./writing-tool`

The app opens in your browser at <http://127.0.0.1:5170>. Opening it again while it runs just brings the page back.

Projects are stored in `Documents/Writing Tool` unless you pick another folder under **Settings** on the projects page. A synced folder (Dropbox, OneDrive, iCloud Drive) works for backups. Switching folders doesn't move existing projects: copy their folders across yourself.

## Developing

`npm install`, then `npm run dev`. Checks: `npm run check`, `npm run typecheck`, `npm run test:ui`.
`npm run build:app` builds the standalone app for the current OS into `release/`; the GitHub workflow builds all of them when you push a `v*` tag.
