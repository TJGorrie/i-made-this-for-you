# IMadeThisForYou

[![Downloads](https://img.shields.io/github/downloads/TJGorrie/i-made-this-for-you/total?label=downloads)](https://github.com/TJGorrie/i-made-this-for-you/releases)

**A home for your novel and the world it lives in.** Write your book, keep track of every character and place, see when things happened, and work through your edits, all in one window.

It's free, it runs on your own computer, and your writing is saved as plain text files in a folder you choose. No account, no subscription, no cloud. If you ever stop using the app, your book is still right there.

![Writing a scene: linked characters and places, review comments beside the text, word counts in the sidebar](docs/img/editor.png)

## Write without losing your place

Your book is laid out in the sidebar as books, chapters and scenes. Drag them to reorder. Give a chapter or the whole book a word target and watch the bar fill up.

Type **@** to link a character or place right in the text. It finds them by any name they go by: `@grey` finds Captain Rook, whom everyone calls the Grey Captain. Hover over a link to see who that is without leaving the page.

![Typing a sentence, linking "the Grey Captain" with @grey, then hovering it to see Captain Rook's details](docs/img/writing.gif)

Need your notes while you write? Shift-click anything to open it beside your scene.

![A scene and a character open side by side](docs/img/split.png)

Mark each scene as an idea, draft, revised or done, and see it at a glance in the sidebar.

## Plan on a corkboard

The Corkboard shows your scenes as index cards, one column per chapter. Write a one-line synopsis on each card and drag cards to reorder them. Give scenes plot threads (`heist, romance`) and pick one to see where it runs through the book, or pick a status or point-of-view character.

![The corkboard, picking out the "marsh" thread and then the "tithe" thread](docs/img/corkboard.gif)

## Keep your world straight

Every character, place, faction and item gets its own entry, with a portrait, the details you care about, and who they're connected to. Each entry also lists every scene it appears in, automatically.

![Mara Vell's entry: portrait, aliases, role, relationships](docs/img/character.png)

Put your events on a timeline, in your world's own calendar. Filter it by a character, a place or a tag, and see just that thread in order.

![The timeline in the story's own calendar, filtered by tag](docs/img/timeline.gif)

Give a scene a date and it shows up on the timeline too. Tag an event `death` or `birth`, and the timeline warns you if a character turns up in a scene after they died, or before they were born.

Relationships draw themselves into a map. Filter to parents and siblings and you have a family tree.

![The Vell family tree](docs/img/family-tree.png)

Upload a map of your world and pin your places on it.

![A map of the Salt Coast with pinned locations](docs/img/map.png)

## Edit like an editor

Select any passage and a small menu pops up: **Comment**, **Describe** or **Speaker**.

**Comment** puts a note beside the text. Every comment is a to-do item you can tick off. Turn on Review mode to read through without changing anything by accident.

![Selecting a passage, adding a comment that appears beside it, then ticking it off](docs/img/comments.gif)

**Describe** files a detail away while you write. Select "in a grey coat", pick Captain Rook and the property `appearance`, and it's listed on his entry, linked back to the passage, so editing the scene keeps it current. No more hunting back through chapters for what colour someone's eyes were.

![Describing Captain Rook's appearance with "in a grey coat", then clicking it in his entry to jump back to the scene](docs/img/describe.gif)

The Review page gathers every open comment and note in the book, in reading order, so nothing slips through. Click one to jump straight to that passage.

![Ticking off a note on the Review page, then clicking a comment to jump to it in the scene](docs/img/review.gif)

## Hear every voice

Select a line of dialogue and choose **Speaker** to tag who says it. Each character's entry then lists everything they say, scene by scene, so you can read a voice straight through and rework it.

![Tagging "We don't have it." as Mara's line, then opening Mara's entry to read all her lines](docs/img/speaker.gif)

Prose stats shows how much each character speaks, and the words, phrases and -ly adverbs you lean on most. Click one to find every place you used it.

![Prose stats: dialogue by speaker and most used words; clicking a word searches the book for it](docs/img/prose.gif)

Keep your own list of words to check ("nodded", "a beat") under Prose stats. Then use **Highlight** above any scene to mark those words as you write, or to show the dialogue you haven't tagged yet.

![Switching Highlight to "words to check", then to "untagged dialogue", then off](docs/img/highlight.gif)

## Focus when you need to

Focus mode hides everything but the words.

![Focus mode: just the scene](docs/img/focus.png)

And a dark mode for late nights.

![The editor in dark mode](docs/img/editor-dark.png)

On a phone or tablet, the sidebar folds away into a menu. Press **?** to see every keyboard shortcut.

## Never lose a word

The app saves as you type and keeps earlier versions of everything. Open History to read an old version, see what changed since, and bring it back. Deleted something? It's waiting in Deleted items.

![Version history, showing an earlier draft of a scene](docs/img/history.png)

Search finds anything in your book or your notes as you type.

![Searching for "marsh road"](docs/img/search.png)

## Build the habit

Set a daily word goal and keep a streak going. The writing log shows how every day went.

![Three weeks of daily word counts against a 500-word goal](docs/img/writing-log.png)

Start a sprint to write against the clock. The writing log keeps every sprint and your words per hour.

## Bring it in, send it out

Already have a draft? Import a Word, Markdown or text file and it becomes a book: headings become chapters and `* * *` splits the scenes.

When it's time to send it out, export the whole book to Word, EPUB for e-readers, Markdown, or a page you can print or save as PDF. Comments and notes are left out. Submitting to agents? **Word (submission format)** gives you a double-spaced manuscript with a title page, word count and a running header. For beta readers, **Web page for beta readers** makes a single file with a contents list that opens in any browser.

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

## Support

This software is free, and if you paid for it you've been scammed. If you'd like to support me, please [buy me a coffee](https://ko-fi.com/tgorrie)!

## License

IMadeThisForYou is free to use, for anything, including writing books you sell. You can share it with anyone, as long as you pass it on unchanged and don't charge for it. Changing the app, or sharing changed versions, needs permission from the author. The full terms are in [LICENSE](LICENSE).

© 2026 TJGorrie. The app includes open-source software by others, credited in THIRD-PARTY-NOTICES.txt, which comes with every download. You can also open it from the projects page.

## Working on the code

Run `npm install` and then `npm run dev`.

To check your changes, run `npm run check`, `npm run typecheck` and `npm run test:ui`.

`npm run build:app` builds the app for whichever system you're on and puts it in `release/`. To build for Windows, Mac and Linux at once, push a tag starting with `v` (for example `v0.2.0`). GitHub Actions will build all of them and attach them to a release.

`npm run screenshots` rebuilds the pictures and animations in this README from a demo novel, *The Salt Road*.
