import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import { JobId } from '../data';
import * as PX from '../pixel';
import { ABILITY_LEVELS, ADVANCE_LEVELS, CLASS_CORE, CORE_MAX, BRANCHES, HEROES, ITEM, PASSIVE, PASSIVES, RUN, RUN_RARITIES, WEAPON } from './data';
import { setupRunInput } from './input';
import { JELLY } from './jelly';
import { RunRenderer } from './render';
import { Run } from './run';

const $ = (id: string) => document.getElementById(id)!;
const BEST_KEY = 'gloomtide-best';

interface Best {
  time: number;
  win: boolean;
  level: number;
  kills: number;
}
function loadBest(): Partial<Record<JobId, Best>> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveBest(job: JobId, b: Best) {
  const all = loadBest();
  const old = all[job];
  const better = !old || (b.win && !old.win) || (b.win === old.win && (b.win ? b.time < old.time : b.time > old.time));
  if (better) all[job] = b;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked */
  }
  return better;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Draws a pixel hero sprite, scaled up, into a small canvas. */
function portrait(c: HTMLCanvasElement, job: JobId) {
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, c.width, c.height);
  const img = PX.hero(job, false, 0);
  const s = Math.floor(Math.min(c.width / img.width, c.height / img.height));
  x.drawImage(img, (c.width - img.width * s) / 2, c.height - img.height * s, img.width * s, img.height * s);
}

// ---------------------------------------------------------------- title screen
function showTitle() {
  $('title').classList.remove('hidden');
  $('app').classList.add('hidden');
  const best = loadBest();
  const box = $('heroes');
  box.innerHTML = '';
  (['warrior', 'archer', 'mage'] as JobId[]).forEach((job) => {
    const h = HEROES[job];
    const b = best[job];
    const abil = [h.basic, ...h.abilities]
      .map((id, i) => `<span class="hc-ab${i ? '' : ' start'}" title="${WEAPON[id].name}: ${i ? `unlocks at Lv ${ABILITY_LEVELS[i - 1]}. ` : 'auto attack. '}${WEAPON[id].desc}">${WEAPON[id].icon}${i ? `<b>${ABILITY_LEVELS[i - 1]}</b>` : ''}</span>`)
      .join('');
    const card = document.createElement('button');
    card.className = 'hero-card';
    card.innerHTML = `
      <canvas width="64" height="72"></canvas>
      <div class="hc-name">${h.name}</div>
      <div class="hc-line">Auto attack: ${WEAPON[h.basic].name}</div>
      <div class="hc-abs">${abil}</div>
      <div class="hc-pass">${h.passive}</div>
      <div class="hc-core" style="color:${CLASS_CORE[job].color}">${CLASS_CORE[job].icon} ${CLASS_CORE[job].resource} → ${CLASS_CORE[job].name} (F)</div>
      <div class="hc-more">${PASSIVES[job].length} class passives</div>
      <div class="hc-branch">Lv ${ADVANCE_LEVELS[0]}: ${BRANCHES[job].map((br) => `<span style="color:${br.color}">${br.icon} ${br.name}</span>`).join(' or ')}</div>
      <div class="hc-best">${b ? (b.win ? `Won in ${fmtTime(b.time)}` : `Best: ${fmtTime(b.time)}, Lv ${b.level}`) : 'No runs yet'}</div>`;
    portrait(card.querySelector('canvas')!, job);
    card.addEventListener('click', () => startRun(job));
    box.appendChild(card);
  });
}

// ---------------------------------------------------------------- the run
let run: Run | null = null;
let paused = false;
let renderer: RunRenderer | null = null;
let poll: ((skip: boolean) => void) | null = null;
let lastChoices: unknown = null;
let endShown = false;
const cache = new Map<string, string>();
const setText = (id: string, v: string) => {
  if (cache.get(id) === v) return;
  cache.set(id, v);
  $(id).textContent = v;
};
const setHtml = (id: string, v: string) => {
  if (cache.get('h' + id) === v) return;
  cache.set('h' + id, v);
  $(id).innerHTML = v;
};
const setWidth = (id: string, p: number) => {
  const v = `${Math.round(Math.max(0, Math.min(1, p)) * 1000) / 10}%`;
  if (cache.get('w' + id) === v) return;
  cache.set('w' + id, v);
  $(id).style.width = v;
};

