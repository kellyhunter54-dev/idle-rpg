# Idle RPG

An old-school isometric action RPG with idle progression: your hero fights on its own (AUTO), and you can take over any time. Long-term goal: a low-grind MMO.

The original side-scroller version is kept on the `side-scroller` branch and served at `/side/`.

**Play:** https://kellyhunter54-dev.github.io/idle-rpg/ (side-scroller: https://kellyhunter54-dev.github.io/idle-rpg/side/)

## Run locally (Windows, Mac or Linux)

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev      # opens a local dev server with hot reload
npm run build    # production build into dist/
npm run sim      # headless balance simulation (default 3 hours of play)
npm run sim -- 8 archer # simulate 8 hours as an archer (warrior | archer | mage); the sim also travels and fights bosses
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
| `src/map.ts` | The connected world (3 zones, barrier gates, boss altars), collision, A* pathfinding. |
| `src/game.ts` | Game logic: movement, mob AI, AUTO pilot (pathing + dodging), action combat, boss telegraphs, summoning, enhancing, offline rewards. No browser code, so it can be simulated. |
| `src/input.ts` | Keyboard and touch controls. |
| `src/charselect.ts` | Character select screen: 3 slots, create (name + job), play, reset to Lv 1, delete. |
| `src/render.ts` | Isometric canvas renderer (placeholder shapes; replace when real art arrives). |
| `src/ui.ts` | Tabs, panels, modals, toasts. |
| `src/main.ts` | Wires everything together, game loop, autosave. |
| `tools/sim.ts` | Balance simulator. |

## World and progression

One connected world split into zones (`ZONES` in `src/data.ts`): Sprout Meadow (Lv 1-10), Whisper Woods (Lv 10-20), Ember Canyon (Lv 20-30). Purple barrier gates between zones stop monsters but not the hero. Monster level rises from a zone's entrance to its far end.

- Monsters above your level deal more damage and take less; monsters far below give almost no EXP (`expLevelMult`, `dealtLevelMult`, `takenLevelMult`).
- Each zone's boss sleeps in a **lair**: an archway near the far east end of the zone leads into a separate chamber. Summon the boss at the circle (E or the Summon button), leave by the Exit portal. Bosses must be beaten in order and can be re-summoned after a short rest.
- Summoning offerings: `ZONES[z].offering` lists the items needed to summon each boss. They are empty for now; the check (`Game.summonCheck`) and the item bag (`state.items`) are already wired up.
- AUTO farms the zone you are in, preferring monsters near your level. The World tab can send AUTO to another zone or to a boss.

## Characters and jobs

Three character slots, each with its own save. Jobs: **Warrior** (melee, tanky, takes 35% less damage), **Archer** (ranged arrows, keeps its distance on AUTO), **Mage** (exploding spells, fragile). Job stats and skills live in `JOBS` in `src/data.ts`.

## Controls

The hero plays itself while AUTO is on. Any input takes over, and AUTO resumes 2 seconds after you stop.

- WASD or arrows: move
- Mouse: aim
- Left click (hold), Space or J: attack
- 1, 2, 3: job skills, aimed at the mouse
- Q: toggle AUTO

Phones: drag on the battlefield for a joystick, buttons for attack and skills.

Bosses mark the ground in red before attacks (slam, breath cone, charge, nova). Step out to avoid them.

## Desktop client later

The game uses relative paths and keeps saving behind one interface, so it can be wrapped with [Tauri](https://tauri.app) without code changes. Only `src/save.ts` needs a file-based storage implementation.

## Art

All graphics are placeholder shapes and emoji. No assets from any existing game are used.
