import {
  BALANCE, COMPANION, COMPANIONS, GROWTH, GrowthKey, MobStats, RARITIES, Rarity, SKILLS, SLOTS,
  Slot, TIERS, TIER_WEIGHTS, chapterOf, companionHitMult, enhanceCopies, expToNext, gearId,
  gearScore, mobFor, parseGear,
} from './data';
import { GameState } from './state';
import { Stats, computeStats } from './stats';
import {
  BOSS_SIZE, LAYOUTS, MOB_SIZE, MapLayout, PHYS, PLAYER_SIZE, Surface, surfaceAt, surfaces,
} from './world';

// ---------------- Types ----------------

/** Player input for one frame. Filled by the browser (keyboard/touch); empty in the simulator. */
export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
  down: boolean;
  attack: boolean;
  skills: boolean[]; // one-shot presses, cleared by the game after reading
}

export function emptyInput(): Input {
  return { left: false, right: false, jump: false, down: false, attack: false, skills: SKILLS.map(() => false) };
}

export interface Body {
  x: number; // center
  y: number; // feet
  vx: number;
  vy: number;
  w: number;
  h: number;
  onGround: boolean;
  surface: number; // -1 ground, >=0 platform index, -2 airborne
  dropTimer: number;
  facing: 1 | -1;
}

export interface Mob extends MobStats {
  id: number;
  maxHp: number;
  x: number;
  y: number;
  w: number;
  h: number;
  surface: number;
  dir: number;
  facing: 1 | -1;
  wanderTimer: number;
  atkTimer: number;
  hitFlash: number;
  lunge: number;
  spawnAnim: number;
}

export interface FloatText {
  x: number; // world units
  y: number;
  text: string;
  color: string;
  life: number;
  size: number;
}

export interface Effect {
  kind: 'ring' | 'slash' | 'star' | 'bolt' | 'poof';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  r: number;
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

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// ---------------- Game ----------------

export class Game {
  state: GameState;
  stats!: Stats;
  rand: () => number;
  time = 0;

  layout!: MapLayout;
  layoutIndex = -1;
  player: Body;
  hp = 0;
  mobs: Mob[] = [];
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
  private prevJump = false;
  private target: Mob | null = null;
  private targetTime = 0;
  private ignore = new Map<number, number>();

  floats: FloatText[] = [];
  effects: Effect[] = [];
  anim = { swing: 0, playerHit: 0, flash: 0, flashColor: '#fff' };

  /** Set to true whenever something the UI shows changes in a way worth re-rendering panels. */
  dirty = true;
  onToast: (msg: string, color?: string) => void = () => {};

  constructor(state: GameState, rand: () => number = Math.random) {
    this.state = state;
    this.rand = rand;
    this.player = {
      x: 200, y: 0, vx: 0, vy: 0, ...PLAYER_SIZE, onGround: true, surface: -1, dropTimer: 0, facing: 1,
    };
    this.recalc();
    this.hp = this.stats.maxHp;
    for (const s of SKILLS) this.skillCd[s.id] = s.cd * 0.5;
    this.syncLayout();
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

  /** True while the player's own input is steering (AUTO resumes after a short pause). */
  get manualActive(): boolean {
    return !this.auto || this.time - this.lastInputTime < PHYS.manualTimeout;
  }

  private syncLayout() {
    const idx = (chapterOf(this.state.stage).chapter - 1) % LAYOUTS.length;
    if (idx === this.layoutIndex) return;
    this.layoutIndex = idx;
    this.layout = LAYOUTS[idx];
    this.mobs = [];
    this.target = null;
    Object.assign(this.player, { x: 200, y: 0, vx: 0, vy: 0, onGround: true, surface: -1 });
  }

  private syncParty() {
    const ids = this.state.party.filter((x): x is string => !!x && !!this.state.companions[x]);
    const existing = new Map(this.party.map((c) => [c.id, c]));
    this.party = ids.map((id, i) => existing.get(id) ?? { id, x: this.player?.x ?? 0, y: 60, timer: 0.3 * i, hit: 0 });
  }

  // ---------------- Main loop ----------------
  update(dt: number) {
    this.time += dt;
    this.decayVisuals(dt);

    const anyInput =
      this.input.left || this.input.right || this.input.jump || this.input.down || this.input.attack ||
      this.input.skills.some(Boolean);
    if (anyInput) this.lastInputTime = this.time;

    if (this.deadTimer > 0) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) {
        this.hp = this.stats.maxHp;
        Object.assign(this.player, { vx: 0, vy: 0 });
      }
      this.input.skills = this.input.skills.map(() => false);
      return;
    }