function startRun(job: JobId) {
  $('title').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('end').classList.add('hidden');
  $('pause').classList.add('hidden');
  run = new Run(job);
  (window as unknown as { __run: Run }).__run = run;
  paused = false;
  endShown = false;
  lastChoices = null;
  cache.clear();
  $('notices').innerHTML = '';
  portrait($('rportrait') as HTMLCanvasElement, job);
  if (!renderer) renderer = new RunRenderer($('canvas') as HTMLCanvasElement);
  if (!poll)
    poll = setupRunInput(run.input, $('battle'), {
      onPause: () => togglePause(),
      onCard: (i) => run?.choices && pickCard(i),
      onReroll: () => run?.reroll(),
      onCore: () => run?.activateCore(),
      onAuto: () => {
        if (!run) return;
        run.auto = !run.auto;
        $('autotag').classList.toggle('hidden', !run.auto);
      },
    });
  $('autotag').classList.add('hidden');
  run.autoCore = localStorage.getItem('gloomtide-autocore') === '1';
  ($('autocore') as HTMLInputElement).checked = run.autoCore;
}

function togglePause() {
  if (!run || run.ended) return;
  if (run.choices) return;
  paused = !paused;
  $('pause').classList.toggle('hidden', !paused);
  if (paused) $('pausestats').innerHTML = statsTable(run);
}

function pickCard(i: number) {
  if (!run) return;
  run.pick(i);
}

function statsTable(r: Run): string {
  const s = r.stats;
  const rows: [string, string][] = [
    ['Max HP', String(Math.round(s.maxHp))],
    ['Damage', `+${Math.round(s.dmg * 100)}%`],
    ['Attack speed', `+${Math.round(s.cd * 100)}%`],
    ['Move speed', `+${Math.round(s.speed * 100)}%`],
    ['Size', `+${Math.round(s.area * 100)}%`],
    ['Crit', `${Math.round(s.crit * 100)}%`],
    ['Damage taken', `-${Math.round(s.armor * 100)}%`],
    ['Luck', String(Math.round(s.luck))],
    ['EXP gain', `+${Math.round(s.xp * 100)}%`],
  ];
  return `<div class="stat-grid">${rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')}</div>`;
}

function renderCards(r: Run) {
  const box = $('cards');
  box.innerHTML = '';
  setText('choicetitle', r.choiceTitle);
  r.choices!.forEach((c, i) => {
    const el = document.createElement('button');
    el.className = `card r-${c.rarity.id}${c.kind === 'advance' || c.kind === 'talent' ? ' adv' : ''}`;
    el.style.setProperty('--rc', c.rarity.color);
    const tag = c.kind === 'talent' ? 'PICK ONE' : c.kind === 'advance' ? c.rarity.name.toUpperCase() : c.kind === 'newWeapon' ? 'NEW ABILITY' : c.kind === 'newPassive' ? 'NEW PASSIVE' : c.kind === 'passive' ? `Lv ${c.level} / ${PASSIVE[c.id].max}` : c.level ? `Lv ${c.level}` : c.kind === 'boon' ? 'BOON' : '';
    el.innerHTML = `
      <div class="card-top"><span class="card-rar">${c.kind === 'advance' ? '' : c.rarity.name}</span><span class="card-tag">${tag}</span></div>
      <div class="card-icon">${c.icon}</div>
      <div class="card-name">${c.name}</div>
      <div class="card-lines">${c.lines.map((l) => `<div>${l}</div>`).join('')}</div>
      <div class="card-key">${i + 1}</div>`;
    el.addEventListener('click', () => pickCard(i));
    box.appendChild(el);
  });
  const reroll = $('rerollbtn') as HTMLButtonElement;
  reroll.textContent = `Reroll (${r.rerolls})`;
  reroll.disabled = r.rerolls <= 0 || r.choiceTitle !== 'Level up!';
  reroll.classList.toggle('hidden', r.choiceTitle !== 'Level up!' && r.choiceTitle !== 'Shrine boon');
  $('skipbtn').classList.toggle('hidden', r.choiceTitle !== 'Level up!');
}

function slotHtml(icon: string, level: number | string, title: string, color = '') {
  return `<div class="rslot" title="${title}"${color ? ` style="--rc:${color}"` : ''}><span>${icon}</span><b>${level}</b></div>`;
}

