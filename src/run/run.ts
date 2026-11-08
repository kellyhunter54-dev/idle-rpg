// Run mode simulation: one survivors-style run on an open arena. No DOM code here, so the
// headless balance sim (tools/runsim.ts) can drive it.
import { JobId } from '../data';
import { GameMap, TILE, Tile, fits, moveCircle } from '../map';
import { JELLY, JellyFight } from './jelly';
import {
  BossDef, ELITE, ENEMIES, EnemyDef, FINAL_BOSS, HEROES, HeroDef, ITEM, ITEMS, ItemDef, PStat, RUN, RUN_RARITIES,
  ABILITY_LEVELS, ADVANCE_LEVELS, BRANCHES, BRANCH_TALENTS, CLASS_TALENTS, TALENT_LEVELS, BranchDef, CLASS_CORE, CORE_MAX, CORE_RATE, CoreDef, PASSIVE, PASSIVES, PSpecial, PassiveDef, RunRarity, SHRINE_BOONS, SHRINE_RADIUS, SHRINE_TIME, STAT_LABEL, WEAPON, WSTAT_NAME, WSTAT_STEP, WStat,
  WeaponDef, enemyHpScale, fmtStat, rollRarity, spawnRate, xpToNext,
} from './data';

export interface Enemy {
  id: number;
  def: EnemyDef | null;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  xp: number;
  color: string;
  elite: boolean;
  /** 0 normal, 1 mini boss, 2 final boss */
  /** 0 normal, 1 mini boss, 2 final boss, 3 King Jelly (lair) */
  boss: 0 | 1 | 2 | 3;
  /** height off the ground (hopping slimes) */
  z: number;
  name: string;
  slowUntil: number;
  /** Hunter's Mark */
  marked: boolean;
  /** Ignite */
  burnDps: number;
  burnUntil: number;
  /** bleed: stacks (max 5), damage per stack per second */
  bleedStacks: number;
  bleedPer: number;
  bleedUntil: number;
  /** bleed damage waiting to be shown as a number */
  bleedShow: number;
  bleedShowT: number;
  hitFlash: number;
  /** ranged shot / boss move timer */
  cd: number;
  kx: number;
  ky: number;
  dead: boolean;
  angle: number;
  moving: boolean;
  /** per-weapon re-hit timers for orbit / aura style weapons */
  touchCd: number;
  /** boss state */
  move: '' | 'charge';
  moveT: number;
  dirX: number;
  dirY: number;
  spawnT: number;
}

export interface Shot {
  kind: 'arrow' | 'bolt' | 'axe' | 'orb';
  /** a Deadeye empowered arrow */
  emp?: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  pierce: number;
  r: number;
  life: number;
  hit: Set<number>;
  /** owning weapon slot (-1 enemy, -2 item proc) */
  w: number;
  enemy: boolean;
  target: number;
  area: number;
  /** axe: distance travelled / turnaround */
  dist: number;
  back: boolean;
  range: number;
  color: string;
}

export interface Pickup {
  kind: 'xp' | 'gold' | 'heal' | 'magnet';
  x: number;
  y: number;
  value: number;
  pull: boolean;
  v: number;
}

export interface Chest {
  x: number;
  y: number;
  cost: number;
  opened: boolean;
  free: boolean;
}

export interface ShrineSpot {
  x: number;
  y: number;
  charge: number;
  used: boolean;
}

export interface Pool {
  x: number;
  y: number;
  r: number;
  dmg: number;
  until: number;
  tick: number;
  w: number;
  /** seconds between damage ticks */
  every: number;
  /** 'rain': arrows falling on the spot instead of a puddle */
  style: 'pool' | 'rain';
}

export interface Telegraph {
  x: number;
  y: number;
  r: number;
  t: number;
  dur: number;
  dmg: number;
  /** charge lane: a line from (x, y) along (dx, dy) */
  line?: { dx: number; dy: number; len: number };
  /** King Jelly telegraphs: how they look, % max HP they hit for, Slimed, goo left behind */
  style?: 'wave' | 'landing' | 'spout';
  pct?: number;
  slimed?: boolean;
  goo?: number;
  from?: { x: number; y: number };
}

export interface Fx {
  kind: 'arc' | 'ring' | 'zap' | 'boom' | 'nova' | 'text' | 'pickup' | 'land' | 'beam';
  x: number;
  y: number;
  t: number;
  dur: number;
  r: number;
  a?: number;
  color: string;
  text?: string;
  crit?: boolean;
  hits?: Set<number>;
  slow?: number;
  dmg?: number;
  w?: number;
  /** beam half width */
  width?: number;
}

/** Summoned helper (Wolf Pack). */
export interface Ally {
  w: number;
  x: number;
  y: number;
  cd: number;
  angle: number;
  moving: boolean;
}

/** A meteor on its way down. */
export interface Falling {
  x: number;
  y: number;
  t: number;
  dur: number;
  r: number;
  dmg: number;
  w: number;
}

export interface OwnedWeapon {
  def: WeaponDef;
  level: number;
  dmg: number;
  cd: number;
  count: number;
  area: number;
  pierce: number;
  speed: number;
  duration: number;
  /** attack speed bonus from upgrades (additive) */
  haste: number;
  timer: number;
  burst: number;
  burstT: number;
  burstDir: number;
  orbitUntil: number;
  orbitA: number;
  /** total damage dealt this run (end screen) */
  total: number;
}

export interface OwnedPassive {
  id: string;
  level: number;
  /** summed rarity multipliers of every pick (1 per common pick) */
  mult: number;
}

export interface Choice {
  kind: 'weapon' | 'newWeapon' | 'passive' | 'newPassive' | 'boon' | 'gold' | 'advance' | 'talent';
  id: string;
  name: string;
  icon: string;
  rarity: RunRarity;
  lines: string[];
  level: number;
  apply: () => void;
}

export interface RunStats {
  dmg: number;
  cd: number;
  speed: number;
  maxHp: number;
  pickup: number;
  xp: number;
  luck: number;
  area: number;
  count: number;
  crit: number;
  critDmg: number;
  armor: number;
  regen: number;
  curse: number;
  gold: number;
  duration: number;
  jump: number;
  pierce: number;
}

export interface RunInput {
  moveX: number;
  moveY: number;
  jump: boolean;
  interact: boolean;
}

export interface Notice {
  text: string;
  color: string;
  icon?: string;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Open arena: a ring of trees around the edge, scattered tree groves and boulders inside. */
export function generateArena(seed: number): GameMap {
  const n = RUN.arenaTiles;
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(n * n);
  const variant = new Uint8Array(n * n);
  for (let i = 0; i < variant.length; i++) variant[i] = Math.floor(rand() * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
      if (edge < 2 || (edge === 2 && rand() < 0.45)) tiles[y * n + x] = Tile.Tree;
    }
  const c = n / 2;
  for (let k = 0; k < 46; k++) {
    const gx = 5 + Math.floor(rand() * (n - 10));
    const gy = 5 + Math.floor(rand() * (n - 10));
    if (Math.hypot(gx - c, gy - c) < 7) continue;
    const rock = rand() < 0.35;
    const size = 1 + Math.floor(rand() * (rock ? 2 : 4));
    for (let i = 0; i < size; i++) {
      const x = gx + Math.floor(rand() * 3) - 1;
      const y = gy + Math.floor(rand() * 3) - 1;
      tiles[y * n + x] = rock ? Tile.Rock : Tile.Tree;
    }
  }
  return {
    w: n, h: n, tiles, variant, zoneW: n, zones: 1,
    entrances: [{ x: c * TILE, y: c * TILE }], altars: [], zoneFloor: [[]], kind: 'world', palette: 0,
  };
}

const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

export class Run {
  map: GameMap;
  hero: HeroDef;
  job: JobId;
  rand: () => number;
  t = 0;
  input: RunInput = { moveX: 0, moveY: 0, jump: false, interact: false };
  /** AUTO steering (headless sim; optional in the browser with Q) */
  auto = false;

  // hero
  x: number;
  y: number;
  r = 18;
  hp: number;
  angle = 0;
  moving = false;
  vx = 0;
  vy = 0;
  air = 0;
  airDur = 0;
  jumpCd = 0;
  /** Mana Shield */
  shield = 0;
  lastHurt = -99;
  private retaliateCd = 0;
  private volleyN = 0;
  iframes = 0;
  hurtFlash = 0;
  level = 1;
  xp = 0;
  xpNeed = xpToNext(1);
  gold = 0;
  kills = 0;
  rerolls = RUN.rerolls;
  revives = 0;

  stats!: RunStats;
  /** slot 0 is the auto attack, then the base abilities in unlock order */
  weapons: OwnedWeapon[] = [];
  /** abilities replaced by a job advancement (end screen) */
  retired: OwnedWeapon[] = [];
  passives: OwnedPassive[] = [];
  /** job advancement: chosen branch and how many tiers are unlocked (0-3) */
  branch: BranchDef | null = null;
  tier = 0;
  allies: Ally[] = [];
  falling: Falling[] = [];
  private leechLeft = 0;
  private leechT = 0;
  rampage = 0;
  // ---- the lair (King Jelly): the door is on the map from the start; go in whenever you're ready
  lairDoor = { x: 0, y: 0 };
  lairCleared = false;
  inLair = false;
  jelly: JellyFight | null = null;
  /** seconds spent in the lair: the run clock is paused in there */
  lairSpent = 0;
  private world: {
    map: GameMap; enemies: Enemy[]; pickups: Pickup[]; chests: Chest[]; shrines: ShrineSpot[]; boss: Enemy | null; x: number; y: number;
  } | null = null;
  /** hero status from the jelly: rooted (can't move) and slowed */
  rootUntil = 0;
  slowedUntil = 0;
  /** class resource (Rage / Focus / Mana ...) and the ultimate it powers (F) */
  coreMeter = 0;
  coreActive = false;
  coreUntil = 0;
  /** use the ultimate as soon as it's ready */
  autoCore = false;
  private coreBudget = 0;
  private coreBudgetT = 0;
  private coreTick = 0;
  /** extra wolves from Call of the Pack */
  private coreWolves = 0;
  /** talent choices made (levels in TALENT_LEVELS) */
  talentsTaken = 0;
  /** total bleed damage (end screen) */
  bleedTotal = 0;
  private lastCrit = false;
  private rampageUntil = 0;
  private combustDepth = 0;
  /** special passive amounts, rebuilt in recalc() */
  special: Partial<Record<PSpecial, number>> = {};
  items: ItemDef[] = [];
  boons: { stat: PStat; amount: number }[] = [];

  enemies: Enemy[] = [];
  shots: Shot[] = [];
  pickups: Pickup[] = [];
  chests: Chest[] = [];
  shrines: ShrineSpot[] = [];
  pools: Pool[] = [];
  telegraphs: Telegraph[] = [];
  fx: Fx[] = [];
  notices: Notice[] = [];

  choices: Choice[] | null = null;
  choiceTitle = '';
  pendingLevels = 0;
  ended: '' | 'win' | 'dead' = '';
  bossSpawned = [false, false];
  boss: Enemy | null = null;
  chestsOpened = 0;

  private nextId = 1;
  private spawnAcc = 0;
  private eliteT = ELITE.every;
  private swarmT = 120;
  private stormT = 4;
  private grid = new Map<number, Enemy[]>();
  private gridPool: Enemy[][] = [];
  private readonly cell = 128;
  readonly arenaSize: number;

  constructor(job: JobId, seed = Math.floor(Math.random() * 1e9), rand: () => number = Math.random) {
    this.job = job;
    this.hero = HEROES[job];
    this.rand = rand;
    this.map = generateArena(seed);
    this.arenaSize = this.map.w * TILE;
    this.x = this.map.entrances[0].x;
    this.y = this.map.entrances[0].y;
    this.recalc();
    this.hp = this.stats.maxHp;
    this.addWeapon(this.hero.basic);
    this.placeObjects();
  }

  // ---------------------------------------------------------------- setup
  private openSpot(minFromCentre: number, avoid: { x: number; y: number }[], gap: number): { x: number; y: number } {
    const c = this.arenaSize / 2;
    for (let tries = 0; tries < 400; tries++) {
      const x = TILE * 4 + this.rand() * (this.arenaSize - TILE * 8);
      const y = TILE * 4 + this.rand() * (this.arenaSize - TILE * 8);
      if (Math.hypot(x - c, y - c) < minFromCentre) continue;
      if (!fits(this.map, x, y, 40)) continue;
      if (avoid.some((a) => dist2(a.x, a.y, x, y) < gap * gap)) continue;
      return { x, y };
    }
    return { x: c + 300, y: c };
  }

