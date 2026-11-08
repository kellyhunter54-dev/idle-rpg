import {
  BALANCE, COMPANION, COMPANIONS, GROWTH, GrowthKey, JobDef, MobStats, RARITIES, Rarity, SLOTS,
  Slot, TIERS, TIER_WEIGHTS, ZONES, jobOf, companionHitMult, dealtLevelMult, enhanceCopies,
  expLevelMult, expToNext, gearId, gearScore, mobForZone, parseGear, takenLevelMult,
} from './data';
import {
  GameMap, PHYS, TILE, depthInZone, findPath, fits, generateWorld, lineOfSight, moveCircle, walkablePoint,
  zoneAtX,
} from './map';
import { GameState } from './state';
import { Stats, computeStats } from './stats';

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
}

export function emptyInput(): Input {
  return { moveX: 0, moveY: 0, attack: false, aim: null, skills: [false, false, false] };
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
  chargeTo: Vec | null;
}

export interface Telegraph {
  kind: 'circle' | 'cone' | 'line' | 'ring';
  x: number;
  y: number;
  r: number; // circle/ring radius, cone/line length
  inner: number; // ring inner radius
  angle: number;
  width: number; // cone: half-angle (rad); line: width
  time: number;
  total: number;
  damage: number;
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
  aiReaction: 0.3, // seconds before AUTO starts dodging a telegraph
};

// ---------------- Game ----------------

export class Game {
  state: GameState;
  stats!: Stats;
  rand: () => number;
  time = 0;

