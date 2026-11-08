import { JOBS, JOB_LIST, JobId, ZONES, jobOf } from './data';
import { TILE, ZONE_TILES } from './map';
import { drawHeroPortrait } from './render';
import { SLOT_COUNT, createCharacter, deleteSlot, readSlot, resetCharacter, writeSlot } from './save';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** Shows the character select screen. Calls onPlay(slot) when a character is chosen. */
export function showCharacterSelect(onPlay: (slot: number) => void) {
  const root = document.getElementById('charselect')!;
  root.classList.remove('hidden');
  let creating: number | null = null;
  let pickJob: JobId = 'warrior';
  let raf = 0;

  const render = () => {
    if (creating !== null) {
      root.innerHTML = `
        <div class="cs-wrap">
          <h1 class="cs-title">Create your hero</h1>
          <input id="cs-name" class="cs-input" maxlength="14" placeholder="Name" value="" autocomplete="off" />
          <div class="cs-jobs">
            ${JOB_LIST.map((j) => `
              <div class="cs-job ${j.id === pickJob ? 'picked' : ''}" data-act="pick" data-arg="${j.id}" style="--job:${j.color}">
                <canvas class="portrait" data-job="${j.id}" width="120" height="120"></canvas>
                <div class="cs-jobname">${j.icon} ${j.name}</div>
                <div class="cs-desc">${j.desc}</div>
                <div class="cs-skills">${j.skills.map((s) => `<span title="Unlocks at Lv ${s.unlock}">${s.icon} ${s.name}</span>`).join('')}</div>
              </div>`).join('')}
          </div>
          <div class="cs-actions">
            <button class="btn alt" data-act="cancel">Back</button>
            <button class="btn" data-act="confirm">Create ${JOBS[pickJob].name}</button>
          </div>
        </div>`;
      const input = document.getElementById('cs-name') as HTMLInputElement;
      input.value = (root.dataset.name ?? '');
      input.focus();
      input.addEventListener('input', () => (root.dataset.name = input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') act('confirm', '');
      });
    } else {
      const cards: string[] = [];
      for (let i = 0; i < SLOT_COUNT; i++) {
        const s = readSlot(i);
        if (!s) {
          cards.push(`<div class="cs-card empty" data-act="create" data-arg="${i}">
            <div class="cs-plus">+</div><div>Create character</div></div>`);
          continue;
        }
        const j = jobOf(s);
        cards.push(`<div class="cs-card" style="--job:${j.color}">
          <canvas class="portrait" data-job="${j.id}" width="140" height="140"></canvas>
          <div class="cs-name">${esc(s.name)}</div>
          <div class="cs-sub">Lv. ${s.level} ${j.name}</div>
          <div class="cs-sub muted">${ZONES[Math.min(ZONES.length - 1, Math.floor((s.pos?.x ?? 0) / TILE / ZONE_TILES))].name} · ${s.bossesCleared}/${ZONES.length} bosses</div>
          <div class="cs-sub muted small">Played ${ago(s.lastSaved)}</div>
          <button class="btn wide" data-act="play" data-arg="${i}">Play</button>
          <div class="cs-row">
            <button class="btn alt" data-act="reset" data-arg="${i}" title="Testing: wipe this character back to level 1">Reset to Lv 1</button>
            <button class="btn alt" data-act="setlvl" data-arg="${i}" title="Testing: set this character's level">Set level</button>
            <button class="btn alt" data-act="delete" data-arg="${i}">Delete</button>
          </div>
        </div>`);
      }
      root.innerHTML = `
        <div class="cs-wrap">
          <h1 class="cs-title">Choose your hero</h1>
          <div class="cs-grid">${cards.join('')}</div>
          <p class="muted small" style="text-align:center">Each character keeps its own level, gear and progress.
          <a href="./side/">Classic side-scroller</a></p>
        </div>`;
    }
  };

  const act = (a: string, arg: string) => {
    const i = Number(arg);
    switch (a) {
      case 'create':
        creating = i;
        pickJob = 'warrior';
        root.dataset.name = '';
        break;
      case 'pick':
        pickJob = arg as JobId;
        break;
      case 'cancel':
        creating = null;
        break;
      case 'confirm': {
        if (creating === null) return;
        const name = (root.dataset.name ?? '').trim() || JOBS[pickJob].name;
        createCharacter(creating, name, pickJob);
        creating = null;
        break;
      }
      case 'play':
        close();
        onPlay(i);
        return;
      case 'reset': {
        const s = readSlot(i);
        if (s && confirm(`Reset ${s.name} back to level 1? All progress for this character is wiped.`)) resetCharacter(i);
        break;
      }
      case 'setlvl': {
        const s = readSlot(i);
        if (!s) break;
        const v = Number(prompt(`Set ${s.name}'s level to:`, String(s.level)));
        if (v >= 1) {
          s.level = Math.min(200, Math.round(v));
          s.exp = 0;
          writeSlot(i, s);
        }
        break;
      }
      case 'delete': {
        const s = readSlot(i);
        if (s && confirm(`Delete ${s.name} permanently?`)) deleteSlot(i);
        break;
      }
    }
    render();
  };

  root.onclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (el) act(el.dataset.act!, el.dataset.arg ?? '');
  };

  // Animate the hero portraits
  const tick = (t: number) => {
    root.querySelectorAll<HTMLCanvasElement>('canvas.portrait').forEach((c) => drawHeroPortrait(c, c.dataset.job as JobId, t / 1000));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const close = () => {
    cancelAnimationFrame(raf);
    root.classList.add('hidden');
    root.innerHTML = '';
  };

  render();
}
