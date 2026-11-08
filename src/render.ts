import { BALANCE, COMPANION, chapterOf } from './data';
import { Game, Mob } from './game';
import { PHYS } from './world';

/** Draws the battle scene with simple shapes and a camera that follows the hero. */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private camX = 0;
  private camY = 0;
  private scale = 1;
  private groundPx = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // world -> screen
  private sx(x: number) {
    return (x - this.camX) * this.scale;
  }
  private sy(y: number) {
    return this.groundPx - (y - this.camY) * this.scale;
  }

  draw(g: Game, time: number) {
    const { ctx, w, h } = this;
    if (w === 0 || h === 0) return;
    const s = g.state;
    const ch = chapterOf(s.stage).def;
    const p = g.player;

    // On touch screens the controls sit at the bottom, so lift the ground above them
    // and zoom out a bit on narrow screens so you can see more of the map.
    const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const bottom = touch ? 132 : 46;
    this.scale = Math.min((h - bottom + 46) / PHYS.viewHeight, w / 560);
    this.groundPx = h - bottom;
    const viewW = w / this.scale;
    const targetX = Math.max(0, Math.min(g.layout.width - viewW, p.x - viewW / 2));
    this.camX += (targetX - this.camX) * 0.15;
    if (g.layout.width <= viewW) this.camX = (g.layout.width - viewW) / 2;
    // follow the hero up onto high platforms a little
    const targetY = Math.max(0, p.y - 160);
    this.camY += (targetY - this.camY) * 0.1;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, ch.sky[0]);
    sky.addColorStop(1, ch.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Parallax hills (far, then near)
    this.hills(0.2, 260, 110, 'rgba(0,0,0,0.07)');
    this.hills(0.45, 180, 70, 'rgba(0,0,0,0.09)');

    // Ground
    const gy = this.sy(0);
    ctx.fillStyle = ch.ground;
    ctx.fillRect(0, gy, w, h - gy);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, gy, w, 5);
    // map edges
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    if (this.sx(0) > 0) ctx.fillRect(0, 0, this.sx(0), h);
    const right = this.sx(g.layout.width);
    if (right < w) ctx.fillRect(right, 0, w - right, h);

    // Platforms
    for (const pl of g.layout.platforms) {
      const x1 = this.sx(pl.x1);
      const x2 = this.sx(pl.x2);
      const y = this.sy(pl.y);
      if (x2 < 0 || x1 > w) continue;
      const th = 16 * this.scale;
      ctx.fillStyle = ch.ground;
      roundRect(ctx, x1, y, x2 - x1, th, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x1 + 4, y, x2 - x1 - 8, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x1 + 4, y + th - 4, x2 - x1 - 8, 4);
    }

    // Skill flash
    if (g.anim.flash > 0) {
      ctx.fillStyle = hexA(g.anim.flashColor, g.anim.flash * 0.18);
      ctx.fillRect(0, 0, w, h);
    }

    // Mobs
    for (const m of g.mobs) this.drawMob(m, time);

    // Companions
    for (const c of g.party) {
      const def = COMPANION[c.id];
      if (!def) continue;
      const cx = this.sx(c.x);
      const cy = this.sy(c.y);
      const r = 15 * this.scale * (1 + c.hit * 0.15);
      ctx.fillStyle = def.color;
      circle(ctx, cx, cy, r);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `${r * 1.1}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, cx, cy + 1);
    }

    // Player
    this.drawPlayer(g, time);

    // Effects
    for (const e of g.effects) {
      const t = 1 - e.life / e.maxLife;
      ctx.globalAlpha = Math.max(0, e.life / e.maxLife);
      const ex = this.sx(e.x);
      const ey = this.sy(e.y);
      if (e.kind === 'ring') {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 6 * (1 - t) + 2;
        ctx.beginPath();
        ctx.ellipse(ex, ey, e.r * this.scale * (0.3 + 0.7 * t), e.r * this.scale * 0.5 * (0.3 + 0.7 * t), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'slash') {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(ex, ey, e.r * this.scale * 0.6, -1.2 + t, 1.2 + t);
        ctx.stroke();
      } else if (e.kind === 'star') {
        // a falling star landing on the target
        const fy = ey - (1 - Math.min(1, t * 2.5)) * 220 * this.scale;
        ctx.fillStyle = e.color;
        star(ctx, ex, fy, e.r * this.scale * 0.5, 5);
        if (t > 0.4) {
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(ex, ey, e.r * this.scale * t, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (e.kind === 'bolt' && e.x2 !== undefined && e.y2 !== undefined) {
        const tx = this.sx(e.x2);
        const ty = this.sy(e.y2);
        const k = Math.min(1, t * 1.6);
        ctx.fillStyle = e.color;
        circle(ctx, ex + (tx - ex) * k, ey + (ty - ey) * k, 6);
      } else if (e.kind === 'poof') {
        ctx.fillStyle = e.color;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const d = e.r * this.scale * t;
          circle(ctx, ex + Math.cos(a) * d, ey + Math.sin(a) * d, 6 * (1 - t) + 1);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Floating text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of g.floats) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.fillStyle = f.color;
      ctx.font = `bold ${f.size}px sans-serif`;
      outlineText(ctx, f.text, this.sx(f.x), this.sy(f.y));
    }
    ctx.globalAlpha = 1;

    // Minimap
    this.minimap(g);

    // Boss timer
    const boss = g.mobs.find((m) => m.boss);
    if (boss) {
      const t = g.bossTimer / BALANCE.bossTimeLimit;
      bar(ctx, w * 0.25, 44, w * 0.5, 12, boss.hp / boss.maxHp, '#f72585');
      bar(ctx, w * 0.25, 60, w * 0.5, 6, t, t < 0.3 ? '#ef4444' : '#ffc23d');
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      outlineText(ctx, `${boss.name}  ·  ${Math.ceil(g.bossTimer)}s`, w / 2, 41);
    }

    if (g.deadTimer > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      outlineText(ctx, 'Recovering...', w / 2, h / 2);
    }
  }

  private hills(parallax: number, spacing: number, height: number, color: string) {
    const { ctx, w } = this;
    const gy = this.sy(0);
    ctx.fillStyle = color;
    const off = (this.camX * this.scale * parallax) % spacing;
    for (let x = -spacing; x < w + spacing * 2; x += spacing) {
      ctx.beginPath();
      ctx.ellipse(x - off, gy, spacing * 0.7, height * this.scale, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  private drawPlayer(g: Game, time: number) {
    const { ctx } = this;
    const p = g.player;
    const sc = this.scale;
    const pw = p.w * sc;
    const ph = p.h * sc;
    const x = this.sx(p.x);
    const feet = this.sy(p.y);
    const walking = Math.abs(p.vx) > 1 && p.onGround;
    const bob = walking ? Math.abs(Math.sin(time * 12)) * 4 : Math.sin(time * 3) * 1.5;
    const top = feet - ph - bob;

    ctx.save();
    ctx.globalAlpha = g.deadTimer > 0 ? 0.35 : 1;
    shadow(ctx, x, this.sy(this.groundUnder(g)), pw * 0.5);
    ctx.fillStyle = g.anim.playerHit > 0.5 ? '#ff8f8f' : '#3a86ff';
    roundRect(ctx, x - pw / 2, top, pw, ph, pw * 0.25);
    ctx.fill();
    // eyes face the movement direction
    const f = p.facing;
    ctx.fillStyle = '#fff';
    circle(ctx, x + f * pw * 0.05, top + ph * 0.36, pw * 0.11);
    circle(ctx, x + f * pw * 0.3, top + ph * 0.36, pw * 0.11);
    ctx.fillStyle = '#111';
    circle(ctx, x + f * pw * 0.09, top + ph * 0.37, pw * 0.055);
    circle(ctx, x + f * pw * 0.34, top + ph * 0.37, pw * 0.055);
    // sword
    ctx.save();
    ctx.translate(x + f * pw * 0.45, top + ph * 0.62);
    ctx.scale(f, 1);
    ctx.rotate(-1.0 + g.anim.swing * 2.2);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, -3, pw * 0.85, 6);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(-6, -6, 8, 12);
    ctx.restore();
    ctx.restore();
    bar(ctx, x - pw / 2, top - 12, pw, 6, g.hp / g.stats.maxHp, '#4ade80');
  }

  private groundUnder(g: Game): number {
    const p = g.player;
    let y = 0;
    for (const pl of g.layout.platforms) if (p.x >= pl.x1 && p.x <= pl.x2 && pl.y <= p.y + 1 && pl.y > y) y = pl.y;
    return y;
  }

  private drawMob(m: Mob, time: number) {
    const { ctx } = this;
    const sc = this.scale;
    const grow = 1 - m.spawnAnim;
    const mw = m.w * sc * grow;
    const mh = m.h * sc * grow;
    const x = this.sx(m.x) + m.lunge * m.facing * 10;
    const feet = this.sy(m.y);
    if (x < -mw || x > this.w + mw) return;
    const squish = m.dir ? Math.sin(time * 8 + m.id) * 0.06 : Math.sin(time * 2 + m.id) * 0.03;
    const cy = feet - mh * 0.5;
    shadow(ctx, x, feet, mw * 0.5);
    ctx.fillStyle = m.hitFlash > 0.6 ? '#ffffff' : m.color;
    ctx.beginPath();
    ctx.ellipse(x, cy + mh * squish * 0.5, mw * 0.5 * (1 + squish), mh * 0.5 * (1 - squish), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // eyes look where it's facing
    ctx.fillStyle = '#111';
    circle(ctx, x + m.facing * mw * 0.08, cy - mh * 0.08, Math.max(2, mw * 0.06));
    circle(ctx, x + m.facing * mw * 0.28, cy - mh * 0.08, Math.max(2, mw * 0.06));
    if (m.boss) {
      ctx.fillStyle = '#ffc23d';
      const ty = cy - mh * 0.48;
      ctx.beginPath();
      ctx.moveTo(x - mw * 0.22, ty);
      ctx.lineTo(x - mw * 0.22, ty - mh * 0.2);
      ctx.lineTo(x - mw * 0.11, ty - mh * 0.08);
      ctx.lineTo(x, ty - mh * 0.25);
      ctx.lineTo(x + mw * 0.11, ty - mh * 0.08);
      ctx.lineTo(x + mw * 0.22, ty - mh * 0.2);
      ctx.lineTo(x + mw * 0.22, ty);
      ctx.closePath();
      ctx.fill();
    } else if (m.hp < m.maxHp) {
      bar(ctx, x - mw * 0.45, feet - mh - 10, mw * 0.9, 5, m.hp / m.maxHp, '#ef4444');
    }
  }

  private minimap(g: Game) {
    const { ctx, w } = this;
    const mw = Math.min(180, w * 0.32);
    const mh = 40;
    const x0 = w - mw - 8;
    const y0 = 34;
    const k = mw / g.layout.width;
    const ky = (mh - 8) / 300;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, x0, y0, mw, mh, 6);
    ctx.fill();
    const base = y0 + mh - 4;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x0 + 2, base, mw - 4, 2);
    for (const pl of g.layout.platforms) ctx.fillRect(x0 + pl.x1 * k, base - pl.y * ky, (pl.x2 - pl.x1) * k, 2);
    for (const m of g.mobs) {
      ctx.fillStyle = m.boss ? '#f72585' : '#ef4444';
      circle(ctx, x0 + m.x * k, base - m.y * ky - 2, m.boss ? 4 : 2);
    }
    ctx.fillStyle = '#ffd60a';
    circle(ctx, x0 + g.player.x * k, base - g.player.y * ky - 3, 3.5);
  }
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
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

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + 2, Math.max(0.1, r), Math.max(0.1, r * 0.22), 0, 0, Math.PI * 2);
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

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) {
    ctx.fillStyle = color;
    roundRect(ctx, x + 1, y + 1, Math.max(h - 2, (w - 2) * f), h - 2, (h - 2) / 2);
    ctx.fill();
  }
}

function outlineText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
