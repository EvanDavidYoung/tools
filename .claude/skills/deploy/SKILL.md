---
name: deploy
description: Deploy tools.evanyoung.dev. Use when asked to deploy, ship, publish, or push this site live, or to check what is currently live. This repo is a Cloudflare Worker serving static assets — NOT a Pages project, so the generic deploy-pages skill does not apply.
---

# Deploying tools.evanyoung.dev

`tools.evanyoung.dev` is a **Worker named `tools`** that serves this repo's root
directory as static assets. There is no build step and no Pages project. `wrangler
pages deploy` is wrong here and will create a second, unrelated project.

## Deploy = push to main

The Worker is connected to `EvanDavidYoung/tools` through **Cloudflare Workers
Builds**. Every push to `main` runs `npx wrangler deploy` in Cloudflare's build
environment. Other branches don't deploy. So:

```bash
git push origin HEAD:main   # or merge a PR into main
```

What's live is what's on `main`. Don't run `wrangler deploy` from a local checkout:
it ships your working tree (uncommitted and untracked files included), and the next
push to `main` silently overwrites it. There are several checkouts of this repo on
this machine (`~/Desktop/projects/tools`, `~/Desktop/projects/tools-v1`, Conductor
worktrees) and they drift — that's exactly what this setup exists to prevent.

Config lives in `wrangler.jsonc`: `assets.directory` is `"."`, and the custom domain
is claimed by the `routes` entry. `.assetsignore` lists what must not be served.
`_redirects` sends `/` to evanyoung.dev/tools.

## The index lives in the portfolio repo

There is no index page here. The catalogue is evanyoung.dev/tools, built from
`src/data/tools.ts` in `EvanDavidYoung/portfolio` (also a Worker, `portfolio`, also
deployed by Workers Builds on push to `main`). **Adding or renaming a tool means
editing that file too**, or the tool exists but nothing links to it.

## Check a build

Build status and logs: Cloudflare dashboard → Workers → `tools` → Deployments, or via
the API: `GET /accounts/{account_id}/builds/workers/f2afdf4529a04dac97ccb7a3e6091da8/builds`.

## Verify after deploying

Check a file the deploy was supposed to add, not just the root — which is a redirect:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://tools.evanyoung.dev/
curl -s -o /dev/null -w "%{http_code}\n" https://tools.evanyoung.dev/room-planner/import-prompt.md
```

To see whether what's live matches a commit, compare a file that changed:

```bash
curl -s https://tools.evanyoung.dev/shadowing/ | shasum | cut -c1-12
git show <rev>:shadowing/index.html | shasum | cut -c1-12
```

Cloudflare caches aggressively; `cf-cache-status: HIT` on a stale response means
retry with a cache-buster (`?v=$(date +%s)`) before concluding the deploy failed.

## Account facts

- Account: `Evan.david.young@gmail.com's Account` — `478f3cf7dffa3b0210f5af54c95ed5f7`
- Worker name: `tools` (script tag `f2afdf4529a04dac97ccb7a3e6091da8`). Other Pages
  projects on this account (`crop`, `zhuyin-game`, `dashboard-demo`, `ugrip`) are
  unrelated; don't deploy this repo into one.
- Local wrangler auth, if you ever need it for inspection: OAuth token at
  `~/Library/Preferences/.wrangler/config/default.toml` (macOS path). If logged out,
  only the user can fix it: `npx wrangler login`.
