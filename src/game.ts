import {
  BALANCE, COMPANION, COMPANIONS, GROWTH, GrowthKey, JobDef, MobStats, RARITIES, Rarity, SLOTS,
  Slot, TALENT_TREES, TIERS, TIER_WEIGHTS, ZONES, CAVE, FOCUS, MANA, BOSS_MOVE_PCT, SPLIT, EVADE, phaseAt, SkillDef, BossMove, bossName, bossPctScale, jobOf, companionHitMult, dealtLevelMult, enhanceCopies,
  expLevelMult, expToNext, gearId, gearScore, mobForZone, parseGear, takenLevelMult,
} from './data';
import {
  GameMap, PHYS, TILE, depthInZone, findPath, fits, generateCave, generateLair, generateWorld, lineOfSight, moveCircle, walkablePoint,
  zoneAtX,
} from './map';
import { GameState } from './state';
import { Stats, computeStats, talentBlocked } from './stats';

// ---------------- Types ----------------

export interface Vec {
  x: number;
  y: number;
}

/** Player input for one frame, already converted to world space. Empty in the simulator. */
export interface Input {
  moveX: number; // world-space direction, length <= 1
  moveY: number;
  attack: boolean;
  aim: Vec | null; // world point under the mouse (null on touch / keyboard only)
  skills: boolean[]; // one-shot presses, cleared by the game after reading
  evade: boolean; // Space: one-shot press
}

export function emptyInput(): Input {
  return { moveX: 0, moveY: 0, attack: false, aim: null, skills: [false, false, false], evade: false };
}

export interface Player {
  x: number;
  y: number;
  r: number;
  angle: number; // facing / aim direction (radians, world space)
  moving: boolean;
  dash: { tx: number; ty: number; t: number } | null;
}

type MobState = 'idle' | 'chase' | 'windup' | 'recover' | 'charge';

export interface Mob extends MobStats {
  id: number;
  /** Spawn camp it belongs to (-1 for boss adds). */
  camp: number;
  zone: number;
  maxHp: number;
  x: number;
  y: number;
  r: number;
  angle: number;
  state: MobState;
  timer: number;
  homeX: number;
  homeY: number;
  wander: Vec;
  path: Vec[] | null;
  pathTimer: number;
  hitFlash: number;
  spawnAnim: number;
  moving: boolean;
  actionTimer: number; // boss: time until next special
  phase: number; // boss: 0, 1, 2
  /** Bleed stacks: damage per tick and ticks left. */
  bleeds: { tick: number; left: number }[];
  bleedTimer: number;
  /** Armor shred stacks (each = +shredPct damage taken). */
  shred: number;
  shredPct: number;
  shredTimer: number;
  /** Boss stagger meter (0..100) and when the current stagger ends. */
  stagger: number;
  staggerUntil: number;
  staggers: number;
  invuln: number; // boss: phase-change roar
  chargeTo: Vec | null;
  /** Split bosses: id of the original (0 = not split-capable), generation and last time it was hit. */
  group: number;
  gen: number;
  lastHitAt: number;
  /** Split-off slimes: current hop through the air and time until the next one. */
  hop: { fx: number; fy: number; tx: number; ty: number; t: number; dur: number } | null;
  hopTimer: number;
  gooDist: number;
}

/** An expanding ring of slime from a main-slime slam. Gaps (angles) are safe; it hits once. */
export interface Wave {
  x: number;
  y: number;
  r: number;
  gaps: number[];
  hit: boolean;
  ownerId: number;
  level: number;
  damage: number;
  pct: number;
}

/** A sticky puddle left by split slimes. */
export interface Goo {
  x: number;
  y: number;
  r: number;
  life: number;
}

export interface Telegraph {
  kind: 'circle' | 'cone' | 'line' | 'ring' | 'square'; // square: r is half the side, axis-aligned
  x: number;
  y: number;
  r: number; // circle/ring radius, cone/line length
  inner: number; // ring inner radius
  angle: number;
  width: number; // cone: half-angle (rad); line: width
  time: number;
  total: number;
  damage: number;
  /** Boss attacks: share of your max HP they take (whichever is bigger: this or `damage`). */
  pct: number;
  /** Seconds before it appears (for attack sequences). */
  wait: number;
  /** When it appears, re-centre it on the hero (chasing slams). */
  follow: boolean;
  /** Telegraphs from one volley share this id and hit you at most once. */
  volley?: number;
  /** Slime landings draw differently: 'landing' (split-offs) or 'wave' (crowned slime, rings follow). */
  style?: 'landing' | 'wave' | 'spout';
  /** AUTO only: seconds after it appears before AUTO reacts, and whether AUTO misses it entirely. */
  noticeAt?: number;
  unnoticed?: boolean;
  boss: boolean;
  ownerId: number;
}

export interface FloatText {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  life: number;
  size: number;
}

export interface Effect {
  kind: 'ring' | 'slash' | 'star' | 'bolt' | 'poof' | 'dash' | 'blast';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  r: number;
  angle?: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface Companion {
  id: string;
  x: number;
  y: number;
  timer: number;
  hit: number;
}

interface PendingBlast {
  x: number;
  y: number;
  r: number;
  time: number;
  damage: number;
  color: string;
  label?: string;
}

export interface Projectile {
  x: number;
  y: number;
  angle: number;
  speed: number;
  traveled: number;
  maxDist: number;
  damage: number;
  kind: 'arrow' | 'bolt' | 'fireball';
  color: string;
  splash: number;
  pierce: boolean;
  label?: string;
  hit: number[];
  src: DmgSrc;
  /** Marksman Deadeye arrow. */
  empowered?: boolean;
  seeking?: boolean;
  bleedShare?: number;
}

/** Where a hit came from (talents care: bleeds come from basic attacks, etc.). */
export type DmgSrc = 'basic' | 'skill' | 'bleed' | 'companion' | 'proc';

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

interface Camp {
  x: number;
  y: number;
  zone: number;
  mob: number | null;
  timer: number;
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

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const angleTo = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);
const angDiff = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const COMBAT = {
  attackHalfAngle: 1.05, // ~60 degrees each side
  dashSpeed: 1100,
  dashWidth: 55,
  kiteDistance: 120, // ranged AUTO backs away from monsters closer than this
  mobWindup: 0.5,
  mobRecover: 0.6,
  mobReach: 26, // beyond touching
  bossActionEvery: 2.3,
  telegraphDamageMult: 2.2,
  aiReaction: 0.35, // seconds before AUTO starts dodging a telegraph
};

// ---------------- Game ----------------

export class Game {
  state: GameState;
  stats!: Stats;
  rand: () => number;
  time = 0;

  map!: GameMap;
  private worldMap!: GameMap;
  private worldMobs: Mob[] = [];
  private lairs = new Map<number, GameMap>();
  /** Which boss lair the hero is inside (-1 = out in the world). */
  inLair = -1;
  /** Set when the lair visit came from "Fight boss": AUTO summons, fights and walks back out. */
  private lairAuto = false;
  private lairDoneAt = -1;
  /** Zone the hero is standing in (inside a lair: that lair's zone). */
  zone = 0;
  player: Player;
  hp = 0;
  mobs: Mob[] = [];
  telegraphs: Telegraph[] = [];
  private blasts: PendingBlast[] = [];
  projectiles: Projectile[] = [];
  private nextMobId = 1;
  /** Fixed spawn camps spread evenly through each zone; each respawns its own monster. */
  private camps: Camp[] = [];
  private worldCamps: Camp[] = [];
  private caveMap: GameMap | null = null;
  /** Inside the Echoing Hollow (manual-only cave). */
  inCave = false;
  private bossCooldown: number[] = ZONES.map(() => 0);
  private bossZone = -1;
  private lockedToastAt = -99;
  /** Where AUTO is walking to (zone travel / boss altar), if anywhere. */
  travelGoal: { x: number; y: number; boss: number | null; label: string; cave?: boolean } | null = null;
  /** Rolling EXP log for the EXP/hour readout. */
  private expLog: { t: number; exp: number }[] = [];
  private aimHold = 0;
  /** Healing flasks. Refill when you enter a lair and slowly out in the world. */
  flasks = BALANCE.flaskCharges;
  private flaskRegen = 0;
  private flaskCd = 0;
  enraged = false;
  /** Slime goo on the ground, and when the hero is rooted / immune to roots. */
  goo: Goo[] = [];
  waves: Wave[] = [];
  /** Space ability: cooldown left, and when parry / sprint end. */
  evadeCd = 0;
  /** Slowed by a slime wave until this time. */
  slowUntil = 0;
  /** Ring hits taken this fight; SPLIT.waveLethal of them kills you. */
  slimeStacks = 0;
  /** Set by the UI (not the sim): after dying to a boss, wait for Respawn / Fight again instead of auto-respawning. */
  offerRetry = false;
  /** The lair whose boss killed you, while the choice is on screen (-1 = none). */
  retryZone = -1;
  get awaitingChoice(): boolean {
    return this.retryZone >= 0 && this.deadTimer <= 0 && this.hp <= 0;
  }
  get slowed(): boolean {
    return this.time < this.slowUntil;
  }
  parryUntil = 0;
  sprintUntil = 0;
  /** Last phase globes: the clear spots and when they expire (AUTO heads for one). */
  safeSpots: Vec[] = [];
  safeUntil = 0;
  private volleyHit = new Set<number>();
  private nextVolley = 1;
  private globeParity = 0;
  rootedUntil = 0;
  rootImmuneUntil = 0;
  get rooted(): boolean {
    return this.time < this.rootedUntil;
  }
  /** Smoothed player velocity (world units/s), used by split slimes to lead their attacks. */
  pVel: Vec = { x: 0, y: 0 };
  private pPrev: Vec | null = null;
  /** Mage mana and Arcane Charges. */
  mana = 0;
  charges = 0;
  private wardUntil = 0;
  private fluxCd = 0;
  private basicCount = 0;
  private manaToastAt = -99;
  /** Marksman: Focus meter and Deadeye (empowered arrows). */
  focus = 0;
  deadeye = false;
  deadeyeEnd = 0;
  /**
   * How AUTO handles boss telegraphs: base reaction time, random extra delay, and the chance
   * it doesn't notice one at all. Tuned to play like a distracted average player; the boss
   * trial tool sets these lower to imitate a skilled one.
   */
  aiReaction = COMBAT.aiReaction;
  aiJitter = 0.6;
  aiMiss = 0.2;
  bossTimer = 0;
  deadTimer = 0;
  playerTimer = 0;
  skillCd: Record<string, number> = {};
  party: Companion[] = [];

  input: Input = emptyInput();
  lastInputTime = -999;
  private target: Mob | null = null;
  private targetTime = 0;
  private ignore = new Map<number, number>();
  private path: Vec[] | null = null;
  private pathTimer = 0;
  private pathGoal: Vec | null = null;

  floats: FloatText[] = [];
  effects: Effect[] = [];
  anim = { swing: 0, playerHit: 0, flash: 0, flashColor: '#fff' };

  dirty = true;
  onToast: (msg: string, color?: string) => void = () => {};

  constructor(state: GameState, rand: () => number = Math.random) {
    this.state = state;
    this.rand = rand;
    this.player = { x: 0, y: 0, r: PHYS.playerRadius, angle: 0.8, moving: false, dash: null };
    this.recalc();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
    for (const s of this.job.skills) this.skillCd[s.id] = s.cd * 0.5;
    this.initWorld();
    this.syncParty();
  }

  recalc() {
    const prevMax = this.stats?.maxHp ?? 0;
    this.stats = computeStats(this.state);
    this.mana = Math.min(this.mana, this.stats.maxMana);
    if (prevMax > 0) this.hp = Math.min(this.stats.maxHp, this.hp + Math.max(0, this.stats.maxHp - prevMax));
    this.syncParty();
    this.dirty = true;
  }

  get inBossFight(): boolean {
    return this.mobs.some((m) => m.boss);
  }

  get job(): JobDef {
    return jobOf(this.state);
  }

  /** AUTO is always off inside the manual-only cave. */
  get auto(): boolean {
    return this.state.settings.auto && !this.inCave;
  }

  setAuto(on: boolean) {
    if (this.inCave) {
      this.onToast('AUTO does not work in the Echoing Hollow. This one is all you.', '#ff8c3b');
      return;
    }
    this.state.settings.auto = on;
    this.dirty = true;
  }

  get manualActive(): boolean {
    return !this.auto || this.time - this.lastInputTime < PHYS.manualTimeout;
  }

  private initWorld() {
    this.map = this.worldMap = generateWorld(ZONES.length);
    const saved = this.state.pos;
    if (saved && fits(this.map, saved.x, saved.y, PHYS.playerRadius)) Object.assign(this.player, { x: saved.x, y: saved.y });
    else Object.assign(this.player, this.map.entrances[0]);
    this.zone = zoneAtX(this.map, this.player.x);
    // populate every zone so the world feels alive
    this.buildCamps();
    this.worldCamps = this.camps;
    for (const c of this.camps) this.spawnAtCamp(c);
  }

  // ---------------- The Echoing Hollow (manual-only cave) ----------------
  /** AUTO walks you to the cave mouth and in. AUTO switches off inside. */
  goToCave() {
    if (this.inLair >= 0) this.exitLair();
    if (this.inCave) return;
    const c = this.worldMap.cave;
    if (!c) return;
    this.travelGoal = { x: c.x, y: c.y, boss: null, label: CAVE.name, cave: true };
    this.target = null;
    this.path = null;
    if (!this.state.settings.auto) this.setAuto(true);
  }

  private checkCaveMouth() {
    const c = this.map.cave;
    if (!c || dist(c, this.player) > 75) return;
    if (!this.manualActive && !this.travelGoal?.cave) return;
    this.enterCave();
  }

  private enterCave() {
    if (!this.caveMap) this.caveMap = generateCave();
    this.worldMobs = this.mobs;
    this.mobs = [];
    this.map = this.caveMap;
    this.inCave = true;
    this.zone = CAVE.zone;
    this.resetTransient();
    Object.assign(this.player, { ...this.map.entrances[0], angle: 0 });
    for (const c of this.party) Object.assign(c, { x: this.player.x, y: this.player.y });
    // fresh camps every visit, spread through the tunnels
    const floor = this.map.zoneFloor[0];
    const n = BALANCE.caveCamps;
    const camps: Camp[] = [];
    for (let k = 0; k < n; k++) {
      const lo = (10 + ((this.map.w - 12) * k) / n) * TILE;
      const hi = (10 + ((this.map.w - 12) * (k + 1)) / n) * TILE;
      const pool = floor.filter((i) => {
        const x = ((i % this.map.w) + 0.5) * TILE;
        return x >= lo && x < hi;
      });
      if (!pool.length) continue;
      const i = pool[Math.floor(this.rand() * pool.length)];
      const tx = i % this.map.w;
      camps.push({ x: (tx + 0.5) * TILE, y: ((i - tx) / this.map.w + 0.5) * TILE, zone: CAVE.zone, mob: null, timer: 0 });
    }
    this.camps = camps;
    for (const c of camps) this.spawnAtCamp(c);
    this.lastInputTime = this.time;
    this.onToast(`You enter the ${CAVE.name}. AUTO is off in here, but every kill gives ${BALANCE.caveExpMult}x EXP.`, '#c9a227');
    this.dirty = true;
  }

  exitCave() {
    if (!this.inCave) return;
    this.map = this.worldMap;
    this.mobs = this.worldMobs;
    this.worldMobs = [];
    this.camps = this.worldCamps;
    this.inCave = false;
    this.resetTransient();
    Object.assign(this.player, this.outsideCave());
    for (const c of this.party) Object.assign(c, { x: this.player.x, y: this.player.y });
    this.zone = zoneAtX(this.map, this.player.x);
    this.dirty = true;
  }

