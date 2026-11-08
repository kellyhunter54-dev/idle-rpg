/**
 * Procedural pixel-art sprites (original art, built pixel by pixel and cached).
 *
 * Style: dark outlines, light from the top-left, 3-5 tone ramps, highlight clusters,
 * warm earthy palettes. Everything here is drawn at 1 sprite pixel = 1 game pixel; the renderer
 * draws the world on a low-resolution canvas and scales it up with hard edges.
 */
import { JobId } from './data';

type RGB = [number, number, number];
const OUTLINE: RGB = [27, 20, 16];

export const hexRgb = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dark = (c: RGB, t: number): RGB => lerp(c, [12, 8, 16], t);
const light = (c: RGB, t: number): RGB => lerp(c, [255, 250, 220], t);
/** 5 tones from a base colour: darkest .. highlight. */
const ramp = (base: RGB): RGB[] => [dark(base, 0.55), dark(base, 0.28), base, light(base, 0.22), light(base, 0.45)];

/** Deterministic hash noise. */
const hash = (x: number, y: number, s: number) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

class PixelImage {
  data: Uint8ClampedArray;
  constructor(public w: number, public h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGB, a = 255) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  alpha(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }
  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  /** Dark outline around every opaque shape (4-neighbour). */
  outline(c: RGB = OUTLINE) {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y)) continue;
        if (this.alpha(x - 1, y) > 128 || this.alpha(x + 1, y) > 128 || this.alpha(x, y - 1) > 128 || this.alpha(x, y + 1) > 128) add.push(x, y);
      }
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], c);
    return this;
  }
  /** A copy with every opaque pixel recoloured (hit flash / tints). */
  tinted(c: RGB, amt: number): PixelImage {
    const o = new PixelImage(this.w, this.h);
    o.data.set(this.data);
    for (let i = 0; i < o.data.length; i += 4) {
      if (!o.data[i + 3]) continue;
      o.data[i] += (c[0] - o.data[i]) * amt;
      o.data[i + 1] += (c[1] - o.data[i + 1]) * amt;
      o.data[i + 2] += (c[2] - o.data[i + 2]) * amt;
    }
    return o;
  }
  canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

const cache = new Map<string, HTMLCanvasElement>();
const cached = (key: string, make: () => HTMLCanvasElement) => {
  let c = cache.get(key);
  if (!c) {
    c = make();
    cache.set(key, c);
  }
  return c;
};

// ---------------------------------------------------------------- palettes
/** Ground per chapter (meadow, woods, canyon, frost, ruins): 5 tones, plus detail colours. */
const GROUND: { tones: string[]; tuft: string; flowers: string[] }[] = [
  { tones: ['#2e4a1e', '#3d6125', '#4d772b', '#64923a', '#86b24a'], tuft: '#9cc455', flowers: ['#e05a47', '#f2c94c', '#f4f1e1'] },
  { tones: ['#1c2c1d', '#263c26', '#2f4b2d', '#3f6338', '#567f46'], tuft: '#6f9a52', flowers: ['#b8f2e6', '#e76f51', '#c7b7e5'] },
  { tones: ['#3a1e14', '#4d2a1b', '#633722', '#7c4a2c', '#9a6338'], tuft: '#b07a43', flowers: ['#ff8c42', '#f2c94c', '#3a1e14'] },
  { tones: ['#7d93a3', '#98afbf', '#b6cad7', '#d3e2eb', '#eef6fa'], tuft: '#ffffff', flowers: ['#90e0ef', '#ffffff', '#a9d6e5'] },
  { tones: ['#27233a', '#322d4a', '#3d375a', '#4e476f', '#665d8d'], tuft: '#7a70a6', flowers: ['#f72585', '#4cc9f0', '#b5179e'] },
];
/** Tree leaf base per chapter. */
const LEAVES = ['#4f8a2c', '#2f6b3a', '#c0612b', '#e9f2f7', '#5b4d8a'];
const PINE = ['#2f6a35', '#1f5132', '#6b3a22', '#3d6b6b', '#3b3260'];

