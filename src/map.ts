// Tile maps, collision and pathfinding. World units: a flat (x, y) ground plane.
// The renderer projects it isometrically; game logic never needs to know about that.

export const TILE = 64;
/** Width of each zone in tiles. */
export const ZONE_TILES = 40;

export const Tile = { Floor: 0, Rock: 1, Tree: 2, Gate: 3, Altar: 4, Pillar: 5 } as const;

export const PHYS = {
  playerSpeed: 230,
  playerRadius: 18,
  mobSpeed: 70,
  mobRadius: 22,
  bossSpeed: 95,
  bossRadius: 46,
  mobAggroRange: 330,
  mobsPerZone: 12,
  mobSpawnInterval: 0.6,
  activeRange: 1500, // mobs further than this from the hero just idle (saves CPU)
  manualTimeout: 2,
  altarRadius: 120,
};

export interface Vec2 {
  x: number;
  y: number;
}

export interface GameMap {
  w: number; // tiles
  h: number;
  tiles: Uint8Array;
  variant: Uint8Array; // cosmetic floor variation 0..3
  zoneW: number; // tiles per zone (zones sit side by side, west to east)
  zones: number;
  entrances: Vec2[]; // per zone, world units (where you arrive / respawn)
  altars: Vec2[]; // per zone boss altar centre, world units
  zoneFloor: number[][]; // per zone: indexes of floor tiles where mobs may spawn
  kind: 'world' | 'lair' | 'cave';
  /** Lairs: which CHAPTERS palette to use. */
  palette?: number;
  /** Lairs and caves: the exit portal back to the world. */
  exit?: Vec2;
  /** World: entrance of the manual-only cave. */
  cave?: Vec2;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the whole world: `zones` regions side by side, separated by walls with a barrier gate. */
export function generateWorld(zones: number): GameMap {
  const rand = mulberry32(424242);
  const zoneW = ZONE_TILES;
  const w = zoneW * zones;
  const h = 36;
  const tiles = new Uint8Array(w * h);
  const variant = new Uint8Array(w * h);
  for (let i = 0; i < variant.length; i++) variant[i] = Math.floor(rand() * 4);
  const set = (x: number, y: number, t: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t;
  };
  const cy = Math.floor(h / 2);

  // outer border
  for (let x = 0; x < w; x++) {
    set(x, 0, Tile.Tree);
    set(x, h - 1, Tile.Tree);
  }
  for (let y = 0; y < h; y++) {
    set(0, y, Tile.Tree);
    set(w - 1, y, Tile.Tree);
  }

  const entrances: Vec2[] = [];
  const altars: Vec2[] = [];
  const keepClear: { x: number; y: number; r: number }[] = [];

  for (let z = 0; z < zones; z++) {
    const x0 = z * zoneW;
    entrances.push({ x: (x0 + 3.5) * TILE, y: (cy + 0.5) * TILE });
    keepClear.push({ x: x0 + 3, y: cy, r: 3 });
    // altar near the far (east) end of the zone
    const ax = x0 + zoneW - 7;
    const ay = 8 + Math.floor(rand() * (h - 16));
    altars.push({ x: (ax + 0.5) * TILE, y: (ay + 0.5) * TILE });
    keepClear.push({ x: ax, y: ay, r: 4 });
    // corridor to the next gate
    keepClear.push({ x: x0 + zoneW - 3, y: cy, r: 3 });

    // obstacle clusters
    const clusters = 30 + z * 4;
    for (let c = 0; c < clusters; c++) {
      let x = x0 + 2 + Math.floor(rand() * (zoneW - 4));
      let y = 2 + Math.floor(rand() * (h - 4));
      const kind: number = rand() < 0.55 ? Tile.Tree : Tile.Rock;
      const len = 2 + Math.floor(rand() * 6);
      for (let i = 0; i < len; i++) {
        set(x, y, kind);
        const d = Math.floor(rand() * 4);
        x = Math.max(x0 + 1, Math.min(x0 + zoneW - 2, x + [1, -1, 0, 0][d]));
        y = Math.max(1, Math.min(h - 2, y + [0, 0, 1, -1][d]));
      }
    }
  }
  // the Echoing Hollow cave mouth, in the middle of zone 1
  const caveTile = { x: Math.floor(zoneW * 0.5), y: 6 };
  keepClear.push({ x: caveTile.x, y: caveTile.y + 1, r: 3 });
  // clear around entrances, corridors and altars
  for (const k of keepClear)
    for (let y = k.y - k.r; y <= k.y + k.r; y++)
      for (let x = k.x - k.r; x <= k.x + k.r; x++)
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && (x - k.x) ** 2 + (y - k.y) ** 2 <= k.r * k.r + 1) set(x, y, Tile.Floor);
  // altar stones
  for (const a of altars) {
    const ax = Math.floor(a.x / TILE);
    const ay = Math.floor(a.y / TILE);
    for (let y = ay - 2; y <= ay + 2; y++)
      for (let x = ax - 2; x <= ax + 2; x++) if ((x - ax) ** 2 + (y - ay) ** 2 <= 5) set(x, y, Tile.Altar);
  }
  // walls between zones, each with a 3-tile barrier gate
  for (let z = 1; z < zones; z++) {
    const wx = z * zoneW;
    for (let y = 0; y < h; y++) {
      const gate = Math.abs(y - cy) <= 1;
      set(wx - 1, y, gate ? Tile.Gate : Tile.Rock);
      set(wx, y, gate ? Tile.Gate : Tile.Rock);
    }
  }

