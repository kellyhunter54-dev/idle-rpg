// King Jelly, ported from the MMO's first boss for the run mode's lair.
// One HP pool shared by 1, then 2, then 4 slimes (splits at 80% and 50%).
// Phases 1-2: the crowned slime hops around the room; every landing slams and sends out
// rings of slime with gaps (jump or slip through a gap). Rings slow you and add Slimed;
// 10 Slimed stacks in one fight kills you. Split-offs hop and charge and leave goo that roots you.
// Phase 3 (wild): the crowned slime sits in the middle sending rings nonstop and raining globs,
// while the minis only charge, wall to wall, toward the cleanest floor.
import { GameMap, TILE, Tile, fits, generateLair, moveCircle } from '../map';
import type { Enemy, Run } from './run';

export const JELLY = {
  name: 'King Jelly',
  color: '#6ccf5a',
  radius: 70,
  /** pool HP = base * growth^level at the moment you enter (tuned for a ~3 minute fight) */
  hpBase: 4000,
  hpGrowth: 1.18,
  /** rings are walls of slime: jumping doesn't clear them, find a gap (set true to allow jumping) */
  jumpRings: false,
  phaseAt: [0.8, 0.5],
  size: [1, 0.74, 0.55],
  speed: [1, 1.3, 1.65],
  // the crowned slime (phases 1-2)
  mainHopEvery: [1.1, 1.7] as [number, number],
  mainHopTime: 0.9,
  mainSlamRadius: 125,
  // rings
  waveSpeed: 171,
  waveWidth: 34,
  waveMaxR: 950,
  waveCount: [2, 3, 4],
  waveSpacing: 260,
  waveGaps: 5,
  waveGapHalf: 0.24,
  waveRest: 0.55,
  waveSlowTime: 2,
  lethal: 10,
  // split-offs
  hopEvery: [0.9, 1.7] as [number, number],
  hopTime: 1.0,
  hopRadius: 80,
  chargeSpeed: 800,
  chargeLen: 700,
  // wild phase
  wild: { actEvery: [0.15, 0.45] as [number, number], chargeLen: 3000, rainEvery: [0.08, 0.17] as [number, number], rainR: 45, rainTime: 2.0 },
  // goo
  gooLife: 7,
  gooPuddle: 62,
  gooDrop: 26,
  trailEvery: 85,
  rootGoo: 1.0,
  rootBump: 1.4,
  rootedDamage: 1.3,
  /** damage as a share of your max HP */
  pct: { slam: 0.3, ring: 0.22, hop: 0.12, charge: 0.25, glob: 0.15, bump: 0.08, main: 0.12 },
};

interface Ring {
  x: number;
  y: number;
  r: number;
  /** gap centres (radians) */
  gaps: number[];
  hit: boolean;
}
export interface Goo {
  x: number;
  y: number;
  r: number;
  until: number;
}
interface SlimeAI {
  main: boolean;
  /** in the air: from -> to over dur */
  hop: { fx: number; fy: number; tx: number; ty: number; t: number; dur: number } | null;
  wait: number;
  charge: { dx: number; dy: number; left: number; trail: number } | null;
  /** charge wind-up (telegraph showing) */
  wind: number;
  windDir: { dx: number; dy: number; len: number };
  anchored: boolean;
  actions: number;
}

const rr = (r: () => number, [a, b]: [number, number]) => a + r() * (b - a);

export class JellyFight {
  map: GameMap;
  centre: { x: number; y: number };
  entrance: { x: number; y: number };
  exit: { x: number; y: number };
  pool = { hp: 1, maxHp: 1 };
  phase = 0;
  slimes: Enemy[] = [];
  ai = new Map<number, SlimeAI>();
  rings: Ring[] = [];
  goo: Goo[] = [];
  slimed = 0;
  /** last ring of the latest set: the crowned slime rests until it's this far out */
  private lastRing: Ring | null = null;
  private rainT = 0;
  done = false;
  private roomR: number;