function updateHud(r: Run) {
  const s = r.stats;
  setText('rlvl', `Lv ${r.level} ${r.title}`);
  const next = r.branch ? ADVANCE_LEVELS[r.tier] : ADVANCE_LEVELS[0];
  // class resource + ultimate
  const c = r.core;
  const rf = $('resfill');
  if (rf.style.background !== c.color) rf.style.background = c.color;
  if (r.coreActive) {
    const ts = c.id === 'deadeye' && r.sp('trueshot') > 0;
    setWidth('resfill', ts ? r.coreMeter / CORE_MAX : r.coreLeft / (c.dur + r.sp('coreDur')));
    setText('restext', ts ? `${c.name.toUpperCase()} ${Math.ceil(r.coreMeter)}` : `${c.name.toUpperCase()} ${r.coreLeft.toFixed(1)}s`);
  } else {
    setWidth('resfill', r.coreMeter / CORE_MAX);
    setText('restext', `${c.resource} ${Math.floor(r.coreMeter)} / ${CORE_MAX}`);
  }
  setText('coreicon', c.icon);
  setText('corename', r.coreReady ? `${c.name}!` : r.coreActive ? `${r.coreLeft.toFixed(1)}s` : `${Math.floor(r.coreMeter)}%`);
  const cb = $('corebtn');
  cb.classList.toggle('ready', r.coreReady);
  cb.classList.toggle('active', r.coreActive);
  if (cb.dataset.c !== c.color) {
    cb.dataset.c = c.color;
    cb.style.setProperty('--cc', c.color);
    cb.title = `${c.name} (F): ${c.desc} Builds ${c.resource}.`;
  }
  $('rres').classList.toggle('full', r.coreReady);
  setText('advnext', next && r.level < next ? `Job advancement at Lv ${next}` : '');
  setText('rgold', String(Math.floor(r.gold)));
  setText('rkills', String(r.kills));
  setWidth('rhpfill', r.hp / s.maxHp);
  setText('rhptext', `${Math.ceil(r.hp)} / ${Math.round(s.maxHp)}`);
  $('rhud').classList.toggle('low', r.hp < s.maxHp * 0.3);
  setWidth('xpfill', r.xp / r.xpNeed);
  setText('xptext', `Lv ${r.level}`);
  if (r.runT < RUN.length) {
    setText('timer', fmtTime(r.timeLeft));
    setText('clocksub', r.inLair ? 'paused in the lair' : r.lairCleared ? 'until the tide' : 'King Jelly\'s lair is open');
  } else {
    setText('timer', r.boss ? 'TIDE' : `+${fmtTime(r.overtime)}`);
    setText('clocksub', 'beat the Gloom Tide');
  }
  $('clock').classList.toggle('hidden', r.inLair);
  $('clock').classList.toggle('danger', !r.inLair && (r.runT >= RUN.length || r.timeLeft < 30));
  // auto attack + the 4 abilities (locked ones dimmed with their unlock level)
  const ws = [0, 1, 2, 3, 4].map((k) => {
    const w = r.weapons[k];
    if (w) return slotHtml(w.def.icon, w.level, `${k ? '' : 'Auto attack. '}${w.def.name}: ${w.def.desc}`, k ? '' : '#c9a227');
    const d = WEAPON[r.hero.abilities[k - 1]];
    return `<div class="rslot locked" title="${d.name}: unlocks at Lv ${ABILITY_LEVELS[k - 1]}"><span>${d.icon}</span><b>${ABILITY_LEVELS[k - 1]}</b></div>`;
  });
  setHtml('wslots', ws.join(''));
  const ts = r.passives.map((p) => {
    const d = PASSIVE[p.id];
    return d.desc ? slotHtml(d.icon, '★', `Talent. ${d.name}: ${d.desc}`, '#b388ff') : slotHtml(d.icon, p.level, `${d.name}: ${r.passiveTotal(p)}`);
  });
  setHtml('tslots', ts.join(''));
  // items: grouped with counts
  const counts = new Map<string, number>();
  for (const it of r.items) counts.set(it.id, (counts.get(it.id) ?? 0) + 1);
  setHtml(
    'itemrow',
    [...counts].map(([id, n]) => {
      const it = ITEM[id];
      const rc = RUN_RARITIES.find((x) => x.id === it.rarity)!.color;
      return slotHtml(it.icon, n > 1 ? `x${n}` : '', `${it.name}: ${it.desc}`, rc);
    }).join(''),
  );
  // boss bar
  const b = r.boss;
  $('bossbar').classList.toggle('hidden', !b || b.dead);
  if (b && !b.dead) {
    // bleed on the boss (any of King Jelly's slimes)
    const bl = r.inLair && r.jelly ? Math.max(0, ...r.jelly.slimes.filter((x) => !x.dead && x.bleedUntil > r.t).map((x) => x.bleedStacks)) : b.bleedUntil > r.t ? b.bleedStacks : 0;
    setText('bossname', bl > 0 ? `${b.name}  🩸x${bl}` : b.name);
    setWidth('bossfill', b.hp / b.maxHp);
  }
  // interact hint
  let hint = '';
  const near = r.chests.find((c) => !c.opened && !c.free && Math.hypot(c.x - r.x, c.y - r.y) < 70);
  if (near) hint = r.gold >= r.chestCost ? `E: open chest (${r.chestCost} gold)` : `Chest: needs ${r.chestCost} gold`;
  const sh = r.shrines.find((x) => !x.used && x.charge > 0);
  if (!hint && sh) hint = 'Stay in the shrine...';
  if (!hint && !r.inLair && !r.lairCleared && Math.hypot(r.lairDoor.x - r.x, r.lairDoor.y - r.y) < 90) hint = "E: enter King Jelly's lair (the run clock pauses inside)";
  if (!hint && r.inLair && r.jelly?.done) hint = Math.hypot(r.jelly.exit.x - r.x, r.jelly.exit.y - r.y) < 90 ? 'E: leave the lair' : 'Grab the chests, then walk to the golden portal';
  // Slimed stacks under the boss bar
  const sl = r.inLair && r.jelly && !r.jelly.done ? r.jelly.slimed : -1;
  $('slimed').classList.toggle('hidden', sl < 0);
  if (sl >= 0) setText('slimed', `Slimed ${sl} / ${JELLY.lethal}`);
  $('restartbtn').classList.toggle('hidden', !r.inLair);
  $('hint').classList.toggle('hidden', !hint);
  if (hint) setText('hint', hint);
  // notices
  while (r.notices.length) {
    const n = r.notices.shift()!;
    const el = document.createElement('div');
    el.className = 'notice';
    el.style.color = n.color;
    el.textContent = `${n.icon ?? ''} ${n.text}`;
    const box = $('notices');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild!.remove();
    setTimeout(() => el.classList.add('fade'), 2400);
    setTimeout(() => el.remove(), 3000);
  }
  // cards
  if (r.choices !== lastChoices) {
    lastChoices = r.choices;
    $('choice').classList.toggle('hidden', !r.choices);
    if (r.choices) renderCards(r);
  }
  if (r.ended && !endShown) {
    endShown = true;
    showEnd(r);
  }
}