  // Flood fill from the start; anything the hero can't reach becomes rock.
  const seen = new Uint8Array(w * h);
  const start = cy * w + 3;
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (y + dy) * w + (x + dx);
      const t = tiles[n];
      if (!seen[n] && (t === Tile.Floor || t === Tile.Gate || t === Tile.Altar)) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  const zoneFloor: number[][] = Array.from({ length: zones }, () => []);
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Tile.Floor && !seen[i]) tiles[i] = Tile.Rock;
    if (tiles[i] === Tile.Floor) {
      const x = i % w;
      const z = Math.floor(x / zoneW);
      if (x % zoneW > 5) zoneFloor[z].push(i); // not right at the entrance
    }
  }

  const cave = { x: (caveTile.x + 0.5) * TILE, y: (caveTile.y + 0.5) * TILE };
  return { w, h, tiles, variant, zoneW, zones, entrances, altars, zoneFloor, kind: 'world', cave };
}

/**
 * A boss lair: a round chamber with a ring of brazier pillars, a summoning circle in the
 * middle (altars[0]) and an exit portal near the bottom of the screen.
 */
export function generateLair(chapter: number): GameMap {
  const w = 24;
  const h = 24;
  const c = 11.5;
  const radius = 10;
  const tiles = new Uint8Array(w * h).fill(Tile.Rock);
  const rand = mulberry32(777 + chapter);
  const variant = new Uint8Array(w * h);
  for (let i = 0; i < variant.length; i++) variant[i] = Math.floor(rand() * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - (c + 0.5), y + 0.5 - (c + 0.5));
      if (d <= radius) tiles[y * w + x] = d <= 2.3 ? Tile.Altar : Tile.Floor;
    }
  // brazier pillars
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const px = Math.round(c + Math.cos(a) * 6.5);
    const py = Math.round(c + Math.sin(a) * 6.5);
    tiles[py * w + px] = Tile.Pillar;
  }
  const centre = { x: (c + 0.5) * TILE, y: (c + 0.5) * TILE };
  // entrance toward the bottom of the screen (+x +y in world space)
  const dir = Math.SQRT1_2;
  const entrance = { x: centre.x + dir * 7.2 * TILE, y: centre.y + dir * 7.2 * TILE };
  const exit = { x: centre.x + dir * 8.6 * TILE, y: centre.y + dir * 8.6 * TILE };
  return {
    w, h, tiles, variant, zoneW: w, zones: 1, entrances: [entrance], altars: [centre], zoneFloor: [[]],
    kind: 'lair', palette: chapter, exit,
  };
}

export function zoneAtX(m: GameMap, x: number): number {
  return Math.max(0, Math.min(m.zones - 1, Math.floor(x / TILE / m.zoneW)));
}

/** 0 at the west edge of a zone, 1 at its east edge. */
export function depthInZone(m: GameMap, x: number): number {
  const z = zoneAtX(m, x);
  return Math.max(0, Math.min(1, (x / TILE - z * m.zoneW) / m.zoneW));
}

export function tileAt(m: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return Tile.Rock;
  return m.tiles[ty * m.w + tx];
}

/** Monsters can't cross barrier gates; the hero can. */
export function walkableTile(m: GameMap, tx: number, ty: number, mob = false): boolean {
  const t = tileAt(m, tx, ty);
  return t === Tile.Floor || t === Tile.Altar || (!mob && t === Tile.Gate);
}

export function walkablePoint(m: GameMap, x: number, y: number, mob = false): boolean {
  return walkableTile(m, Math.floor(x / TILE), Math.floor(y / TILE), mob);
}