export const TILE_W = 32;
export const TILE_H = 16;

/** Is (x, y) inside a 32x16 isometric diamond (exact 2:1 rows, so tiles meet without gaps)? */
const inDiamond = (x: number, y: number) => {
  const hw = y < TILE_H / 2 ? (y + 1) * 2 : (TILE_H - y) * 2;
  return x >= TILE_W / 2 - hw && x < TILE_W / 2 + hw;
};

/** Grass / earth / snow floor tile. variant 0-15: 1 has flowers, 3 a pebble, the rest just grass. */
export function groundTile(chapter: number, variant: number, tx: number, ty: number): HTMLCanvasElement {
  const key = `g${chapter}:${variant}`;
  return cached(key, () => {
    const pal = GROUND[chapter] ?? GROUND[0];
    const t = pal.tones.map(hexRgb);
    const img = new PixelImage(TILE_W, TILE_H);
    const seed = chapter * 97 + variant * 13 + 5;
    for (let y = 0; y < TILE_H; y++)
      for (let x = 0; x < TILE_W; x++) {
        if (!inDiamond(x, y)) continue;
        // soft blotches (3x2 cells) so it doesn't look like static
        const n = hash(Math.floor((x + tx) / 3), Math.floor((y + ty) / 2), seed) * 0.7 + hash(x, y, seed + 1) * 0.3;
        const tone = n < 0.18 ? 1 : n > 0.86 ? 3 : 2;
        img.set(x, y, t[tone]);
      }
    // grass tufts: little "v" blades
    const tufts = 1 + (variant % 3);
    for (let i = 0; i < tufts; i++) {
      const x = 4 + Math.floor(hash(i, variant, seed + 2) * 24);
      const y = 3 + Math.floor(hash(i, variant, seed + 3) * 10);
      if (!inDiamond(x, y) || !inDiamond(x, y - 2)) continue;
      img.set(x, y, t[1]);
      img.set(x - 1, y - 1, hexRgb(pal.tuft));
      img.set(x + 1, y - 1, t[3]);
      img.set(x, y - 2, hexRgb(pal.tuft));
    }
    if (variant === 1) {
      // a few flowers
      for (let i = 0; i < 3; i++) {
        const x = 5 + Math.floor(hash(i, 7, seed) * 22);
        const y = 4 + Math.floor(hash(i, 9, seed) * 8);
        if (!inDiamond(x, y + 1)) continue;
        img.set(x, y, hexRgb(pal.flowers[i % pal.flowers.length]));
        img.set(x, y + 1, t[0]);
      }
    } else if (variant === 3) {
      // pebbles
      const x = 10 + Math.floor(hash(3, 3, seed) * 12);
      const y = 6 + Math.floor(hash(4, 4, seed) * 4);
      img.set(x, y, [150, 146, 132]);
      img.set(x + 1, y, [120, 116, 104]);
      img.set(x, y - 1, [196, 190, 172]);
      img.set(x, y + 1, OUTLINE, 160);
      img.set(x + 1, y + 1, OUTLINE, 160);
    }
    return img.canvas();
  });
}

/** Lair / cave floor: dark flagstones. */
export function stoneTile(baseHex: string, variant: number): HTMLCanvasElement {
  return cached(`s${baseHex}:${variant}`, () => {
    const base = dark(hexRgb(baseHex), 0.45);
    const t = ramp(base);
    const img = new PixelImage(TILE_W, TILE_H);
    for (let y = 0; y < TILE_H; y++)
      for (let x = 0; x < TILE_W; x++) {
        if (!inDiamond(x, y)) continue;
        const n = hash(x >> 1, y, variant + 31);
        img.set(x, y, n < 0.15 ? t[1] : n > 0.9 ? t[3] : t[2]);
      }
    // mortar: the diamond's lower edges and a seam across the middle
    for (let y = 0; y < TILE_H; y++)
      for (let x = 0; x < TILE_W; x++) {
        if (!inDiamond(x, y)) continue;
        if (!inDiamond(x, y + 1) || !inDiamond(x + 1, y + 1) || !inDiamond(x - 1, y + 1)) img.set(x, y, t[0]);
        else if (variant % 2 === 0 && Math.abs(x - 16 - (y - 8) * 2) < 1) img.set(x, y, t[1]);
      }
    if (variant === 3) {
      // a crack
      for (let i = 0; i < 4; i++) img.set(12 + i, 6 + (i >> 1), t[0]);
    }
    return img.canvas();
  });
}