function showEnd(r: Run) {
  const win = r.ended === 'win';
  const record = saveBest(r.job, { time: r.t, win, level: r.level, kills: r.kills });
  setText('endtitle', win ? 'The tide breaks!' : 'Swept away');
  const all = [...r.weapons, ...r.retired.filter((w) => w.total > 0)];
  const tot = all.reduce((a, w) => a + w.total, 0) + r.bleedTotal || 1;
  const rows = all
    .sort((a, b) => b.total - a.total)
    .map((w) => `<div class="dmg-row"><span>${w.def.icon} ${w.def.name} <i>Lv ${w.level}</i></span><div class="dmg-bar"><div style="width:${(w.total / tot) * 100}%"></div></div><b>${fmtBig(w.total)}</b></div>`)
    .join('') +
    (r.bleedTotal > 0 ? `<div class="dmg-row"><span>🩸 Bleed</span><div class="dmg-bar"><div style="width:${(r.bleedTotal / tot) * 100}%"></div></div><b>${fmtBig(r.bleedTotal)}</b></div>` : '');
  $('endstats').innerHTML = `
    <div class="end-sum">
      <div><b>${fmtTime(r.t)}</b><span>time</span></div>
      <div><b>${r.level}</b><span>level</span></div>
      <div><b>${r.kills}</b><span>kills</span></div>
      <div><b>${r.items.length}</b><span>items</span></div>
    </div>
    ${record ? '<div class="end-record">New best for this hero!</div>' : ''}
    <div class="dmg-list">${rows}</div>`;
  $('end').classList.remove('hidden');
}

function fmtBig(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

$('restartbtn').addEventListener('click', () => {
  if (!run) return;
  run.restartLair();
  togglePause();
});
$('corebtn').addEventListener('click', () => run?.activateCore());
$('autocore').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  localStorage.setItem('gloomtide-autocore', on ? '1' : '0');
  if (run) run.autoCore = on;
});
$('rerollbtn').addEventListener('click', () => run?.reroll());
$('skipbtn').addEventListener('click', () => run?.skip());
$('pausebtn').addEventListener('click', () => togglePause());
$('resumebtn').addEventListener('click', () => togglePause());
$('quitbtn').addEventListener('click', () => {
  if (!run) return;
  paused = false;
  $('pause').classList.add('hidden');
  run.ended = 'dead';
});
$('againbtn').addEventListener('click', () => run && startRun(run.job));
$('menubtn').addEventListener('click', () => showTitle());

// main loop
let last = performance.now();
const perf = { game: 0, draw: 0 };
(window as unknown as { __perf: typeof perf }).__perf = perf;
let errors = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!run) return;
  try {
    const t0 = performance.now();
    poll?.(run.auto);
    if (!paused) run.update(dt);
    updateHud(run);
    const t1 = performance.now();
    renderer!.draw(run, now / 1000);
    const t2 = performance.now();
    perf.game += (t1 - t0 - perf.game) * 0.05;
    perf.draw += (t2 - t1 - perf.draw) * 0.05;
  } catch (e) {
    if (errors++ < 5) console.error(e);
  }
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && run && !run.ended && !run.choices && !paused) togglePause();
});

showTitle();