  private placeObjects() {
    const taken: { x: number; y: number }[] = [];
    this.lairDoor = this.openSpot(900, taken, 0);
    taken.push(this.lairDoor);
    for (let i = 0; i < RUN.shrines; i++) {
      const p = this.openSpot(500, taken, 900);
      taken.push(p);
      this.shrines.push({ ...p, charge: 0, used: false });
    }
    for (let i = 0; i < RUN.chests; i++) {
      const p = this.openSpot(250, taken, 420);
      taken.push(p);
      this.chests.push({ ...p, cost: 0, opened: false, free: false });
    }
  }

  get chestCost(): number {
    return Math.round(RUN.chestCost * Math.pow(RUN.chestCostGrowth, this.chestsOpened));
  }
  /** run clock: time outside the lair */
  get runT(): number {
    return this.t - this.lairSpent;
  }
  get timeLeft(): number {
    return Math.max(0, RUN.length - this.runT);
  }
  get overtime(): number {
    return Math.max(0, this.runT - RUN.length);
  }

  // ---------------------------------------------------------------- stats
  recalc() {
    const s: RunStats = {
      dmg: 0, cd: 0, speed: 0, maxHp: this.hero.hp, pickup: 0, xp: 0, luck: 0, area: 0, count: 0,
      crit: 0.05, critDmg: 0.8, armor: 0, regen: 0, curse: 0, gold: 0, duration: 0, jump: 0, pierce: 0,
    };
    const add = (stat: PStat, v: number) => {
      (s as unknown as Record<string, number>)[stat] += v;
    };
    for (const [k, v] of Object.entries(this.hero.stats)) add(k as PStat, v!);
    const sp: Partial<Record<PSpecial, number>> = {};
    for (const p of this.passives) {
      const d = PASSIVE[p.id];
      for (const [k, v] of Object.entries(d.stats ?? {})) add(k as PStat, v! * p.mult);
      if (d.special) sp[d.special] = (sp[d.special] ?? 0) + d.step! * p.mult;
      for (const [k, v] of d.extra ?? []) sp[k] = (sp[k] ?? 0) + v * p.mult;
    }
    this.special = sp;
    if (!this.coreActive) this.coreWolves = sp.eternalPack ?? 0;
    for (const it of this.items) for (const [k, v] of Object.entries(it.stats ?? {})) add(k as PStat, v!);
    for (const b of this.boons) add(b.stat, b.amount);
    s.armor = Math.min(0.7, s.armor);
    const oldMax = this.stats?.maxHp ?? s.maxHp;
    this.stats = s;
    if (this.hp !== undefined && s.maxHp > oldMax) this.hp += s.maxHp - oldMax;
    if (this.hp > s.maxHp) this.hp = s.maxHp;
  }

  get moveSpeed(): number {
    return this.hero.speed * (1 + this.stats.speed) * (this.slowedUntil > this.t ? 0.5 : 1);
  }
  rootFor(s: number) {
    if (this.air > 0) return;
    this.rootUntil = Math.max(this.rootUntil, this.t + s);
  }
  slowFor(s: number) {
    this.slowedUntil = Math.max(this.slowedUntil, this.t + s);
  }
  get pickupRange(): number {
    return 110 * (1 + this.stats.pickup);
  }
  hasProc(p: ItemDef['proc']): boolean {
    return this.items.some((i) => i.proc === p);
  }

  // ---------------------------------------------------------------- loadout
  addWeapon(id: string) {
    const d = WEAPON[id];
    this.weapons.push({
      def: d, level: 1, dmg: d.dmg, cd: d.cd, count: d.count, area: d.area, pierce: d.pierce, speed: d.speed, duration: d.duration,
      haste: 0, timer: 0.3, burst: 0, burstT: 0, burstDir: 0, orbitUntil: 0, orbitA: 0, total: 0,
    });
  }

  /** Applies one weapon upgrade (stat list rolled up front so the card can show it). */
  private weaponUpgrade(w: OwnedWeapon, stats: WStat[], rar: RunRarity) {
    for (const st of stats) {
      const step = WSTAT_STEP[st] * rar.mult;
      if (st === 'count' || st === 'pierce') w[st] += rar.mult >= 1.9 ? 2 : 1;
      else if (st === 'cd') w.haste += step;
      else if (st === 'area') w.area += step;
      else w[st] += w.def[st] * step;
    }
    w.level++;
  }
  private upgradeLines(stats: WStat[], rar: RunRarity): string[] {
    return stats.map((st) => {
      if (st === 'count' || st === 'pierce') return `+${rar.mult >= 1.9 ? 2 : 1} ${WSTAT_NAME[st]}`;
      return `+${Math.round(WSTAT_STEP[st] * rar.mult * 100)}% ${WSTAT_NAME[st]}`;
    });
  }

  private pickStats(w: OwnedWeapon, n: number): WStat[] {
    const pool = [...w.def.ups];
    const out: WStat[] = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    return out;
  }

  /** Class passives plus the ones your job advancements have unlocked. */
  passivePool(): PassiveDef[] {
    const out = [...PASSIVES[this.job]];
    if (this.branch) for (let i = 0; i < this.tier; i++) out.push(...this.branch.tiers[i].passives);
    return out;
  }
  /** Current job title. */
  get title(): string {
    return this.branch && this.tier > 0 ? this.branch.tiers[this.tier - 1].title : this.hero.name;
  }

  /** Level 7 / 13 / 20 / 30 / 40: pick one of two talents (13+ need a job). */
  private checkTalent(): boolean {
    const k = this.talentsTaken;
    if (k >= TALENT_LEVELS.length || this.level < TALENT_LEVELS[k]) return false;
    const pair = k === 0 ? CLASS_TALENTS[this.job] : this.branch ? BRANCH_TALENTS[this.branch.id]?.[k - 1] : undefined;
    if (!pair) return false;
    this.choiceTitle = k === TALENT_LEVELS.length - 1 ? 'Keystone talent' : 'Talent';
    this.choices = pair.map((d) => ({
      kind: 'talent', id: d.id, name: d.name, icon: d.icon, rarity: { ...RUN_RARITIES[3], name: `Lv ${TALENT_LEVELS[k]} talent`, color: this.branch?.color ?? '#b388ff' }, level: 0,
      lines: [d.desc ?? ''],
      apply: () => {
        this.talentsTaken++;
        this.passives.push({ id: d.id, level: 1, mult: 1 });
        this.recalc();
      },
    }));
    return true;
  }

  /** Base abilities unlock on their own at ABILITY_LEVELS. */
  private checkUnlocks() {
    const have = this.weapons.length - 1;
    for (let k = have; k < ABILITY_LEVELS.length && this.level >= ABILITY_LEVELS[k]; k++) {
      const d = WEAPON[this.hero.abilities[k]];
      this.addWeapon(d.id);
      this.notice(`New ability: ${d.name}`, '#ffd166', d.icon);
    }
  }

  /** A job advancement swaps an ability for its new form, keeping the upgrades you put into it. */
  private replaceWeapon(from: string, to: string) {
    const i = this.weapons.findIndex((w) => w.def.id === from);
    const nd = WEAPON[to];
    if (i < 0) {
      this.addWeapon(to);
      return;
    }
    const o = this.weapons[i];
    const od = o.def;
    const ratio = (cur: number, base: number) => (base > 0 ? cur / base : 1);
    this.weapons[i] = {
      def: nd, level: o.level,
      dmg: nd.dmg * ratio(o.dmg, od.dmg),
      cd: nd.cd,
      count: Math.max(1, nd.count + (o.count - od.count)),
      area: nd.area + (o.area - od.area),
      pierce: nd.pierce + (o.pierce - od.pierce),
      speed: nd.speed * ratio(o.speed, od.speed),
      duration: nd.duration * ratio(o.duration, od.duration),
      haste: o.haste, timer: 0.4, burst: 0, burstT: 0, burstDir: 0, orbitUntil: 0, orbitA: 0, total: 0,
    };
    this.retired.push(o);
    this.allies = this.allies.filter((a) => a.w !== i);
  }

  /** Level 10: pick a branch. Level 15 / 25: the next tier of it. */
  private checkAdvance(): boolean {
    if (!this.branch) {
      if (this.level < ADVANCE_LEVELS[0]) return false;
      this.choiceTitle = 'Job advancement';
      this.choices = BRANCHES[this.job].map((b) => ({
        kind: 'advance', id: b.id, name: b.name, icon: b.icon, rarity: { ...RUN_RARITIES[3], color: b.color, name: 'Job' }, level: 0,
        lines: [b.desc, `Ultimate: ${b.core.icon} ${b.core.name} (${b.core.resource})`, ...b.tiers.map((t, i) => `Lv ${ADVANCE_LEVELS[i]} ${t.title}: ${t.swaps.map(([, to]) => `${WEAPON[to].icon} ${WEAPON[to].name}`).join(', ')}`)],
        apply: () => {
          this.branch = b;
          this.advance();
        },
      }));
      return true;
    }
    if (this.tier >= 3 || this.level < ADVANCE_LEVELS[this.tier]) return false;
    const t = this.branch.tiers[this.tier];
    this.choiceTitle = 'Job advancement';
    this.choices = [{
      kind: 'advance', id: this.branch.id, name: t.title, icon: this.branch.icon, rarity: { ...RUN_RARITIES[4], color: this.branch.color, name: `Tier ${this.tier + 1}` }, level: 0,
      lines: [...t.swaps.map(([from, to]) => `${WEAPON[from].name} becomes ${WEAPON[to].icon} ${WEAPON[to].name}`), `New passives: ${t.passives.map((p) => p.name).join(', ')}`],
      apply: () => this.advance(),
    }];
    return true;
  }
  private advance() {
    const t = this.branch!.tiers[this.tier];
    this.tier++;
    for (const [from, to] of t.swaps) this.replaceWeapon(from, to);
    this.notice(`You are now a ${t.title}!`, this.branch!.color, this.branch!.icon);
  }

  /** Card text for one pick of a passive at a rarity multiplier. */
  passiveLines(d: PassiveDef, mult: number): string[] {
    if (d.desc) return [d.desc];
    const out = Object.entries(d.stats ?? {}).map(([k, v]) => `${fmtStat(k as PStat, v! * mult)} ${STAT_LABEL[k as PStat]}`);
    if (d.special && d.text) out.push(d.text(d.step! * mult));
    return out;
  }
  /** Tooltip for an owned passive (its total). */
  passiveTotal(p: OwnedPassive): string {
    return this.passiveLines(PASSIVE[p.id], p.mult).join(', ');
  }
  sp(k: PSpecial): number {
    return this.special[k] ?? 0;
  }

  /** Builds the three level-up cards. */
  makeLevelChoices(): Choice[] {
    type Cand = { w: number; make: () => Choice };
    const cands: Cand[] = [];
    const luck = this.stats.luck;
    for (const w of this.weapons) {
      cands.push({
        w: 3,
        make: () => {
          const rar = rollRarity(luck, this.rand);
          const st = this.pickStats(w, rar.mult >= 2.4 ? 3 : 2);
          return { kind: 'weapon', id: w.def.id, name: w.def.name, icon: w.def.icon, rarity: rar, level: w.level + 1, lines: this.upgradeLines(st, rar), apply: () => this.weaponUpgrade(w, st, rar) };
        },
      });
    }
    const pick = (d: PassiveDef, owned: OwnedPassive | undefined): Choice => {
      const rar = d.flat ? RUN_RARITIES[0] : rollRarity(luck, this.rand);
      const lines = this.passiveLines(d, rar.mult);
      return {
        kind: owned ? 'passive' : 'newPassive', id: d.id, name: d.name, icon: d.icon, rarity: rar, level: (owned?.level ?? 0) + 1,
        lines: owned ? lines : ['New passive', ...lines],
        apply: () => {
          if (owned) {
            owned.level++;
            owned.mult += rar.mult;
          } else this.passives.push({ id: d.id, level: 1, mult: rar.mult });
          this.recalc();
        },
      };
    };
    for (const d of this.passivePool()) {
      const owned = this.passives.find((p) => p.id === d.id);
      if (owned && owned.level >= d.max) continue;
      cands.push({ w: owned ? 2.2 : 1.6, make: () => pick(d, owned) });
    }
    const out: Choice[] = [];
    while (out.length < 3 && cands.length) {
      let tot = cands.reduce((a, c) => a + c.w, 0) * this.rand();
      let i = 0;
      for (; i < cands.length - 1; i++) {
        tot -= cands[i].w;
        if (tot <= 0) break;
      }
      out.push(cands.splice(i, 1)[0].make());
    }
    if (!out.length) {
      const g = 25 + this.level * 2;
      out.push({ kind: 'gold', id: 'gold', name: 'Pouch of gold', icon: '🪙', rarity: RUN_RARITIES[0], level: 0, lines: [`+${g} gold`, 'Heal 30 HP'], apply: () => { this.gold += g; this.heal(30); } });
    }
    return out;
  }