// ---------------------------------------------------------------- shapes
/** Fills blobs (circles) with sphere shading from the top-left. */
function blobs(img: PixelImage, list: { x: number; y: number; r: number }[], tones: RGB[], seed: number, bumpy = 1) {
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      let best: { nx: number; ny: number; d: number } | null = null;
      for (const b of list) {
        const dx = x + 0.5 - b.x;
        const dy = y + 0.5 - b.y;
        const r = b.r + (hash(Math.round(Math.atan2(dy, dx) * 3 + b.x), 1, seed) - 0.5) * 2 * bumpy;
        const d = Math.hypot(dx, dy) / r;
        if (d <= 1 && (!best || d < best.d)) best = { nx: dx / r, ny: dy / r, d };
      }
      if (!best) continue;
      const lit = -best.nx * 0.55 - best.ny * 0.75 + (hash(x >> 1, y >> 1, seed) - 0.5) * 0.35;
      const tone = lit > 0.55 ? 4 : lit > 0.18 ? 3 : lit > -0.25 ? 2 : lit > -0.6 ? 1 : 0;
      img.set(x, y, tones[tone]);
    }
}

/** Round leafy tree (variant changes the canopy). ~30x42. Anchor: bottom centre (trunk base). */
export function leafyTree(chapter: number, variant: number): HTMLCanvasElement {
  return cached(`t${chapter}:${variant}`, () => {
    const w = 32;
    const h = 44;
    const img = new PixelImage(w, h);
    // trunk
    const bark = ramp(hexRgb('#6b4426'));
    for (let y = 26; y < h - 1; y++)
      for (let x = 14; x < 19; x++) img.set(x, y, x === 14 ? bark[3] : x === 18 ? bark[1] : bark[2]);
    img.set(13, h - 2, bark[1]);
    img.set(19, h - 2, bark[1]);
    const leaves = ramp(hexRgb(LEAVES[chapter] ?? LEAVES[0]));
    const s = variant * 7 + chapter;
    const off = (n: number) => Math.round((hash(n, variant, 3) - 0.5) * 3);
    blobs(
      img,
      [
        { x: 16 + off(1), y: 14, r: 11 },
        { x: 8 + off(2), y: 20, r: 7.5 },
        { x: 24 + off(3), y: 20, r: 7.5 },
        { x: 13 + off(4), y: 8, r: 7 },
        { x: 21 + off(5), y: 9, r: 6.5 },
        { x: 16, y: 24, r: 7 },
      ],
      leaves,
      s,
      1.2,
    );
    return img.outline().canvas();
  });
}