  private outsideCave(): Vec {
    const c = this.worldMap.cave!;
    for (const d of [140, 180, 110, 220])
      for (const a of [Math.PI / 2, Math.PI / 3, (2 * Math.PI) / 3, 0, Math.PI]) {
        const p = { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
        if (fits(this.worldMap, p.x, p.y, PHYS.playerRadius)) return p;
      }
    return { ...this.worldMap.entrances[0] };
  }

  /** Cave monsters match your level, up to a couple of levels higher deeper in. */
  private caveLevel(x: number): number {
    const depth = Math.max(0, Math.min(1, x / (this.map.w * TILE)));
    return this.state.level + Math.round(BALANCE.caveLevelBonus * depth);
  }

  /** Monster level at a spot: rises from the zone's min level at the entrance to its max at the far end. */
  levelAt(x: number): number {
    const z = zoneAtX(this.map, x);
    const d = ZONES[z];
    return Math.round(d.minLevel + (d.maxLevel - d.minLevel) * depthInZone(this.map, x));
  }

  /** Is the boss of zone z available to fight (previous bosses beaten, not on cooldown)? */
  bossStatus(z: number): 'locked' | 'ready' | 'cooldown' | 'fighting' {
    if (this.bossZone === z) return 'fighting';
    if (z > this.state.bossesCleared) return 'locked';
    if (this.bossCooldown[z] > 0) return 'cooldown';
    return 'ready';
  }

  bossCooldownLeft(z: number): number {
    return Math.max(0, this.bossCooldown[z]);
  }

  /** EXP gained in the last few minutes, scaled to one hour. */
  expPerHour(): number {
    const window = Math.min(300, this.time);
    if (window < 20) return 0;
    const sum = this.expLog.filter((e) => e.t >= this.time - window).reduce((a, e) => a + e.exp, 0);
    return (sum / window) * 3600;
  }

  /** AUTO walks to a zone's entrance. */
  travelToZone(z: number) {
    if (this.inCave) this.exitCave();
    if (this.inLair >= 0) this.exitLair();
    const e = this.map.entrances[z];
    if (!e) return;
    this.travelGoal = { x: e.x, y: e.y, boss: null, label: ZONES[z].name };
    this.target = null;
    this.path = null;
    if (!this.auto) this.setAuto(true);
  }

  /** AUTO walks to a zone's boss lair, goes in, summons the boss and fights it. */
  goToBoss(z: number) {
    if (this.inLair === z) {
      this.lairAuto = true;
      if (!this.auto) this.setAuto(true);
      return;
    }
    if (this.inCave) this.exitCave();
    if (this.inLair >= 0) this.exitLair();
    const a = this.map.altars[z];
    if (!a) return;
    this.travelGoal = { x: a.x, y: a.y, boss: z, label: `${bossName(z)}'s lair` };
    this.target = null;
    this.path = null;
    if (!this.auto) this.setAuto(true);
  }

  cancelTravel() {
    this.travelGoal = null;
    this.path = null;
    this.lairAuto = false;
  }

  /** What the summoning circle needs. Empty offerings = free for now. */
  summonCheck(z: number): { ok: boolean; missing: string[] } {
    const missing = ZONES[z].offering
      .filter((o) => (this.state.items[o.item] ?? 0) < o.count)
      .map((o) => `${o.count}× ${o.item}`);
    return { ok: missing.length === 0, missing };
  }

  /** Summon the lair's boss (you must be inside its lair). Returns a reason if it can't. */
  summonBoss(phase = 0): string | null {
    const z = this.inLair;
    if (z < 0) return 'You need to be inside a boss lair.';
    const st = this.bossStatus(z);
    if (st === 'fighting') return 'The boss is already here!';
    if (st === 'locked') return `Sealed. Defeat ${bossName(z - 1)} first.`;
    if (st === 'cooldown') return `The boss is gathering strength. Try again in ${Math.ceil(this.bossCooldown[z])}s.`;
    const chk = this.summonCheck(z);
    if (!chk.ok) return `You need to offer: ${chk.missing.join(', ')}.`;
    for (const o of ZONES[z].offering) this.state.items[o.item] -= o.count;
    this.startBoss(z);
    this.skipToPhase(phase);
    return null;
  }

  // ---------------- Talents ----------------
  /** Spend a point on a talent. Returns a reason if it can't. */
  allocateTalent(id: string): string | null {
    const why = talentBlocked(this.state, id);
    if (why) return why;
    this.state.talents[id] = (this.state.talents[id] ?? 0) + 1;
    this.recalc();
    return null;
  }

  /** Refund every talent point (free for now). */
  resetTalents() {
    this.state.talents = {};
    this.charges = 0;
    this.recalc();
  }

  /** Spends all free points top to bottom through the tree (used by idle players and the sim). */
  autoAssignTalents(): number {
    let spent = 0;
    const nodes = [...TALENT_TREES[this.job.id].nodes].sort((a, b) => a.tier - b.tier || a.col - b.col);
    let progress = true;
    while (progress) {
      progress = false;
      for (const n of nodes) {
        if (!talentBlocked(this.state, n.id)) {
          this.state.talents[n.id] = (this.state.talents[n.id] ?? 0) + 1;
          spent++;
          progress = true;
        }
      }
    }
    if (spent) this.recalc();
    return spent;
  }

  // ---------------- Testing tools ----------------
  /** Testing: jump straight to a level (EXP bar resets). */
  setLevel(level: number) {
    this.state.level = Math.max(1, Math.min(200, Math.round(level)));
    this.state.exp = 0;
    this.recalc();
    this.hp = this.stats.maxHp;
    this.target = null;
    this.dirty = true;
  }

  /** Testing: invincible and 10x damage. */
  setTestMode(on: boolean) {
    this.state.settings.testMode = on;
    if (on) this.hp = this.stats.maxHp;
    this.dirty = true;
  }

  get parrying(): boolean {
    return this.time < this.parryUntil;
  }
  get sprinting(): boolean {
    return this.time < this.sprintUntil;
  }

  /**
   * The Space ability. `dir` is used by AUTO; players blink toward where they're moving (or aiming).
   * Returns a reason if it can't be used.
   */
  useEvade(dir?: Vec): string | null {
    if (this.evadeCd > 0) return `${this.job.evade.name} is ready in ${Math.ceil(this.evadeCd)}s.`;
    const p = this.player;
    const ev = this.job.evade;
    if (ev.kind === 'parry') {
      this.parryUntil = this.time + EVADE.parryWindow;
      this.effect('ring', p.x, p.y, 70, ev.color, EVADE.parryWindow);
    } else if (ev.kind === 'sprint') {
      if (this.rooted) return 'You are stuck!';
      this.sprintUntil = this.time + EVADE.sprintTime;
      this.effect('ring', p.x, p.y, 60, ev.color, 0.4);
    } else {
      let a = p.angle;
      if (dir && (dir.x || dir.y)) a = Math.atan2(dir.y, dir.x);
      else if (this.input.moveX || this.input.moveY) a = Math.atan2(this.input.moveY, this.input.moveX);
      // as far as possible up to blinkDist, on open floor with a clear line (no blinking through walls)
      let to: Vec | null = null;
      for (let d = EVADE.blinkDist; d >= 30; d -= 15) {
        const x = p.x + Math.cos(a) * d;
        const y = p.y + Math.sin(a) * d;
        if (fits(this.map, x, y, p.r) && lineOfSight(this.map, p.x, p.y, x, y)) {
          to = { x, y };
          break;
        }
      }
      if (!to) return 'No room to blink there.';
      this.effect('poof', p.x, p.y, 40, ev.color, 0.4);
      p.x = to.x;
      p.y = to.y;
      p.dash = null;
      this.rootedUntil = 0;
      this.effect('poof', p.x, p.y, 40, ev.color, 0.4);
    }
    this.evadeCd = EVADE.cd;
    return null;
  }

  /** Warrior parry: the blocked hit turns into a counterattack around you. */
  private counter() {
    const p = this.player;
    this.parryUntil = 0;
    this.float(p.x, p.y, 70, 'Parried!', '#ffd166', 20);
    this.effect('ring', p.x, p.y, EVADE.counterRange, '#ffd166', 0.45);
    for (const m of [...this.mobs]) {
      if (dist(m, p) <= EVADE.counterRange + m.r) this.damage(m, this.stats.atk * EVADE.counterMult, 'Counter', '#ffd166');
    }
  }

  /** AUTO's use of the Space ability while dodging a boss attack it can see coming. */
  private autoEvade(dodgeDir: Vec, threats: Telegraph[]) {
    if (this.evadeCd > 0) return;
    const p = this.player;
    const kind = this.job.evade.kind;
    const hitting = threats.filter((t) => this.inTelegraph(t, p, p.r));
    if (!hitting.length) return;
    const soonest = Math.min(...hitting.map((t) => t.time));
    if (kind === 'parry') {
      if (soonest < 0.3) this.useEvade();
    } else if (kind === 'sprint') {
      if (!this.rooted) this.useEvade();
    } else if (soonest < 0.6 || this.rooted) {
      if (dodgeDir.x || dodgeDir.y) this.useEvade(dodgeDir);
    }
  }

  /** After dying to a boss: go back to the zone like normal. */
  respawnNow() {
    if (this.retryZone < 0) return;
    this.retryZone = -1;
    this.hp = this.stats.maxHp;
    if (this.inLair >= 0) this.exitLair();
    Object.assign(this.player, { ...this.map.entrances[this.zone], dash: null });
    this.dirty = true;
  }

  /** After dying to a boss (testing): full HP and flasks, a fresh boss at once, starting in `phase` (0-2). */
  retryBoss(phase = 0) {
    const z = this.retryZone;
    if (z < 0) return;
    this.retryZone = -1;
    this.deadTimer = 0;
    this.hp = this.stats.maxHp;
    if (this.inLair !== z) {
      if (this.inLair >= 0) this.exitLair();
      this.enterLair(z);
    } else {
      this.resetTransient();
      Object.assign(this.player, { ...this.map.entrances[0], angle: -2.36, dash: null });
      this.flasks = BALANCE.flaskCharges;
    }
    this.bossCooldown[z] = 0;
    this.startBoss(z);
    this.skipToPhase(phase);
  }

  /** Testing: start the boss fight in phase 2 or 3 (health just under that threshold, splits and all). */
  private skipToPhase(phase: number) {
    if (phase <= 0) return;
    const boss = this.mobs.find((m) => m.boss);
    if (!boss) return;
    boss.hp = boss.maxHp * phaseAt(boss.zone)[Math.min(1, phase - 1)] - 1;
    this.checkPhase(boss);
    for (const b of this.mobs) if (b.boss) b.hp = boss.hp;
  }

  /** Drink a healing flask. Returns false if none are left (or you just drank). */
  drinkFlask(): boolean {
    if (this.flasks <= 0 || this.flaskCd > 0 || this.deadTimer > 0 || this.hp >= this.stats.maxHp) return false;
    this.flasks--;
    this.flaskCd = 1.2;
    const heal = this.stats.maxHp * BALANCE.flaskHeal;
    this.hp = Math.min(this.stats.maxHp, this.hp + heal);
    this.float(this.player.x, this.player.y, 50, '+' + fmtDmg(heal), '#4caf50', 16);
    this.effect('ring', this.player.x, this.player.y, 60, '#4caf50', 0.5);
    this.dirty = true;
    return true;
  }

  private enterLair(z: number) {
    if (!this.lairs.has(z)) this.lairs.set(z, generateLair(ZONES[z].chapter));
    this.worldMobs = this.mobs;
    this.mobs = [];
    this.map = this.lairs.get(z)!;
    this.inLair = z;
    this.zone = z;
    this.resetTransient();
    Object.assign(this.player, { ...this.map.entrances[0], angle: -2.36 });
    for (const c of this.party) Object.assign(c, { x: this.player.x, y: this.player.y });
    this.lairDoneAt = -1;
    this.flasks = BALANCE.flaskCharges;
    this.onToast(`You enter ${bossName(z)}'s lair. Flasks refilled.`, '#c9a227');
    this.dirty = true;
  }

  /** Back out to the world, standing just outside the lair door. */
  exitLair() {
    const z = this.inLair;
    if (z < 0) return;
    if (this.inBossFight) this.failBoss('You fled the lair.');
    this.map = this.worldMap;
    this.mobs = this.worldMobs;
    this.worldMobs = [];
    this.inLair = -1;
    this.lairAuto = false;
    this.resetTransient();
    const door = this.map.altars[z];
    const spot = this.outsideDoor(z);
    Object.assign(this.player, spot);
    for (const c of this.party) Object.assign(c, { x: spot.x, y: spot.y });
    this.zone = zoneAtX(this.map, door.x);
    this.dirty = true;
  }

  /** A walkable spot just west of a lair door (where you appear when leaving). */
  private outsideDoor(z: number): Vec {
    const door = this.worldMap.altars[z];
    for (const d of [190, 230, 160, 270]) {
      for (const a of [Math.PI, Math.PI * 0.75, Math.PI * 1.25, Math.PI / 2, -Math.PI / 2]) {
        const p = { x: door.x + Math.cos(a) * d, y: door.y + Math.sin(a) * d };
        if (fits(this.worldMap, p.x, p.y, PHYS.playerRadius)) return p;
      }
    }
    return { ...this.worldMap.entrances[z] };
  }

  private resetTransient() {
    this.goo = [];
    this.waves = [];
    this.slowUntil = 0;
    this.slimeStacks = 0;
    this.rootedUntil = 0;
    if (this.deadeye) this.endDeadeye();
    this.telegraphs = [];
    this.blasts = [];
    this.projectiles = [];
    this.target = null;
    this.path = null;
    this.travelGoal = null;
    this.player.dash = null;
  }

  private syncParty() {
    const ids = this.state.party.filter((x): x is string => !!x && !!this.state.companions[x]);
    const existing = new Map(this.party.map((c) => [c.id, c]));
    const px = this.player?.x ?? 0;
    const py = this.player?.y ?? 0;
    this.party = ids.map((id, i) => existing.get(id) ?? { id, x: px, y: py, timer: 0.3 * i, hit: 0 });
  }

  // ---------------- Main loop ----------------
  update(dt: number) {
    this.time += dt;
    this.decayVisuals(dt);

    const inp = this.input;
    if (inp.moveX || inp.moveY || inp.attack || inp.evade || inp.skills.some(Boolean)) this.lastInputTime = this.time;
    this.evadeCd -= dt;
    if (inp.evade) {
      inp.evade = false;
      if (this.deadTimer <= 0) {
        const why = this.useEvade();
        if (why) this.onToast(why, '#9a9a9a');
      }
    }

    if (this.awaitingChoice) {
      inp.skills = inp.skills.map(() => false);
      return;
    }
    if (this.deadTimer > 0) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0 && this.retryZone >= 0) {
        this.hp = 0; // wait for the player's choice
        inp.skills = inp.skills.map(() => false);
        return;
      }
      if (this.deadTimer <= 0) {
        this.hp = this.stats.maxHp;
        if (this.inCave) this.exitCave(); // you wake up outside the cave
        else {
          if (this.inLair >= 0) this.exitLair();
          Object.assign(this.player, { ...this.map.entrances[this.zone], dash: null });
        }
      }
      inp.skills = inp.skills.map(() => false);
      return;
    }

