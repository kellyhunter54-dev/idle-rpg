import {
  BALANCE, COMPANION, COMPANIONS, GROWTH, GrowthKey, MobStats, RARITIES, Rarity, SKILLS, SLOTS,
  Slot, TIERS, TIER_WEIGHTS, companionHitMult, enhanceCopies, expToNext, gearId, gearScore,
  mobFor, parseGear,
} from './data';
import { GameState } from './state';
import { Stats, computeStats } from './stats';

export interface FloatText {
  x: number; // 0..1 relative to battle area
  y: number;
  text: string;
  color: string;
  life: number;
  size: number;
}

export interface Mob extends MobStats {
  maxHp: number;
}

export interface SummonResult {
  id: string;
  rarity: Rarity;
  isNew: boolean;
}

export interface OfflineRewards {
  seconds: number;
  kills: number;
  gold: number;
  exp: number;
  gems: number;
  levels: number;
}

function weighted<T>(items: T[], weights: number[], rand: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export class Game {
  state: GameState;
  stats!: Stats;
  hp = 0;
  mob: Mob | null = null;
  spawnTimer = 0;
  deadTimer = 0;
  playerTimer = 0;
  mobTimer = 0;
  bossTimer = 0;
  skillCd: Record<string, number> = {};
  compTimers: number[] = [];
  floats: FloatText[] = [];
  anim = { lunge: 0, mobHit: 0, playerHit: 0, flash: 0, flashColor: '#fff', compHit: [] as number[] };
  rand: () => number;
  /** Set to true whenever something the UI shows changes in a way worth re-rendering panels. */
  dirty = true;
  onToast: (msg: string, color?: string) => void = () => {};

  constructor(state: GameState, rand: () => number = Math.random) {
    this.state = state;
    this.rand = rand;
    this.recalc();
    this.hp = this.stats.maxHp;
    for (const s of SKILLS) this.skillCd[s.id] = s.cd * 0.5;
    this.compTimers = state.party.map((_, i) => 0.3 * i);
  }

  recalc() {
    const prevMax = this.stats?.maxHp ?? 0;
    this.stats = computeStats(this.state);
    if (prevMax > 0) this.hp = Math.min(this.stats.maxHp, this.hp + Math.max(0, this.stats.maxHp - prevMax));
    this.dirty = true;
  }

  get inBossFight(): boolean {
    return !!this.mob?.boss;
  }

  // ---------------- Main loop ----------------
  update(dt: number) {
    const s = this.state;
    this.anim.lunge = Math.max(0, this.anim.lunge - dt * 4);
    this.anim.mobHit = Math.max(0, this.anim.mobHit - dt * 5);
    this.anim.playerHit = Math.max(0, this.anim.playerHit - dt * 5);
    this.anim.flash = Math.max(0, this.anim.flash - dt * 3);
    this.anim.compHit = this.anim.compHit.map((v) => Math.max(0, v - dt * 4));
    for (const f of this.floats) {
      f.life -= dt;
      f.y -= dt * 0.12;
    }
    this.floats = this.floats.filter((f) => f.life > 0);

    if (this.deadTimer > 0) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.hp = this.stats.maxHp;
      return;
    }

    if (!this.mob) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) this.spawn();
      return;
    }

    // Boss timer
    if (this.mob.boss) {
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) {
        this.failBoss('Time ran out!');
        return;
      }
    }

    // Player auto attack
    this.playerTimer -= dt;
    if (this.playerTimer <= 0) {
      this.playerTimer += BALANCE.playerAttackInterval;
      this.anim.lunge = 1;
      this.hit(this.stats.atk, 0.62, 0.5);
    }

    // Skills (auto cast)
    for (const sk of SKILLS) {
      if (s.level < sk.unlock || !this.mob) continue;
      this.skillCd[sk.id] -= dt;
      if (this.skillCd[sk.id] <= 0) {
        this.skillCd[sk.id] = sk.cd;
        this.anim.flash = 1;
        this.anim.flashColor = sk.color;
        this.hit(this.stats.atk * sk.mult, 0.62, 0.38, sk.name);
      }
    }

    // Companions
    s.party.forEach((id, i) => {
      if (!id || !this.mob) return;
      const o = s.companions[id];
      if (!o) return;
      this.compTimers[i] = (this.compTimers[i] ?? 0) - dt;
      if (this.compTimers[i] <= 0) {
        this.compTimers[i] += BALANCE.companionAttackInterval;
        this.anim.compHit[i] = 1;
        this.hit(this.stats.atk * companionHitMult(id, o.level), 0.66, 0.58, undefined, COMPANION[id].color);
      }
    });

    // Mob attacks
    if (this.mob) {
      this.mobTimer -= dt;
      if (this.mobTimer <= 0) {
        this.mobTimer += BALANCE.mobAttackInterval;
        this.hp -= this.mob.atk;
        this.anim.playerHit = 1;
        this.float(0.3, 0.45, '-' + Math.round(this.mob.atk).toLocaleString(), '#ff6b6b', 14);
        if (this.hp <= 0) this.playerDie();
      }
    }
  }

  private spawn() {
    const s = this.state;
    const boss = !s.bossFailed && s.kills >= BALANCE.killsPerStage;
    const m = mobFor(s.stage, boss, this.rand);
    this.mob = { ...m, maxHp: m.hp };
    this.mobTimer = BALANCE.mobAttackInterval;
    this.playerTimer = Math.min(this.playerTimer, 0.3);
    if (boss) {
      this.bossTimer = BALANCE.bossTimeLimit;
      this.hp = this.stats.maxHp;
      this.dirty = true;
    }
  }

  private hit(base: number, x: number, y: number, label?: string, color?: string) {
    if (!this.mob) return;
    const crit = this.rand() < this.stats.critRate;
    const dmg = base * (crit ? this.stats.critDmg : 1) * (0.9 + this.rand() * 0.2);
    this.mob.hp -= dmg;
    this.anim.mobHit = 1;
    const text = (label ? label + ' ' : '') + fmtDmg(dmg) + (crit ? '!' : '');
    this.float(x + (this.rand() - 0.5) * 0.08, y, text, color ?? (crit ? '#ffb703' : '#ffffff'), crit ? 20 : label ? 18 : 15);
    if (this.mob.hp <= 0) this.killMob();
  }

  private float(x: number, y: number, text: string, color: string, size: number) {
    if (this.floats.length > 40) this.floats.shift();
    this.floats.push({ x, y, text, color, life: 0.9, size });
  }

  private killMob() {
    const s = this.state;
    const m = this.mob!;
    this.mob = null;
    this.spawnTimer = BALANCE.respawnDelay;
    s.gold += m.gold;
    this.addExp(m.exp);
    s.totals.kills++;
    this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * BALANCE.healOnKillPct);
    if (this.rand() < BALANCE.gemDropChance) {
      s.gems += 1;
      this.float(0.62, 0.3, '+1 💎', '#7df9ff', 15);
    }

    if (m.boss) {
      s.totals.bosses++;
      const firstClear = s.stage >= s.maxStage;
      s.stage++;
      if (firstClear) {
        s.maxStage = s.stage;
        s.gems += BALANCE.bossFirstClearGems;
        this.onToast(`Boss defeated! +${BALANCE.bossFirstClearGems} 💎`, '#ffc23d');
      }
      s.kills = 0;
      s.bossFailed = false;
      this.hp = this.stats.maxHp;
    } else {
      s.kills++;
    }
    this.dirty = true;
  }

  addExp(amount: number): number {
    const s = this.state;
    s.exp += amount;
    let gained = 0;
    while (s.exp >= expToNext(s.level)) {
      s.exp -= expToNext(s.level);
      s.level++;
      gained++;
      const unlocked = SKILLS.find((k) => k.unlock === s.level);
      if (unlocked) this.onToast(`New skill: ${unlocked.icon} ${unlocked.name}`, unlocked.color);
    }
    if (gained) {
      this.recalc();
      this.hp = this.stats.maxHp;
      this.onToast(`Level up! Lv. ${s.level}`, '#5dff9b');
    }
    return gained;
  }

  private playerDie() {
    const s = this.state;
    s.totals.deaths++;
    this.deadTimer = BALANCE.playerDeathDelay;
    this.hp = 0;
    const wasBoss = this.mob?.boss;
    this.mob = null;
    this.spawnTimer = BALANCE.playerDeathDelay;
    if (wasBoss) {
      s.bossFailed = true;
      this.onToast('Defeated by the boss. Farming until you challenge again.', '#ff6b6b');
    } else if (s.stage > 1) {
      s.stage--;
      s.bossFailed = true;
      s.kills = 0;
      this.onToast('You were defeated and fell back a stage.', '#ff6b6b');
    }
    this.dirty = true;
  }

  private failBoss(msg: string) {
    this.state.bossFailed = true;
    this.mob = null;
    this.spawnTimer = BALANCE.respawnDelay;
    this.onToast(msg + ' Farming until you challenge again.', '#ff6b6b');
    this.dirty = true;
  }

  challengeBoss() {
    const s = this.state;
    s.bossFailed = false;
    s.kills = Math.max(s.kills, BALANCE.killsPerStage);
    if (this.mob && !this.mob.boss) {
      this.mob = null;
      this.spawnTimer = 0.2;
    }
    this.dirty = true;
  }

  // ---------------- Growth ----------------
  growthCost(key: GrowthKey): number {
    const def = GROWTH.find((g) => g.key === key)!;
    return def.cost(this.state.growth[key]);
  }

  buyGrowth(key: GrowthKey): boolean {
    const def = GROWTH.find((g) => g.key === key)!;
    const lvl = this.state.growth[key];
    if (lvl >= def.max) return false;
    const cost = def.cost(lvl);
    if (this.state.gold < cost) return false;
    this.state.gold -= cost;
    this.state.growth[key]++;
    this.recalc();
    return true;
  }

  // ---------------- Summoning ----------------
  private rollRarity(): Rarity {
    return weighted(RARITIES.map((r) => r.id), RARITIES.map((r) => r.weight), this.rand);
  }

  private spendGems(n: number): boolean {
    const cost = n >= 10 ? BALANCE.summon10Cost * (n / 10) : BALANCE.summonCost * n;
    if (this.state.gems < cost) return false;
    this.state.gems -= cost;
    this.state.totals.summons += n;
    return true;
  }

  summonGear(n: number): SummonResult[] | null {
    if (!this.spendGems(n)) return null;
    const out: SummonResult[] = [];
    for (let i = 0; i < n; i++) {
      const rarity = this.rollRarity();
      const slot = SLOTS[Math.floor(this.rand() * SLOTS.length)];
      const tier = weighted(TIERS, TIER_WEIGHTS, this.rand);
      const id = gearId(slot, rarity, tier);
      const owned = this.state.gear[id];
      out.push({ id, rarity, isNew: !owned });
      if (owned) owned.count++;
      else this.state.gear[id] = { count: 1, level: 0 };
    }
    this.autoEquipEmptySlots();
    this.recalc();
    return out;
  }

  summonCompanions(n: number): SummonResult[] | null {
    if (!this.spendGems(n)) return null;
    const out: SummonResult[] = [];
    for (let i = 0; i < n; i++) {
      const rarity = this.rollRarity();
      const pool = COMPANIONS.filter((c) => c.rarity === rarity);
      const c = pool[Math.floor(this.rand() * pool.length)];
      const owned = this.state.companions[c.id];
      out.push({ id: c.id, rarity, isNew: !owned });
      if (owned) owned.count++;
      else this.state.companions[c.id] = { count: 1, level: 0 };
    }
    // Fill empty party slots automatically
    for (let i = 0; i < this.state.party.length; i++) {
      if (!this.state.party[i]) {
        const best = this.bestUnpartiedCompanion();
        if (best) this.state.party[i] = best;
      }
    }
    this.recalc();
    return out;
  }

  // ---------------- Gear ----------------
  private autoEquipEmptySlots() {
    for (const slot of SLOTS) if (!this.state.equipped[slot]) this.equipBest(slot);
  }

  equipBest(slot: Slot) {
    let best: string | null = null;
    let score = -1;
    for (const [id, o] of Object.entries(this.state.gear)) {
      if (parseGear(id).slot !== slot || o.count <= 0) continue;
      const sc = gearScore(id, o.level);
      if (sc > score) {
        score = sc;
        best = id;
      }
    }
    if (best) this.state.equipped[slot] = best;
  }

  equipAllBest() {
    for (const slot of SLOTS) this.equipBest(slot);
    this.recalc();
  }

  equipGear(id: string) {
    if (!this.state.gear[id]) return;
    this.state.equipped[parseGear(id).slot] = id;
    this.recalc();
  }

  canEnhanceGear(id: string): boolean {
    const o = this.state.gear[id];
    return !!o && o.count - 1 >= enhanceCopies(o.level);
  }

  enhanceGear(id: string): boolean {
    if (!this.canEnhanceGear(id)) return false;
    const o = this.state.gear[id];
    o.count -= enhanceCopies(o.level);
    o.level++;
    this.recalc();
    return true;
  }

  enhanceAllGear(): number {
    let n = 0;
    for (const id of Object.keys(this.state.gear)) {
      while (this.canEnhanceGear(id)) {
        const o = this.state.gear[id];
        o.count -= enhanceCopies(o.level);
        o.level++;
        n++;
      }
    }
    if (n) this.recalc();
    return n;
  }

  // ---------------- Companions ----------------
  private bestUnpartiedCompanion(): string | null {
    let best: string | null = null;
    let score = -1;
    for (const [id, o] of Object.entries(this.state.companions)) {
      if (this.state.party.includes(id) || o.count <= 0) continue;
      const sc = companionHitMult(id, o.level);
      if (sc > score) {
        score = sc;
        best = id;
      }
    }
    return best;
  }

  toggleParty(id: string) {
    const p = this.state.party;
    const idx = p.indexOf(id);
    if (idx >= 0) p[idx] = null;
    else {
      const empty = p.indexOf(null);
      if (empty >= 0) p[empty] = id;
      else {
        // replace the weakest member
        let weakest = 0;
        let ws = Infinity;
        p.forEach((pid, i) => {
          const sc = pid ? companionHitMult(pid, this.state.companions[pid].level) : -1;
          if (sc < ws) {
            ws = sc;
            weakest = i;
          }
        });
        p[weakest] = id;
      }
    }
    this.recalc();
  }

  autoParty() {
    const ids = Object.entries(this.state.companions)
      .filter(([, o]) => o.count > 0)
      .sort((a, b) => companionHitMult(b[0], b[1].level) - companionHitMult(a[0], a[1].level))
      .map(([id]) => id);
    this.state.party = this.state.party.map((_, i) => ids[i] ?? null);
    this.recalc();
  }

  canEnhanceCompanion(id: string): boolean {
    const o = this.state.companions[id];
    return !!o && o.count - 1 >= enhanceCopies(o.level);
  }

  enhanceAllCompanions(): number {
    let n = 0;
    for (const id of Object.keys(this.state.companions)) {
      while (this.canEnhanceCompanion(id)) {
        const o = this.state.companions[id];
        o.count -= enhanceCopies(o.level);
        o.level++;
        n++;
      }
    }
    if (n) this.recalc();
    return n;
  }

  enhanceCompanion(id: string): boolean {
    if (!this.canEnhanceCompanion(id)) return false;
    const o = this.state.companions[id];
    o.count -= enhanceCopies(o.level);
    o.level++;
    this.recalc();
    return true;
  }

  // ---------------- Offline progress ----------------
  /** Estimated damage per second against a single target. */
  dps(): number {
    const st = this.stats;
    const critF = 1 + st.critRate * (st.critDmg - 1);
    let perSec = st.atk / BALANCE.playerAttackInterval;
    for (const sk of SKILLS) if (this.state.level >= sk.unlock) perSec += (st.atk * sk.mult) / sk.cd;
    for (const id of this.state.party) {
      if (!id) continue;
      const o = this.state.companions[id];
      if (o) perSec += (st.atk * companionHitMult(id, o.level)) / BALANCE.companionAttackInterval;
    }
    return perSec * critF;
  }

  applyOffline(seconds: number): OfflineRewards | null {
    if (seconds < BALANCE.offlineMinSeconds) return null;
    const capped = Math.min(seconds, BALANCE.offlineCapHours * 3600);
    // Farm the highest stage you can comfortably clear
    const stage = this.state.bossFailed ? this.state.stage : Math.max(1, this.state.stage);
    const m = mobFor(stage, false, this.rand);
    const killTime = Math.max(0.5, m.hp / Math.max(1, this.dps())) + BALANCE.respawnDelay;
    const kills = Math.floor((capped / killTime) * BALANCE.offlineEfficiency);
    if (kills <= 0) return null;
    const gold = kills * m.gold;
    const exp = kills * m.exp;
    const gems = Math.floor(kills * BALANCE.gemDropChance);
    this.state.gold += gold;
    this.state.gems += gems;
    this.state.totals.kills += kills;
    const levels = this.addExp(exp);
    this.dirty = true;
    return { seconds: capped, kills, gold, exp, gems, levels };
  }
}

function fmtDmg(n: number): string {
  if (n < 1e4) return Math.round(n).toLocaleString();
  const units = ['K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae'];
  let i = -1;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return n.toFixed(n >= 100 ? 0 : 1) + units[i];
}
