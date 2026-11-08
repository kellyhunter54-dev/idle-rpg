// Tile maps, collision and pathfinding. World units: a flat (x, y) ground plane.
// The renderer projects it isometrically; game logic never needs to know about that.

export const TILE = 64;
/** Width of each zone in tiles. */
export const ZONE_TILES = 40;

export const Tile = { Floor: 0, Rock: 1, Tree: 2, Gate: 3, Altar: 4 } as const;

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

  return { w, h, tiles, variant, zoneW, zones, entrances, altars, zoneFloor };
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
  return (
    walkablePoint(m, x - r, y - r, mob) && walkablePoint(m, x + r, y - r, mob) &&
    walkablePoint(m, x - r, y + r, mob) && walkablePoint(m, x + r, y + r, mob)
  );
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
  while (open.length && iterations++ < 6000) {
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
        if (!walkableTile(m, nx, ny, mob)) continue;
        if (dx && dy && (!walkableTile(m, cx + dx, cy, mob) || !walkableTile(m, cx, cy + dy, mob))) continue;
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
      if (lineOfSight(m, ax, ay, cells[j].x, cells[j].y, r, mob)) {
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