  constructor(private run: Run, level: number) {
    this.map = generateLair(0);
    // no brazier pillars in the room: the walls carry torches instead (drawn by the renderer)
    for (let i = 0; i < this.map.tiles.length; i++) if (this.map.tiles[i] === Tile.Pillar) this.map.tiles[i] = Tile.Floor;
    this.centre = this.map.altars[0];
    this.entrance = this.map.entrances[0];
    this.exit = this.map.exit!;
    this.roomR = 9.2 * TILE;
    const hp = JELLY.hpBase * Math.pow(JELLY.hpGrowth, level);
    this.pool = { hp, maxHp: hp };
    const main = this.makeSlime(this.centre.x, this.centre.y, true);
    main.spawnT = 1.2;
  }

  get main(): Enemy | undefined {
    return this.slimes.find((s) => this.ai.get(s.id)?.main && !s.dead);
  }

  private makeSlime(x: number, y: number, main: boolean): Enemy {
    const run = this.run;
    const e = run.spawnJellySlime(x, y, JELLY.radius * JELLY.size[this.phase], main ? JELLY.name : 'Jellyling');
    e.hp = this.pool.hp;
    e.maxHp = this.pool.maxHp;
    this.slimes.push(e);
    this.ai.set(e.id, { main, hop: null, wait: main ? 1.5 : 0.6 + run.rand() * 0.6, charge: null, wind: 0, windDir: { dx: 1, dy: 0, len: 0 }, anchored: false, actions: 0 });
    return e;
  }

  /** Every hit on any slime goes into the shared pool (more slimes = each hit counts a bit less). */
  damage(n: number) {
    const alive = this.slimes.filter((s) => !s.dead).length || 1;
    this.pool.hp -= n / Math.sqrt(alive);
    for (const s of this.slimes) s.hp = this.pool.hp;
    this.checkPhase();
    if (this.pool.hp <= 0 && !this.done) {
      this.done = true;
      this.run.jellyDefeated();
    }
  }

  private checkPhase() {
    // a big hit that skips a threshold still does every split it skipped
    while (this.phase < 2 && this.pool.hp <= this.pool.maxHp * JELLY.phaseAt[this.phase]) {
      this.phase++;
      const size = JELLY.size[this.phase];
      for (const s of this.slimes) s.r = JELLY.radius * size;
      const want = this.phase === 1 ? 2 : 4;
      const m = this.main ?? this.slimes[0];
      while (this.slimes.filter((s) => !s.dead).length < want) {
        const a = this.run.rand() * Math.PI * 2;
        const x = m.x + Math.cos(a) * 120;
        const y = m.y + Math.sin(a) * 120;
        const s = this.makeSlime(fits(this.map, x, y, 30) ? x : m.x, fits(this.map, x, y, 30) ? y : m.y, false);
        s.spawnT = 0.5;
      }
      this.run.notice(this.phase === 1 ? 'King Jelly splits!' : 'King Jelly goes wild!', '#6ccf5a', '👑');
      if (this.phase === 2 && m) {
        // the crowned slime leaps to the middle and stays there
        const ai = this.ai.get(m.id)!;
        ai.charge = null;
        this.startHop(m, ai, this.centre.x, this.centre.y, 1.2, JELLY.mainSlamRadius * size, 'wave', true);
        ai.anchored = true;
      }
    }
  }

