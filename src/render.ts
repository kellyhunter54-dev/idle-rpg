import { BALANCE, CHAPTERS, SPLIT, phaseAt, COMPANION, JOBS, JobDef, JobId, ZONES, levelColor } from './data';
import { Game, Mob, Telegraph, Vec } from './game';
import { TILE, Tile } from './map';
import * as PX from './pixel';

/**
 * Isometric renderer. Ground-level things (tiles, telegraphs, spell circles) are drawn in world
 * coordinates through an isometric canvas transform; standing things (trees, rocks, characters)
 * are drawn upright at their projected position, sorted back to front.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private k = 0.6; // zoom: screen pixels per world unit
  private ox = 0; // screen position of world origin
  private oy = 0;
  private camX = 0;
  private camY = 0;
  private camInit = false;
  private touch = false;
  /** Crisp layer on top of the (possibly low-res) world: text, bars, boss bar, minimap. */
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private odpr = 1;
  /** Scratch canvas: vector layers are drawn here, then snapped to hard pixels (pixel art). */
  private fx: HTMLCanvasElement | null = null;
  private fxSaved: CanvasRenderingContext2D | null = null;
  /** Pixel art: CSS px per game pixel (1 in classic mode). */
  private block = 1;
  /** Pixel art: the world canvas is 1 game pixel bigger on every side and slid by the camera's
   * leftover fraction of a pixel (smooth scrolling); margin and fraction in CSS px. */
  private margin = 0;
  private fracX = 0;
  private fracY = 0;
  private lastShift = '';
  private vignette: HTMLCanvasElement | null = null;
  private vignetteKey = '';
  private lastTime = 0;
  /** Pixel hero facing, with hysteresis so tiny direction changes don't flip the sprite. */
  private face = { back: false, flip: false };
  /** Phones and narrow screens use a stacked HUD layout. */
  private get compact(): boolean {
    return this.touch || this.w < 720;
  }

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.overlay = document.createElement('canvas');
    this.overlay.id = 'overlay';
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    canvas.insertAdjacentElement('afterend', this.overlay);
    this.octx = this.overlay.getContext('2d')!;
    // Shrinking effects can produce tiny negative radii; canvas throws on those, so clamp.
    const arc = this.ctx.arc.bind(this.ctx);
    this.ctx.arc = (x, y, r, a0, a1, ccw) => arc(x, y, Math.max(0, r), a0, a1, ccw);
    const ellipse = this.ctx.ellipse.bind(this.ctx);
    this.ctx.ellipse = (x, y, rx, ry, rot, a0, a1, ccw) => ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, a0, a1, ccw);
    const oarc = this.octx.arc.bind(this.octx);
    this.octx.arc = (x, y, r, a0, a1, ccw) => oarc(x, y, Math.max(0, r), a0, a1, ccw);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    window.addEventListener('pixelmode', () => this.resize());
  }

  /** Pixel art (default; Info > Testing tools switches to the classic art): the world is drawn at a low resolution and scaled up with hard edges. */
  private get pixel(): boolean {
    try {
      return localStorage.getItem('idle-rpg-pixel') !== '0';
    } catch {
      return true;
    }
  }

  private resize() {
    const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    if (this.pixel) {
      // about 380 game pixels across, each drawn as a crisp block
      const block = Math.max(2, Math.round(r.width / 380));
      this.block = block;
      this.dpr = 1 / block;
      this.canvas.style.imageRendering = 'pixelated';
    } else {
      this.block = 1;
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.style.imageRendering = '';
    }
    this.odpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.round(r.width * this.odpr);
    this.overlay.height = Math.round(r.height * this.odpr);
    const st = this.canvas.style;
    if (this.pixel) {
      const M = this.block;
      this.margin = M;
      st.position = 'absolute';
      st.left = `${-M}px`;
      st.top = `${-M}px`;
      st.width = `${r.width + 2 * M}px`;
      st.height = `${r.height + 2 * M}px`;
      this.canvas.width = Math.max(1, Math.round((r.width + 2 * M) * this.dpr));
      this.canvas.height = Math.max(1, Math.round((r.height + 2 * M) * this.dpr));
    } else {
      this.margin = 0;
      st.position = st.left = st.top = st.width = st.height = st.transform = '';
      this.lastShift = '';
      this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    }
    this.ctx.imageSmoothingEnabled = !this.pixel;
    this.octx.imageSmoothingEnabled = !this.pixel;
    this.touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.vignetteKey = '';
  }

  /** The darkened screen edges, pre-rendered once per size instead of a gradient every frame. */
  private getVignette(lair: boolean): HTMLCanvasElement {
    const key = `${this.w}x${this.h}:${lair}`;
    if (this.vignette && this.vignetteKey === key) return this.vignette;
    const c = this.vignette ?? document.createElement('canvas');
    // half resolution is plenty for a soft gradient
    c.width = Math.max(1, Math.round(this.w / 2));
    c.height = Math.max(1, Math.round(this.h / 2));
    const x = c.getContext('2d')!;
    const w = c.width;
    const h = c.height;
    const vg = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, lair ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.6)');
    x.clearRect(0, 0, w, h);
    x.fillStyle = vg;
    x.fillRect(0, 0, w, h);
    this.vignette = c;
    this.vignetteKey = key;
    return c;
  }

  // ---- projection ----
  private px(x: number, y: number) {
    return this.ox + (x - y) * this.k;
  }
  private py(x: number, y: number, z = 0) {
    return this.oy + (x + y) * this.k * 0.5 - z * this.k;
  }
  /** Screen (CSS px inside the canvas) to world ground point. */
  screenToWorld(sx: number, sy: number): Vec {
    const X = sx - this.ox - this.fracX;
    const Y = sy - this.oy - this.fracY;
    return { x: (X + 2 * Y) / (2 * this.k), y: (2 * Y - X) / (2 * this.k) };
  }
  /** Converts a world direction to its on-screen direction (for facing / weapons). */
  private screenDir(angle: number) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = c - s;
    const dy = (c + s) * 0.5;
    const l = Math.hypot(dx, dy) || 1;
    return { dx: dx / l, dy: dy / l };
  }
  private groundTransform() {
    const k = this.k;
    const M = this.margin;
    this.ctx.setTransform(k * this.dpr, (k / 2) * this.dpr, -k * this.dpr, (k / 2) * this.dpr, (this.ox + M) * this.dpr, (this.oy + M) * this.dpr);
  }
  private screenTransform() {
    if (this.ctx === this.octx) {
      // overlay: world-anchored things slide with the world (fraction of a pixel); the HUD doesn't
      const d = this.odpr;
      this.ctx.setTransform(d, 0, 0, d, this.overlayWorld ? this.fracX * d : 0, this.overlayWorld ? this.fracY * d : 0);
    } else {
      const d = this.dpr;
      const M = this.margin;
      this.ctx.setTransform(d, 0, 0, d, M * d, M * d);
    }
  }
  private overlayWorld = true;
  /** Run drawing code on the crisp overlay layer. */
  private onOverlay(fn: () => void, world = true) {
    const saved = this.ctx;
    const savedWorld = this.overlayWorld;
    this.ctx = this.octx;
    this.overlayWorld = world;
    this.screenTransform();
    fn();
    this.overlayWorld = savedWorld;
    this.ctx = saved;
    if (saved !== this.octx) this.ctx = saved;
  }
  /** Start drawing vector shapes onto the scratch canvas (pixel art only). */
  private beginCrisp() {
    if (!this.pixel) return;
    const c = this.canvas;
    if (!this.fx) {
      this.fx = document.createElement('canvas');
      const fc = this.fx.getContext('2d', { willReadFrequently: true })!;
      const arc = fc.arc.bind(fc);
      fc.arc = (x, y, r, a0, a1, ccw) => arc(x, y, Math.max(0, r), a0, a1, ccw);
      const ell = fc.ellipse.bind(fc);
      fc.ellipse = (x, y, rx, ry, rot, a0, a1, ccw) => ell(x, y, Math.max(0, rx), Math.max(0, ry), rot, a0, a1, ccw);
    }
    if (this.fx.width !== c.width || this.fx.height !== c.height) {
      this.fx.width = c.width;
      this.fx.height = c.height;
    }
    const f = this.fx.getContext('2d', { willReadFrequently: true })!;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, this.fx.width, this.fx.height);
    this.fxSaved = this.ctx;
    this.ctx = f;
    this.screenTransform();
  }
  /**
   * Snap the scratch canvas to hard pixels (alpha in a few steps, no soft edges) and paste it
   * onto the world. Optional region in CSS px keeps it cheap for single objects.
   */
  private endCrisp(rx = 0, ry = 0, rw = this.w, rh = this.h) {
    if (!this.pixel || !this.fx || !this.fxSaved) return;
    const t0 = performance.now();
    const f = this.ctx;
    this.ctx = this.fxSaved;
    this.fxSaved = null;
    const d = this.dpr;
    const M = this.margin;
    const full = rx === 0 && ry === 0 && rw === this.w && rh === this.h;
    const x0 = full ? 0 : Math.max(0, Math.floor((rx + M) * d));
    const y0 = full ? 0 : Math.max(0, Math.floor((ry + M) * d));
    const x1 = full ? this.fx.width : Math.min(this.fx.width, Math.ceil((rx + rw + M) * d));
    const y1 = full ? this.fx.height : Math.min(this.fx.height, Math.ceil((ry + rh + M) * d));
    if (x1 <= x0 || y1 <= y0) return;
    const img = f.getImageData(x0, y0, x1 - x0, y1 - y0);
    const a = img.data;
    for (let i = 3; i < a.length; i += 4) {
      const v = a[i];
      if (!v) continue;
      a[i] = v < 24 ? 0 : v < 96 ? 64 : v < 160 ? 128 : v < 224 ? 192 : 255;
    }
    f.putImageData(img, x0, y0);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fx, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    const perf = (window as unknown as { __perf?: { crisp?: number } }).__perf;
    if (perf) perf.crisp = (perf.crisp ?? 0) * 0.95 + (performance.now() - t0) * 0.05 * 3; // ~3 calls a frame
  }
  /** Draw one vector object crisply (region around it in CSS px). */
  private crisp(fn: () => void, sx: number, sy: number, halfW: number, up: number, down: number) {
    if (!this.pixel) return fn();
    this.beginCrisp();
    fn();
    this.endCrisp(sx - halfW, sy - up, halfW * 2, up + down);
  }

  /** Draw a pixel sprite with its anchor (ax, ay in sprite pixels) at screen point (sx, sy), snapped to the pixel grid. */
  private blit(img: HTMLCanvasElement, sx: number, sy: number, ax: number, ay: number, flip = false, alpha = 1) {
    const B = this.block;
    // on the overlay (the pixel hero) draw at the exact spot so it stays perfectly still on screen
    const snap = this.ctx === this.octx ? (v: number) => v : Math.round;
    const gx = snap(sx / B) - (flip ? img.width - ax : ax);
    const gy = snap(sy / B) - ay;
    const ctx = this.ctx;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    if (flip) {
      ctx.save();
      ctx.translate((gx + img.width) * B, gy * B);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, img.width * B, img.height * B);
      ctx.restore();
    } else ctx.drawImage(img, gx * B, gy * B, img.width * B, img.height * B);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  draw(g: Game, time: number) {
    const { ctx, w, h } = this;
    if (w === 0 || h === 0) return;
    const lair = g.map.kind !== 'world'; // lairs and caves are dark interiors
    const chOf = (tx: number) =>
      CHAPTERS[g.map.palette ?? ZONES[Math.min(ZONES.length - 1, Math.floor(tx / g.map.zoneW))].chapter];
    const p = g.player;

    // zoom: scales with the screen but stays close, about 8-10 tiles across
    // pixel art: a fixed 0.25 game px per world unit (a tile is a 32x16 diamond)
    this.k = this.pixel ? 0.25 * this.block : Math.max(0.55, Math.min(1.05, Math.min(w / 1050, h / 640)));
    if (!this.camInit || Math.hypot(p.x - this.camX, p.y - this.camY) > 900) {
      this.camX = p.x;
      this.camY = p.y;
      this.camInit = true;
    }
    // frame-rate independent smoothing, so the camera never judders when frame times vary
    const fdt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    // pixel art locks the camera to the hero, so the hero never jitters against the world
    const follow = this.pixel ? 1 : 1 - Math.exp(-fdt * 9);
    this.camX += (p.x - this.camX) * follow;
    this.camY += (p.y - this.camY) * follow;
    const centerY = this.touch ? h * 0.42 : h * 0.52;
    this.ox = w / 2 - (this.camX - this.camY) * this.k;
    this.oy = centerY - (this.camX + this.camY) * this.k * 0.5;
    this.fracX = this.fracY = 0;
    if (this.pixel) {
      // draw the world on whole game pixels, then slide the canvas by the leftover fraction:
      // smooth scrolling with crisp pixels (whole-pixel steps alone looked jerky)
      const B = this.block;
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
    }
    this.octx.setTransform(1, 0, 0, 1, 0, 0);
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.octx.setTransform(this.odpr, 0, 0, this.odpr, this.fracX * this.odpr, this.fracY * this.odpr);
    textLayer = this.pixel ? this.octx : null;
    const pixel = this.pixel;
    const chIdx = (tx: number) => g.map.palette ?? ZONES[Math.min(ZONES.length - 1, Math.floor(tx / g.map.zoneW))].chapter;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0a08';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.screenTransform();

    // ---- visible tile range ----
    // x is smallest at the top-left corner and largest at the bottom-right; y is smallest top-right
    const tl = this.screenToWorld(0, -80);
    const tr = this.screenToWorld(w, -80);
    const bl = this.screenToWorld(0, h + 120);
    const br = this.screenToWorld(w, h + 120);
    const minTx = Math.max(0, Math.floor(tl.x / TILE) - 1);
    const maxTx = Math.min(g.map.w - 1, Math.ceil(br.x / TILE) + 1);
    const minTy = Math.max(0, Math.floor(tr.y / TILE) - 1);
    const maxTy = Math.min(g.map.h - 1, Math.ceil(bl.y / TILE) + 1);

    // ---- floor ----
    if (pixel) {
      this.screenTransform();
      for (let ty = minTy; ty <= maxTy; ty++)
        for (let tx = minTx; tx <= maxTx; tx++) {
          const i = ty * g.map.w + tx;
          if (lair && g.map.tiles[i] === Tile.Rock) continue;
          const cx = (tx + 0.5) * TILE;
          const cy = (ty + 0.5) * TILE;
          const v = (g.map.variant[i] * 3 + tx * 7 + ty * 13) & 15;
          const img = lair ? PX.stoneTile(chOf(tx).rock, v & 3) : PX.groundTile(chIdx(tx), v, tx, ty);
          this.blit(img, this.px(cx, cy), this.py(cx, cy), PX.TILE_W / 2, PX.TILE_H / 2);
        }
      this.groundTransform();
    } else {
    this.groundTransform();
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const i = ty * g.map.w + tx;
        const v = g.map.variant[i];
        const tc = chOf(tx);
        if (lair) {
          // lairs: dark flagstones
          if (g.map.tiles[i] === Tile.Rock) continue;
          ctx.fillStyle = shade((tx + ty) % 2 === 0 ? tc.floor[0] : tc.floor[1], -0.55);
        } else ctx.fillStyle = (tx + ty) % 2 === 0 ? tc.floor[0] : tc.floor[1];
        ctx.fillRect(tx * TILE, ty * TILE, TILE + 0.5, TILE + 0.5);
        if (v === 0) {
          // little tufts / pebbles for texture
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(tx * TILE + 18, ty * TILE + 22, 6, 6);
          ctx.fillRect(tx * TILE + 40, ty * TILE + 38, 5, 5);
        } else if (v === 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(tx * TILE + 10, ty * TILE + 44, 10, 4);
        }
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let tx = minTx; tx <= maxTx + 1; tx++) {
      ctx.moveTo(tx * TILE, minTy * TILE);
      ctx.lineTo(tx * TILE, (maxTy + 1) * TILE);
    }
    for (let ty = minTy; ty <= maxTy + 1; ty++) {
      ctx.moveTo(minTx * TILE, ty * TILE);
      ctx.lineTo((maxTx + 1) * TILE, ty * TILE);
    }
    ctx.stroke();
    }

    // ---- ground layer: telegraphs, spell circles, shadows ----
    this.beginCrisp();
    this.groundTransform();
    this.drawAltars(g, time);
    if (g.travelGoal) this.drawGoal(g.travelGoal, time);
    this.drawGoo(g, time);
    for (const t of g.telegraphs) this.drawTelegraph(t, g);
    this.drawGroundEffects(g);

    // shadows
    {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    const shadow = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (!this.pixel) shadow(p.x, p.y, p.r * 1.1);
    for (const m of g.mobs) shadow(m.x, m.y, m.r * 1.05 * (1 - m.spawnAnim));
    for (const m of g.mobs) {
      if (!m.group || m.id === m.group || m.phase !== 2 || m.hop) continue;
      // wild phase: the minis are powered up
      ctx.fillStyle = `rgba(255,60,60,${0.18 + 0.12 * Math.sin(time * 8 + m.id)})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const m of g.mobs) {
      if (!m.group || m.id !== m.group || !g.mobs.some((o) => o.group === m.group && o !== m)) continue;
      ctx.strokeStyle = 'rgba(255,209,102,0.75)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 1.35 + Math.sin(time * 4) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
    }
    for (const c of g.party) shadow(c.x, c.y, 10);
    }
    this.endCrisp();

    // ---- standing layer, depth-sorted ----
    this.screenTransform();
    type Drawable = { depth: number; draw: () => void };
    const list: Drawable[] = [];
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const tile = g.map.tiles[ty * g.map.w + tx];
        if (tile === Tile.Floor || tile === Tile.Altar) continue;
        if (lair && tile === Tile.Rock && !this.touchesFloor(g, tx, ty)) continue;
        const cx = (tx + 0.5) * TILE;
        const cy = (ty + 0.5) * TILE;
        // fade obstacles that stand in front of the hero
        const sxp = this.px(cx, cy);
        const syp = this.py(cx, cy);
        const front = cx + cy > p.x + p.y && Math.abs(sxp - this.px(p.x, p.y)) < (this.pixel ? 130 : 90) * this.k && syp - this.py(p.x, p.y) < (this.pixel ? 200 : 180) * this.k;
        list.push({
          depth: cx + cy,
          draw: () => {
            const tc = chOf(tx);
            if (tile === Tile.Gate) {
              if (pixel) this.blit(PX.barrier(Math.floor(time * 6 + tx) & 3), this.px(cx, cy), this.py(cx, cy), PX.TILE_W / 2, PX.TILE_H / 2);
              else this.drawGate(cx, cy, time);
            } else if (tile === Tile.Pillar) {
              if (pixel) {
                const img = PX.brazier(tc.rock, Math.floor(time * 8 + tx * 3) % 3);
                this.blit(img, this.px(cx, cy), this.py(cx, cy), img.width >> 1, img.height - 1);
              } else this.drawBrazier(cx, cy, tc.rock, time);
            }
            else if (pixel) this.drawPixelObstacle(tile, cx, cy, chIdx(tx), tc.rock, front, lair, g.map.variant[ty * g.map.w + tx] + tx * 3 + ty * 5);
            else if (tile === Tile.Tree) this.drawTree(cx, cy, tc.tree, front, g.map.variant[ty * g.map.w + tx]);
            else this.drawRock(cx, cy, tc.rock, front);
          },
        });
      }
    }
    const K = this.k;
    if (!lair)
      g.map.altars.forEach((a, z) =>
        list.push({ depth: a.x + a.y + 40, draw: () => this.crisp(() => this.drawLairDoor(g, a, z, time), this.px(a.x, a.y), this.py(a.x, a.y), 110 * K, 230 * K, 60 * K) }),
      );
    if (!lair && g.map.cave) {
      const c = g.map.cave;
      list.push({ depth: c.x + c.y + 40, draw: () => this.crisp(() => this.drawCaveMouth(c, time), this.px(c.x, c.y), this.py(c.x, c.y), 160 * K, 180 * K, 80 * K) });
    }
    if (lair && g.map.exit) {
      const ex = g.map.exit;
      list.push({ depth: ex.x + ex.y + 60, draw: () => this.crisp(() => this.drawExitPortal(ex, time), this.px(ex.x, ex.y), this.py(ex.x, ex.y), 90 * K, 160 * K, 60 * K) });
    }
    const splitMain = new Set<number>();
    for (const m of g.mobs) if (m.group && m.id !== m.group) splitMain.add(m.group);
    for (const m of g.mobs) list.push({ depth: m.x + m.y, draw: () => this.drawMob(m, time, g.state.level, splitMain.has(m.id)) });
    for (const c of g.party) list.push({ depth: c.x + c.y, draw: () => this.drawCompanion(g, c, time) });
    if (!pixel) list.push({ depth: p.x + p.y, draw: () => this.drawPlayer(g, time) });
    list.sort((a, b) => a.depth - b.depth);
    for (const d of list) d.draw();

    // ---- air effects (bolts, falling stars) ----
    this.beginCrisp();
    this.drawProjectiles(g);
    this.drawAirEffects(g);
    this.drawFallingGlobes(g);
    this.endCrisp();

    // ---- pixel hero: on the crisp layer at its exact spot (never jitters) ----
    if (pixel) this.onOverlay(() => this.drawPlayer(g, time));
    // ---- floating text (crisp overlay) ----
    this.onOverlay(() => this.drawFloats(g));
    // ---- mood: vignette + skill flash ----
    this.screenTransform();
    ctx.drawImage(this.getVignette(lair), 0, 0, w, h);
    if (g.anim.flash > 0) {
      ctx.fillStyle = hexA(g.anim.flashColor, g.anim.flash * 0.12);
      ctx.fillRect(0, 0, w, h);
    }
    this.onOverlay(() => this.drawHud(g), false);
  }

  private drawFloats(g: Game) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of g.floats) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.fillStyle = f.color;
      ctx.font = `bold ${f.size}px "Pixelify Sans", Georgia, serif`;
      outlineText(ctx, f.text, this.px(f.x, f.y), this.py(f.x, f.y, f.z));
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(g: Game) {
    const ctx = this.ctx;
    const { w, h } = this;
    if (g.anim.playerHit > 0.3) {
      ctx.strokeStyle = `rgba(200,30,30,${g.anim.playerHit * 0.5})`;
      ctx.lineWidth = 10;
      ctx.strokeRect(0, 0, w, h);
    }

    this.minimap(g);

    // ---- boss bar ----
    const boss = g.mobs.find((m) => m.boss);
    if (boss) {
      // sits below the floating HUD (further down on phones / narrow screens)
      const o = this.compact ? 170 : 62;
      const bw = Math.min(420, w * 0.6);
      const x = (w - bw) / 2;
      ctx.fillStyle = '#e8d7a9';
      ctx.font = 'bold 14px "Pixelify Sans", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const slimes = boss.group ? g.splitGroup(boss).length : 1;
      outlineText(ctx, `${boss.name}${slimes > 1 ? `  ×${slimes}` : ''}  ·  Lv ${boss.level}`, w / 2, 58 + o);
      bar(ctx, x, 62 + o, bw, 12, boss.hp / boss.maxHp, '#a4161a', '#c9a227');
      // phase marks (per boss)
      ctx.fillStyle = '#e8d7a9';
      for (const f of phaseAt(boss.zone)) ctx.fillRect(x + bw * f - 1, 60 + o, 2, 16);
      if (g.stats.t.stagger) {
        const staggered = boss.staggerUntil > g.time;
        bar(ctx, x + bw * 0.25, 100 + o, bw * 0.5, 5, staggered ? 1 : boss.stagger / 100, staggered ? '#ffffff' : '#ffd166');
        if (staggered) {
          ctx.font = 'bold 11px "Pixelify Sans", Georgia, serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = '#ffd166';
          outlineText(ctx, 'STAGGERED', w / 2, 107 + o);
        }
      }
      if (g.slimeStacks > 0) {
        // Slimed: ring hits this fight; the last pip kills you
        ctx.font = 'bold 12px "Pixelify Sans", Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = g.slimeStacks >= SPLIT.waveLethal - 1 ? '#ff4d4d' : '#9be36b';
        const pips = '●'.repeat(g.slimeStacks) + '○'.repeat(Math.max(0, SPLIT.waveLethal - g.slimeStacks));
        outlineText(ctx, `Slimed ${pips}  (${SPLIT.waveLethal} = death)`, w / 2, 122 + o);
      }
      const t = Math.max(0, g.bossTimer / BALANCE.bossTimeLimit);
      bar(ctx, x, 77 + o, bw, 5, g.enraged ? 1 : t, g.enraged ? '#ff0000' : t < 0.3 ? '#ef4444' : '#c9a227');
      ctx.font = '11px "Pixelify Sans", Georgia, serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = g.enraged ? '#ff4d4d' : '#e8d7a9';
      const phaseTxt = ['', 'Phase 2', 'Phase 3'][boss.phase];
      outlineText(ctx, g.enraged ? 'ENRAGED' : `Enrage in ${Math.ceil(g.bossTimer)}s${phaseTxt ? '  ·  ' + phaseTxt : ''}`, w / 2, 85 + o);
    }

    if (g.awaitingChoice) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, w, h);
    } else if (g.deadTimer > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c9a227';
      ctx.font = 'bold 26px "Pixelify Sans", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      outlineText(ctx, 'You have fallen...', w / 2, h / 2);
    }
  }

  // ---------------- Ground layer ----------------
  private drawTelegraph(t: Telegraph, g: Game) {
    if (t.wait > 0) return;
    const ctx = this.ctx;
    const prog = 1 - t.time / t.total;
    if (t.style === 'landing' || t.style === 'wave') {
      // a slime is in the air: faint outline, red filling in from the middle as it travels,
      // and a dotted line from the slime to where it lands
      const owner = g.mobs.find((m) => m.id === t.ownerId);
      if (owner && owner.hop) {
        ctx.setLineDash([6, 10]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = `rgba(255,120,120,${0.25 + 0.35 * prog})`;
        ctx.beginPath();
        ctx.moveTo(owner.x, owner.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(220,40,40,${0.35 + 0.55 * prog})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(220,40,40,${0.22 + 0.25 * prog})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * prog, 0, Math.PI * 2);
      ctx.fill();
      if (t.style === 'wave') {
        // the crowned slime's landing: a second outline (rings will spread from here)
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(220,40,40,${0.25 + 0.45 * prog})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r + 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }
    if (t.kind === 'square') {
      // checkerboard globe: red square, and the globe's shadow growing and darkening as it falls
      ctx.fillStyle = `rgba(200,30,30,${0.12 + 0.18 * prog})`;
      ctx.fillRect(t.x - t.r, t.y - t.r, t.r * 2, t.r * 2);
      ctx.strokeStyle = 'rgba(200,30,30,0.7)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(t.x - t.r + 2, t.y - t.r + 2, t.r * 2 - 4, t.r * 2 - 4);
      ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.6 * prog * prog})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * (0.3 + 0.55 * prog), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const base = t.boss ? 'rgba(200,30,30,' : 'rgba(230,120,40,';
    ctx.lineWidth = 3;
    const path = (scale: number) => {
      ctx.beginPath();
      if (t.kind === 'circle') ctx.arc(t.x, t.y, t.r * scale, 0, Math.PI * 2);
      else if (t.kind === 'ring') {
        ctx.arc(t.x, t.y, t.inner + (t.r - t.inner) * scale, 0, Math.PI * 2);
        ctx.arc(t.x, t.y, t.inner, 0, Math.PI * 2, true);
      } else if (t.kind === 'cone') {
        ctx.moveTo(t.x, t.y);
        ctx.arc(t.x, t.y, t.r * scale, t.angle - t.width, t.angle + t.width);
        ctx.closePath();
      } else {
        const c = Math.cos(t.angle);
        const s = Math.sin(t.angle);
        const hw = t.width / 2;
        const len = t.r * scale;
        ctx.moveTo(t.x - s * hw, t.y + c * hw);
        ctx.lineTo(t.x - s * hw + c * len, t.y + c * hw + s * len);
        ctx.lineTo(t.x + s * hw + c * len, t.y - c * hw + s * len);
        ctx.lineTo(t.x + s * hw, t.y - c * hw);
        ctx.closePath();
      }
    };
    path(1);
    ctx.fillStyle = base + '0.18)';
    ctx.fill('evenodd');
    ctx.strokeStyle = base + '0.75)';
    ctx.stroke();
    // inner fill grows until it hits
    path(prog);
    ctx.fillStyle = base + '0.35)';
    ctx.fill('evenodd');
  }

  /** The globes themselves, dropping onto their squares in the last part of the telegraph. */
  private drawFallingGlobes(g: Game) {
    const ctx = this.ctx;
    const k = this.k;
    for (const t of g.telegraphs) {
      if ((t.kind !== 'square' && t.style !== 'spout') || t.wait > 0) continue;
      const prog = 1 - t.time / t.total;
      if (prog < 0.45) continue;
      const fall = (prog - 0.45) / 0.55; // 0 high up .. 1 landed
      const z = (1 - fall * fall) * 420;
      const sx = this.px(t.x, t.y);
      const sy = this.py(t.x, t.y, z);
      const r = t.r * 0.42 * k;
      ctx.globalAlpha = Math.min(1, fall * 3);
      ctx.fillStyle = '#7bc950';
      ctx.beginPath();
      ctx.arc(sx, sy - r, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(230,255,200,0.6)';
      ctx.beginPath();
      ctx.arc(sx - r * 0.35, sy - r * 1.35, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Slime goo puddles (fade out near the end of their 7 seconds) and the hero stuck in it. */
  private drawGoo(g: Game, time: number) {
    const ctx = this.ctx;
    // slime waves: a thick band with clear gaps
    for (const w of g.waves) {
      if (w.r <= 0) continue;
      const fade = Math.min(1, (950 - w.r) / 200);
      const gh = 0.24;
      const sorted = [...w.gaps].sort((a, b) => a - b);
      ctx.lineWidth = 34;
      ctx.strokeStyle = `rgba(120,200,70,${0.75 * fade})`;
      for (let i = 0; i < sorted.length; i++) {
        const a0 = sorted[i] + gh;
        const a1 = (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2) - gh;
        if (a1 <= a0) continue;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, a0, a1);
        ctx.stroke();
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(200,30,30,${0.8 * fade})`;
      for (let i = 0; i < sorted.length; i++) {
        const a0 = sorted[i] + gh;
        const a1 = (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2) - gh;
        if (a1 <= a0) continue;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r + 17, a0, a1);
        ctx.stroke();
      }
    }
    for (const o of g.goo) {
      const a = Math.min(1, o.life / 1.2) * 0.55;
      ctx.fillStyle = `rgba(110,190,70,${a})`;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(200,255,160,${a * 0.5})`;
      ctx.beginPath();
      ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.25, o.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (g.parrying || g.sprinting) {
      const p = g.player;
      ctx.strokeStyle = g.parrying ? 'rgba(255,209,102,0.95)' : 'rgba(144,224,239,0.8)';
      ctx.lineWidth = g.parrying ? 7 : 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (g.parrying ? 1.9 : 1.5) + Math.sin(time * 14) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (g.slowed && !g.rooted) {
      const p = g.player;
      ctx.fillStyle = 'rgba(110,190,70,0.45)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.25, 0, Math.PI * 2);
      ctx.fill();
    }
    if (g.rooted) {
      const p = g.player;
      ctx.strokeStyle = 'rgba(123,201,80,0.9)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 1.3 + Math.sin(time * 10) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawGroundEffects(g: Game) {
    const ctx = this.ctx;
    for (const e of g.effects) {
      const t = 1 - e.life / e.maxLife;
      ctx.globalAlpha = Math.max(0, e.life / e.maxLife);
      if (e.kind === 'ring') {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 14 * (1 - t) + 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (0.35 + 0.65 * t), 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'blast') {
        ctx.fillStyle = e.color;
        ctx.globalAlpha *= 0.45;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (0.6 + 0.4 * t), 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'star') {
        // target circle on the ground while the star falls
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (e.kind === 'dash' && e.x2 !== undefined && e.y2 !== undefined) {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.r * (1 - t);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x2, e.y2);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (e.kind === 'slash' && e.angle !== undefined) {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 10 * (1 - t) + 2;
        ctx.beginPath();
        ctx.arc(e.x - Math.cos(e.angle) * 40, e.y - Math.sin(e.angle) * 40, e.r + 30, e.angle - 1 + t * 0.6, e.angle + 1 + t * 0.6);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawAirEffects(g: Game) {
    const ctx = this.ctx;
    for (const e of g.effects) {
      const t = 1 - e.life / e.maxLife;
      ctx.globalAlpha = Math.max(0, Math.min(1, (e.life / e.maxLife) * 1.5));
      if (e.kind === 'bolt' && e.x2 !== undefined && e.y2 !== undefined) {
        const k = Math.min(1, t * 1.6);
        const x = e.x + (e.x2 - e.x) * k;
        const y = e.y + (e.y2 - e.y) * k;
        ctx.fillStyle = e.color;
        circle(ctx, this.px(x, y), this.py(x, y, 30), 5);
      } else if (e.kind === 'star') {
        const fall = Math.max(0, 1 - t * 1.6);
        ctx.fillStyle = e.color;
        star(ctx, this.px(e.x, e.y), this.py(e.x, e.y, 20 + fall * 420), 16, 5);
      } else if (e.kind === 'poof') {
        ctx.fillStyle = e.color;
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const d = e.r * t;
          const x = e.x + Math.cos(a) * d;
          const y = e.y + Math.sin(a) * d;
          circle(ctx, this.px(x, y), this.py(x, y, 20 + t * 30), 6 * (1 - t) + 1);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- Standing layer ----------------
  /** Pixel-art trees, boulders and lair walls. */
  private drawPixelObstacle(tile: number, x: number, y: number, chapter: number, rock: string, faded: boolean, lair: boolean, v: number) {
    const sx = this.px(x, y);
    const sy = this.py(x, y);
    const alpha = faded ? 0.45 : 1;
    if (tile === Tile.Tree) {
      const pine = chapter === 1 || chapter === 3 || chapter === 4 ? v % 4 !== 0 : v % 4 === 3;
      const img = pine ? PX.pineTree(chapter, v % 4, chapter === 3) : PX.leafyTree(chapter, v % 4);
      this.blit(PX.shadowSprite(22), sx, sy, 11, 4, false, alpha);
      this.blit(img, sx, sy + 4 * this.block, img.width >> 1, img.height - 1, (v & 4) !== 0, alpha);
    } else if (lair) {
      const img = PX.wallBlock(rock, v & 3);
      this.blit(img, sx, sy, img.width >> 1, PX.TILE_H / 2, false, alpha);
    } else {
      const img = PX.boulder(rock, v & 3, chapter <= 1);
      this.blit(PX.shadowSprite(24), sx, sy + 2 * this.block, 12, 4, false, alpha);
      this.blit(img, sx, sy + 3 * this.block, img.width >> 1, img.height - 1, (v & 8) !== 0, alpha);
    }
  }

  private drawTree(x: number, y: number, color: string, faded: boolean, v: number) {
    const ctx = this.ctx;
    const sx = this.px(x, y);
    const sy = this.py(x, y);
    const k = this.k;
    ctx.globalAlpha = faded ? 0.35 : 1;
    ctx.fillStyle = '#2b1d12';
    ctx.fillRect(sx - 5 * k, sy - 40 * k, 10 * k, 40 * k);
    const hgt = 95 + v * 12;
    const layers = [
      { y: 40, r: 40 },
      { y: 70, r: 33 },
      { y: hgt, r: 22 },
    ];
    for (const [i, l] of layers.entries()) {
      ctx.fillStyle = shade(color, i * 0.08);
      ctx.beginPath();
      ctx.moveTo(sx - l.r * k, sy - (l.y - 10) * k);
      ctx.lineTo(sx, sy - (l.y + 38) * k);
      ctx.lineTo(sx + l.r * k, sy - (l.y - 10) * k);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawRock(x: number, y: number, color: string, faded: boolean) {
    const ctx = this.ctx;
    const half = TILE * 0.42;
    const hgt = 34;
    const pts = [
      [x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half],
    ].map(([a, b]) => [this.px(a, b), this.py(a, b)]);
    const up = hgt * this.k;
    ctx.globalAlpha = faded ? 0.45 : 1;
    // right face
    ctx.fillStyle = shade(color, -0.25);
    poly(ctx, [pts[1], pts[2], [pts[2][0], pts[2][1] - up], [pts[1][0], pts[1][1] - up]]);
    // left face
    ctx.fillStyle = shade(color, -0.4);
    poly(ctx, [pts[2], pts[3], [pts[3][0], pts[3][1] - up], [pts[2][0], pts[2][1] - up]]);
    // top
    ctx.fillStyle = color;
    poly(ctx, pts.map(([a, b]) => [a, b - up]));
    ctx.globalAlpha = 1;
  }

  private drawPlayer(g: Game, time: number) {
    const ctx = this.ctx;
    const p = g.player;
    const k = this.k;
    const sx = this.px(p.x, p.y);
    const bob = this.pixel ? 0 : p.moving ? Math.abs(Math.sin(time * 11)) * 4 : Math.sin(time * 2.5) * 1.2;
    const sy = this.py(p.x, p.y) - bob;
    if (g.deadeye) {
      const glow = ctx.createRadialGradient(sx, sy - 30 * k, 4, sx, sy - 30 * k, 60 * k);
      glow.addColorStop(0, `rgba(255,209,102,${0.45 + 0.15 * Math.sin(time * 8)})`);
      glow.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 60 * k, sy - 90 * k, 120 * k, 120 * k);
    }
    let by = sy - 46 * k - 34 * k;
    if (this.pixel) by = this.drawPixelHero(g, sx, sy, time);
    else {
      ctx.save();
      ctx.globalAlpha = g.deadTimer > 0 ? 0.3 : 1;
      drawHeroFigure(ctx, sx, sy, k, g.job, this.screenDir(p.angle), g.anim.swing, p.moving, time, g.anim.playerHit > 0.5);
      ctx.restore();
    }
    this.onOverlay(() => this.heroBars(g, sx, by));
  }

  /** Pixel hero with its weapon; returns the screen y just above the head (for the bars). */
  private drawPixelHero(g: Game, sx: number, sy: number, time: number): number {
    const ctx = this.ctx;
    const B = this.block;
    const p = g.player;
    const dir = this.screenDir(p.angle);
    if (dir.dy < -0.3) this.face.back = true;
    else if (dir.dy > 0.1) this.face.back = false;
    if (dir.dx < -0.25) this.face.flip = true;
    else if (dir.dx > 0.25) this.face.flip = false;
    const { back, flip } = this.face;
    const frame = p.moving ? [1, 0, 2, 0][Math.floor(time * 9) % 4] : 0;
    const img = PX.hero(g.job.id, back, frame, g.anim.playerHit > 0.5);
    const alpha = g.deadTimer > 0 ? 0.3 : 1;
    const wp = PX.weapon(g.job.id);
    // exact positions on the overlay (no rounding), so the weapon stays glued to the hero
    const R = (v: number) => v;
    const handY = sy - 9 * B;
    this.blit(PX.shadowSprite(12), sx, sy + B, 6, 3);
    const drawWeapon = () => {
      ctx.save();
      ctx.globalAlpha = alpha;
      const a = Math.atan2(dir.dy, dir.dx);
      if (g.job.id === 'warrior') {
        const sw = (g.anim.swing - 0.5) * 2.2;
        ctx.translate(R(sx / B + dir.dx * 4) * B, R(handY / B) * B);
        ctx.rotate(a - sw * (flip ? -1 : 1));
        ctx.drawImage(wp, -2 * B, -(wp.height >> 1) * B, wp.width * B, wp.height * B);
      } else if (g.job.id === 'archer') {
        ctx.translate(R(sx / B + dir.dx * 6) * B, R(handY / B) * B);
        ctx.rotate(a);
        ctx.drawImage(wp, -2 * B, -(wp.height >> 1) * B, wp.width * B, wp.height * B);
      } else {
        const lift = Math.round(g.anim.swing * 2);
        const x = R(sx / B) + (flip ? -7 : 5);
        ctx.drawImage(wp, x * B, (R(sy / B) - wp.height - 4 - lift) * B, wp.width * B, wp.height * B);
      }
      ctx.restore();
    };
    if (back) drawWeapon();
    this.blit(img, sx, sy, img.width >> 1, img.height - 1, flip, alpha);
    if (!back) drawWeapon();
    return sy - img.height * B - 10;
  }

  private heroBars(g: Game, sx: number, by: number) {
    const ctx = this.ctx;
    const k = this.k;
    bar(ctx, sx - 22 * k, by, 44 * k, 5, g.hp / g.stats.maxHp, '#4caf50');
    if (g.stats.maxMana > 0) bar(ctx, sx - 22 * k, by + 6, 44 * k, 4, g.mana / g.stats.maxMana, '#4ea1ff');
    if (g.usesFocus) bar(ctx, sx - 22 * k, by + 6, 44 * k, 4, g.focus / 100, g.deadeye ? '#fff3c4' : '#ffd166');
    // Arcane Charges
    const maxC = g.maxCharges();
    for (let i = 0; i < maxC; i++) {
      ctx.fillStyle = i < g.charges ? '#8fd3ff' : 'rgba(255,255,255,0.15)';
      const cx = sx + (i - (maxC - 1) / 2) * 9;
      ctx.beginPath();
      ctx.moveTo(cx, by - 12);
      ctx.lineTo(cx + 3.5, by - 7);
      ctx.lineTo(cx, by - 2);
      ctx.lineTo(cx - 3.5, by - 7);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawProjectiles(g: Game) {
    const ctx = this.ctx;
    for (const pr of g.projectiles) {
      const sx = this.px(pr.x, pr.y);
      const sy = this.py(pr.x, pr.y, 28);
      if (pr.kind === 'arrow') {
        const d = this.screenDir(pr.angle);
        const len = (pr.empowered ? 44 : 26) * this.k + 6;
        if (pr.empowered) {
          ctx.strokeStyle = 'rgba(255,209,102,0.35)';
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(sx - d.dx * len * 1.4, sy - d.dy * len * 1.4);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        }
        ctx.strokeStyle = pr.color;
        ctx.lineWidth = pr.empowered ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(sx - d.dx * len, sy - d.dy * len);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.fillStyle = '#ddd';
        circle(ctx, sx, sy, 2.5);
      } else {
        const r = (pr.kind === 'fireball' ? 13 : 7) * Math.max(0.7, this.k);
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.2);
        glow.addColorStop(0, '#ffffff');
        glow.addColorStop(0.35, pr.color);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        circle(ctx, sx, sy, r * 2.2);
      }
    }
  }

  private drawCompanion(g: Game, c: { id: string; x: number; y: number; hit: number }, time: number) {
    const def = COMPANION[c.id];
    if (!def) return;
    if (this.pixel) {
      const img = PX.spirit(def.color, Math.floor(time * 6 + c.x) & 1);
      this.blit(img, this.px(c.x, c.y), this.py(c.x, c.y, 34 + Math.sin(time * 3 + c.x) * 6), img.width >> 1, img.height >> 1);
      return;
    }
    const ctx = this.ctx;
    const k = this.k;
    const sx = this.px(c.x, c.y);
    const sy = this.py(c.x, c.y, 34 + Math.sin(time * 3 + c.x) * 6);
    const r = 14 * k * (1 + c.hit * 0.15) + 4;
    ctx.fillStyle = def.color;
    circle(ctx, sx, sy, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `${r * 1.1}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, sx, sy + 1);
    void g;
  }

  private drawMob(m: Mob, time: number, playerLevel: number, mainSlime = false) {
    if (this.pixel) {
      this.drawPixelMob(m, time, playerLevel, mainSlime);
      return;
    }
    const ctx = this.ctx;
    const k = this.k;
    const grow = 1 - m.spawnAnim;
    if (grow <= 0) return;
    const sx = this.px(m.x, m.y);
    // hopping slimes arc through the air (their shadow stays on the ground)
    const lift = m.hop ? Math.sin(Math.PI * Math.min(1, m.hop.t / m.hop.dur)) * 110 * k : 0;
    const sy = this.py(m.x, m.y) - lift;
    if (sx < -120 || sx > this.w + 120 || sy < -150 || sy > this.h + 150) return;
    const rw = m.r * 1.15 * k * grow;
    const rh = m.r * 1.1 * k * grow;
    const squish = m.moving ? Math.sin(time * 9 + m.id) * 0.08 : Math.sin(time * 2 + m.id) * 0.03;
    const windup = m.state === 'windup';
    const cy = sy - rh * (1 - squish);
    ctx.fillStyle = m.hitFlash > 0.6 ? '#ffffff' : windup ? mix(m.color, '#ff3b3b', 0.45) : m.color;
    ctx.beginPath();
    ctx.ellipse(sx, cy, rw * (1 + squish), rh * (1 - squish), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // shading
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(sx, cy + rh * 0.35, rw * 0.85, rh * 0.45, 0, 0, Math.PI);
    ctx.fill();
    // eyes face their movement
    const d = this.screenDir(m.angle);
    if (d.dy > -0.5) {
      ctx.fillStyle = windup ? '#ffdd00' : '#111';
      const ex = sx + d.dx * rw * 0.35;
      const ey = cy - rh * 0.15 + d.dy * rh * 0.15;
      circle(ctx, ex - rw * 0.2, ey, Math.max(2, rw * 0.11));
      circle(ctx, ex + rw * 0.2, ey, Math.max(2, rw * 0.11));
    }
    if (m.boss) {
      // horns
      ctx.fillStyle = '#e8d7a9';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx + s * rw * 0.45, cy - rh * 0.75);
        ctx.lineTo(sx + s * rw * 0.85, cy - rh * 1.45);
        ctx.lineTo(sx + s * rw * 0.2, cy - rh * 0.9);
        ctx.closePath();
        ctx.fill();
      }
      if (mainSlime) {
        // the main slime wears a crown: it's the one whose attacks land right on you
        const cw = rw * 0.55;
        const top = cy - rh * 1.05;
        ctx.fillStyle = '#ffd166';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx - cw, top);
        ctx.lineTo(sx - cw, top - cw * 0.55);
        ctx.lineTo(sx - cw * 0.5, top - cw * 0.25);
        ctx.lineTo(sx, top - cw * 0.75);
        ctx.lineTo(sx + cw * 0.5, top - cw * 0.25);
        ctx.lineTo(sx + cw, top - cw * 0.55);
        ctx.lineTo(sx + cw, top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else {
      if (m.hp < m.maxHp) bar(ctx, sx - rw, cy - rh - 12, rw * 2, 5, m.hp / m.maxHp, '#b91c1c');
      if (m.bleeds.length) {
        ctx.fillStyle = '#e5383b';
        for (let i = 0; i < m.bleeds.length; i++) circle(ctx, sx - rw + 3 + i * 6, cy - rh - 19, 2.2);
      }
      ctx.font = 'bold 11px "Pixelify Sans", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = levelColor(m.level, playerLevel);
      outlineText(ctx, `Lv ${m.level}`, sx, cy - rh - (m.hp < m.maxHp ? 14 : 4));
    }
  }

  private drawPixelMob(m: Mob, time: number, playerLevel: number, mainSlime: boolean) {
    const grow = 1 - m.spawnAnim;
    if (grow <= 0) return;
    const B = this.block;
    const sx = this.px(m.x, m.y);
    const lift = m.hop ? Math.sin(Math.PI * Math.min(1, m.hop.t / m.hop.dur)) * 110 * this.k : 0;
    const sy = this.py(m.x, m.y) - lift;
    if (sx < -120 || sx > this.w + 120 || sy < -150 || sy > this.h + 150) return;
    const r = Math.max(3, Math.round(m.r * 0.36 * grow));
    const frame = m.moving ? Math.round(Math.sin(time * 9 + m.id)) : Math.sin(time * 2 + m.id) > 0.7 ? 1 : 0;
    const variant = m.hitFlash > 0.6 ? 'hit' : m.state === 'windup' ? 'wind' : '';
    const img = PX.slime(m.color, r, frame, variant);
    this.blit(img, sx, sy + B, img.width >> 1, img.height - 1);
    // eyes look where it's going
    const d = this.screenDir(m.angle);
    const top = sy - (img.height - 2) * B;
    if (d.dy > -0.5) {
      const ctx = this.ctx;
      ctx.fillStyle = m.state === 'windup' ? '#ffdd00' : '#1b1410';
      const ex = Math.round(sx / B + d.dx * r * 0.35);
      const ey = Math.round(top / B + img.height * 0.45 + d.dy);
      const gap = Math.max(1, Math.round(r * 0.35));
      const eh = r > 8 ? 2 : 1;
      ctx.fillRect((ex - gap) * B, ey * B, B, eh * B);
      ctx.fillRect((ex + gap) * B, ey * B, B, eh * B);
    }
    if (m.boss) {
      const hl = PX.horn(false);
      const hr = PX.horn(true);
      this.blit(hl, sx - r * 0.55 * B, top + 2 * B, hl.width, hl.height);
      this.blit(hr, sx + r * 0.55 * B, top + 2 * B, 0, hr.height);
      if (mainSlime) {
        const c = PX.crown();
        this.blit(c, sx, top - B, c.width >> 1, c.height);
      }
    } else {
      this.onOverlay(() => {
        const ctx = this.ctx;
        const rw = (img.width / 2) * B;
        if (m.hp < m.maxHp) bar(ctx, sx - rw, top - 12, rw * 2, 5, m.hp / m.maxHp, '#b91c1c');
        if (m.bleeds.length) {
          ctx.fillStyle = '#e5383b';
          for (let i = 0; i < m.bleeds.length; i++) circle(ctx, sx - rw + 3 + i * 6, top - 19, 2.2);
        }
        ctx.font = 'bold 11px "Pixelify Sans", Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = levelColor(m.level, playerLevel);
        outlineText(ctx, `Lv ${m.level}`, sx, top - (m.hp < m.maxHp ? 14 : 4));
      });
    }
  }

  /** Ground under lair doors (world) or the summoning circle (inside a lair). */
  private drawAltars(g: Game, time: number) {
    const ctx = this.ctx;
    const lair = g.map.kind === 'lair';
    g.map.altars.forEach((a, idx) => {
      const z = lair ? g.inLair : idx;
      const st = g.bossStatus(z);
      const color = st === 'locked' ? '#6b6b6b' : st === 'cooldown' ? '#8a6d2b' : '#c1121f';
      const pulse = st === 'ready' || st === 'fighting' ? 0.5 + 0.5 * Math.sin(time * 3) : 0.3;
      if (!lair) {
        // trodden dark earth in front of the door
        ctx.fillStyle = 'rgba(15,12,9,0.6)';
        ctx.beginPath();
        ctx.arc(a.x, a.y, 120, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.fillStyle = 'rgba(30,8,8,0.55)';
      ctx.beginPath();
      ctx.arc(a.x, a.y, 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 140, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 95, 0, Math.PI * 2);
      ctx.stroke();
      // pentagram-ish star and rune spokes
      ctx.beginPath();
      for (let k = 0; k <= 5; k++) {
        const ang = (k * 4 * Math.PI) / 5 - Math.PI / 2 + time * 0.1;
        const fn = k === 0 ? 'moveTo' : 'lineTo';
        ctx[fn](a.x + Math.cos(ang) * 92, a.y + Math.sin(ang) * 92);
      }
      ctx.stroke();
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2 - time * 0.15;
        ctx.beginPath();
        ctx.moveTo(a.x + Math.cos(ang) * 104, a.y + Math.sin(ang) * 104);
        ctx.lineTo(a.x + Math.cos(ang) * 132, a.y + Math.sin(ang) * 132);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    if (g.map.kind !== 'world' && g.map.exit) {
      const e = g.map.exit;
      ctx.fillStyle = 'rgba(90,150,255,0.18)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, 46 + 4 * Math.sin(time * 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private touchesFloor(g: Game, tx: number, ty: number): boolean {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= g.map.w || y >= g.map.h) continue;
        const t = g.map.tiles[y * g.map.w + x];
        if (t === Tile.Floor || t === Tile.Altar) return true;
      }
    return false;
  }

  /** World: stone archway with a swirling portal leading into a boss lair. */
  private drawLairDoor(g: Game, a: { x: number; y: number }, z: number, time: number) {
    const ctx = this.ctx;
    const k = this.k;
    const sx = this.px(a.x, a.y);
    const sy = this.py(a.x, a.y);
    if (sx < -200 || sx > this.w + 200 || sy < -250 || sy > this.h + 150) return;
    const st = g.bossStatus(z);
    const w = 120 * k;
    const h = 150 * k;
    // pillars + lintel
    ctx.fillStyle = '#4a4238';
    ctx.fillRect(sx - w / 2 - 16 * k, sy - h, 22 * k, h);
    ctx.fillRect(sx + w / 2 - 6 * k, sy - h, 22 * k, h);
    ctx.fillStyle = '#5b5246';
    ctx.beginPath();
    ctx.moveTo(sx - w / 2 - 24 * k, sy - h);
    ctx.quadraticCurveTo(sx, sy - h - 60 * k, sx + w / 2 + 24 * k, sy - h);
    ctx.lineTo(sx + w / 2 + 24 * k, sy - h + 18 * k);
    ctx.quadraticCurveTo(sx, sy - h - 40 * k, sx - w / 2 - 24 * k, sy - h + 18 * k);
    ctx.closePath();
    ctx.fill();
    // portal
    const inner = st === 'locked' ? '#2a2a2a' : st === 'cooldown' ? '#3d2e12' : '#3a0a0a';
    const glow = st === 'locked' ? '#555' : st === 'cooldown' ? '#b08d1e' : '#e01e37';
    const grad = ctx.createRadialGradient(sx, sy - h * 0.5, 4, sx, sy - h * 0.5, w * 0.6);
    grad.addColorStop(0, glow);
    grad.addColorStop(0.5, inner);
    grad.addColorStop(1, '#050303');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(sx - w / 2 + 6 * k, sy);
    ctx.lineTo(sx - w / 2 + 6 * k, sy - h + 10 * k);
    ctx.quadraticCurveTo(sx, sy - h - 34 * k, sx + w / 2 - 6 * k, sy - h + 10 * k);
    ctx.lineTo(sx + w / 2 - 6 * k, sy);
    ctx.closePath();
    ctx.fill();
    if (st !== 'locked') {
      ctx.strokeStyle = glow;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(sx, sy - h * 0.5, (w * 0.32 - i * 9 * k) * (1 + 0.08 * Math.sin(time * 2 + i)), h * 0.32 - i * 9 * k, time * (0.6 + i * 0.3), 0, Math.PI * 1.4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      // chains across a sealed door
      ctx.strokeStyle = '#8a8a8a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx - w / 2, sy - h * 0.8);
      ctx.lineTo(sx + w / 2, sy - h * 0.25);
      ctx.moveTo(sx + w / 2, sy - h * 0.8);
      ctx.lineTo(sx - w / 2, sy - h * 0.25);
      ctx.stroke();
    }
    // name plate
    ctx.font = 'bold 12px "Pixelify Sans", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = st === 'locked' ? '#9a9a9a' : '#e8d7a9';
    outlineText(ctx, `${CHAPTERS[ZONES[z].chapter].boss}'s Lair${st === 'locked' ? ' (sealed)' : ''}`, sx, sy - h - 44 * k);
  }

  /** World: rocky mound with a dark opening into the Echoing Hollow. */
  private drawCaveMouth(c: { x: number; y: number }, time: number) {
    const ctx = this.ctx;
    const k = this.k;
    const sx = this.px(c.x, c.y);
    const sy = this.py(c.x, c.y);
    if (sx < -250 || sx > this.w + 250 || sy < -250 || sy > this.h + 200) return;
    // mound
    ctx.fillStyle = '#4b4438';
    ctx.beginPath();
    ctx.moveTo(sx - 120 * k, sy + 10 * k);
    ctx.quadraticCurveTo(sx - 110 * k, sy - 130 * k, sx, sy - 150 * k);
    ctx.quadraticCurveTo(sx + 110 * k, sy - 130 * k, sx + 120 * k, sy + 10 * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5c5446';
    ctx.beginPath();
    ctx.ellipse(sx - 40 * k, sy - 110 * k, 40 * k, 22 * k, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // opening with a faint purple glow from within
    const g = ctx.createRadialGradient(sx, sy - 40 * k, 2, sx, sy - 40 * k, 60 * k);
    g.addColorStop(0, `rgba(150,90,255,${0.35 + 0.15 * Math.sin(time * 2)})`);
    g.addColorStop(0.4, '#0a0710');
    g.addColorStop(1, '#050308');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - 46 * k, sy + 4 * k);
    ctx.quadraticCurveTo(sx - 46 * k, sy - 80 * k, sx, sy - 86 * k);
    ctx.quadraticCurveTo(sx + 46 * k, sy - 80 * k, sx + 46 * k, sy + 4 * k);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 12px "Pixelify Sans", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#d8c3ff';
    outlineText(ctx, 'Echoing Hollow', sx, sy - 160 * k);
    ctx.font = '11px "Pixelify Sans", Georgia, serif';
    ctx.fillStyle = '#ffb38a';
    outlineText(ctx, 'manual only · bonus EXP', sx, sy - 160 * k + 14);
  }

  /** Lair: shimmering blue portal back to the world. */
  private drawExitPortal(e: { x: number; y: number }, time: number) {
    const ctx = this.ctx;
    const k = this.k;
    const sx = this.px(e.x, e.y);
    const sy = this.py(e.x, e.y);
    const g = ctx.createLinearGradient(0, sy - 110 * k, 0, sy);
    g.addColorStop(0, 'rgba(90,150,255,0)');
    g.addColorStop(1, `rgba(90,150,255,${0.45 + 0.15 * Math.sin(time * 3)})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(sx, sy - 50 * k, 34 * k, 60 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 11px "Pixelify Sans", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#bcd4ff';
    outlineText(ctx, 'Exit', sx, sy - 115 * k);
  }

  /** Lair: stone column with a burning brazier on top. */
  private drawBrazier(x: number, y: number, color: string, time: number) {
    const ctx = this.ctx;
    const k = this.k;
    const sx = this.px(x, y);
    const sy = this.py(x, y);
    const hgt = 70 * k;
    // light pool
    const lg = ctx.createRadialGradient(sx, sy - hgt, 0, sx, sy - hgt, 160 * k);
    lg.addColorStop(0, 'rgba(255,150,50,0.22)');
    lg.addColorStop(1, 'rgba(255,150,50,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(sx - 160 * k, sy - hgt - 160 * k, 320 * k, 320 * k);
    ctx.fillStyle = shade(color, -0.3);
    ctx.fillRect(sx - 12 * k, sy - hgt, 24 * k, hgt);
    ctx.fillStyle = shade(color, -0.05);
    ctx.fillRect(sx - 18 * k, sy - hgt - 8 * k, 36 * k, 10 * k);
    // flame
    const f = Math.sin(time * 10 + x) * 3 * k;
    ctx.fillStyle = '#ff7b00';
    ctx.beginPath();
    ctx.moveTo(sx - 12 * k, sy - hgt - 8 * k);
    ctx.quadraticCurveTo(sx + f, sy - hgt - 46 * k, sx + 12 * k, sy - hgt - 8 * k);
    ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(sx - 6 * k, sy - hgt - 8 * k);
    ctx.quadraticCurveTo(sx - f, sy - hgt - 30 * k, sx + 6 * k, sy - hgt - 8 * k);
    ctx.fill();
  }

  private drawGoal(gl: { x: number; y: number }, time: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#c9a227';
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 5);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(gl.x, gl.y, 30 + 6 * Math.sin(time * 5), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Barrier between zones: a shimmering rune wall the hero can walk through. */
  private drawGate(x: number, y: number, time: number) {
    const ctx = this.ctx;
    const k = this.k;
    const sx = this.px(x, y);
    const sy = this.py(x, y);
    const hgt = 110 * k;
    const g = ctx.createLinearGradient(0, sy - hgt, 0, sy);
    const a = 0.25 + 0.12 * Math.sin(time * 2 + x * 0.01);
    g.addColorStop(0, 'rgba(160,110,255,0)');
    g.addColorStop(1, `rgba(160,110,255,${a + 0.2})`);
    ctx.fillStyle = g;
    ctx.fillRect(sx - 30 * k, sy - hgt, 60 * k, hgt);
    ctx.fillStyle = `rgba(220,200,255,${a + 0.3})`;
    for (let i = 0; i < 3; i++) {
      const ry = sy - ((time * 30 + i * 37 + x) % hgt);
      ctx.fillRect(sx - 3 * k + Math.sin(i + x) * 18 * k, ry, 6 * k, 6 * k);
    }
  }

  private minimap(g: Game) {
    const ctx = this.ctx;
    const k = Math.min(Math.min(240, this.w * 0.36) / g.map.w, 100 / g.map.h);
    const mw = g.map.w * k;
    const mh = g.map.h * k;
    const x0 = this.w - mw - 10;
    const y0 = this.compact ? 58 : 10;
    ctx.fillStyle = 'rgba(10,8,6,0.8)';
    ctx.fillRect(x0 - 3, y0 - 3, mw + 6, mh + 6);
    ctx.strokeStyle = '#6b5a36';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 - 3, y0 - 3, mw + 6, mh + 6);
    for (let i = 0; i < g.map.tiles.length; i++) {
      const t = g.map.tiles[i];
      if (t === Tile.Rock || t === Tile.Tree) continue;
      const tx = i % g.map.w;
      ctx.fillStyle = t === Tile.Gate ? '#a06eff' : Math.floor(tx / g.map.zoneW) === g.zone ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
      ctx.fillRect(x0 + tx * k, y0 + ((i - tx) / g.map.w) * k, k + 0.3, k + 0.3);
    }
    const toMini = (x: number, y: number): [number, number] => [x0 + (x / TILE) * k, y0 + (y / TILE) * k];
    g.map.altars.forEach((a, idx) => {
      const st = g.bossStatus(g.map.kind === 'lair' ? g.inLair : idx);
      ctx.fillStyle = st === 'locked' ? '#777' : st === 'cooldown' ? '#8a6d2b' : '#ff2a4d';
      const [ax, ay] = toMini(a.x, a.y);
      circle(ctx, ax, ay, 4);
    });
    for (const m of g.mobs) {
      if (m.zone !== g.zone && !m.boss) continue;
      ctx.fillStyle = m.boss ? '#ff4d6d' : '#d64545';
      const [mx, my] = toMini(m.x, m.y);
      circle(ctx, mx, my, m.boss ? 4 : 1.6);
    }
    if (g.map.cave) {
      ctx.fillStyle = '#a06eff';
      const [cx, cy] = toMini(g.map.cave.x, g.map.cave.y);
      ctx.fillRect(cx - 3, cy - 3, 6, 6);
    }
    if (g.travelGoal) {
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 1.5;
      const [gx, gy] = toMini(g.travelGoal.x, g.travelGoal.y);
      ctx.strokeRect(gx - 4, gy - 4, 8, 8);
    }
    ctx.fillStyle = '#ffd60a';
    const [pxm, pym] = toMini(g.player.x, g.player.y);
    circle(ctx, pxm, pym, 3.2);
  }
}

// ---------------- Hero figure (shared by the game and the character select) ----------------
/**
 * Draws the hero standing at screen point (sx, sy) (their feet). k is the zoom.
 * dir is the on-screen facing direction.
 */
export function drawHeroFigure(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, k: number, job: JobDef,
  dir: { dx: number; dy: number }, swing: number, moving: boolean, time: number, hurt = false,
) {
  const flip = dir.dx >= 0 ? 1 : -1;
  const bw = 30 * k;
  const bh = 46 * k;
  const body = hurt ? '#d66' : job.color;
  const trim = shade(job.color, -0.35);

  const drawWeapon = () => {
    ctx.save();
    if (job.id === 'warrior') {
      const sw = (swing - 0.5) * 2.2;
      ctx.translate(sx + dir.dx * 12 * k, sy - bh * 0.55 + dir.dy * 6 * k);
      ctx.rotate(Math.atan2(dir.dy, dir.dx) - sw * flip);
      ctx.fillStyle = '#c9ced6';
      ctx.fillRect(4 * k, -3 * k, 46 * k, 6 * k);
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(0, -7 * k, 6 * k, 14 * k);
    } else if (job.id === 'archer') {
      // bow held out toward the aim, string pulled back while shooting
      ctx.translate(sx + dir.dx * 18 * k, sy - bh * 0.55 + dir.dy * 8 * k);
      ctx.rotate(Math.atan2(dir.dy, dir.dx));
      ctx.strokeStyle = '#8b5a2b';
      ctx.lineWidth = 4 * k;
      ctx.beginPath();
      ctx.arc(-6 * k, 0, 22 * k, -1.2, 1.2);
      ctx.stroke();
      const pull = swing * 10 * k;
      ctx.strokeStyle = '#e8d7a9';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-6 * k + Math.cos(-1.2) * 22 * k, Math.sin(-1.2) * 22 * k);
      ctx.lineTo(-6 * k - pull, 0);
      ctx.lineTo(-6 * k + Math.cos(1.2) * 22 * k, Math.sin(1.2) * 22 * k);
      ctx.stroke();
    } else {
      // staff at the side, orb glows when casting
      const tx = sx + flip * 20 * k;
      const lift = swing * 6 * k;
      ctx.strokeStyle = '#6b4423';
      ctx.lineWidth = 4 * k;
      ctx.beginPath();
      ctx.moveTo(tx, sy - 2 * k - lift);
      ctx.lineTo(tx, sy - bh - 26 * k - lift);
      ctx.stroke();
      const r = (6 + swing * 4) * k;
      const g = ctx.createRadialGradient(tx, sy - bh - 30 * k - lift, 0, tx, sy - bh - 30 * k - lift, r * 2.4);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, '#b388ff');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      circle(ctx, tx, sy - bh - 30 * k - lift, r * 2.4);
    }
    ctx.restore();
  };

  if (dir.dy < 0) drawWeapon();

  if (job.id === 'mage') {
    // long robe
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(sx - bw * 0.42, sy - bh + 4 * k);
    ctx.lineTo(sx + bw * 0.42, sy - bh + 4 * k);
    ctx.lineTo(sx + bw * 0.62, sy);
    ctx.lineTo(sx - bw * 0.62, sy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = trim;
    ctx.fillRect(sx - bw * 0.62, sy - 5 * k, bw * 1.24, 5 * k);
  } else {
    ctx.fillStyle = '#3b2f24';
    const step = moving ? Math.sin(time * 11) * 5 * k : 0;
    ctx.fillRect(sx - 9 * k, sy - 14 * k + step, 7 * k, 14 * k - step);
    ctx.fillRect(sx + 2 * k, sy - 14 * k - step, 7 * k, 14 * k + step);
    if (job.id === 'archer') {
      // quiver on the back
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(sx - flip * 16 * k - 4 * k, sy - bh - 2 * k, 8 * k, 26 * k);
    }
    ctx.fillStyle = body;
    roundRect(ctx, sx - bw / 2, sy - bh, bw, bh - 10 * k, 8 * k);
    ctx.fill();
    ctx.fillStyle = trim;
    ctx.fillRect(sx - bw / 2, sy - 22 * k, bw, 6 * k);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(sx - 3 * k, sy - 22 * k, 6 * k, 6 * k);
  }

  // head
  const hy = sy - bh - 9 * k;
  ctx.fillStyle = '#e0b48a';
  circle(ctx, sx, hy, 11 * k);
  if (job.id === 'warrior') {
    ctx.fillStyle = '#7d8590';
    ctx.beginPath();
    ctx.arc(sx, hy - 1 * k, 12 * k, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(sx - 2 * k, hy - 1 * k, 4 * k, 8 * k);
  } else if (job.id === 'archer') {
    ctx.fillStyle = shade(job.color, -0.2);
    ctx.beginPath();
    ctx.arc(sx, hy, 13 * k, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(sx - flip * 16 * k, hy + 8 * k);
    ctx.closePath();
    ctx.fill();
  } else {
    // pointy wizard hat
    ctx.fillStyle = shade(job.color, -0.15);
    ctx.beginPath();
    ctx.ellipse(sx, hy - 6 * k, 17 * k, 5 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx - 10 * k, hy - 7 * k);
    ctx.lineTo(sx - flip * 6 * k, hy - 38 * k);
    ctx.lineTo(sx + 10 * k, hy - 7 * k);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#111';
  if (dir.dy > -0.6) circle(ctx, sx + flip * 5 * k, hy + 2 * k, 2 * k);

  if (dir.dy >= 0) drawWeapon();
}

/** Draws an idle, slowly turning hero for the character select screen. */
export function drawHeroPortrait(canvas: HTMLCanvasElement, job: JobId, time: number) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const def = JOBS[job];
  const bg = ctx.createRadialGradient(w / 2, h * 0.6, 4, w / 2, h * 0.6, w * 0.6);
  bg.addColorStop(0, hexA(def.color, 0.55));
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.82, w * 0.2, w * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  let pixelArt = true;
  try {
    pixelArt = localStorage.getItem('idle-rpg-pixel') !== '0';
  } catch {
    /* keep pixel art */
  }
  if (pixelArt) {
    // the pixel hero, scaled up crisply, walking in place and turning now and then
    ctx.imageSmoothingEnabled = false;
    const phase = Math.floor(time / 2.5) % 4; // front-right, front-left, back-left, back-right
    const back = phase >= 2;
    const flip = phase === 1 || phase === 2;
    const img = PX.hero(job, back, [1, 0, 2, 0][Math.floor(time * 5) % 4]);
    const wp = PX.weapon(job);
    const S = Math.max(2, Math.floor(Math.min(w / 17, h / 25)));
    const x = Math.round(w / 2 - (img.width * S) / 2);
    const y = Math.round(h * 0.84 - img.height * S);
    ctx.save();
    if (flip) {
      ctx.translate(x + img.width * S, y);
      ctx.scale(-1, 1);
    } else ctx.translate(x, y);
    if (back) ctx.drawImage(wp, (job === 'mage' ? 11 : 9) * S, (job === 'mage' ? -2 : 10) * S - (job === 'mage' ? 0 : (wp.height * S) / 2), wp.width * S, wp.height * S);
    ctx.drawImage(img, 0, 0, img.width * S, img.height * S);
    if (!back) ctx.drawImage(wp, (job === 'mage' ? 11 : 9) * S, (job === 'mage' ? -2 : 10) * S - (job === 'mage' ? 0 : (wp.height * S) / 2), wp.width * S, wp.height * S);
    ctx.restore();
    return;
  }
  const a = Math.sin(time * 0.6) * 0.9 + 0.4;
  const dir = { dx: Math.cos(a), dy: Math.sin(a) * 0.5 + 0.3 };
  const l = Math.hypot(dir.dx, dir.dy);
  const swing = Math.max(0, Math.sin(time * 1.7)) ** 6;
  drawHeroFigure(ctx, w / 2, h * 0.82 - Math.sin(time * 2.5) * 1.5, w / 95, def, { dx: dir.dx / l, dy: dir.dy / l }, swing, false, time);
}

// ---------------- helpers ----------------
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  ctx.fill();
}

function poly(ctx: CanvasRenderingContext2D, pts: number[][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, border?: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x, y, w, h);
  const f = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, (w - 2) * f, h - 2);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }
}

/** Pixel art: text drawn on the low-res world goes to the crisp overlay instead (same screen coords). */
let textLayer: CanvasRenderingContext2D | null = null;

function outlineText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  let c = ctx;
  if (textLayer && ctx !== textLayer) {
    c = textLayer;
    c.font = ctx.font;
    c.fillStyle = ctx.fillStyle;
    c.textAlign = ctx.textAlign;
    c.textBaseline = ctx.textBaseline;
    c.globalAlpha = ctx.globalAlpha;
  }
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.strokeText(text, x, y);
  c.fillText(text, x, y);
  if (c !== ctx) c.globalAlpha = 1;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexA(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