/** Pine tree, ~24x44. Anchor: bottom centre. */
export function pineTree(chapter: number, variant: number, snow = false): HTMLCanvasElement {
  return cached(`p${chapter}:${variant}:${snow}`, () => {
    const w = 26;
    const h = 46;
    const img = new PixelImage(w, h);
    const bark = ramp(hexRgb('#5a3a22'));
    for (let y = 36; y < h - 1; y++) for (let x = 11; x < 15; x++) img.set(x, y, x === 11 ? bark[3] : bark[1]);
    const t = ramp(hexRgb(PINE[chapter] ?? PINE[0]));
    const tiers = [
      { top: 2, bot: 16, half: 7 },
      { top: 9, bot: 26, half: 10 },
      { top: 17, bot: 38, half: 12 },
    ];
    for (const [ti, tier] of tiers.entries()) {
      for (let y = tier.top; y <= tier.bot; y++) {
        const f = (y - tier.top) / (tier.bot - tier.top);
        const hw = Math.max(1, Math.round(tier.half * f + (hash(y, ti, variant) - 0.5) * 1.5));
        for (let x = 13 - hw; x <= 12 + hw; x++) {
          const side = (x - 12.5) / hw; // -1 left .. 1 right
          const lit = -side * 0.6 - (1 - f) * 0.4 + (hash(x, y, variant + 9) - 0.5) * 0.3;
          let tone = lit > 0.45 ? 4 : lit > 0.05 ? 3 : lit > -0.35 ? 2 : 1;
          if (y === tier.bot) tone = 0; // dark rim under each tier
          img.set(x, y, t[tone]);
          if (snow && y - tier.top < 3 && hash(x, y, 77) > 0.3) img.set(x, y, [240, 248, 255]);
        }
      }
    }
    return img.outline().canvas();
  });
}

/** Boulder, ~26x20. Anchor: bottom centre. */
export function boulder(baseHex: string, variant: number, moss = false): HTMLCanvasElement {
  return cached(`b${baseHex}:${variant}:${moss}`, () => {
    const w = 28;
    const h = 22;
    const img = new PixelImage(w, h);
    const t = ramp(hexRgb(baseHex));
    const o = (n: number) => (hash(n, variant, 11) - 0.5) * 4;
    blobs(
      img,
      [
        { x: 13 + o(1), y: 13, r: 8.5 },
        { x: 7 + o(2), y: 15, r: 5.5 },
        { x: 20 + o(3), y: 15, r: 6 },
      ],
      t,
      variant + 40,
      0.6,
    );
    // flat bottom so it sits on the ground
    for (let y = 19; y < h; y++) for (let x = 0; x < w; x++) img.set(x, y, [0, 0, 0], 0);
    // a crack
    for (let i = 0; i < 3; i++) if (img.alpha(14 + i, 10 + i)) img.set(14 + i, 10 + i, t[0]);
    if (moss) {
      const m = ramp(hexRgb('#5f8f2f'));
      for (let x = 0; x < w; x++)
        for (let y = 0; y < 9; y++) {
          if (!img.alpha(x, y + 4) || img.alpha(x, y + 3)) continue;
          if (hash(x, y, variant) > 0.45) img.set(x, y + 4, m[hash(x, 1, 2) > 0.5 ? 3 : 2]);
        }
    }
    return img.outline().canvas();
  });
}

/** Stone wall block for lairs and caves: an isometric cube 32 wide, top + two faces. Anchor: bottom centre. */
export function wallBlock(baseHex: string, variant: number): HTMLCanvasElement {
  return cached(`w${baseHex}:${variant}`, () => {
    const W = TILE_W;
    const H = 28; // height of the faces
    const img = new PixelImage(W, TILE_H + H);
    const t = ramp(hexRgb(baseHex));
    // top face
    for (let y = 0; y < TILE_H; y++) for (let x = 0; x < W; x++) if (inDiamond(x, y)) img.set(x, y, hash(x >> 1, y, variant) > 0.85 ? t[4] : t[3]);
    // side faces: left lit, right dark, with brick courses
    for (let y = 0; y < H + TILE_H; y++)
      for (let x = 0; x < W; x++) {
        const topEdge = x < W / 2 ? TILE_H / 2 + Math.floor(x / 2) : TILE_H / 2 + Math.floor((W - 1 - x) / 2);
        if (y < topEdge || y >= topEdge + H) continue;
        if (inDiamond(x, y)) continue;
        const left = x < W / 2;
        const rowY = y - topEdge;
        const course = Math.floor(rowY / 5);
        const mortar = rowY % 5 === 4 || (x + course * 4) % 8 === 0;
        let c = left ? t[2] : t[1];
        if (mortar) c = left ? t[1] : t[0];
        else if (hash(x, y, variant + 3) > 0.92) c = left ? t[3] : t[2];
        img.set(x, y, c);
      }
    return img.outline().canvas();
  });
}