  private makeShrineChoices(): Choice[] {
    const pool = [...SHRINE_BOONS];
    const out: Choice[] = [];
    while (out.length < 3) {
      const b = pool.splice(Math.floor(this.rand() * pool.length), 1)[0];
      const rar = rollRarity(this.stats.luck + 20, this.rand, 1);
      const amt = b.amount * rar.mult;
      out.push({ kind: 'boon', id: b.id, name: `Boon of ${b.name}`, icon: '✨', rarity: rar, level: 0, lines: [`${fmtStat(b.stat, amt)} ${STAT_LABEL[b.stat]}`, 'Permanent for this run'], apply: () => { this.boons.push({ stat: b.stat, amount: amt }); this.recalc(); } });
    }
    return out;
  }

  pick(i: number) {
    if (!this.choices) return;
    const c = this.choices[i];
    if (!c) return;
    c.apply();
    this.choices = null;
    this.checkUnlocks();
    if (!this.checkAdvance() && !this.checkTalent() && this.pendingLevels > 0) this.openLevelUp();
  }
  reroll(): boolean {
    if (!this.choices || this.rerolls <= 0 || this.choiceTitle !== 'Level up!') return false;
    this.rerolls--;
    this.choices = this.makeLevelChoices();
    return true;
  }
  skip() {
    if (!this.choices) return;
    this.choices = null;
    this.gold += 5;
    if (this.pendingLevels > 0) this.openLevelUp();
  }
  private openLevelUp() {
    this.pendingLevels--;
    this.choiceTitle = 'Level up!';
    this.choices = this.makeLevelChoices();
  }

  // ---------------------------------------------------------------- main update
  update(dt: number) {
    if (this.ended || this.choices) return;
    this.t += dt;
    if (this.auto) this.autoSteer();
    this.updateHero(dt);
    if (this.inLair) this.lairSpent += dt;
    else this.spawn(dt);
    this.rebuildGrid();
    this.updateEnemies(dt);
    if (this.inLair && this.jelly && !this.jelly.done) this.jelly.update(dt);
    this.updateWeapons(dt);
    this.updateShots(dt);
    this.updatePools(dt);
    this.updateCore(dt);
    this.updateFalling(dt);
    this.updateAllies(dt);
    this.updateTelegraphs(dt);
    this.updatePickups(dt);
    this.updateObjects(dt);
    this.updateFx(dt);
    this.input.jump = false;
    this.input.interact = false;
    if (this.hp <= 0) this.die();
    this.checkUnlocks();
    if (!this.choices && !this.checkAdvance() && !this.checkTalent() && this.pendingLevels > 0) this.openLevelUp();
  }

  notice(text: string, color = '#ffd166', icon?: string) {
    this.notices.push({ text, color, icon });
  }

  private die() {
    if (this.hasProc('revive') && this.revives < 1) {
      this.revives++;
      this.hp = this.stats.maxHp;
      this.iframes = 2;
      this.fx.push({ kind: 'nova', x: this.x, y: this.y, t: 0, dur: 0.6, r: 420, color: '#ffd166', hits: new Set(), dmg: 0, slow: 0 });
      // the blast clears the space around you
      for (const e of this.enemies) if (!e.boss && dist2(e.x, e.y, this.x, this.y) < 420 * 420) this.hitEnemy(e, 99999, -2, false);
      this.notice('Phoenix Plume: back from the brink!', '#ffd166', '🔆');
      return;
    }
    this.hp = 0;
    this.ended = 'dead';
  }

  heal(n: number) {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  private updateHero(dt: number) {
    const inp = this.input;
    let mx = inp.moveX;
    let my = inp.moveY;
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    this.moving = l > 0.05;
    const sp = this.moveSpeed;
    this.vx = mx * sp;
    this.vy = my * sp;
    if (this.moving) this.angle = Math.atan2(my, mx);
    const rooted = this.rootUntil > this.t;
    if (!rooted) {
      const p = moveCircle(this.map, this.x, this.y, this.vx * dt, this.vy * dt, this.r);
      this.x = p.x;
      this.y = p.y;
    } else this.moving = false;
    // jump
    this.jumpCd -= dt;
    if (this.air > 0) {
      this.air -= dt;
      if (this.air <= 0) {
        this.air = 0;
        this.jumpCd = RUN.jumpRest;
        this.fx.push({ kind: 'land', x: this.x, y: this.y, t: 0, dur: 0.3, r: 30, color: '#e8d7a9' });
      }
    } else if (inp.jump && this.jumpCd <= 0 && !rooted) {
      this.airDur = RUN.jumpTime * (1 + this.stats.jump);
      this.air = this.airDur;
    }
    this.iframes -= dt;
    this.hurtFlash -= dt;
    if (this.stats.regen > 0) this.heal(this.stats.regen * dt);
    const smax = this.sp('shield');
    if (smax > 0 && this.t - this.lastHurt > 3) this.shield = Math.min(smax, this.shield + smax * 0.3 * dt);
    this.retaliateCd -= dt;
  }

  /** Height of the hero's jump (world units), for the renderer. */
  get jumpZ(): number {
    if (this.air <= 0) return 0;
    const k = 1 - this.air / this.airDur;
    return Math.sin(Math.PI * k) * 70;
  }

  /** damage taken by source (sim / end screen) */
  taken = { contact: 0, shot: 0, slam: 0 };
  /** Returns true if the hit landed (not dodged, blocked or shielded away). */
  hurt(dmg: number, from?: Enemy, src: 'contact' | 'shot' | 'slam' = 'contact'): boolean {
    if (this.iframes > 0 || this.ended) return false;
    if (this.coreActive && this.core.id === 'divine') {
      this.iframes = RUN.contactIframes;
      return false;
    }
    const cg = this.core.gain;
    if (cg.hurt) this.addCore(cg.hurt * Math.max(1, (dmg / this.stats.maxHp) * 20), true);
    const block = this.sp('block');
    if (block && this.rand() < Math.min(0.6, block)) {
      this.iframes = RUN.contactIframes;
      this.fx.push({ kind: 'text', x: this.x, y: this.y, t: 0, dur: 0.6, r: 0, color: '#9fb4d0', text: 'Block' });
      return false;
    }
    let d = dmg * (1 - this.stats.armor);
    this.lastHurt = this.t;
    if (this.shield > 0) {
      const soak = Math.min(this.shield, d);
      this.shield -= soak;
      d -= soak;
    }
    this.hp -= d;
    this.taken[src] += d;
    this.iframes = RUN.contactIframes;
    this.hurtFlash = d > 0 ? 0.25 : 0;
    if (from && this.hasProc('thorns')) this.hitEnemy(from, 40, -2, false);
    const ret = this.sp('retaliate');
    if (ret > 0 && this.retaliateCd <= 0 && this.weapons[0]) {
      this.retaliateCd = 1;
      const R = 190 * (1 + this.stats.area);
      const rd = this.weaponStats(this.weapons[0]).dmg * ret * 2;
      this.fx.push({ kind: 'nova', x: this.x, y: this.y, t: 0, dur: 0.35, r: R, color: '#ff8a5c' });
      this.forEnemiesIn(this.x, this.y, R, (e) => this.hitEnemy(e, rd, -2, true, 420));
    }
    return d > 0;
  }

  // ---------------------------------------------------------------- spawning
  private spawnPoint(r: number): { x: number; y: number } | null {
    for (let i = 0; i < 12; i++) {
      // a bit ahead of where the hero is running, so the field in front never empties out
      let a = this.rand() * Math.PI * 2;
      if (this.moving && this.rand() < 0.4) a = this.angle + (this.rand() - 0.5) * 1.6;
      const d = RUN.spawnMin + this.rand() * (RUN.spawnMax - RUN.spawnMin);
      const x = this.x + Math.cos(a) * d;
      const y = this.y + Math.sin(a) * d;
      if (x < TILE * 3 || y < TILE * 3 || x > this.arenaSize - TILE * 3 || y > this.arenaSize - TILE * 3) continue;
      if (!fits(this.map, x, y, r)) continue;
      return { x, y };
    }
    return null;
  }

  private makeEnemy(def: EnemyDef, x: number, y: number, elite = false): Enemy {
    const curse = this.stats.curse;
    const hpScale = enemyHpScale(this.runT) * (1 + curse * 0.6) * (1 + this.overtime * RUN.overtimeHp);
    const r = elite ? def.r * ELITE.rMult : def.r;
    const hp = def.hp * hpScale * (elite ? ELITE.hpMult : 1);
    return {
      id: this.nextId++, def, x, y, r, hp, maxHp: hp, speed: def.speed * (elite ? 0.9 : 1) * (0.92 + this.rand() * 0.16),
      dmg: def.dmg * (1 + this.runT / 600) * (elite ? ELITE.dmgMult : 1), xp: def.xp * (elite ? ELITE.xpMult : 1),
      color: elite ? ELITE.color : def.color, elite, boss: 0, name: '', slowUntil: 0, hitFlash: 0, cd: 1 + this.rand() * 2,
      kx: 0, ky: 0, dead: false, angle: 0, moving: true, touchCd: 0, move: '', moveT: 0, dirX: 0, dirY: 0, spawnT: 0.35, z: 0, marked: false, burnDps: 0, burnUntil: 0, bleedStacks: 0, bleedPer: 0, bleedUntil: 0, bleedShow: 0, bleedShowT: 0,
    };
  }

  private pickEnemyDef(): EnemyDef {
    const m = this.runT / 60;
    const pool = ENEMIES.filter((e) => e.from <= m);
    let tot = pool.reduce((a, e) => a + e.weight, 0) * this.rand();
    for (const e of pool) {
      tot -= e.weight;
      if (tot <= 0) return e;
    }
    return pool[0];
  }

  private spawn(dt: number) {
    const bossAlive = !!this.boss && !this.boss.dead;
    this.spawnAcc += spawnRate(Math.min(this.runT, RUN.length)) * (1 + this.stats.curse) * (bossAlive ? 0.55 : 1) * (1 + this.overtime / 60) * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc--;
      if (this.enemies.length >= RUN.maxEnemies) continue;
      const def = this.pickEnemyDef();
      const p = this.spawnPoint(def.r);
      if (p) this.enemies.push(this.makeEnemy(def, p.x, p.y));
    }
    this.eliteT -= dt;
    if (this.eliteT <= 0) {
      this.eliteT = ELITE.every;
      const def = this.pickEnemyDef();
      const p = this.spawnPoint(def.r * ELITE.rMult);
      if (p) {
        this.enemies.push(this.makeEnemy(def, p.x, p.y, true));
        this.notice('An elite has appeared. It carries a chest!', '#e0b84a', '⭐');
      }
    }
    // swarms: a ring of slimes closing in every two minutes
    this.swarmT -= dt;
    if (this.swarmT <= 0 && this.runT < RUN.length) {
      this.swarmT = 120;
      const n = 36 + Math.floor(this.t / 60) * 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = this.x + Math.cos(a) * 620;
        const y = this.y + Math.sin(a) * 620;
        if (fits(this.map, x, y, 20) && x > TILE * 3 && y > TILE * 3 && x < this.arenaSize - TILE * 3 && y < this.arenaSize - TILE * 3)
          this.enemies.push(this.makeEnemy(ENEMIES[0], x, y));
      }
      this.notice('A swarm closes in! Jump over them (Space).', '#ff8c42', '🌊');
    }
    if (!this.bossSpawned[0] && this.runT >= RUN.miniBossAt) {
      this.bossSpawned[0] = true;
      if (!this.lairCleared) this.notice('King Jelly grows restless. Its lair is marked on your map.', '#6ccf5a', '👑');
    }
    if (!this.bossSpawned[1] && this.runT >= RUN.length) {
      this.bossSpawned[1] = true;
      this.spawnBoss(FINAL_BOSS, 2);
    }
  }

