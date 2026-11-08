# Notes for Claude

- Owner: Kelly. She works on Windows and plays the game through GitHub Pages. Do not use em dashes in user-facing text or docs.
- Stack: Vite + TypeScript, plain Canvas 2D (no game framework). Isometric view, action combat (WASD + mouse aim), AUTO pilot with manual override.
- Characters: 3 save slots (`idle-rpg-char-0..2` in localStorage), jobs Warrior/Archer/Mage defined in `JOBS` (data.ts). Skills are data-driven by `SkillType`; implement new types in `Game.castSkills`. Sim per job: `npm run sim -- 4 archer`.
- World: one connected map (`generateWorld` in map.ts), zones in `ZONES` (data.ts), mobs are tagged with a zone and can't cross Gate tiles (pass `mob = true` to map collision/path helpers). Bosses live in lairs (`generateLair`, separate map; `Game.enterLair/exitLair` swap the map and keep world mobs) and are summoned at the lair's circle in order (`bossesCleared`). Summon offerings: `ZONES[z].offering` + `state.items` (empty for now, future item system). The old stage/kills fields in state are unused leftovers.
- Boss difficulty is intentional (Souls-like): %max-HP boss hits, phases, enrage, flasks, imperfect AUTO dodging. Validate changes with `npx tsx tools/bosstrial.ts <job>` (AUTO should lose at equal level; skilled should usually win) and `npm run sim -- 30 warrior` (AUTO-only journey: boss 1 ~5h, boss 2 ~11h, boss 3 needs a human).
- Monsters come from fixed spawn camps per zone (even level spread). AUTO avoids monsters 4+ levels above you and roams to level-appropriate camps.
- `main` is the isometric game. The old side-scroller lives on the `side-scroller` branch and deploys to /side/; leave it alone unless asked.
- Planned: replace gacha with an ironman-style gear system (work for everything; drops are the only RNG). Long-term goal is a low-grind MMO. Keep `src/game.ts` free of DOM code so `npm run sim` keeps working.
- Balance lives in `src/data.ts` (`BALANCE` and the content tables). After balance changes, run `npm run sim -- 6` and check pacing.
- New save fields must get defaults in `newState()` and survive `migrate()` so existing players never lose progress.
- Original content only: no MapleStory/Nexon names, sprites, maps or music. Mechanics may be similar.
- Before pushing: `npm run build` must pass (it runs `tsc`).
- Pushing to `main` deploys automatically.