    this.updateSpawning(dt);
    this.movePlayer(dt);
    this.updateMobs(dt);
    this.playerAttacks(dt);
    this.castSkills(dt);
    this.updateCompanions(dt);

    if (this.inBossFight) {
      this.bossTimer -= dt;
      if (this.bossTimer <= 0) this.failBoss('Time ran out!');
    }
    this.input.skills = this.input.skills.map(() => false);
  }

  private decayVisuals(dt: number) {
    this.anim.swing = Math.max(0, this.anim.swing - dt * 4);
    this.anim.playerHit = Math.max(0, this.anim.playerHit - dt * 5);
    this.anim.flash = Math.max(0, this.anim.flash - dt * 3);
    for (const f of this.floats) {
      f.life -= dt;
      f.y += dt * 60;
    }
    if (this.floats.some((f) => f.life <= 0)) this.floats = this.floats.filter((f) => f.life > 0);
    for (const e of this.effects) e.life -= dt;
    if (this.effects.some((e) => e.life <= 0)) this.effects = this.effects.filter((e) => e.life > 0);
    for (const m of this.mobs) {
      m.hitFlash = Math.max(0, m.hitFlash - dt * 5);
      m.lunge = Math.max(0, m.lunge - dt * 4);
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
        this.bossDelay = 1;
        for (const m of this.mobs) this.effect('poof', m.x, m.y + m.h / 2, 30, '#ffffff', 0.4);
        this.mobs = [];
        this.target = null;
        this.onToast('A boss appears!', '#f72585');
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
    const alive = this.mobs.length;
    if (alive < PHYS.maxMobs && (this.spawnTimer <= 0 || alive < 3)) {
      this.spawnTimer = PHYS.mobSpawnInterval;
      this.spawnMob();
    }
  }

  private spawnMob() {
    const surfs = surfaces(this.layout);
    // weight surfaces by length so the ground gets more mobs
    const surf = weighted(surfs, surfs.map((x) => x.x2 - x.x1), this.rand);
    let x = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = surf.x1 + MOB_SIZE.w + this.rand() * Math.max(1, surf.x2 - surf.x1 - MOB_SIZE.w * 2);
      if (Math.abs(x - this.player.x) > 180 || Math.abs(surf.y - this.player.y) > 60) break;
    }
    const stats = mobFor(this.state.stage, false, this.rand);
    this.mobs.push(this.makeMob(stats, x, surf, MOB_SIZE));
  }

  private spawnBoss() {
    const stats = mobFor(this.state.stage, true, this.rand);
    const p = this.player;
    const x = p.x + 420 < this.layout.width - 100 ? p.x + 420 : Math.max(100, p.x - 420);
    this.mobs.push(this.makeMob(stats, x, surfaceAt(this.layout, -1), BOSS_SIZE));
    this.bossTimer = BALANCE.bossTimeLimit;
    this.hp = this.stats.maxHp;
    this.dirty = true;
  }

  private makeMob(stats: MobStats, x: number, surf: Surface, size: { w: number; h: number }): Mob {
    return {
      ...stats, id: this.nextMobId++, maxHp: stats.hp, x, y: surf.y, ...size, surface: surf.index,
      dir: 0, facing: -1, wanderTimer: this.rand() * 2, atkTimer: BALANCE.mobAttackInterval,
      hitFlash: 0, lunge: 0, spawnAnim: 1,
    };
  }

