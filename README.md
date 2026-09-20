# tools

Small self-contained browser tools, served at
[tools.evanyoung.dev](https://tools.evanyoung.dev).

Catalogued alongside the rest of my tools at
[evanyoung.dev/tools](https://evanyoung.dev/tools).

## The format

Every tool here is a **single HTML file** with inline CSS and JS. No build step,
no bundler, no framework, no server. Deploying is copying files.

This is deliberate. A tool that needs `npm install` to run is a tool that stops
working in a year. These keep working.

## Conventions

- **One directory per tool**, containing `index.html`. Assets sit next to it.
- **No network calls.** These read files the user picks via `<input type="file">`
  and never upload anything. If a tool needs a video or dataset to be useful,
  bundle a small sample and add a "Load sample" button.
- **Bring your own key.** If a tool ever needs a third-party API, prompt for the
  user's own key and persist it in `localStorage` under a namespaced key
  (`toolname_api_key`). Never commit a key, and never proxy through a server —
  that turns someone else's usage into my bill.

## Tools

| Tool | What it does |
|---|---|
| [`transcript-player/`](transcript-player/) | Plays local audio in sync with a transcript JSON, word by word |
| [`climb-viewer/`](climb-viewer/) | Reviews pose-detection output against a climbing video on a scrubable timeline |
| [`room-planner/`](room-planner/) | Drag-and-drop 2D furniture layout for a room, with collision and clearance checks |
| [`shadowing/`](shadowing/) | Reads Mandarin articles aloud with word-level highlighting and an auto-pause drill for shadowing |

## Local development

```
npx serve .
```

Opening `index.html` over `file://` mostly works, but `climb-viewer`'s sample
loader uses `fetch()`, which needs a real origin.

## Deploying

```
wrangler pages deploy .
```
