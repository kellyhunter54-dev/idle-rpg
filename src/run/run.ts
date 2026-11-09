// Run mode simulation: one survivors-style run on an open arena. No DOM code here, so the
// headless balance sim (tools/runsim.ts) can drive it.
import { JobId } from '../data';
import { GameMap, TILE, Tile, fits, moveCircle, generateTrainingCave } from '../map';
import { JELLY, JellyFight } from './jelly';
import { PathNode, pathNext, HUNTER_TREE, treeNext } from './paths';

/** Shocked foes take this much more damage (lightning hits, 2 s). */
export const SHOCKED_AMP = 0.1;
import {
  BossDef, ELITE, ENEMIES, EnemyDef, FINAL_BOSS, HEROES, HeroDef, ITEM, ITEMS, ItemDef, PStat, RUN, RUN_RARITIES,
  ABILITY_LEVELS, ADVANCE_LEVELS, PATH_ABILITY, PATH_PLAYER, BRANCHES, BRANCH_TALENTS, CLASS_TALENTS, TALENT_LEVELS, BranchDef, CLASS_CORE, CORE_MAX, CORE_RATE, CoreDef, PASSIVE, PASSIVES, PSpecial, PassiveDef, RunRarity, SHRINE_BOONS, SHRINE_RADIUS, SHRINE_TIME, STAT_LABEL, WEAPON, WSTAT_NAME, WSTAT_STEP, WStat,
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
  /** Shocked (lightning hits): takes more damage for a moment */
  shockUntil: number;
  /** frozen in place (Frost paths) */
  frozenUntil: number;
  /** Soaked (Monsoon rain): takes more damage from everything */
  soakUntil?: number;
  soakAmp?: number;
  /** Snared (Bear Trap): held, and takes more damage from everything */
  snareUntil?: number;
  snareAmp?: number;
  /** stunned (Concussive, Knockdown, Big Bang, a bear trap's hold): can't move */
  stunUntil?: number;
  // ---- Hunter (test hero) statuses. Burn: weak stacking dot. Ablaze: strong single dot.
  hbStacks?: number;
  hbPer?: number;
  hbUntil?: number;
  hbGen?: number;
  abUntil?: number;
  abDps?: number;
  /** Living Bomb: ends at bombUntil, Flash Point every 3 s */
  bombUntil?: number;
  bombNext?: number;
  /** inside a Heat Wave cloud */
  heatUntil?: number;
  heatCloud?: Pool;
  /** Suffocation: time inside, and a stun from it waiting to end */
  chokeT?: number;
  chokeLast?: number;
  chokeStun?: boolean;
  /** Lethal Vapor: time inside, and the poison */
  vaporT?: number;
  poisonUntil?: number;
  poisonDps?: number;
  /** Damage Amp: takes ampMult x damage until ampUntil */
  ampUntil?: number;
  ampMult?: number;
  /** Confused: attacks other mobs; tauntBy = the deranged mob it chases */
  confusedUntil?: number;
  confTarget?: number;
  tauntBy?: number;
  /** the deranged mob that last hit this one (Taunt) */
  lastHitBy?: number;
  /** burn damage waiting to be shown */
  burnShow: number;
  burnShowT: number;
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
  /** a sub-munition (shrapnel, split arrows): no further procs */
  sub?: boolean;
  /** bounces left (Ricochet) */
  bounces?: number;
  /** curves toward foes */
  home?: boolean;
  /** hangs in the air once its life drops under this (Thorn Wall) */
  hangAt?: number;
  /** split arrows (Buckshot) already split */
  split?: boolean;
  /** shard bursts on hit */
  frag?: boolean;
  /** drawn as a spinning blade (Glaive) */
  spin?: boolean;
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
  style: 'pool' | 'rain' | 'heat' | 'fire';
  /** moves with the hero (Storm Cloud) */
  follow?: boolean;
  fx?: number;
  fy?: number;
  /** starting radius (zones that grow) */
  r0?: number;
  born?: number;
  /** foe this zone follows (Hunter's Rain) */
  target?: number;
  /** armed trap waiting for a foe */
  armed?: 'mine' | 'snare';
  /** per-foe tick count (Grinding Spikes) */
  ramps?: Map<number, number>;
  /** a zone that already had its finale */
  done?: boolean;
  /** spawned by another cloud (Cloudburst) */
  child?: boolean;
  /** foes this burning ground already set ablaze (Spreading Ground) */
  lit?: Set<number>;
  /** Ignited Vapor cooldown */
  igniteAt?: number;
  /** burning ground: seconds added, next fire patch; patches chase a foe */
  added?: number;
  nextPatch?: number;
  patch?: boolean;
  chase?: number;
  ticks?: number;
}

/** A sticky charge in a foe (Explosive Shot path). */
export interface Charge {
  eid: number;
  x: number;
  y: number;
  t: number;
  dmg: number;
  r: number;
  w: number;
  gen: number;
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
  /** bomblet (Cluster): small, no meteor rock, gen 1 can split again */
  bomb?: number;
}

export interface OwnedWeapon {
  def: WeaponDef;
  level: number;
  /** the base ability this slot started as (its path tree), and the path ids picked so far */
  base: string;
  path: string[];
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
  kind: 'weapon' | 'newWeapon' | 'passive' | 'newPassive' | 'boon' | 'gold' | 'advance' | 'talent' | 'path';
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
  charges: Charge[] = [];
  /** set while sub-munitions deal damage, so they don't proc again */
  private sub = false;
  private leechLeft = 0;
  private leechT = 0;
  rampage = 0;
  // ---- the lair (King Jelly): the door is on the map from the start; go in whenever you're ready
  lairDoor = { x: 0, y: 0 };
  /** Training cave (testing): door on the map, mob HP multiplier inside */
  caveDoor = { x: 0, y: 0 };
  inCave = false;
  caveHp = 1;
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
  /** testing (pause menu): multiplies all your damage, and god mode ignores damage and death */
  testDmg = 1;
  /** Hunter (test hero): an Archer whose only path is the Rain of Fire tree, one tier per level */
  hunter = false;
  private pathLevel = 0;
  /** tree picks owed after a reset (offered right away, one after another) */
  private respec = 0;
  testXp = 1;
  god = false;
  /** a run that used the testing toggles doesn't count for best results */
  tested = false;
  private coreBudget = 0;
  private coreBudgetT = 0;
  private coreTick = 0;
  /** extra wolves from Call of the Pack */
  private coreWolves = 0;
  /** talent choices made (levels in TALENT_LEVELS) */
  talentsTaken = 0;
  /** total bleed damage (end screen) */
  bleedTotal = 0;
  burnTotal = 0;
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
    this.caveDoor = this.openSpot(700, taken, 0);
    taken.push(this.caveDoor);
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
      def: d, level: 1, base: id, path: [], dmg: d.dmg, cd: d.cd, count: d.count, area: d.area, pierce: d.pierce, speed: d.speed, duration: d.duration,
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
    if (this.hunter) return false; // test hero: only its tree
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

  /** Explode / chain from an ability path. Zone abilities proc less often (they hit many times a second). */
  private pathProcs(e: Enemy, dmg: number, w: number, def: WeaponDef) {
    const zone = ['pool', 'rain', 'aura', 'orbit', 'summon'].includes(def.kind);
    const owned = this.weapons[w];
    if (def.blast && def.kind !== 'bolt' && this.rand() < (zone ? 0.2 : 1)) {
      const R = def.blast * (owned ? owned.area : 1) * (1 + this.stats.area);
      this.fx.push({ kind: 'boom', x: e.x, y: e.y, t: 0, dur: 0.3, r: R, color: def.color });
      this.forEnemiesIn(e.x, e.y, R, (o) => {
        if (def.stun) this.stun(o, def.stun);
        if (o === e) return;
        if (owned) owned.total += dmg * 0.5;
        this.hitEnemy(o, dmg * 0.5, -2, false, def.stun ? 420 : 160, e.x, e.y);
      });
      if (def.cluster) this.throwBomblets(e.x, e.y, def.cluster, dmg * 0.4, w, 1);
      if (def.shrapnel) this.throwShards(e.x, e.y, def.shrapnel, dmg * 0.18, w);
    }
    if (def.chain && def.kind !== 'storm' && this.rand() < (zone ? 0.15 : 0.5)) {
      const hit = new Set([e.id]);
      let from = e;
      for (let c = 0; c < def.chain; c++) {
        const nx = this.nearest(from.x, from.y, 260, hit);
        if (!nx || nx === from) break;
        hit.add(nx.id);
        this.fx.push({ kind: 'zap', x: nx.x, y: nx.y, t: 0, dur: 0.25, r: 30, color: def.color, text: 'bolt' });
        if (owned) owned.total += dmg * 0.6;
        if (def.shock) nx.shockUntil = this.t + 2;
        this.hitEnemy(nx, dmg * 0.6, -2, false);
        from = nx;
      }
    }
  }

