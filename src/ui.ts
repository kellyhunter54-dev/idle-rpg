import {
  BALANCE, COMPANION, COMPANIONS, GROWTH, GrowthKey, RARITIES, RARITY, SLOTS, SLOT_INFO, Slot,
  companionHitMult, companionOwnedAtk, enhanceCopies, expToNext, gearEffect, gearName, parseGear,
  ZONES, bossName, expLevelMult, mobForZone, rarityIndex,
} from './data';
import { fmt, fmtPct, fmtTime } from './format';
import { Game, OfflineRewards, SummonResult } from './game';
import { exportSave, importSave, saveGame } from './save';

type Tab = 'growth' | 'world' | 'gear' | 'companions' | 'summon' | 'info';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class UI {
  tab: Tab = 'growth';
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

    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
        this.renderPanel(true);
        $('panel').scrollTop = 0;
      });
    });

    $('bossbtn').addEventListener('click', () => {
      const g = this.game;
      if (g.travelGoal) g.cancelTravel();
      else if (g.inLair >= 0) this.trySummon();
      else g.goToBoss(g.zone);
    });
    $('leavebtn').addEventListener('click', () => this.game.exitLair());

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
    $('lvl').textContent = `${s.name}  ·  Lv. ${s.level} ${g.job.name}`;
    $('expfill').style.width = `${Math.min(100, (s.exp / expToNext(s.level)) * 100)}%`;
    $('gold').textContent = fmt(s.gold);
    $('gems').textContent = fmt(s.gems);
    $('power').textContent = fmt(g.stats.power);
    const zd = ZONES[g.zone];
    const inLair = g.inLair >= 0;
    $('stagename').textContent = inLair
      ? `${bossName(g.inLair)}'s Lair  (boss Lv ${zd.bossLevel})`
      : `${zd.name}  (Lv ${zd.minLevel}-${zd.maxLevel})` + (g.travelGoal ? `  ·  walking to ${g.travelGoal.label}...` : '');

    const kf = $('killfill');
    const kt = $('killtext');
    if (g.inBossFight) {
      kf.style.width = '100%';
      kf.style.background = '#a4161a';
      kt.textContent = 'BOSS FIGHT';
    } else if (inLair) {
      const st = g.bossStatus(g.inLair);
      const offer = zd.offering.length ? zd.offering.map((o) => `${o.count}× ${o.item}`).join(', ') : 'nothing (for now)';
      kf.style.width = st === 'cooldown' ? `${(1 - g.bossCooldownLeft(g.inLair) / BALANCE.bossRespawn) * 100}%` : '100%';
      kf.style.background = st === 'ready' ? '#6b1a12' : '#5a4a2a';
      kt.textContent = st === 'ready' ? `Summoning circle ready · offering: ${offer}` : `Boss returns in ${Math.ceil(g.bossCooldownLeft(g.inLair))}s`;
    } else {
      // EXP/hour compared to farming monsters at your own level
      const eph = g.expPerHour();
      const ideal = mobForZone(g.zone, s.level, false).exp * 1300;
      const ratio = Math.max(0, Math.min(1, eph / ideal));
      kf.style.width = `${ratio * 100}%`;
      kf.style.background = ratio > 0.6 ? '#4f772d' : ratio > 0.25 ? '#b08d1e' : '#8b2e1f';
      if (eph <= 0) kt.textContent = 'EXP/hr: measuring...';
      else {
        const toNext = expToNext(s.level) - s.exp;
        const mins = (toNext / eph) * 60;
        kt.textContent = `EXP/hr ${fmt(eph)}  ·  next level in ${mins > 600 ? 'ages' : fmtTime(mins * 60)}`;
      }
    }
    const bb = $('bossbtn');
    let show = false;
    if (!g.inBossFight) {
      if (g.travelGoal) {
        show = true;
        bb.textContent = 'Cancel travel';
      } else if (inLair) {
        show = g.bossStatus(g.inLair) === 'ready';
        bb.textContent = '🔥 Summon boss (E)';
      } else if (g.bossStatus(g.zone) === 'ready') {
        show = true;
        bb.textContent = `⚔ Fight boss (Lv ${zd.bossLevel})`;
      }
    }
    bb.classList.toggle('hidden', !show);
    bb.classList.toggle('boss', !g.travelGoal);
    bb.classList.toggle('alt', !!g.travelGoal);
    $('leavebtn').classList.toggle('hidden', !inLair);

    // Battle HUD
    const ab = $('autobtn');
    ab.classList.toggle('on', g.auto);
    ab.textContent = g.auto ? 'AUTO ✓' : 'AUTO ✗';
    $('modebadge').classList.toggle('hidden', !g.auto || !g.manualActive);
    document.querySelectorAll<HTMLElement>('.skillbtn').forEach((el, i) => {
      const sk = g.job.skills[i];
      if (!sk) return;
      const locked = s.level < sk.unlock;
      el.classList.toggle('locked', locked);
      el.querySelector('.lock')!.classList.toggle('hidden', !locked);
      const frac = locked ? 0 : Math.max(0, Math.min(1, g.skillCd[sk.id] / sk.cd));
      (el.querySelector('.cd') as HTMLElement).style.height = `${frac * 100}%`;
    });

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
      case 'world': html = this.worldHtml(); break;
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
      <p class="muted small"><b>Boss lairs:</b> walk into a lair's archway, then press E or Summon boss at the circle. Leave through the blue Exit portal or the Leave lair button.</p>
      <p class="muted small"><b>Bosses</b> mark the ground in red before they strike. Step out of the marked area to avoid the hit. Monsters flash red and show an orange arc before they swing.</p>
      <p class="muted small">Your hero fights on its own. Spend 🪙 gold on Growth and summon gear and companions with 💎 gems. Explore east into harder zones when you are ready (the 🗺️ World tab shows where your level fits), and challenge each zone's boss at its altar. You keep earning for up to ${BALANCE.offlineCapHours} hours while away, farming wherever you left your hero.</p>
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
      <p class="muted small" style="text-align:center">v0.6.0</p>`;
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