/**
 * Slime body (all monsters are slimes for now). r = radius in pixels; frame -1/0/1 squish.
 * Variant 'hit' (white flash) or 'wind' (red, winding up). Anchor: bottom centre.
 */
export function slime(colorHex: string, r: number, frame: number, variant: '' | 'hit' | 'wind' = ''): HTMLCanvasElement {
  return cached(`sl${colorHex}:${r}:${frame}:${variant}`, () => {
    const rw = Math.max(3, r * (1 + frame * 0.08));
    const rh = Math.max(3, r * 0.92 * (1 - frame * 0.08));
    const w = Math.ceil(rw * 2) + 4;
    const h = Math.ceil(rh * 2) + 4;
    let img = new PixelImage(w, h);
    let base = hexRgb(colorHex);
    if (variant === 'wind') base = lerp(base, [255, 59, 59], 0.45);
    const t = ramp(base);
    const cx = w / 2;
    const cy = h - 2 - rh;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - cx) / rw;
        const ny = (y + 0.5 - cy) / rh;
        // a dome: round on top, flatter at the bottom
        const d = nx * nx + (ny > 0 ? ny * ny * 1.35 : ny * ny);
        if (d > 1) continue;
        const lit = -nx * 0.5 - ny * 0.8;
        let tone = lit > 0.55 ? 4 : lit > 0.15 ? 3 : lit > -0.3 ? 2 : 1;
        if (ny > 0.55) tone = Math.min(tone, 1);
        img.set(x, y, t[tone]);
      }
    // glossy highlight
    const hx = Math.round(cx - rw * 0.4);
    const hy = Math.round(cy - rh * 0.45);
    img.set(hx, hy, [255, 255, 245]);
    if (r > 6) {
      img.set(hx + 1, hy, [255, 255, 245]);
      img.set(hx, hy + 1, t[4]);
    }
    img.outline(dark(base, 0.75));
    if (variant === 'hit') img = img.tinted([255, 255, 255], 0.85);
    return img.canvas();
  });
}

/** Small boss horn pair + optional crown, drawn on top of a slime. */
export function crown(): HTMLCanvasElement {
  return cached('crown', () => {
    const rows = ['o.o.o.o', 'oGoGoGo', 'oGGGGGo', 'oYYYYYo', 'ooooooo'];
    return fromRows(rows, { o: OUTLINE, G: hexRgb('#ffd166'), Y: hexRgb('#c9a227') });
  });
}
export function horn(flip: boolean): HTMLCanvasElement {
  return cached(`horn${flip}`, () => {
    const rows = flip ? ['...o', '..oH', '.oHo', 'oHHo', 'oHo.', 'oo..'] : ['o...', 'Ho..', 'oHo.', 'oHHo', '.oHo', '..oo'];
    return fromRows(rows, { o: OUTLINE, H: hexRgb('#e8d7a9') });
  });
}

function fromRows(rows: string[], pal: Record<string, RGB>): HTMLCanvasElement {
  const img = new PixelImage(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => pal[ch] && img.set(x, y, pal[ch])));
  return img.canvas();
}

// ---------------------------------------------------------------- hero
/*
 * Hero templates, 3/4 view facing right (mirrored for left). 16 wide.
 * F = front (facing down-right), B = back (facing up-right).
 * Keys: o outline, s skin, S skin shade, e eye, c cloth, C cloth shade, l cloth light, b belt,
 * g gold, p pants, P pants shade, k boots, H head-gear, h head-gear shade, j head-gear light
 */