  /** Ability paths: a base ability whose level and your level are high enough offers its next tier. */
  private checkPath(): boolean {
    if (this.hunter) {
      // test hero: only Arrow Rain grows, one tier per level
      if (this.level <= this.pathLevel && this.respec <= 0) return false;
      const k = this.weapons.findIndex((x) => x.base === 'rain');
      if (k < 1) return false;
      const w = this.weapons[k];
      const opts = treeNext(HUNTER_TREE(), w.path);
      if (!opts.length) return false;
      const tier = w.path.length;
      this.choiceTitle = `${w.def.name}: tier ${['I', 'II', 'III', 'IV', 'V'][tier]}`;
      this.choices = opts.map((n) => ({
        kind: 'path', id: n.id, name: n.name, icon: n.icon,
        rarity: { ...RUN_RARITIES[Math.min(4, 2 + tier)], color: n.color ?? '#ff7b2e', name: `Tier ${['I', 'II', 'III', 'IV', 'V'][tier]}` },
        level: tier + 1, lines: [n.desc], apply: () => {
          if (this.respec > 0) this.respec--;
          else this.pathLevel = this.level;
          this.hunterNodes.add(n.id);
          this.applyPath(k, n);
        },
      }));
      return true;
    }
    for (let k = 1; k < this.weapons.length; k++) {
      const w = this.weapons[k];
      const tier = w.path.length;
      if (tier >= PATH_PLAYER.length || this.level < PATH_PLAYER[tier] || w.level < PATH_ABILITY[tier]) continue;
      const opts = pathNext(w.base, this.branch, w.path);
      if (!opts.length) continue;
      this.choiceTitle = `${w.def.name}: tier ${['I', 'II', 'III', 'IV', 'V'][tier]}`;
      this.choices = opts.map((n) => ({
        kind: 'path', id: n.id, name: n.name, icon: n.icon,
        rarity: { ...RUN_RARITIES[tier === 2 ? 4 : 3], color: n.color ?? w.def.color, name: n.becomes ? 'Job form' : n.cap ? 'Capstone' : tier === 0 ? 'Form' : 'Path' },
        level: tier + 1, lines: [n.desc], apply: () => this.applyPath(k, n),
      }));
      return true;
    }
    return false;
  }
  private applyPath(k: number, n: PathNode) {
    let w = this.weapons[k];
    if (n.becomes) {
      this.replaceWeapon(w.def.id, n.becomes);
      w = this.weapons[k];
    }
    const m = n.mult ?? {};
    if (m.dmg) w.dmg *= m.dmg;
    if (m.area) w.area *= m.area;
    if (m.duration) w.duration *= m.duration;
    if (m.speed) w.speed *= m.speed;
    if (m.count) w.count += m.count;
    if (m.pierce) w.pierce += m.pierce;
    if (m.haste) w.haste += m.haste;
    const changes = n.mod ? n.mod(w.def) : {};
    const name = n.rename ? n.rename.replace('{n}', w.def.name) : w.def.name;
    w.def = { ...w.def, ...changes, name };
    w.path.push(n.id);
    this.notice(`${w.def.name}: ${n.name}`, n.color ?? w.def.color, n.icon);
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
      def: nd, level: o.level, base: o.base, path: [...o.path],
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
    if (this.hunter) return false; // test hero: no job advancement
    if (!this.branch) {
      if (this.level < ADVANCE_LEVELS[0]) return false;
      this.choiceTitle = 'Job advancement';
      this.choices = BRANCHES[this.job].map((b) => ({
        kind: 'advance', id: b.id, name: b.name, icon: b.icon, rarity: { ...RUN_RARITIES[3], color: b.color, name: 'Job' }, level: 0,
        lines: [b.desc, `Ultimate: ${b.core.icon} ${b.core.name} (${b.core.resource})`, ...b.tiers[0].swaps.filter(([f]) => f === this.hero.basic).map(([f, to]) => `${WEAPON[f].name} becomes ${WEAPON[to].icon} ${WEAPON[to].name}`), `Unlocks ${b.name} forms in your ability paths`],
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
      lines: [`Ability paths: tier ${this.tier + 1} opens (for abilities at Lv ${PATH_ABILITY[this.tier] ?? 9}+)`, `New passives: ${t.passives.map((p) => p.name).join(', ')}`],
      apply: () => this.advance(),
    }];
    return true;
  }
  private advance() {
    const t = this.branch!.tiers[this.tier];
    this.tier++;
    // job advancements change your auto attack; the 4 abilities grow through their paths instead
    for (const [from, to] of t.swaps) if (from === this.hero.basic) this.replaceWeapon(from, to);
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
    if (!this.checkAdvance() && !this.checkTalent() && !this.checkPath() && this.pendingLevels > 0) this.openLevelUp();
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
    if (this.hunter) {
      // test hero: no level-up cards, only its tree (checkPath)
      this.pendingLevels = 0;
      return;
    }
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
    if (this.inLair || this.inCave) this.lairSpent += dt;
    // the training cave keeps its own natural spawn
    if (!this.inLair) this.spawn(dt);
    this.rebuildGrid();
    this.updateEnemies(dt);
    if (this.inLair && this.jelly && !this.jelly.done) this.jelly.update(dt);
    this.updateWeapons(dt);
    this.updateShots(dt);
    this.updatePools(dt);
    this.updateCore(dt);
    this.updateFalling(dt);
    this.updateCharges(dt);
    this.updateAllies(dt);
    this.updateTelegraphs(dt);
    this.updatePickups(dt);
    this.updateObjects(dt);
    this.updateFx(dt);
    this.input.jump = false;
    this.input.interact = false;
    if (this.god) {
      this.hp = this.stats.maxHp;
      if (this.jelly) this.jelly.slimed = 0;
    }
    if (this.testDmg !== 1 || this.testXp !== 1 || this.god || this.hunter) this.tested = true;
    if (this.hp <= 0) this.die();
    this.checkUnlocks();
    if (!this.choices && !this.checkAdvance() && !this.checkTalent() && !this.checkPath() && this.pendingLevels > 0) this.openLevelUp();
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
    if (this.iframes > 0 || this.ended || this.god) return false;
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
    for (let i = 0; i < (this.inCave ? 30 : 12); i++) {
      // a bit ahead of where the hero is running, so the field in front never empties out
      let a = this.rand() * Math.PI * 2;
      if (this.moving && this.rand() < 0.4) a = this.angle + (this.rand() - 0.5) * 1.6;
      const d = this.inCave ? 520 + this.rand() * 380 : RUN.spawnMin + this.rand() * (RUN.spawnMax - RUN.spawnMin);
      const x = this.x + Math.cos(a) * d;
      const y = this.y + Math.sin(a) * d;
      const size = this.inCave ? this.map.w * TILE : this.arenaSize;
      if (x < TILE * 2 || y < TILE * 2 || x > size - TILE * 2 || y > size - TILE * 2) continue;
      if (!fits(this.map, x, y, r)) continue;
      return { x, y };
    }
    return null;
  }

  private makeEnemy(def: EnemyDef, x: number, y: number, elite = false): Enemy {
    const curse = this.stats.curse;
    const hpScale = enemyHpScale(this.runT) * (1 + curse * 0.6) * (1 + this.overtime * RUN.overtimeHp);
    const r = elite ? def.r * ELITE.rMult : def.r;
    const hp = def.hp * hpScale * (elite ? ELITE.hpMult : 1) * (this.inCave ? this.caveHp : 1);
    return {
      id: this.nextId++, def, x, y, r, hp, maxHp: hp, speed: def.speed * (elite ? 0.9 : 1) * (0.92 + this.rand() * 0.16),
      dmg: def.dmg * (1 + this.runT / 600) * (elite ? ELITE.dmgMult : 1), xp: def.xp * (elite ? ELITE.xpMult : 1),
      color: elite ? ELITE.color : def.color, elite, boss: 0, name: '', slowUntil: 0, hitFlash: 0, cd: 1 + this.rand() * 2,
      kx: 0, ky: 0, dead: false, angle: 0, moving: true, touchCd: 0, move: '', moveT: 0, dirX: 0, dirY: 0, spawnT: 0.35, z: 0, marked: false, burnDps: 0, burnUntil: 0, bleedStacks: 0, bleedPer: 0, bleedUntil: 0, bleedShow: 0, bleedShowT: 0, shockUntil: 0, frozenUntil: 0, burnShow: 0, burnShowT: 0,
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
      angle: 0, moving: true, touchCd: 0, move: '', moveT: 0, dirX: 0, dirY: 0, spawnT: 0.6, z: 0, marked: false, burnDps: 0, burnUntil: 0, bleedStacks: 0, bleedPer: 0, bleedUntil: 0, bleedShow: 0, bleedShowT: 0, shockUntil: 0, frozenUntil: 0, burnShow: 0, burnShowT: 0,
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
    if (this.hunter && this.hn('ablazedv2')) {
      let n = 0;
      for (const e of this.enemies) if (!e.dead && (e.abUntil ?? 0) > this.t) n++;
      this.ablazeCount = n;
    }
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
      if (this.hunter && !e.dead && this.hunterDots(e, dt)) continue;
      if (e.burnUntil > this.t && !e.dead) {
        const b = e.burnDps * dt;
        this.burnTotal += b;
        e.burnShow += b;
        if (this.t >= e.burnShowT) {
          e.burnShowT = this.t + 0.5;
          if (e.burnShow >= 1 && this.fx.length < 240)
            this.fx.push({ kind: 'text', x: e.x + (this.rand() - 0.5) * 24, y: e.y, t: 0, dur: 0.7, r: 0, color: '#ff9a3c', text: String(Math.round(e.burnShow)) });
          e.burnShow = 0;
        }
        if (e.boss === 3 && this.jelly) this.jelly.damage(b);
        else {
          e.hp -= b;
          if (e.hp <= 0) {
            this.kill(e);
            continue;
          }
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
      const foe = this.hunter ? this.hunterFoeTarget(e) : null;
      let dx = (foe ? foe.x : this.x) - e.x;
      let dy = (foe ? foe.y : this.y) - e.y;
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
      const slow = e.frozenUntil > this.t || (e.stunUntil ?? 0) > this.t ? 0 : e.slowUntil > this.t ? 0.55 : 1;
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
      if (foe) {
        // Confused / taunted: it attacks the other mob instead of you
        const rr = e.r + foe.r;
        if (e.touchCd <= 0 && dist2(e.x, e.y, foe.x, foe.y) < rr * rr) {
          e.touchCd = 0.5;
          foe.lastHitBy = e.id;
          if ((e.confusedUntil ?? 0) > this.t) this.hitEnemy(foe, this.rainDmg() * 2, this.rainIdx(), false, 120, e.x, e.y);
          else {
            foe.hp -= e.dmg * 3;
            if (foe.hp <= 0 && !foe.dead) this.kill(foe);
          }
        }
      } else if (this.air <= 0) {
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
    let dmg = base * this.testDmg;
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
    // Shocked: lightning hits leave foes taking +10% damage for 2 s
    if (e.shockUntil > this.t) dmg *= 1 + SHOCKED_AMP;
    if (def?.shock) e.shockUntil = this.t + 2;
    const hs = this.sp('headshot');
    if (hs && def?.shot && !e.boss && this.rand() < hs) {
      dmg *= 3;
      crit = true;
    }
    if (def?.slow) e.slowUntil = Math.max(e.slowUntil, this.t + 1);
    if (this.hunter) dmg = this.hunterHit(e, dmg, w, def);
    // Soaked / Snared: more damage from everything
    if ((e.soakUntil ?? 0) > this.t) dmg *= 1 + (e.soakAmp ?? 0);
    if ((e.snareUntil ?? 0) > this.t) dmg *= 1 + (e.snareAmp ?? 0);
    // ability path effects
    if (def) {
      if (def.soak) {
        e.soakAmp = Math.max((e.soakUntil ?? 0) > this.t ? e.soakAmp ?? 0 : 0, def.soak);
        e.soakUntil = this.t + 2;
      }
      if (def.ampBleed && e.bleedStacks > 0 && e.bleedUntil > this.t) dmg *= 1 + def.ampBleed;
      const close = dist2(e.x, e.y, this.x, this.y) < 320 * 320;
      if (def.closeAmp && close) dmg *= 1 + def.closeAmp;
      if (def.stun && def.kind === 'arrow' && (!def.closeAmp || close)) this.stun(e, def.stun);
      if (def.ampChill && e.slowUntil > this.t) dmg *= 1 + def.ampChill;
      if (def.ampShock && e.shockUntil > this.t) dmg *= 1 + def.ampShock;
      if (def.ampBurn && e.burnUntil > this.t) dmg *= 1 + def.ampBurn;
      if (def.freeze && !e.boss && e.frozenUntil < this.t && this.rand() < def.freeze) {
        e.frozenUntil = this.t + 1;
        e.slowUntil = Math.max(e.slowUntil, this.t + 2);
      }
    }
    const sharp = this.sp('sharpshot');
    if (sharp && dist2(e.x, e.y, this.x, this.y) > 380 * 380) dmg *= 1 + sharp;
    if (canCrit && this.rand() < this.stats.crit + (def?.crit ?? 0)) {
      crit = true;
      dmg *= 1.2 + this.stats.critDmg;
    }
    this.lastCrit = crit;
    if (!this.sub && w >= 0 && def && (def.blast || def.chain)) this.pathProcs(e, dmg, w, def);
    if (w >= 0) this.applyBleed(e, dmg, crit, def);
    // sticky charges: plant one, or feed the one already in this foe
    if (w >= 0 && def && !this.sub) {
      if (def.stick && def.kind === 'arrow') this.plantCharge(e, dmg * def.stick, w, 0);
      else for (const c of this.charges) if (c.eid === e.id) c.dmg += dmg * (this.weapons[c.w]?.def.stickFeed ?? 0);
    }
    if (e.boss === 3 && this.jelly) {
      // King Jelly: every slime shares one HP pool
      if (this.jelly.done) return false;
      if (w >= 0 && this.weapons[w]) this.weapons[w].total += dmg;
      if (w >= 0 && def && !this.coreActive && this.coreTagMatch(def)) this.addCore(this.core.gain.hit + (crit ? this.core.gain.crit ?? 0 : 0));
      if (e.hitFlash < -0.25) e.hitFlash = 0.07;
      if (this.fx.length < 220 && (crit || this.rand() < 0.5))
        this.fx.push({ kind: 'text', x: e.x + (this.rand() - 0.5) * 20, y: e.y, t: 0, dur: 0.6, r: 0, color: crit ? '#ffd166' : def?.fire ? '#ffc48a' : def?.shock ? '#b8e4ff' : '#ffffff', text: String(Math.round(dmg)), crit });
      this.jelly.damage(dmg);
      return false;
    }
    // the class resource builds from the right kind of hits
    if (w >= 0 && def && !this.coreActive) {
      const g = this.core.gain;
      if (this.coreTagMatch(def)) this.addCore(g.hit + (crit ? g.crit ?? 0 : 0));
    }
    // totals count damage that landed, not overkill
    const landed = Math.min(dmg, Math.max(0, e.hp));
    e.hp -= dmg;
    // short flash, and not every hit, so a big crowd doesn't strobe white
    if (e.hitFlash < -0.25) e.hitFlash = 0.07;
    if (w >= 0 && this.weapons[w]) this.weapons[w].total += landed;
    if (knock && !e.boss) {
      const dx = e.x - fromX;
      const dy = e.y - fromY;
      const l = Math.hypot(dx, dy) || 1;
      const k = knock / (e.elite ? 4 : 1) / Math.max(1, e.r / 20);
      e.kx += (dx / l) * k;
      e.ky += (dy / l) * k;
    }
    if (this.fx.length < 220 && (crit || this.rand() < 0.6))
      this.fx.push({ kind: 'text', x: e.x + (this.rand() - 0.5) * 20, y: e.y, t: 0, dur: 0.6, r: 0, color: crit ? '#ffd166' : def?.fire ? '#ffc48a' : def?.shock ? '#b8e4ff' : '#ffffff', text: String(Math.round(dmg)), crit });
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
      if (def?.spawnOnKill && w >= 0 && !this.sub) this.cloudburst(e, w);
      return true;
    }
    return false;
  }

  private kill(e: Enemy) {
    if (e.boss === 3) return;
    e.dead = true;
    if (this.hunter) this.hunterDeath(e);
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
  /** Situational damage and haste on top of stats (moving, low HP, Rampage, ultimate). */
  private situational() {
    const s = this.stats;
    const frenzy = this.hasProc('frenzy') && this.hp < s.maxHp * 0.5 ? 0.4 : 0;
    const berserk = this.sp('berserk') * (1 - this.hp / s.maxHp);
    const kite = this.moving ? this.sp('kite') : 0;
    const momentum = this.moving ? this.sp('momentum') : 0;
    const steady = this.moving ? 0 : this.sp('steady');
    const ramp = this.t < this.rampageUntil ? this.rampage * this.sp('rampage') : 0;
    return { dmg: momentum + steady + ramp + this.coreDmg(), haste: frenzy + berserk + kite };
  }

  /** Totals for the HUD stats panel: what your hits are doing right now. */
  liveStats() {
    const s = this.stats;
    const sit = this.situational();
    const lvl = 1 + (this.level - 1) * 0.015;
    const w0 = this.weapons[0];
    const coreH = w0 ? this.coreHaste(w0) : 0;
    const area = s.area + (this.coreActive && this.core.id === 'bloodrage' ? 0.2 : 0);
    return {
      dmg: Math.max(0.1, 1 + s.dmg + sit.dmg) * lvl - 1,
      dmgBase: Math.max(0.1, 1 + s.dmg) * lvl - 1,
      haste: s.cd + sit.haste + coreH,
      hasteBase: s.cd,
      crit: Math.min(1, s.crit),
      critMult: 1.2 + s.critDmg,
      area,
      areaBase: s.area,
      armor: s.armor,
      speed: this.moveSpeed / this.hero.speed - 1,
      speedBase: s.speed,
      regen: s.regen,
      luck: s.luck,
      count: s.count,
      maxHp: s.maxHp,
    };
  }

  private weaponStats(w: OwnedWeapon) {
    const s = this.stats;
    const sit = this.situational();
    return {
      dmg: w.dmg * Math.max(0.1, 1 + s.dmg + sit.dmg) * (1 + (this.level - 1) * 0.015),
      cd: w.cd / (1 + w.haste + s.cd + sit.haste + this.coreHaste(w)),
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
        w.burst = kind === 'nova' ? 1 + Math.floor((st.count - 1) / 2) : w.def.spread || w.def.ring ? (w.def.volleys ?? (w.def.doubleTap ? 2 : 1)) : st.count;
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
          w.burstT = kind === 'arc' ? 0.14 : kind === 'nova' ? 0.3 : kind === 'storm' ? 0.07 : w.def.volleys ? 0.12 : w.def.doubleTap ? 0.16 : 0.09;
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
      const tgt = w.def.id === 'snipe' || w.def.stick ? this.toughest(900) : this.nearest(this.x, this.y, 900);
      let a = tgt ? Math.atan2(tgt.y - this.y, tgt.x - this.x) : this.angle;
      a += (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 0.12;
      // Deadeye: the auto attack fires empowered arrows
      const emp = i === 0 && this.coreActive && this.core.id === 'deadeye';
      const ts = this.sp('trueshot') > 0;
      const power = emp ? 1 + 0.4 + (ts ? 0.3 : 0) + this.sp('corePower') : 1;
      const spd = w.speed * (emp ? 1.15 : 1);
      const d = w.def;
      const life = emp ? 1.3 : d.hang ? 0.35 + d.hang : 1.1;
      const arrow = (ang: number, mult = 1) =>
        this.shots.push({
          kind: 'arrow', x: this.x, y: this.y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, dmg: st.dmg * power * mult, pierce: emp ? 999 : d.hang ? 99 : w.pierce + this.stats.pierce, r: (d.hang ? 48 : d.glaive ? 18 : 10) * Math.sqrt(st.area) * (emp ? 1.3 : 1),
          life, hit: new Set(), w: i, enemy: false, target: 0, area: st.area, dist: 0, back: false, range: 0, color: emp ? '#ffd166' : d.color, emp,
          bounces: d.bounce, home: d.homing, hangAt: d.hang ? d.hang : undefined, spin: d.glaive,
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
      if (d.ring) {
        // Arrow Nova: all the way around (a Spiral's second ring is turned half a step)
        const step = (Math.PI * 2) / st.count;
        for (let k = 0; k < st.count; k++) arrow(a + k * step + (n % 2) * step * 0.5);
      } else if (d.spread) {
        // a fan: every arrow leaves at once
        for (let k = 0; k < st.count; k++) arrow(a + (k - (st.count - 1) / 2) * d.spread + (n % 2 ? d.spread * 0.5 : 0));
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
      const style = w.def.id === 'judgment' ? 'pillar' : w.def.shot ? 'arrows' : 'bolt';
      this.fx.push({ kind: 'zap', x: e.x, y: e.y, t: 0, dur: 0.3, r: R, color: w.def.color, text: style });
      this.forEnemiesIn(e.x, e.y, R, (o) => this.hitEnemy(o, st.dmg, i, true, 120, e.x, e.y));
      // Overload: the spark jumps on to more foes
      const chain = (w.def.shock ? this.sp('chain') : 0) + (w.def.chain ?? 0);
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
      const d = w.def;
      const armed = d.mine ? 'mine' : d.snare ? 'snare' : undefined;
      // bear traps go under the toughest foe; caltrops land around your feet
      const e = d.snare ? (n === 0 ? this.toughest(520) : this.randomNear(this.x, this.y, 520)) : d.atFeet ? null : this.randomNear(this.x, this.y, 520);
      const a = this.rand() * Math.PI * 2;
      const off = d.atFeet ? 30 + this.rand() * 70 : 200;
      let x = e ? e.x : this.x + Math.cos(a) * off;
      let y = e ? e.y : this.y + Math.sin(a) * off;
      if (d.mine && e) {
        // mines go in the path of a foe coming at you, not under it
        const k = 0.45 + this.rand() * 0.2;
        x = this.x + (e.x - this.x) * k + (this.rand() - 0.5) * 60;
        y = this.y + (e.y - this.y) * k + (this.rand() - 0.5) * 60;
      }
      const r = (armed ? 62 : 80) * st.area;
      // armed traps wait (and the field holds at most 12 of them)
      if (armed && this.pools.filter((p) => p.w === i && p.armed).length >= 12) return;
      this.pools.push({ x, y, r, r0: r, born: this.t, dmg: st.dmg, until: this.t + st.duration * (armed ? 4 : 1), tick: 0, w: i, every: 0.45, style: 'pool', follow: d.follow, fx: x - this.x, fy: y - this.y, armed });
    } else if (kind === 'rain') {
      // arrows keep falling on a patch of foes for the whole duration
      const d = w.def;
      const e = d.track ? this.toughest(700) : (n === 0 ? this.densest(700) : this.randomNear(this.x, this.y, 560)) ?? this.nearest(this.x, this.y, 800);
      if (!e) return;
      const j = n ? 90 : 0;
      const rx = d.follow ? this.x + (n ? (this.rand() - 0.5) * 160 : 0) : e.x + (this.rand() - 0.5) * j;
      const ry = d.follow ? this.y + (n ? (this.rand() - 0.5) * 160 : 0) : e.y + (this.rand() - 0.5) * j;
      this.openRain(rx, ry, 95 * st.area, st.dmg, st.duration, i, d.track ? e.id : 0);
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

  /** Debuffs on a foe, for the boss tray and tooltips: what it is, stacks, time left, and what it does. */
  debuffs(e: Enemy): { id: string; icon: string; name: string; stacks: number; left: number; dur: number; color: string; text: string }[] {
    const t = this.t;
    const out: { id: string; icon: string; name: string; stacks: number; left: number; dur: number; color: string; text: string }[] = [];
    if (e.bleedStacks > 0 && e.bleedUntil > t) {
      const amp = this.sp('bleedAmp');
      out.push({ id: 'bleed', icon: '🩸', name: 'Bleeding', stacks: e.bleedStacks, left: e.bleedUntil - t, dur: 4, color: '#ff4d4d',
        text: `${Math.round(e.bleedPer * e.bleedStacks)} damage a second${amp ? `, takes +${Math.round(amp * 100)}% damage` : ''}` });
    }
    if (e.burnUntil > t) {
      const amp = this.sp('burnAmp');
      out.push({ id: 'burn', icon: '🔥', name: 'Burning', stacks: 0, left: e.burnUntil - t, dur: 3, color: '#ff9a3c',
        text: `${Math.round(e.burnDps)} damage a second${amp ? `, takes +${Math.round(amp * 100)}% damage` : ''}` });
    }
    if (e.slowUntil > t) {
      const fb = this.sp('frostbite');
      out.push({ id: 'chill', icon: '❄️', name: 'Chilled', stacks: 0, left: e.slowUntil - t, dur: 2, color: '#a8e6ff', text: `slowed${fb ? `, takes +${Math.round(fb * 100)}% damage` : ''}` });
    }
    if (e.shockUntil > t) out.push({ id: 'shock', icon: '⚡', name: 'Shocked', stacks: 0, left: e.shockUntil - t, dur: 2, color: '#ffe66d', text: `takes +${Math.round(SHOCKED_AMP * 100)}% damage` });
    if (this.hunter) this.hunterDebuffs(e, out);
    if ((e.soakUntil ?? 0) > t) out.push({ id: 'soak', icon: '💧', name: 'Soaked', stacks: 0, left: e.soakUntil! - t, dur: 2, color: '#7fb8ff', text: `takes +${Math.round((e.soakAmp ?? 0) * 100)}% damage` });
    if ((e.snareUntil ?? 0) > t) out.push({ id: 'snare', icon: '🦴', name: 'Snared', stacks: 0, left: e.snareUntil! - t, dur: 4, color: '#c8ccd4', text: `takes +${Math.round((e.snareAmp ?? 0) * 100)}% damage` });
    const ch = this.charges.find((c) => c.eid === e.id);
    if (ch) out.push({ id: 'charge', icon: '🧨', name: 'Sticky Charge', stacks: 0, left: ch.t, dur: 1.6, color: '#ff6b4a', text: `${Math.round(ch.dmg)} damage when it blows` });
    if ((e.stunUntil ?? 0) > t) out.push({ id: 'stun', icon: '💫', name: 'Stunned', stacks: 0, left: e.stunUntil! - t, dur: 1.5, color: '#ffe66d', text: 'can\'t move' });
    if (e.marked && this.sp('mark')) out.push({ id: 'mark', icon: '🔻', name: 'Marked', stacks: 0, left: 0, dur: 0, color: '#ff6b6b', text: `takes +${Math.round(this.sp('mark') * 100)}% damage` });
    return out;
  }

  /** Buffs and debuffs on the hero, for the buff tray. */
  heroStatus(): { icon: string; name: string; value: string; color: string; bad?: boolean; left?: number; dur?: number }[] {
    const t = this.t;
    const out: { icon: string; name: string; value: string; color: string; bad?: boolean; left?: number; dur?: number }[] = [];
    const c = this.core;
    if (this.coreActive) out.push({ icon: c.icon, name: c.name, value: c.id === 'deadeye' && this.sp('trueshot') ? `${Math.ceil(this.coreMeter)}` : `${this.coreLeft.toFixed(0)}s`, color: c.color, left: this.coreLeft, dur: c.dur + this.sp('coreDur') });
    if (this.rampage > 0 && t < this.rampageUntil && this.sp('rampage')) out.push({ icon: '🔥', name: 'Rampage', value: `+${Math.round(this.rampage * this.sp('rampage') * 100)}%`, color: '#ff8a5c', left: this.rampageUntil - t, dur: 3 });
    const smax = this.sp('shield');
    if (smax && this.shield > 1) out.push({ icon: '🫧', name: 'Mana Shield', value: `${Math.round(this.shield)}`, color: '#8fd3ff' });
    if (this.moving && this.sp('momentum')) out.push({ icon: '🏃', name: 'Momentum', value: `+${Math.round(this.sp('momentum') * 100)}%`, color: '#e0b073' });
    if (this.moving && this.sp('kite')) out.push({ icon: '💨', name: 'Kiting', value: `+${Math.round(this.sp('kite') * 100)}%`, color: '#a8f0c6' });
    if (!this.moving && this.sp('steady')) out.push({ icon: '🧘', name: 'Steady', value: `+${Math.round(this.sp('steady') * 100)}%`, color: '#ffd166' });
    const bz = this.sp('berserk') * (1 - this.hp / this.stats.maxHp);
    if (bz > 0.02) out.push({ icon: '😤', name: 'Berserker', value: `+${Math.round(bz * 100)}%`, color: '#e05a5a' });
    if (this.hasProc('frenzy') && this.hp < this.stats.maxHp * 0.5) out.push({ icon: '🥁', name: 'War Drum', value: '+40%', color: '#e05a5a' });
    if (this.rootUntil > t) out.push({ icon: '🟢', name: 'Rooted', value: `${(this.rootUntil - t).toFixed(1)}s`, color: '#6ccf5a', bad: true, left: this.rootUntil - t, dur: 1.4 });
    if (this.slowedUntil > t) out.push({ icon: '🐌', name: 'Slowed', value: `${(this.slowedUntil - t).toFixed(1)}s`, color: '#9be38a', bad: true, left: this.slowedUntil - t, dur: 2 });
    return out;
  }

  /** Bleed talents: each hit adds a stack (crits 2 with Lethal Wounds), max 5, 4 s; Rupture bursts a full wound. */
  private applyBleed(e: Enemy, dmg: number, crit: boolean, def?: WeaponDef) {
    const share = this.sp('bleed') + (def?.bleedHit ?? 0);
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
        this.fx.push({ kind: 'boom', x: f.x, y: f.y, t: 0, dur: f.bomb ? 0.25 : 0.4, r: f.r, color: f.bomb ? '#ffb35c' : this.weapons[f.w]?.def.color ?? '#ff7b2e' });
        if (f.bomb) this.sub = true;
        this.forEnemiesIn(f.x, f.y, f.r, (e) => this.hitEnemy(e, f.dmg, f.w, true, f.bomb ? 180 : 300, f.x, f.y));
        this.sub = false;
        // Daisy Chain: first-wave bomblets split once more
        if (f.bomb === 1 && this.weapons[f.w]?.def.cluster2) this.throwBomblets(f.x, f.y, 2, f.dmg * 0.7, f.w, 2);
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
      // arrows that seek (Seeker, Seeking Shards) or hang in the air (Thorn Wall)
      if (s.kind === 'arrow' && !s.enemy) {
        if (s.hangAt !== undefined && s.life < s.hangAt) {
          // Thorn Wall: the arrows stop and hang where they are, a ring of thorns the horde has to cross
          if (s.vx || s.vy) {
            s.vx = 0;
            s.vy = 0;
          }
          // hanging arrows can cut the same foe again every half second
          s.dist += dt;
          if (s.dist > 0.3) {
            s.dist = 0;
            s.hit.clear();
          }
        } else if (s.home) {
          const tgt = this.nearest(s.x, s.y, 380, s.hit);
          if (tgt) {
            const sp = Math.hypot(s.vx, s.vy);
            let cur = Math.atan2(s.vy, s.vx);
            const da = Math.atan2(Math.sin(Math.atan2(tgt.y - s.y, tgt.x - s.x) - cur), Math.cos(Math.atan2(tgt.y - s.y, tgt.x - s.x) - cur));
            cur += Math.max(-7 * dt, Math.min(7 * dt, da));
            s.vx = Math.cos(cur) * sp;
            s.vy = Math.sin(cur) * sp;
          }
        }
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
        const def = s.w >= 0 ? this.weapons[s.w]?.def : undefined;
        if (s.sub) this.sub = true;
        this.hitEnemy(e, s.dmg, s.w, true, s.hangAt !== undefined && !s.vx && !s.vy ? 0 : s.kind === 'arrow' ? 140 : 220, s.x - s.vx, s.y - s.vy);
        this.sub = false;
        if (s.frag) {
          const big = !s.sub && !!def?.bounceBlast;
          this.subBlast(e.x, e.y, (big ? 110 : 45) * Math.sqrt(s.area), s.dmg * (big ? 1 : 0.6), s.w, big ? '#ffd166' : '#ffb35c');
          if (big) s.life = 0;
        }
        // Buckshot: the first hit splits the arrow in two
        if (def?.splitHit && !s.split && !s.sub) {
          s.split = true;
          const a = Math.atan2(s.vy, s.vx);
          const sp = Math.hypot(s.vx, s.vy);
          for (const da of [-0.45, 0.45])
            this.shots.push({ ...s, vx: Math.cos(a + da) * sp, vy: Math.sin(a + da) * sp, dmg: s.dmg * 0.5, life: 0.3, pierce: 0, hit: new Set([e.id]), sub: true, split: true, bounces: 0 });
        }
        // Ricochet: jump to the closest foe this arrow hasn't hit yet
        if (s.bounces && s.bounces > 0) {
          const nx = this.nearest(e.x, e.y, 420, s.hit);
          if (nx && nx !== e) {
            s.bounces--;
            const sp = Math.hypot(s.vx, s.vy);
            const a = Math.atan2(nx.y - e.y, nx.x - e.x);
            s.x = e.x;
            s.y = e.y;
            s.vx = Math.cos(a) * sp;
            s.vy = Math.sin(a) * sp;
            s.life = Math.max(s.life, 0.6);
            s.dmg *= 1 + (def?.bounceAmp ?? 0);
            if (s.bounces === 0 && def?.bounceBlast) s.frag = true;
            return;
          }
        }
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
      if (p.until <= this.t) continue;
      const def = this.weapons[p.w]?.def;
      if (p.follow) {
        p.x = this.x + (p.fx ?? 0);
        p.y = this.y + (p.fy ?? 0);
      }
      // Hunter's Rain: the cloud stays on its foe
      if (p.target) {
        const tg = this.enemies.find((e) => e.id === p.target && !e.dead);
        if (tg) {
          const dx = tg.x - p.x;
          const dy = tg.y - p.y;
          const l = Math.hypot(dx, dy);
          const mv = Math.min(l, 260 * dt);
          if (l > 1) {
            p.x += (dx / l) * mv;
            p.y += (dy / l) * mv;
          }
        } else {
          const nx = this.toughest(400);
          p.target = nx && dist2(nx.x, nx.y, p.x, p.y) < 400 * 400 ? nx.id : 0;
        }
      }
      if (def?.grow && p.r0 && p.born !== undefined) {
        const life = Math.max(0.01, p.until - p.born);
        p.r = p.r0 * (0.7 + def.grow * Math.min(1, (this.t - p.born) / life));
      }
      // armed traps wait for a foe to step in
      if (p.armed) {
        let trig: Enemy | null = null;
        this.forEnemiesIn(p.x, p.y, p.r * 0.7, (e) => {
          if (!trig) trig = e;
        });
        if (trig) this.triggerTrap(p, trig);
        continue;
      }
      // Undertow / Typhoon: drag normal foes toward the middle
      if (def?.pull) {
        const pull = def.pull;
        this.forEnemiesIn(p.x, p.y, p.r * 1.15, (e) => {
          if (e.boss) return;
          const dx = p.x - e.x;
          const dy = p.y - e.y;
          const l = Math.hypot(dx, dy);
          if (l < 12) return;
          const mv = Math.min(l - 10, pull * dt * (e.elite ? 0.4 : 1));
          e.x += (dx / l) * mv;
          e.y += (dy / l) * mv;
        });
      }
      if (this.hunter && (p.style === 'heat' || p.style === 'fire' || (p.style === 'rain' && this.hn('wildfire')))) {
        this.hunterPool(p, dt);
        continue;
      }
      p.tick -= dt;
      if (p.tick <= 0) {
        p.tick = p.every;
        const ramp = def?.ramp;
        this.forEnemiesIn(p.x, p.y, p.r, (e) => {
          let d = p.dmg;
          if (ramp) {
            // Grinding Spikes: every tick on the same foe cuts deeper
            if (!p.ramps) p.ramps = new Map();
            const n = (p.ramps.get(e.id) ?? 0) + 1;
            p.ramps.set(e.id, n);
            d *= Math.min(ramp, 1 + 0.25 * (n - 1));
          }
          this.hitEnemy(e, d, p.w, true);
        });
      }
    }
    // Tidal Wave / Execution: a big hit as the zone ends
    for (const p of this.pools) {
      if (p.until > this.t || p.done || p.armed) continue;
      p.done = true;
      if (this.hunter && p.style === 'fire') {
        this.hunterGroundEnds(p);
        continue;
      }
      const fin = this.weapons[p.w]?.def.finale;
      if (!fin) continue;
      this.fx.push({ kind: 'boom', x: p.x, y: p.y, t: 0, dur: 0.45, r: p.r, color: this.weapons[p.w].def.color });
      this.forEnemiesIn(p.x, p.y, p.r, (e) => this.hitEnemy(e, p.dmg * fin, p.w, true, 260, p.x, p.y));
    }
    this.pools = this.pools.filter((p) => p.until > this.t);
  }

  // ---------------------------------------------------------------- Hunter (test hero): Kelly's Rain of Fire tree
  // Burn: weak stacking dot (max 5). Ablaze: strong single dot that can't be refreshed (until Ablazed).
  // 1 yard is taken as 10 units (15 yd = 150, 20 yd = 200, 40 yd = 400).
  hunterNodes = new Set<string>();
  /** Testing: undo every Rain of Fire pick and choose again (as many tiers as you had). */
  resetHunterTree() {
    if (!this.hunter) return;
    const k = this.rainIdx();
    if (k < 0) return;
    const had = this.weapons[k].path.length;
    const d = WEAPON['rain'];
    const old = this.weapons[k];
    this.weapons[k] = { ...old, def: d, path: [], dmg: d.dmg, cd: d.cd, count: d.count, area: d.area, pierce: d.pierce, speed: d.speed, duration: d.duration, haste: 0, total: old.total };
    this.hunterNodes.clear();
    this.pools = this.pools.filter((p) => p.w !== k);
    for (const e of this.enemies) {
      e.hbStacks = 0;
      e.abUntil = 0;
      e.bombUntil = 0;
      e.poisonUntil = 0;
      e.ampUntil = 0;
      e.confusedUntil = 0;
      e.tauntBy = 0;
    }
    // picks you had are owed back now; the next level still brings the next tier as usual
    this.respec = had;
    this.pathLevel = this.level;
    this.notice(had ? `Rain of Fire tree reset: pick ${had} again` : 'Rain of Fire tree reset', '#ff7b2e', '🔥');
    this.checkPath();
  }
  /** Has the Hunter picked this node? */
  hn(id: string) {
    return this.hunterNodes.has(id);
  }
  private ablazeCount = 0;
  /** Burn lasts 5 s, 15 s with Delayed Burn. */
  private burnDur() {
    return this.hn('delayedburn') ? 15 : 5;
  }
  private rainIdx() {
    return this.weapons.findIndex((w) => w.base === 'rain');
  }
  /** The rain's per-tick damage right now (what the dots and blasts scale from). */
  private rainDmg() {
    const k = this.rainIdx();
    return k >= 0 ? this.weaponStats(this.weapons[k]).dmg : 10;
  }
  private credit(dmg: number, e: Enemy) {
    const ow = this.weapons[this.rainIdx()];
    if (ow) ow.total += Math.min(dmg, Math.max(0, e.hp));
  }
  /** Damage multiplier on a foe from Heat Wave and Damage Amp. */
  private heatMult(e: Enemy, fire: boolean) {
    let m = 1;
    if ((e.heatUntil ?? 0) > this.t) {
      m *= fire ? 4 : 2;
      if (this.hn('poisonamp') && (e.poisonUntil ?? 0) > this.t) m *= 2;
    }
    if ((e.ampUntil ?? 0) > this.t) m *= e.ampMult ?? 1;
    return m;
  }

  /** Adds Burn stacks (Wild Fire, Spreading Ash, Unlimited Bomb). */
  private addBurn(e: Enemy, n: number, per: number, gen = 0) {
    if (e.dead || (e.bombUntil ?? 0) > this.t) return;
    const live = (e.hbUntil ?? 0) > this.t && (e.hbStacks ?? 0) > 0;
    const before = live ? e.hbStacks! : 0;
    // Everlasting Ash lifts the 5 stack cap
    const everlasting = this.hn('everlastingash');
    const stacks = everlasting ? before + n : Math.min(5, before + n);
    e.hbPer = Math.max(live ? e.hbPer ?? 0 : 0, per);
    e.hbGen = Math.max(live ? e.hbGen ?? 0 : 0, gen);
    e.hbUntil = this.t + this.burnDur();
    e.hbStacks = stacks;
    // Delayed Burn: every stack applied sets off a smaller Flash Point
    if (this.hn('delayedburn') && stacks > before && stacks < 5) this.flashPoint(e, 0.25 * (stacks / 5), 'mini');
    // Everlasting + Creeping Ash: every 5 stacks reached, 1 stack jumps to another mob (this one keeps its stacks)
    if (everlasting && this.hn('creepingash')) {
      for (let m = Math.floor(before / 5) + 1; m <= Math.floor(stacks / 5); m++) this.jumpBurn(e, 1, 150);
      return;
    }
    if (stacks >= 5) {
      if (this.hn('livingbomb')) {
        e.hbStacks = 0;
        e.hbUntil = 0;
        e.bombUntil = this.t + 12;
        e.bombNext = this.t + 3;
        this.fx.push({ kind: 'text', x: e.x, y: e.y - 24, t: 0, dur: 0.8, r: 0, color: '#ff5a1f', text: 'LIVING BOMB', crit: true });
      } else if (this.hn('flashpoint')) {
        e.hbStacks = this.hn('repeatingburn') ? 1 : 0;
        if (!e.hbStacks) e.hbUntil = 0;
        this.flashPoint(e, 1, 'full');
      }
    }
  }

  /** Flash Point: a big hit on the foe and an AoE around it. */
  private flashPoint(e: Enemy, scale: number, kind: 'full' | 'mini' | 'bomb' | 'final') {
    const dmg = (e.hbPer ?? this.rainDmg()) * 40 * scale;
    const R = 120;
    const aoe = this.hn('repeatingburn') ? 1 : 0.5;
    this.fx.push({ kind: 'boom', x: e.x, y: e.y, t: 0, dur: 0.35, r: kind === 'mini' ? 60 : R, color: '#ff5a1f' });
    if (kind === 'full') this.fx.push({ kind: 'text', x: e.x, y: e.y - 24, t: 0, dur: 0.8, r: 0, color: '#ff7b2e', text: 'FLASH POINT', crit: true });
    const k = this.rainIdx();
    const add = this.hn('unlimitedbomb') && (kind === 'bomb' || kind === 'final') ? (kind === 'final' ? 2 : 1) : 0;
    this.sub = true;
    this.hitEnemy(e, dmg, k, true, 160, e.x, e.y);
    if (kind !== 'mini')
      this.forEnemiesIn(e.x, e.y, R, (o) => {
        if (o !== e) this.hitEnemy(o, dmg * aoe, k, true, 160, e.x, e.y);
      });
    this.sub = false;
    if (add)
      this.forEnemiesIn(e.x, e.y, R, (o) => {
        if (!o.dead) this.addBurn(o, add, e.hbPer ?? this.rainDmg(), e.hbGen ?? 0);
      });
  }

  /** Ablaze: a strong dot. Can't be refreshed while it burns, unless Ablazed. */
  private applyAblaze(e: Enemy) {
    if (e.dead) return;
    if ((e.abUntil ?? 0) > this.t && !this.hn('ablazed')) return;
    e.abUntil = this.t + 6;
    e.abDps = this.rainDmg() * 2.5;
    // Swift Ablaze: each one shaves a second off the rain
    if (this.hn('swiftablaze')) {
      const w = this.weapons[this.rainIdx()];
      if (w) w.timer = Math.max(0, w.timer - 1);
    }
  }

  /** Spreading / Creeping / Jumping Ash: put a stack on foes that have no Burn. */
  private jumpBurn(from: Enemy, count: number, range: number) {
    const gen = (from.hbGen ?? 0) + 1;
    const per = from.hbPer ?? this.rainDmg();
    const taken = new Set<number>([from.id]);
    for (let n = 0; n < count; n++) {
      let best: Enemy | null = null;
      let bd = range * range;
      this.forEnemiesIn(from.x, from.y, range, (o) => {
        if (taken.has(o.id) || ((o.hbUntil ?? 0) > this.t && (o.hbStacks ?? 0) > 0)) return;
        const d = dist2(o.x, o.y, from.x, from.y);
        if (d < bd) {
          bd = d;
          best = o;
        }
      });
      if (!best) return;
      const b = best as Enemy;
      taken.add(b.id);
      this.addBurn(b, 1, per, gen);
      this.fx.push({ kind: 'boom', x: b.x, y: b.y, t: 0, dur: 0.3, r: 28, color: '#9a8a7a' });
    }
  }

  /** Per-frame Burn / Ablaze / Poison / Living Bomb / stun-end on one foe. Returns true if it died. */
  private hunterDots(e: Enemy, dt: number): boolean {
    const t = this.t;
    let total = 0;
    // Burn
    if ((e.hbStacks ?? 0) > 0) {
      if ((e.hbUntil ?? 0) <= t) {
        if (this.hn('everlastingash')) {
          // Everlasting Ash: it never runs out; every time it would, it gains a stack (no cap)
          const before = e.hbStacks!;
          e.hbStacks = before + 1;
          e.hbUntil = t + this.burnDur();
          // ...and every 5 stacks reached sends 1 stack to another mob (this one keeps its stacks)
          if (Math.floor(e.hbStacks / 5) > Math.floor(before / 5)) this.jumpBurn(e, 1, 150);
        } else if (this.hn('creepingash')) {
          if (e.hbStacks! < 5) {
            e.hbStacks!++;
            e.hbUntil = t + this.burnDur();
          } else {
            this.jumpBurn(e, 1, 150);
            e.hbStacks = 0;
          }
        } else e.hbStacks = 0;
      }
      if ((e.hbStacks ?? 0) > 0) total += e.hbStacks! * (e.hbPer ?? 0) * 0.6 * Math.pow(this.hn('jumpingash2') ? 1.02 : 1, e.hbGen ?? 0) * this.heatMult(e, true);
    }
    // Ablaze
    if ((e.abUntil ?? 0) > t) total += (e.abDps ?? 0) * (this.hn('ablazedv2') ? 1 + 0.05 * this.ablazeCount : 1) * this.heatMult(e, true);
    // Poison (Lethal Vapor)
    if ((e.poisonUntil ?? 0) > t) total += (e.poisonDps ?? 0) * this.heatMult(e, false);
    // Living Bomb
    if (e.bombUntil) {
      if (t >= e.bombUntil) {
        e.bombUntil = 0;
        this.flashPoint(e, 2, 'final');
      } else if (t >= (e.bombNext ?? 0)) {
        e.bombNext = (e.bombNext ?? t) + 3;
        this.flashPoint(e, 1, 'bomb');
      }
      if (e.dead) return true;
    }
    // a Suffocation stun just ended: Confused / Damage Amp
    if (e.chokeStun && (e.stunUntil ?? 0) <= t) {
      e.chokeStun = false;
      if (this.hn('confused') && !e.boss) e.confusedUntil = t + 3;
      if (this.hn('dmgamp')) {
        e.ampUntil = t + 4;
        e.ampMult = 4;
      }
    }
    if (total <= 0) return false;
    const b = total * dt;
    this.burnTotal += b;
    this.credit(b, e);
    e.burnShow += b;
    if (t >= e.burnShowT) {
      e.burnShowT = t + 0.5;
      if (e.burnShow >= 1 && this.fx.length < 240)
        this.fx.push({ kind: 'text', x: e.x + (this.rand() - 0.5) * 24, y: e.y, t: 0, dur: 0.7, r: 0, color: '#ff7b2e', text: String(Math.round(e.burnShow)) });
      e.burnShow = 0;
    }
    if (e.boss === 3 && this.jelly) this.jelly.damage(b);
    else {
      e.hp -= b;
      if (e.hp <= 0) {
        this.kill(e);
        return true;
      }
    }
    return false;
  }

  /** Hit-time effects: Heat Wave / Damage Amp, Ignited Vapor, Ablazed refresh and spread, Detonate. */
  private hunterHit(e: Enemy, dmg: number, w: number, def?: WeaponDef): number {
    const fire = !!def?.fire;
    dmg *= this.heatMult(e, fire);
    // Damage Amp x2 on bosses only applies to abilities (anything that isn't a dot tick)
    // Ignited Vapor: a hit on a mob in the cloud makes the gas flash
    const cloud = e.heatCloud;
    if (!this.sub && this.hn('vapor') && cloud && (e.heatUntil ?? 0) > this.t && cloud.until > this.t && (cloud.igniteAt ?? 0) <= this.t) {
      cloud.igniteAt = this.t + 0.5;
      this.fx.push({ kind: 'boom', x: cloud.x, y: cloud.y, t: 0, dur: 0.3, r: cloud.r, color: '#ff7b2e' });
      this.sub = true;
      this.forEnemiesIn(cloud.x, cloud.y, cloud.r, (o) => {
        if (o !== e) this.hitEnemy(o, cloud.dmg * 2.5, cloud.w, false, 0);
      });
      this.sub = false;
    }
    if (fire && (e.abUntil ?? 0) > this.t && this.hn('ablazed')) e.abUntil = this.t + 6;
    if (fire && this.hn('ablazedv2')) this.applyAblaze(e);
    // Ablazed (Detonate): your auto attack blows up an Ablaze
    if (w === 0 && this.hn('detonate') && (e.abUntil ?? 0) > this.t && !this.sub) {
      const big = (e.abDps ?? 0) * 6;
      e.abUntil = 0;
      this.fx.push({ kind: 'boom', x: e.x, y: e.y, t: 0, dur: 0.35, r: 120, color: '#ff5a1f' });
      this.sub = true;
      const k = this.rainIdx();
      this.forEnemiesIn(e.x, e.y, 120, (o) => {
        if (o !== e) this.hitEnemy(o, big * 0.5, k, false, 160, e.x, e.y);
      });
      this.sub = false;
      dmg += big;
    }
    return dmg;
  }

  private hunterDeath(e: Enemy) {
    // Spreading Ash / Jumping Ash
    if (this.hn('spreadash') && (e.hbStacks ?? 0) > 0 && (e.hbUntil ?? 0) > this.t) this.jumpBurn(e, this.hn('jumpingash') ? 2 : 1, this.hn('jumpingash') ? 400 : 150);
    // Everlasting Ground: deaths feed the ground
    if (this.hn('everlastingground'))
      for (const p of this.pools) if (p.style === 'fire' && !p.patch && p.until > this.t && dist2(p.x, p.y, e.x, e.y) < p.r * p.r) {
        p.until += 2;
        p.added = (p.added ?? 0) + 2;
      }
    // Taunt: a deranged mob that gets a kill stays deranged and pulls the crowd
    if (e.lastHitBy !== undefined) {
      const killer = this.enemies.find((o) => o.id === e.lastHitBy && !o.dead);
      if (killer && this.hn('taunt') && (killer.confusedUntil ?? 0) > this.t) {
        killer.confusedUntil = Infinity;
        this.fx.push({ kind: 'text', x: killer.x, y: killer.y - 24, t: 0, dur: 0.8, r: 0, color: '#ff8a8a', text: 'TAUNT', crit: true });
        this.forEnemiesIn(killer.x, killer.y, 150, (o) => {
          if (o !== killer && !o.boss) o.tauntBy = killer.id;
        });
      }
    }
  }

  /** Heat Wave cloud, Wild Fire rain, burning ground and fire patches. */
  private hunterPool(p: Pool, dt: number) {
    const t = this.t;
    if (p.patch) {
      // a fire patch chases the closest mob that isn't Ablaze
      let tg = this.enemies.find((o) => o.id === p.chase && !o.dead && (o.abUntil ?? 0) <= t);
      if (!tg) {
        // each patch takes a mob no other patch is already chasing
        const claimed = new Set<number>();
        for (const q of this.pools) if (q !== p && q.patch && q.until > t && q.chase) claimed.add(q.chase);
        let bd = 600 * 600;
        tg = undefined;
        for (const o of this.enemies) {
          if (o.dead || (o.abUntil ?? 0) > t || claimed.has(o.id)) continue;
          const d = dist2(o.x, o.y, p.x, p.y);
          if (d < bd) {
            bd = d;
            tg = o;
          }
        }
        p.chase = tg?.id ?? 0;
      }
      if (tg) {
        const dx = tg.x - p.x;
        const dy = tg.y - p.y;
        const l = Math.hypot(dx, dy) || 1;
        const sp = (this.hn('scorchedearth') ? 300 : 150) * dt;
        p.x += (dx / l) * Math.min(l, sp);
        p.y += (dy / l) * Math.min(l, sp);
        if (l < p.r + tg.r) this.applyAblaze(tg);
      }
      return;
    }
    if (p.style === 'heat' && this.hn('growinggas') && p.r0 && p.born !== undefined) p.r = p.r0 * (1 + 0.6 * Math.min(1, (t - p.born) / Math.max(0.1, p.until - p.born)));
    if (p.style === 'fire') {
      // Spreading Ground: +5% size every 2 s
      if (this.hn('spreadground') && p.r0 && p.born !== undefined) p.r = p.r0 * (1 + 0.05 * Math.floor((t - p.born) / 2));
      // Moving Ground: fire patches every 5 s
      if (this.hn('movingground') && t >= (p.nextPatch ?? Infinity)) {
        p.nextPatch = (p.nextPatch ?? t) + 5;
        const n = this.hn('scorchedearth') ? 3 : 1;
        for (let k = 0; k < n; k++) this.pools.push({ x: p.x, y: p.y, r: 34, dmg: p.dmg, until: t + 6, tick: 0, w: p.w, every: 1, style: 'fire', patch: true, chase: 0 });
      }
    }
    p.tick -= dt;
    if (p.tick > 0) return;
    p.tick = p.every;
    p.ticks = (p.ticks ?? 0) + 1;
    if (p.style === 'heat') {
      const overheat = this.hn('overheating') && p.ticks % 2 === 0;
      this.forEnemiesIn(p.x, p.y, p.r, (e) => {
        e.heatUntil = t + p.every + 0.1;
        e.heatCloud = p;
        if (this.hn('lethalvapor')) {
          e.vaporT = (e.vaporT ?? 0) + p.every;
          if (e.vaporT >= 7 && (e.poisonUntil ?? 0) <= t) {
            e.poisonUntil = t + 10;
            e.poisonDps = p.dmg * 1.5;
            e.vaporT = 0;
          }
        }
        if (this.hn('suffocate')) {
          e.slowUntil = Math.max(e.slowUntil, t + 0.4);
          if ((e.chokeLast ?? 0) < t - p.every - 0.15) e.chokeT = 0;
          e.chokeLast = t;
          e.chokeT = (e.chokeT ?? 0) + p.every;
          if (e.chokeT >= 3) {
            e.chokeT = 0;
            if (e.boss) {
              // can't be stunned: Damage Amp x2 instead
              if (this.hn('dmgamp2')) {
                e.ampUntil = t + 10;
                e.ampMult = 15;
              }
            } else {
              this.stun(e, 1.5);
              e.chokeStun = true;
            }
          }
        }
        if (overheat) this.hitEnemy(e, p.dmg, p.w, false, 0);
      });
      return;
    }
    if (p.style === 'rain') {
      // Wild Fire: no hits, a Burn stack every 0.5 s
      this.forEnemiesIn(p.x, p.y, p.r, (e) => this.addBurn(e, 1, p.dmg));
      return;
    }
    // burning ground
    const lethal = this.hn('lethalground');
    const cap = this.hn('everlastingground') ? Infinity : 15 * (this.hn('movingground') ? 2 : 1);
    this.forEnemiesIn(p.x, p.y, p.r, (e) => {
      if (this.hn('spreadground') && p.lit && !p.lit.has(e.id)) {
        p.lit.add(e.id);
        const life = p.until - (p.born ?? t);
        const add = Math.max(0, Math.min(2, cap - life));
        p.until += add;
        p.added = (p.added ?? 0) + add;
      }
      if (lethal) this.hitEnemy(e, p.dmg * 1.5 * (1 + 0.05 * (p.added ?? 0)), p.w, false, 0);
      else this.applyAblaze(e);
    });
  }

  /** Burning ground ends: Detonating Ember goes off. */
  private hunterGroundEnds(p: Pool) {
    if (p.patch || !this.hn('ember')) return;
    const R = 200;
    this.fx.push({ kind: 'boom', x: p.x, y: p.y, t: 0, dur: 0.5, r: R, color: '#ff5a1f' });
    this.fx.push({ kind: 'nova', x: p.x, y: p.y, t: 0, dur: 0.4, r: R, color: '#ff7b2e', hits: new Set(), dmg: 0, slow: 0, w: -2 });
    this.forEnemiesIn(p.x, p.y, R, (e) => {
      if (dist2(e.x, e.y, p.x, p.y) < p.r * p.r) this.hitEnemy(e, p.dmg * 6, p.w, true, 240, p.x, p.y);
      if (!e.dead) this.applyAblaze(e);
    });
  }

  /** Who a confused or taunted mob goes after (null = the hero). */
  private hunterFoeTarget(e: Enemy): Enemy | null {
    if ((e.confusedUntil ?? 0) > this.t) {
      let tg = this.enemies.find((o) => o.id === e.confTarget && !o.dead);
      if (!tg) {
        tg = this.nearest(e.x, e.y, 500, new Set([e.id])) ?? undefined;
        e.confTarget = tg?.id;
      }
      return tg ?? null;
    }
    if (e.tauntBy) {
      const tg = this.enemies.find((o) => o.id === e.tauntBy && !o.dead);
      if (tg) return tg;
      e.tauntBy = 0;
    }
    return null;
  }

  private hunterDebuffs(e: Enemy, out: { id: string; icon: string; name: string; stacks: number; left: number; dur: number; color: string; text: string }[]) {
    const t = this.t;
    if ((e.hbStacks ?? 0) > 0 && (e.hbUntil ?? 0) > t) out.push({ id: 'hburn', icon: '🔥', name: 'Burn', stacks: e.hbStacks!, left: e.hbUntil! - t, dur: this.burnDur(), color: '#ff9a3c', text: `${Math.round(e.hbStacks! * (e.hbPer ?? 0) * 0.6)} damage a second` });
    if ((e.abUntil ?? 0) > t) out.push({ id: 'ablaze', icon: '☀️', name: 'Ablaze', stacks: 0, left: e.abUntil! - t, dur: 6, color: '#ff5a1f', text: `${Math.round(e.abDps ?? 0)} damage a second` });
    if ((e.bombUntil ?? 0) > t) out.push({ id: 'bomb', icon: '💣', name: 'Living Bomb', stacks: 0, left: e.bombUntil! - t, dur: 12, color: '#ff3b3b', text: 'blows up every 3s' });
    if ((e.heatUntil ?? 0) > t) out.push({ id: 'heat', icon: '🌡️', name: 'Heat Wave', stacks: 0, left: e.heatUntil! - t, dur: 0.5, color: '#ffb066', text: 'takes 2x damage, 4x from fire' });
    if ((e.poisonUntil ?? 0) > t) out.push({ id: 'poison', icon: '🧪', name: 'Poisoned', stacks: 0, left: e.poisonUntil! - t, dur: 10, color: '#9be36b', text: `${Math.round(e.poisonDps ?? 0)} damage a second` });
    if ((e.ampUntil ?? 0) > t) out.push({ id: 'amp', icon: '🎯', name: 'Damage Amp', stacks: 0, left: e.ampUntil! - t, dur: e.ampMult === 15 ? 10 : 4, color: '#ff8a8a', text: `takes ${e.ampMult}x damage` });
    if ((e.confusedUntil ?? 0) > t) out.push({ id: 'confused', icon: '💫', name: 'Deranged', stacks: 0, left: Math.min(99, e.confusedUntil! - t), dur: 3, color: '#c77dff', text: 'attacks other mobs' });
  }

  // ---------------------------------------------------------------- archer path mechanics
  /** Stun a normal foe (bosses are only slowed). */
  private stun(e: Enemy, secs: number) {
    if (e.boss) {
      e.slowUntil = Math.max(e.slowUntil, this.t + secs * 2);
      return;
    }
    e.stunUntil = Math.max(e.stunUntil ?? 0, this.t + secs);
  }

  /** The foe with the most other foes around it (Arrow Rain aims at clumps). */
  private densest(range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestN = -1;
    const r2 = range * range;
    let seen = 0;
    for (const e of this.enemies) {
      if (e.dead || dist2(e.x, e.y, this.x, this.y) > r2) continue;
      if (++seen > 40) break;
      let n = 0;
      this.forEnemiesIn(e.x, e.y, 140, () => n++);
      if (n > bestN) {
        bestN = n;
        best = e;
      }
    }
    return best;
  }

  /** A rain cloud (Arrow Rain and its paths). */
  private openRain(x: number, y: number, r: number, dmg: number, dur: number, w: number, target = 0, child = false) {
    const def = this.weapons[w].def;
    const heat = this.hunter && this.hn('heatwave');
    const p: Pool = { x, y, r, r0: r, born: this.t, dmg, until: this.t + dur, tick: 0.15, w, every: this.hunter && this.hn('wildfire') ? (this.hn('delayedburn') ? 3 : 0.5) : 0.25, style: heat ? 'heat' : 'rain', follow: def.follow, fx: x - this.x, fy: y - this.y, target, child };
    this.pools.push(p);
    // Smoldering Ground: a pool of fire stays behind
    if (this.hunter && this.hn('smolder')) {
      const life = 8 * (this.hn('movingground') ? 2 : 1);
      this.pools.push({ x, y, r, r0: r, born: this.t, dmg, until: this.t + life, tick: 0.1, w, every: 0.5, style: 'fire', lit: new Set(), added: 0, nextPatch: this.t + 5 });
    }
    if (def.opener) {
      this.fx.push({ kind: 'zap', x, y, t: 0, dur: 0.35, r, color: def.color, text: 'arrows' });
      this.forEnemiesIn(x, y, r, (e) => this.hitEnemy(e, dmg * def.opener!, w, true, 200, x, y));
    }
  }

  /** Cloudburst: a kill in the rain opens a new cloud on the nearest foe. */
  private cloudburst(e: Enemy, w: number) {
    const owned = this.weapons[w];
    const def = owned.def;
    if (this.pools.filter((p) => p.w === w).length >= def.spawnOnKill!) return;
    const nx = this.nearest(e.x, e.y, 360, new Set([e.id]));
    if (!nx) return;
    const st = this.weaponStats(owned);
    this.openRain(nx.x, nx.y, 95 * st.area * 0.85, st.dmg * (1 + (def.spawnAmp ?? 0)), st.duration * 0.6, w, 0, true);
  }

  /** A mine goes off or a bear trap snaps. */
  private triggerTrap(p: Pool, e: Enemy) {
    const def = this.weapons[p.w]?.def;
    p.until = 0;
    p.armed = undefined;
    p.done = true;
    if (!def) return;
    if (def.snare) {
      // Bear Trap: hold the foe, hit it hard, and mark it Snared
      const hold = def.snareHold ?? 1.5;
      if (e.boss) e.slowUntil = Math.max(e.slowUntil, this.t + hold * 2);
      else e.stunUntil = Math.max(e.stunUntil ?? 0, this.t + hold);
      e.snareAmp = def.snareAmp ?? 0.25;
      e.snareUntil = this.t + hold + 2.5;
      this.fx.push({ kind: 'boom', x: e.x, y: e.y, t: 0, dur: 0.3, r: e.r + 26, color: '#c8ccd4' });
      this.fx.push({ kind: 'text', x: e.x, y: e.y - 20, t: 0, dur: 0.8, r: 0, color: '#c8ccd4', text: 'SNARED', crit: true });
      this.hitEnemy(e, p.dmg * def.snare, p.w, true);
      if (def.snareBleed && !e.dead) for (let k = 0; k < 5; k++) this.applyBleed(e, p.dmg * def.snare, false, { ...def, bleedHit: Math.max(0.5, def.bleedHit ?? 0) });
      if (def.tether && !e.dead) {
        this.fx.push({ kind: 'nova', x: e.x, y: e.y, t: 0, dur: 0.35, r: 260, color: '#c8ccd4', hits: new Set(), dmg: 0, slow: 0, w: -2 });
        this.forEnemiesIn(e.x, e.y, 260, (o) => {
          if (o === e || o.boss) return;
          const dx = e.x - o.x;
          const dy = e.y - o.y;
          const l = Math.hypot(dx, dy) || 1;
          const mv = Math.max(0, l - e.r - o.r);
          o.x += (dx / l) * mv * 0.85;
          o.y += (dy / l) * mv * 0.85;
          this.stun(o, 0.6);
        });
      }
      return;
    }
    // Landmine
    const R = p.r * 1.6 * (def.boomSize ?? 1);
    this.fx.push({ kind: 'boom', x: p.x, y: p.y, t: 0, dur: 0.4, r: R, color: '#ffb35c' });
    this.forEnemiesIn(p.x, p.y, R, (o) => {
      if (def.stun) this.stun(o, def.stun);
      this.hitEnemy(o, p.dmg * (def.mine ?? 6), p.w, true, 360, p.x, p.y);
    });
    if (def.shrapnel) this.throwShards(p.x, p.y, def.shrapnel, p.dmg * 1.6, p.w);
    if (def.chainMine) {
      // spikes stay behind, and any mine in reach goes off too
      this.pools.push({ x: p.x, y: p.y, r: p.r * 1.2, dmg: p.dmg, until: this.t + 2.5, tick: 0.1, w: p.w, every: 0.4, style: 'pool' });
      for (const q of this.pools) if (q.armed === 'mine' && dist2(q.x, q.y, p.x, p.y) < (R * 1.6) ** 2) this.triggerTrap(q, e);
    }
  }

  /** Small explosion from a sub-munition (no further procs). */
  private subBlast(x: number, y: number, r: number, dmg: number, w: number, color: string) {
    this.fx.push({ kind: 'boom', x, y, t: 0, dur: 0.25, r, color });
    this.sub = true;
    this.forEnemiesIn(x, y, r, (o) => this.hitEnemy(o, dmg, w, false, 120, x, y));
    this.sub = false;
  }

  /** Cluster: bomblets scatter around and go off a moment later. */
  private throwBomblets(x: number, y: number, n: number, dmg: number, w: number, gen: number) {
    const area = this.weapons[w] ? this.weapons[w].area * (1 + this.stats.area) : 1;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + this.rand() * 0.8;
      const d = (gen === 1 ? 70 : 45) + this.rand() * 70;
      this.falling.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, t: 0, dur: 0.3 + this.rand() * 0.25, r: (gen === 1 ? 52 : 38) * Math.sqrt(area), dmg, w, bomb: gen });
    }
  }

  /** Shrapnel: shards fly out of an explosion in a ring. */
  private throwShards(x: number, y: number, n: number, dmg: number, w: number) {
    const def = this.weapons[w]?.def;
    const a0 = this.rand() * Math.PI;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2;
      this.shots.push({
        kind: 'arrow', x, y, vx: Math.cos(a) * 700, vy: Math.sin(a) * 700, dmg, pierce: 1 + (def?.pierce ?? 0), r: 9, life: 0.45, hit: new Set(), w, enemy: false, target: 0, area: 1,
        dist: 0, back: false, range: 0, color: '#ffcf8a', sub: true, home: def?.homeShards, frag: def?.fragBlast,
      });
    }
  }

  /** Sticky Charge: a bomb in a foe that goes off after a fuse. */
  private plantCharge(e: Enemy, dmg: number, w: number, gen: number) {
    if (this.charges.some((c) => c.eid === e.id)) return;
    const owned = this.weapons[w];
    const def = owned.def;
    const r = 105 * owned.area * (1 + this.stats.area) * (def.boomSize ?? 1) * (def.shaped ? 0.6 : 1);
    this.charges.push({ eid: e.id, x: e.x, y: e.y, t: (def.fuse ?? 1.2) + (def.shaped ? 0.5 : 0), dmg, r, w, gen });
  }

  private updateCharges(dt: number) {
    if (!this.charges.length) return;
    for (const c of this.charges) {
      const e = this.enemies.find((o) => o.id === c.eid);
      if (e && !e.dead) {
        c.x = e.x;
        c.y = e.y;
        c.t -= dt;
      } else c.t = 0; // its foe died: blow up right away
      if (c.t > 0) continue;
      const def = this.weapons[c.w]?.def;
      this.fx.push({ kind: 'boom', x: c.x, y: c.y, t: 0, dur: 0.45, r: c.r, color: '#ff8c42' });
      this.fx.push({ kind: 'text', x: c.x, y: c.y - 30, t: 0, dur: 0.8, r: 0, color: '#ff8c42', text: 'BOOM', crit: true });
      this.sub = true;
      this.forEnemiesIn(c.x, c.y, c.r, (o) => {
        const stuck = o.id === c.eid;
        // Shaped Charge: everything goes into the foe it's in
        const d = def?.shaped ? (stuck ? c.dmg * 2 : c.dmg * 0.2) : stuck ? c.dmg : c.dmg * 0.45;
        this.hitEnemy(o, d * (def?.demolish && o.boss ? 1.5 : 1), c.w, true, 380, c.x, c.y);
        if (def?.demolish && !o.boss && !o.dead && o.hp < o.maxHp * def.demolish) {
          if (this.weapons[c.w]) this.weapons[c.w].total += o.hp;
          o.hp = 0;
          this.kill(o);
          this.fx.push({ kind: 'text', x: o.x, y: o.y, t: 0, dur: 0.6, r: 0, color: '#ff6b6b', text: 'X', crit: true });
        }
      });
      this.sub = false;
      // forms that hang off the explosion: bomblets, shards, a stunning shockwave
      if (def?.stun) this.forEnemiesIn(c.x, c.y, c.r, (o) => this.stun(o, def.stun!));
      if (def?.cluster) this.throwBomblets(c.x, c.y, def.cluster, c.dmg * 0.12, c.w, 1);
      if (def?.shrapnel) this.throwShards(c.x, c.y, def.shrapnel, c.dmg * 0.05, c.w);
      // Chain Detonation: plant a new charge on the nearest foe
      if (def?.restick && c.gen === 0) {
        const nx = this.nearest(c.x, c.y, 380, new Set([c.eid]));
        if (nx) this.plantCharge(nx, c.dmg * 0.5, c.w, 1);
      }
    }
    this.charges = this.charges.filter((c) => c.t > 0);
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
    this.xp += v * this.testXp;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = xpToNext(this.level);
      this.pendingLevels++;
    }
  }

  private updateObjects(dt: number) {
    // the lair: E at the door to go in, E at the exit portal once King Jelly is down
    if (!this.inLair && !this.inCave && dist2(this.caveDoor.x, this.caveDoor.y, this.x, this.y) < 90 * 90) {
      if (this.input.interact) this.enterCave();
    } else if (this.inCave && this.map.exit && dist2(this.map.exit.x, this.map.exit.y, this.x, this.y) < 90 * 90) {
      if (this.input.interact) this.exitCave();
    } else if (!this.inLair && !this.inCave && !this.lairCleared && dist2(this.lairDoor.x, this.lairDoor.y, this.x, this.y) < 90 * 90) {
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
        if (this.hunter) continue; // test hero: no boons
        this.choiceTitle = 'Shrine boon';
        this.choices = this.makeShrineChoices();
      }
    }
  }

  private openChest(c: Chest) {
    if (this.hunter) {
      // test hero: no items, just a little gold back
      this.gold += 5;
      return;
    }
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
      spawnT: 0.4, z: 0, marked: false, burnDps: 0, burnUntil: 0, bleedStacks: 0, bleedPer: 0, bleedUntil: 0, bleedShow: 0, bleedShowT: 0, shockUntil: 0, frozenUntil: 0, burnShow: 0, burnShowT: 0,
    };
    this.enemies.push(e);
    return e;
  }
  // ---------------------------------------------------------------- training cave (testing)
  /** Walk into the training cave: the world waits outside, the run clock pauses. */
  enterCave() {
    if (this.inCave || this.inLair) return;
    this.world = { map: this.map, enemies: this.enemies, pickups: this.pickups, chests: this.chests, shrines: this.shrines, boss: this.boss, x: this.x, y: this.y };
    this.enemies = [];
    this.pickups = [];
    this.chests = [];
    this.shrines = [];
    this.shots = [];
    this.pools = [];
    this.falling = [];
    this.charges = [];
    this.telegraphs = [];
    this.boss = null;
    this.map = generateTrainingCave();
    this.x = this.map.entrances[0].x;
    this.y = this.map.entrances[0].y;
    this.inCave = true;
    for (const a of this.allies) {
      a.x = this.x;
      a.y = this.y;
    }
    this.notice('The training cave. Mobs keep coming on their own; use the panel to change their HP or bring more.', '#8fb8ff', '🕳️');
  }
  exitCave() {
    if (!this.inCave || !this.world) return;
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
    this.charges = [];
    this.telegraphs = [];
    this.inCave = false;
    this.world = null;
    for (const a of this.allies) {
      a.x = this.x;
      a.y = this.y;
    }
  }
  /** Mob HP multiplier in the cave; mobs already there are scaled too. */
  setCaveHp(m: number) {
    const k = m / this.caveHp;
    this.caveHp = m;
    if (!this.inCave) return;
    for (const e of this.enemies)
      if (!e.dead && !e.boss) {
        e.hp *= k;
        e.maxHp *= k;
      }
  }
  /** Bring n more mobs (or elites) into the cave right away. */
  caveSpawn(n: number, elite = false) {
    if (!this.inCave) return;
    for (let i = 0; i < n; i++) {
      if (this.enemies.length >= RUN.maxEnemies + 200) break;
      const def = this.pickEnemyDef();
      const p = this.spawnPoint(def.r * (elite ? ELITE.rMult : 1));
      if (p) this.enemies.push(this.makeEnemy(def, p.x, p.y, elite));
    }
  }
  /** Clear every mob in the cave (no EXP). */
  caveClear() {
    if (!this.inCave) return;
    this.enemies = [];
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
    this.charges = [];
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
    this.charges = [];
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
      (c.kind === 'advance' || c.kind === 'talent' || c.kind === 'path' ? 20 + this.rand() : c.kind === 'newWeapon' ? 5 : c.kind === 'weapon' ? 4 : c.kind === 'newPassive' ? 3.5 : 3) + RUN_RARITIES.indexOf(c.rarity) * 0.8 + (c.id === 'glass' ? -2 : 0);
    let best = 0;
    this.choices.forEach((c, i) => {
      if (score(c) > score(this.choices![best])) best = i;
    });
    this.pick(best);
  }
}
