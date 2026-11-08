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

## Level power

Level is the main source of power (`LEVEL_POWER` in `src/data.ts`): base ATK and HP grow about as fast as monsters do (25% / 22% per level). Growth upgrades are +3% ATK / HP multipliers on top, and gear multiplies again.

## Talents

Each job has one tree (`TALENT_TREES` in `src/data.ts`): Warrior **Blademaster** (attack speed, off-hand strikes, bleeds, armor shred, Blade Dance keystone), Archer **Marksman** (core: Focus meter and Deadeye empowered arrows; talents: Barbed, Split Shot, Seeking, Prolonged Focus, Concussive stagger, Second Nature, Trueshot keystone), Mage **Arcane** (mana, Arcane Charges, cooldown reduction, Frost Ward, Mana Shield keystone).

- 1 point per level from Lv 2; unspent points are derived from level (`talentsAvailable`), so changing level never breaks them.
- Rows unlock every 5 points spent in the tree; the keystone needs 25.
- Passive numbers are summed in `talentStats` (stats.ts); procs live in `Game.damage`, `Game.playerAttacks`, `Game.tickDots`, `Game.startSkill` and `Game.hurtPlayer`.
- Respec is free for now; Auto-assign spends points top to bottom.

### Spec cores

Each spec has its own core mechanic that its talents build on:
- **Marksman:** arrows build Focus (`FOCUS` in data.ts). At full Focus, Deadeye (F, AUTO fires it instantly) empowers basic arrows for 6s: they pierce and deal +40%.
- **Arcane:** mana and Arcane Charges.
- **Blademaster:** bleeds and off-hand strikes (core mechanic still to come).

## Echoing Hollow (manual-only cave)

A cave mouth in Sprout Meadow leads to a separate cave map (`generateCave`). AUTO is forced off inside. Monsters match your level (up to +2 deeper in) and give 2.5x EXP and 1.5x gold (`caveExpMult`, `caveGoldMult`, `caveLevelBonus` in `BALANCE`).

## Bosses (hard by design)

- Boss attacks take a share of your **max HP** (`BOSS_MOVE_PCT`), so HP stacking can't trivialize them; only out-levelling the boss shrinks it (`bossPctScale`).
- Each boss has its own moveset per phase (`ZONES[z].bossKit`): slam, chase, cone, charge, nova, rain, cross, adds. Phases at 60% and 25% HP by default (`ZONES[z].phaseAt` overrides; King Jelly splits at 80% and 50%); enrage after 3 minutes.
- Healing flasks (R): 3 charges, refilled when entering a lair and slowly in the world.
- AUTO dodges like a distracted average player (`aiReaction`, `aiJitter`, `aiMiss`). It needs to out-level a boss by about 8-9 levels to win. The final zone boss can't be out-levelled that far, so it needs a real player.
- `npx tsx tools/bosstrial.ts <job> [zone]` levels a character and fights every boss (or just one zone's boss) at several levels with AUTO and a skilled profile, printing win rates.

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