const HEAD: Record<JobId, { F: string[]; B: string[] }> = {
  warrior: {
    F: [
      '.....oooooo.....',
      '....ojjHHHHo....',
      '...ojHHHHHhho...',
      '...oHHHHHHHho...',
      '...oHssssHHho...',
      '...osssesShho...',
      '...osssssSho....',
      '....oSSSSSo.....',
    ],
    B: [
      '.....oooooo.....',
      '....ojjHHHHo....',
      '...ojHHHHHhho...',
      '...oHHHHHHHho...',
      '...oHHHHHHHho...',
      '...oHHHHHHhho...',
      '....ohHHHhho....',
      '.....ooSSoo.....',
    ],
  },
  archer: {
    F: [
      '......oooo......',
      '.....oHHHHo.....',
      '....oHjHHHho....',
      '...oHHHHHHhho...',
      '...oHssssHHho...',
      '...osssesSHho...',
      '...osssssShho...',
      '....oSSSSSoHo...',
    ],
    B: [
      '......oooo......',
      '.....oHHHHo.....',
      '....oHjHHHho....',
      '...oHHHHHHhho...',
      '...oHHHHHHhho...',
      '...oHHHHHHhho...',
      '...ohHHHHhhho...',
      '....ooSSSoooHo..',
    ],
  },
  mage: {
    F: [
      '.........oo.....',
      '........oHho....',
      '.......oHHho....',
      '......ojHHho....',
      '.....ojHHHHho...',
      '..ooojHHHHHhhoo.',
      '.ohhhhhhhhhhhhho',
      '..oooossssShoo..',
      '....osssesSSo...',
      '....osssssSSo...',
      '.....oSSSSSo....',
    ],
    B: [
      '.........oo.....',
      '........oHho....',
      '.......oHHho....',
      '......ojHHho....',
      '.....ojHHHHho...',
      '..ooojHHHHHhhoo.',
      '.ohhhhhhhhhhhhho',
      '..ooohhhhhhhoo..',
      '....oHHHHHHho...',
      '....ohHHHHhho...',
      '.....oooooo.....',
    ],
  },
};

const BODY_F = [
  '...occccccCo....',
  '..oclccgcccCo...',
  '..osclccccCso...',
  '..osobbgbbbso...',
  '...occccccCo....',
];
const BODY_B = [
  '...occccccCo....',
  '..occcccccCCo...',
  '..oscccccCCso...',
  '..osobbbbbbso...',
  '...occccccCo....',
];
const ROBE_F = [
  '...occccccCo....',
  '..oclccgcccCo...',
  '..osclccccCso...',
  '..osobbgbbbso...',
  '...occccccCCo...',
  '...olccccccCo...',
  '..olccccccCCCo..',
  '..oCCCCCCCCCCo..',
  '..oooooooooooo..',
];
const ROBE_B = [
  '...occccccCo....',
  '..occcccccCCo...',
  '..oscccccCCso...',
  '..osobbbbbbso...',
  '...occccccCCo...',
  '...occccccCCo...',
  '..occcccccCCCo..',
  '..oCCCCCCCCCCo..',
  '..oooooooooooo..',
];
const LEGS = [
  ['...opppoPPPo....', '...oppo.oPPo....', '...okko.okko....', '...oooo.oooo....'],
  ['...opppoPPPo....', '..oppo...oPPo...', '..okko....okko..', '..oooo....oooo..'],
  ['...opppoPPPo....', '....oppooPPo....', '....okkookko....', '....oooooooo....'],
];

const JOB_PAL: Record<JobId, { c: string; b: string; p: string; k: string; H: string }> = {
  warrior: { c: '#3d5a80', b: '#5a3a22', p: '#4a4038', k: '#2e241c', H: '#9aa3ad' },
  archer: { c: '#3f6b3a', b: '#6b4426', p: '#5a4630', k: '#3a2a1c', H: '#4f7a3a' },
  mage: { c: '#5b3a8a', b: '#c9a227', p: '#3a2a50', k: '#2a1f30', H: '#4b2f78' },
};