/** Can a circle of radius r stand at (x, y)? */
export function fits(m: GameMap, x: number, y: number, r: number, mob = false): boolean {
  // Sample a grid over the circle's box no coarser than half a tile, so big bodies (bosses are
  // wider than a tile) can't straddle a pillar that sits between the corners.
  const n = Math.max(1, Math.ceil((2 * r) / (TILE * 0.5)));
  for (let i = 0; i <= n; i++) {
    const py = y - r + (2 * r * i) / n;
    for (let j = 0; j <= n; j++) {
      if (!walkablePoint(m, x - r + (2 * r * j) / n, py, mob)) return false;
    }
  }
  return true;
}

/** Moves a circle by (dx, dy), sliding along walls. Returns the new position. */
export function moveCircle(m: GameMap, x: number, y: number, dx: number, dy: number, r: number, mob = false) {
  let nx = x + dx;
  if (!fits(m, nx, y, r, mob)) nx = x;
  let ny = y + dy;
  if (!fits(m, nx, ny, r, mob)) ny = y;
  return { x: nx, y: ny };
}

export function lineOfSight(m: GameMap, x1: number, y1: number, x2: number, y2: number, r = 0, mob = false): boolean {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(d / 16);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (r ? !fits(m, x, y, r, mob) : !walkablePoint(m, x, y, mob)) return false;
  }
  return true;
}

/** A* on the tile grid (8 directions, no corner cutting). Returns world waypoints, smoothed. */
/** Scratch buffers shared by every findPath call (the game is single threaded). */
const pf = {
  n: 0,
  gen: 0,
  g: new Float32Array(0),
  came: new Int32Array(0),
  stamp: new Uint32Array(0),
  closed: new Uint32Array(0),
  heapI: new Int32Array(8192),
  heapF: new Float32Array(8192),
};
const growI = (a: Int32Array) => {
  const b = new Int32Array(a.length * 2);
  b.set(a);
  return b;
};
const growF = (a: Float32Array) => {
  const b = new Float32Array(a.length * 2);
  b.set(a);
  return b;
};
const findPathRetry = (m: GameMap, sx: number, sy: number, gx: number, gy: number, r: number, mob: boolean) => findPath(m, sx, sy, gx, gy, r, mob);

export function findPath(m: GameMap, sx: number, sy: number, gx: number, gy: number, r: number, mob = false): { x: number; y: number }[] | null {
  const start = [Math.floor(sx / TILE), Math.floor(sy / TILE)];
  let goal = [Math.floor(gx / TILE), Math.floor(gy / TILE)];
  if (!walkableTile(m, goal[0], goal[1], mob)) {
    // aim for the nearest walkable neighbour
    let best: number[] | null = null;
    let bd = Infinity;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const tx = goal[0] + dx;
        const ty = goal[1] + dy;
        if (walkableTile(m, tx, ty, mob) && dx * dx + dy * dy < bd) {
          bd = dx * dx + dy * dy;
          best = [tx, ty];
        }
      }
    if (!best) return null;
    goal = best;
  }
  const W = m.w;
  const N = m.w * m.h;
  const si = start[1] * W + start[0];
  const gi = goal[1] * W + goal[0];
  if (si === gi) return [{ x: gx, y: gy }];

  // Reused buffers: a generation stamp marks which cells were touched by this search, so nothing
  // needs clearing or reallocating between calls.
  if (pf.n !== N) {
    pf.n = N;
    pf.g = new Float32Array(N);
    pf.came = new Int32Array(N);
    pf.stamp = new Uint32Array(N);
    pf.closed = new Uint32Array(N);
    pf.gen = 0;
  }
  const gen = ++pf.gen;
  const G = pf.g, came = pf.came, stamp = pf.stamp, closed = pf.closed;
  const gx0 = goal[0], gy0 = goal[1];
  const hfn = (i: number) => {
    const x = i % W;
    const dx = Math.abs(x - gx0);
    const dy = Math.abs((i - x) / W - gy0);
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  };
  // binary min-heap of (f, cell)
  const hi = pf.heapI, hf = pf.heapF;
  let hn = 0;
  const push = (i: number, f: number) => {
    let k = hn++;
    hi[k] = i;
    hf[k] = f;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= hf[k]) break;
      [hi[p], hi[k]] = [hi[k], hi[p]];
      [hf[p], hf[k]] = [hf[k], hf[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = hi[0];
    hn--;
    hi[0] = hi[hn];
    hf[0] = hf[hn];
    let k = 0;
    for (;;) {
      const l = k * 2 + 1;
      const r2 = l + 1;
      let s = k;
      if (l < hn && hf[l] < hf[s]) s = l;
      if (r2 < hn && hf[r2] < hf[s]) s = r2;
      if (s === k) break;
      [hi[s], hi[k]] = [hi[k], hi[s]];
      [hf[s], hf[k]] = [hf[k], hf[s]];
      k = s;
    }
    return top;
  };
  stamp[si] = gen;
  G[si] = 0;
  came[si] = -1;
  push(si, 0);
  let found = false;
  let iterations = 0;
  while (hn > 0 && iterations++ < 6000) {
    const cur = pop();
    if (cur === gi) {
      found = true;
      break;
    }
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walkableTile(m, nx, ny, mob)) continue;
        if (dx && dy && (!walkableTile(m, cx + dx, cy, mob) || !walkableTile(m, cx, cy + dy, mob))) continue;
        const ni = ny * W + nx;
        const cost = G[cur] + (dx && dy ? 1.41 : 1);
        if (stamp[ni] !== gen || cost < G[ni]) {
          stamp[ni] = gen;
          G[ni] = cost;
          came[ni] = cur;
          if (hn >= hi.length) {
            pf.heapI = growI(hi);
            pf.heapF = growF(hf);
            return findPathRetry(m, sx, sy, gx, gy, r, mob);
          }
          push(ni, cost + hfn(ni));
        }
      }
  }
  if (!found && stamp[gi] !== gen) return null;

  const cells: { x: number; y: number }[] = [];
  for (let i = gi; i !== si && i !== -1; i = came[i]) {
    const x = i % W;
    cells.push({ x: (x + 0.5) * TILE, y: ((i - x) / W + 0.5) * TILE });
  }
  cells.reverse();
  cells[cells.length - 1] = { x: gx, y: gy };

  // String-pulling: skip waypoints we can walk straight past.
  const out: { x: number; y: number }[] = [];
  let ax = sx;
  let ay = sy;
  let k = 0;
  while (k < cells.length) {
    // walk forward while the straight line stays clear (linear, not quadratic, in path length)
    let far = k;
    for (let j = k + 1; j < cells.length && j - k < 24; j++) {
      if (lineOfSight(m, ax, ay, cells[j].x, cells[j].y, r, mob)) far = j;
      else break;
    }
    out.push(cells[far]);
    ax = cells[far].x;
    ay = cells[far].y;
    k = far + 1;
  }
  return out;
}