  // ---------------------------------------------------------------- update
  update(dt: number) {
    const run = this.run;
    const t = run.t;
    for (const s of this.slimes) {
      if (s.dead) continue;
      s.hitFlash -= dt;
      if (s.spawnT > 0) {
        s.spawnT -= dt;
        continue;
      }
      const ai = this.ai.get(s.id)!;
      s.angle = Math.atan2(run.y - s.y, run.x - s.x);
      if (ai.hop) {
        this.updateHop(s, ai, dt);
        continue;
      }
      if (ai.charge) {
        this.updateCharge(s, ai, dt);
        continue;
      }
      if (ai.wind > 0) {
        ai.wind -= dt;
        if (ai.wind <= 0) ai.charge = { dx: ai.windDir.dx, dy: ai.windDir.dy, left: ai.windDir.len, trail: 0 };
        continue;
      }
      // touching a slime on the ground hurts (bumping a split-off roots you)
      if (run.air <= 0 && Math.hypot(s.x - run.x, s.y - run.y) < s.r * 0.85 + run.r) {
        if (ai.main) this.hit(JELLY.pct.main, true);
        else {
          this.hit(JELLY.pct.bump, false);
          run.rootFor(JELLY.rootBump);
        }
      }
      ai.wait -= dt;
      if (ai.main) {
        if (ai.anchored) {
          // wild phase: bounce in place, rings nonstop
          s.z = Math.abs(Math.sin(t * 4)) * 30;
          if (!this.lastRing || this.lastRing.r >= JELLY.waveMaxR * JELLY.waveRest) this.emitRings(s.x, s.y, JELLY.waveCount[2]);
          continue;
        }
        const rested = !this.lastRing || this.lastRing.r >= JELLY.waveMaxR * JELLY.waveRest;
        if (ai.wait <= 0 && rested) {
          const p = this.roomSpot(220);
          this.startHop(s, ai, p.x, p.y, JELLY.mainHopTime, JELLY.mainSlamRadius * JELLY.size[this.phase], 'wave', true);
          ai.wait = rr(run.rand, JELLY.mainHopEvery);
        }
        continue;
      }
      // split-offs
      if (ai.wait > 0) continue;
      ai.actions++;
      const wild = this.phase === 2;
      const charge = wild || ai.actions % 3 === 0;
      if (charge) {
        const p = wild ? this.cleanSpot(s) : { x: run.x + run.vx * 0.4, y: run.y + run.vy * 0.4 };
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        const l = Math.hypot(dx, dy) || 1;
        const len = this.chargeLength(s, dx / l, dy / l, wild ? JELLY.wild.chargeLen : JELLY.chargeLen);
        ai.windDir = { dx: dx / l, dy: dy / l, len };
        ai.wind = wild ? 0.6 : 0.8;
        run.telegraphs.push({ x: s.x, y: s.y, r: s.r * 0.8, t: 0, dur: ai.wind, dmg: 0, line: { dx: dx / l, dy: dy / l, len } });
        ai.wait = wild ? rr(run.rand, JELLY.wild.actEvery) : rr(run.rand, JELLY.hopEvery) * 1.4;
      } else {
        // hop: near you (leading your run) or a random spot nearby
        const lead = run.rand() < 0.6;
        let tx = lead ? run.x + run.vx * 0.8 : run.x + (run.rand() - 0.5) * 500;
        let ty = lead ? run.y + run.vy * 0.8 : run.y + (run.rand() - 0.5) * 500;
        // never land right on top of where you're standing still
        if (Math.hypot(tx - run.x, ty - run.y) < 60) {
          tx += 140;
          ty -= 60;
        }
        const p = this.clampRoom(tx, ty, s.r);
        this.startHop(s, ai, p.x, p.y, JELLY.hopTime, JELLY.hopRadius * JELLY.size[this.phase], 'landing', false);
        ai.wait = rr(run.rand, JELLY.hopEvery) * (1 + 0.4 * (this.slimes.length - 2));
      }
    }
    this.updateRings(dt);
    this.updateGoo();
    if (this.phase === 2 && this.main) {
      // slime rain: evenly spread, never aimed at you
      this.rainT -= dt;
      while (this.rainT <= 0) {
        this.rainT += rr(run.rand, JELLY.wild.rainEvery);
        const p = this.spreadSpot();
        run.telegraphs.push({ x: p.x, y: p.y, r: JELLY.wild.rainR, t: 0, dur: JELLY.wild.rainTime, dmg: 0, style: 'spout', pct: JELLY.pct.glob, slimed: true });
      }
    }
  }

  private startHop(s: Enemy, ai: SlimeAI, tx: number, ty: number, dur: number, radius: number, style: 'wave' | 'landing', main: boolean) {
    ai.hop = { fx: s.x, fy: s.y, tx, ty, t: 0, dur };
    this.run.telegraphs.push({
      x: tx, y: ty, r: radius, t: 0, dur, dmg: 0, style, pct: main ? JELLY.pct.slam : JELLY.pct.hop, slimed: main, goo: main ? 0 : JELLY.gooPuddle * JELLY.size[this.phase],
      from: { x: s.x, y: s.y },
    });
  }

  private updateHop(s: Enemy, ai: SlimeAI, dt: number) {
    const h = ai.hop!;
    h.t += dt;
    const k = Math.min(1, h.t / h.dur);
    s.x = h.fx + (h.tx - h.fx) * k;
    s.y = h.fy + (h.ty - h.fy) * k;
    s.z = Math.sin(Math.PI * k) * (ai.main ? 220 : 150);
    if (k >= 1) {
      s.z = 0;
      ai.hop = null;
      if (ai.main) this.emitRings(s.x, s.y, JELLY.waveCount[this.phase]);
    }
  }