  private spawnBoss(def: BossDef, tier: 1 | 2) {
    let p = this.spawnPoint(def.r * 0.8);
    for (let i = 0; i < 20 && !p; i++) p = this.spawnPoint(def.r * 0.8);
    if (!p) p = { x: this.arenaSize / 2, y: this.arenaSize / 2 };
    const hp = def.hp * (1 + this.stats.curse * 0.6);
    const e: Enemy = {
      id: this.nextId++, def: null, x: p.x, y: p.y, r: def.r, hp, maxHp: hp, speed: def.speed, dmg: def.dmg, xp: tier === 1 ? 120 : 400,
      color: def.color, elite: false, boss: tier, name: def.name, slowUntil: 0, hitFlash: 0, cd: 2.5, kx: 0, ky: 0, dead: false,
      angle: 0, moving: true, touchCd: 0, move: '', moveT: 0, dirX: 0, dirY: 0, spawnT: 0.6, z: 0, marked: false, burnDps: 0, burnUntil: 0, bleedStacks: 0, bleedPer: 0, bleedUntil: 0, bleedShow: 0, bleedShowT: 0,
    };
    this.enemies.push(e);
    this.boss = e;
    this.notice(tier === 1 ? `${def.name} has come for you!` : `Time is up. ${def.name} rises!`, '#ff5c5c', '👑');
  }

