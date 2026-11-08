# Notes for Claude

- Owner: Kelly. She works on Windows and plays the game through GitHub Pages. Do not use em dashes in user-facing text or docs.
- Stack: Vite + TypeScript, plain Canvas 2D (no game framework). Keep `src/game.ts` free of DOM code so `npm run sim` keeps working.
- Balance lives in `src/data.ts` (`BALANCE` and the content tables). After balance changes, run `npm run sim -- 6` and check pacing.
- New save fields must get defaults in `newState()` and survive `migrate()` so existing players never lose progress.
- Original content only: no MapleStory/Nexon names, sprites, maps or music. Mechanics may be similar.
- Before pushing: `npm run build` must pass (it runs `tsc`).
- Pushing to `main` deploys automatically.
