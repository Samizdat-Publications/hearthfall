# Deploy (BACKLOG 17)

Hearthfall's production build is a plain static site (`apps/game/dist`, relative `base: "./"`), so it can be hosted anywhere that serves files. The prepared target is Cloudflare Workers static assets, configured in `wrangler.jsonc` at the project root (worker name `hearthfall`, no server code).

Live: https://hearthfall.stewartgregerson.workers.dev (first deploy 2026-10-15, build 2026-10-15 d408bd3, Stewart ran it). Nothing deploys automatically: Stewart runs the deploy command himself, because Claude Code's auto mode blocks production deploys.

## Play locally (no deploy)

```powershell
cd "C:\Users\stewa\Documents\Claude\Hearthfall"; npm run build; npm run serve
```

Then open http://127.0.0.1:5182/ in a browser. `npm run serve -- --lan` also runs the LAN relay for Play together.

## Deploy to Cloudflare

First time only, sign in to Cloudflare (opens a browser):

```powershell
cd "C:\Users\stewa\Documents\Claude\Hearthfall"; npx wrangler login
```

Every deploy (the build step ships whatever is in the working folder, so commit or set aside unfinished work first; if a fresh build is already in apps/game/dist, `npx wrangler deploy` alone is enough):

```powershell
cd "C:\Users\stewa\Documents\Claude\Hearthfall"; npm run build; npx wrangler deploy
```

`npx` downloads wrangler on first use; it is not a project dependency. The command prints the public URL (`https://hearthfall.<account>.workers.dev`).

## Version banner

The main menu shows `Build <date> <commit>` (from `buildTag()` in `apps/game/vite.config.ts`), so a player can tell which build they are on. Test builds leave it blank.

## What works on the static site

- Campaign, skirmish against the AI, the map editor, replays, saves and settings.
- Saves, settings and records live in the browser's storage for that site, so progress on http://127.0.0.1:5182/ does not carry over to the deployed URL.
- Play together needs the relay from `npm run serve -- --lan` on the home network. Internet play needs a public relay (BACKLOG 15) and is not part of this deploy.