  private updateCharge(s: Enemy, ai: SlimeAI, dt: number) {
    const run = this.run;
    const c = ai.charge!;
    const step = Math.min(c.left, JELLY.chargeSpeed * dt);
    const p = moveCircle(this.map, s.x, s.y, c.dx * step, c.dy * step, s.r * 0.8, true);
    const moved = Math.hypot(p.x - s.x, p.y - s.y);
    s.x = p.x;
    s.y = p.y;
    c.left -= step;
    c.trail += moved;
    // goo trail, spaced so there's always a gap to slip through
    while (c.trail >= JELLY.trailEvery) {
      c.trail -= JELLY.trailEvery;
      this.goo.push({ x: s.x, y: s.y, r: JELLY.gooDrop * (this.phase === 2 ? 1.35 : 1), until: run.t + JELLY.gooLife });
    }
    if (run.air <= 0 && Math.hypot(s.x - run.x, s.y - run.y) < s.r * 0.8 + run.r) {
      this.hit(JELLY.pct.charge, false);
      run.rootFor(JELLY.rootBump);
    }
    if (c.left <= 0 || moved < step * 0.3) ai.charge = null;
  }

  /** Charges stop at the wall. */
  private chargeLength(s: Enemy, dx: number, dy: number, want: number): number {
    let len = 0;
    while (len < want && fits(this.map, s.x + dx * (len + 32), s.y + dy * (len + 32), s.r * 0.8)) len += 32;
    return Math.max(64, len);
  }

