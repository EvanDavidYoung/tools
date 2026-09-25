# tools

Small self-contained browser tools, served at `tools.evanyoung.dev/<tool>/`.

The list of them lives in one place: [evanyoung.dev/tools](https://evanyoung.dev/tools),
generated from `src/data/tools.ts` in the portfolio repo. The root of
tools.evanyoung.dev redirects there (`_redirects`), so there's no second index to
drift out of sync.

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
- **Hand the hard input to an AI.** When a tool needs structured input that's a pain
  to type — a room's dimensions, a schema, a dataset — ship a prompt file next to it.
  The user pastes that prompt into whatever chat window they already have open, feeds it
  photos or notes, and pastes the JSON back. The tool still makes no network calls, and
  the parser assumes the answer will be wrapped in code fences and half-right.
- **Bring your own key.** If a tool ever needs a third-party API, prompt for the
  user's own key and persist it in `localStorage` under a namespaced key
  (`toolname_api_key`). Never commit a key, and never proxy through a server —
  that turns someone else's usage into my bill.

## Adding a tool

1. Add `<tool>/index.html` here and push to `main`.
2. Add an entry to `src/data/tools.ts` in the portfolio repo and push that to `main`.

## Local development

```
npx serve .
```

Then open `localhost:3000/<tool>/` — the root has no index. Opening a tool over
`file://` mostly works, but `climb-viewer`'s sample loader uses `fetch()`, which
needs a real origin.

## Deploying

Push to `main`. The site is a Cloudflare Worker (named `tools`) serving this
directory as static assets — not a Pages project — and Workers Builds runs
`npx wrangler deploy` on every push to `main`. What's live is what's on `main`.

`wrangler.jsonc` holds the config and `.assetsignore` decides what stays off the
web. Avoid `wrangler deploy` by hand: it ships your working tree, which the next
push to `main` overwrites.
