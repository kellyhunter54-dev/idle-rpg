import { showCharacterSelect } from './charselect';
import { BALANCE } from './data';
import { Game } from './game';
import { setupInput } from './input';
import { Renderer } from './render';
import { importSave, migrateLegacySave, readSlot, resetCharacter, saveGame, setActiveSlot, writeSlot } from './save';
import { UI } from './ui';

migrateLegacySave();

// After a reset/import from inside the game, jump straight back into that character.
const autoplay = sessionStorage.getItem('idle-rpg-autoplay');
sessionStorage.removeItem('idle-rpg-autoplay');
if (autoplay !== null && readSlot(Number(autoplay))) startGame(Number(autoplay));
else showCharacterSelect(startGame);

/** Starts playing the character in `slot`. Runs once per page load; switching reloads the page. */
function startGame(slot: number) {
  const state = readSlot(slot);
  if (!state) return;
  setActiveSlot(slot);
  document.getElementById('app')!.classList.remove('hidden');
  const awaySeconds = (Date.now() - state.lastSaved) / 1000;

  const game = new Game(state);

  // Skill buttons for this job (built before input setup so they get listeners)
  document.getElementById('skillbar')!.innerHTML =
    `<button class="skillbtn flask" id="flaskbtn" title="Healing flask (R): heals ${Math.round(BALANCE.flaskHeal * 100)}%">🧪<span class="key">R</span><div class="count" id="flaskcount"></div></button>` +
    game.job.skills
    .map(
      (sk, i) => `<button class="skillbtn" data-skill="${i}" title="${sk.name} (${i + 1}), unlocks at Lv ${sk.unlock}">
    ${sk.icon}<div class="cd"></div><span class="key">${i + 1}</span><div class="lock hidden">Lv${sk.unlock}</div>
  </button>`,
    )
    .join('');

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const ui = new UI(game);
  const toggleAuto = () => {
    game.setAuto(!game.auto);
    ui.toast(game.auto ? 'AUTO on: your hero plays itself.' : 'AUTO off: full manual control.', '#c9a227');
  };
  document.getElementById('autobtn')!.addEventListener('click', toggleAuto);
  document.getElementById('flaskbtn')!.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    game.drinkFlask();
  });
  const pollInput = setupInput(game.input, canvas, (x, y) => renderer.screenToWorld(x, y), toggleAuto);

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
    if (e.code === 'KeyE' && !e.repeat && game.inLair >= 0) ui.trySummon();
    if (e.code === 'KeyR' && !e.repeat) game.drinkFlask();
  });

  const switchCharacter = () => {
    saveGame(game.state);
    location.reload();
  };
  document.getElementById('switchbtn')!.addEventListener('click', switchCharacter);
  ui.onSwitchCharacter = switchCharacter;

  ui.onReplaceState = (code) => {
    if (code) {
      const next = importSave(code);
      next.lastSaved = Date.now();
      writeSlot(slot, next);
    } else {
      resetCharacter(slot);
    }
    sessionStorage.setItem('idle-rpg-autoplay', String(slot));
    location.reload();
  };

  // Offline rewards
  const offline = game.applyOffline(awaySeconds);
  if (offline) ui.showOffline(offline);

  // Main loop
  let last = performance.now();
  let hiddenAt = 0;
  let errors = 0;
  function frame(now: number) {
    requestAnimationFrame(frame); // schedule first so one bad frame can never freeze the game
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      pollInput();
      game.update(dt);
      ui.update(dt);
      renderer.draw(game, now / 1000);
    } catch (e) {
      if (errors++ < 5) console.error(e);
    }
  }
  requestAnimationFrame(frame);

  // Autosave
  setInterval(() => saveGame(game.state), 10_000);
  window.addEventListener('beforeunload', () => saveGame(game.state));

  // Browsers pause the game in background tabs, so treat long absences as offline time.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      saveGame(game.state);
    } else if (hiddenAt) {
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      last = performance.now();
      const r = game.applyOffline(away);
      if (r) ui.showOffline(r);
    }
  });

  // Handy for debugging in the browser console: __game.state, __game.challengeBoss(), ...
  (window as unknown as { __game: Game }).__game = game;
}