  private emitRings(x: number, y: number, n: number) {
    let off = this.run.rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      // each ring's gaps are shifted from the last one, so you have to move between them
      off += Math.PI / JELLY.waveGaps + (this.run.rand() - 0.5) * 0.4;
      const gaps: number[] = [];
      for (let g = 0; g < JELLY.waveGaps; g++) gaps.push(off + (g / JELLY.waveGaps) * Math.PI * 2);
      const ring = { x, y, r: -i * JELLY.waveSpacing, gaps, hit: false };
      this.rings.push(ring);
      this.lastRing = ring;
    }
  }

  /** Is the angle inside one of the ring's gaps? */
  inGap(ring: Ring, a: number): boolean {
    return ring.gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < JELLY.waveGapHalf);
  }

  private updateRings(dt: number) {
    const run = this.run;
    for (const ring of this.rings) {
      ring.r += JELLY.waveSpeed * dt;
      if (ring.hit || ring.r <= 0) continue;
      const d = Math.hypot(run.x - ring.x, run.y - ring.y);
      if (Math.abs(d - ring.r) > JELLY.waveWidth / 2 + run.r * 0.6) continue;
      // jump over it, or slip through a gap
      if ((JELLY.jumpRings && run.air > 0) || this.inGap(ring, Math.atan2(run.y - ring.y, run.x - ring.x))) continue;
      ring.hit = true;
      this.hit(JELLY.pct.ring, true);
      run.slowFor(JELLY.waveSlowTime);
    }
    this.rings = this.rings.filter((r) => r.r < JELLY.waveMaxR);
  }

  /** Called by the run when a jelly telegraph lands. */
  landed(tg: { x: number; y: number; r: number; pct?: number; slimed?: boolean; goo?: number }) {
    const run = this.run;
    if (tg.goo) this.goo.push({ x: tg.x, y: tg.y, r: tg.goo, until: run.t + JELLY.gooLife });
    if (Math.hypot(run.x - tg.x, run.y - tg.y) < tg.r + run.r * 0.5) this.hit(tg.pct ?? 0.1, !!tg.slimed, true);
  }

  private updateGoo() {
    const run = this.run;
    const t = run.t;
    this.goo = this.goo.filter((g) => g.until > t);
    if (run.air > 0) return;
    let touched = false;
    for (const g of this.goo) if (Math.hypot(g.x - run.x, g.y - run.y) < g.r + run.r * 0.6) touched = true;
    if (!touched) return;
    // stepping in goo roots you, and every puddle you're touching splats away
    run.rootFor(JELLY.rootGoo);
    this.goo = this.goo.filter((g) => Math.hypot(g.x - run.x, g.y - run.y) >= g.r + run.r * 0.6);
  }

  /** A hit from the boss: % of your max HP, +30% while rooted; the crowned slime's hits add Slimed. */
  private hit(pct: number, slimed: boolean, ignoreIframes = false) {
    const run = this.run;
    if (ignoreIframes) run.iframes = 0;
    if (run.iframes > 0) return;
    const rooted = run.rootUntil > run.t ? JELLY.rootedDamage : 1;
    const landed = run.hurt(run.stats.maxHp * pct * rooted, undefined, 'slam');
    if (slimed && landed) {
      this.slimed++;
      if (this.slimed >= JELLY.lethal) {
        run.notice('Slimed through. The jelly takes you.', '#6ccf5a', '🟢');
        run.hp = 0;
      }
    }
  }

  // ---------------------------------------------------------------- spots
  private clampRoom(x: number, y: number, r: number) {
    const c = this.centre;
    const dx = x - c.x;
    const dy = y - c.y;
    const d = Math.hypot(dx, dy);
    const max = this.roomR - r;
    if (d > max) {
      x = c.x + (dx / d) * max;
      y = c.y + (dy / d) * max;
    }
    if (!fits(this.map, x, y, r * 0.8)) return { x: c.x + (dx / (d || 1)) * Math.min(d, max) * 0.6, y: c.y + (dy / (d || 1)) * Math.min(d, max) * 0.6 };
    return { x, y };
  }
  /** A random open spot in the room at least `minFromYou` away from the hero. */
  private roomSpot(minFromYou: number) {
    const run = this.run;
    for (let i = 0; i < 30; i++) {
      const a = run.rand() * Math.PI * 2;
      const d = Math.sqrt(run.rand()) * (this.roomR - 90);
      const x = this.centre.x + Math.cos(a) * d;
      const y = this.centre.y + Math.sin(a) * d;
      if (Math.hypot(x - run.x, y - run.y) >= minFromYou && fits(this.map, x, y, 50)) return { x, y };
    }
    return { ...this.centre };
  }
  /** Best of 24 open spots by distance from goo and from where the other minis are heading. */
  private cleanSpot(self: Enemy) {
    let best = this.roomSpot(0);
    let bestScore = -1;
    for (let i = 0; i < 24; i++) {
      const p = this.roomSpot(0);
      let score = 1e9;
      for (const g of this.goo) score = Math.min(score, Math.hypot(g.x - p.x, g.y - p.y));
      for (const s of this.slimes) {
        if (s === self || s.dead) continue;
        const ai = this.ai.get(s.id)!;
        const tx = ai.windDir ? s.x + ai.windDir.dx * ai.windDir.len : s.x;
        const ty = ai.windDir ? s.y + ai.windDir.dy * ai.windDir.len : s.y;
        score = Math.min(score, Math.hypot(tx - p.x, ty - p.y));
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }
  /** Rain spots: best of 8 by distance from globs already falling. */
  private spreadSpot() {
    let best = this.roomSpot(0);
    let bestScore = -1;
    for (let i = 0; i < 8; i++) {
      const p = this.roomSpot(0);
      let score = 1e9;
      for (const tg of this.run.telegraphs) if (tg.style === 'spout') score = Math.min(score, Math.hypot(tg.x - p.x, tg.y - p.y));
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /** For AUTO: will the spot (x, y) be hit by a ring in about `secs` seconds (outside a gap)? */
  ringDanger(x: number, y: number, secs: number): boolean {
    for (const ring of this.rings) {
      if (ring.hit) continue;
      const d = Math.hypot(x - ring.x, y - ring.y);
      const at = ring.r + JELLY.waveSpeed * secs;
      if (Math.abs(d - at) < JELLY.waveWidth / 2 + 26 && !this.inGap(ring, Math.atan2(y - ring.y, x - ring.x))) return true;
    }
    return false;
  }
  /** For AUTO: is a ring about to hit me outside a gap? */
  ringThreat(): boolean {
    const run = this.run;
    for (const ring of this.rings) {
      if (ring.hit || ring.r <= 0) continue;
      const d = Math.hypot(run.x - ring.x, run.y - ring.y);
      const gap = d - ring.r;
      if (gap > 0 && gap < 45 && !this.inGap(ring, Math.atan2(run.y - ring.y, run.x - ring.x))) return true;
    }
    return false;
  }
}