    this.aimHold -= dt;
    this.flaskCd -= dt;
    this.fluxCd -= dt;
    if (this.stats.maxMana > 0) this.mana = Math.min(this.stats.maxMana, this.mana + this.stats.manaRegen * dt);
    this.tickDots(dt);
    this.updateFocus();
    if (this.inLair < 0 && this.flasks < BALANCE.flaskCharges) {
      this.flaskRegen += dt;
      if (this.flaskRegen >= BALANCE.flaskRegen) {
        this.flaskRegen = 0;
        this.flasks++;
      }
    }
    // AUTO drinks when low (it waits a little longer outside boss fights)
    if (this.auto && this.hp < this.stats.maxHp * (this.inBossFight ? 0.38 : 0.25)) this.drinkFlask();
    for (let z = 0; z < this.bossCooldown.length; z++) this.bossCooldown[z] -= dt;
    if (this.inLair < 0) this.updateSpawning(dt);
    this.movePlayer(dt);
    {
      const p = this.player;
      if (this.pPrev && dt > 0) {
        const k = Math.min(1, dt * 6);
        const vx = (p.x - this.pPrev.x) / dt;
        const vy = (p.y - this.pPrev.y) / dt;
        // teleports (lair doors, respawn) shouldn't look like huge speed
        if (Math.hypot(vx, vy) < 2000) {
          this.pVel.x += (vx - this.pVel.x) * k;
          this.pVel.y += (vy - this.pVel.y) * k;
        }
      }
      this.pPrev = { x: p.x, y: p.y };
    }
    if (this.inCave) {
      if (this.map.exit && dist(this.map.exit, this.player) < 40) this.exitCave();
    } else if (this.inLair < 0) {
      this.trackZone();
      this.checkLairDoors();
      this.checkCaveMouth();
    } else this.checkLairExit();
    this.updateMobs(dt);
    this.updateTelegraphs(dt);
    this.updateGoo(dt);
    this.updateWaves(dt);
    if (this.deadTimer > 0) {
      inp.skills = inp.skills.map(() => false);
      return;
    }
    this.playerAttacks(dt);
    this.castSkills(dt);
    this.updateProjectiles(dt);
    this.updateBlasts(dt);
    this.updateCompanions(dt);

    if (this.inBossFight) {
      this.bossTimer -= dt;
      if (this.bossTimer <= 0 && !this.enraged) {
        this.enraged = true;
        this.anim.flash = 1;
        this.anim.flashColor = '#ff0000';
        this.onToast('The boss is ENRAGED! Finish it fast.', '#ff3b3b');
      }
    }
    // Saved position is always a world spot (inside a lair we save the spot outside its door)
    const spot = this.inCave ? this.outsideCave() : this.inLair >= 0 ? this.outsideDoorCached() : this.player;
    const pos = this.state.pos;
    if (pos) {
      pos.x = spot.x;
      pos.y = spot.y;
    } else this.state.pos = { x: spot.x, y: spot.y };
    inp.skills = inp.skills.map(() => false);
  }

  private trackZone() {
    const z = zoneAtX(this.map, this.player.x);
    if (z === this.zone) return;
    this.zone = z;
    this.target = null;
    this.path = null;
    const d = ZONES[z];
    const lvl = this.state.level;
    const warn = lvl < d.minLevel - 2 ? ' Careful, this area is above your level!' : '';
    this.onToast(`Entering ${d.name} (Lv ${d.minLevel}-${d.maxLevel}).${warn}`, warn ? '#ff8c3b' : '#c9a227');
    this.dirty = true;
  }

  private doorCache: { z: number; p: Vec } | null = null;
  private outsideDoorCached(): Vec {
    if (!this.doorCache || this.doorCache.z !== this.inLair) this.doorCache = { z: this.inLair, p: this.outsideDoor(this.inLair) };
    return this.doorCache.p;
  }

  /** Walking into a lair door takes you inside (if that boss is unsealed). */
  private checkLairDoors() {
    const p = this.player;
    this.map.altars.forEach((a, z) => {
      if (dist(a, p) > PHYS.altarRadius) return;
      // AUTO never wanders in by accident; walk there yourself or use "Fight boss".
      const viaButton = this.travelGoal?.boss === z;
      if (!this.manualActive && !viaButton) return;
      if (this.bossStatus(z) === 'locked') {
        if (this.time - this.lockedToastAt > 4) {
          this.lockedToastAt = this.time;
          this.onToast(`Sealed. Defeat ${bossName(z - 1)} first.`, '#ff8c3b');
        }
        if (viaButton) this.travelGoal = null;
        return;
      }
      this.enterLair(z);
      this.lairAuto = viaButton;
    });
  }

  /** Inside a lair: the exit portal, and the AUTO summon/leave flow. */
  private checkLairExit() {
    const exit = this.map.exit;
    if (exit && dist(exit, this.player) < 40 && this.manualActive && !this.inBossFight) {
      this.exitLair();
      return;
    }
    // after a boss dies on an AUTO run, walk back out a moment later
    if (this.lairAuto && this.lairDoneAt >= 0 && this.time - this.lairDoneAt > 3 && !this.manualActive) {
      this.exitLair();
    }
  }

  private startBoss(z: number) {
    const a = this.map.altars[0];
    const stats = mobForZone(z, ZONES[z].bossLevel, true, this.rand);
    const boss = this.makeMob(stats, { x: a.x, y: a.y }, PHYS.bossRadius, z);
    boss.actionTimer = 3;
    if (ZONES[z].bossSplit) boss.group = boss.id;
    this.mobs.push(boss);
    this.bossZone = z;
    this.enraged = false;
    this.bossTimer = BALANCE.bossTimeLimit;
    this.target = boss;
    this.lairDoneAt = -1;
    for (let i = 0; i < 10; i++) this.effect('poof', a.x, a.y, 60 + i * 12, '#a4161a', 0.6);
    this.onToast(`${stats.name} (Lv ${stats.level}) rises from the circle!`, '#f72585');
    this.dirty = true;
  }

  private decayVisuals(dt: number) {
    this.anim.swing = Math.max(0, this.anim.swing - dt * 4);
    this.anim.playerHit = Math.max(0, this.anim.playerHit - dt * 5);
    this.anim.flash = Math.max(0, this.anim.flash - dt * 3);
    for (const f of this.floats) {
      f.life -= dt;
      f.z += dt * 55;
    }
    if (this.floats.some((f) => f.life <= 0)) this.floats = this.floats.filter((f) => f.life > 0);
    for (const e of this.effects) e.life -= dt;
    if (this.effects.some((e) => e.life <= 0)) this.effects = this.effects.filter((e) => e.life > 0);
    for (const m of this.mobs) {
      m.hitFlash = Math.max(0, m.hitFlash - dt * 5);
      m.spawnAnim = Math.max(0, m.spawnAnim - dt * 3);
    }
    for (const c of this.party) c.hit = Math.max(0, c.hit - dt * 4);
  }

  // ---------------- Spawning ----------------
  private buildCamps() {
    const m = this.map;
    for (let z = 0; z < ZONES.length; z++) {
      const tiles = m.zoneFloor[z];
      const slices = PHYS.mobsPerZone;
      for (let k = 0; k < slices; k++) {
        // one camp per slice of the zone (west to east) so every monster level is represented
        const lo = (z * m.zoneW + 5 + ((m.zoneW - 9) * k) / slices) * TILE;
        const hi = (z * m.zoneW + 5 + ((m.zoneW - 9) * (k + 1)) / slices) * TILE;
        const pool = tiles.filter((i) => {
          const x = ((i % m.w) + 0.5) * TILE;
          return x >= lo && x < hi;
        });
        for (let tries = 0; tries < 20 && pool.length; tries++) {
          const i = pool[Math.floor(this.rand() * pool.length)];
          const tx = i % m.w;
          const p = { x: (tx + 0.5) * TILE, y: ((i - tx) / m.w + 0.5) * TILE };
          if (dist(p, m.altars[z]) < 300) continue;
          this.camps.push({ ...p, zone: z, mob: null, timer: 0 });
          break;
        }
      }
    }
  }

  private updateSpawning(dt: number) {
    for (const c of this.camps) {
      if (c.mob !== null) continue;
      c.timer -= dt;
      if (c.timer > 0 || dist(c, this.player) < 380) continue;
      this.spawnAtCamp(c);
    }
  }

  private spawnAtCamp(c: Camp) {
    let stats: MobStats;
    if (c.zone === CAVE.zone) {
      const lvl = this.caveLevel(c.x);
      const look = lvl < 10 ? 0 : lvl < 20 ? 1 : 2; // borrow monster looks from the matching zone
      stats = mobForZone(look, lvl, false, this.rand);
    } else stats = mobForZone(c.zone, this.levelAt(c.x), false, this.rand);
    const mob = this.makeMob(stats, c, PHYS.mobRadius, c.zone);
    mob.camp = this.camps.indexOf(c);
    c.mob = mob.id;
    this.mobs.push(mob);
  }

  private makeMob(stats: MobStats, p: Vec, r: number, zone: number): Mob {
    return {
      ...stats, id: this.nextMobId++, zone, maxHp: stats.hp, x: p.x, y: p.y, r, angle: this.rand() * 6.28,
      state: 'idle', timer: 0, homeX: p.x, homeY: p.y, wander: { x: 0, y: 0 }, path: null, pathTimer: 0,
      hitFlash: 0, spawnAnim: 1, moving: false, actionTimer: 0, chargeTo: null, phase: 0, invuln: 0, camp: -1,
      bleeds: [], bleedTimer: 0, shred: 0, shredPct: 0, shredTimer: 0, stagger: 0, staggerUntil: 0, staggers: 0,
      group: 0, gen: 0, lastHitAt: -1e9, hop: null, hopTimer: 1, gooDist: 0,
    };
  }

  // ---------------- Player movement ----------------
  private movePlayer(dt: number) {
    const p = this.player;
    if (this.rooted) {
      p.dash = null;
      p.moving = false;
      return;
    }

    if (p.dash) {
      const step = COMBAT.dashSpeed * dt;
      const d = Math.hypot(p.dash.tx - p.x, p.dash.ty - p.y);
      const a = Math.atan2(p.dash.ty - p.y, p.dash.tx - p.x);
      const mv = Math.min(step, d);
      const np = moveCircle(this.map, p.x, p.y, Math.cos(a) * mv, Math.sin(a) * mv, p.r);
      const blocked = Math.hypot(np.x - p.x, np.y - p.y) < mv * 0.5;
      p.x = np.x;
      p.y = np.y;
      p.dash.t -= dt;
      if (d <= step || blocked || p.dash.t <= 0) p.dash = null;
      p.moving = true;
      return;
    }

    let mx = 0;
    let my = 0;
    if (this.manualActive) {
      mx = this.input.moveX;
      my = this.input.moveY;
    } else {
      ({ x: mx, y: my } = this.avoidGoo(this.autoPilot(dt)));
    }
    const len = Math.hypot(mx, my);
    p.moving = len > 0.05;
    if (!p.moving) return;
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    // Facing follows movement unless the mouse is aiming
    if (!(this.manualActive && this.input.aim) && this.aimHold <= 0) p.angle = Math.atan2(my, mx);
    const spd = PHYS.playerSpeed * (this.time < this.sprintUntil ? EVADE.sprintSpeed : 1) * (this.slowed ? SPLIT.waveSlow : 1);
    const np = moveCircle(this.map, p.x, p.y, mx * spd * dt, my * spd * dt, p.r);
    p.x = np.x;
    p.y = np.y;
  }

  /** Where AUTO walks: dodge boss telegraphs first, then go fight the nearest monster. */
  private autoPilot(dt: number): Vec {
    const p = this.player;
    const zero = { x: 0, y: 0 };

    // 1. Dodge boss telegraphs (after a human-ish reaction delay)
    const threats = this.telegraphs.filter((t) => {
      if (!t.boss || t.wait > 0) return false;
      if (t.noticeAt === undefined) {
        t.noticeAt = this.aiReaction + this.rand() * this.aiJitter;
        t.unnoticed = this.rand() < this.aiMiss;
      }
      return !t.unnoticed && t.total - t.time >= t.noticeAt;
    });
    if (this.safeSpots.length && this.time < this.safeUntil && threats.some((t) => t.volley)) {
      // globes: run to the nearest clear spot
      const spot = this.safeSpots.reduce((a, b) => (dist(a, p) < dist(b, p) ? a : b));
      if (dist(spot, p) > 25) return this.avoidGoo(this.walkTo(spot, dt));
    }
    const wd = this.waveDodge();
    if (wd && !threats.some((t) => this.inTelegraph(t, p, p.r + 8))) return wd;
    if (threats.some((t) => this.inTelegraph(t, p, p.r + 8))) {
      const dir = this.dodge(threats);
      this.autoEvade(dir, threats);
      return dir;
    }

    // 2. Inside a lair with no boss: AUTO runs summon (if it came for the boss) or waits
    if (this.inLair >= 0 && !this.inBossFight) {
      if (!this.lairAuto) return zero;
      if (this.lairDoneAt >= 0) return this.walkTo(this.map.exit!, dt);
      const circle = this.map.altars[0];
      if (dist(p, circle) > 90) return this.walkTo(circle, dt);
      const why = this.summonBoss();
      if (why) {
        this.onToast(why, '#ff8c3b');
        this.lairAuto = false;
      }
      return zero;
    }

    // 3. Travel somewhere (zone or boss lair) if asked to
    if (this.travelGoal && !this.inBossFight) {
      const g = this.travelGoal;
      const gd = dist(p, g);
      if (gd < (g.boss !== null ? PHYS.altarRadius * 0.5 : 60)) {
        if (g.boss === null && !g.cave) this.travelGoal = null;
        return zero;
      }
      return this.walkTo(g, dt);
    }

    // 3. Pick a target
    if (this.target && (!this.mobs.includes(this.target) || (this.ignore.get(this.target.id) ?? 0) > this.time)) {
      this.target = null;
    }
    if (!this.target) {
      this.target = this.pickTarget();
      this.targetTime = 0;
      this.path = null;
    }
    const t = this.target;
    if (!t) return this.roam(dt);

    const d = dist(p, t);
    const basic = this.job.basic;
    const ranged = basic.kind !== 'melee';

    // Ranged jobs back away from anything that gets too close
    if (ranged) {
      const close = this.nearestMob(COMBAT.kiteDistance);
      if (close) {
        const away = this.escapeFrom(close);
        if (away) return away;
      }
    }

    const reach = ranged ? basic.range * 0.75 : basic.range + t.r + p.r;
    const clear = !ranged || lineOfSight(this.map, p.x, p.y, t.x, t.y);
    if (d <= reach - 12 && clear) {
      this.targetTime = 0;
      p.angle = angleTo(p, t);
      this.aimHold = 0.4;
      return zero;
    }
    this.targetTime += dt;
    if (this.targetTime > 7 && !t.boss) {
      this.ignore.set(t.id, this.time + 8);
      this.target = null;
      return zero;
    }

    // 4. Walk there
    const dir = this.walkTo(t, dt);
    if (!this.path && !lineOfSight(this.map, p.x, p.y, t.x, t.y, p.r)) {
      // no route
      this.ignore.set(t.id, this.time + 8);
      this.target = null;
    }
    return dir;
  }

  private roamGoal: Vec | null = null;
  private roamUntil = 0;

  /** Nothing to fight nearby: head for the camps that match your level. */
  private roam(dt: number): Vec {
    const p = this.player;
    if (!this.roamGoal || this.time > this.roamUntil || dist(p, this.roamGoal) < 60) {
      const lvl = this.state.level;
      const camps = this.camps.filter((c) => c.zone === this.zone);
      if (!camps.length) return { x: 0, y: 0 };
      // camp whose monster level is closest to (just under) yours
      camps.sort((a, b) => Math.abs(this.levelAt(a.x) - (lvl - 1)) - Math.abs(this.levelAt(b.x) - (lvl - 1)) || dist(a, p) - dist(b, p));
      const pick = camps[Math.floor(this.rand() * Math.min(3, camps.length))];
      this.roamGoal = { x: pick.x, y: pick.y };
      this.roamUntil = this.time + 20;
    }
    return this.walkTo(this.roamGoal, dt);
  }