  // ---------------- Player movement ----------------
  private movePlayer(dt: number) {
    const p = this.player;
    let moveX = 0;
    let jump = false;
    let drop = false;

    if (this.manualActive) {
      moveX = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
      const jumpPressed = this.input.jump && !this.prevJump;
      if (jumpPressed && this.input.down) drop = true;
      else if (jumpPressed) jump = true;
      else if (this.input.down && this.input.jump) drop = true;
    } else {
      ({ moveX, jump, drop } = this.autoPilot(dt));
    }
    this.prevJump = this.input.jump;

    if (moveX !== 0) p.facing = moveX > 0 ? 1 : -1;
    p.vx = moveX * PHYS.playerSpeed;
    p.x = Math.max(p.w / 2, Math.min(this.layout.width - p.w / 2, p.x + p.vx * dt));

    if (p.onGround && jump) {
      p.vy = PHYS.jumpVel;
      p.onGround = false;
      p.surface = -2;
    } else if (p.onGround && drop && p.surface >= 0) {
      p.dropTimer = PHYS.dropTime;
      p.onGround = false;
      p.surface = -2;
      p.vy = 0;
    }

    // walked off a platform edge
    if (p.onGround && p.surface >= 0) {
      const pl = this.layout.platforms[p.surface];
      if (p.x < pl.x1 || p.x > pl.x2) {
        p.onGround = false;
        p.surface = -2;
      }
    }

    p.dropTimer = Math.max(0, p.dropTimer - dt);
    if (!p.onGround) {
      const prevY = p.y;
      p.vy -= PHYS.gravity * dt;
      p.y += p.vy * dt;
      if (p.vy <= 0) {
        let best: { y: number; i: number } | null = null;
        if (p.dropTimer <= 0) {
          this.layout.platforms.forEach((pl, i) => {
            if (p.x >= pl.x1 && p.x <= pl.x2 && prevY >= pl.y - 0.01 && p.y <= pl.y) {
              if (!best || pl.y > best.y) best = { y: pl.y, i };
            }
          });
        }
        const landed = best as { y: number; i: number } | null;
        if (landed) {
          p.y = landed.y;
          p.surface = landed.i;
          p.vy = 0;
          p.onGround = true;
        } else if (p.y <= 0) {
          p.y = 0;
          p.surface = -1;
          p.vy = 0;
          p.onGround = true;
        }
      }
    }
  }

  /** Decides where the hero walks when AUTO is in control. */
  private autoPilot(dt: number): { moveX: number; jump: boolean; drop: boolean } {
    const p = this.player;
    const idle = { moveX: 0, jump: false, drop: false };

    if (this.target && (!this.mobs.includes(this.target) || (this.ignore.get(this.target.id) ?? 0) > this.time)) {
      this.target = null;
    }
    if (!this.target) {
      this.target = this.pickTarget();
      this.targetTime = 0;
    }
    const t = this.target;
    if (!t) return idle;

    const dx = t.x - p.x;
    const dy = t.y - p.y;
    if (this.inReach(t, PHYS.attackRange)) {
      this.targetTime = 0;
      p.facing = dx >= 0 ? 1 : -1;
      return idle;
    }

    this.targetTime += dt;
    if (this.targetTime > 6 && !t.boss) {
      // can't reach it; try something else for a while
      this.ignore.set(t.id, this.time + 8);
      this.target = null;
      return idle;
    }

    const maxJump = (PHYS.jumpVel * PHYS.jumpVel) / (2 * PHYS.gravity);
    if (dy > 40) {
      const steps = this.layout.platforms
        .map((pl, i) => ({ ...pl, i }))
        .filter((pl) => pl.y > p.y + 20 && pl.y <= p.y + maxJump - 8);
      if (!steps.length) return { moveX: sign(dx), jump: false, drop: false };
      const distTo = (pl: { x1: number; x2: number }) =>
        t.x < pl.x1 ? pl.x1 - t.x : t.x > pl.x2 ? t.x - pl.x2 : 0;
      const step =
        steps.find((pl) => pl.i === t.surface) ??
        steps.sort((a, b) => distTo(a) + Math.abs(a.y - t.y) - (distTo(b) + Math.abs(b.y - t.y)))[0];
      const aimX = Math.max(step.x1 + 30, Math.min(step.x2 - 30, t.x));
      const under = p.x > step.x1 + 15 && p.x < step.x2 - 15;
      if (p.onGround && under) return { moveX: sign(aimX - p.x), jump: true, drop: false };
      return { moveX: Math.abs(aimX - p.x) > 8 ? sign(aimX - p.x) : 0, jump: false, drop: false };
    }
    if (dy < -40 && p.onGround && p.surface >= 0) {
      return { moveX: sign(dx), jump: false, drop: true };
    }
    return { moveX: Math.abs(dx) > 8 ? sign(dx) : 0, jump: false, drop: false };
  }

