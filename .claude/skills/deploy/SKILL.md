---
name: deploy
description: Deploy tools.evanyoung.dev. Use when asked to deploy, ship, publish, or push this site live, or to check what is currently live. This repo is a Cloudflare Worker serving static assets — NOT a Pages project, so the generic deploy-pages skill does not apply.
---

# Deploying tools.evanyoung.dev

`tools.evanyoung.dev` is a **Worker named `tools`** that serves this repo's root
directory as static assets. There is no build step and no Pages project. `wrangler
pages deploy` is wrong here and will create a second, unrelated project.

Config lives in `wrangler.jsonc` at the repo root: `assets.directory` is `"."`, and
the custom domain is claimed by the `routes` entry. `.assetsignore` lists what must
not be served (git internals, agent scratch dirs, the wrangler config itself).

## Deploy

From the repo root — a git worktree is fine, wrangler only cares about the directory:

```bash
npx --yes wrangler deploy
```

Auth is already set up: an OAuth token for evan.david.young@gmail.com, stored at
`~/Library/Preferences/.wrangler/config/default.toml` (the macOS path — *not*
`~/.config/.wrangler`, which is where you'd look on Linux and find nothing). If a
command reports being logged out, the refresh token has expired and only the user can
fix it, interactively: `npx wrangler login`.

Wrangler isn't installed in this repo and shouldn't be — the site has no
`package.json` and no `node_modules`, which is the point. `npx` pulls it from the npm
cache.

## Check what's live before you deploy

The deploy ships **the working tree**, not a commit — uncommitted edits and untracked
files go live, and anything missing locally disappears from the site. There is more
than one checkout of this repo on this machine (`~/Desktop/projects/tools`,
`~/Desktop/projects/tools-v1`, plus Conductor worktrees), and they drift. Before
deploying, confirm the directory you're in is the one you mean to publish:

```bash
git status --short && git log --oneline -1
```

To see whether what's live matches a given commit, compare a file that changed:

```bash
curl -s https://tools.evanyoung.dev/shadowing/ | shasum | cut -c1-12
git show <rev>:shadowing/index.html | shasum | cut -c1-12
```

## Verify after deploying

Check a file the deploy was supposed to add, not just the homepage — a stale asset
list will still serve `/` happily:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tools.evanyoung.dev/
curl -s -o /dev/null -w "%{http_code}\n" https://tools.evanyoung.dev/room-planner/import-prompt.md
```

Cloudflare caches aggressively; `cf-cache-status: HIT` on a stale response means
retry with a cache-buster (`?v=$(date +%s)`) before concluding the deploy failed.

## Account facts

- Account: `Evan.david.young@gmail.com's Account` — `478f3cf7dffa3b0210f5af54c95ed5f7`
- Worker name: `tools`. Other Pages projects on this account (`crop`, `zhuyin-game`,
  `dashboard-demo`, `ugrip`) are unrelated; don't deploy this repo into one.