  /** One step toward a point: straight if clear, otherwise along an A* path. */
  private walkTo(goal: Vec, dt: number): Vec {
    const p = this.player;
    const d = dist(p, goal) || 1;
    if (d < 400 && lineOfSight(this.map, p.x, p.y, goal.x, goal.y, p.r)) {
      this.path = null;
      return { x: (goal.x - p.x) / d, y: (goal.y - p.y) / d };
    }
    this.pathTimer -= dt;
    if (!this.path || this.pathTimer <= 0 || !this.pathGoal || dist(this.pathGoal, goal) > TILE) {
      this.path = findPath(this.map, p.x, p.y, goal.x, goal.y, p.r);
      this.pathGoal = { x: goal.x, y: goal.y };
      this.pathTimer = 0.6;
      if (!this.path) return { x: 0, y: 0 };
    }
    while (this.path.length && dist(this.path[0], p) < 14) this.path.shift();
    const wp = this.path[0];
    if (!wp) {
      this.path = null;
      return { x: 0, y: 0 };
    }
    const wd = dist(p, wp) || 1;
    return { x: (wp.x - p.x) / wd, y: (wp.y - p.y) / wd };
  }

  /**
   * Picks the direction that gets out of every threatening telegraph soonest, preferring
   * spots that keep the current target in reach.
   */
  private dodge(threats: Telegraph[]): Vec {
    const p = this.player;
    const reach = this.job.basic.kind === 'melee' ? this.job.basic.range + 60 : this.job.basic.range * 0.8;
    const t = this.target && this.mobs.includes(this.target) ? this.target : null;
    let best: Vec = { x: 0, y: 0 };
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let score = 0;
      let blocked = false;
      // check a few points along the way
      for (const step of [35, 70, 110, 150]) {
        const x = p.x + dx * step;
        const y = p.y + dy * step;
        if (!fits(this.map, x, y, p.r)) {
          blocked = true;
          break;
        }
        const hits = threats.filter((th) => this.inTelegraph(th, { x, y }, p.r + 6)).length + (this.sticky(x, y) ? 1 : 0);
        // being safe sooner is worth more
        score += hits === 0 ? (200 - step) / 10 : -hits * 6;
      }
      if (blocked) continue;
      if (t) {
        const end = { x: p.x + dx * 110, y: p.y + dy * 110 };
        if (dist(end, t) < reach + t.r) score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x: dx, y: dy };
      }
    }
    return best;
  }

  /** Is this spot sticky (goo, or right next to a split slime on the ground)? */
  private sticky(x: number, y: number): boolean {
    const r = this.player.r;
    for (const g of this.goo) if (Math.hypot(g.x - x, g.y - y) < g.r + r * 0.4 + 6) return true;
    for (const m of this.mobs) if (m.group && !m.hop && !this.isMainSlime(m) && Math.hypot(m.x - x, m.y - y) < m.r + r + 10) return true;
    return false;
  }

  /** AUTO steers around goo: turns a little if the way ahead is sticky, stops if it's all sticky. */
  private avoidGoo(v: Vec): Vec {
    if (!this.goo.length && !this.mobs.some((m) => m.group && !this.isMainSlime(m))) return v;
    const len = Math.hypot(v.x, v.y);
    if (len < 0.05) return v;
    const p = this.player;
    const a = Math.atan2(v.y, v.x);
    for (const rot of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2]) {
      const nx = p.x + Math.cos(a + rot) * 40;
      const ny = p.y + Math.sin(a + rot) * 40;
      if (!this.sticky(nx, ny) && fits(this.map, nx, ny, p.r)) return { x: Math.cos(a + rot) * len, y: Math.sin(a + rot) * len };
    }
    return { x: 0, y: 0 };
  }

  /** Direction away from a monster, if there is room to move that way. */
  private escapeFrom(m: Mob): Vec | null {
    const p = this.player;
    const a = angleTo(m, p);
    for (const rot of [0, 0.6, -0.6, 1.2, -1.2]) {
      const dx = Math.cos(a + rot);
      const dy = Math.sin(a + rot);
      const nx = p.x + dx * 40;
      if (fits(this.map, nx, p.y + dy * 40, p.r) && zoneAtX(this.map, nx) === this.zone) return { x: dx, y: dy };
    }
    return null;
  }

  private pickTarget(): Mob | null {
    const p = this.player;
    let best: Mob | null = null;
    let bestCost = Infinity;
    for (const m of this.mobs) {
      if ((this.ignore.get(m.id) ?? 0) > this.time) continue;
      if (m.zone !== this.zone) continue;
      // don't pick fights with monsters far above you (unless they're already after you)
      if (!m.boss && m.level - this.state.level >= 4 && m.state !== 'chase') continue;
      let cost = dist(p, m);
      // prefer monsters near your level: low ones give little EXP, high ones are dangerous
      const diff = m.level - this.state.level;
      cost *= 1 + Math.min(1.5, Math.abs(diff) * 0.12) + (diff >= 4 ? 2 : 0);
      if (!lineOfSight(this.map, p.x, p.y, m.x, m.y)) cost *= 1.8;
      if (m.boss) cost *= 0.2;
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
    return best;
  }

  // ---------------- Mobs ----------------
  private updateMobs(dt: number) {
    const p = this.player;
    for (const m of this.mobs) {
      if (m.spawnAnim > 0.3) continue;
      if (!m.hop) this.depenetrate(m);
      if (m.staggerUntil > this.time) {
        m.moving = false;
        continue;
      }
      const d = dist(m, p);
      if (d > PHYS.activeRange && !m.boss) {
        m.moving = false;
        if (m.state !== 'idle') m.state = 'idle';
        continue;
      }
      const touch = m.r + p.r + COMBAT.mobReach;
      const speed = m.boss ? PHYS.bossSpeed * SPLIT.speed[m.gen] : PHYS.mobSpeed;
      m.moving = false;
      if (m.boss) {
        m.actionTimer -= dt;
        m.invuln -= dt;
      }

      if (m.state === 'charge' && m.chargeTo) {
        const step = (m.group && m.phase === 2 && !this.isMainSlime(m) ? SPLIT.wild.chargeSpeed : 900) * dt;
        const cd = dist(m, m.chargeTo);
        const a = angleTo(m, m.chargeTo);
        const np = moveCircle(this.map, m.x, m.y, Math.cos(a) * Math.min(step, cd), Math.sin(a) * Math.min(step, cd), m.r * 0.8, true);
        const stuck = dist(np, m) < 1;
        if (m.group && !this.isMainSlime(m)) this.trailGoo(m, dist(np, m));
        m.x = np.x;
        m.y = np.y;
        m.moving = true;
        if (cd <= step || stuck) {
          m.state = 'recover';
          m.timer = 0.8;
          m.chargeTo = null;
        }
        continue;
      }

      if (m.state === 'windup') {
        m.timer -= dt;
        if (m.timer <= 0) {
          m.state = 'recover';
          m.timer = COMBAT.mobRecover;
        }
        continue;
      }
      if (m.state === 'recover') {
        m.timer -= dt;
        if (m.timer <= 0) m.state = 'chase';
        continue;
      }

      // Boss specials
      if (m.boss) {
        if (m.actionTimer <= 0 && m.invuln <= 0 && !m.hop && !(m.group && this.isMainSlime(m) && m.phase === 2) && !this.telegraphs.some((t) => t.ownerId === m.id && t.boss)) {
          const slimes = m.group ? this.splitGroup(m).length : 1;
          m.actionTimer =
            (this.isMainSlime(m) ? 1 : (0.75 + this.rand() * 0.6) * (m.phase === 2 ? SPLIT.wild.actionMult : 1)) *
            ((this.enraged ? BALANCE.bossEnragedEvery : BALANCE.bossActionEvery[m.phase]) + this.rand() * 0.6) *
            (1 + SPLIT.actionSlowPerExtra * (slimes - 1));
          this.bossSpecial(m);
          continue;
        }
      }

      // last phase: the main slime sits in the middle of the arena raining globes
      if (m.boss && m.group && this.isMainSlime(m) && m.phase === 2) {
        this.updateAnchored(m, dt);
        continue;
      }

      // split-off slimes don't walk: they hop around you, leaving goo
      if (m.boss && m.group && this.isMainSlime(m) && m.phase < 2) {
        this.updateMainHopper(m, dt);
        continue;
      }
      if (m.boss && !this.isMainSlime(m)) {
        this.updateHopper(m, dt);
        continue;
      }

      // monsters can't follow you through a barrier, so they only care while you're in their zone
      const aggro = m.zone === this.zone && this.deadTimer <= 0 && (m.boss || m.state === 'chase' || d < PHYS.mobAggroRange);
      if (aggro && d < touch) {
        // melee windup: a short cone telegraph the player can step out of
        m.state = 'windup';
        m.timer = COMBAT.mobWindup * (m.boss ? 1.3 : 1);
        m.angle = angleTo(m, p);
        this.telegraphs.push({
          kind: 'cone', x: m.x, y: m.y, r: m.r + COMBAT.mobReach + p.r + 22, inner: 0, angle: m.angle,
          width: 0.9, time: COMBAT.mobWindup * (m.boss ? 1.3 : 1), total: COMBAT.mobWindup * (m.boss ? 1.3 : 1), damage: m.atk, boss: m.boss, ownerId: m.id,
          pct: m.boss ? BALANCE.bossMeleePct * SPLIT.damage[m.gen] : 0, wait: 0, follow: false,
        });
        continue;
      }

      let vx = 0;
      let vy = 0;
      if (aggro && d < PHYS.mobAggroRange * 1.8) {
        m.state = 'chase';
        if (lineOfSight(this.map, m.x, m.y, p.x, p.y, m.r * 0.8, true)) {
          m.path = null;
          vx = (p.x - m.x) / d;
          vy = (p.y - m.y) / d;
        } else {
          m.pathTimer -= dt;
          if (!m.path || m.pathTimer <= 0) {
            m.path = findPath(this.map, m.x, m.y, p.x, p.y, m.r * 0.8, true);
            m.pathTimer = 0.7 + this.rand() * 0.3;
          }
          while (m.path && m.path.length && dist(m.path[0], m) < 12) m.path.shift();
          const wp = m.path?.[0];
          if (wp) {
            const wd = dist(m, wp) || 1;
            vx = (wp.x - m.x) / wd;
            vy = (wp.y - m.y) / wd;
          }
        }
      } else {
        m.state = 'idle';
        m.timer -= dt;
        if (m.timer <= 0) {
          m.timer = 1.5 + this.rand() * 2;
          const home = Math.hypot(m.x - m.homeX, m.y - m.homeY) > 180;
          if (home) {
            const a = Math.atan2(m.homeY - m.y, m.homeX - m.x);
            m.wander = { x: Math.cos(a), y: Math.sin(a) };
          } else if (this.rand() < 0.35) m.wander = { x: 0, y: 0 };
          else {
            const a = this.rand() * Math.PI * 2;
            m.wander = { x: Math.cos(a), y: Math.sin(a) };
          }
        }
        vx = m.wander.x * 0.5;
        vy = m.wander.y * 0.5;
      }

      // keep mobs from stacking
      for (const o of this.mobs) {
        if (o === m) continue;
        const od = dist(m, o);
        const min = m.r + o.r;
        if (od < min && od > 0.01) {
          vx += ((m.x - o.x) / od) * 0.6;
          vy += ((m.y - o.y) / od) * 0.6;
        }
      }
      if (vx || vy) {
        m.angle = Math.atan2(vy, vx);
        const want = Math.hypot(vx, vy) * speed * dt;
        let np = moveCircle(this.map, m.x, m.y, vx * speed * dt, vy * speed * dt, m.r * 0.8, true);
        if (Math.hypot(np.x - m.x, np.y - m.y) < want * 0.3) {
          // blocked (pillar corner, wall): turn a little and slide around it, then re-plan
          const a = Math.atan2(vy, vx);
          for (const rot of [0.6, -0.6, 1.1, -1.1, 1.6, -1.6]) {
            const tp = moveCircle(this.map, m.x, m.y, Math.cos(a + rot) * want, Math.sin(a + rot) * want, m.r * 0.8, true);
            if (Math.hypot(tp.x - m.x, tp.y - m.y) > want * 0.5) {
              np = tp;
              break;
            }
          }
          m.pathTimer = Math.min(m.pathTimer, 0.15);
        }
        m.moving = Math.abs(np.x - m.x) + Math.abs(np.y - m.y) > 0.1;
        m.x = np.x;
        m.y = np.y;
      }
    }
  }

  /** The main slime (the original) aims straight at you; its split-offs are chaotic. */
  isMainSlime(m: Mob): boolean {
    return !m.group || m.id === m.group;
  }

  /**
   * Where a split-off slime aims: sometimes where you're about to be (leading your movement),
   * sometimes a random spot near you, so their attacks spread out instead of stacking.
   */
  private chaosPoint(lead: number): Vec {
    const p = this.player;
    const a = this.rand() * Math.PI * 2;
    if (this.rand() < 0.55) {
      const t = lead * (0.6 + this.rand() * 0.8);
      const d = 20 + this.rand() * 60;
      return this.clampArena({ x: p.x + this.pVel.x * t + Math.cos(a) * d, y: p.y + this.pVel.y * t + Math.sin(a) * d });
    }
    const d = 70 + this.rand() * 150;
    return this.clampArena({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d });
  }

  /** A monster overlapping a wall can't move at all (every step is rejected), so push it back out. */
  private depenetrate(m: Mob) {
    const r = m.r * 0.8;
    if (fits(this.map, m.x, m.y, r, true)) return;
    for (let d = 6; d <= 160; d += 6) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = m.x + Math.cos(a) * d;
        const y = m.y + Math.sin(a) * d;
        if (fits(this.map, x, y, r, true)) {
          m.x = x;
          m.y = y;
          return;
        }
      }
    }
  }

  /** Pulls a point back toward the hero until it's on open floor, so attacks never land in walls. */
  private clampArena(q: Vec, r = 24): Vec {
    const p = this.player;
    for (let i = 0; i <= 10; i++) {
      const f = 1 - i / 10;
      const x = p.x + (q.x - p.x) * f;
      const y = p.y + (q.y - p.y) * f;
      if (fits(this.map, x, y, r, true)) return { x, y };
    }
    return { x: p.x, y: p.y };
  }

  /** How far a charge can go from (x, y) along angle a before hitting a wall. */
  private chargeLength(m: Mob, a: number, max: number): number {
    let len = 0;
    while (len + 16 <= max && fits(this.map, m.x + Math.cos(a) * (len + 16), m.y + Math.sin(a) * (len + 16), m.r * 0.8, true)) len += 16;
    return Math.max(80, len);
  }

  /** Phases 1-2: the crowned slime follows you by hopping; every landing slams and sends out waves. */
  private updateMainHopper(m: Mob, dt: number) {
    if (m.hop) {
      const h = m.hop;
      h.t += dt;
      const f = Math.min(1, h.t / h.dur);
      m.x = h.fx + (h.tx - h.fx) * f;
      m.y = h.fy + (h.ty - h.fy) * f;
      m.angle = Math.atan2(h.ty - h.fy, h.tx - h.fx);
      m.moving = true;
      if (f >= 1) {
        m.hop = null;
        m.hopTimer = SPLIT.mainHopEvery[0] + this.rand() * (SPLIT.mainHopEvery[1] - SPLIT.mainHopEvery[0]);
        this.effect('ring', m.x, m.y, SPLIT.mainSlamRadius * SPLIT.attackSize[m.gen], m.color, 0.4);
        this.emitRings(m);
      }
      return;
    }
    m.hopTimer -= dt;
    if (m.hopTimer > 0 || this.telegraphs.some((t) => t.ownerId === m.id)) return;
    // rest until the last ring from the previous landing is well on its way out
    if (this.waves.some((w) => w.ownerId === m.id && w.r < SPLIT.waveMaxR * SPLIT.waveRest)) return;
    // hop somewhere around the room (not onto you), so the rings come from all over
    const to = this.roomSpot(m, 220);
    const dur = SPLIT.mainHopTime * (this.enraged ? 0.8 : 1);
    m.hop = { fx: m.x, fy: m.y, tx: to.x, ty: to.y, t: 0, dur };
    this.telegraphs.push({
      kind: 'circle', x: to.x, y: to.y, r: SPLIT.mainSlamRadius * SPLIT.attackSize[m.gen], inner: 0, angle: 0, width: 0,
      time: dur, total: dur, damage: m.atk * COMBAT.telegraphDamageMult, boss: true, ownerId: m.id, wait: 0, follow: false,
      style: 'wave', pct: BOSS_MOVE_PCT.slam * SPLIT.damage[m.gen] * (this.enraged ? BALANCE.bossEnrageDamage : 1),
    });
  }

  /** Rings of slime from the crowned slime: 2 / 3 / 4 by phase, each with gaps shifted from the last. */
  private emitRings(m: Mob) {
    const base = this.rand() * Math.PI * 2;
    const step = (Math.PI * 2) / SPLIT.waveGaps;
    const count = SPLIT.waveCount[m.phase] ?? 2;
    for (let w = 0; w < count; w++) {
      const off = base + (w % 2) * step * 0.5;
      this.waves.push({
        x: m.x, y: m.y, r: m.r - w * SPLIT.waveSpacing, gaps: Array.from({ length: SPLIT.waveGaps }, (_, i) => off + i * step),
        hit: false, ownerId: m.id, level: m.level, damage: m.atk * COMBAT.telegraphDamageMult * 0.6,
        pct: SPLIT.wavePct * (this.enraged ? BALANCE.bossEnrageDamage : 1),
      });
    }
  }

  /**
   * Wild phase: the clean spot. Samples open spots in the room and picks the one furthest from any
   * goo (and from where the other slimes are already heading), so the minis spread slime everywhere.
   */
  private cleanSpot(m: Mob): Vec {
    const claimed: Vec[] = [];
    for (const o of this.mobs) {
      if (o === m || o.group !== m.group) continue;
      if (o.hop) claimed.push({ x: o.hop.tx, y: o.hop.ty });
      if (o.chargeTo) claimed.push(o.chargeTo);
    }
    let best: Vec | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 24; i++) {
      const q = this.roomSpot(m, 0);
      let near = 400;
      for (const g of this.goo) near = Math.min(near, Math.hypot(g.x - q.x, g.y - q.y) - g.r);
      for (const c of claimed) near = Math.min(near, dist(c, q) * 0.6);
      const score = near + this.rand() * 25; // a little noise so it's not perfectly predictable
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }
    return best ?? this.roomSpot(m, 0);
  }

  /** A random open spot in the arena for a slime of this size, at least `minFromPlayer` away from you. */
  private roomSpot(m: Mob, minFromPlayer: number): Vec {
    const c = this.map.altars[0] ?? { x: m.x, y: m.y };
    const p = this.player;
    for (let i = 0; i < 40; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = this.rand() * 520;
      const q = { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
      if (dist(q, p) < minFromPlayer || dist(q, m) < 120) continue;
      if (fits(this.map, q.x, q.y, m.r * 0.8 + 2, true)) return q;
    }
    return this.clampArena({ x: c.x, y: c.y }, m.r * 0.8 + 2);
  }

  /** One Slimed stack (any hit from the crowned slime). Returns true if it killed you. */
  private addSlime(): boolean {
    const p = this.player;
    this.slimeStacks++;
    if (this.slimeStacks >= SPLIT.waveLethal) {
      this.float(p.x, p.y, 60, 'Drowned in slime!', '#7bc950', 20);
      this.playerDie();
      return true;
    }
    this.float(p.x, p.y, 45, `Slimed ${this.slimeStacks}/${SPLIT.waveLethal}`, '#7bc950', 16);
    return false;
  }

  /** Is this angle (from a wave's centre) inside one of its gaps? */
  private inGap(w: Wave, a: number, pad: number): boolean {
    return w.gaps.some((g) => Math.abs(angDiff(g, a)) <= SPLIT.waveGapHalf - pad);
  }

  private updateWaves(dt: number) {
    if (!this.waves.length) return;
    const p = this.player;
    for (const w of this.waves) {
      w.r += SPLIT.waveSpeed * dt;
      if (w.hit || w.r < 0 || this.deadTimer > 0) continue;
      const d = dist(w, p);
      if (Math.abs(d - w.r) > SPLIT.waveWidth / 2 + p.r * 0.6) continue;
      const pad = Math.atan2(p.r * 0.6, Math.max(1, d));
      if (this.inGap(w, angleTo(w, p), pad)) continue;
      w.hit = true;
      const parried = this.parrying;
      this.hurtPlayer(w.damage, w.level, w.pct);
      if (!parried && this.deadTimer <= 0) {
        this.slowUntil = this.time + SPLIT.waveSlowTime;
        if (this.addSlime()) return;
      }
    }
    this.waves = this.waves.filter((w) => w.r < SPLIT.waveMaxR && this.mobs.some((m) => m.id === w.ownerId));
  }

  /** AUTO: if a wave is about to reach you outside a gap, slide sideways toward the nearest gap. */
  private waveDodge(): Vec | null {
    const p = this.player;
    for (const w of this.waves) {
      if (w.hit) continue;
      const d = dist(w, p);
      const gapAhead = d - w.r;
      if (gapAhead < -SPLIT.waveWidth || gapAhead > 160) continue;
      const a = angleTo(w, p);
      if (this.inGap(w, a, 0.08)) return { x: 0, y: 0 }; // hold still in the gap
      const g = w.gaps.reduce((b, c) => (Math.abs(angDiff(c, a)) < Math.abs(angDiff(b, a)) ? c : b));
      // move tangentially toward the gap, and a bit away from the wave
      const sign = angDiff(a, g) > 0 ? 1 : -1;
      const tx = -Math.sin(a) * sign;
      const ty = Math.cos(a) * sign;
      const v = { x: tx * 0.85 + Math.cos(a) * 0.3, y: ty * 0.85 + Math.sin(a) * 0.3 };
      const l = Math.hypot(v.x, v.y) || 1;
      return { x: v.x / l, y: v.y / l };
    }
    return null;
  }

  /** King Jelly's last phase: leap to the middle, then bounce in place and rain globes. */
  private updateAnchored(m: Mob, dt: number) {
    const c = this.map.altars[0] ?? { x: m.x, y: m.y };
    // in the middle: rings nonstop (a new set as soon as the last ring of the previous set is halfway out)
    const centred = Math.hypot(m.x - c.x, m.y - c.y) <= 20 && !(m.hop && (m.hop.fx !== m.hop.tx || m.hop.fy !== m.hop.ty));
    if (centred && m.invuln <= 0 && !this.waves.some((w) => w.ownerId === m.id && w.r < SPLIT.waveMaxR * SPLIT.waveRest)) this.emitRings(m);
    // constant slime rain (independent of the bouncing; several globs per frame if needed)
    if (centred && m.invuln <= 0 && !SPLIT.wild.globes) {
      const w = SPLIT.wild;
      while (m.actionTimer <= 0) {
        m.actionTimer += (w.rainEvery[0] + this.rand() * (w.rainEvery[1] - w.rainEvery[0])) * (this.enraged ? 0.75 : 1);
        this.spout(m);
      }
    }
    if (m.hop) {
      const h = m.hop;
      h.t += dt;
      const f = Math.min(1, h.t / h.dur);
      m.x = h.fx + (h.tx - h.fx) * f;
      m.y = h.fy + (h.ty - h.fy) * f;
      m.moving = true;
      if (f >= 1) {
        m.hop = null;
        if (h.fx !== h.tx || h.fy !== h.ty) {
          // the big landing
          this.effect('ring', m.x, m.y, 220, m.color, 0.6);
          this.anim.flash = 0.6;
          this.anim.flashColor = '#7bc950';
        }
      }
      return;
    }
    if (Math.hypot(m.x - c.x, m.y - c.y) > 20) {
      // leap to the middle (the landing is marked; don't be there)
      const dur = 1.1;
      m.hop = { fx: m.x, fy: m.y, tx: c.x, ty: c.y, t: 0, dur };
      this.telegraphs = this.telegraphs.filter((t) => t.ownerId !== m.id);
      this.telegraphs.push({
        kind: 'circle', x: c.x, y: c.y, r: 160, inner: 0, angle: 0, width: 0, time: dur, total: dur,
        damage: m.atk * COMBAT.telegraphDamageMult, boss: true, ownerId: m.id, wait: 0, follow: false, pct: BOSS_MOVE_PCT.slam,
      });
      m.actionTimer = 1.6;
      return;
    }
    // bounce in place
    m.hop = { fx: m.x, fy: m.y, tx: m.x, ty: m.y, t: 0, dur: 0.55 };
    if (SPLIT.wild.globes && m.actionTimer <= 0 && m.invuln <= 0 && !this.telegraphs.some((t) => t.ownerId === m.id)) {
      m.actionTimer = (SPLIT.globeEvery[0] + this.rand() * (SPLIT.globeEvery[1] - SPLIT.globeEvery[0])) * (this.enraged ? 0.75 : 1);
      this.globeRain(m);
    }

  }

  /** Wild phase: one glob of the crowned slime's constant slime rain. */
  private spout(m: Mob) {
    const w = SPLIT.wild;
    const p = this.player;
    let q: Vec;
    if (this.rand() < w.rainNearPlayer) {
      const a = this.rand() * Math.PI * 2;
      const d = this.rand() * 160;
      q = this.clampArena({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d });
    } else q = this.roomSpot(m, 0);
    const time = w.spoutTime * (this.enraged ? 0.85 : 1);
    this.telegraphs.push({
      kind: 'circle', x: q.x, y: q.y, r: w.spoutRadius, inner: 0, angle: 0, width: 0, time, total: time,
      damage: m.atk * COMBAT.telegraphDamageMult * 0.6, boss: true, ownerId: m.id, wait: 0, follow: false, style: 'spout',
      pct: w.spoutPct * (this.enraged ? BALANCE.bossEnrageDamage : 1),
    });
  }

  /**
   * Globes in a checkerboard over the whole lair: every other square gets hit, and the next volley
   * hits the other squares, so you can always plan your next step.
   */
  private globeRain(m: Mob) {
    const cell = SPLIT.globeCell;
    const half = cell / 2;
    const time = SPLIT.globeTime * (this.enraged ? 0.85 : 1);
    const dmg = m.atk * COMBAT.telegraphDamageMult * (this.enraged ? BALANCE.bossEnrageDamage : 1);
    const pct = BOSS_MOVE_PCT.globes * (this.enraged ? BALANCE.bossEnrageDamage : 1);
    const volley = this.nextVolley++;
    this.globeParity ^= 1;
    const safe: Vec[] = [];
    const cols = Math.ceil((this.map.w * TILE) / cell);
    const rows = Math.ceil((this.map.h * TILE) / cell);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * cell + half;
        const y = cy * cell + half;
        // a square counts if any part of it is floor
        const q = half / 2;
        const floor = [[-q, -q], [q, -q], [-q, q], [q, q]].some(([ox, oy]) => walkablePoint(this.map, x + ox, y + oy, true));
        if (!floor) continue;
        if ((cx + cy) % 2 !== this.globeParity) {
          if (fits(this.map, x, y, this.player.r, true)) safe.push({ x, y });
          continue;
        }
        this.telegraphs.push({
          kind: 'square', x, y, r: half, inner: 0, angle: 0, width: 0, time, total: time, damage: dmg, boss: true,
          ownerId: m.id, wait: 0, follow: false, pct, volley,
        });
      }
    }
    this.safeSpots = safe;
    this.safeUntil = this.time + time + 0.2;
    this.float(m.x, m.y, m.r * 2 + 50, 'Globes!', '#7bc950', 18);
  }

  /** Split-off slime: waits a moment, then leaps to a spot near (or ahead of) you. */
  private updateHopper(m: Mob, dt: number) {
    const p = this.player;
    if (m.hop) {
      const h = m.hop;
      h.t += dt;
      const f = Math.min(1, h.t / h.dur);
      const nx = h.fx + (h.tx - h.fx) * f;
      const ny = h.fy + (h.ty - h.fy) * f;
      m.angle = Math.atan2(h.ty - h.fy, h.tx - h.fx);
      if (Math.hypot(nx - m.x, ny - m.y) > 0) this.trailGoo(m, Math.hypot(nx - m.x, ny - m.y), true);
      m.x = nx;
      m.y = ny;
      m.moving = true;
      if (f >= 1) {
        m.hop = null;
        const wild = m.phase === 2;
        const every = wild ? SPLIT.wild.hopEvery : SPLIT.hopEvery;
        m.hopTimer = every[0] + this.rand() * (every[1] - every[0]);
        this.addGoo(m.x, m.y, SPLIT.gooPuddle * SPLIT.attackSize[m.gen] * (wild ? SPLIT.wild.puddleMult : 1));
        this.effect('ring', m.x, m.y, SPLIT.hopRadius * SPLIT.attackSize[m.gen], '#7bc950', 0.35);
      }
      return;
    }
    // bumping into a slime on the ground sticks you
    if (dist(m, p) < m.r + p.r + 4 && this.deadTimer <= 0) this.rootPlayer(SPLIT.rootBump);
    if (m.phase === 2) return; // wild phase: the minis only charge
    m.hopTimer -= dt;
    if (m.hopTimer > 0) return;
    // land near you, ahead of you, or somewhere random in the arena
    let to: Vec;
    if (m.phase === 2) to = this.cleanSpot(m); // wild phase: the cleanest floor in the room
    else {
      const raw = this.rand() < 0.75 ? this.chaosPoint(SPLIT.hopTime) : { x: p.x + (this.rand() - 0.5) * 700, y: p.y + (this.rand() - 0.5) * 700 };
      to = this.clampArena(raw, m.r * 0.8 + 2);
    }
    const dur = SPLIT.hopTime * (this.enraged ? 0.8 : 1);
    m.hop = { fx: m.x, fy: m.y, tx: to.x, ty: to.y, t: 0, dur };
    this.telegraphs.push({
      kind: 'circle', x: to.x, y: to.y, r: SPLIT.hopRadius * SPLIT.attackSize[m.gen], inner: 0, angle: 0, width: 0,
      time: dur, total: dur, damage: m.atk * COMBAT.telegraphDamageMult * 0.5, boss: true, ownerId: m.id, wait: 0, follow: false,
      style: 'landing', pct: SPLIT.hopPct * (this.enraged ? BALANCE.bossEnrageDamage : 1),
    });
  }

  /** Drops goo drops behind a moving split slime (every ~50 units). */
  private trailGoo(m: Mob, moved: number, airborne = false) {
    m.gooDist += moved;
    if (m.gooDist < SPLIT.trailEvery) return;
    m.gooDist = 0;
    // no unmarked goo on top of you: mid-air drops skip the spot you're standing on
    if (airborne && dist(m, this.player) < 70) return;
    this.addGoo(m.x, m.y, SPLIT.gooDrop * SPLIT.attackSize[m.gen]);
  }

  private addGoo(x: number, y: number, r: number) {
    if (this.goo.length > SPLIT.gooMax) this.goo.shift();
    this.goo.push({ x, y, r, life: SPLIT.gooLife });
  }

  private updateGoo(dt: number) {
    if (!this.goo.length) return;
    for (const g of this.goo) g.life -= dt;
    if (this.goo.some((g) => g.life <= 0)) this.goo = this.goo.filter((g) => g.life > 0);
    const p = this.player;
    if (this.deadTimer > 0 || p.dash) return;
    const touching = this.goo.filter((g) => Math.hypot(g.x - p.x, g.y - p.y) < g.r + p.r * 0.4);
    if (touching.length && !this.rooted) {
      // the goo grabs you once and is used up: every puddle you're standing in splats away
      this.rootPlayer(SPLIT.rootGoo);
      this.goo = this.goo.filter((g) => !touching.includes(g));
      for (const g of touching) this.effect('poof', g.x, g.y, g.r, '#7bc950', 0.4);
    }
  }

  /** Stuck to the ground: no walking or dashing for a moment. */
  rootPlayer(dur: number) {
    if (this.time < this.rootImmuneUntil || this.rooted) return;
    if (this.time < this.parryUntil) {
      this.counter();
      return;
    }
    this.rootedUntil = this.time + dur;
    this.rootImmuneUntil = this.rootedUntil + SPLIT.rootImmune;
    this.player.dash = null;
    this.float(this.player.x, this.player.y, 60, 'Rooted!', '#7bc950', 16);
  }

  private bossSpecial(m: Mob) {
    const main = this.isMainSlime(m);
    // wild phase: the minis ignore you and go anywhere in the room
    const wildMini = !main && !!m.group && m.phase === 2;
    const p: Vec = main ? this.player : wildMini ? this.cleanSpot(m) : this.chaosPoint(1.1);
    this.telegraphs = this.telegraphs.filter((t) => t.ownerId !== m.id);
    const kit = main ? ZONES[m.zone].bossKit[m.phase] ?? ZONES[m.zone].bossKit[0] : m.phase === 2 ? SPLIT.wild.kit : SPLIT.kit;
    const move = kit[Math.floor(this.rand() * kit.length)];
    const dmg = m.atk * COMBAT.telegraphDamageMult * (this.enraged ? BALANCE.bossEnrageDamage : 1);
    const speed = this.enraged ? 0.8 : m.phase === 2 ? 0.88 : 1; // later phases telegraph a bit faster
    const sz = SPLIT.attackSize[m.gen];
    const tele = (o: Partial<Telegraph> & Pick<Telegraph, 'kind' | 'x' | 'y' | 'r' | 'time'>, mv: BossMove) => {
      const time = o.time * speed;
      // smaller split slimes make smaller attacks (lines keep their length, get thinner)
      const r = o.kind === 'line' ? o.r : o.r * sz;
      const width = o.kind === 'line' ? (o.width ?? 0) * sz : o.width ?? 0;
      this.telegraphs.push({
        angle: 0, damage: dmg, boss: true, ownerId: m.id, wait: 0, follow: false,
        pct: BOSS_MOVE_PCT[mv] * SPLIT.damage[m.gen] * (this.enraged ? BALANCE.bossEnrageDamage : 1), ...o,
        r, width, inner: (o.inner ?? 0) * sz, time, total: time,
      });
    };
    const busy = (t: number) => {
      m.state = 'windup';
      m.timer = t * speed;
    };
    switch (move) {
      case 'slam': {
        // sometimes aimed where you're heading instead of where you are
        const lead = main && this.rand() < 0.4 ? this.clampArena({ x: p.x + this.pVel.x * 0.8, y: p.y + this.pVel.y * 0.8 }) : p;
        tele({ kind: 'circle', x: lead.x, y: lead.y, r: 120, time: 1.2 }, move);
        break;
      }
      case 'chase':
        // three slams, each landing where you are when it appears
        for (let i = 0; i < 3; i++) {
          // split-offs lay their slams ahead of / around you instead of on top of you
          const q = main ? p : this.chaosPoint(0.95 + i * 0.65);
          tele({ kind: 'circle', x: q.x, y: q.y, r: 100, time: 0.95, wait: i * 0.65, follow: main }, move);
        }
        break;
      case 'cone': {
        const a = angleTo(m, p);
        m.angle = a;
        tele({ kind: 'cone', x: m.x, y: m.y, r: 320, angle: a, width: 0.6, time: 1.1 }, move);
        busy(1.1);
        break;
      }
      case 'charge': {
        const a = angleTo(m, p);
        const len = this.chargeLength(m, a, wildMini ? SPLIT.wild.chargeLen : 460); // stops at walls (wild minis: wall to wall)
        m.angle = a;
        tele({ kind: 'line', x: m.x, y: m.y, r: len, angle: a, width: 90, time: 1.0 }, move);
        busy(1.0);
        m.chargeTo = { x: m.x + Math.cos(a) * len, y: m.y + Math.sin(a) * len };
        break;
      }
      case 'nova':
        tele({ kind: 'ring', x: m.x, y: m.y, r: 300, inner: m.r + 40, time: 1.4 }, move);
        busy(1.4);
        break;
      case 'rain':
        for (let i = 0, n = main ? 6 : 8; i < n; i++) {
          const a = this.rand() * Math.PI * 2;
          const d = i === 0 ? 0 : 60 + this.rand() * 220;
          const q = this.clampArena({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d });
          tele({ kind: 'circle', x: q.x, y: q.y, r: 85, time: 1.2, wait: i * 0.18 }, move);
        }
        break;
      case 'cross': {
        const a = this.rand() * Math.PI;
        for (const ang of [a, a + Math.PI / 2]) {
          const half = 520;
          tele({ kind: 'line', x: p.x - Math.cos(ang) * half, y: p.y - Math.sin(ang) * half, r: half * 2, angle: ang, width: 75, time: 1.3 }, move);
        }
        break;
      }
      case 'adds':
        this.spawnAdds(m, 3);
        break;
      case 'cutoff': {
        // read where you're running and wall it off: a line of circles across your path ahead,
        // plus one where you'd end up if you keep going
        const pl = this.player;
        const sp = Math.hypot(this.pVel.x, this.pVel.y);
        if (sp < 40) {
          // standing still: box you in instead
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + this.rand();
            const q = this.clampArena({ x: pl.x + Math.cos(a) * 130, y: pl.y + Math.sin(a) * 130 });
            tele({ kind: 'circle', x: q.x, y: q.y, r: 80, time: 1.0, wait: i * 0.08 }, move);
          }
          tele({ kind: 'circle', x: pl.x, y: pl.y, r: 70, time: 1.3, wait: 0.35 }, move);
          break;
        }
        const ux = this.pVel.x / sp;
        const uy = this.pVel.y / sp;
        const lead = 0.85 + this.rand() * 0.3;
        const ahead = Math.min(320, sp * lead);
        const cx = pl.x + ux * ahead;
        const cy = pl.y + uy * ahead;
        for (let i = -2; i <= 2; i++) {
          const q = this.clampArena({ x: cx - uy * i * 85, y: cy + ux * i * 85 });
          tele({ kind: 'circle', x: q.x, y: q.y, r: 75, time: 1.05, wait: Math.abs(i) * 0.06 }, move);
        }
        const far = this.clampArena({ x: pl.x + ux * Math.min(480, sp * 1.6), y: pl.y + uy * Math.min(480, sp * 1.6) });
        tele({ kind: 'circle', x: far.x, y: far.y, r: 90, time: 1.4, wait: 0.15 }, move);
        break;
      }
    }
  }

  private spawnAdds(boss: Mob, n: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand();
      const pos = { x: boss.x + Math.cos(a) * 150, y: boss.y + Math.sin(a) * 150 };
      if (!fits(this.map, pos.x, pos.y, PHYS.mobRadius, true)) continue;
      const stats = mobForZone(boss.zone, Math.max(1, ZONES[boss.zone].bossLevel - 3), false, this.rand);
      const add = this.makeMob(stats, pos, PHYS.mobRadius, boss.zone);
      add.state = 'chase';
      this.mobs.push(add);
      this.effect('poof', pos.x, pos.y, 40, '#a4161a', 0.5);
    }
    this.onToast(`${boss.name} calls for help!`, '#ff8c3b');
  }

  /** Is point p (with radius pr) inside telegraph t? */
  private inTelegraph(t: Telegraph, p: Vec, pr: number): boolean {
    const d = dist(t, p);
    if (t.kind === 'circle') return d <= t.r + pr;
    if (t.kind === 'ring') return d <= t.r + pr && d >= t.inner - pr;
    if (t.kind === 'square') return Math.abs(p.x - t.x) <= t.r + pr && Math.abs(p.y - t.y) <= t.r + pr;
    if (t.kind === 'cone') {
      if (d > t.r + pr) return false;
      if (d < pr) return true;
      return Math.abs(angDiff(t.angle, angleTo(t, p))) <= t.width + Math.atan2(pr, d);
    }
    // line
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const along = dx * Math.cos(t.angle) + dy * Math.sin(t.angle);
    const across = -dx * Math.sin(t.angle) + dy * Math.cos(t.angle);
    return along >= -pr && along <= t.r + pr && Math.abs(across) <= t.width / 2 + pr;
  }

  private updateTelegraphs(dt: number) {
    const p = this.player;
    const done: Telegraph[] = [];
    for (const t of this.telegraphs) {
      const owner = this.mobs.find((m) => m.id === t.ownerId);
      if (!owner) {
        done.push(t);
        continue;
      }
      // mob swings track the mob's position
      if (!t.boss && t.wait <= 0) {
        t.x = owner.x;
        t.y = owner.y;
      } else if (t.kind === 'cone' || t.kind === 'ring') {
        t.x = owner.x;
        t.y = owner.y;
      }
      if (t.wait > 0) {
        t.wait -= dt;
        if (t.wait <= 0 && t.follow) {
          t.x = p.x;
          t.y = p.y;
        }
        continue;
      }
      t.time -= dt;
      if (t.time > 0) continue;
      done.push(t);
      if (t.kind === 'square' || t.style === 'spout') this.effect('poof', t.x, t.y, t.r * 0.8, '#7bc950', 0.35);
      else if (t.boss && t.kind === 'line') {
        // a soft streak as wide as the charge (not as wide as it is long: that flashed the whole screen)
        this.effect('dash', t.x, t.y, t.width * 0.5, 'rgba(170,40,40,0.6)', 0.25, t.x + Math.cos(t.angle) * t.r, t.y + Math.sin(t.angle) * t.r);
      } else if (t.boss) this.effect('blast', t.x, t.y, t.r, '#ff4d4d', 0.35, t.x + Math.cos(t.angle) * t.r, t.y + Math.sin(t.angle) * t.r);
      if (t.kind === 'line' && owner.chargeTo) {
        owner.state = 'charge';
      }
      if (this.inTelegraph(t, p, p.r * 0.7) && !(t.volley && this.volleyHit.has(t.volley))) {
        if (t.volley) this.volleyHit.add(t.volley);
        const parried = this.parrying;
        this.hurtPlayer(t.damage, owner.level, t.pct);
        if (owner.group && this.isMainSlime(owner) && !parried && this.deadTimer <= 0 && this.addSlime()) return;
        if (this.deadTimer > 0) return;
      }
    }
    if (done.length) this.telegraphs = this.telegraphs.filter((t) => !done.includes(t));
  }

  /**
   * Damage to the hero. Boss attacks also have a %-of-max-HP part, so stacking HP can't
   * trivialize them; only out-levelling the boss shrinks it.
   */
  private hurtPlayer(amount: number, fromLevel: number, pct = 0) {
    const p = this.player;
    if (this.time < this.parryUntil) {
      this.counter();
      return;
    }
    const flat = amount * takenLevelMult(fromLevel, this.state.level);
    const share = pct > 0 ? this.stats.maxHp * pct * bossPctScale(fromLevel, this.state.level) : 0;
    amount = Math.max(flat, share) * this.job.damageTaken;
    const t = this.stats.t;
    if (this.rooted) amount *= SPLIT.rootedDamage;
    if (t.frostWard && this.time < this.wardUntil) amount *= 1 - t.frostWard;
    // Mana Shield keystone: part of the hit drains mana instead of HP
    if (t.manaShield && this.mana > 0) {
      const share2 = amount * MANA.shieldShare;
      const cost = (share2 / this.stats.maxHp) * 100 * MANA.shieldCost;
      const frac = Math.min(1, this.mana / Math.max(0.001, cost));
      this.mana -= cost * frac;
      amount -= share2 * frac;
    }
    if (this.state.settings.testMode) {
      // testing: nothing can hurt you
      this.float(p.x, p.y, 40, 'Immune', '#9be89b', 13);
      return;
    }
    this.hp -= amount;
    this.anim.playerHit = 1;
    this.float(p.x, p.y, 40, '-' + fmtDmg(amount), '#ff6b6b', 15);
    if (this.hp <= 0) this.playerDie();
  }

  // ---------------- Player combat ----------------
  /** Direction the player is aiming: mouse in manual, target in auto. */
  private aimAngle(range = 200): number {
    const p = this.player;
    if (this.manualActive && this.input.aim) return angleTo(p, this.input.aim);
    if (this.auto || !this.input.aim) {
      // no mouse (touch / keyboard only): soft-lock onto whatever is closest
      const t = this.target && this.mobs.includes(this.target) ? this.target : this.nearestMob(range + 40);
      if (t) return angleTo(p, t);
    }
    return p.angle;
  }

  private nearestMob(maxD = Infinity, from: Vec = this.player, needSight = false): Mob | null {
    let best: Mob | null = null;
    let bd = maxD;
    for (const m of this.mobs) {
      const d = dist(from, m) - m.r;
      if (d >= bd) continue;
      if (needSight && !lineOfSight(this.map, from.x, from.y, m.x, m.y)) continue;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  private mobsInCone(angle: number, range: number, half: number): Mob[] {
    const p = this.player;
    return this.mobs.filter((m) => {
      const d = dist(p, m);
      if (d > range + m.r + p.r) return false;
      if (d < m.r + p.r) return true;
      return Math.abs(angDiff(angle, angleTo(p, m))) <= half + Math.atan2(m.r, d);
    });
  }

  private playerAttacks(dt: number) {
    this.playerTimer -= dt;
    if (this.playerTimer > 0 || this.player.dash) return;
    const p = this.player;
    const basic = this.job.basic;
    const t = this.stats.t;
    const melee = basic.kind === 'melee';
    const reach = melee ? basic.range + p.r : basic.range * 0.92;
    const near = this.nearestMob(reach, p, !melee);
    const wantsAttack = this.input.attack || (this.auto && !!near);
    if (!wantsAttack) return;

    let angle = this.aimAngle(reach);
    // AUTO turns to face whatever is in reach
    if (this.auto && !this.input.attack && near) angle = angleTo(p, near);
    p.angle = angle;
    // attack speed: talents, plus Bloodlust for each bleeding enemy nearby
    let speed = this.stats.atkSpeed;
    if (t.bloodlust) speed += t.bloodlust * Math.min(5, this.mobs.filter((m) => m.bleeds.length && dist(m, p) < 320).length);
    const interval = basic.interval / speed;
    this.aimHold = Math.max(0.45, interval * 0.9);
    this.playerTimer = interval;
    this.anim.swing = 1;
    const dmg = this.stats.atk * basic.mult;
    this.basicCount++;

    if (melee) {
      // Blade Dance keystone: every 4th swing is a spinning double strike
      if (t.bladeDance && this.basicCount % 4 === 0) {
        this.effect('ring', p.x, p.y, 170, '#ffd166', 0.45);
        const around = this.mobs.filter((m) => dist(m, p) <= 170 + m.r);
        for (let k = 0; k < 2; k++) for (const m of around) this.damage(m, dmg * 1.2, k ? undefined : 'Blade Dance', undefined, 'proc');
        for (const m of around) if (this.mobs.includes(m)) for (let k = 0; k < 3; k++) this.applyBleed(m, dmg * 1.2);
        return;
      }
      this.effect('slash', p.x + Math.cos(angle) * 40, p.y + Math.sin(angle) * 40, basic.range, '#ffffff', 0.2, undefined, undefined, angle);
      const targets = this.mobsInCone(angle, basic.range, COMBAT.attackHalfAngle);
      for (const m of targets) this.damage(m, dmg, undefined, undefined, 'basic');
      // off-hand strike
      if (targets.length && this.rand() < this.stats.offhandChance) {
        this.effect('slash', p.x + Math.cos(angle) * 34, p.y + Math.sin(angle) * 34, basic.range * 0.9, '#c9ced6', 0.2, undefined, undefined, angle + 0.6);
        for (const m of targets) this.damage(m, dmg * this.stats.offhandRatio, 'Off-hand', '#d0d6e0', 'basic');
      }
    } else if (basic.kind === 'arrow') {
      if (this.deadeye) this.empoweredShot(angle, dmg);
      else this.shoot({ angle, speed: basic.speed ?? 900, maxDist: basic.range, damage: dmg, kind: 'arrow', color: '#e8d7a9', src: 'basic' });
    } else {
      this.shoot({ angle, speed: basic.speed ?? 650, maxDist: basic.range, damage: dmg, kind: 'bolt', color: '#b388ff', splash: basic.splash, src: 'basic' });
      // Arcane Charges build on every bolt
      if (t.charges) this.charges = Math.min(this.maxCharges(), this.charges + 1);
    }
  }

  // ---------------- Marksman: Focus & Deadeye ----------------
  get usesFocus(): boolean {
    return this.job.basic.kind === 'arrow';
  }

  /** Enter Deadeye at full Focus. Returns a reason if you can't. */
  activateDeadeye(): string | null {
    if (!this.usesFocus) return null;
    if (this.deadeye) return 'Deadeye is already active.';
    if (this.focus < FOCUS.max) return `Focus ${Math.floor(this.focus)}/${FOCUS.max}. Keep landing arrows.`;
    this.deadeye = true;
    this.deadeyeEnd = this.time + FOCUS.duration + this.stats.t.deadeyeDur;
    this.anim.flash = 0.8;
    this.anim.flashColor = '#ffd166';
    this.effect('ring', this.player.x, this.player.y, 90, '#ffd166', 0.6);
    this.float(this.player.x, this.player.y, 70, 'DEADEYE', '#ffd166', 18);
    return null;
  }

  private endDeadeye() {
    this.deadeye = false;
    this.focus = 0;
  }

  private updateFocus() {
    if (!this.usesFocus) return;
    if (this.deadeye) {
      if (this.stats.t.trueshot ? this.focus <= 0 : this.time >= this.deadeyeEnd) this.endDeadeye();
      return;
    }
    // AUTO fires Deadeye the moment it's full and something is in range
    if (this.auto && this.focus >= FOCUS.max && this.nearestMob(this.job.basic.range, this.player, true)) this.activateDeadeye();
  }

  /** An arrow landed: build Focus (or feed Deadeye). */
  private onArrowHit(crit: boolean) {
    const t = this.stats.t;
    if (this.deadeye) {
      if (crit && t.trueshot) this.focus = Math.min(FOCUS.max, this.focus + FOCUS.trueshotRefund);
      else if (crit && t.secondNature) this.deadeyeEnd += t.secondNature;
      return;
    }
    this.focus = Math.min(FOCUS.max, this.focus + (FOCUS.perHit + (crit ? FOCUS.perCrit : 0)) * (1 + t.focusGain));
  }

  /** Deadeye basic attack: piercing, harder-hitting arrows (plus talent extras). */
  private empoweredShot(angle: number, dmg: number) {
    const t = this.stats.t;
    const basic = this.job.basic;
    const power = dmg * (1 + FOCUS.damage + (t.trueshot ? FOCUS.trueshotDamage : 0));
    const range = basic.range * (t.seeking ? 1.25 : 1);
    const opts = {
      speed: (basic.speed ?? 900) * 1.15, maxDist: range, damage: power, kind: 'arrow' as const, color: '#ffd166',
      pierce: true, src: 'basic' as const, empowered: true, seeking: !!t.seeking, bleedShare: t.barbed || undefined,
    };
    this.shoot({ angle, ...opts });
    // Split Shot: extra arrows at other enemies (or fanned out if there are none)
    const extra = Math.round(t.splitShot);
    if (extra > 0) {
      const p = this.player;
      const others = this.mobs
        .filter((m) => dist(m, p) <= range && Math.abs(angDiff(angle, angleTo(p, m))) > 0.15)
        .sort((a, b) => dist(a, p) - dist(b, p));
      for (let k = 0; k < extra; k++) {
        const a = others[k] ? angleTo(p, others[k]) : angle + (k % 2 ? -1 : 1) * 0.22 * Math.ceil((k + 1) / 2);
        this.shoot({ angle: a, ...opts, damage: power * 0.6 });
      }
    }
    if (t.trueshot) this.focus = Math.max(0, this.focus - FOCUS.trueshotDrain);
  }

  maxCharges(): number {
    return this.stats.t.charges ? 2 + this.stats.t.charges : 0;
  }

  /** Mana Tap: basic bolt hits restore mana. */
  private onBoltHit() {
    const tap = this.stats.t.manaTap;
    if (tap && this.stats.maxMana) this.mana = Math.min(this.stats.maxMana, this.mana + tap);
  }

  /** Adds a bleed stack (max 5) worth `share` of the hit over 4 seconds. */
  private applyBleed(m: Mob, hit: number, shareOverride?: number) {
    const share = shareOverride ?? Math.max(this.stats.t.bleed, 0.25);
    m.bleeds.push({ tick: (hit * share) / 8, left: 8 });
    if (m.bleeds.length > 5) m.bleeds.shift();
  }

  private addShred(m: Mob, pctPerStack: number) {
    m.shred = Math.min(5, m.shred + 1);
    m.shredPct = Math.max(m.shredPct, pctPerStack);
    m.shredTimer = 4;
  }

  /** Bleed ticks, shred decay, stagger meters. */
  private tickDots(dt: number) {
    const t = this.stats.t;
    const tickEvery = t.hemorrhage ? 0.35 : 0.5;
    for (const m of [...this.mobs]) {
      if (m.shredTimer > 0) {
        m.shredTimer -= dt;
        if (m.shredTimer <= 0) m.shred = 0;
      }
      if (!m.bleeds.length) continue;
      m.bleedTimer -= dt;
      if (m.bleedTimer > 0) continue;
      m.bleedTimer = tickEvery;
      let total = 0;
      for (const b of m.bleeds) {
        total += b.tick;
        b.left--;
      }
      m.bleeds = m.bleeds.filter((b) => b.left > 0);
      if (t.bleedHeal) this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * t.bleedHeal);
      this.damage(m, total, undefined, '#e5383b', 'bleed');
    }
  }

  private shoot(o: {
    angle: number; speed: number; maxDist: number; damage: number; kind: Projectile['kind'];
    color: string; splash?: number; pierce?: boolean; label?: string; src?: DmgSrc;
    empowered?: boolean; seeking?: boolean; bleedShare?: number;
  }) {
    const p = this.player;
    this.projectiles.push({
      x: p.x + Math.cos(o.angle) * (p.r + 6), y: p.y + Math.sin(o.angle) * (p.r + 6),
      angle: o.angle, speed: o.speed, traveled: 0, maxDist: o.maxDist, damage: o.damage, kind: o.kind,
      color: o.color, splash: o.splash ?? 0, pierce: !!o.pierce, label: o.label, hit: [], src: o.src ?? 'skill',
      empowered: o.empowered, seeking: o.seeking, bleedShare: o.bleedShare,
    });
  }

  private updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      if (pr.seeking) {
        // curve toward the nearest enemy ahead that this arrow hasn't hit yet
        let best: Mob | null = null;
        let bd = 360;
        for (const m of this.mobs) {
          if (pr.hit.includes(m.id)) continue;
          const d = dist(m, pr);
          if (d < bd && Math.abs(angDiff(pr.angle, angleTo(pr, m))) < 1.6) {
            bd = d;
            best = m;
          }
        }
        if (best) {
          const turn = 7 * dt;
          pr.angle += Math.max(-turn, Math.min(turn, angDiff(pr.angle, angleTo(pr, best))));
        }
      }
      const step = pr.speed * dt;
      let alive = true;
      // sub-step so fast arrows can't skip past a mob
      const sub = Math.max(1, Math.ceil(step / 20));
      for (let i = 0; i < sub && alive; i++) {
        pr.x += Math.cos(pr.angle) * (step / sub);
        pr.y += Math.sin(pr.angle) * (step / sub);
        pr.traveled += step / sub;
        if (!walkablePoint(this.map, pr.x, pr.y) || pr.traveled >= pr.maxDist) {
          if (pr.splash) this.explode(pr);
          alive = false;
          break;
        }
        const hit = this.mobs.find((m) => !pr.hit.includes(m.id) && dist(m, pr) <= m.r + 8);
        if (!hit) continue;
        if (pr.splash) {
          this.explode(pr);
          alive = false;
        } else {
          const crit = this.damage(hit, pr.damage, pr.label, pr.empowered ? '#ffd166' : undefined, pr.src, !!pr.empowered);
          if (pr.src === 'basic') this.onBoltHit();
          if (pr.src === 'basic' && pr.kind === 'arrow') {
            this.onArrowHit(crit);
            if (pr.bleedShare && this.mobs.includes(hit)) this.applyBleed(hit, pr.damage, pr.bleedShare);
          }
          if (pr.pierce) pr.hit.push(hit.id);
          else alive = false;
        }
      }
      if (alive) keep.push(pr);
    }
    this.projectiles = keep;
  }

  private explode(pr: Projectile) {
    this.effect('blast', pr.x, pr.y, pr.splash, pr.color, 0.3);
    const hits = this.mobs.filter((m) => dist(m, pr) <= pr.splash + m.r);
    for (const m of hits) this.damage(m, pr.damage, pr.label, undefined, pr.src);
    if (pr.src === 'basic' && hits.length) this.onBoltHit();
  }

  private castSkills(dt: number) {
    const p = this.player;
    this.job.skills.forEach((sk, i) => {
      if (this.state.level < sk.unlock) return;
      this.skillCd[sk.id] -= dt;
      if (this.skillCd[sk.id] > 0 || p.dash) return;
      const pressed = this.input.skills[i];
      if (!this.canAfford(sk)) {
        if (pressed && this.time - this.manaToastAt > 1.5) {
          this.manaToastAt = this.time;
          this.onToast('Not enough mana.', '#4ea1ff');
        }
        return;
      }
      let dmg = this.stats.atk * sk.mult;
      if (sk.id === 'whirl') dmg *= 1 + this.stats.t.whirlBonus;
      if (sk.id === 'pierce') dmg *= 1 + this.stats.t.pierceBonus;
      const range = sk.range ?? 400;
      const radius = sk.radius ?? 150;

      switch (sk.type) {
        case 'dash': {
          let angle = this.aimAngle(range);
          let go = pressed;
          if (!go && this.auto) {
            const t = this.nearestMob(range + 20, p, true);
            if (t && !this.standingInBossTelegraph()) {
              angle = angleTo(p, t);
              go = true;
            }
          }
          if (!go) return;
          dmg *= this.startSkill(sk);
          p.angle = angle;
          const tx = p.x + Math.cos(angle) * range;
          const ty = p.y + Math.sin(angle) * range;
          p.dash = { tx, ty, t: 0.35 };
          for (const m of this.mobs) {
            const dx = m.x - p.x;
            const dy = m.y - p.y;
            const along = dx * Math.cos(angle) + dy * Math.sin(angle);
            const across = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
            if (along > -m.r && along < range + m.r && across < COMBAT.dashWidth + m.r) this.damage(m, dmg, sk.name);
          }
          this.effect('dash', p.x, p.y, COMBAT.dashWidth, sk.color, 0.35, tx, ty);
          return;
        }
        case 'spin': {
          const hits = this.mobs.filter((m) => dist(p, m) <= radius + m.r);
          if (!pressed && !(this.auto && hits.length)) return;
          dmg *= this.startSkill(sk);
          this.effect('ring', p.x, p.y, radius, sk.color, 0.5);
          for (const m of hits) this.damage(m, dmg);
          if (sk.id === 'whirl' && this.stats.t.whirlBonus) for (const m of hits) if (this.mobs.includes(m)) this.applyBleed(m, dmg);
          if (sk.id === 'nova' && this.stats.t.frostWard) {
            this.wardUntil = this.time + 4;
            this.effect('ring', p.x, p.y, 50, '#90e0ef', 4);
          }
          return;
        }
        case 'groundAoe': {
          let spot: Vec | null = null;
          if (pressed) {
            spot = (this.manualActive && this.input.aim) || this.bestCluster(range, radius) ||
              { x: p.x + Math.cos(p.angle) * Math.min(150, range), y: p.y + Math.sin(p.angle) * Math.min(150, range) };
            spot = this.clampTo(spot, range);
          } else if (this.auto) {
            spot = this.bestCluster(range, radius);
          }
          if (!spot) return;
          dmg *= this.startSkill(sk);
          const delay = sk.delay ?? 0.5;
          this.blasts.push({ x: spot.x, y: spot.y, r: radius, time: delay, damage: dmg, color: sk.color, label: sk.name });
          this.effect('star', spot.x, spot.y, radius, sk.color, delay + 0.3);
          return;
        }
        case 'pierce':
        case 'fan':
        case 'fireball': {
          let go = pressed;
          let angle = this.aimAngle(range);
          if (!go && this.auto) {
            const t = this.nearestMob(range * 0.9, p, true);
            if (t) {
              angle = angleTo(p, t);
              go = true;
            }
          }
          if (!go) return;
          dmg *= this.startSkill(sk);
          p.angle = angle;
          this.anim.swing = 1;
          if (sk.type === 'pierce') {
            this.shoot({ angle, speed: 1400, maxDist: range, damage: dmg, kind: 'arrow', color: sk.color, pierce: true, label: sk.name });
          } else if (sk.type === 'fan') {
            const n = sk.count ?? 5;
            for (let k = 0; k < n; k++) {
              const a = angle + (k - (n - 1) / 2) * 0.13;
              this.shoot({ angle: a, speed: 1000, maxDist: range, damage: dmg, kind: 'arrow', color: sk.color });
            }
          } else {
            this.shoot({ angle, speed: 700, maxDist: range, damage: dmg, kind: 'fireball', color: sk.color, splash: radius, label: sk.name });
          }
          return;
        }
      }
    });
  }

  private clampTo(spot: Vec, range: number): Vec {
    const p = this.player;
    const d = dist(p, spot);
    if (d <= range) return spot;
    const k = range / d;
    return { x: p.x + (spot.x - p.x) * k, y: p.y + (spot.y - p.y) * k };
  }

  private standingInBossTelegraph(): boolean {
    return this.telegraphs.some((t) => t.boss && t.wait <= 0 && this.inTelegraph(t, this.player, this.player.r));
  }

  private skillCost(sk: SkillDef): number {
    return (sk.mana ?? 0) * (this.stats.t.manaShield ? MANA.keystoneCostMult : 1);
  }

  private canAfford(sk: SkillDef): boolean {
    return !this.stats.maxMana || this.mana >= this.skillCost(sk);
  }

  /** Puts a skill on cooldown, pays its mana and spends Arcane Charges. Returns a damage multiplier. */
  private startSkill(sk: SkillDef): number {
    const t = this.stats.t;
    const { id, cd, color } = sk;
    this.skillCd[id] = cd * (1 - this.stats.cdr);
    let mult = 1;
    if (this.stats.maxMana) {
      const cost = this.skillCost(sk);
      this.mana -= cost;
      if (this.charges > 0) {
        if (t.surge && this.charges >= this.maxCharges()) this.mana = Math.min(this.stats.maxMana, this.mana + cost * t.surge);
        mult = 1 + this.charges * (0.08 + t.chargeBonus);
        this.charges = 0;
      }
    }
    this.aimHold = 0.5;
    this.anim.flash = 0.6;
    this.anim.flashColor = color;
    return mult;
  }

  /** Point within range that would hit the most monsters. */
  private bestCluster(range: number, radius: number): Vec | null {
    let best: Vec | null = null;
    let bestN = 0;
    for (const m of this.mobs) {
      if (dist(this.player, m) > range) continue;
      const n = this.mobs.filter((o) => dist(o, m) <= radius).length + (m.boss ? 5 : 0);
      if (n > bestN) {
        bestN = n;
        best = { x: m.x, y: m.y };
      }
    }
    return best;
  }

  private updateBlasts(dt: number) {
    for (const b of this.blasts) {
      b.time -= dt;
      if (b.time > 0) continue;
      this.effect('blast', b.x, b.y, b.r, b.color, 0.4);
      for (const m of this.mobs.filter((m) => dist(b, m) <= b.r + m.r)) this.damage(m, b.damage, b.label, undefined, 'skill');
    }
    this.blasts = this.blasts.filter((b) => b.time > 0);
  }

  private updateCompanions(dt: number) {
    const p = this.player;
    const n = this.party.length;
    this.party.forEach((c, i) => {
      // trail behind the hero in a little fan
      const back = p.angle + Math.PI + (i - (n - 1) / 2) * 0.7;
      const tx = p.x + Math.cos(back) * 60;
      const ty = p.y + Math.sin(back) * 60;
      c.x += (tx - c.x) * Math.min(1, dt * 4);
      c.y += (ty - c.y) * Math.min(1, dt * 4);

      c.timer -= dt;
      if (c.timer > 0) return;
      const best = this.nearestMob(380, c);
      if (!best) return;
      const o = this.state.companions[c.id];
      if (!o) return;
      c.timer = BALANCE.companionAttackInterval;
      c.hit = 1;
      const color = COMPANION[c.id].color;
      this.effect('bolt', c.x, c.y, 6, color, 0.2, best.x, best.y);
      this.damage(best, this.stats.atk * companionHitMult(c.id, o.level), undefined, color, 'companion');
    });
  }

  /** Deals damage (with every talent modifier and proc). Returns whether it crit. */
  private damage(m: Mob, base: number, label?: string, color?: string, src: DmgSrc = 'skill', empowered = false): boolean {
    if (!this.mobs.includes(m)) return false;
    if (m.invuln > 0) {
      if (src !== 'bleed') this.float(m.x, m.y, m.r * 2 + 16, 'Immune', '#9a9a9a', 13);
      return false;
    }
    const t = this.stats.t;
    const critRate = this.stats.critRate + t.chargeCrit * this.charges;
    const canCrit = src !== 'bleed' || t.hemorrhage > 0;
    const crit = canCrit && this.rand() < critRate;
    let mult = dealtLevelMult(m.level, this.state.level) * (this.state.settings.testMode ? 10 : 1);
    mult *= 1 + m.shred * m.shredPct;
    if (m.boss) mult *= 1 + t.bossDmg;
    if (m.staggerUntil > this.time) mult *= 1.25 + t.staggerBonus;
    if (t.longShot && src !== 'companion' && src !== 'bleed' && dist(this.player, m) > 250) mult *= 1 + t.longShot;
    const group = m.group ? this.splitGroup(m) : null;
    if (group && group.length > 1) {
      // the slimes share one life: hitting several at once has diminishing returns
      m.lastHitAt = this.time;
      const hitRecently = group.filter((o) => this.time - o.lastHitAt < SPLIT.multiHitWindow).length;
      mult /= Math.sqrt(Math.max(1, hitRecently));
    }
    if (crit && t.killshot && m.hp / m.maxHp < 0.3) mult *= 3;
    const dmg = base * (crit ? this.stats.critDmg : 1) * (src === 'bleed' ? 1 : 0.9 + this.rand() * 0.2) * mult;
    m.hp -= dmg;
    if (group) for (const o of group) o.hp = m.hp;
    m.hitFlash = src === 'bleed' ? Math.max(m.hitFlash, 0.4) : 1;
    if (m.state === 'idle') m.state = 'chase';
    const small = src === 'bleed';
    const text = (label ? label + ' ' : '') + fmtDmg(dmg) + (crit ? '!' : '');
    this.float(m.x + (this.rand() - 0.5) * 20, m.y, m.r * 2 + 16, text, color ?? (crit ? '#ffb703' : '#ffffff'), small ? 12 : crit ? 19 : label ? 17 : 14);

    // ---- talent procs from your own hits ----
    if (src === 'basic' || src === 'skill' || src === 'proc') {
      if (src === 'basic' && t.bleed) this.applyBleed(m, dmg);
      if (t.shred) this.addShred(m, t.shred);
      if (crit && t.critShred) this.addShred(m, t.critShred);
      if (crit && t.quickdraw && this.skillCd.pierce !== undefined) this.skillCd.pierce -= t.quickdraw;
      if (crit && t.flux && this.fluxCd <= 0) {
        this.fluxCd = 0.15;
        for (const k of Object.keys(this.skillCd)) this.skillCd[k] -= t.flux;
      }
      if (m.boss && t.stagger && m.staggerUntil <= this.time && m.hp > 0) {
        // each stagger makes the next one slower to build (bosses adapt)
        m.stagger += (2 * t.stagger * (empowered ? 2 : 1)) / (1 + 0.5 * m.staggers);
        if (m.stagger >= 100) this.staggerBoss(m);
      }
      if (crit && t.ricochet && src !== 'proc' && this.rand() < t.ricochet) {
        const other = this.mobs.filter((o) => o !== m && dist(o, m) < 280).sort((a, b) => dist(a, m) - dist(b, m))[0];
        if (other) {
          this.effect('bolt', m.x, m.y, 5, '#f4a261', 0.2, other.x, other.y);
          this.damage(other, base, 'Ricochet', '#f4a261', 'proc');
        }
      }
    }
    if (m.boss && m.hp > 0) this.checkPhase(m);
    if (m.hp <= 0) this.killMob(m);
    return crit;
  }

  /** Marksman: a full stagger meter stuns the boss. */
  private staggerBoss(m: Mob) {
    const dur = this.stats.t.killshot ? 5 : 2.5;
    m.stagger = 0;
    m.staggers++;
    m.staggerUntil = this.time + dur;
    m.state = 'recover';
    m.timer = dur;
    m.actionTimer = Math.max(m.actionTimer, dur + 0.5);
    m.chargeTo = null;
    this.telegraphs = this.telegraphs.filter((t) => t.ownerId !== m.id);
    this.effect('ring', m.x, m.y, 120, '#ffd166', 0.6);
    this.float(m.x, m.y, m.r * 2 + 40, 'STAGGERED', '#ffd166', 20);
  }

  /** Bosses get faster and learn new moves at 60% and 25% HP. Slime bosses also split. */
  private checkPhase(m: Mob) {
    const frac = m.hp / m.maxHp;
    const [p2, p3] = phaseAt(m.zone);
    const want = frac <= p3 ? 2 : frac <= p2 ? 1 : 0;
    if (want <= m.phase) return;
    const group = m.group ? this.splitGroup(m) : [m];
    for (const b of group) {
      b.phase = want;
      b.invuln = 1.4;
      b.actionTimer = 1.6 + this.rand() * 0.8;
      b.state = 'recover';
      b.timer = 1.4;
      b.chargeTo = null;
      this.telegraphs = this.telegraphs.filter((t) => t.ownerId !== b.id);
    }
    this.anim.flash = 1;
    this.anim.flashColor = '#a4161a';
    this.effect('ring', m.x, m.y, 260, '#a4161a', 0.8);
    if (m.group) {
      // one huge hit can skip a threshold: still do every split it skipped
      const from = group.reduce((a, b) => Math.max(a, b.gen), 0);
      for (let gen = from + 1; gen <= want; gen++) for (const b of this.splitGroup(m)) if (b.gen < gen) this.splitSlime(b, gen);
      this.onToast(want === 1 ? `${m.name} splits in two!` : `${m.name} splits again! Smaller, faster...`, '#f72585');
      return;
    }
    this.onToast(want === 1 ? `${m.name} grows furious!` : `${m.name} is desperate. Its attacks come faster!`, '#f72585');
    if (ZONES[m.zone].bossKit[want]?.includes('adds')) this.spawnAdds(m, 2);
  }

  /** All living slimes sharing this boss's health pool (including itself). */
  splitGroup(m: Mob): Mob[] {
    return this.mobs.filter((o) => o.group === m.group);
  }

  /** One slime becomes two smaller, faster ones at generation `gen`. */
  private splitSlime(b: Mob, gen: number) {
    b.gen = gen;
    b.r = PHYS.bossRadius * SPLIT.radius[gen];
    const a = this.rand() * Math.PI * 2;
    const twin: Mob = { ...b, id: this.nextMobId++, bleeds: [], path: null, chargeTo: null, spawnAnim: 0.6, stagger: 0, staggers: 0, hop: null, hopTimer: 0.8 + this.rand() * 0.8 };
    b.hop = null;
    b.hopTimer = 0.8 + this.rand() * 0.8;
    for (const [o, s] of [[b, 1], [twin, -1]] as const) {
      const nx = b.x + Math.cos(a) * 70 * s;
      const ny = b.y + Math.sin(a) * 70 * s;
      if (fits(this.map, nx, ny, o.r, true)) {
        o.x = nx;
        o.y = ny;
      }
    }
    this.mobs.push(twin);
    this.effect('poof', b.x, b.y, 90, b.color, 0.5);
  }

  private effect(
    kind: Effect['kind'], x: number, y: number, r: number, color: string, life: number,
    x2?: number, y2?: number, angle?: number,
  ) {
    if (this.effects.length > 70) this.effects.shift();
    this.effects.push({ kind, x, y, r, color, life, maxLife: life, x2, y2, angle });
  }

  private float(x: number, y: number, z: number, text: string, color: string, size: number) {
    if (this.floats.length > 50) this.floats.shift();
    this.floats.push({ x, y, z, text, color, life: 0.9, size });
  }

  private killMob(m: Mob) {
    const s = this.state;
    if (m.group) {
      // the shared life is gone: every slime bursts together, the reward is given once
      for (const o of this.splitGroup(m)) {
        if (o === m) continue;
        this.effect('poof', o.x, o.y, o.r * 1.4, o.color, 0.4);
        this.telegraphs = this.telegraphs.filter((t) => t.ownerId !== o.id);
        if (this.target === o) this.target = null;
      }
      this.mobs = this.mobs.filter((x) => x.group !== m.group);
    }
    this.mobs = this.mobs.filter((x) => x !== m);
    const camp = this.camps[m.camp];
    if (camp && camp.mob === m.id) {
      camp.mob = null;
      const [lo, hi] = this.inCave ? BALANCE.caveRespawn : [10, 18];
      camp.timer = lo + this.rand() * (hi - lo);
    }
    this.telegraphs = this.telegraphs.filter((t) => t.ownerId !== m.id);
    if (this.target === m) this.target = null;
    this.effect('poof', m.x, m.y, m.r * 1.4, m.color, 0.4);
    s.gold += m.gold * (this.inCave ? BALANCE.caveGoldMult : 1);
    const exp = m.exp * expLevelMult(m.level, s.level) * (this.inCave ? BALANCE.caveExpMult : 1);
    this.expLog.push({ t: this.time, exp });
    if (this.expLog.length > 600) this.expLog.splice(0, 100);
    this.addExp(exp);
    s.totals.kills++;
    this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * BALANCE.healOnKillPct);
    if (this.rand() < BALANCE.gemDropChance) {
      s.gems += 1;
      this.float(m.x, m.y, 60, '+1 💎', '#7df9ff', 14);
    }

    if (m.boss) {
      const z = m.zone;
      s.totals.bosses++;
      s.bossKills[z] = (s.bossKills[z] ?? 0) + 1;
      if (z === s.bossesCleared) {
        s.bossesCleared++;
        s.gems += BALANCE.bossFirstClearGems;
        const next = ZONES[z + 1];
        this.onToast(`${m.name} defeated! +${BALANCE.bossFirstClearGems} 💎${next ? ` The ${next.name} altar is unsealed.` : ''}`, '#ffc23d');
      } else {
        this.onToast(`${m.name} defeated again!`, '#ffc23d');
      }
      this.bossCooldown[z] = BALANCE.bossRespawn;
      this.enraged = false;
      // the boss's minions crumble with it
      for (const a of this.mobs.filter((x) => x.zone === z && this.inLair >= 0)) this.effect('poof', a.x, a.y, 30, '#ffffff', 0.4);
      if (this.inLair >= 0) this.mobs = [];
      this.lairDoneAt = this.time;
      this.bossZone = -1;
      this.hp = this.stats.maxHp;
      this.telegraphs = [];
      this.goo = [];
    this.waves = [];
    this.slowUntil = 0;
    this.slimeStacks = 0;
      this.rootedUntil = 0;
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
      const unlocked = this.job.skills.find((k) => k.unlock === s.level);
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
    if (this.deadeye) this.endDeadeye();
    this.focus = 0;
    s.totals.deaths++;
    this.deadTimer = BALANCE.playerDeathDelay;
    this.hp = 0;
    if (this.inBossFight) {
      if (this.offerRetry && this.inLair >= 0) this.retryZone = this.inLair;
      this.endBoss();
      this.onToast('Defeated by the boss. Get stronger and try again.', '#ff6b6b');
    } else {
      this.onToast(`You were defeated. Returning to the ${ZONES[this.zone].name} entrance.`, '#ff6b6b');
    }
    this.telegraphs = [];
    this.blasts = [];
    this.projectiles = [];
    this.target = null;
    this.travelGoal = null;
    this.player.dash = null;
    for (const m of this.mobs) if (m.state !== 'idle') m.state = 'idle';
    this.dirty = true;
  }

  /** Removes the boss (lost or left the fight). It can be retried right away. */
  private endBoss() {
    this.goo = [];
    this.waves = [];
    this.slowUntil = 0;
    this.slimeStacks = 0;
    this.rootedUntil = 0;
    const ids = this.mobs.filter((m) => m.boss).map((m) => m.id);
    this.mobs = this.mobs.filter((m) => !m.boss);
    this.telegraphs = this.telegraphs.filter((t) => !ids.includes(t.ownerId));
    this.bossZone = -1;
    this.enraged = false;
    this.target = null;
  }

  private failBoss(msg: string) {
    this.endBoss();
    this.onToast(msg + ' The boss sinks back into its circle.', '#ff6b6b');
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
    for (const slot of SLOTS) if (!this.state.equipped[slot]) this.equipBest(slot);
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
    const job = this.job;
    let perSec = ((st.atk * job.basic.mult) / job.basic.interval) * st.atkSpeed * (1 + st.offhandChance * st.offhandRatio);
    if (job.basic.kind === 'arrow') perSec *= 1 + FOCUS.damage * 0.35; // rough Deadeye uptime
    for (const sk of job.skills) if (this.state.level >= sk.unlock) perSec += (st.atk * sk.mult * (sk.count ?? 1) * 0.6) / sk.cd;
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
    // farm monsters around where the hero is standing
    const m = mobForZone(this.zone, this.levelAt(this.player.x), false, this.rand);
    const hpEff = m.hp / dealtLevelMult(m.level, this.state.level);
    const killTime = Math.max(0.6, hpEff / Math.max(1, this.dps())) + 1.5;
    const kills = Math.floor((capped / killTime) * BALANCE.offlineEfficiency);
    if (kills <= 0) return null;
    const gold = kills * m.gold;
    const exp = kills * m.exp * expLevelMult(m.level, this.state.level);
    const gems = Math.floor(kills * BALANCE.gemDropChance);
    this.state.gold += gold;
    this.state.gems += gems;
    this.state.totals.kills += kills;
    const levels = this.addExp(exp);
    this.dirty = true;
    return { seconds: capped, kills, gold, exp, gems, levels };
  }
}

export function fmtDmg(n: number): string {
  if (n < 1e4) return Math.round(n).toLocaleString('en-US');
  const units = ['K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae'];
  let i = -1;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return n.toFixed(n >= 100 ? 0 : 1) + units[i];
}
