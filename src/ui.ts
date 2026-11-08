import {
  BALANCE, COMPANION, COMPANIONS, GROWTH, GrowthKey, RARITIES, RARITY, SLOTS, SLOT_INFO, Slot,
  companionHitMult, companionOwnedAtk, enhanceCopies, expToNext, gearEffect, gearName, parseGear,
  TALENT_TREES, ZONES, CAVE, bossName, expLevelMult, mobForZone, rarityIndex,
} from './data';
import { fmt, fmtPct, fmtTime } from './format';
import { Game, OfflineRewards, SummonResult } from './game';
import { exportSave, importSave, saveGame } from './save';
import { talentBlocked, talentsAvailable, talentsSpent } from './stats';

type Tab = 'growth' | 'world' | 'talents' | 'gear' | 'companions' | 'summon' | 'info';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- per-frame HUD helpers: cache elements and only touch the DOM when a value changes ----
const elCache = new Map<string, HTMLElement>();
const el = (id: string): HTMLElement => {
  let e = elCache.get(id);
  if (!e || !e.isConnected) {
    e = document.getElementById(id) as HTMLElement;
    elCache.set(id, e);
  }
  return e;
};
const lastVal = new WeakMap<HTMLElement, Record<string, string>>();
const changed = (e: HTMLElement, key: string, v: string) => {
  let rec = lastVal.get(e);
  if (!rec) lastVal.set(e, (rec = {}));
  if (rec[key] === v) return false;
  rec[key] = v;
  return true;
};
const setText = (e: HTMLElement, v: string) => {
  if (changed(e, 'text', v)) e.textContent = v;
};
const setStyle = (e: HTMLElement, prop: 'width' | 'height' | 'background', v: string) => {
  if (changed(e, prop, v)) e.style[prop] = v;
};
let skillBtnList: HTMLElement[] = [];
const skillBtns = () => {
  if (!skillBtnList.length || !skillBtnList[0].isConnected) skillBtnList = [...document.querySelectorAll<HTMLElement>('.skillbtn[data-skill]')];
  return skillBtnList;
};
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class UI {
  tab: Tab = 'growth';
  /** Is a menu window open over the game? */
  open = false;
  private lastPanelHtml = '';
  private panelTimer = 0;
  private holdTimer: number | undefined;
  private holdInterval: number | undefined;
  /** Called when the character's save is replaced: an import code, or null to reset to level 1. */
  onReplaceState: (code: string | null) => void = () => {};
  /** Called to go back to the character select screen. */
  onSwitchCharacter: () => void = () => {};

  constructor(private game: Game) {
    game.onToast = (m, c) => this.toast(m, c);

    // Menu buttons open a window over the game; clicking the same one again closes it.
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        const tab = b.dataset.tab as Tab;
        if (this.open && this.tab === tab) this.closeWindow();
        else this.openWindow(tab);
      });
    });
    $('winclose').addEventListener('click', () => this.closeWindow());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (!$('modal').classList.contains('hidden')) this.closeModal();
      else if (this.open) this.closeWindow();
    });

    $('bossbtn').addEventListener('click', () => {
      const g = this.game;
      if (g.travelGoal) g.cancelTravel();
      else if (g.inLair >= 0) this.trySummon();
      else g.goToBoss(g.zone);
    });
    $('leavebtn').addEventListener('click', () => (this.game.inCave ? this.game.exitCave() : this.game.exitLair()));

    // Event delegation. pointerdown so panel re-renders never swallow a tap.
    const panel = $('panel');
    panel.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el || el.classList.contains('disabled')) return;
      e.preventDefault();
      const action = el.dataset.action!;
      const arg = el.dataset.arg ?? '';
      this.handle(action, arg);
      if (el.dataset.hold) {
        this.holdTimer = window.setTimeout(() => {
          this.holdInterval = window.setInterval(() => this.handle(action, arg), 70);
        }, 350);
      }
    });
    const stopHold = () => {
      clearTimeout(this.holdTimer);
      clearInterval(this.holdInterval);
    };
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);
    window.addEventListener('blur', stopHold);

    $('modal').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.id === 'modal' || t.dataset.close !== undefined) this.closeModal();
    });

    this.renderPanel(true);
  }

  /** Summon the boss in the current lair, showing why not if it can't. */
  trySummon() {
    const why = this.game.summonBoss();
    if (why) this.toast(why, '#ff8c3b');
  }

  private handle(action: string, arg: string) {
    const g = this.game;
    switch (action) {
      case 'growth':
        g.buyGrowth(arg as GrowthKey);
        break;
      case 'equip':
        g.equipGear(arg);
        break;
      case 'enhance':
        g.enhanceGear(arg);
        break;
      case 'equipBest':
        g.equipAllBest();
        this.toast('Equipped your best gear.');
        break;
      case 'enhanceAllGear': {
        const n = g.enhanceAllGear();
        this.toast(n ? `Enhanced gear ${n} times.` : 'Nothing to enhance yet.');
        break;
      }
      case 'party':
        g.toggleParty(arg);
        break;
      case 'autoParty':
        g.autoParty();
        this.toast('Party set to your strongest companions.');
        break;
      case 'enhanceComp':
        g.enhanceCompanion(arg);
        break;
      case 'enhanceAllComp': {
        const n = g.enhanceAllCompanions();
        this.toast(n ? `Enhanced companions ${n} times.` : 'Nothing to enhance yet.');
        break;
      }
      case 'summonGear':
      case 'summonComp': {
        const n = Number(arg);
        const res = action === 'summonGear' ? g.summonGear(n) : g.summonCompanions(n);
        if (!res) this.toast('Not enough gems.', '#ef4444');
        else this.showSummon(res, action === 'summonGear');
        break;
      }
      case 'export': {
        const ta = $<HTMLTextAreaElement>('savebox');
        ta.value = exportSave(g.state);
        ta.select();
        navigator.clipboard?.writeText(ta.value).then(() => this.toast('Save copied to clipboard.'), () => {});
        return;
      }
      case 'import': {
        const code = $<HTMLTextAreaElement>('savebox').value;
        try {
          importSave(code); // validate first
          this.onReplaceState(code);
        } catch {
          this.toast('That save code is not valid.', '#ef4444');
        }
        return;
      }
      case 'reset':
        if (window.confirm(`Reset ${g.state.name} back to level 1? This cannot be undone.`)) this.onReplaceState(null);
        return;
      case 'travel':
        g.travelToZone(Number(arg));
        this.toast(`Walking to ${ZONES[Number(arg)].name}...`, '#c9a227');
        break;
      case 'fightBoss':
        g.goToBoss(Number(arg));
        this.toast(`Heading to the ${ZONES[Number(arg)].name} altar...`, '#c9a227');
        break;
      case 'setLevel': {
        const v = Number(($<HTMLInputElement>('lvlinput')).value);
        if (!v || v < 1) {
          this.toast('Type a level first.', '#ef4444');
          return;
        }
        g.setLevel(v);
        this.toast(`${g.state.name} is now level ${g.state.level}.`, '#c9a227');
        this.renderPanel(true);
        return;
      }
      case 'addLevel':
        g.setLevel(g.state.level + Number(arg));
        this.toast(`${g.state.name} is now level ${g.state.level}.`, '#c9a227');
        this.renderPanel(true);
        return;
      case 'testMode':
        g.setTestMode(!g.state.settings.testMode);
        this.toast(g.state.settings.testMode ? 'Test mode ON: invincible, 10x damage.' : 'Test mode off.', '#c9a227');
        this.renderPanel(true);
        return;
      case 'goCave':
        g.goToCave();
        this.toast(`Walking to the ${CAVE.name}...`, '#c9a227');
        break;
      case 'talent': {
        const why = g.allocateTalent(arg);
        if (why) this.toast(why, '#ff8c3b');
        break;
      }
      case 'talentReset':
        if (window.confirm('Refund all talent points? (Free for now.)')) {
          g.resetTalents();
          this.toast('Talents reset.', '#c9a227');
        }
        break;
      case 'talentAuto': {
        const n = g.autoAssignTalents();
        this.toast(n ? `Spent ${n} talent point${n === 1 ? '' : 's'}.` : 'No points to spend.', '#c9a227');
        break;
      }
      case 'switch':
        this.onSwitchCharacter();
        return;
      case 'save':
        saveGame(g.state);
        this.toast('Game saved.');
        return;
    }
    g.dirty = true;
    this.renderPanel(true);
  }

  // ---------------- Per-frame updates ----------------
  update(dt: number) {
    const g = this.game;
    const s = g.state;
    setText(el('lvl'), `${s.name}  ·  Lv. ${s.level} ${g.job.name}`);
    setStyle(el('expfill'), 'width', `${Math.min(100, (s.exp / expToNext(s.level)) * 100)}%`);
    setText(el('gold'), fmt(s.gold));
    setText(el('gems'), fmt(s.gems));
    setText(el('power'), fmt(g.stats.power));
    const zd = ZONES[g.zone] ?? ZONES[0];
    const inLair = g.inLair >= 0;
    setText(el('stagename'), g.inCave
      ? `${CAVE.name}  ·  manual only  ·  ${BALANCE.caveExpMult}x EXP`
      : inLair
      ? `${bossName(g.inLair)}'s Lair  (boss Lv ${zd.bossLevel})`
      : `${zd.name}  (Lv ${zd.minLevel}-${zd.maxLevel})` + (g.travelGoal ? `  ·  walking to ${g.travelGoal.label}...` : ''));

    const kf = el('killfill');
    const kt = el('killtext');
    if (g.inBossFight) {
      setStyle(kf, 'width', '100%');
      setStyle(kf, 'background', '#a4161a');
      setText(kt, 'BOSS FIGHT');
    } else if (g.inCave) {
      const eph = g.expPerHour();
      setStyle(kf, 'width', '100%');
      setStyle(kf, 'background', '#4a2d73');
      setText(kt, eph > 0 ? `EXP/hr ${fmt(eph)} (${BALANCE.caveExpMult}x bonus)  ·  exit portal is at the west end` : 'Monsters match your level. Exit portal at the west end.');
    } else if (inLair) {
      const st = g.bossStatus(g.inLair);
      const offer = zd.offering.length ? zd.offering.map((o) => `${o.count}× ${o.item}`).join(', ') : 'nothing (for now)';
      setStyle(kf, 'width', st === 'cooldown' ? `${(1 - g.bossCooldownLeft(g.inLair) / BALANCE.bossRespawn) * 100}%` : '100%');
      setStyle(kf, 'background', st === 'ready' ? '#6b1a12' : '#5a4a2a');
      setText(kt, st === 'ready' ? `Summoning circle ready · offering: ${offer}` : `Boss returns in ${Math.ceil(g.bossCooldownLeft(g.inLair))}s`);
    } else {
      // EXP/hour compared to farming monsters at your own level
      const eph = g.expPerHour();
      const ideal = mobForZone(g.zone, s.level, false).exp * 1300;
      const ratio = Math.max(0, Math.min(1, eph / ideal));
      setStyle(kf, 'width', `${ratio * 100}%`);
      setStyle(kf, 'background', ratio > 0.6 ? '#4f772d' : ratio > 0.25 ? '#b08d1e' : '#8b2e1f');
      if (eph <= 0) setText(kt, 'EXP/hr: measuring...');
      else {
        const toNext = expToNext(s.level) - s.exp;
        const mins = (toNext / eph) * 60;
        setText(kt, `EXP/hr ${fmt(eph)}  ·  next level in ${mins > 600 ? 'ages' : fmtTime(mins * 60)}`);
      }
    }
    const bb = el('bossbtn');
    let show = false;
    if (!g.inBossFight) {
      if (g.travelGoal) {
        show = true;
        setText(bb, 'Cancel travel');
      } else if (g.inCave) {
        show = false;
      } else if (inLair) {
        show = g.bossStatus(g.inLair) === 'ready';
        setText(bb, '🔥 Summon boss (E)');
      } else if (g.bossStatus(g.zone) === 'ready') {
        show = true;
        setText(bb, `⚔ Fight boss (Lv ${zd.bossLevel})`);
      }
    }
    bb.classList.toggle('hidden', !show);
    bb.classList.toggle('boss', !g.travelGoal);
    bb.classList.toggle('alt', !!g.travelGoal);
    el('leavebtn').classList.toggle('hidden', !inLair && !g.inCave);
    setText(el('leavebtn'), g.inCave ? 'Leave cave' : 'Leave lair');

    el('talentdot').classList.toggle('hidden', talentsAvailable(s) <= 0);

    // Battle HUD
    const ab = el('autobtn');
    ab.classList.toggle('on', g.auto);
    setText(ab, g.inCave ? 'AUTO 🔒' : g.auto ? 'AUTO ✓' : 'AUTO ✗');
    el('modebadge').classList.toggle('hidden', g.inCave ? false : !g.auto || !g.manualActive);
    const de = document.getElementById('deadeyebtn');
    if (de) {
      const ff = document.getElementById('focusfill')!;
      const frac = g.deadeye ? (g.stats.t.trueshot ? g.focus / 100 : Math.max(0, (g.deadeyeEnd - g.time) / (6 + g.stats.t.deadeyeDur))) : g.focus / 100;
      setStyle(ff, 'height', `${Math.max(0, Math.min(1, frac)) * 100}%`);
      de.classList.toggle('ready', !g.deadeye && g.focus >= 100);
      de.classList.toggle('active', g.deadeye);
    }
    const fc = document.getElementById('flaskcount');
    if (fc) {
      setText(fc, String(g.flasks));
      document.getElementById('flaskbtn')!.classList.toggle('locked', g.flasks <= 0);
    }
    skillBtns().forEach((el, i) => {
      const sk = g.job.skills[i];
      if (!sk) return;
      const locked = s.level < sk.unlock;
      el.classList.toggle('locked', locked);
      el.querySelector('.lock')!.classList.toggle('hidden', !locked);
      const frac = locked ? 0 : Math.max(0, Math.min(1, g.skillCd[sk.id] / sk.cd));
      setStyle((el.querySelector('.cd') as HTMLElement), 'height', `${frac * 100}%`);
    });

    this.panelTimer -= dt;
    if (g.dirty || this.panelTimer <= 0) {
      this.panelTimer = 0.25;
      g.dirty = false;
      this.renderPanel();
    }
  }

  openWindow(tab: Tab) {
    this.tab = tab;
    this.open = true;
    const btn = document.querySelector<HTMLElement>(`#tabs button[data-tab="${tab}"]`);
    $('wintitle').textContent = btn?.title ?? '';
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === btn));
    $('window').classList.remove('hidden');
    this.renderPanel(true);
    $('panel').scrollTop = 0;
  }

  closeWindow() {
    this.open = false;
    $('window').classList.add('hidden');
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('active'));
  }

  renderPanel(force = false) {
    if (!this.open) return;
    let html = '';
    switch (this.tab) {
      case 'growth': html = this.growthHtml(); break;
      case 'gear': html = this.gearHtml(); break;
      case 'companions': html = this.companionHtml(); break;
      case 'summon': html = this.summonHtml(); break;
      case 'info': html = this.infoHtml(); break;
      case 'world': html = this.worldHtml(); break;
      case 'talents': html = this.talentHtml(); break;
    }
    if (!force && html === this.lastPanelHtml) return;
    // keep text typed in the save box
    const ta = document.getElementById('savebox') as HTMLTextAreaElement | null;
    const keep = ta?.value;
    if (this.tab === 'info' && !force && ta) return; // info panel is static; don't wipe typed text
    this.lastPanelHtml = html;
    $('panel').innerHTML = html;
    if (keep) {
      const nta = document.getElementById('savebox') as HTMLTextAreaElement | null;
      if (nta) nta.value = keep;
    }
  }

  // ---------------- Panels ----------------
  private growthHtml(): string {
    const g = this.game;
    const st = g.stats;
    let h = `<div class="statgrid">
      <div class="stat">Attack<b>${fmt(st.atk)}</b></div>
      <div class="stat">Max HP<b>${fmt(st.maxHp)}</b></div>
      <div class="stat">Crit Rate<b>${fmtPct(st.critRate)}</b></div>
      <div class="stat">Crit Damage<b>${fmtPct(st.critDmg)}</b></div>
    </div>
    <h3>Growth <span class="muted small">(hold to buy fast)</span></h3>`;
    for (const def of GROWTH) {
      const lvl = g.state.growth[def.key];
      const maxed = lvl >= def.max;
      const cost = def.cost(lvl);
      const cur = def.value(lvl);
      const next = def.value(lvl + 1);
      const show = (v: number) => (def.display === 'pct' ? fmtPct(v) : '+' + fmt(v));
      const afford = g.state.gold >= cost && !maxed;
      h += `<div class="row">
        <div class="icon">${def.icon}</div>
        <div class="info">
          <div class="name">${def.name} <span class="muted small">Lv. ${lvl}${def.max !== Infinity ? ' / ' + def.max : ''}</span></div>
          <div class="sub">${show(cur)}${maxed ? ' (MAX)' : ` → ${show(next)}`}</div>
        </div>
        <button class="btn ${afford ? '' : 'disabled'}" data-action="growth" data-arg="${def.key}" data-hold="1">
          ${maxed ? 'MAX' : `🪙 ${fmt(cost)}`}
        </button>
      </div>`;
    }
    return h;
  }

  private gearHtml(): string {
    const g = this.game;
    const s = g.state;
    let h = '<div class="slots">';
    for (const slot of SLOTS) {
      const id = s.equipped[slot];
      const o = id ? s.gear[id] : null;
      const col = id ? RARITY[parseGear(id).rarity].color : '#333';
      h += `<div class="slot" style="border-color:${col}">
        <div class="icon">${SLOT_INFO[slot].icon}</div>
        <div class="name" style="color:${col}">${id ? gearName(id) : 'Empty'}</div>
        <div class="sub">${id && o ? `Lv. ${o.level} · +${fmtPct(gearEffect(id, o.level))} ${SLOT_INFO[slot].stat}` : SLOT_INFO[slot].name}</div>
      </div>`;
    }
    h += `</div>
      <div class="toolbar">
        <button class="btn alt" data-action="equipBest">Equip Best</button>
        <button class="btn alt" data-action="enhanceAllGear">Enhance All</button>
      </div>
      <p class="muted small">Every piece you own gives ${fmtPct(BALANCE.ownedEffectRatio)} of its bonus even when not equipped. Duplicates are used to enhance.</p>`;

    const owned = Object.entries(s.gear).filter(([, o]) => o.count > 0);
    if (!owned.length) {
      return h + `<p class="muted">No gear yet. Head to ✨ Summon to get some.</p>`;
    }
    for (const slot of SLOTS) {
      const items = owned
        .filter(([id]) => parseGear(id).slot === slot)
        .sort((a, b) => gearEffect(b[0], b[1].level) - gearEffect(a[0], a[1].level));
      if (!items.length) continue;
      h += `<h3>${SLOT_INFO[slot].icon} ${SLOT_INFO[slot].name}s</h3>`;
      for (const [id, o] of items) h += this.gearRow(id, o.count, o.level, s.equipped[slot as Slot] === id);
    }
    return h;
  }

  private gearRow(id: string, count: number, level: number, equipped: boolean): string {
    const g = parseGear(id);
    const r = RARITY[g.rarity];
    const need = enhanceCopies(level);
    const have = count - 1;
    const can = have >= need;
    return `<div class="row" style="border-left:4px solid ${r.color}">
      <div class="icon">${SLOT_INFO[g.slot].icon}</div>
      <div class="info">
        <div class="name" style="color:${r.color}">${gearName(id)} <span class="tag">Lv. ${level}</span>${equipped ? '<span class="tag" style="background:#3a86ff">EQUIPPED</span>' : ''}</div>
        <div class="sub">+${fmtPct(gearEffect(id, level))} ${SLOT_INFO[g.slot].stat} · copies ${have}/${need}</div>
        <div class="prog"><div style="width:${Math.min(100, (have / need) * 100)}%"></div></div>
      </div>
      <div class="btn-col">
        ${equipped ? '' : `<button class="btn alt" data-action="equip" data-arg="${id}">Equip</button>`}
        <button class="btn ${can ? '' : 'disabled'}" data-action="enhance" data-arg="${id}">Enhance</button>
      </div>
    </div>`;
  }

  private companionHtml(): string {
    const s = this.game.state;
    let h = '<div class="slots">';
    s.party.forEach((id) => {
      const c = id ? COMPANION[id] : null;
      const o = id ? s.companions[id] : null;
      const col = c ? RARITY[c.rarity].color : '#333';
      h += `<div class="slot" style="border-color:${col}">
        <div class="icon">${c ? c.icon : '➕'}</div>
        <div class="name" style="color:${col}">${c ? c.name : 'Empty'}</div>
        <div class="sub">${c && o ? `Lv. ${o.level} · ${fmtPct(companionHitMult(c.id, o.level))} ATK` : 'Party slot'}</div>
      </div>`;
    });
    h += `</div>
      <div class="toolbar">
        <button class="btn alt" data-action="autoParty">Auto Party</button>
        <button class="btn alt" data-action="enhanceAllComp">Enhance All</button>
      </div>
      <p class="muted small">Party members attack alongside you. Every companion you own also boosts your ATK.</p>`;

    const list = [...COMPANIONS].sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity));
    for (const c of list) {
      const o = s.companions[c.id];
      const r = RARITY[c.rarity];
      if (!o) {
        h += `<div class="row" style="opacity:0.45;border-left:4px solid ${r.color}">
          <div class="icon">❔</div>
          <div class="info"><div class="name" style="color:${r.color}">???</div><div class="sub">${r.name} companion, not found yet</div></div>
        </div>`;
        continue;
      }
      const need = enhanceCopies(o.level);
      const have = o.count - 1;
      const inParty = s.party.includes(c.id);
      h += `<div class="row" style="border-left:4px solid ${r.color}">
        <div class="icon">${c.icon}</div>
        <div class="info">
          <div class="name" style="color:${r.color}">${c.name} <span class="tag">Lv. ${o.level}</span>${inParty ? '<span class="tag" style="background:#2d6a4f">PARTY</span>' : ''}</div>
          <div class="sub">Hits for ${fmtPct(companionHitMult(c.id, o.level))} ATK · Owned: +${fmtPct(companionOwnedAtk(c.id, o.level))} ATK · copies ${have}/${need}</div>
          <div class="prog"><div style="width:${Math.min(100, (have / need) * 100)}%"></div></div>
        </div>
        <div class="btn-col">
          <button class="btn alt" data-action="party" data-arg="${c.id}">${inParty ? 'Remove' : 'Add'}</button>
          <button class="btn ${have >= need ? '' : 'disabled'}" data-action="enhanceComp" data-arg="${c.id}">Enhance</button>
        </div>
      </div>`;
    }
    return h;
  }

  private summonHtml(): string {
    const gems = this.game.state.gems;
    const total = RARITIES.reduce((a, r) => a + r.weight, 0);
    const rates = RARITIES.map(
      (r) => `<span style="color:${r.color}">${r.name} ${((r.weight / total) * 100).toFixed(1)}%</span>`,
    ).join('');
    const btns = (action: string) => `<div class="toolbar">
      <button class="btn gold ${gems >= BALANCE.summonCost ? '' : 'disabled'}" data-action="${action}" data-arg="1">Summon x1<small>💎 ${BALANCE.summonCost}</small></button>
      <button class="btn gold ${gems >= BALANCE.summon10Cost ? '' : 'disabled'}" data-action="${action}" data-arg="10">Summon x10<small>💎 ${BALANCE.summon10Cost}</small></button>
    </div>`;
    return `
      <div class="banner">
        <h3>🗡️ Gear Summon</h3>
        <p>Weapons, armor and accessories. Higher tiers (I to IV) are rarer.</p>
        ${btns('summonGear')}
        <div class="rates">${rates}</div>
      </div>
      <div class="banner comp">
        <h3>🐾 Companion Summon</h3>
        <p>Allies that fight beside you and boost your ATK.</p>
        ${btns('summonComp')}
        <div class="rates">${rates}</div>
      </div>
      <p class="muted small">Earn 💎 from monster drops (${fmtPct(BALANCE.gemDropChance)} per kill) and first-time boss clears (+${BALANCE.bossFirstClearGems}).</p>`;
  }

  private talentHtml(): string {
    const g = this.game;
    const s = g.state;
    const tree = TALENT_TREES[g.job.id];
    const avail = talentsAvailable(s);
    const spent = talentsSpent(s);
    let h = `<div class="tal-head">
      <div>
        <h3 style="border:none;margin:0">${g.job.icon} ${tree.name}</h3>
        <div class="muted small">${tree.theme}</div>
      </div>
      <div class="tal-points"><b>${avail}</b><span>point${avail === 1 ? '' : 's'} to spend</span></div>
    </div>
    <div class="toolbar">
      <button class="btn ${avail > 0 ? '' : 'disabled'}" data-action="talentAuto">Auto-assign</button>
      <button class="btn alt ${spent > 0 ? '' : 'disabled'}" data-action="talentReset">Reset talents (free)</button>
    </div>
    <p class="muted small">You earn 1 point per level. Each row unlocks after spending 5 more points in this tree. Tap a talent to rank it up.</p>`;
    for (let tier = 0; tier <= 5; tier++) {
      const nodes = tree.nodes.filter((n) => n.tier === tier).sort((a, b) => a.col - b.col);
      if (!nodes.length) continue;
      const req = nodes[0].reqPoints;
      const unlocked = spent >= req;
      h += `<div class="tal-tier ${unlocked ? '' : 'locked'}"><div class="tal-tierlabel">${tier === 5 ? 'Keystone' : `Row ${tier + 1}`}${req ? ` · needs ${req} points` : ''}${unlocked ? '' : ' 🔒'}</div><div class="tal-row">`;
      for (const n of nodes) {
        const r = Math.min(n.maxRank, s.talents[n.id] ?? 0);
        const blocked = talentBlocked(s, n.id);
        const state = r >= n.maxRank ? 'maxed' : !blocked ? 'open' : r > 0 ? 'partial' : 'closed';
        h += `<div class="tal-node ${state} ${n.keystone ? 'keystone' : ''}" data-action="talent" data-arg="${n.id}" title="${blocked && r < n.maxRank ? blocked : ''}">
          <div class="tal-icon">${n.icon}</div>
          <div class="tal-body">
            <div class="tal-name">${n.name} <span class="tal-rank">${r}/${n.maxRank}</span></div>
            ${r > 0 ? `<div class="tal-now">Now: ${n.desc(r)}</div>` : ''}
            ${r < n.maxRank ? `<div class="tal-next">${r > 0 ? 'Next' : 'Rank 1'}: ${n.desc(r + 1)}</div>` : ''}
          </div>
        </div>`;
      }
      h += `</div></div>`;
    }
    return h;
  }

  private worldHtml(): string {
    const g = this.game;
    const s = g.state;
    let h = `<h3>🗺️ World</h3>
      <p class="muted small">Zones get harder the further east you go, and monsters get stronger deeper into each zone.
      Monsters above your level hit much harder; monsters far below it give almost no EXP. Each boss sleeps in a lair near the east end of its zone: go in and summon it at the circle. Bosses must be beaten in order.</p>`;
    ZONES.forEach((z, i) => {
      const here = g.zone === i;
      const lvl = s.level;
      const verdict =
        lvl < z.minLevel - 2 ? ['Too dangerous', '#ff3b3b']
        : lvl > z.maxLevel + 4 ? ['Low EXP', '#8a8a8a']
        : ['Good EXP', '#7bd389'];
      const mult = expLevelMult(Math.min(z.maxLevel, Math.max(z.minLevel, lvl)), lvl);
      const st = g.bossStatus(i);
      const bossText =
        st === 'locked' ? `🔒 Sealed until ${ZONES[i - 1].name}'s boss is beaten`
        : st === 'cooldown' ? `⏳ Returns in ${Math.ceil(g.bossCooldownLeft(i))}s`
        : st === 'fighting' ? '⚔ Fighting now'
        : '🔥 Ready';
      const kills = s.bossKills[i] ?? 0;
      const offer = z.offering.length ? z.offering.map((o) => `${o.count}× ${o.item}`).join(', ') : 'none needed yet';
      h += `<div class="row" style="border-left:4px solid ${here ? '#c9a227' : '#3a3022'}">
        <div class="icon">${['🌱', '🌲', '🔥'][i] ?? '🗺️'}</div>
        <div class="info">
          <div class="name">${z.name} <span class="muted small">Lv ${z.minLevel}-${z.maxLevel}</span>${here ? '<span class="tag" style="background:#6b5a36">YOU ARE HERE</span>' : ''}</div>
          <div class="sub"><span style="color:${verdict[1]}">${verdict[0]}</span>${mult < 1 && verdict[0] !== 'Too dangerous' ? ` (×${mult.toFixed(2)} EXP)` : ''}</div>
          <div class="sub">${bossName(i)} (Lv ${z.bossLevel}): ${bossText}${kills ? ` · beaten ${kills}×` : ''}</div>
          <div class="sub">Summon offering: ${offer}</div>
        </div>
        <div class="btn-col">
          <button class="btn alt ${here ? 'disabled' : ''}" data-action="travel" data-arg="${i}">Travel</button>
          <button class="btn ${st === 'ready' ? '' : 'disabled'}" data-action="fightBoss" data-arg="${i}">Fight boss</button>
        </div>
      </div>`;
    });
    h += `<div class="row" style="border-left:4px solid ${g.inCave ? '#c9a227' : '#4a2d73'}">
        <div class="icon">🕳️</div>
        <div class="info">
          <div class="name">${CAVE.name} <span class="muted small">in ${ZONES[0].name}</span>${g.inCave ? '<span class="tag" style="background:#6b5a36">YOU ARE HERE</span>' : ''}</div>
          <div class="sub" style="color:#ffb38a">Manual only: AUTO is switched off inside.</div>
          <div class="sub">Monsters match your level (up to +${BALANCE.caveLevelBonus} deeper in) and give ${BALANCE.caveExpMult}x EXP and ${BALANCE.caveGoldMult}x gold. Die and you wake up outside.</div>
        </div>
        <div class="btn-col">
          <button class="btn ${g.inCave ? 'disabled' : ''}" data-action="goCave">Go to cave</button>
        </div>
      </div>`;
    h += `<p class="muted small">Travel and Fight boss turn AUTO on and walk you there (Fight boss also summons, fights and walks you back out). You can also just walk: the purple barriers between zones only stop monsters.</p>`;
    return h;
  }

  private infoHtml(): string {
    const g = this.game;
    const s = g.state;
    return `
      <h3>${g.job.icon} ${esc(s.name)}, Lv. ${s.level} ${g.job.name}</h3>
      <button class="btn wide alt" data-action="switch" style="margin-bottom:12px">👥 Switch character</button>
      <h3>Progress</h3>
      <div class="statgrid">
        <div class="stat">Bosses beaten<b>${s.bossesCleared} / ${ZONES.length}</b></div>
        <div class="stat">Monsters defeated<b>${fmt(s.totals.kills)}</b></div>
        <div class="stat">Bosses defeated<b>${fmt(s.totals.bosses)}</b></div>
        <div class="stat">Summons<b>${fmt(s.totals.summons)}</b></div>
      </div>
      <h3>How to play</h3>
      <p class="muted small"><b>Controls:</b> your hero plays itself while AUTO is on. Take over any time: WASD or arrows to move, mouse to aim, hold left click (or Space) to attack, and 1/2/3 to cast skills where you aim. On a phone, drag on the battlefield to move and use the buttons. AUTO takes back over 2 seconds after you stop. Press Q or the AUTO button for full manual mode.</p>
      <p class="muted small"><b>${CAVE.name}:</b> a cave in ${ZONES[0].name} where AUTO is switched off. Monsters there match your level and give ${BALANCE.caveExpMult}x EXP, so it's the fastest way to level if you play yourself.</p>
      <p class="muted small"><b>Boss lairs:</b> walk into a lair's archway, then press E or Summon boss at the circle. Leave through the blue Exit portal or the Leave lair button.</p>
      <p class="muted small"><b>Bosses</b> are meant to be hard. Every attack is marked on the ground in red first, and a big hit takes a large share of your max HP no matter how much HP you have. Only out-levelling a boss makes its hits smaller. Bosses speed up and learn new attacks at two HP thresholds (marked on the boss bar), and enrage after ${Math.round(BALANCE.bossTimeLimit / 60)} minutes. AUTO dodges like an average player; beating a boss at its own level takes your own hands.</p>
      <p class="muted small"><b>🎯 Marksman (Archer):</b> every arrow that hits builds Focus. At full Focus press F (AUTO does it right away) for Deadeye: your arrows pierce and hit 40% harder for 6s. The Marksman talents build on this.</p>
      <p class="muted small"><b>🧪 Flasks (R)</b> heal ${Math.round(BALANCE.flaskHeal * 100)}% of your HP. You carry ${BALANCE.flaskCharges}; they refill when you enter a lair and slowly out in the world. AUTO drinks when low.</p>
      <p class="muted small">Monsters flash red and show an orange arc before they swing.</p>
      <p class="muted small">Your hero fights on its own. Spend 🪙 gold on Growth and summon gear and companions with 💎 gems. Explore east into harder zones when you are ready (the 🗺️ World tab shows where your level fits), and challenge each zone's boss at its altar. You keep earning for up to ${BALANCE.offlineCapHours} hours while away, farming wherever you left your hero.</p>
      <h3>🧪 Testing tools</h3>
      <div class="row">
        <div class="info">
          <div class="name">Level</div>
          <div class="sub">Currently Lv. ${s.level}. Higher level = bosses and monsters hit you less and give you less EXP.</div>
        </div>
        <input id="lvlinput" type="number" min="1" max="200" value="${s.level}" class="lvlinput" />
        <button class="btn" data-action="setLevel">Set</button>
      </div>
      <div class="toolbar">
        <button class="btn alt" data-action="addLevel" data-arg="-5">-5</button>
        <button class="btn alt" data-action="addLevel" data-arg="-1">-1</button>
        <button class="btn alt" data-action="addLevel" data-arg="1">+1</button>
        <button class="btn alt" data-action="addLevel" data-arg="5">+5</button>
        <button class="btn alt" data-action="addLevel" data-arg="10">+10</button>
      </div>
      <div class="row">
        <div class="info">
          <div class="name">Test mode ${s.settings.testMode ? '<span class="tag" style="background:#2d6a4f">ON</span>' : ''}</div>
          <div class="sub">Invincible and 10x damage, for trying content quickly.</div>
        </div>
        <button class="btn ${s.settings.testMode ? '' : 'alt'}" data-action="testMode">${s.settings.testMode ? 'Turn off' : 'Turn on'}</button>
      </div>
      <h3>Save</h3>
      <p class="muted small">The game saves automatically. Use export to back up your save or move it to another device.</p>
      <textarea id="savebox" placeholder="Paste a save code here to import"></textarea>
      <div class="toolbar" style="margin-top:8px">
        <button class="btn alt" data-action="save">Save now</button>
        <button class="btn alt" data-action="export">Export</button>
        <button class="btn alt" data-action="import">Import</button>
      </div>
      <button class="btn wide" style="background:#7f1d1d;margin-top:12px" data-action="reset">Reset this character to Lv 1</button>
      <p class="small" style="text-align:center;margin-top:16px"><a href="./side/">Play the classic side-scroller version</a></p>
      <p class="muted small" style="text-align:center">v0.14.0</p>`;
  }

  // ---------------- Modals & toasts ----------------
  private showSummon(res: SummonResult[], isGear: boolean) {
    const cells = res
      .map((r, i) => {
        const col = RARITY[r.rarity].color;
        const icon = isGear ? SLOT_INFO[parseGear(r.id).slot].icon : COMPANION[r.id].icon;
        const label = isGear ? ['I', 'II', 'III', 'IV'][parseGear(r.id).tier - 1] : COMPANION[r.id].name.split(' ')[0];
        return `<div class="result" style="border-color:${col};animation-delay:${i * 0.05}s">
          ${r.isNew ? '<span class="new">NEW</span>' : ''}${icon}<span class="r" style="color:${col}">${label}</span></div>`;
      })
      .join('');
    const best = res.reduce((a, b) => (rarityIndex(b.rarity) > rarityIndex(a.rarity) ? b : a));
    const bestName = isGear ? gearName(best.id) : `${RARITY[best.rarity].name} ${COMPANION[best.id].name}`;
    this.openModal(`<h2>Summon Results</h2>
      <div class="results">${cells}</div>
      <p class="small" style="text-align:center">Best pull: <b style="color:${RARITY[best.rarity].color}">${bestName}</b></p>
      <button class="btn wide" data-close>OK</button>`);
  }

  showOffline(r: OfflineRewards) {
    this.openModal(`<h2>Welcome back!</h2>
      <p class="muted small" style="text-align:center">Your hero kept fighting for ${fmtTime(r.seconds)}.</p>
      <div class="reward-list">
        <div><span>Monsters defeated</span><b>${fmt(r.kills)}</b></div>
        <div><span>🪙 Gold</span><b>+${fmt(r.gold)}</b></div>
        <div><span>✨ EXP</span><b>+${fmt(r.exp)}${r.levels ? ` (+${r.levels} Lv)` : ''}</b></div>
        <div><span>💎 Gems</span><b>+${fmt(r.gems)}</b></div>
      </div>
      <button class="btn wide" data-close>Collect</button>`);
  }

  private openModal(html: string) {
    $('modalbox').innerHTML = html;
    $('modal').classList.remove('hidden');
  }

  private closeModal() {
    $('modal').classList.add('hidden');
  }

  toast(msg: string, color = '#4ade80') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.borderLeftColor = color;
    el.textContent = msg;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild?.remove();
    setTimeout(() => el.remove(), 2600);
  }
}
