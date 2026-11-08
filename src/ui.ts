import {
  BALANCE, COMPANION, COMPANIONS, GROWTH, GrowthKey, RARITIES, RARITY, SLOTS, SLOT_INFO, Slot,
  companionHitMult, companionOwnedAtk, enhanceCopies, expToNext, gearEffect, gearName, parseGear,
  rarityIndex, stageLabel,
} from './data';
import { fmt, fmtPct, fmtTime } from './format';
import { Game, OfflineRewards, SummonResult } from './game';
import { clearSave, exportSave, importSave, saveGame } from './save';

type Tab = 'growth' | 'gear' | 'companions' | 'summon' | 'info';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  tab: Tab = 'growth';
  private lastPanelHtml = '';
  private panelTimer = 0;
  private holdTimer: number | undefined;
  private holdInterval: number | undefined;
  /** Called when the whole game is replaced (import / reset). */
  onReplaceState: (code: string | null) => void = () => {};

  constructor(private game: Game) {
    game.onToast = (m, c) => this.toast(m, c);

    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
        this.renderPanel(true);
        $('panel').scrollTop = 0;
      });
    });

    $('bossbtn').addEventListener('click', () => this.game.challengeBoss());

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
        if (window.confirm('Reset ALL progress? This cannot be undone.')) {
          clearSave();
          this.onReplaceState(null);
        }
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
    $('lvl').textContent = `Lv. ${s.level}`;
    $('expfill').style.width = `${Math.min(100, (s.exp / expToNext(s.level)) * 100)}%`;
    $('gold').textContent = fmt(s.gold);
    $('gems').textContent = fmt(s.gems);
    $('power').textContent = fmt(g.stats.power);
    $('stagename').textContent = stageLabel(s.stage) + (s.bossFailed ? '  (Farming)' : '');

    const kf = $('killfill');
    const kt = $('killtext');
    if (g.inBossFight) {
      kf.style.width = '100%';
      kf.style.background = '#f72585';
      kt.textContent = 'BOSS FIGHT';
    } else if (s.bossFailed) {
      kf.style.width = '100%';
      kf.style.background = '#555a70';
      kt.textContent = 'Farming';
    } else {
      kf.style.width = `${(s.kills / BALANCE.killsPerStage) * 100}%`;
      kf.style.background = '';
      kt.textContent = `${s.kills} / ${BALANCE.killsPerStage}`;
    }
    $('bossbtn').classList.toggle('hidden', !s.bossFailed || g.inBossFight);

    this.panelTimer -= dt;
    if (g.dirty || this.panelTimer <= 0) {
      this.panelTimer = 0.25;
      g.dirty = false;
      this.renderPanel();
    }
  }

  renderPanel(force = false) {
    let html = '';
    switch (this.tab) {
      case 'growth': html = this.growthHtml(); break;
      case 'gear': html = this.gearHtml(); break;
      case 'companions': html = this.companionHtml(); break;
      case 'summon': html = this.summonHtml(); break;
      case 'info': html = this.infoHtml(); break;
    }
    if (!force && html === this.lastPanelHtml) return;
    // keep text typed in the save box
    const ta = document.getElementById('savebox') as HTMLTextAreaElement | null;
    const keep = ta?.value;
    if (this.tab === 'info' && !force && ta) return; // info panel is static; don't wipe the textarea
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

  private infoHtml(): string {
    const s = this.game.state;
    return `
      <h3>Progress</h3>
      <div class="statgrid">
        <div class="stat">Best stage<b>${stageLabel(s.maxStage)}</b></div>
        <div class="stat">Monsters defeated<b>${fmt(s.totals.kills)}</b></div>
        <div class="stat">Bosses defeated<b>${fmt(s.totals.bosses)}</b></div>
        <div class="stat">Summons<b>${fmt(s.totals.summons)}</b></div>
      </div>
      <h3>How to play</h3>
      <p class="muted small">Your hero fights on its own. Spend 🪙 gold on Growth, summon gear and companions with 💎 gems, and beat the boss every ${BALANCE.killsPerStage} kills to advance. If you lose to a boss you will farm the stage until you tap Challenge Boss. You keep earning for up to ${BALANCE.offlineCapHours} hours while away.</p>
      <h3>Save</h3>
      <p class="muted small">The game saves automatically. Use export to back up your save or move it to another device.</p>
      <textarea id="savebox" placeholder="Paste a save code here to import"></textarea>
      <div class="toolbar" style="margin-top:8px">
        <button class="btn alt" data-action="save">Save now</button>
        <button class="btn alt" data-action="export">Export</button>
        <button class="btn alt" data-action="import">Import</button>
      </div>
      <button class="btn wide" style="background:#7f1d1d;margin-top:12px" data-action="reset">Reset progress</button>
      <p class="muted small" style="text-align:center;margin-top:16px">v0.1.0</p>`;
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
