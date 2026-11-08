// Run mode renderer: the same isometric pixel-art pipeline as the MMO version (low-res world canvas
// scaled up with hard edges, sub-pixel smooth scrolling, crisp overlay for the hero and text).
import { TILE, Tile } from '../map';
import * as PX from '../pixel';
import { RUN, RUN_RARITIES, SHRINE_RADIUS, SHRINE_TIME } from './data';
import { Enemy, Run } from './run';
import { JELLY } from './jelly';
import * as SP from './sprites';

const FONT = '"Pixelify Sans", Georgia, serif';

export class RunRenderer {
  private ctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private overlay: HTMLCanvasElement;
  private fx: HTMLCanvasElement;
  private fctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private block = 2;
  private d = 0.5;
  private odpr = 1;
  private margin = 2;
  private k = 0.5;
  private ox = 0;
  private oy = 0;
  private fracX = 0;
  private fracY = 0;
  private lastShift = '';
  private face = { back: false, flip: false };
  private mini: HTMLCanvasElement | null = null;
  private sortBuf: { d: number; t: number; i: number }[] = [];
  touch = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.overlay = document.createElement('canvas');
    this.overlay.id = 'overlay';
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    canvas.insertAdjacentElement('afterend', this.overlay);
    this.octx = this.overlay.getContext('2d')!;
    this.fx = document.createElement('canvas');
    this.fctx = this.fx.getContext('2d', { willReadFrequently: true })!;
    for (const c of [this.ctx, this.octx, this.fctx]) {
      const arc = c.arc.bind(c);
      c.arc = (x, y, r, a0, a1, ccw) => arc(x, y, Math.max(0, r), a0, a1, ccw);
      const ell = c.ellipse.bind(c);
      c.ellipse = (x, y, rx, ry, rot, a0, a1, ccw) => ell(x, y, Math.max(0, rx), Math.max(0, ry), rot, a0, a1, ccw);
    }
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
  }

  private resize() {
    const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.block = Math.max(2, Math.round(r.width / 400));
    this.d = 1 / this.block;
    this.margin = this.block;
    const M = this.margin;
    const st = this.canvas.style;
    st.position = 'absolute';
    st.left = `${-M}px`;
    st.top = `${-M}px`;
    st.width = `${r.width + 2 * M}px`;
    st.height = `${r.height + 2 * M}px`;
    st.imageRendering = 'pixelated';
    this.canvas.width = Math.max(1, Math.round((r.width + 2 * M) * this.d));
    this.canvas.height = Math.max(1, Math.round((r.height + 2 * M) * this.d));
    this.fx.width = this.canvas.width;
    this.fx.height = this.canvas.height;
    this.odpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(r.width * this.odpr);
    this.overlay.height = Math.round(r.height * this.odpr);
    this.ctx.imageSmoothingEnabled = false;
    this.octx.imageSmoothingEnabled = false;
    this.touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  }

  // ---- projection (CSS px) ----
  private px(x: number, y: number) {
    return this.ox + (x - y) * this.k;
  }
  private py(x: number, y: number, z = 0) {
    return this.oy + (x + y) * this.k * 0.5 - z * this.k;
  }
  private screenDir(angle: number) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = c - s;
    const dy = (c + s) * 0.5;
    const l = Math.hypot(dx, dy) || 1;
    return { dx: dx / l, dy: dy / l };
  }
  private screenT(c: CanvasRenderingContext2D) {
    const d = this.d;
    c.setTransform(d, 0, 0, d, this.margin * d, this.margin * d);
  }
  private groundT(c: CanvasRenderingContext2D) {
    const k = this.k;
    const d = this.d;
    const M = this.margin;
    c.setTransform(k * d, (k / 2) * d, -k * d, (k / 2) * d, (this.ox + M) * d, (this.oy + M) * d);
  }
  private overT(world = true) {
    const o = this.odpr;
    this.octx.setTransform(o, 0, 0, o, world ? this.fracX * o : 0, world ? this.fracY * o : 0);
  }

  /** Sprite with its anchor at a screen point, snapped to game pixels (exact on the overlay). */
  private blit(c: CanvasRenderingContext2D, img: HTMLCanvasElement, sx: number, sy: number, ax: number, ay: number, flip = false, alpha = 1) {
    const B = this.block;
    const exact = c === this.octx;
    const gx = (exact ? sx / B : Math.round(sx / B)) - (flip ? img.width - ax : ax);
    const gy = (exact ? sy / B : Math.round(sy / B)) - ay;
    if (alpha !== 1) c.globalAlpha = alpha;
    if (flip) {
      c.save();
      c.translate((gx + img.width) * B, gy * B);
      c.scale(-1, 1);
      c.drawImage(img, 0, 0, img.width * B, img.height * B);
      c.restore();
    } else c.drawImage(img, gx * B, gy * B, img.width * B, img.height * B);
    if (alpha !== 1) c.globalAlpha = 1;
  }

  /** Snap the scratch layer to hard pixels (4 alpha steps) and paste it onto the world. */
  private flushFx() {
    const f = this.fctx;
    const img = f.getImageData(0, 0, this.fx.width, this.fx.height);
    const a = img.data;
    for (let i = 3; i < a.length; i += 4) {
      const v = a[i];
      if (!v) continue;
      a[i] = v < 24 ? 0 : v < 96 ? 64 : v < 160 ? 128 : v < 224 ? 192 : 255;
    }
    f.putImageData(img, 0, 0);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.fx, 0, 0);
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, this.fx.width, this.fx.height);
  }

  draw(run: Run, time: number) {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    const B = this.block;
    this.k = 0.25 * B;
    const hz = run.jumpZ;
    const centerY = this.touch ? h * 0.46 : h * 0.54;
    this.ox = w / 2 - (run.x - run.y) * this.k;
    this.oy = centerY - (run.x + run.y) * this.k * 0.5;
    const sxp = Math.round(this.ox / B) * B;
    const syp = Math.round(this.oy / B) * B;
    this.fracX = this.ox - sxp;
    this.fracY = this.oy - syp;
    this.ox = sxp;
    this.oy = syp;
    const shift = `translate(${this.fracX.toFixed(2)}px, ${this.fracY.toFixed(2)}px)`;
    if (shift !== this.lastShift) {
      this.canvas.style.transform = shift;
      this.lastShift = shift;
    }
    const o = this.octx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.overlay.width, this.overlay.height);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16210f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.screenT(ctx);

    // visible tile range
    const inv = (sx: number, sy: number) => {
      const X = sx - this.ox;
      const Y = sy - this.oy;
      return { x: (X + 2 * Y) / (2 * this.k), y: (2 * Y - X) / (2 * this.k) };
    };
    const tl = inv(0, -100);
    const tr = inv(w, -100);
    const bl = inv(0, h + 140);
    const br = inv(w, h + 140);
    const map = run.map;
    const minTx = Math.max(0, Math.floor(tl.x / TILE) - 1);
    const maxTx = Math.min(map.w - 1, Math.ceil(br.x / TILE) + 1);
    const minTy = Math.max(0, Math.floor(tr.y / TILE) - 1);
    const maxTy = Math.min(map.h - 1, Math.ceil(bl.y / TILE) + 1);

    const lair = map.kind === 'lair';
    // ---- floor ----
    for (let ty = minTy; ty <= maxTy; ty++)
      for (let tx = minTx; tx <= maxTx; tx++) {
        const i = ty * map.w + tx;
        const cx = (tx + 0.5) * TILE;
        const cy = (ty + 0.5) * TILE;
        const v = (map.variant[i] * 3 + tx * 7 + ty * 13) & 15;
        if (lair) {
          if (map.tiles[i] === Tile.Rock) continue;
          this.blit(ctx, PX.stoneTile(LAIR_ROCK, v & 3), this.px(cx, cy), this.py(cx, cy), PX.TILE_W / 2, PX.TILE_H / 2);
        } else this.blit(ctx, PX.groundTile(0, v, tx, ty), this.px(cx, cy), this.py(cx, cy), PX.TILE_W / 2, PX.TILE_H / 2);
      }

    // ---- ground layer (crisp vector shapes) ----
    const f = this.fctx;
    this.groundT(f);
    // shrines: stone ring + charge
    for (const s of run.shrines) {
      f.globalAlpha = s.used ? 0.25 : 0.5;
      f.strokeStyle = s.used ? '#5d5a66' : '#8fd3ff';
      f.lineWidth = 10;
      f.beginPath();
      f.arc(s.x, s.y, SHRINE_RADIUS, 0, Math.PI * 2);
      f.stroke();
      if (!s.used && s.charge > 0) {
        f.globalAlpha = 0.9;
        f.strokeStyle = '#e8f7ff';
        f.lineWidth = 14;
        f.beginPath();
        f.arc(s.x, s.y, SHRINE_RADIUS, -Math.PI / 2, -Math.PI / 2 + (s.charge / SHRINE_TIME) * Math.PI * 2);
        f.stroke();
        f.globalAlpha = 0.18;
        f.fillStyle = '#8fd3ff';
        f.beginPath();
        f.arc(s.x, s.y, SHRINE_RADIUS, 0, Math.PI * 2);
        f.fill();
      }
    }
    // poison pools
    for (const p of run.pools) {
      const left = Math.min(1, (p.until - run.t) * 2);
      if (p.style === 'rain') {
        // the patch the arrows are falling on
        f.globalAlpha = 0.16 * left;
        f.fillStyle = run.weapons[p.w]?.def.color ?? '#e0c08a';
        f.beginPath();
        f.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        f.fill();
        f.globalAlpha = 0.5 * left;
        f.strokeStyle = run.weapons[p.w]?.def.color ?? '#e0c08a';
        f.lineWidth = 4;
        f.setLineDash([14, 12]);
        f.stroke();
        f.setLineDash([]);
        continue;
      }
      const pc = run.weapons[p.w]?.def.color ?? '#6fbf3a';
      const spikes = run.weapons[p.w]?.def.id === 'traps';
      f.globalAlpha = 0.45 * left;
      f.fillStyle = spikes ? '#5a4630' : '#6fbf3a';
      f.beginPath();
      f.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      f.fill();
      f.globalAlpha = 0.8 * left;
      f.strokeStyle = spikes ? pc : '#b8f27a';
      f.lineWidth = 6;
      f.stroke();
      f.fillStyle = spikes ? '#e6ecf2' : '#d6ff9e';
      for (let b = 0; b < 4; b++) {
        const a = time * 1.3 + b * 1.7 + p.x;
        const rr = p.r * (0.25 + ((b * 0.37 + time * 0.4) % 0.6));
        f.beginPath();
        f.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, 7, 0, Math.PI * 2);
        f.fill();
      }
    }
    // ultimate active: a pulsing ring under the hero
    if (run.coreActive) {
      const c = run.core.color;
      f.globalAlpha = 0.18;
      f.fillStyle = c;
      f.beginPath();
      f.arc(run.x, run.y, 70, 0, Math.PI * 2);
      f.fill();
      f.globalAlpha = 0.85;
      f.strokeStyle = c;
      f.lineWidth = 6;
      f.beginPath();
      f.arc(run.x, run.y, 60 + Math.sin(time * 8) * 8, 0, Math.PI * 2);
      f.stroke();
    }
    // aura weapon
    for (const wpn of run.weapons) {
      if (wpn.def.kind !== 'aura') continue;
      const R = 105 * wpn.area * (1 + run.stats.area);
      f.globalAlpha = 0.16;
      f.fillStyle = '#7bc96f';
      f.beginPath();
      f.arc(run.x, run.y, R, 0, Math.PI * 2);
      f.fill();
      f.globalAlpha = 0.55;
      f.strokeStyle = '#a7e89a';
      f.lineWidth = 5;
      f.setLineDash([18, 14]);
      f.lineDashOffset = -time * 40;
      f.stroke();
      f.setLineDash([]);
    }
    // torch light on the lair floor (kept inside the room)
    if (lair && run.jelly) {
      f.save();
      f.beginPath();
      f.arc(run.jelly.centre.x, run.jelly.centre.y, 9.4 * TILE, 0, Math.PI * 2);
      f.clip();
      for (let ty = minTy; ty <= maxTy; ty++)
        for (let tx = minTx; tx <= maxTx; tx++) {
          const side = this.torchSide(run, tx, ty);
          if (!side) continue;
          const gx = (tx + 0.5) * TILE + (side < 0 ? 0 : TILE * 0.9);
          const gy = (ty + 0.5) * TILE + (side < 0 ? TILE * 0.9 : 0);
          const fl = 1 + Math.sin(time * 9 + tx * 1.7 + ty) * 0.06;
          f.globalAlpha = 0.14;
          f.fillStyle = '#ffb35c';
          f.beginPath();
          f.arc(gx, gy, 120 * fl, 0, Math.PI * 2);
          f.fill();
          f.globalAlpha = 0.12;
          f.beginPath();
          f.arc(gx, gy, 60 * fl, 0, Math.PI * 2);
          f.fill();
        }
      f.restore();
    }
    // King Jelly: goo, rings with gaps
    if (run.jelly) {
      const j = run.jelly;
      for (const g of j.goo) {
        const left = Math.min(1, (g.until - run.t) * 1.5);
        f.globalAlpha = 0.75 * left;
        f.fillStyle = '#4fa83a';
        f.beginPath();
        f.arc(g.x, g.y, g.r, 0, Math.PI * 2);
        f.fill();
        f.globalAlpha = 0.9 * left;
        f.fillStyle = '#9be38a';
        f.beginPath();
        f.arc(g.x - g.r * 0.3, g.y - g.r * 0.3, g.r * 0.3, 0, Math.PI * 2);
        f.fill();
      }
      // rings stop at the walls
      f.save();
      f.beginPath();
      f.arc(j.centre.x, j.centre.y, 10 * TILE, 0, Math.PI * 2);
      f.clip();
      for (const ring of j.rings) {
        if (ring.r <= 0) continue;
        f.globalAlpha = ring.hit ? 0.35 : 0.85;
        f.strokeStyle = '#6ccf5a';
        f.lineWidth = JELLY.waveWidth;
        const gapHalf = JELLY.waveGapHalf;
        const gs = [...ring.gaps].map((g) => ((g % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
        for (let gi = 0; gi < gs.length; gi++) {
          const a0 = gs[gi] + gapHalf;
          const a1 = (gi + 1 < gs.length ? gs[gi + 1] : gs[0] + Math.PI * 2) - gapHalf;
          if (a1 <= a0) continue;
          f.beginPath();
          f.arc(ring.x, ring.y, ring.r, a0, a1);
          f.stroke();
        }
        f.globalAlpha = ring.hit ? 0.2 : 0.6;
        f.strokeStyle = '#d6ff9e';
        f.lineWidth = 6;
        for (let gi = 0; gi < gs.length; gi++) {
          const a0 = gs[gi] + gapHalf;
          const a1 = (gi + 1 < gs.length ? gs[gi + 1] : gs[0] + Math.PI * 2) - gapHalf;
          if (a1 <= a0) continue;
          f.beginPath();
          f.arc(ring.x, ring.y, ring.r + JELLY.waveWidth * 0.35, a0, a1);
          f.stroke();
        }
      }
      f.restore();
    }
    // the lair door on the world map: a swirling dark pool
    if (!lair && !run.lairCleared) {
      const d = run.lairDoor;
      f.globalAlpha = 0.9;
      f.fillStyle = '#1b2a14';
      f.beginPath();
      f.arc(d.x, d.y, 80, 0, Math.PI * 2);
      f.fill();
      f.strokeStyle = '#6ccf5a';
      f.lineWidth = 8;
      for (let k = 0; k < 3; k++) {
        f.globalAlpha = 0.7 - k * 0.2;
        f.beginPath();
        f.arc(d.x, d.y, 30 + ((time * 25 + k * 18) % 54), 0, Math.PI * 2);
        f.stroke();
      }
    }
    if (lair && run.jelly?.done) {
      const ex = run.jelly.exit;
      f.globalAlpha = 0.85;
      f.fillStyle = '#ffd166';
      f.beginPath();
      f.arc(ex.x, ex.y, 50 + Math.sin(time * 4) * 6, 0, Math.PI * 2);
      f.fill();
    }
    // boss telegraphs: faint outline, the fill grows until it lands
    for (const tg of run.telegraphs) {
      const p = Math.max(0, tg.t / tg.dur);
      if (tg.t < 0) continue;
      if (tg.style) {
        // jelly landings: faint outline, the fill grows with the jump's travel time
        const col = tg.style === 'spout' ? '#6ccf5a' : tg.slimed ? '#ff5c5c' : '#ff8a5c';
        f.globalAlpha = 0.6;
        f.strokeStyle = col;
        f.lineWidth = 4;
        f.beginPath();
        f.arc(tg.x, tg.y, tg.r, 0, Math.PI * 2);
        f.stroke();
        if (tg.style === 'wave') {
          f.globalAlpha = 0.4;
          f.beginPath();
          f.arc(tg.x, tg.y, tg.r + 16, 0, Math.PI * 2);
          f.stroke();
        }
        f.globalAlpha = 0.12 + 0.4 * p;
        f.fillStyle = col;
        f.beginPath();
        f.arc(tg.x, tg.y, tg.r * p, 0, Math.PI * 2);
        f.fill();
        if (tg.from && tg.style !== 'spout') {
          // dotted line from where the slime jumped
          f.globalAlpha = 0.45;
          f.setLineDash([10, 14]);
          f.lineWidth = 3;
          f.beginPath();
          f.moveTo(tg.from.x, tg.from.y);
          f.lineTo(tg.x, tg.y);
          f.stroke();
          f.setLineDash([]);
        }
        continue;
      }
      if (tg.line) {
        const L = tg.line;
        const nx = -L.dy;
        const ny = L.dx;
        const hw = tg.r;
        const quad = (len: number) => {
          f.beginPath();
          f.moveTo(tg.x + nx * hw, tg.y + ny * hw);
          f.lineTo(tg.x + nx * hw + L.dx * len, tg.y + ny * hw + L.dy * len);
          f.lineTo(tg.x - nx * hw + L.dx * len, tg.y - ny * hw + L.dy * len);
          f.lineTo(tg.x - nx * hw, tg.y - ny * hw);
          f.closePath();
        };
        f.globalAlpha = 0.85;
        f.strokeStyle = '#ff5c5c';
        f.lineWidth = 5;
        quad(L.len);
        f.stroke();
        f.globalAlpha = 0.35;
        f.fillStyle = '#ff3b3b';
        quad(L.len * p);
        f.fill();
      } else {
        f.globalAlpha = 0.85;
        f.strokeStyle = '#ff5c5c';
        f.lineWidth = 5;
        f.beginPath();
        f.arc(tg.x, tg.y, tg.r, 0, Math.PI * 2);
        f.stroke();
        f.globalAlpha = 0.18 + 0.3 * p;
        f.fillStyle = '#ff3b3b';
        f.beginPath();
        f.arc(tg.x, tg.y, tg.r * p, 0, Math.PI * 2);
        f.fill();
      }
    }
    // meteors: a shadow that darkens until it lands
    for (const m of run.falling) {
      const p = m.t / m.dur;
      f.globalAlpha = 0.15 + 0.45 * p;
      f.fillStyle = '#1b0f08';
      f.beginPath();
      f.arc(m.x, m.y, m.r * (0.4 + 0.6 * p), 0, Math.PI * 2);
      f.fill();
      f.globalAlpha = 0.7;
      f.strokeStyle = '#ff7b2e';
      f.lineWidth = 5;
      f.beginPath();
      f.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      f.stroke();
    }
    // beams (Piercing Shot, Lightning Lance, Stampede)
    for (const e of run.fx) {
      if (e.kind !== 'beam') continue;
      const p = e.t / e.dur;
      const hw = (e.width ?? 20) * (1 - p * 0.6);
      const dx = Math.cos(e.a!);
      const dy = Math.sin(e.a!);
      const quad = (w: number) => {
        f.beginPath();
        f.moveTo(e.x - dy * w, e.y + dx * w);
        f.lineTo(e.x - dy * w + dx * e.r, e.y + dx * w + dy * e.r);
        f.lineTo(e.x + dy * w + dx * e.r, e.y - dx * w + dy * e.r);
        f.lineTo(e.x + dy * w, e.y - dx * w);
        f.closePath();
      };
      f.globalAlpha = 0.55 * (1 - p);
      f.fillStyle = e.color;
      quad(hw);
      f.fill();
      f.globalAlpha = 0.9 * (1 - p);
      f.fillStyle = '#ffffff';
      quad(hw * 0.3);
      f.fill();
    }
    // weapon swings, nova rings, explosions on the ground
    for (const e of run.fx) {
      const p = e.t / e.dur;
      if (e.kind === 'arc') {
        // soft swipe + a bright crescent edge (kept dim: no big white flashes)
        f.globalAlpha = 0.22 * (1 - p);
        f.fillStyle = e.color;
        f.beginPath();
        f.moveTo(e.x, e.y);
        f.arc(e.x, e.y, e.r * (0.7 + 0.3 * p), e.a! - 1.15, e.a! + 1.15);
        f.closePath();
        f.fill();
        f.globalAlpha = 0.75 * (1 - p);
        f.strokeStyle = '#f4f1e1';
        f.lineWidth = 7;
        f.beginPath();
        f.arc(e.x, e.y, e.r * (0.7 + 0.3 * p), e.a! - 1.15 + p * 0.6, e.a! + 1.15);
        f.stroke();
      } else if (e.kind === 'nova') {
        f.globalAlpha = 0.8 * (1 - p);
        f.strokeStyle = e.color;
        f.lineWidth = 22 * (1 - p) + 6;
        f.beginPath();
        f.arc(e.x, e.y, e.r * Math.min(1, p * 1.05), 0, Math.PI * 2);
        f.stroke();
      } else if (e.kind === 'boom') {
        f.globalAlpha = 0.6 * (1 - p);
        f.fillStyle = e.color;
        f.beginPath();
        f.arc(e.x, e.y, e.r * (0.5 + 0.5 * p), 0, Math.PI * 2);
        f.fill();
      } else if (e.kind === 'land' || e.kind === 'pickup') {
        f.globalAlpha = 0.7 * (1 - p);
        f.strokeStyle = e.color;
        f.lineWidth = 5;
        f.beginPath();
        f.arc(e.x, e.y, e.r * (0.4 + p), 0, Math.PI * 2);
        f.stroke();
      }
    }
    f.globalAlpha = 1;
    this.flushFx();
    this.screenT(ctx);

    // ---- pickups (flat on the ground) ----
    for (const p of run.pickups) {
      const sx = this.px(p.x, p.y);
      const sy = this.py(p.x, p.y);
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
      const bob = Math.round(Math.sin(time * 4 + p.x) * 1) * B;
      const img = p.kind === 'xp' ? SP.gem(SP.gemColor(p.value)) : p.kind === 'gold' ? SP.coin() : p.kind === 'heal' ? SP.heart() : SP.magnet();
      this.blit(ctx, img, sx, sy - 2 * B + bob, img.width >> 1, img.height - 1);
    }

    // ---- standing layer, sorted back to front ----
    const buf = this.sortBuf;
    let n = 0;
    const push = (d: number, t: number, i: number) => {
      if (n < buf.length) {
        const b = buf[n];
        b.d = d;
        b.t = t;
        b.i = i;
      } else buf.push({ d, t, i });
      n++;
    };
    for (let ty = minTy; ty <= maxTy; ty++)
      for (let tx = minTx; tx <= maxTx; tx++) {
        const tile = map.tiles[ty * map.w + tx];
        if (tile === Tile.Tree || tile === Tile.Pillar || (tile === Tile.Rock && (!lair || this.touchesFloor(run, tx, ty)))) push((tx + ty + 1) * TILE, 0, ty * map.w + tx);
      }
    run.enemies.forEach((e, i) => {
      if (e.dead) return;
      const sx = this.px(e.x, e.y);
      const sy = this.py(e.x, e.y);
      if (sx < -150 || sx > w + 150 || sy < -150 || sy > h + 150) return;
      push(e.x + e.y, 1, i);
    });
    run.chests.forEach((c, i) => {
      if (!c.opened) push(c.x + c.y, 2, i);
    });
    run.shrines.forEach((s, i) => push(s.x + s.y, 3, i));
    push(run.x + run.y, 4, 0);
    const list = buf.slice(0, n).sort((a, b) => a.d - b.d);
    for (const it of list) {
      if (it.t === 0) {
        const tx = it.i % map.w;
        const ty = (it.i / map.w) | 0;
        const x = (tx + 0.5) * TILE;
        const y = (ty + 0.5) * TILE;
        const v = (map.variant[it.i] * 5 + tx * 3 + ty * 11) & 15;
        const sx = this.px(x, y);
        const sy = this.py(x, y);
        // trees in front of the hero fade so you never lose yourself
        const front = x + y > run.x + run.y && Math.abs(sx - w / 2) < 40 && sy - h * 0.54 < 90 && sy > h * 0.5;
        const alpha = front ? 0.45 : 1;
        if (lair) {
          if (map.tiles[it.i] === Tile.Pillar) {
            const img = PX.brazier(LAIR_ROCK, Math.floor(time * 8 + tx * 3) % 3);
            this.blit(ctx, img, sx, sy, img.width >> 1, img.height - 1);
          } else {
            const img = PX.wallBlock(LAIR_ROCK, v & 3);
            this.blit(ctx, img, sx, sy, img.width >> 1, PX.TILE_H / 2, false, alpha);
            // torches on walls that face into the room
            const side = this.torchSide(run, tx, ty);
            if (side) {
              const t = SP.torch(Math.floor(time * 7 + tx * 5 + ty * 3) & 3);
              this.blit(ctx, t, sx + side * (PX.TILE_W / 4) * B, sy + 13 * B, t.width >> 1, t.height - 1, false, alpha);
            }
          }
        } else if (map.tiles[it.i] === Tile.Tree) {
          const img = v % 4 === 3 ? PX.pineTree(0, v % 4) : PX.leafyTree(0, v % 4);
          this.blit(ctx, PX.shadowSprite(22), sx, sy, 11, 4, false, alpha);
          this.blit(ctx, img, sx, sy + 4 * B, img.width >> 1, img.height - 1, (v & 4) !== 0, alpha);
        } else {
          const img = PX.boulder('#7a7266', v & 3, true);
          this.blit(ctx, PX.shadowSprite(24), sx, sy + 2 * B, 12, 4, false, alpha);
          this.blit(ctx, img, sx, sy + 3 * B, img.width >> 1, img.height - 1, (v & 8) !== 0, alpha);
        }
      } else if (it.t === 1) this.drawEnemy(run.enemies[it.i], time);
      else if (it.t === 2) {
        const c = run.chests[it.i];
        const sx = this.px(c.x, c.y);
        const sy = this.py(c.x, c.y);
        const img = SP.chest(false, c.free);
        this.blit(ctx, PX.shadowSprite(16), sx, sy + B, 8, 3);
        this.blit(ctx, img, sx, sy, img.width >> 1, img.height - 1);
        // price tag
        if (!c.free) {
          const near = Math.hypot(c.x - run.x, c.y - run.y) < 260;
          if (near) {
            this.overT();
            o.font = `600 12px ${FONT}`;
            o.textAlign = 'center';
            o.textBaseline = 'bottom';
            o.fillStyle = run.gold >= run.chestCost ? '#ffd166' : '#c76b5a';
            text(o, `${run.chestCost} gold`, sx, sy - img.height * B - 4);
          }
        }
      } else if (it.t === 3) {
        const s = run.shrines[it.i];
        const sx = this.px(s.x, s.y);
        const sy = this.py(s.x, s.y);
        const img = SP.shrine(s.used, Math.floor(time * 3) & 1);
        this.blit(ctx, PX.shadowSprite(14), sx, sy + B, 7, 3);
        this.blit(ctx, img, sx, sy, img.width >> 1, img.height - 1);
      } else this.drawHero(run, time, hz);
    }

    // ---- projectiles + air effects (crisp) ----
    this.screenT(f);
    for (const s of run.shots) {
      if (s.life <= 0) continue;
      const sx = this.px(s.x, s.y);
      const sy = this.py(s.x, s.y, 22);
      if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
      if (s.kind === 'arrow') {
        const d = this.screenDir(Math.atan2(s.vy, s.vx));
        const L = 9 * B;
        f.strokeStyle = '#1b1410';
        f.lineWidth = 3 * B;
        f.beginPath();
        f.moveTo(sx - d.dx * L, sy - d.dy * L);
        f.lineTo(sx + d.dx * L * 0.4, sy + d.dy * L * 0.4);
        f.stroke();
        f.strokeStyle = s.color;
        f.lineWidth = B;
        f.stroke();
        f.fillStyle = '#ffffff';
        f.fillRect(sx + d.dx * L * 0.4 - B, sy + d.dy * L * 0.4 - B, 2 * B, 2 * B);
      }
    }
    // rain zones: arrows dropping all over the patch, each on its own timing
    for (const pz of run.pools) {
      if (pz.style !== 'rain') continue;
      const col = run.weapons[pz.w]?.def.color ?? '#e0c08a';
      const left = Math.min(1, (pz.until - run.t) * 3);
      for (let k = 0; k < 10; k++) {
        const cyc = time * 2.6 + k * 0.137 + pz.x * 0.001;
        const ph = cyc % 1;
        const seed = Math.floor(cyc) * 7919 + k * 104729 + Math.floor(pz.x);
        const ang = ((seed % 628) / 100);
        const rad = pz.r * Math.sqrt(((seed >> 3) % 100) / 100);
        const wx = pz.x + Math.cos(ang) * rad;
        const wy = pz.y + Math.sin(ang) * rad;
        const ax = this.px(wx, wy);
        const gy = this.py(wx, wy);
        const ay = gy - (1 - ph) * 70 * B;
        f.globalAlpha = left;
        f.strokeStyle = '#1b1410';
        f.lineWidth = 3 * B;
        f.beginPath();
        f.moveTo(ax - 2 * B, ay - 9 * B);
        f.lineTo(ax, ay);
        f.stroke();
        f.strokeStyle = col;
        f.lineWidth = B;
        f.stroke();
        if (ph > 0.85) {
          f.fillStyle = '#e8d7a9';
          f.fillRect(ax - 2 * B, gy - B, B, B);
          f.fillRect(ax + B, gy - B, B, B);
        }
      }
    }
    f.globalAlpha = 1;
    for (const e of run.fx) {
      const p = e.t / e.dur;
      if (e.kind === 'zap' && e.text === 'arrows') {
        // a few arrows dropping onto the spot
        const sx = this.px(e.x, e.y);
        const sy = this.py(e.x, e.y);
        f.globalAlpha = 1 - p;
        for (let i = 0; i < 4; i++) {
          const ax = sx + ((i * 37) % 9 - 4) * 3 * B;
          const ay = sy - (1 - Math.min(1, p * 2.5 + i * 0.08)) * 90 * B + ((i * 13) % 5) * B;
          f.strokeStyle = '#1b1410';
          f.lineWidth = 3 * B;
          f.beginPath();
          f.moveTo(ax, ay - 10 * B);
          f.lineTo(ax, ay);
          f.stroke();
          f.strokeStyle = e.color;
          f.lineWidth = B;
          f.stroke();
        }
      } else if (e.kind === 'zap' && e.text === 'pillar') {
        // a column of light from the sky
        const sx = this.px(e.x, e.y);
        const sy = this.py(e.x, e.y);
        const wdt = Math.max(4, e.r * this.k * 0.6) * (1 - p * 0.7);
        f.globalAlpha = 0.8 * (1 - p);
        f.fillStyle = e.color;
        f.fillRect(sx - wdt, sy - 140 * B, wdt * 2, 140 * B);
        f.fillStyle = '#ffffff';
        f.fillRect(sx - wdt * 0.35, sy - 140 * B, wdt * 0.7, 140 * B);
      } else if (e.kind === 'zap') {
        const sx = this.px(e.x, e.y);
        const sy = this.py(e.x, e.y);
        f.globalAlpha = 1 - p;
        f.strokeStyle = '#1b1410';
        f.lineWidth = 4 * B;
        f.beginPath();
        let x = sx + 10 * B;
        f.moveTo(x, sy - 120 * B);
        for (let i = 1; i <= 5; i++) {
          x = sx + (i === 5 ? 0 : (((i * 7919 + Math.floor(e.x)) % 13) - 6) * B);
          f.lineTo(x, sy - 120 * B + i * 24 * B);
        }
        f.stroke();
        f.strokeStyle = e.color;
        f.lineWidth = 2 * B;
        f.stroke();
        f.strokeStyle = '#ffffff';
        f.lineWidth = B;
        f.stroke();
      }
    }
    f.globalAlpha = 1;
    this.flushFx();
    this.screenT(ctx);
    for (const s of run.shots) {
      if (s.life <= 0 || s.kind === 'arrow') continue;
      const sx = this.px(s.x, s.y);
      const sy = this.py(s.x, s.y, s.enemy ? 18 : 24);
      if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
      if (s.kind === 'bolt') {
        const img = SP.bolt();
        this.blit(ctx, img, sx, sy, 2, 2);
        // little ember trail
        ctx.fillStyle = '#ff8c42';
        const d = this.screenDir(Math.atan2(s.vy, s.vx));
        for (let i = 1; i <= 3; i++) ctx.fillRect(Math.round((sx - d.dx * i * 4 * B) / B) * B, Math.round((sy - d.dy * i * 4 * B) / B) * B, B, B);
      } else if (s.kind === 'axe') {
        const img = SP.axe();
        ctx.save();
        ctx.translate(Math.round(sx / B) * B, Math.round(sy / B) * B);
        ctx.rotate(Math.round((time * 14) / (Math.PI / 4)) * (Math.PI / 4));
        const sc = Math.max(1, Math.round(s.area));
        ctx.drawImage(img, (-img.width / 2) * B * sc, (-img.height / 2) * B * sc, img.width * B * sc, img.height * B * sc);
        ctx.restore();
      } else {
        const img = SP.orb(s.color);
        const sc = s.r > 14 ? 2 : 1;
        ctx.drawImage(img, Math.round(sx / B - img.width * sc / 2) * B, Math.round(sy / B - img.height * sc / 2) * B, img.width * B * sc, img.height * B * sc);
      }
    }
    // orbiting blades
    for (const wpn of run.weapons) {
      if (wpn.def.kind !== 'orbit' || run.t >= wpn.orbitUntil) continue;
      const area = wpn.area * (1 + run.stats.area);
      const cnt = wpn.count + run.stats.count;
      const R = 130 * area;
      const img = wpn.def.id === 'orbs' ? SP.orb(wpn.def.color) : SP.blade();
      const sc = area > 1.6 ? 2 : 1;
      for (let b = 0; b < cnt; b++) {
        const a = wpn.orbitA + (b / cnt) * Math.PI * 2;
        const bx = run.x + Math.cos(a) * R;
        const by = run.y + Math.sin(a) * R;
        const sx = this.px(bx, by);
        const sy = this.py(bx, by, 26);
        ctx.drawImage(img, Math.round(sx / B - (img.width * sc) / 2) * B, Math.round(sy / B - (img.height * sc) / 2) * B, img.width * B * sc, img.height * B * sc);
      }
    }

    // meteor rocks in the air
    for (const m of run.falling) {
      const p = m.t / m.dur;
      const sx = this.px(m.x, m.y) + (1 - p) * 60 * B;
      const sy = this.py(m.x, m.y, (1 - p) * 520);
      const img = SP.bolt();
      ctx.drawImage(img, Math.round(sx / B - img.width) * B, Math.round(sy / B - img.height) * B, img.width * 2 * B, img.height * 2 * B);
    }
    // wolves
    for (const a of run.allies) {
      const sx = this.px(a.x, a.y);
      const sy = this.py(a.x, a.y);
      const img = PX.spirit(run.weapons[a.w]?.def.color ?? '#b9c7d6', Math.floor(time * 6 + a.x) % 3);
      this.blit(ctx, PX.shadowSprite(10), sx, sy + B, 5, 3);
      this.blit(ctx, img, sx, sy - (a.moving ? Math.abs(Math.sin(time * 14 + a.x)) * 2 * B : 0), img.width >> 1, img.height - 1);
    }

    // ---- overlay: damage numbers, elite bars ----
    this.overT();
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    for (const e of run.fx) {
      if (e.kind !== 'text') continue;
      const p = e.t / e.dur;
      o.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
      o.font = `600 ${e.crit ? 15 : 11}px ${FONT}`;
      o.fillStyle = e.color;
      text(o, e.text!, this.px(e.x, e.y), this.py(e.x, e.y, 50 + p * 40));
    }
    o.globalAlpha = 1;
    this.drawMinimap(run);
  }

  /** Which face of a lair wall gets a torch: -1 left face (room toward +y), 1 right face (room toward +x), 0 none. */
  private torchSide(run: Run, tx: number, ty: number): number {
    const m = run.map;
    if (m.tiles[ty * m.w + tx] !== Tile.Rock || (tx * 3 + ty * 5) % 4 !== 0) return 0;
    const floor = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && (m.tiles[y * m.w + x] === Tile.Floor || m.tiles[y * m.w + x] === Tile.Altar);
    if (floor(tx, ty + 1)) return -1;
    if (floor(tx + 1, ty)) return 1;
    return 0;
  }

  private touchesFloor(run: Run, tx: number, ty: number): boolean {
    const m = run.map;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const t = m.tiles[y * m.w + x];
        if (t === Tile.Floor || t === Tile.Altar) return true;
      }
    return false;
  }

  private drawEnemy(e: Enemy, time: number) {
    const ctx = this.ctx;
    const B = this.block;
    const grow = e.spawnT > 0 ? 1 - e.spawnT / 0.6 : 1;
    if (grow <= 0.05) return;
    const sx = this.px(e.x, e.y);
    const sy0 = this.py(e.x, e.y);
    const sy = this.py(e.x, e.y, e.z);
    const r = Math.max(3, Math.round(e.r * 0.27 * grow));
    const frame = Math.round(Math.sin(time * (e.def ? 9 : 5) + e.id));
    const charging = e.move === 'charge' && e.moveT >= 0.55;
    const img = PX.slime(e.color, r, frame, e.hitFlash > 0 ? 'hit' : charging ? 'wind' : '');
    this.blit(ctx, PX.shadowSprite(Math.max(8, r * 2)), sx, sy0 + B, Math.max(8, r * 2) >> 1, 3);
    this.blit(ctx, img, sx, sy + B, img.width >> 1, img.height - 1);
    const top = sy - (img.height - 2) * B;
    const d = this.screenDir(e.angle);
    if (d.dy > -0.5) {
      ctx.fillStyle = e.boss || e.elite ? '#ffdd00' : '#1b1410';
      const ex = Math.round(sx / B + d.dx * r * 0.35);
      const ey = Math.round(top / B + img.height * 0.45 + d.dy);
      const gap = Math.max(1, Math.round(r * 0.35));
      const eh = r > 8 ? 2 : 1;
      ctx.fillRect((ex - gap) * B, ey * B, B, eh * B);
      ctx.fillRect((ex + gap) * B, ey * B, B, eh * B);
    }
    if (e.boss === 3) {
      if (e.name === JELLY.name) {
        const c = PX.crown();
        this.blit(ctx, c, sx, top - B, c.width >> 1, c.height);
      }
    } else if (e.boss) {
      const hl = PX.horn(false);
      const hr = PX.horn(true);
      this.blit(ctx, hl, sx - r * 0.55 * B, top + 2 * B, hl.width, hl.height);
      this.blit(ctx, hr, sx + r * 0.55 * B, top + 2 * B, 0, hr.height);
      if (e.boss === 2) {
        const c = PX.crown();
        this.blit(ctx, c, sx, top - B, c.width >> 1, c.height);
      }
    } else if (e.elite) {
      const c = PX.crown();
      this.blit(ctx, c, sx, top, c.width >> 1, c.height);
      this.overT();
      const bw = 34;
      bar(this.octx, sx - bw / 2, top - 10, bw, 4, e.hp / e.maxHp, '#e0b84a');
    }
  }

  private drawHero(run: Run, time: number, hz: number) {
    const o = this.octx;
    const B = this.block;
    this.overT();
    const sx = this.px(run.x, run.y) + this.fracX * 0;
    const sy = this.py(run.x, run.y);
    const lift = hz * this.k;
    const dir = this.screenDir(run.angle);
    if (dir.dy < -0.3) this.face.back = true;
    else if (dir.dy > 0.1) this.face.back = false;
    if (dir.dx < -0.25) this.face.flip = true;
    else if (dir.dx > 0.25) this.face.flip = false;
    const { back, flip } = this.face;
    const frame = run.air > 0 ? 1 : run.moving ? [1, 0, 2, 0][Math.floor(time * 9) % 4] : 0;
    const blink = run.iframes > 0 && run.hurtFlash < 0 && Math.floor(time * 20) % 2 === 0;
    const img = PX.hero(run.job, back, frame, run.hurtFlash > 0);
    const sw = Math.max(8, 12 - Math.round(lift / B / 6));
    this.blit(o, PX.shadowSprite(sw), sx, sy + B, sw >> 1, 3);
    const wp = PX.weapon(run.job);
    const hy = sy - lift;
    const drawWeapon = () => {
      o.save();
      const a = Math.atan2(dir.dy, dir.dx);
      if (run.job === 'mage') {
        o.drawImage(wp, (sx / B + (flip ? -7 : 5)) * B, (hy / B - wp.height - 4) * B, wp.width * B, wp.height * B);
      } else {
        o.translate(sx + dir.dx * (run.job === 'warrior' ? 4 : 6) * B, hy - 9 * B);
        o.rotate(a);
        o.drawImage(wp, -2 * B, -(wp.height >> 1) * B, wp.width * B, wp.height * B);
      }
      o.restore();
    };
    if (back) drawWeapon();
    this.blit(o, img, sx, hy, img.width >> 1, img.height - 1, flip, blink ? 0.4 : 1);
    if (!back) drawWeapon();
    // HP bar under the feet
    bar(o, sx - 18, sy + 6, 36, 4, run.hp / run.stats.maxHp, run.hp < run.stats.maxHp * 0.3 ? '#e04848' : '#4caf50');
    // Mana Shield
    const smax = run.sp('shield');
    if (smax > 0 && run.shield > 0) bar(o, sx - 18, sy + 11, 36, 2, run.shield / smax, '#8fd3ff');
    // jump cooldown pip
    if (run.jumpCd > 0 && run.air <= 0) {
      o.fillStyle = 'rgba(232,215,169,0.6)';
      o.fillRect(sx - 18, sy + 11, 36 * (1 - run.jumpCd / RUN.jumpRest), 2);
    }
  }

  private drawMinimap(run: Run) {
    const o = this.octx;
    const size = this.touch || this.w < 720 ? 92 : 132;
    const x0 = this.w - size - 12;
    const y0 = this.touch || this.w < 720 ? 74 : 12;
    const n = run.map.w;
    if (!this.mini || this.mini.dataset.seed !== String(run.map.tiles.length + run.map.variant[5])) {
      const c = document.createElement('canvas');
      c.width = n;
      c.height = n;
      const x = c.getContext('2d')!;
      for (let ty = 0; ty < n; ty++)
        for (let tx = 0; tx < n; tx++) {
          const t = run.map.tiles[ty * n + tx];
          x.fillStyle = t === Tile.Tree ? '#1f3a17' : t === Tile.Rock ? '#5c574e' : (tx + ty) & 1 ? '#3d6125' : '#41672a';
          x.fillRect(tx, ty, 1, 1);
        }
      c.dataset.seed = String(run.map.tiles.length + run.map.variant[5]);
      this.mini = c;
    }
    this.overT(false);
    o.fillStyle = '#0b0806';
    o.fillRect(x0 - 3, y0 - 3, size + 6, size + 6);
    o.fillStyle = '#c9a227';
    o.fillRect(x0 - 2, y0 - 2, size + 4, size + 4);
    o.fillStyle = '#0b0806';
    o.fillRect(x0 - 1, y0 - 1, size + 2, size + 2);
    o.imageSmoothingEnabled = false;
    o.drawImage(this.mini, x0, y0, size, size);
    const s = size / (run.map.w * TILE);
    const dot = (wx: number, wy: number, c: string, r: number) => {
      o.fillStyle = '#0b0806';
      o.fillRect(Math.round(x0 + wx * s - r - 1), Math.round(y0 + wy * s - r - 1), r * 2 + 2, r * 2 + 2);
      o.fillStyle = c;
      o.fillRect(Math.round(x0 + wx * s - r), Math.round(y0 + wy * s - r), r * 2, r * 2);
    };
    for (const sh of run.shrines) if (!sh.used) dot(sh.x, sh.y, '#8fd3ff', 2);
    if (!run.inLair && !run.lairCleared) dot(run.lairDoor.x, run.lairDoor.y, '#6ccf5a', 3);
    for (const c of run.chests) if (!c.opened) dot(c.x, c.y, c.free ? '#fff1a8' : '#e0b84a', 1.5);
    for (const e of run.enemies) if (!e.dead && (e.elite || e.boss)) dot(e.x, e.y, e.boss ? '#ff3b3b' : '#e0b84a', e.boss ? 3 : 2);
    dot(run.x, run.y, '#ffffff', 2);
  }
}

const LAIR_ROCK = '#6b6b5e';

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number) {
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(0,0,0,0.9)';
  c.strokeText(s, x, y);
  c.fillText(s, x, y);
}

function bar(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: number, color: string) {
  x = Math.round(x);
  y = Math.round(y);
  c.fillStyle = '#0b0806';
  c.fillRect(x - 1, y - 1, w + 2, h + 2);
  c.fillStyle = '#3a2a20';
  c.fillRect(x, y, w, h);
  c.fillStyle = color;
  c.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, p))), h);
}

export const RARITY_COLOR = Object.fromEntries(RUN_RARITIES.map((r) => [r.id, r.color]));