  map!: GameMap;
  /** Zone the hero is standing in. */
  zone = 0;
  player: Player;
  hp = 0;
  mobs: Mob[] = [];
  telegraphs: Telegraph[] = [];
  private blasts: PendingBlast[] = [];
  projectiles: Projectile[] = [];
  private nextMobId = 1;
  private spawnTimer = 0;
  private bossCooldown: number[] = ZONES.map(() => 0);
  private bossZone = -1;
  private lockedToastAt = -99;
  /** Where AUTO is walking to (zone travel / boss altar), if anywhere. */
  travelGoal: { x: number; y: number; boss: number | null; label: string } | null = null;
  /** Rolling EXP log for the EXP/hour readout. */
  private expLog: { t: number; exp: number }[] = [];
  private aimHold = 0;
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
    for (const s of this.job.skills) this.skillCd[s.id] = s.cd * 0.5;
    this.initWorld();
    this.syncParty();
  }

  recalc() {
    const prevMax = this.stats?.maxHp ?? 0;
    this.stats = computeStats(this.state);
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

  get auto(): boolean {
    return this.state.settings.auto;
  }

  setAuto(on: boolean) {
    this.state.settings.auto = on;
    this.dirty = true;
  }

  get manualActive(): boolean {
    return !this.auto || this.time - this.lastInputTime < PHYS.manualTimeout;
  }

  private initWorld() {
    this.map = generateWorld(ZONES.length);
    const saved = this.state.pos;
    if (saved && fits(this.map, saved.x, saved.y, PHYS.playerRadius)) Object.assign(this.player, { x: saved.x, y: saved.y });
    else Object.assign(this.player, this.map.entrances[0]);
    this.zone = zoneAtX(this.map, this.player.x);
    // populate every zone so the world feels alive
    for (let z = 0; z < ZONES.length; z++) for (let i = 0; i < PHYS.mobsPerZone; i++) this.spawnMob(z);
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
    const e = this.map.entrances[z];
    if (!e) return;
    this.travelGoal = { x: e.x, y: e.y, boss: null, label: ZONES[z].name };
    this.target = null;
    this.path = null;
    if (!this.auto) this.setAuto(true);
  }

  /** AUTO walks to a zone's boss altar and starts the fight. */
  goToBoss(z: number) {
    const a = this.map.altars[z];
    if (!a) return;
    this.travelGoal = { x: a.x, y: a.y, boss: z, label: `${ZONES[z].name} boss` };
    this.target = null;
    this.path = null;
    if (!this.auto) this.setAuto(true);
  }

  cancelTravel() {
    this.travelGoal = null;
    this.path = null;
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
    if (inp.moveX || inp.moveY || inp.attack || inp.skills.some(Boolean)) this.lastInputTime = this.time;

    if (this.deadTimer > 0) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) {
        this.hp = this.stats.maxHp;
        Object.assign(this.player, { ...this.map.entrances[this.zone], dash: null });
      }
      inp.skills = inp.skills.map(() => false);
      return;
    }

    this.aimHold -= dt;
    for (let z = 0; z < this.bossCooldown.length; z++) this.bossCooldown[z] -= dt;
    this.updateSpawning(dt);
    this.movePlayer(dt);
    this.trackZone();
    this.checkAltars();
    this.updateMobs(dt);
    this.updateTelegraphs(dt);
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
      if (this.bossTimer <= 0) this.failBoss('Time ran out!');
      const a = this.map.altars[this.bossZone];
      if (a && dist(a, this.player) > BALANCE.bossLeash) this.failBoss('You left the fight.');
    }
    const pos = this.state.pos;
    if (pos) {
      pos.x = this.player.x;
      pos.y = this.player.y;
    } else this.state.pos = { x: this.player.x, y: this.player.y };
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

  /** Stepping onto a boss altar starts the fight (if it's that boss's turn). */
  private checkAltars() {
    if (this.inBossFight) return;
    const p = this.player;
    this.map.altars.forEach((a, z) => {
      if (dist(a, p) > PHYS.altarRadius) return;
      // AUTO never starts a boss by accident; you have to walk there yourself or use "Fight boss".
      const intended = this.manualActive || this.travelGoal?.boss === z;
      if (!intended) return;
      const status = this.bossStatus(z);
      if (status === 'ready') {
        this.startBoss(z);
        if (this.travelGoal?.boss === z) this.travelGoal = null;
      } else if (this.time - this.lockedToastAt > 4) {
        this.lockedToastAt = this.time;
        if (status === 'locked') this.onToast(`Sealed. Defeat ${ZONES[z - 1].name}'s boss first.`, '#ff8c3b');
        else this.onToast(`The boss returns in ${Math.ceil(this.bossCooldown[z])}s.`, '#c9a227');
        if (this.travelGoal?.boss === z) this.travelGoal = null;
      }
    });
  }

  private startBoss(z: number) {
    const a = this.map.altars[z];
    // clear the arena
    for (const m of this.mobs.filter((m) => m.zone === z && dist(m, a) < 700)) this.effect('poof', m.x, m.y, 30, '#ffffff', 0.4);
    this.mobs = this.mobs.filter((m) => !(m.zone === z && dist(m, a) < 700));
    const stats = mobForZone(z, ZONES[z].bossLevel, true, this.rand);
    const ang = angleTo(this.player, a);
    const boss = this.makeMob(stats, { x: a.x + Math.cos(ang) * 120, y: a.y + Math.sin(ang) * 120 }, PHYS.bossRadius, z);
    if (!fits(this.map, boss.x, boss.y, boss.r * 0.6, true)) Object.assign(boss, { x: a.x, y: a.y });
    boss.actionTimer = 2.5;
    this.mobs.push(boss);
    this.bossZone = z;
    this.bossTimer = BALANCE.bossTimeLimit;
    this.target = boss;
    this.onToast(`${stats.name} (Lv ${stats.level}) awakens!`, '#f72585');
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
  private updateSpawning(dt: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = PHYS.mobSpawnInterval;
    // top up the zone with the fewest monsters (the boss arena stays clear during a fight)
    let best = -1;
    let fewest = PHYS.mobsPerZone;
    for (let z = 0; z < ZONES.length; z++) {
      const n = this.mobs.filter((m) => m.zone === z && !m.boss).length;
      if (n < fewest) {
        fewest = n;
        best = z;
      }
    }
    if (best >= 0) this.spawnMob(best);
  }

  private spawnMob(z: number) {
    const tiles = this.map.zoneFloor[z];
    if (!tiles?.length) return;
    for (let tries = 0; tries < 25; tries++) {
      const i = tiles[Math.floor(this.rand() * tiles.length)];
      const tx = i % this.map.w;
      const p = { x: (tx + 0.5) * TILE, y: ((i - tx) / this.map.w + 0.5) * TILE };
      if (dist(p, this.player) < 420) continue;
      const altar = this.map.altars[z];
      if (altar && dist(p, altar) < (this.bossZone === z ? 700 : 260)) continue;
      const stats = mobForZone(z, this.levelAt(p.x), false, this.rand);
      this.mobs.push(this.makeMob(stats, p, PHYS.mobRadius, z));
      return;
    }
  }

  private makeMob(stats: MobStats, p: Vec, r: number, zone: number): Mob {
    return {
      ...stats, id: this.nextMobId++, zone, maxHp: stats.hp, x: p.x, y: p.y, r, angle: this.rand() * 6.28,
      state: 'idle', timer: 0, homeX: p.x, homeY: p.y, wander: { x: 0, y: 0 }, path: null, pathTimer: 0,
      hitFlash: 0, spawnAnim: 1, moving: false, actionTimer: 0, chargeTo: null,
    };
  }

  // ---------------- Player movement ----------------
  private movePlayer(dt: number) {
    const p = this.player;

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
      ({ x: mx, y: my } = this.autoPilot(dt));
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
    const np = moveCircle(this.map, p.x, p.y, mx * PHYS.playerSpeed * dt, my * PHYS.playerSpeed * dt, p.r);
    p.x = np.x;
    p.y = np.y;
  }

  /** Where AUTO walks: dodge boss telegraphs first, then go fight the nearest monster. */
  private autoPilot(dt: number): Vec {
    const p = this.player;
    const zero = { x: 0, y: 0 };

    // 1. Dodge
    for (const t of this.telegraphs) {
      if (!t.boss || t.total - t.time < COMBAT.aiReaction) continue;
      if (!this.inTelegraph(t, p, p.r + 10)) continue;
      return this.escapeDir(t);
    }

    // 2. Travel somewhere (zone or boss altar) if asked to
    if (this.travelGoal && !this.inBossFight) {
      const g = this.travelGoal;
      const gd = dist(p, g);
      if (gd < (g.boss !== null ? PHYS.altarRadius * 0.5 : 60)) {
        if (g.boss === null) this.travelGoal = null;
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
    if (!t) return zero;

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

  private escapeDir(t: Telegraph): Vec {
    const p = this.player;
    let ax: number;
    let ay: number;
    if (t.kind === 'circle') {
      ax = p.x - t.x;
      ay = p.y - t.y;
    } else if (t.kind === 'ring') {
      // ring: get inside the safe middle
      ax = t.x - p.x;
      ay = t.y - p.y;
    } else {
      // cone / line: step sideways off the axis
      const side = Math.sign(angDiff(t.angle, angleTo(t, p))) || 1;
      ax = Math.cos(t.angle + (Math.PI / 2) * side);
      ay = Math.sin(t.angle + (Math.PI / 2) * side);
    }
    const l = Math.hypot(ax, ay) || 1;
    ax /= l;
    ay /= l;
    // if that direction is blocked, try rotating it
    for (const rot of [0, 0.7, -0.7, 1.4, -1.4, Math.PI]) {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const dx = ax * c - ay * s;
      const dy = ax * s + ay * c;
      if (fits(this.map, p.x + dx * 30, p.y + dy * 30, p.r)) return { x: dx, y: dy };
    }
    return { x: ax, y: ay };
  }

  private pickTarget(): Mob | null {
    const p = this.player;
    let best: Mob | null = null;
    let bestCost = Infinity;
    for (const m of this.mobs) {
      if ((this.ignore.get(m.id) ?? 0) > this.time) continue;
      if (m.zone !== this.zone) continue;
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
      const d = dist(m, p);
      if (d > PHYS.activeRange && !m.boss) {
        m.moving = false;
        if (m.state !== 'idle') m.state = 'idle';
        continue;
      }
      const touch = m.r + p.r + COMBAT.mobReach;
      const speed = m.boss ? PHYS.bossSpeed : PHYS.mobSpeed;
      m.moving = false;
      if (m.boss) m.actionTimer -= dt;

      if (m.state === 'charge' && m.chargeTo) {
        const step = 900 * dt;
        const cd = dist(m, m.chargeTo);
        const a = angleTo(m, m.chargeTo);
        const np = moveCircle(this.map, m.x, m.y, Math.cos(a) * Math.min(step, cd), Math.sin(a) * Math.min(step, cd), m.r * 0.6, true);
        const stuck = dist(np, m) < 1;
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
        if (m.actionTimer <= 0 && !this.telegraphs.some((t) => t.ownerId === m.id && t.boss)) {
          m.actionTimer = COMBAT.bossActionEvery + this.rand() * 0.8;
          this.bossSpecial(m);
          continue;
        }
      }

      // monsters can't follow you through a barrier, so they only care while you're in their zone
      const aggro = m.zone === this.zone && this.deadTimer <= 0 && (m.boss || m.state === 'chase' || d < PHYS.mobAggroRange);
      if (aggro && d < touch) {
        // melee windup: a short cone telegraph the player can step out of
        m.state = 'windup';
        m.timer = COMBAT.mobWindup;
        m.angle = angleTo(m, p);
        this.telegraphs.push({
          kind: 'cone', x: m.x, y: m.y, r: m.r + COMBAT.mobReach + p.r + 22, inner: 0, angle: m.angle,
          width: 0.9, time: COMBAT.mobWindup, total: COMBAT.mobWindup, damage: m.atk, boss: false, ownerId: m.id,
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
        const np = moveCircle(this.map, m.x, m.y, vx * speed * dt, vy * speed * dt, m.r * 0.8, true);
        m.moving = Math.abs(np.x - m.x) + Math.abs(np.y - m.y) > 0.1;
        m.x = np.x;
        m.y = np.y;
      }
    }
  }

  private bossSpecial(m: Mob) {
    const p = this.player;
    this.telegraphs = this.telegraphs.filter((t) => t.ownerId !== m.id);
    const dmg = m.atk * COMBAT.telegraphDamageMult;
    const roll = this.rand();
    const base = { inner: 0, damage: dmg, boss: true, ownerId: m.id };
    const hard = m.zone >= 1;
    if (roll < 0.33) {
      // slam where the player stands
      this.telegraphs.push({ ...base, kind: 'circle', x: p.x, y: p.y, r: 115, angle: 0, width: 0, time: 1.2, total: 1.2 });
      if (hard) {
        const a = this.rand() * 6.28;
        this.telegraphs.push({ ...base, kind: 'circle', x: p.x + Math.cos(a) * 170, y: p.y + Math.sin(a) * 170, r: 100, angle: 0, width: 0, time: 1.5, total: 1.5 });
      }
    } else if (roll < 0.6) {
      // breath cone
      const a = angleTo(m, p);
      m.angle = a;
      this.telegraphs.push({ ...base, kind: 'cone', x: m.x, y: m.y, r: 300, angle: a, width: 0.55, time: 1.1, total: 1.1 });
      m.state = 'windup';
      m.timer = 1.1;
    } else if (roll < 0.85) {
      // charge across the arena
      const a = angleTo(m, p);
      const len = 420;
      m.angle = a;
      this.telegraphs.push({ ...base, kind: 'line', x: m.x, y: m.y, r: len, angle: a, width: 80, time: 1.0, total: 1.0 });
      m.state = 'windup';
      m.timer = 1.0;
      m.chargeTo = { x: m.x + Math.cos(a) * len, y: m.y + Math.sin(a) * len };
    } else {
      // nova: everything around the boss except right next to it
      this.telegraphs.push({ ...base, kind: 'ring', x: m.x, y: m.y, r: 260, inner: m.r + 35, angle: 0, width: 0, time: 1.4, total: 1.4 });
      m.state = 'windup';
      m.timer = 1.4;
    }
  }

  /** Is point p (with radius pr) inside telegraph t? */
  private inTelegraph(t: Telegraph, p: Vec, pr: number): boolean {
    const d = dist(t, p);
    if (t.kind === 'circle') return d <= t.r + pr;
    if (t.kind === 'ring') return d <= t.r + pr && d >= t.inner - pr;
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
      if (!t.boss) {
        t.x = owner.x;
        t.y = owner.y;
      } else if (t.kind === 'cone' || t.kind === 'ring') {
        t.x = owner.x;
        t.y = owner.y;
      }
      t.time -= dt;
      if (t.time > 0) continue;
      done.push(t);
      if (t.boss) this.effect(t.kind === 'line' ? 'dash' : 'blast', t.x, t.y, t.r, '#ff4d4d', 0.35, t.x + Math.cos(t.angle) * t.r, t.y + Math.sin(t.angle) * t.r);
      if (t.kind === 'line' && owner.chargeTo) {
        owner.state = 'charge';
      }
      if (this.inTelegraph(t, p, p.r * 0.7)) {
        this.hurtPlayer(t.damage, owner.level);
        if (this.deadTimer > 0) return;
      }
    }
    if (done.length) this.telegraphs = this.telegraphs.filter((t) => !done.includes(t));
  }

  private hurtPlayer(amount: number, fromLevel: number) {
    const p = this.player;
    amount *= this.job.damageTaken * takenLevelMult(fromLevel, this.state.level);
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
    const melee = basic.kind === 'melee';
    const reach = melee ? basic.range + p.r : basic.range * 0.92;
    const near = this.nearestMob(reach, p, !melee);
    const wantsAttack = this.input.attack || (this.auto && !!near);
    if (!wantsAttack) return;

    let angle = this.aimAngle(reach);
    // AUTO turns to face whatever is in reach
    if (this.auto && !this.input.attack && near) angle = angleTo(p, near);
    p.angle = angle;
    this.aimHold = Math.max(0.45, basic.interval * 0.9);
    this.playerTimer = basic.interval;
    this.anim.swing = 1;
    const dmg = this.stats.atk * basic.mult;

    if (melee) {
      this.effect('slash', p.x + Math.cos(angle) * 40, p.y + Math.sin(angle) * 40, basic.range, '#ffffff', 0.2, undefined, undefined, angle);
      for (const m of this.mobsInCone(angle, basic.range, COMBAT.attackHalfAngle)) this.damage(m, dmg);
    } else if (basic.kind === 'arrow') {
      this.shoot({ angle, speed: basic.speed ?? 900, maxDist: basic.range, damage: dmg, kind: 'arrow', color: '#e8d7a9' });
    } else {
      this.shoot({ angle, speed: basic.speed ?? 650, maxDist: basic.range, damage: dmg, kind: 'bolt', color: '#b388ff', splash: basic.splash });
    }
  }

  private shoot(o: {
    angle: number; speed: number; maxDist: number; damage: number; kind: Projectile['kind'];
    color: string; splash?: number; pierce?: boolean; label?: string;
  }) {
    const p = this.player;
    this.projectiles.push({
      x: p.x + Math.cos(o.angle) * (p.r + 6), y: p.y + Math.sin(o.angle) * (p.r + 6),
      angle: o.angle, speed: o.speed, traveled: 0, maxDist: o.maxDist, damage: o.damage, kind: o.kind,
      color: o.color, splash: o.splash ?? 0, pierce: !!o.pierce, label: o.label, hit: [],
    });
  }

  private updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
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
          this.damage(hit, pr.damage, pr.label);
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
    for (const m of this.mobs.filter((m) => dist(m, pr) <= pr.splash + m.r)) this.damage(m, pr.damage, pr.label);
  }

  private castSkills(dt: number) {
    const p = this.player;
    this.job.skills.forEach((sk, i) => {
      if (this.state.level < sk.unlock) return;
      this.skillCd[sk.id] -= dt;
      if (this.skillCd[sk.id] > 0 || p.dash) return;
      const pressed = this.input.skills[i];
      const dmg = this.stats.atk * sk.mult;
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
          this.startSkill(sk.id, sk.cd, sk.color);
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
          this.startSkill(sk.id, sk.cd, sk.color);
          this.effect('ring', p.x, p.y, radius, sk.color, 0.5);
          for (const m of hits) this.damage(m, dmg);
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
          this.startSkill(sk.id, sk.cd, sk.color);
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
          this.startSkill(sk.id, sk.cd, sk.color);
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
    return this.telegraphs.some((t) => t.boss && this.inTelegraph(t, this.player, this.player.r));
  }

  private startSkill(id: string, cd: number, color: string) {
    this.skillCd[id] = cd;
    this.aimHold = 0.5;
    this.anim.flash = 0.6;
    this.anim.flashColor = color;
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
      for (const m of this.mobs.filter((m) => dist(b, m) <= b.r + m.r)) this.damage(m, b.damage, b.label);
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
      this.damage(best, this.stats.atk * companionHitMult(c.id, o.level), undefined, color);
    });
  }

  private damage(m: Mob, base: number, label?: string, color?: string) {
    if (!this.mobs.includes(m)) return;
    const crit = this.rand() < this.stats.critRate;
    const dmg = base * (crit ? this.stats.critDmg : 1) * (0.9 + this.rand() * 0.2) * dealtLevelMult(m.level, this.state.level);
    m.hp -= dmg;
    m.hitFlash = 1;
    if (m.state === 'idle') m.state = 'chase';
    const text = (label ? label + ' ' : '') + fmtDmg(dmg) + (crit ? '!' : '');
    this.float(m.x + (this.rand() - 0.5) * 20, m.y, m.r * 2 + 16, text, color ?? (crit ? '#ffb703' : '#ffffff'), crit ? 19 : label ? 17 : 14);
    if (m.hp <= 0) this.killMob(m);
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
    this.mobs = this.mobs.filter((x) => x !== m);
    this.telegraphs = this.telegraphs.filter((t) => t.ownerId !== m.id);
    if (this.target === m) this.target = null;
    this.effect('poof', m.x, m.y, m.r * 1.4, m.color, 0.4);
    s.gold += m.gold;
    const exp = m.exp * expLevelMult(m.level, s.level);
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
      this.bossZone = -1;
      this.hp = this.stats.maxHp;
      this.telegraphs = [];
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
    s.totals.deaths++;
    this.deadTimer = BALANCE.playerDeathDelay;
    this.hp = 0;
    if (this.inBossFight) {
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
    const ids = this.mobs.filter((m) => m.boss).map((m) => m.id);
    this.mobs = this.mobs.filter((m) => !m.boss);
    this.telegraphs = this.telegraphs.filter((t) => !ids.includes(t.ownerId));
    this.bossZone = -1;
    this.target = null;
  }

  private failBoss(msg: string) {
    this.endBoss();
    this.onToast(msg + ' The boss returns to its altar.', '#ff6b6b');
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
    let perSec = (st.atk * job.basic.mult) / job.basic.interval;
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
