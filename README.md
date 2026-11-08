# Idle RPG

A browser idle RPG (auto-battle, growth upgrades, gear and companion summons, bosses, offline progress) built to later ship as a desktop client.

**Play:** https://kellyhunter54-dev.github.io/idle-rpg/

## Run locally (Windows, Mac or Linux)

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev      # opens a local dev server with hot reload
npm run build    # production build into dist/
npm run sim      # headless balance simulation (default 3 hours of play)
npm run sim -- 8 # simulate 8 hours
```

## Deploying

Every push to `main` builds and deploys to GitHub Pages through `.github/workflows/deploy.yml`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

## Project layout

| File | What it does |
| --- | --- |
| `src/data.ts` | All content and balance numbers (stages, mobs, gear, companions, skills, costs). Tweak the game here. |
| `src/state.ts` | Save data shape, new game defaults, migration for old saves. |
| `src/save.ts` | Saving/loading. Swap the storage implementation here for the desktop build. |
| `src/stats.ts` | Turns save data into combat stats (ATK, HP, crit). |
| `src/game.ts` | Game logic: combat loop, bosses, summoning, enhancing, offline rewards. No browser code, so it can be simulated. |
| `src/render.ts` | Canvas battle scene (placeholder shapes; replace when real art arrives). |
| `src/ui.ts` | Tabs, panels, modals, toasts. |
| `src/main.ts` | Wires everything together, game loop, autosave. |
| `tools/sim.ts` | Balance simulator. |

## Desktop client later

The game uses relative paths and keeps saving behind one interface, so it can be wrapped with [Tauri](https://tauri.app) without code changes. Only `src/save.ts` needs a file-based storage implementation.

## Art

All graphics are placeholder shapes and emoji. No assets from any existing game are used.
