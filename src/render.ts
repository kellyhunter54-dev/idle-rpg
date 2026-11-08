import { BALANCE, COMPANION, SKILLS, chapterOf } from './data';
import { Game } from './game';

/** Draws the battle scene with simple shapes. Swap this file out when real art arrives. */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

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

  draw(g: Game, time: number) {
    const { ctx, w, h } = this;
    if (w === 0 || h === 0) return;
    const s = g.state;
    const ch = chapterOf(s.stage).def;
    const groundY = h * 0.72;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, ch.sky[0]);
    sky.addColorStop(1, ch.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Parallax hills
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    const off = (time * 12) % 240;
    for (let x = -240; x < w + 240; x += 240) {
      ctx.beginPath();
      ctx.ellipse(x - off + 120, groundY, 160, 70, 0, Math.PI, 0);
      ctx.fill();
    }

    // Ground
    ctx.fillStyle = ch.ground;
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, groundY, w, 4);

    // Skill flash
    if (g.anim.flash > 0) {
      ctx.fillStyle = hexA(g.anim.flashColor, g.anim.flash * 0.25);
      ctx.fillRect(0, 0, w, h);
    }

    const unit = Math.min(w, h * 1.4) / 10;

    // Companions (behind player)
    s.party.forEach((id, i) => {
      if (!id) return;
      const c = COMPANION[id];
      const bob = Math.sin(time * 3 + i) * 4;
      const hitOff = (g.anim.compHit[i] ?? 0) * unit * 0.4;
      const cx = w * 0.2 - i * unit * 0.55 + hitOff;
      const cy = groundY - unit * (0.9 + (i % 2) * 0.5) + bob;
      ctx.fillStyle = c.color;
      circle(ctx, cx, cy, unit * 0.32);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `${unit * 0.36}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.icon, cx, cy + 1);
    });

    // Player
    const dead = g.deadTimer > 0;
    const px = w * 0.3 + g.anim.lunge * unit * 0.6;
    const pSize = unit * 1.1;
    const py = groundY - pSize - Math.abs(Math.sin(time * 4)) * 3;
    ctx.save();
    ctx.globalAlpha = dead ? 0.35 : 1;
    shadow(ctx, px, groundY, pSize * 0.5);
    ctx.fillStyle = g.anim.playerHit > 0.5 ? '#ff8f8f' : '#3a86ff';
    roundRect(ctx, px - pSize / 2, py, pSize, pSize, pSize * 0.25);
    ctx.fill();
    // face
    ctx.fillStyle = '#fff';
    circle(ctx, px + pSize * 0.12, py + pSize * 0.38, pSize * 0.1);
    circle(ctx, px + pSize * 0.34, py + pSize * 0.38, pSize * 0.1);
    ctx.fillStyle = '#111';
    circle(ctx, px + pSize * 0.15, py + pSize * 0.39, pSize * 0.05);
    circle(ctx, px + pSize * 0.37, py + pSize * 0.39, pSize * 0.05);
    // sword
    ctx.save();
    ctx.translate(px + pSize * 0.5, py + pSize * 0.65);
    ctx.rotate(-0.9 + g.anim.lunge * 1.6);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, -3, pSize * 0.75, 6);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(-6, -6, 8, 12);
    ctx.restore();
    ctx.restore();
    bar(ctx, px - pSize / 2, py - 14, pSize, 7, g.hp / g.stats.maxHp, '#4ade80');

    // Mob
    if (g.mob) {
      const m = g.mob;
      const mSize = unit * (m.boss ? 1.9 : 1.1);
      const mx = w * 0.68 + g.anim.mobHit * 6;
      const my = groundY - mSize * 0.55 - Math.abs(Math.sin(time * 3)) * 4;
      shadow(ctx, mx, groundY, mSize * 0.5);
      ctx.fillStyle = g.anim.mobHit > 0.6 ? '#ffffff' : m.color;
      ctx.beginPath();
      ctx.ellipse(mx, my, mSize * 0.55, mSize * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // eyes (looking left at the player)
      ctx.fillStyle = '#111';
      circle(ctx, mx - mSize * 0.22, my - mSize * 0.08, mSize * 0.06);
      circle(ctx, mx - mSize * 0.02, my - mSize * 0.08, mSize * 0.06);
      if (m.boss) {
        // crown
        ctx.fillStyle = '#ffc23d';
        const cy = my - mSize * 0.5;
        ctx.beginPath();
        ctx.moveTo(mx - mSize * 0.25, cy);
        ctx.lineTo(mx - mSize * 0.25, cy - mSize * 0.2);
        ctx.lineTo(mx - mSize * 0.12, cy - mSize * 0.08);
        ctx.lineTo(mx, cy - mSize * 0.25);
        ctx.lineTo(mx + mSize * 0.12, cy - mSize * 0.08);
        ctx.lineTo(mx + mSize * 0.25, cy - mSize * 0.2);
        ctx.lineTo(mx + mSize * 0.25, cy);
        ctx.closePath();
        ctx.fill();
      }
      const barY = my - mSize * (m.boss ? 0.95 : 0.7);
      bar(ctx, mx - mSize * 0.5, barY, mSize, 8, m.hp / m.maxHp, m.boss ? '#f72585' : '#ef4444');
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${m.boss ? 15 : 12}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      outlineText(ctx, m.name, mx, barY - 3);
    }

    // Boss timer
    if (g.mob?.boss) {
      const t = g.bossTimer / BALANCE.bossTimeLimit;
      bar(ctx, w * 0.25, 12, w * 0.5, 10, t, t < 0.3 ? '#ef4444' : '#ffc23d');
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      outlineText(ctx, `BOSS  ${Math.ceil(g.bossTimer)}s`, w / 2, 26);
    }

    // Skill cooldown icons
    let sx = 10;
    for (const sk of SKILLS) {
      const locked = s.level < sk.unlock;
      const size = 34;
      const sy = h - size - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, sx, sy, size, size, 8);
      ctx.fill();
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = locked ? 0.3 : 1;
      ctx.fillText(sk.icon, sx + size / 2, sy + size / 2 + 1);
      ctx.globalAlpha = 1;
      if (!locked) {
        const frac = Math.max(0, g.skillCd[sk.id] / sk.cd);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(sx, sy, size, size * frac);
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(`Lv${sk.unlock}`, sx + size / 2, sy + size - 7);
      }
      sx += size + 6;
    }

    // Floating text
    for (const f of g.floats) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.fillStyle = f.color;
      ctx.font = `bold ${f.size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      outlineText(ctx, f.text, f.x * w, f.y * h);
    }
    ctx.globalAlpha = 1;

    if (dead) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      outlineText(ctx, 'Recovering...', w / 2, h / 2);
    }
  }
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + 2, r, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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
