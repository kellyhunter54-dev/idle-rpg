import {
  BALANCE, COMPANION, COMPANIONS, GROWTH, GrowthKey, MobStats, RARITIES, Rarity, SKILLS, SLOTS,
  Slot, TIERS, TIER_WEIGHTS, chapterOf, companionHitMult, enhanceCopies, expToNext, gearId,
  gearScore, mobFor, parseGear,
} from './data';
import {
  GameMap, PHYS, TILE, findPath, fits, generateMap, lineOfSight, moveCircle,
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
  return { moveX: 0, moveY: 0, attack: false, aim: null, skills: SKILLS.map(() => false) };
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
  attackRange: 80, // from player edge
  attackHalfAngle: 1.05, // ~60 degrees each side
  dashDistance: 190,
  dashSpeed: 1100,
  dashWidth: 55,
  cycloneRadius: 160,
  starfallRange: 440,
  starfallRadius: 140,
  starfallDelay: 0.5,
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
  mapIndex = -1;
  player: Player;
  hp = 0;
  mobs: Mob[] = [];
  telegraphs: Telegraph[] = [];
  private blasts: PendingBlast[] = [];
  private nextMobId = 1;
  private spawnTimer = 0;
  private bossQueued = false;
  private bossDelay = 0;
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
    for (const s of SKILLS) this.skillCd[s.id] = s.cd * 0.5;
    this.syncMap();
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

  private syncMap() {
    const idx = (chapterOf(this.state.stage).chapter - 1) % 5;
    if (idx === this.mapIndex) return;
    this.mapIndex = idx;
    this.map = generateMap(idx);
    this.mobs = [];
    this.telegraphs = [];
    this.blasts = [];
    this.target = null;
    this.path = null;
    Object.assign(this.player, { x: this.map.spawn.x, y: this.map.spawn.y, dash: null });
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
        Object.assign(this.player, { x: this.map.spawn.x, y: this.map.spawn.y, dash: null });
      }
      inp.skills = inp.skills.map(() => false);
      return;
    }

    this.updateSpawning(dt);
    this.movePlayer(dt);
    this.updateMobs(dt);
    this.updateTelegraphs(dt);
    if (this.deadTimer > 0) {
      inp.skills = inp.skills.map(() => false);
      return;
    }
    this.playerAttacks(dt);
    this.castSkills(dt);
    this.updateBlasts(dt);
    this.updateCompanions(dt);

    if (this.inBossFight) {
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) this.failBoss('Time ran out!');
    }
    inp.skills = inp.skills.map(() => false);
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
    const s = this.state;
    const wantBoss = !s.bossFailed && s.kills >= BALANCE.killsPerStage;

    if (wantBoss && !this.inBossFight) {
      if (!this.bossQueued) {
        this.bossQueued = true;
        this.bossDelay = 1.2;
        for (const m of this.mobs) this.effect('poof', m.x, m.y, 30, '#ffffff', 0.4);
        this.mobs = [];
        this.telegraphs = [];
        this.target = null;
        this.onToast('A boss approaches!', '#f72585');
      }
      this.bossDelay -= dt;
      if (this.bossDelay <= 0) {
        this.bossQueued = false;
        this.spawnBoss();
      }
      return;
    }
    if (this.inBossFight) return;

    this.spawnTimer -= dt;
    if (this.mobs.length < PHYS.maxMobs && (this.spawnTimer <= 0 || this.mobs.length < 4)) {
      this.spawnTimer = PHYS.mobSpawnInterval;
      this.spawnMob();
    }
  }

  private randomFloorPoint(minDist: number, maxDist = Infinity): Vec | null {
    const tiles = this.map.floorTiles;
    for (let tries = 0; tries < 30; tries++) {
      const i = tiles[Math.floor(this.rand() * tiles.length)];
      const tx = i % this.map.w;
      const p = { x: (tx + 0.5) * TILE, y: ((i - tx) / this.map.w + 0.5) * TILE };
      const d = dist(p, this.player);
      if (d >= minDist && d <= maxDist) return p;
    }
    return null;
  }

  private spawnMob() {
    const p = this.randomFloorPoint(380);
    if (!p) return;
    const stats = mobFor(this.state.stage, false, this.rand);
    this.mobs.push(this.makeMob(stats, p, PHYS.mobRadius));
  }

  private spawnBoss() {
    const p = this.randomFloorPoint(280, 520) ?? this.randomFloorPoint(150) ?? { x: this.player.x + 200, y: this.player.y };
    const stats = mobFor(this.state.stage, true, this.rand);
    const boss = this.makeMob(stats, p, PHYS.bossRadius);
    boss.actionTimer = 2;
    this.mobs.push(boss);
    this.bossTimer = BALANCE.bossTimeLimit;
    this.hp = this.stats.maxHp;
    this.dirty = true;
  }

  private makeMob(stats: MobStats, p: Vec, r: number): Mob {
    return {
      ...stats, id: this.nextMobId++, maxHp: stats.hp, x: p.x, y: p.y, r, angle: this.rand() * 6.28,
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
    if (!(this.manualActive && this.input.aim)) p.angle = Math.atan2(my, mx);
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

    // 2. Pick a target
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
    const reach = COMBAT.attackRange + t.r + p.r;
    if (d <= reach - 12) {
      this.targetTime = 0;
      p.angle = angleTo(p, t);
      return zero;
    }
    this.targetTime += dt;
    if (this.targetTime > 7 && !t.boss) {
      this.ignore.set(t.id, this.time + 8);
      this.target = null;
      return zero;
    }

    // 3. Walk there (straight if clear, otherwise A*)
    if (lineOfSight(this.map, p.x, p.y, t.x, t.y, p.r)) {
      this.path = null;
      return { x: (t.x - p.x) / d, y: (t.y - p.y) / d };
    }
    this.pathTimer -= dt;
    if (!this.path || this.pathTimer <= 0 || !this.pathGoal || dist(this.pathGoal, t) > TILE) {
      this.path = findPath(this.map, p.x, p.y, t.x, t.y, p.r);
      this.pathGoal = { x: t.x, y: t.y };
      this.pathTimer = 0.5;
      if (!this.path) {
        this.ignore.set(t.id, this.time + 8);
        this.target = null;
        return zero;
      }
    }
    while (this.path.length && dist(this.path[0], p) < 14) this.path.shift();
    const wp = this.path[0];
    if (!wp) return zero;
    const wd = dist(p, wp) || 1;
    return { x: (wp.x - p.x) / wd, y: (wp.y - p.y) / wd };
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
      let cost = dist(p, m);
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
      const touch = m.r + p.r + COMBAT.mobReach;
      const speed = m.boss ? PHYS.bossSpeed : PHYS.mobSpeed;
      m.moving = false;
      if (m.boss) m.actionTimer -= dt;

      if (m.state === 'charge' && m.chargeTo) {
        const step = 900 * dt;
        const cd = dist(m, m.chargeTo);
        const a = angleTo(m, m.chargeTo);
        const np = moveCircle(this.map, m.x, m.y, Math.cos(a) * Math.min(step, cd), Math.sin(a) * Math.min(step, cd), m.r * 0.6);
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

      const aggro = m.boss || m.state === 'chase' || d < PHYS.mobAggroRange;
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
        if (lineOfSight(this.map, m.x, m.y, p.x, p.y, m.r * 0.8)) {
          m.path = null;
          vx = (p.x - m.x) / d;
          vy = (p.y - m.y) / d;
        } else {
          m.pathTimer -= dt;
          if (!m.path || m.pathTimer <= 0) {
            m.path = findPath(this.map, m.x, m.y, p.x, p.y, m.r * 0.8);
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
        const np = moveCircle(this.map, m.x, m.y, vx * speed * dt, vy * speed * dt, m.r * 0.8);
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
    const loops = chapterOf(this.state.stage).loop;
    if (roll < 0.33) {
      // slam where the player stands
      this.telegraphs.push({ ...base, kind: 'circle', x: p.x, y: p.y, r: 115, angle: 0, width: 0, time: 1.2, total: 1.2 });
      if (loops > 0 || this.state.stage > 25) {
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
        this.hurtPlayer(t.damage);
        if (this.deadTimer > 0) return;
      }
    }
    if (done.length) this.telegraphs = this.telegraphs.filter((t) => !done.includes(t));
  }

  private hurtPlayer(amount: number) {
    const p = this.player;
    this.hp -= amount;
    this.anim.playerHit = 1;
    this.float(p.x, p.y, 40, '-' + fmtDmg(amount), '#ff6b6b', 15);
    if (this.hp <= 0) this.playerDie();
  }

  // ---------------- Player combat ----------------
  /** Direction the player is aiming: mouse in manual, target in auto. */
  private aimAngle(): number {
    const p = this.player;
    if (this.manualActive && this.input.aim) return angleTo(p, this.input.aim);
    if (this.auto || !this.input.aim) {
      // no mouse (touch / keyboard only): soft-lock onto whatever is closest
      const t = this.target && this.mobs.includes(this.target) ? this.target : this.nearestMob(COMBAT.attackRange + 120);
      if (t) return angleTo(p, t);
    }
    return p.angle;
  }

  private nearestMob(maxD = Infinity, from: Vec = this.player): Mob | null {
    let best: Mob | null = null;
    let bd = maxD;
    for (const m of this.mobs) {
      const d = dist(from, m) - m.r;
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
    const near = this.nearestMob(COMBAT.attackRange + this.player.r);
    const wantsAttack = this.input.attack || (this.auto && !!near);
    if (!wantsAttack) return;

    let angle = this.aimAngle();
    // AUTO turns to face whatever is in reach
    if (this.auto && !this.input.attack && near) angle = angleTo(this.player, near);
    this.player.angle = angle;
    this.playerTimer = BALANCE.playerAttackInterval;
    this.anim.swing = 1;
    const p = this.player;
    this.effect('slash', p.x + Math.cos(angle) * 40, p.y + Math.sin(angle) * 40, COMBAT.attackRange, '#ffffff', 0.2, undefined, undefined, angle);
    for (const m of this.mobsInCone(angle, COMBAT.attackRange, COMBAT.attackHalfAngle)) this.damage(m, this.stats.atk);
  }

  private castSkills(dt: number) {
    const p = this.player;
    SKILLS.forEach((sk, i) => {
      if (this.state.level < sk.unlock) return;
      this.skillCd[sk.id] -= dt;
      if (this.skillCd[sk.id] > 0 || p.dash) return;
      const pressed = this.input.skills[i];
      const dmg = this.stats.atk * sk.mult;

      if (sk.id === 'strike') {
        let angle = this.aimAngle();
        let go = pressed;
        if (!go && this.auto) {
          const t = this.nearestMob(COMBAT.dashDistance + 20);
          if (t && lineOfSight(this.map, p.x, p.y, t.x, t.y, p.r) && !this.standingInBossTelegraph()) {
            angle = angleTo(p, t);
            go = true;
          }
        }
        if (!go) return;
        this.startSkill(sk.id, sk.cd, sk.color);
        p.angle = angle;
        const tx = p.x + Math.cos(angle) * COMBAT.dashDistance;
        const ty = p.y + Math.sin(angle) * COMBAT.dashDistance;
        p.dash = { tx, ty, t: 0.35 };
        // damage everything along the dash line
        for (const m of this.mobs) {
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          const along = dx * Math.cos(angle) + dy * Math.sin(angle);
          const across = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
          if (along > -m.r && along < COMBAT.dashDistance + m.r && across < COMBAT.dashWidth + m.r) this.damage(m, dmg, sk.name);
        }
        this.effect('dash', p.x, p.y, COMBAT.dashWidth, sk.color, 0.35, tx, ty);
      } else if (sk.id === 'cyclone') {
        const hits = this.mobs.filter((m) => dist(p, m) <= COMBAT.cycloneRadius + m.r);
        if (!pressed && !(this.auto && hits.length)) return;
        this.startSkill(sk.id, sk.cd, sk.color);
        this.effect('ring', p.x, p.y, COMBAT.cycloneRadius, sk.color, 0.5);
        for (const m of hits) this.damage(m, dmg);
      } else {
        // Starfall: lands where you aim (mouse), or on the biggest group for AUTO
        let spot: Vec | null = null;
        if (pressed) {
          const a = this.input.aim && this.manualActive ? this.input.aim : null;
          spot = a ?? this.bestCluster() ?? { x: p.x + Math.cos(p.angle) * 150, y: p.y + Math.sin(p.angle) * 150 };
          const d = dist(p, spot);
          if (d > COMBAT.starfallRange) {
            const k = COMBAT.starfallRange / d;
            spot = { x: p.x + (spot.x - p.x) * k, y: p.y + (spot.y - p.y) * k };
          }
        } else if (this.auto) {
          spot = this.bestCluster();
        }
        if (!spot) return;
        this.startSkill(sk.id, sk.cd, sk.color);
        this.blasts.push({ x: spot.x, y: spot.y, r: COMBAT.starfallRadius, time: COMBAT.starfallDelay, damage: dmg });
        this.effect('star', spot.x, spot.y, COMBAT.starfallRadius, sk.color, COMBAT.starfallDelay + 0.3);
      }
    });
  }

  private standingInBossTelegraph(): boolean {
    return this.telegraphs.some((t) => t.boss && this.inTelegraph(t, this.player, this.player.r));
  }

  private startSkill(id: string, cd: number, color: string) {
    this.skillCd[id] = cd;
    this.anim.flash = 0.6;
    this.anim.flashColor = color;
  }

  /** Point within Starfall range that would hit the most monsters. */
  private bestCluster(): Vec | null {
    let best: Vec | null = null;
    let bestN = 0;
    for (const m of this.mobs) {
      if (dist(this.player, m) > COMBAT.starfallRange) continue;
      const n = this.mobs.filter((o) => dist(o, m) <= COMBAT.starfallRadius).length + (m.boss ? 5 : 0);
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
      this.effect('blast', b.x, b.y, b.r, '#c77dff', 0.4);
      for (const m of this.mobs.filter((m) => dist(b, m) <= b.r + m.r)) this.damage(m, b.damage, 'Starfall');
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
    const dmg = base * (crit ? this.stats.critDmg : 1) * (0.9 + this.rand() * 0.2);
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
    this.addExp(m.exp);
    s.totals.kills++;
    this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * BALANCE.healOnKillPct);
    if (this.rand() < BALANCE.gemDropChance) {
      s.gems += 1;
      this.float(m.x, m.y, 60, '+1 💎', '#7df9ff', 14);
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
      this.telegraphs = [];
      this.syncMap();
    } else if (!s.bossFailed || s.kills < BALANCE.killsPerStage) {
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
    const wasBoss = this.inBossFight;
    this.mobs = [];
    this.telegraphs = [];
    this.blasts = [];
    this.target = null;
    this.player.dash = null;
    if (wasBoss) {
      s.bossFailed = true;
      this.onToast('Defeated by the boss. Farming until you challenge again.', '#ff6b6b');
    } else if (s.stage > 1) {
      s.stage--;
      s.bossFailed = true;
      s.kills = 0;
      this.onToast('You were defeated and fell back a stage.', '#ff6b6b');
      this.syncMap();
    }
    this.dirty = true;
  }

  private failBoss(msg: string) {
    this.state.bossFailed = true;
    const bossIds = this.mobs.filter((m) => m.boss).map((m) => m.id);
    this.mobs = this.mobs.filter((m) => !m.boss);
    this.telegraphs = this.telegraphs.filter((t) => !bossIds.includes(t.ownerId));
    this.target = null;
    this.onToast(msg + ' Farming until you challenge again.', '#ff6b6b');
    this.dirty = true;
  }

  challengeBoss() {
    const s = this.state;
    s.bossFailed = false;
    s.kills = Math.max(s.kills, BALANCE.killsPerStage);
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
    const m = mobFor(this.state.stage, false, this.rand);
    // walking between mobs costs time too
    const killTime = Math.max(0.5, m.hp / Math.max(1, this.dps())) + 1.2;
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