/** Hero sprite: job, front/back, walk frame 0-2, hurt tint. Anchor: bottom centre (feet). */
export function hero(job: JobId, back: boolean, frame: number, hurt = false): HTMLCanvasElement {
  return cached(`h${job}:${back}:${frame}:${hurt}`, () => {
    const pal = JOB_PAL[job];
    const cl = ramp(hexRgb(pal.c));
    const hg = ramp(hexRgb(pal.H));
    const sk = hexRgb('#e8b98a');
    const keys: Record<string, RGB> = {
      o: OUTLINE, s: sk, S: dark(sk, 0.25), e: [30, 22, 26],
      c: cl[2], C: cl[1], l: cl[3], b: hexRgb(pal.b), g: hexRgb('#e0b84a'),
      p: hexRgb(pal.p), P: dark(hexRgb(pal.p), 0.3), k: hexRgb(pal.k),
      H: hg[2], h: hg[1], j: hg[4],
    };
    const head = HEAD[job][back ? 'B' : 'F'];
    const robe = job === 'mage';
    const body = robe ? (back ? ROBE_B : ROBE_F) : back ? BODY_B : BODY_F;
    const legs = robe ? [] : LEGS[frame % 3];
    const rows = [...head, ...body, ...legs];
    let img = new PixelImage(16, rows.length);
    rows.forEach((r, y) => [...r].forEach((ch, x) => keys[ch] && img.set(x, y, keys[ch])));
    if (robe && frame) {
      // robe sways while walking
      const sway = frame === 1 ? 1 : -1;
      const shifted = new PixelImage(16, rows.length);
      for (let y = 0; y < rows.length; y++)
        for (let x = 0; x < 16; x++) {
          const sx = y >= head.length + 5 ? x - sway : x;
          if (sx >= 0 && sx < 16 && img.alpha(sx, y)) shifted.set(x, y, img.get(sx, y));
        }
      img = shifted;
    }
    if (hurt) img = img.tinted([230, 60, 60], 0.45);
    return img.canvas();
  });
}

/** Weapon sprites held by the hero (drawn rotated by the renderer). Handle at the left-middle. */
export function weapon(job: JobId): HTMLCanvasElement {
  return cached(`wp${job}`, () => {
    if (job === 'warrior')
      return fromRows(
        ['..oo..........', 'ogGo..........', 'oGGooooooooooo', 'ogGollllllllLo', 'oGGooooooooooo', 'ogGo..........', '..oo..........'],
        { o: OUTLINE, g: hexRgb('#c9a227'), G: hexRgb('#e0b84a'), l: hexRgb('#e6ecf2'), L: hexRgb('#ffffff') },
      );
    if (job === 'archer')
      return fromRows(
        ['oooo....', 'obbbo...', '.oo.bo..', '...o.bo.', '....o.bo', '.....oBo', '....o.bo', '...o.bo.', '.oo.bo..', 'obbbo...', 'oooo....'],
        { o: OUTLINE, b: hexRgb('#8b5a2b'), B: hexRgb('#b07a43') },
      );
    return fromRows(
      ['..ooo.', '.oWLWo', 'oLWWWo', '.oWLWo', '..ooo.', '...ob.', '...ob.', '...ob.', '...ob.', '...ob.', '...ob.', '...ob.', '...ob.', '...oo.'],
      { o: OUTLINE, b: hexRgb('#6b4423'), W: hexRgb('#b388ff'), L: hexRgb('#f3e8ff') },
    );
  });
}

/** Soft oval ground shadow, w pixels wide. */
export function shadowSprite(w: number): HTMLCanvasElement {
  return cached(`sh${w}`, () => {
    const h = Math.max(2, Math.round(w / 2.4));
    const img = new PixelImage(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5 - w / 2) / (w / 2);
        const ny = (y + 0.5 - h / 2) / (h / 2);
        if (nx * nx + ny * ny <= 1) img.set(x, y, [10, 8, 14], 90);
      }
    return img.canvas();
  });
}