/**
 * The Echoing Hollow: a winding cave made with a cellular automaton. Entrance on the west,
 * monsters spread through the tunnels (zoneFloor[0]).
 */
export function generateCave(): GameMap {
  const w = 56;
  const h = 40;
  const rand = mulberry32(31337);
  let tiles = new Uint8Array(w * h);
  const variant = new Uint8Array(w * h);
  for (let i = 0; i < variant.length; i++) variant[i] = Math.floor(rand() * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      tiles[y * w + x] = edge || rand() < 0.44 ? Tile.Rock : Tile.Floor;
    }
  const cy = Math.floor(h / 2);
  for (let it = 0; it < 5; it++) {
    const next = new Uint8Array(tiles);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let rocks = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && tiles[(y + dy) * w + x + dx] === Tile.Rock) rocks++;
        next[y * w + x] = rocks >= 5 ? Tile.Rock : rocks <= 2 ? Tile.Floor : tiles[y * w + x];
      }
    tiles = next;
  }
  // a guaranteed tunnel from the entrance eastward so the cave always opens up
  for (let x = 2; x < w - 6; x++) {
    const yy = cy + Math.round(Math.sin(x / 5) * 5);
    for (let dy = -1; dy <= 1; dy++) tiles[(yy + dy) * w + x] = Tile.Floor;
  }
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = 2; x <= 6; x++) tiles[y * w + x] = Tile.Floor;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) tiles[y * w + x] = Tile.Rock;

  // keep only what's reachable from the entrance
  const seen = new Uint8Array(w * h);
  const start = cy * w + 3;
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (y + dy) * w + (x + dx);
      if (!seen[n] && tiles[n] === Tile.Floor) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  const floor: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Tile.Floor && !seen[i]) tiles[i] = Tile.Rock;
    if (tiles[i] === Tile.Floor && i % w > 9) floor.push(i);
  }
  const entrance = { x: 5.5 * TILE, y: (cy + 0.5) * TILE };
  const exit = { x: 2.6 * TILE, y: (cy + 0.5) * TILE };
  return {
    w, h, tiles, variant, zoneW: w, zones: 1, entrances: [entrance], altars: [], zoneFloor: [floor],
    kind: 'cave', palette: 4, exit,
  };
}
