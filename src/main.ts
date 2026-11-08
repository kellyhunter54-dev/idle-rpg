import { SKILLS } from './data';
import { Game } from './game';
import { setupInput } from './input';
import { Renderer } from './render';
import { importSave, loadGame, saveGame } from './save';
import { newState } from './state';
import { UI } from './ui';

const state = loadGame();
const awaySeconds = (Date.now() - state.lastSaved) / 1000;

const game = new Game(state);

// Skill buttons (built before input setup so they get listeners)
document.getElementById('skillbar')!.innerHTML = SKILLS.map(
  (sk, i) => `<button class="skillbtn" data-skill="${i}" title="${sk.name} (${i + 1})">
    ${sk.icon}<div class="cd"></div><span class="key">${i + 1}</span><div class="lock hidden">Lv${sk.unlock}</div>
  </button>`,
).join('');

const renderer = new Renderer(document.getElementById('canvas') as HTMLCanvasElement);
const ui = new UI(game);
const toggleAuto = () => {
  game.setAuto(!game.auto);
  ui.toast(game.auto ? 'AUTO on: your hero plays itself.' : 'AUTO off: full manual control.', '#3a86ff');
};
document.getElementById('autobtn')!.addEventListener('click', toggleAuto);
const pollInput = setupInput(game.input, toggleAuto);

ui.onReplaceState = (code) => {
  const next = code ? importSave(code) : newState();
  next.lastSaved = Date.now();
  saveGame(next);
  location.reload();
};

// Offline rewards on startup
const offline = game.applyOffline(awaySeconds);
if (offline) ui.showOffline(offline);

// Main loop
let last = performance.now();
let hiddenAt = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pollInput();
  game.update(dt);
  ui.update(dt);
  renderer.draw(game, now / 1000);
  requestAnimationFrame(frame);
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