  // ---------------------------------------------------------------- spatial grid
  private key(cx: number, cy: number) {
    return cy * 1024 + cx;
  }
  private rebuildGrid() {
    for (const list of this.grid.values()) {
      list.length = 0;
      this.gridPool.push(list);
    }
    this.grid.clear();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const k = this.key(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell));
      let l = this.grid.get(k);
      if (!l) {
        l = this.gridPool.pop() ?? [];
        this.grid.set(k, l);
      }
      l.push(e);
    }
  }
  /** Calls fn for every live enemy whose body touches the circle (x, y, r). */
  forEnemiesIn(x: number, y: number, r: number, fn: (e: Enemy) => void) {
    const pad = r + 100;
    const x0 = Math.floor((x - pad) / this.cell);
    const x1 = Math.floor((x + pad) / this.cell);
    const y0 = Math.floor((y - pad) / this.cell);
    const y1 = Math.floor((y + pad) / this.cell);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const l = this.grid.get(this.key(cx, cy));
        if (!l) continue;
        for (const e of l) {
          if (e.dead) continue;
          const rr = r + e.r;
          if (dist2(e.x, e.y, x, y) <= rr * rr) fn(e);
        }
      }
  }
  nearest(x: number, y: number, maxR: number, skip?: Set<number>): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxR * maxR;
    this.forEnemiesIn(x, y, maxR, (e) => {
      if (skip?.has(e.id) || e.spawnT > 0.2) return;
      const d = dist2(e.x, e.y, x, y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    });
    const found = best as Enemy | null;
    if (!found && this.boss && !this.boss.dead && dist2(this.boss.x, this.boss.y, x, y) < maxR * maxR * 1.5) return this.boss;
    return found;
  }
  private randomNear(x: number, y: number, maxR: number): Enemy | null {
    const list: Enemy[] = [];
    this.forEnemiesIn(x, y, maxR, (e) => list.push(e));
    return list.length ? list[Math.floor(this.rand() * list.length)] : null;
  }

  // ---------------------------------------------------------------- enemies
  private updateEnemies(dt: number) {
    let bleeding = 0;
    this.updateEnemiesInner(dt, () => bleeding++);
    // Second Wind / Bloodscent: bleeding foes near you heal you (up to 10 of them)
    const bh = this.sp('bleedHeal');
    if (bh && bleeding) this.heal(bh * Math.min(10, bleeding) * dt);
  }
  private updateEnemiesInner(dt: number, onBleed: () => void) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.hitFlash -= dt;
      e.touchCd -= dt;
      if (e.bleedUntil > this.t && e.bleedStacks > 0 && !e.dead) {
        const b = e.bleedPer * e.bleedStacks * dt;
        this.bleedTotal += b;
        e.bleedShow += b;
        if (this.t >= e.bleedShowT) {
          e.bleedShowT = this.t + 0.5;
          if (e.bleedShow >= 1 && this.fx.length < 240)
            this.fx.push({ kind: 'text', x: e.x + (this.rand() - 0.5) * 24, y: e.y, t: 0, dur: 0.7, r: 0, color: '#ff4d4d', text: String(Math.round(e.bleedShow)) });
          e.bleedShow = 0;
        }
        if (dist2(e.x, e.y, this.x, this.y) < 600 * 600) onBleed();
        if (e.boss === 3 && this.jelly) this.jelly.damage(b);
        else {
          e.hp -= b;
          if (e.hp <= 0) {
            this.kill(e);
            continue;
          }
        }
      }
      if (e.burnUntil > this.t && !e.dead && e.boss === 3 && this.jelly) {
        this.jelly.damage(e.burnDps * dt);
      } else if (e.burnUntil > this.t && !e.dead) {
        const b = e.burnDps * dt;
        e.hp -= b;
        const wi = this.weapons.findIndex((x) => x.def.id === 'ember');
        if (wi >= 0) this.weapons[wi].total += b;
        if (e.hp <= 0) {
          this.kill(e);
          continue;
        }
      }
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        continue;
      }
      if (e.boss === 3) continue; // King Jelly's slimes move in jelly.ts
      if (e.boss) {
        this.updateBoss(e, dt);
        continue;
      }
      let dx = this.x - e.x;
      let dy = this.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      // fell too far behind: move back into the ring around the hero
      if (d > RUN.leash) {
        const p = this.spawnPoint(e.r);
        if (p) {
          e.x = p.x;
          e.y = p.y;
        }
        continue;
      }
      dx /= d;
      dy /= d;
      const slow = e.slowUntil > this.t ? 0.55 : 1;
      let sp = e.speed * slow;
      if (e.def?.ranged) {
        if (d < 360) sp *= d < 260 ? -0.7 : 0;
        e.cd -= dt;
        if (e.cd <= 0 && d < 560) {
          e.cd = 3.2;
          this.enemyShot(e.x, e.y, dx, dy, 250, e.dmg, '#c77dff');
        }
      }
      // separation from neighbours (only a few, cheap)
      let sx = 0;
      let sy = 0;
      let n = 0;
      const l = this.grid.get(this.key(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell)));
      if (l)
        for (const o of l) {
          if (o === e || n > 6) continue;
          const ox = e.x - o.x;
          const oy = e.y - o.y;
          const rr = e.r + o.r;
          const dd = ox * ox + oy * oy;
          if (dd < rr * rr && dd > 0.01) {
            const q = Math.sqrt(dd);
            sx += (ox / q) * (rr - q);
            sy += (oy / q) * (rr - q);
            n++;
          }
        }
      const mvx = dx * sp * dt + sx * 0.25 + e.kx * dt;
      const mvy = dy * sp * dt + sy * 0.25 + e.ky * dt;
      e.kx *= Math.pow(0.02, dt);
      e.ky *= Math.pow(0.02, dt);
      const p = moveCircle(this.map, e.x, e.y, mvx, mvy, e.r * 0.8, true);
      // stuck on a tree: try sliding sideways
      if (p.x === e.x && p.y === e.y) {
        const side = (e.id & 1 ? 1 : -1) * sp * dt;
        const q = moveCircle(this.map, e.x, e.y, -dy * side, dx * side, e.r * 0.8, true);
        e.x = q.x;
        e.y = q.y;
      } else {
        e.x = p.x;
        e.y = p.y;
      }
      e.angle = Math.atan2(dy, dx);
      // contact
      if (this.air <= 0) {
        const rr = e.r * 0.85 + this.r;
        if (dist2(e.x, e.y, this.x, this.y) < rr * rr) this.hurt(e.dmg, e);
      }
    }
  }

  private enemyShot(x: number, y: number, dx: number, dy: number, speed: number, dmg: number, color: string, r = 12) {
    this.shots.push({
      kind: 'orb', x, y, vx: dx * speed, vy: dy * speed, dmg, pierce: 0, r, life: 4, hit: new Set(), w: -1, enemy: true, target: 0,
      area: 1, dist: 0, back: false, range: 0, color,
    });
  }

  private updateBoss(e: Enemy, dt: number) {
    const dx = this.x - e.x;
    const dy = this.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.angle = Math.atan2(dy, dx);
    const enraged = e.hp < e.maxHp * 0.5;
    if (e.move === 'charge') {
      e.moveT -= dt;
      if (e.moveT < 0.55) {
        // dash along the telegraphed lane
        const sp = 1150 * dt;
        const p = moveCircle(this.map, e.x, e.y, e.dirX * sp, e.dirY * sp, e.r * 0.7, true);
        e.x = p.x;
        e.y = p.y;
      }
      if (e.moveT <= 0) e.move = '';
    } else {
      const slow = e.slowUntil > this.t ? 0.75 : 1;
      const sp = e.speed * slow * (enraged ? 1.2 : 1) * dt;
      const p = moveCircle(this.map, e.x, e.y, (dx / d) * sp, (dy / d) * sp, e.r * 0.7, true);
      e.x = p.x;
      e.y = p.y;
      e.cd -= dt * (enraged ? 1.35 : 1);
      if (e.cd <= 0) this.bossMove(e, d);
    }
    if (this.air <= 0) {
      const rr = e.r * 0.8 + this.r;
      if (dist2(e.x, e.y, this.x, this.y) < rr * rr) this.hurt(e.dmg, e);
    }
  }

  private bossMove(e: Enemy, d: number) {
    const final = e.boss === 2;
    const moves = final ? ['slam', 'ring', 'charge', 'summon', 'barrage'] : ['slam', 'ring', 'summon', 'slam'];
    const m = moves[Math.floor(this.rand() * moves.length)];
    e.cd = final ? 2.4 : 3.0;
    const lead = 0.6;
    if (m === 'slam') {
      this.telegraphs.push({ x: this.x + this.vx * lead, y: this.y + this.vy * lead, r: final ? 170 : 140, t: 0, dur: 1.1, dmg: e.dmg * 1.6 });
    } else if (m === 'barrage') {
      for (let i = 0; i < 5; i++) {
        const a = this.rand() * Math.PI * 2;
        const rr = i === 0 ? 0 : 140 + this.rand() * 160;
        this.telegraphs.push({ x: this.x + Math.cos(a) * rr, y: this.y + Math.sin(a) * rr, r: 110, t: -i * 0.18, dur: 1.0, dmg: e.dmg * 1.3 });
      }
    } else if (m === 'ring') {
      const n = final ? 20 : 14;
      for (let k = 0; k < (final ? 2 : 1); k++)
        for (let i = 0; i < n; i++) {
          const a = ((i + k * 0.5) / n) * Math.PI * 2;
          this.enemyShot(e.x, e.y, Math.cos(a), Math.sin(a), 230 - k * 60, e.dmg, final ? '#d39bff' : '#9be38a', 16);
        }
    } else if (m === 'summon') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = e.x + Math.cos(a) * (e.r + 60);
        const y = e.y + Math.sin(a) * (e.r + 60);
        if (fits(this.map, x, y, 20)) this.enemies.push(this.makeEnemy(ENEMIES[final ? 3 : 0], x, y));
      }
    } else if (m === 'charge' && d < 1100) {
      const dx = (this.x - e.x) / d;
      const dy = (this.y - e.y) / d;
      e.move = 'charge';
      e.moveT = 1.45;
      e.dirX = dx;
      e.dirY = dy;
      this.telegraphs.push({ x: e.x, y: e.y, r: e.r * 0.8, t: 0, dur: 0.9, dmg: 0, line: { dx, dy, len: 1150 * 0.55 + e.r } });
    }
  }

  // ---------------------------------------------------------------- damage
  /** Damage an enemy. w = weapon slot (or -2 for item procs). Returns true if it died. */
  hitEnemy(e: Enemy, base: number, w: number, canCrit = true, knock = 0, fromX = this.x, fromY = this.y): boolean {
    if (e.dead) return false;
    let dmg = base;
    let crit = false;
    // class passives that change damage taken by the foe
    const mark = this.sp('mark');
    if (mark) {
      if (e.marked) dmg *= 1 + mark;
      e.marked = true;
    }
    const bAmp = this.sp('bleedAmp');
    if (bAmp && e.bleedStacks > 0 && e.bleedUntil > this.t) dmg *= 1 + bAmp;
    const fAmp = this.sp('burnAmp');
    if (fAmp && e.burnUntil > this.t) dmg *= 1 + fAmp;
    const fb = this.sp('frostbite');
    if (fb && e.slowUntil > this.t) dmg *= 1 + fb;
    const def = w >= 0 ? this.weapons[w]?.def : undefined;
    const hs = this.sp('headshot');
    if (hs && def?.shot && !e.boss && this.rand() < hs) {
      dmg *= 3;
      crit = true;
    }
    if (def?.slow) e.slowUntil = Math.max(e.slowUntil, this.t + 1);
    const sharp = this.sp('sharpshot');
    if (sharp && dist2(e.x, e.y, this.x, this.y) > 380 * 380) dmg *= 1 + sharp;
    if (canCrit && this.rand() < this.stats.crit) {
      crit = true;
      dmg *= 1.2 + this.stats.critDmg;
    }
    this.lastCrit = crit;
    if (w >= 0) this.applyBleed(e, dmg, crit);
    if (e.boss === 3 && this.jelly) {
      // King Jelly: every slime shares one HP pool
      if (this.jelly.done) return false;
      if (w >= 0 && this.weapons[w]) this.weapons[w].total += dmg;
      if (w >= 0 && def && !this.coreActive && this.coreTagMatch(def)) this.addCore(this.core.gain.hit + (crit ? this.core.gain.crit ?? 0 : 0));
      if (e.hitFlash < -0.25) e.hitFlash = 0.07;
      if (this.fx.length < 220 && (crit || this.rand() < 0.5))
        this.fx.push({ kind: 'text', x: e.x + (this.rand() - 0.5) * 20, y: e.y, t: 0, dur: 0.6, r: 0, color: crit ? '#ffd166' : '#ffffff', text: String(Math.round(dmg)), crit });
      this.jelly.damage(dmg);
      return false;
    }
    // the class resource builds from the right kind of hits
    if (w >= 0 && def && !this.coreActive) {
      const g = this.core.gain;
      if (this.coreTagMatch(def)) this.addCore(g.hit + (crit ? g.crit ?? 0 : 0));
    }
    e.hp -= dmg;
    // short flash, and not every hit, so a big crowd doesn't strobe white
    if (e.hitFlash < -0.25) e.hitFlash = 0.07;
    if (w >= 0 && this.weapons[w]) this.weapons[w].total += dmg;
    if (knock && !e.boss) {
      const dx = e.x - fromX;
      const dy = e.y - fromY;
      const l = Math.hypot(dx, dy) || 1;
      const k = knock / (e.elite ? 4 : 1) / Math.max(1, e.r / 20);
      e.kx += (dx / l) * k;
      e.ky += (dy / l) * k;
    }
    if (this.fx.length < 220 && (crit || this.rand() < 0.6))
      this.fx.push({ kind: 'text', x: e.x + (this.rand() - 0.5) * 20, y: e.y, t: 0, dur: 0.6, r: 0, color: crit ? '#ffd166' : '#ffffff', text: String(Math.round(dmg)), crit });
    // burning: fire abilities with Ignite / Kindling, or a built-in burn
    const burn = (def?.fire ? (def.burn ?? 0) + this.sp('ignite') : 0) * (this.coreActive && this.core.id === 'firestorm' ? 2 : 1);
    if (burn > 0) {
      e.burnDps = Math.max(e.burnUntil > this.t ? e.burnDps : 0, (dmg * burn) / 3);
      e.burnUntil = this.t + 3;
    }
    // life drain (capped so it can't make you unkillable)
    const leech = (def?.leech ?? 0) + this.sp('leech') + (this.coreActive && this.core.id === 'bloodrage' ? 0.03 : 0);
    if (leech > 0 && w >= 0) {
      if (this.t > this.leechT) {
        this.leechT = this.t + 1;
        this.leechLeft = this.stats.maxHp * 0.05;
      }
      const h = Math.min(this.leechLeft, dmg * leech);
      this.leechLeft -= h;
      this.heal(h);
    }
    // Static: a spark jumps to a nearby foe
    const st = this.sp('static');
    if (st && w >= 0 && this.rand() < st) {
      const o = this.nearest(e.x, e.y, 260, new Set([e.id]));
      if (o && o !== e) {
        this.fx.push({ kind: 'zap', x: o.x, y: o.y, t: 0, dur: 0.25, r: 30, color: '#8fd3ff', text: 'bolt' });
        this.hitEnemy(o, dmg * 0.5, -2, false);
      }
    }
    const ex = this.sp('execute');
    if (ex && !e.boss && e.hp > 0 && e.hp < e.maxHp * ex) {
      if (w >= 0 && this.weapons[w]) this.weapons[w].total += e.hp;
      e.hp = 0;
      this.fx.push({ kind: 'text', x: e.x, y: e.y, t: 0, dur: 0.6, r: 0, color: '#ff6b6b', text: 'X', crit: true });
    }
    if (e.hp <= 0) {
      this.kill(e);
      return true;
    }
    return false;
  }

  private kill(e: Enemy) {
    if (e.boss === 3) return;
    e.dead = true;
    this.kills++;
    if (this.core.gain.kill && !this.coreActive) this.addCore(this.core.gain.kill);
    const bl = this.sp('bloodlust');
    if (bl) this.heal(bl);
    if (this.sp('rampage')) {
      if (this.t > this.rampageUntil) this.rampage = 0;
      this.rampage = Math.min(30, this.rampage + 1);
      this.rampageUntil = this.t + 3;
    }
    // Combustion: burning foes blow up (limited chain depth)
    const cb = this.sp('combust');
    if (cb && e.burnUntil > this.t && this.combustDepth < 3 && !e.boss) {
      this.combustDepth++;
      const R = 100 * (1 + this.stats.area);
      this.fx.push({ kind: 'boom', x: e.x, y: e.y, t: 0, dur: 0.3, r: R, color: '#ff7b2e' });
      this.forEnemiesIn(e.x, e.y, R, (o) => o !== e && this.hitEnemy(o, e.maxHp * cb, -2, false));
      this.combustDepth--;
    }
    const s = this.stats;
    const xpv = e.xp * (1 + s.xp) * (1 + s.curse);
    if (RUN.xpOnKill) this.gainXp(xpv);
    else this.dropXp(e.x, e.y, xpv);
    if (this.rand() < (e.elite ? 1 : 0.22)) this.pickups.push({ kind: 'gold', x: e.x + 10, y: e.y, value: (e.elite ? 15 : 1) * (1 + s.gold) * (1 + s.curse), pull: false, v: 0 });
    if (this.rand() < 0.008) this.pickups.push({ kind: 'heal', x: e.x, y: e.y + 10, value: 30, pull: false, v: 0 });
    if (e.elite) {
      this.chests.push({ x: e.x, y: e.y, cost: 0, opened: false, free: true });
      this.pickups.push({ kind: 'magnet', x: e.x - 20, y: e.y, value: 0, pull: false, v: 0 });
    }
    if (this.hasProc('lifesteal')) this.heal(1);
    if (this.hasProc('bomb') && this.rand() < 0.1) {
      const dmg = 25 * (1 + s.dmg) * (1 + this.runT / 120);
      this.fx.push({ kind: 'boom', x: e.x, y: e.y, t: 0, dur: 0.35, r: 90, color: '#ff8c42' });
      this.forEnemiesIn(e.x, e.y, 90, (o) => o !== e && this.hitEnemy(o, dmg, -2, false));
    }
    if (e.boss) {
      this.boss = null;
      for (let i = 0; i < 3; i++) this.chests.push({ x: e.x + (i - 1) * 70, y: e.y + 40, cost: 0, opened: false, free: true });
      this.notice(`${e.name} is defeated!`, '#ffd166', '👑');
      if (e.boss === 2) this.ended = 'win';
    }
  }

  private dropXp(x: number, y: number, v: number) {
    // too many gems on the floor: fold this one into an existing far-away gem
    if (this.pickups.length > 450) {
      const g = this.pickups[Math.floor(this.rand() * this.pickups.length)];
      if (g.kind === 'xp') {
        g.value += v;
        return;
      }
    }
    this.pickups.push({ kind: 'xp', x: x + (this.rand() - 0.5) * 14, y: y + (this.rand() - 0.5) * 14, value: v, pull: false, v: 0 });
  }

  // ---------------------------------------------------------------- weapons
  private weaponStats(w: OwnedWeapon) {
    const s = this.stats;
    const frenzy = this.hasProc('frenzy') && this.hp < s.maxHp * 0.5 ? 0.4 : 0;
    const berserk = this.sp('berserk') * (1 - this.hp / s.maxHp);
    const kite = this.moving ? this.sp('kite') : 0;
    const momentum = this.moving ? this.sp('momentum') : 0;
    const steady = this.moving ? 0 : this.sp('steady');
    const ramp = this.t < this.rampageUntil ? this.rampage * this.sp('rampage') : 0;
    return {
      dmg: w.dmg * Math.max(0.1, 1 + s.dmg + momentum + steady + ramp + this.coreDmg()) * (1 + (this.level - 1) * 0.015),
      cd: w.cd / (1 + w.haste + s.cd + frenzy + berserk + kite + this.coreHaste(w)),
      count: w.count + s.count + (w.def.kind === 'summon' ? this.sp('pack') + this.coreWolves : 0),
      area: w.area * (1 + s.area + (this.coreActive && this.core.id === 'bloodrage' ? 0.2 : 0)),
      duration: w.duration * (1 + s.duration),
    };
  }

  private updateWeapons(dt: number) {
    this.weapons.forEach((w, i) => {
      const st = this.weaponStats(w);
      const kind = w.def.kind;
      if (kind === 'orbit') {
        if (this.t < w.orbitUntil) {
          w.orbitA += w.speed * dt;
          const R = 130 * st.area;
          const br = 24 * st.area;
          for (let b = 0; b < st.count; b++) {
            const a = w.orbitA + (b / st.count) * Math.PI * 2;
            const bx = this.x + Math.cos(a) * R;
            const by = this.y + Math.sin(a) * R;
            this.forEnemiesIn(bx, by, br, (e) => {
              if (e.touchCd > 0) return;
              e.touchCd = 0.35;
              this.hitEnemy(e, st.dmg, i, true, 260, this.x, this.y);
            });
          }
          return;
        }
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer = st.cd;
          w.orbitUntil = this.t + st.duration;
        }
        return;
      }
      if (kind === 'summon') return; // wolves act on their own in updateAllies
      if (kind === 'aura') {
        w.timer -= dt;
        if (w.timer <= 0) {
          w.timer = st.cd;
          this.forEnemiesIn(this.x, this.y, 105 * st.area, (e) => this.hitEnemy(e, st.dmg, i, true, w.def.slow ? 0 : 60));
        }
        return;
      }
      w.timer -= dt;
      if (w.timer <= 0 && w.burst <= 0) {
        // only start a volley if something is in range (saves the cooldown for when it matters)
        const range = kind === 'arc' ? 300 * st.area : kind === 'nova' ? 260 * st.area : 820;
        if (!this.nearest(this.x, this.y, range)) {
          w.timer = 0.1;
          return;
        }
        w.timer = st.cd;
        w.burst = kind === 'nova' ? 1 + Math.floor((st.count - 1) / 2) : w.def.spread ? 1 : st.count;
        // Echo: sometimes the whole cast happens twice
        if (this.sp('echo') && this.rand() < this.sp('echo')) w.burst *= 2;
        w.burstT = 0;
        w.burstDir = 0;
      }
      if (w.burst > 0) {
        w.burstT -= dt;
        if (w.burstT <= 0) {
          this.fire(w, i, st, w.burstDir++);
          w.burst--;
          w.burstT = kind === 'arc' ? 0.14 : kind === 'nova' ? 0.3 : kind === 'storm' ? 0.07 : 0.09;
        }
      }
    });
    // Storm Bottle
    if (this.hasProc('storm')) {
      this.stormT -= dt;
      if (this.stormT <= 0) {
        this.stormT = 4;
        const dmg = 30 * (1 + this.stats.dmg) * (1 + this.runT / 100);
        for (let k = 0; k < 4; k++) {
          const e = this.randomNear(this.x, this.y, 600);
          if (!e) break;
          this.fx.push({ kind: 'zap', x: e.x, y: e.y, t: 0, dur: 0.3, r: 50, color: '#a8e6ff' });
          this.hitEnemy(e, dmg, -2, true);
        }
      }
    }
  }

  private fire(w: OwnedWeapon, i: number, st: ReturnType<Run['weaponStats']>, n: number) {
    const kind = w.def.kind;
    if (kind === 'arc') {
      const tgt = this.nearest(this.x, this.y, 320 * st.area);
      let a = tgt ? Math.atan2(tgt.y - this.y, tgt.x - this.x) : this.angle;
      if (n % 2 === 1) a += Math.PI; // every other sweep covers your back
      if (n >= 2) a += (n >> 1) * (st.count >= 4 ? Math.PI / 2 : 0.6);
      const R = 165 * st.area;
      const half = 1.15;
      this.fx.push({ kind: 'arc', x: this.x, y: this.y, t: 0, dur: 0.22, r: R, a, color: w.def.color });
      this.forEnemiesIn(this.x, this.y, R, (e) => {
        let da = Math.atan2(e.y - this.y, e.x - this.x) - a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) <= half || dist2(e.x, e.y, this.x, this.y) < (e.r + 40) ** 2) this.hitEnemy(e, st.dmg, i, true, 380);
      });
    } else if (kind === 'arrow') {
      const tgt = w.def.id === 'snipe' ? this.toughest(900) : this.nearest(this.x, this.y, 900);
      let a = tgt ? Math.atan2(tgt.y - this.y, tgt.x - this.x) : this.angle;
      a += (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 0.12;
      // Deadeye: the auto attack fires empowered arrows
      const emp = i === 0 && this.coreActive && this.core.id === 'deadeye';
      const ts = this.sp('trueshot') > 0;
      const power = emp ? 1 + 0.4 + (ts ? 0.3 : 0) + this.sp('corePower') : 1;
      const spd = w.speed * (emp ? 1.15 : 1);
      const arrow = (ang: number, mult = 1) =>
        this.shots.push({
          kind: 'arrow', x: this.x, y: this.y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, dmg: st.dmg * power * mult, pierce: emp ? 999 : w.pierce + this.stats.pierce, r: 10 * Math.sqrt(st.area) * (emp ? 1.3 : 1),
          life: emp ? 1.3 : 1.1, hit: new Set(), w: i, enemy: false, target: 0, area: st.area, dist: 0, back: false, range: 0, color: emp ? '#ffd166' : w.def.color, emp,
        });
      if (emp) {
        // Split Shot: extra empowered arrows at other foes
        const split = this.sp('split');
        const skip = new Set<number>(tgt ? [tgt.id] : []);
        for (let k = 0; k < split; k++) {
          const o = this.nearest(this.x, this.y, 900, skip);
          if (o) skip.add(o.id);
          arrow(o ? Math.atan2(o.y - this.y, o.x - this.x) : a + (k % 2 ? -1 : 1) * 0.22 * Math.ceil((k + 1) / 2), 0.6);
        }
        if (ts) this.coreMeter = Math.max(0, this.coreMeter - 7);
      }
      if (w.def.spread) {
        // a fan: every arrow leaves at once
        for (let k = 0; k < st.count; k++) arrow(a + (k - (st.count - 1) / 2) * w.def.spread);
      } else arrow(a);
      // Volley: every 5th auto attack adds a fan of arrows
      const vol = i === 0 ? this.sp('volley') : 0;
      if (vol && n === 0 && ++this.volleyN % 5 === 0) {
        const extra = 2 + vol * 2;
        for (let k = 1; k <= extra; k++) arrow(a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.16);
      }
    } else if (kind === 'bolt') {
      const tgt = this.randomNear(this.x, this.y, 650) ?? this.nearest(this.x, this.y, 900);
      const a = tgt ? Math.atan2(tgt.y - this.y, tgt.x - this.x) : this.rand() * Math.PI * 2;
      this.shots.push({
        kind: 'bolt', x: this.x, y: this.y, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dmg: st.dmg, pierce: 0, r: 14 * Math.sqrt(st.area),
        life: 2.4, hit: new Set(), w: i, enemy: false, target: tgt?.id ?? 0, area: st.area, dist: 0, back: false, range: 0, color: w.def.color,
      });
    } else if (kind === 'axe') {
      const tgt = this.nearest(this.x, this.y, 700);
      let a = tgt ? Math.atan2(tgt.y - this.y, tgt.x - this.x) : this.angle;
      a += n * ((Math.PI * 2) / Math.max(1, st.count)) * (n ? 1 : 0);
      this.shots.push({
        kind: 'axe', x: this.x, y: this.y, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dmg: st.dmg, pierce: 999, r: 26 * st.area,
        life: 4, hit: new Set(), w: i, enemy: false, target: 0, area: st.area, dist: 0, back: false, range: 430, color: w.def.color,
      });
    } else if (kind === 'storm') {
      const e = this.randomNear(this.x, this.y, 620);
      if (!e) return;
      const R = 70 * st.area;
      const style = w.def.shock ? 'bolt' : w.def.id === 'judgment' ? 'pillar' : 'arrows';
      this.fx.push({ kind: 'zap', x: e.x, y: e.y, t: 0, dur: 0.3, r: R, color: w.def.color, text: style });
      this.forEnemiesIn(e.x, e.y, R, (o) => this.hitEnemy(o, st.dmg, i, true, 120, e.x, e.y));
      // Overload: the spark jumps on to more foes
      const chain = w.def.shock ? this.sp('chain') : 0;
      let from = e;
      const hit = new Set([e.id]);
      for (let c = 0; c < chain; c++) {
        let next: Enemy | null = null;
        this.forEnemiesIn(from.x, from.y, 300, (o) => {
          if (!next && !hit.has(o.id)) next = o;
        });
        const nx = next as Enemy | null;
        if (!nx) break;
        hit.add(nx.id);
        this.fx.push({ kind: 'zap', x: nx.x, y: nx.y, t: 0, dur: 0.3, r: R * 0.8, color: w.def.color, text: 'bolt' });
        this.forEnemiesIn(nx.x, nx.y, R * 0.8, (o) => this.hitEnemy(o, st.dmg * 0.8, i, true, 120, nx.x, nx.y));
        from = nx;
      }
    } else if (kind === 'nova') {
      this.fx.push({ kind: 'nova', x: this.x, y: this.y, t: 0, dur: 0.55, r: 250 * st.area, color: w.def.color, hits: new Set(), dmg: st.dmg, slow: st.duration, w: i });
    } else if (kind === 'pool') {
      const e = this.randomNear(this.x, this.y, 520);
      const a = this.rand() * Math.PI * 2;
      const x = e ? e.x : this.x + Math.cos(a) * 200;
      const y = e ? e.y : this.y + Math.sin(a) * 200;
      this.pools.push({ x, y, r: 80 * st.area, dmg: st.dmg, until: this.t + st.duration, tick: 0, w: i, every: 0.45, style: 'pool' });
    } else if (kind === 'rain') {
      // arrows keep falling on a patch of foes for the whole duration
      const e = this.randomNear(this.x, this.y, 560) ?? this.nearest(this.x, this.y, 800);
      if (!e) return;
      const j = n ? 90 : 0;
      this.pools.push({ x: e.x + (this.rand() - 0.5) * j, y: e.y + (this.rand() - 0.5) * j, r: 95 * st.area, dmg: st.dmg, until: this.t + st.duration, tick: 0.15, w: i, every: 0.25, style: 'rain' });
    } else if (kind === 'beam') {
      // a straight line through everything toward the nearest foe
      const tgt = this.nearest(this.x, this.y, 900);
      let a = tgt ? Math.atan2(tgt.y - this.y, tgt.x - this.x) : this.angle;
      a += (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 0.35;
      const len = 760;
      const hw = 22 * st.area;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      this.fx.push({ kind: 'beam', x: this.x, y: this.y, t: 0, dur: 0.3, r: len, a, color: w.def.color, width: hw });
      const mx = this.x + dx * len * 0.5;
      const my = this.y + dy * len * 0.5;
      this.forEnemiesIn(mx, my, len * 0.5 + hw, (e) => {
        const ox = e.x - this.x;
        const oy = e.y - this.y;
        const along = ox * dx + oy * dy;
        if (along < -e.r || along > len + e.r) return;
        if (Math.abs(ox * -dy + oy * dx) > hw + e.r) return;
        this.hitEnemy(e, st.dmg, i, true, 200);
      });
    } else if (kind === 'meteor') {
      const e = this.randomNear(this.x, this.y, 600);
      if (!e) return;
      this.falling.push({ x: e.x, y: e.y, t: 0, dur: 0.7, r: 110 * st.area, dmg: st.dmg, w: i });
    }
  }

  /** Bleed talents: each hit adds a stack (crits 2 with Lethal Wounds), max 5, 4 s; Rupture bursts a full wound. */
  private applyBleed(e: Enemy, dmg: number, crit: boolean) {
    const share = this.sp('bleed');
    if (!share || e.dead) return;
    // each stack bleeds for 2x the share over its 4 s (share/2 of the hit every second)
    const per = (dmg * share) / 2;
    if (e.bleedUntil < this.t) {
      e.bleedStacks = 0;
      e.bleedPer = 0;
    }
    e.bleedPer = Math.max(e.bleedPer, per);
    e.bleedUntil = this.t + 4;
    e.bleedStacks = Math.min(5, e.bleedStacks + (crit && this.sp('critBleed') ? 2 : 1));
    if (e.bleedStacks >= 5 && this.sp('rupture')) {
      const burst = e.bleedPer * 5 * Math.max(0, e.bleedUntil - this.t);
      e.bleedStacks = 0;
      e.bleedUntil = 0;
      this.fx.push({ kind: 'boom', x: e.x, y: e.y, t: 0, dur: 0.3, r: e.r + 30, color: '#d9383b' });
      this.fx.push({ kind: 'text', x: e.x, y: e.y, t: 0, dur: 0.7, r: 0, color: '#ff5c5c', text: String(Math.round(burst)), crit: true });
      this.bleedTotal += burst;
      if (e.boss === 3 && this.jelly) this.jelly.damage(burst);
      else {
        e.hp -= burst;
        if (e.hp <= 0) this.kill(e);
      }
    }
  }

  /** The foe with the most HP within range (Snipe). */
  private toughest(range: number): Enemy | null {
    let best: Enemy | null = null;
    this.forEnemiesIn(this.x, this.y, range, (e) => {
      if (e.spawnT > 0.2) return;
      if (!best || e.hp > best.hp) best = e;
    });
    return (best as Enemy | null) ?? this.nearest(this.x, this.y, range);
  }

  private updateFalling(dt: number) {
    for (const f of this.falling) {
      f.t += dt;
      if (f.t >= f.dur) {
        this.fx.push({ kind: 'boom', x: f.x, y: f.y, t: 0, dur: 0.4, r: f.r, color: this.weapons[f.w]?.def.color ?? '#ff7b2e' });
        this.forEnemiesIn(f.x, f.y, f.r, (e) => this.hitEnemy(e, f.dmg, f.w, true, 300, f.x, f.y));
      }
    }
    this.falling = this.falling.filter((f) => f.t < f.dur);
  }

  /** Wolves: keep the pack the right size, hunt foes near the hero, come back when it's quiet. */
  private updateAllies(dt: number) {
    this.weapons.forEach((w, i) => {
      if (w.def.kind !== 'summon') return;
      const st = this.weaponStats(w);
      const want = Math.round(st.count);
      const mine = this.allies.filter((a) => a.w === i);
      for (let k = mine.length; k < want; k++) this.allies.push({ w: i, x: this.x, y: this.y, cd: 0, angle: 0, moving: false });
      for (const a of mine) {
        a.cd -= dt;
        const tgt = this.nearest(a.x, a.y, 420);
        const homeD = Math.hypot(this.x - a.x, this.y - a.y);
        let gx = this.x + Math.cos(i + this.allies.indexOf(a) * 2) * 60;
        let gy = this.y + Math.sin(i + this.allies.indexOf(a) * 2) * 60;
        if (tgt && homeD < 650 && Math.hypot(tgt.x - this.x, tgt.y - this.y) < 600) {
          gx = tgt.x;
          gy = tgt.y;
          if (Math.hypot(tgt.x - a.x, tgt.y - a.y) < tgt.r + 26 && a.cd <= 0) {
            a.cd = st.cd;
            this.hitEnemy(tgt, st.dmg, i, true, 180, a.x, a.y);
          }
        }
        if (homeD > 1100) {
          a.x = this.x;
          a.y = this.y;
        }
        const dx = gx - a.x;
        const dy = gy - a.y;
        const d = Math.hypot(dx, dy);
        a.moving = d > 18;
        if (a.moving) {
          const sp = Math.min(d, w.speed * (homeD > 400 ? 1.4 : 1) * dt);
          a.angle = Math.atan2(dy, dx);
          a.x += (dx / d) * sp;
          a.y += (dy / d) * sp;
        }
      }
    });
  }

  private updateShots(dt: number) {
    for (const s of this.shots) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.kind === 'bolt' && s.target) {
        const tgt = this.enemies.find((e) => e.id === s.target && !e.dead);
        if (tgt) {
          const sp = Math.hypot(s.vx, s.vy);
          const want = Math.atan2(tgt.y - s.y, tgt.x - s.x);
          let cur = Math.atan2(s.vy, s.vx);
          let da = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
          cur += Math.max(-5 * dt, Math.min(5 * dt, da));
          s.vx = Math.cos(cur) * sp;
          s.vy = Math.sin(cur) * sp;
        } else s.target = 0;
      }
      if (s.kind === 'axe') {
        const step = Math.hypot(s.vx, s.vy) * dt;
        s.dist += step;
        if (!s.back && s.dist >= s.range) {
          s.back = true;
          s.hit.clear();
        }
        if (s.back) {
          const dx = this.x - s.x;
          const dy = this.y - s.y;
          const l = Math.hypot(dx, dy) || 1;
          const sp = Math.hypot(s.vx, s.vy) * 1.05;
          s.vx = (dx / l) * sp;
          s.vy = (dy / l) * sp;
          if (l < 30) s.life = 0;
        }
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < 0 || s.y < 0 || s.x > this.arenaSize || s.y > this.arenaSize) s.life = 0;
      if (s.enemy) {
        // jumping only clears bodies on the ground; shots still hit you in the air
        if (dist2(s.x, s.y, this.x, this.y) < (s.r + this.r) ** 2) {
          this.hurt(s.dmg, undefined, 'shot');
          s.life = 0;
        }
        continue;
      }
      if (s.kind === 'bolt') {
        let hitAny: Enemy | null = null;
        this.forEnemiesIn(s.x, s.y, s.r, (e) => {
          if (!hitAny) hitAny = e;
        });
        if (hitAny) {
          const R = 75 * s.area;
          this.fx.push({ kind: 'boom', x: s.x, y: s.y, t: 0, dur: 0.3, r: R, color: s.color });
          this.forEnemiesIn(s.x, s.y, R, (e) => this.hitEnemy(e, s.dmg, s.w, true, 200, s.x, s.y));
          s.life = 0;
        }
        continue;
      }
      this.forEnemiesIn(s.x, s.y, s.r, (e) => {
        if (s.life <= 0 || s.hit.has(e.id)) return;
        s.hit.add(e.id);
        this.hitEnemy(e, s.dmg, s.w, true, s.kind === 'arrow' ? 140 : 220, s.x - s.vx, s.y - s.vy);
        if (s.emp && this.lastCrit && this.coreActive) {
          // Trueshot refunds Focus on crits; Second Nature stretches Deadeye
          if (this.sp('trueshot')) this.coreMeter = Math.min(CORE_MAX, this.coreMeter + 10);
          else this.coreUntil += this.sp('secondNature');
        }
        if (s.pierce-- <= 0) s.life = 0;
      });
    }
    if (this.shots.length > 60 || this.t % 1 < 0.02) this.shots = this.shots.filter((s) => s.life > 0);
  }

  private updatePools(dt: number) {
    for (const p of this.pools) {
      p.tick -= dt;
      if (p.tick <= 0) {
        p.tick = p.every;
        this.forEnemiesIn(p.x, p.y, p.r, (e) => this.hitEnemy(e, p.dmg, p.w, true));
      }
    }
    this.pools = this.pools.filter((p) => p.until > this.t);
  }

  private updateTelegraphs(dt: number) {
    for (const tg of this.telegraphs) {
      tg.t += dt;
      if (tg.t >= tg.dur && tg.pct !== undefined) {
        // King Jelly landings and globs
        this.fx.push({ kind: 'boom', x: tg.x, y: tg.y, t: 0, dur: 0.3, r: tg.r, color: tg.slimed ? '#6ccf5a' : '#9be38a' });
        this.jelly?.landed(tg);
      } else if (tg.t >= tg.dur && tg.dmg > 0) {
        this.fx.push({ kind: 'boom', x: tg.x, y: tg.y, t: 0, dur: 0.35, r: tg.r, color: '#ff5c5c' });
        // jumping does not save you from a slam: get out of the circle
        if (dist2(tg.x, tg.y, this.x, this.y) < (tg.r + this.r * 0.5) ** 2) {
          this.iframes = 0;
          this.hurt(tg.dmg, undefined, 'slam');
        }
      }
    }
    this.telegraphs = this.telegraphs.filter((t) => t.t < t.dur);
  }

  private updatePickups(dt: number) {
    const range = this.pickupRange;
    const r2 = range * range;
    for (const p of this.pickups) {
      if (!p.pull && dist2(p.x, p.y, this.x, this.y) < r2) p.pull = true;
      if (!p.pull) continue;
      p.v = Math.min(1400, p.v + 1800 * dt);
      const dx = this.x - p.x;
      const dy = this.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      if (l < 22) {
        this.collect(p);
        p.value = -1;
        continue;
      }
      const step = Math.min(l, p.v * dt);
      p.x += (dx / l) * step;
      p.y += (dy / l) * step;
    }
    this.pickups = this.pickups.filter((p) => p.value !== -1);
  }

  private collect(p: Pickup) {
    if (p.kind === 'xp') this.gainXp(p.value);
    else if (p.kind === 'gold') this.gold += p.value;
    else if (p.kind === 'heal') this.heal(p.value);
    else if (p.kind === 'magnet') {
      for (const q of this.pickups) if (q.kind === 'xp') q.pull = true;
      this.notice('Magnet! Every gem comes to you.', '#4ea1ff', '🧲');
    }
  }

  gainXp(v: number) {
    this.xp += v;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = xpToNext(this.level);
      this.pendingLevels++;
    }
  }

  private updateObjects(dt: number) {
    // the lair: E at the door to go in, E at the exit portal once King Jelly is down
    if (!this.inLair && !this.lairCleared && dist2(this.lairDoor.x, this.lairDoor.y, this.x, this.y) < 90 * 90) {
      if (this.input.interact) this.enterLair();
    } else if (this.inLair && this.jelly?.done && dist2(this.jelly.exit.x, this.jelly.exit.y, this.x, this.y) < 90 * 90) {
      if (this.input.interact || this.auto) this.exitLair();
    }
    // chests: walk up and press E (free ones from elites and bosses open on touch)
    for (const c of this.chests) {
      if (c.opened) continue;
      const near = dist2(c.x, c.y, this.x, this.y) < 70 * 70;
      if (!near) continue;
      if (c.free || (this.input.interact && this.gold >= this.chestCost) || (this.auto && this.gold >= this.chestCost)) {
        if (!c.free) {
          this.gold -= this.chestCost;
          this.chestsOpened++;
        }
        c.opened = true;
        this.openChest(c);
      }
    }
    if (this.chests.length > 40) this.chests = this.chests.filter((c) => !c.opened);
    for (const s of this.shrines) {
      if (s.used) continue;
      const inside = dist2(s.x, s.y, this.x, this.y) < SHRINE_RADIUS * SHRINE_RADIUS;
      s.charge = Math.max(0, s.charge + (inside ? dt : -dt * 0.5));
      if (s.charge >= SHRINE_TIME) {
        s.used = true;
        this.choiceTitle = 'Shrine boon';
        this.choices = this.makeShrineChoices();
      }
    }
  }

  private openChest(c: Chest) {
    const rar = rollRarity(this.stats.luck + (c.free ? 25 : 0), this.rand);
    let idx = RUN_RARITIES.indexOf(rar);
    let pool: ItemDef[] = [];
    while (idx >= 0 && !pool.length) {
      const want = RUN_RARITIES[idx--].id;
      pool = ITEMS.filter((i) => i.rarity === want && !i.bossOnly);
    }
    // procs that don't stack: prefer something new
    const fresh = pool.filter((i) => !i.proc || !this.hasProc(i.proc));
    if (fresh.length) pool = fresh;
    const it = pool[Math.floor(this.rand() * pool.length)] ?? ITEM.coin;
    this.items.push(it);
    this.recalc();
    const rc = RUN_RARITIES.find((r) => r.id === it.rarity)!;
    this.notice(`${it.name}: ${it.desc}`, rc.color, it.icon);
    this.fx.push({ kind: 'pickup', x: c.x, y: c.y, t: 0, dur: 0.8, r: 60, color: rc.color });
  }

  private updateFx(dt: number) {
    for (const f of this.fx) {
      f.t += dt;
      if (f.kind === 'nova' && f.hits && f.dmg) {
        const R = f.r * Math.min(1, f.t / f.dur);
        const w = f.w ?? -1;
        this.forEnemiesIn(f.x, f.y, R, (e) => {
          if (f.hits!.has(e.id)) return;
          f.hits!.add(e.id);
          e.slowUntil = this.t + (f.slow ?? 2);
          this.hitEnemy(e, f.dmg!, w, true, 120, f.x, f.y);
        });
      }
    }
    this.fx = this.fx.filter((f) => f.t < f.dur);
    if (this.t % 2 < dt) this.enemies = this.enemies.filter((e) => !e.dead);
  }

  // ---------------------------------------------------------------- AUTO (sim bot)
  // ---------------------------------------------------------------- the lair
  spawnJellySlime(x: number, y: number, r: number, name: string): Enemy {
    const e: Enemy = {
      id: this.nextId++, def: null, x, y, r, hp: 1, maxHp: 1, speed: 0, dmg: 0, xp: 0, color: JELLY.color, elite: false, boss: 3, name,
      slowUntil: 0, hitFlash: 0, cd: 0, kx: 0, ky: 0, dead: false, angle: 0, moving: false, touchCd: 0, move: '', moveT: 0, dirX: 0, dirY: 0,
      spawnT: 0.4, z: 0, marked: false, burnDps: 0, burnUntil: 0, bleedStacks: 0, bleedPer: 0, bleedUntil: 0, bleedShow: 0, bleedShowT: 0,
    };
    this.enemies.push(e);
    return e;
  }
  enterLair() {
    if (this.inLair || this.lairCleared) return;
    this.world = { map: this.map, enemies: this.enemies, pickups: this.pickups, chests: this.chests, shrines: this.shrines, boss: this.boss, x: this.x, y: this.y };
    this.enemies = [];
    this.pickups = [];
    this.chests = [];
    this.shrines = [];
    this.inLair = true;
    this.startJelly();
    this.notice('The lair of King Jelly. Slip through the gaps in its rings. 10 Slimed and you are done.', '#6ccf5a', '👑');
  }
  private startJelly() {
    this.enemies = [];
    this.shots = [];
    this.pools = [];
    this.falling = [];
    this.telegraphs = [];
    this.jelly = new JellyFight(this, this.level);
    this.map = this.jelly.map;
    this.x = this.jelly.entrance.x;
    this.y = this.jelly.entrance.y;
    this.rootUntil = 0;
    this.slowedUntil = 0;
    for (const a of this.allies) {
      a.x = this.x;
      a.y = this.y;
    }
    this.boss = this.jelly.main ?? null;
  }
  /** Testing: start the fight over (full HP, fresh King Jelly). */
  restartLair() {
    if (!this.inLair) return;
    this.hp = this.stats.maxHp;
    this.startJelly();
  }
  jellyDefeated() {
    const j = this.jelly!;
    const at = this.main0(j);
    for (const s of j.slimes) s.dead = true;
    j.rings = [];
    j.goo = [];
    this.telegraphs = [];
    this.boss = null;
    this.kills++;
    this.gainXp(xpToNext(this.level) * 2);
    this.heal(this.stats.maxHp);
    this.coreMeter = CORE_MAX;
    this.items.push(ITEM.royaljelly);
    this.recalc();
    for (let i = 0; i < 3; i++) this.chests.push({ x: at.x + (i - 1) * 80, y: at.y + 60, cost: 0, opened: false, free: true });
    this.notice('King Jelly is defeated! Royal Jelly: +40 max HP, +1 HP regen. The portal home is open.', '#ffd166', '👑');
  }
  private main0(j: JellyFight) {
    const m = j.main ?? j.slimes[0];
    return m ? { x: m.x, y: m.y } : j.centre;
  }
  exitLair() {
    if (!this.inLair || !this.world) return;
    const w = this.world;
    this.map = w.map;
    this.enemies = w.enemies;
    this.pickups = w.pickups;
    this.chests = w.chests;
    this.shrines = w.shrines;
    this.boss = w.boss;
    this.x = w.x;
    this.y = w.y + 120;
    this.shots = [];
    this.pools = [];
    this.falling = [];
    this.telegraphs = [];
    this.inLair = false;
    this.lairCleared = true;
    this.jelly = null;
    this.world = null;
    this.rootUntil = 0;
    this.slowedUntil = 0;
    for (const a of this.allies) {
      a.x = this.x;
      a.y = this.y;
    }
  }

  // ---------------------------------------------------------------- class resource + ultimate
  get core(): CoreDef {
    return this.branch?.core ?? CLASS_CORE[this.job];
  }
  get coreReady(): boolean {
    return !this.coreActive && this.coreMeter >= CORE_MAX;
  }
  /** Seconds left on the ultimate (Trueshot Deadeye: shown as the Focus it has left). */
  get coreLeft(): number {
    return this.coreActive ? Math.max(0, this.coreUntil - this.t) : 0;
  }
  private coreTagMatch(d: WeaponDef): boolean {
    switch (this.core.gain.tag) {
      case 'melee': return ['arc', 'orbit', 'nova', 'axe', 'aura'].includes(d.kind);
      case 'shot': return !!d.shot;
      case 'nature': return d.kind === 'summon' || !!d.slow;
      case 'fire': return !!d.fire;
      case 'shock': return !!d.shock;
      default: return true;
    }
  }
  /** Adds resource; hits and kills are capped to CORE_RATE per second so it never fills instantly. */
  private addCore(n: number, uncapped = false) {
    if (this.coreActive) return;
    n *= 1 + this.sp('coreGain');
    if (!uncapped) {
      if (this.t > this.coreBudgetT) {
        this.coreBudgetT = this.t + 1;
        this.coreBudget = CORE_RATE * (1 + this.sp('coreGain'));
      }
      n = Math.min(n, this.coreBudget);
      this.coreBudget -= n;
    }
    this.coreMeter = Math.min(CORE_MAX, this.coreMeter + n);
  }
  /** Fire the ultimate (F). Returns false if it isn't ready. */
  activateCore(): boolean {
    if (!this.coreReady || this.ended) return false;
    const c = this.core;
    this.coreActive = true;
    this.coreUntil = this.t + c.dur + this.sp('coreDur');
    this.coreTick = 0;
    this.fx.push({ kind: 'nova', x: this.x, y: this.y, t: 0, dur: 0.5, r: 160, color: c.color });
    this.fx.push({ kind: 'text', x: this.x, y: this.y, t: 0, dur: 1, r: 0, color: c.color, text: c.name.toUpperCase(), crit: true });
    if (c.id === 'arcanesurge') for (const w of this.weapons) w.timer = 0;
    if (c.id === 'packfrenzy') this.coreWolves = this.sp('eternalPack') + 2 + Math.round(this.sp('corePower') * 4);
    return true;
  }
  private endCore() {
    this.coreActive = false;
    this.coreMeter = 0;
    this.coreWolves = this.sp('eternalPack');
    const extra = new Map<number, number>();
    // send the borrowed wolves home
    this.allies = this.allies.filter((a) => {
      const w = this.weapons[a.w];
      if (!w) return false;
      const want = Math.round(this.weaponStats(w).count);
      const n = (extra.get(a.w) ?? 0) + 1;
      extra.set(a.w, n);
      return n <= want;
    });
  }
  private coreDmg(): number {
    if (!this.coreActive) return 0;
    const p = this.sp('corePower');
    return this.core.id === 'battlecry' ? 0.3 + p : this.core.id === 'bloodrage' ? 0.4 + p : 0;
  }
  private coreHaste(w: OwnedWeapon): number {
    if (!this.coreActive) return 0;
    const id = this.core.id;
    if (id === 'battlecry') return 0.15;
    if (id === 'bloodrage') return 0.4;
    if (id === 'arcanesurge') return 0.4 + this.sp('corePower');
    if (id === 'stormavatar') return 0.3;
    if (id === 'packfrenzy' && w.def.kind === 'summon') return 0.6;
    return 0;
  }
  private updateCore(dt: number) {
    const c = this.core;
    if (!this.coreActive) {
      if (c.gain.regen) this.coreMeter = Math.min(CORE_MAX, this.coreMeter + c.gain.regen * (1 + this.sp('coreGain')) * dt);
      if ((this.auto || this.autoCore) && this.coreReady && this.nearest(this.x, this.y, 500)) this.activateCore();
      return;
    }
    const trueshot = c.id === 'deadeye' && this.sp('trueshot') > 0;
    if (trueshot ? this.coreMeter <= 0 : this.t >= this.coreUntil) {
      this.endCore();
      return;
    }
    // ultimates that do something on a beat
    this.coreTick -= dt;
    if (this.coreTick > 0) return;
    const base = this.weapons[0] ? this.weaponStats(this.weapons[0]).dmg : 10;
    const pow = 1 + this.sp('corePower');
    if (c.id === 'divine') {
      this.coreTick = 0.5;
      const R = 230 * (1 + this.stats.area);
      this.fx.push({ kind: 'nova', x: this.x, y: this.y, t: 0, dur: 0.4, r: R, color: '#fff1a8' });
      this.forEnemiesIn(this.x, this.y, R, (e) => this.hitEnemy(e, base * 1.5 * pow, 0, true, 320));
    } else if (c.id === 'firestorm') {
      this.coreTick = 0.4 / pow;
      const e = this.randomNear(this.x, this.y, 600);
      if (e) this.falling.push({ x: e.x, y: e.y, t: 0, dur: 0.6, r: 110 * (1 + this.stats.area), dmg: base * 2.2, w: 0 });
    } else if (c.id === 'stormavatar') {
      this.coreTick = 0.2 / pow;
      const e = this.randomNear(this.x, this.y, 550);
      if (e) {
        const R = 70 * (1 + this.stats.area);
        this.fx.push({ kind: 'zap', x: e.x, y: e.y, t: 0, dur: 0.3, r: R, color: '#8fd3ff', text: 'bolt' });
        this.forEnemiesIn(e.x, e.y, R, (o) => this.hitEnemy(o, base * 1.6, 0, true, 120, e.x, e.y));
      }
    } else this.coreTick = 1;
  }

  private autoDir = { x: 1, y: 0 };
  private autoSteer() {
    const near: Enemy[] = [];
    this.forEnemiesIn(this.x, this.y, 460, (e) => near.push(e));
    if (this.boss && !this.boss.dead && !near.includes(this.boss)) near.push(this.boss);
    // goal when it's calm: gems, affordable chests, shrines
    let goal: { x: number; y: number } | null = null;
    let gd = 1e12;
    const consider = (x: number, y: number, bias: number) => {
      const d = dist2(x, y, this.x, this.y) / bias;
      if (d < gd) {
        gd = d;
        goal = { x, y };
      }
    };
    for (const p of this.pickups) if (!p.pull && dist2(p.x, p.y, this.x, this.y) < 700 * 700) consider(p.x, p.y, p.kind === 'heal' && this.hp < this.stats.maxHp * 0.6 ? 6 : p.kind === 'magnet' ? 10 : 1);
    for (const c of this.chests) if (!c.opened && (c.free || this.gold >= this.chestCost)) consider(c.x, c.y, 6);
    for (const s of this.shrines) if (!s.used) consider(s.x, s.y, s.charge > 0 ? 40 : 2);
    if (!goal) goal = { x: this.arenaSize / 2, y: this.arenaSize / 2 };
    const g = goal as { x: number; y: number };
    const gl = Math.hypot(g.x - this.x, g.y - this.y) || 1;
    const gx = (g.x - this.x) / gl;
    const gy = (g.y - this.y) / gl;
    const look = this.moveSpeed * 0.4;
    let best = -1e9;
    let bx = 0;
    let by = 0;
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const dx = i === 16 ? 0 : Math.cos(a);
      const dy = i === 16 ? 0 : Math.sin(a);
      let score = 0;
      for (const k of [0.5, 1]) {
        const px = this.x + dx * look * k;
        const py = this.y + dy * look * k;
        if (!fits(this.map, px, py, this.r + 4)) score -= 12;
        for (const e of near) {
          const ex = e.x + Math.cos(e.angle) * e.speed * 0.4 * k;
          const ey = e.y + Math.sin(e.angle) * e.speed * 0.4 * k;
          const dd = Math.hypot(px - ex, py - ey) - e.r - this.r;
          score -= Math.exp(-Math.max(0, dd) / 70) * (e.boss ? 4 : e.elite ? 2 : 1) * (k === 1 ? 1 : 0.6);
        }
        for (const tg of this.telegraphs) {
          if (tg.line) {
            const ox = px - tg.x;
            const oy = py - tg.y;
            const along = ox * tg.line.dx + oy * tg.line.dy;
            const side = Math.abs(ox * -tg.line.dy + oy * tg.line.dx);
            if (along > -tg.r && along < tg.line.len + tg.r && side < tg.r + this.r + 20) score -= 6;
          } else if (dist2(px, py, tg.x, tg.y) < (tg.r + this.r + 15) ** 2) score -= 6;
        }
        if (this.jelly) for (const g of this.jelly.goo) if (dist2(px, py, g.x, g.y) < (g.r + this.r + 10) ** 2) score -= 5;
        if (this.jelly?.ringDanger(px, py, 0.4 * k)) score -= 7;
        for (const s of this.shots) {
          if (!s.enemy || s.life <= 0) continue;
          const sx = s.x + s.vx * 0.4 * k;
          const sy = s.y + s.vy * 0.4 * k;
          if (dist2(px, py, sx, sy) < (s.r + this.r + 25) ** 2) score -= 2;
        }
      }
      score += (dx * gx + dy * gy) * 0.7 + (dx * this.autoDir.x + dy * this.autoDir.y) * 0.15;
      if (score > best) {
        best = score;
        bx = dx;
        by = dy;
      }
    }
    if (bx || by) this.autoDir = { x: bx, y: by };
    this.input.moveX = bx;
    this.input.moveY = by;
    if (this.jelly?.ringThreat() && JELLY.jumpRings) this.input.jump = true;
    // hop over anything about to touch you
    for (const e of near) {
      if (e.spawnT > 0) continue;
      const dd = Math.hypot(e.x - this.x, e.y - this.y) - e.r - this.r;
      if (dd < 22) {
        this.input.jump = true;
        break;
      }
    }
  }

  /** Auto-picks a card (headless sim): favours abilities, then passives. */
  autoPick() {
    if (!this.choices) return;
    const score = (c: Choice) =>
      (c.kind === 'advance' || c.kind === 'talent' ? 20 + this.rand() : c.kind === 'newWeapon' ? 5 : c.kind === 'weapon' ? 4 : c.kind === 'newPassive' ? 3.5 : 3) + RUN_RARITIES.indexOf(c.rarity) * 0.8 + (c.id === 'glass' ? -2 : 0);
    let best = 0;
    this.choices.forEach((c, i) => {
      if (score(c) > score(this.choices![best])) best = i;
    });
    this.pick(best);
  }
}
