// Tile maps, collision and pathfinding. World units: a flat (x, y) ground plane.
// The renderer projects it isometrically; game logic never needs to know about that.

export const TILE = 64;

export const Tile = { Floor: 0, Rock: 1, Tree: 2 } as const;

export const PHYS = {
  playerSpeed: 230,
  playerRadius: 18,
  mobSpeed: 70,
  mobRadius: 22,
  bossSpeed: 95,
  bossRadius: 46,
  mobAggroRange: 330,
  maxMobs: 12,
  mobSpawnInterval: 0.8,
  manualTimeout: 2,
};

export interface GameMap {
  w: number; // tiles
  h: number;
  tiles: Uint8Array;
  variant: Uint8Array; // cosmetic floor variation 0..3
  spawn: { x: number; y: number }; // world units
  floorTiles: number[]; // indexes of reachable floor tiles
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

/** Builds the map for a chapter. The same chapter always produces the same map. */
export function generateMap(chapterIndex: number): GameMap {
  const rand = mulberry32(1000 + chapterIndex * 7919);
  const w = 34 + (chapterIndex % 3) * 3;
  const h = 34 + (chapterIndex % 2) * 3;
  const tiles = new Uint8Array(w * h);
  const variant = new Uint8Array(w * h);
  for (let i = 0; i < variant.length; i++) variant[i] = Math.floor(rand() * 4);

  // borders
  for (let x = 0; x < w; x++) {
    tiles[x] = Tile.Tree;
    tiles[(h - 1) * w + x] = Tile.Tree;
  }
  for (let y = 0; y < h; y++) {
    tiles[y * w] = Tile.Tree;
    tiles[y * w + w - 1] = Tile.Tree;
  }

  // obstacle clusters (random walks)
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const clusters = 26 + chapterIndex * 2;
  for (let c = 0; c < clusters; c++) {
    let x = 2 + Math.floor(rand() * (w - 4));
    let y = 2 + Math.floor(rand() * (h - 4));
    const kind: number = rand() < 0.55 ? Tile.Tree : Tile.Rock;
    const len = 2 + Math.floor(rand() * 6);
    for (let i = 0; i < len; i++) {
      if (Math.abs(x - cx) > 3 || Math.abs(y - cy) > 3) tiles[y * w + x] = kind;
      const d = Math.floor(rand() * 4);
      x = Math.max(1, Math.min(w - 2, x + [1, -1, 0, 0][d]));
      y = Math.max(1, Math.min(h - 2, y + [0, 0, 1, -1][d]));
    }
  }

  // Flood fill from the centre; anything unreachable becomes rock so nothing spawns there.
  const seen = new Uint8Array(w * h);
  const queue = [cy * w + cx];
  seen[cy * w + cx] = 1;
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
  const floorTiles: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Tile.Floor && !seen[i]) tiles[i] = Tile.Rock;
    if (tiles[i] === Tile.Floor) floorTiles.push(i);
  }

  return { w, h, tiles, variant, spawn: { x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE }, floorTiles };
}

export function tileAt(m: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return Tile.Rock;
  return m.tiles[ty * m.w + tx];
}

export function walkableTile(m: GameMap, tx: number, ty: number): boolean {
  return tileAt(m, tx, ty) === Tile.Floor;
}

export function walkablePoint(m: GameMap, x: number, y: number): boolean {
  return walkableTile(m, Math.floor(x / TILE), Math.floor(y / TILE));
}

/** Can a circle of radius r stand at (x, y)? */
export function fits(m: GameMap, x: number, y: number, r: number): boolean {
  return (
    walkablePoint(m, x - r, y - r) && walkablePoint(m, x + r, y - r) &&
    walkablePoint(m, x - r, y + r) && walkablePoint(m, x + r, y + r)
  );
}

/** Moves a circle by (dx, dy), sliding along walls. Returns the new position. */
export function moveCircle(m: GameMap, x: number, y: number, dx: number, dy: number, r: number) {
  let nx = x + dx;
  if (!fits(m, nx, y, r)) nx = x;
  let ny = y + dy;
  if (!fits(m, nx, ny, r)) ny = y;
  return { x: nx, y: ny };
}

export function lineOfSight(m: GameMap, x1: number, y1: number, x2: number, y2: number, r = 0): boolean {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(d / 16);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (r ? !fits(m, x, y, r) : !walkablePoint(m, x, y)) return false;
  }
  return true;
}

/** A* on the tile grid (8 directions, no corner cutting). Returns world waypoints, smoothed. */
export function findPath(m: GameMap, sx: number, sy: number, gx: number, gy: number, r: number): { x: number; y: number }[] | null {
  const start = [Math.floor(sx / TILE), Math.floor(sy / TILE)];
  let goal = [Math.floor(gx / TILE), Math.floor(gy / TILE)];
  if (!walkableTile(m, goal[0], goal[1])) {
    // aim for the nearest walkable neighbour
    let best: number[] | null = null;
    let bd = Infinity;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const tx = goal[0] + dx;
        const ty = goal[1] + dy;
        if (walkableTile(m, tx, ty) && dx * dx + dy * dy < bd) {
          bd = dx * dx + dy * dy;
          best = [tx, ty];
        }
      }
    if (!best) return null;
    goal = best;
  }
  const W = m.w;
  const si = start[1] * W + start[0];
  const gi = goal[1] * W + goal[0];
  if (si === gi) return [{ x: gx, y: gy }];

  const g = new Float32Array(m.w * m.h).fill(Infinity);
  const came = new Int32Array(m.w * m.h).fill(-1);
  const closed = new Uint8Array(m.w * m.h);
  const open: { i: number; f: number }[] = [{ i: si, f: 0 }];
  g[si] = 0;
  const hfn = (i: number) => {
    const x = i % W;
    const y = (i - x) / W;
    const dx = Math.abs(x - goal[0]);
    const dy = Math.abs(y - goal[1]);
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  };
  let iterations = 0;
  while (open.length && iterations++ < 4000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const cur = open.splice(bi, 1)[0].i;
    if (cur === gi) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walkableTile(m, nx, ny)) continue;
        if (dx && dy && (!walkableTile(m, cx + dx, cy) || !walkableTile(m, cx, cy + dy))) continue;
        const ni = ny * W + nx;
        const cost = g[cur] + (dx && dy ? 1.41 : 1);
        if (cost < g[ni]) {
          g[ni] = cost;
          came[ni] = cur;
          open.push({ i: ni, f: cost + hfn(ni) });
        }
      }
  }
  if (came[gi] === -1) return null;

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
    let far = k;
    for (let j = cells.length - 1; j > k; j--) {
      if (lineOfSight(m, ax, ay, cells[j].x, cells[j].y, r)) {
        far = j;
        break;
      }
    }
    out.push(cells[far]);
    ax = cells[far].x;
    ay = cells[far].y;
    k = far + 1;
  }
  return out;
}