  private pickTarget(): Mob | null {
    const p = this.player;
    let best: Mob | null = null;
    let bestCost = Infinity;
    for (const m of this.mobs) {
      if ((this.ignore.get(m.id) ?? 0) > this.time) continue;
      const cost = Math.abs(m.x - p.x) + Math.abs(m.y - p.y) * 3;
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
    return best;
  }

  /** Is mob m within `range` of the player's body (horizontally) and on about the same level? */
  private inReach(m: Mob, range: number, frontOnly = false): boolean {
    const p = this.player;
    const dx = m.x - p.x;
    if (frontOnly && sign(dx) !== p.facing && Math.abs(dx) > m.w / 2) return false;
    const vTol = m.boss ? 140 : 60;
    return Math.abs(dx) <= range + m.w / 2 + p.w / 2 && Math.abs(m.y - p.y) < vTol;
  }

  // ---------------- Mobs ----------------
  private updateMobs(dt: number) {
    const p = this.player;
    for (const m of this.mobs) {
      const surf = surfaceAt(this.layout, m.surface);
      const dx = p.x - m.x;
      const dy = p.y - m.y;
      const reach = (m.w + p.w) / 2 + 4;
      const speed = m.boss ? PHYS.bossSpeed : PHYS.mobSpeed;

      if (m.boss || (Math.abs(dx) < PHYS.mobAggroRange && Math.abs(dy) < 60)) {
        m.dir = Math.abs(dx) > reach - 6 ? sign(dx) : 0;
      } else {
        m.wanderTimer -= dt;
        if (m.wanderTimer <= 0) {
          m.wanderTimer = 1 + this.rand() * 2.5;
          m.dir = [-1, 0, 1][Math.floor(this.rand() * 3)];
        }
      }
      if (m.dir) m.facing = m.dir > 0 ? 1 : -1;
      m.x += m.dir * speed * dt;
      const minX = surf.x1 + m.w / 2;
      const maxX = surf.x2 - m.w / 2;
      if (m.x < minX) {
        m.x = minX;
        if (!m.boss) m.dir = 1;
      } else if (m.x > maxX) {
        m.x = maxX;
        if (!m.boss) m.dir = -1;
      }

      // contact attack
      m.atkTimer -= dt;
      const vTol = m.boss ? 140 : 50;
      if (m.atkTimer <= 0 && Math.abs(dx) <= reach + (m.boss ? 30 : 0) && Math.abs(dy) < vTol) {
        m.atkTimer = BALANCE.mobAttackInterval;
        m.lunge = 1;
        m.facing = dx >= 0 ? 1 : -1;
        this.hp -= m.atk;
        this.anim.playerHit = 1;
        this.float(p.x, p.y + p.h + 10, '-' + fmtDmg(m.atk), '#ff6b6b', 14);
        if (this.hp <= 0) {
          this.playerDie();
          return;
        }
      }
    }
  }

  // ---------------- Combat ----------------
  private playerAttacks(dt: number) {
    this.playerTimer -= dt;
    if (this.playerTimer > 0) return;
    const wantsAttack = this.input.attack || (this.auto && this.mobs.some((m) => this.inReach(m, PHYS.attackRange)));
    if (!wantsAttack) return;

    this.playerTimer = BALANCE.playerAttackInterval;
    this.anim.swing = 1;
    // Manual attacks hit what you face; auto turns toward the nearest mob in reach.
    let targets = this.mobs.filter((m) => this.inReach(m, PHYS.attackRange, true));
    if (!targets.length && !this.input.attack) {
      const near = this.mobs.filter((m) => this.inReach(m, PHYS.attackRange));
      if (near.length) {
        this.player.facing = near[0].x >= this.player.x ? 1 : -1;
        targets = near;
      }
    }
    targets.sort((a, b) => Math.abs(a.x - this.player.x) - Math.abs(b.x - this.player.x));
    const p = this.player;
    this.effect('slash', p.x + p.facing * 40, p.y + p.h / 2, 46, '#ffffff', 0.18);
    if (targets[0]) this.damage(targets[0], this.stats.atk);
  }

  private castSkills(dt: number) {
    const p = this.player;
    SKILLS.forEach((sk, i) => {
      if (this.state.level < sk.unlock) return;
      this.skillCd[sk.id] -= dt;
      if (this.skillCd[sk.id] > 0) return;
      const range = PHYS.skillRange[sk.id] ?? 200;
      const inRange = this.mobs.filter((m) => {
        const r = Math.hypot(m.x - p.x, (m.y + m.h / 2 - (p.y + p.h / 2)) * 1.4);
        return r <= range + m.w / 2;
      });
      const pressed = this.input.skills[i];
      // With AUTO on, skills fire on their own whenever something is in range (even while you steer).
      const autoCast = this.auto && inRange.length > 0;
      if (!pressed && !autoCast) return;

      this.skillCd[sk.id] = sk.cd;
      this.anim.flash = 0.8;
      this.anim.flashColor = sk.color;
      const cy = p.y + p.h / 2;
      if (sk.id === 'strike') {
        const t = inRange.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
        if (t) p.facing = t.x >= p.x ? 1 : -1;
        this.effect('slash', p.x + p.facing * 70, cy, 90, sk.color, 0.35);
        if (t) this.damage(t, this.stats.atk * sk.mult, sk.name);
      } else if (sk.id === 'cyclone') {
        this.effect('ring', p.x, cy, range, sk.color, 0.5);
        for (const m of inRange) this.damage(m, this.stats.atk * sk.mult);
      } else {
        for (const m of inRange.slice(0, 12)) {
          this.effect('star', m.x, m.y + m.h / 2, 40, sk.color, 0.6);
          this.damage(m, this.stats.atk * sk.mult);
        }
        if (!inRange.length) this.effect('ring', p.x, cy, 120, sk.color, 0.5);
      }
    });
  }

  private updateCompanions(dt: number) {
    const p = this.player;
    this.party.forEach((c, i) => {
      // follow the player in a little trail
      const tx = p.x - p.facing * (50 + i * 38);
      const ty = p.y + 55 + (i % 2) * 30 + Math.sin(this.time * 3 + i) * 6;
      c.x += (tx - c.x) * Math.min(1, dt * 4);
      c.y += (ty - c.y) * Math.min(1, dt * 4);

      c.timer -= dt;
      if (c.timer > 0) return;
      let best: Mob | null = null;
      let bd = 420;
      for (const m of this.mobs) {
        const d = Math.hypot(m.x - c.x, m.y - c.y);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (!best) return;
      const o = this.state.companions[c.id];
      if (!o) return;
      c.timer = BALANCE.companionAttackInterval;
      c.hit = 1;
      const color = COMPANION[c.id].color;
      this.effect('bolt', c.x, c.y, 6, color, 0.2, best.x, best.y + best.h / 2);
      this.damage(best, this.stats.atk * companionHitMult(c.id, o.level), undefined, color);
    });
  }

  private damage(m: Mob, base: number, label?: string, color?: string) {
    if (!this.mobs.includes(m)) return;
    const crit = this.rand() < this.stats.critRate;
    const dmg = base * (crit ? this.stats.critDmg : 1) * (0.9 + this.rand() * 0.2);
    m.hp -= dmg;
    m.hitFlash = 1;
    const text = (label ? label + ' ' : '') + fmtDmg(dmg) + (crit ? '!' : '');
    this.float(
      m.x + (this.rand() - 0.5) * 30, m.y + m.h + 14,
      text, color ?? (crit ? '#ffb703' : '#ffffff'), crit ? 20 : label ? 18 : 15,
    );
    if (m.hp <= 0) this.killMob(m);
  }

  private effect(kind: Effect['kind'], x: number, y: number, r: number, color: string, life: number, x2?: number, y2?: number) {
    if (this.effects.length > 60) this.effects.shift();
    this.effects.push({ kind, x, y, r, color, life, maxLife: life, x2, y2 });
  }

  private float(x: number, y: number, text: string, color: string, size: number) {
    if (this.floats.length > 50) this.floats.shift();
    this.floats.push({ x, y, text, color, life: 0.9, size });
  }

  private killMob(m: Mob) {
    const s = this.state;
    this.mobs = this.mobs.filter((x) => x !== m);
    if (this.target === m) this.target = null;
    this.effect('poof', m.x, m.y + m.h / 2, m.w * 0.6, m.color, 0.35);
    s.gold += m.gold;
    this.addExp(m.exp);
    s.totals.kills++;
    this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * BALANCE.healOnKillPct);
    if (this.rand() < BALANCE.gemDropChance) {
      s.gems += 1;
      this.float(m.x, m.y + m.h + 34, '+1 💎', '#7df9ff', 15);
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
      this.syncLayout();
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
    this.target = null;
    if (wasBoss) {
      s.bossFailed = true;
      this.onToast('Defeated by the boss. Farming until you challenge again.', '#ff6b6b');
    } else if (s.stage > 1) {
      s.stage--;
      s.bossFailed = true;
      s.kills = 0;
      this.onToast('You were defeated and fell back a stage.', '#ff6b6b');
      this.syncLayout();
    }
    this.dirty = true;
  }

  private failBoss(msg: string) {
    this.state.bossFailed = true;
    this.mobs = this.mobs.filter((m) => !m.boss);
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
