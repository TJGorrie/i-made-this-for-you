# IMadeThisForYou

An app for writing novels. It keeps your manuscript, a wiki for characters and places, a timeline, and review comments in one place. Everything is saved as ordinary Markdown files in a folder on your computer, so your writing never depends on the app.

## Running it

You don't need to install anything. Download the file for your computer from the latest release.

### Windows

Run `IMadeThisForYou-windows-x64.exe`. The app isn't code-signed, so Windows may say "Windows protected your PC". Click More info, then Run anyway.

A black console window opens alongside the app. Leave it open while you write. Closing it stops the app.

### Mac

Unzip the download, move IMadeThisForYou.app to your Applications folder, and open it.

The first time, macOS will block it because it isn't from an identified developer. Go to System Settings, open Privacy & Security, and click Open Anyway.

The app runs in the background and has no Dock icon. To stop it, click Quit IMadeThisForYou on the projects page.

### Linux

```
tar -xzf IMadeThisForYou-linux-x64.tar.gz
./imadethisforyou
```

## Using it

The app opens in your web browser at http://127.0.0.1:5170. If you open it again while it's already running, it just brings the page back up.

Your projects go in `Documents/IMadeThisForYou`. To use a different folder, change it under Settings on the projects page. A synced folder such as Dropbox, OneDrive or iCloud Drive is a good way to keep a backup.

Changing the folder doesn't move the projects you already have. Copy their folders into the new one yourself.

## Working on the code

Run `npm install` and then `npm run dev`.

To check your changes, run `npm run check`, `npm run typecheck` and `npm run test:ui`.

`npm run build:app` builds the app for whichever system you're on and puts it in `release/`. To build for Windows, Mac and Linux at once, push a tag starting with `v` (for example `v0.2.0`). GitHub Actions will build all of them and attach them to a release.
