// Map layouts and physics constants. World units: x to the right, y UP, ground at y = 0.

export interface Platform {
  x1: number;
  x2: number;
  y: number;
}

export interface MapLayout {
  width: number;
  platforms: Platform[];
}

export const PHYS = {
  gravity: 2000,
  jumpVel: 760, // max jump height = jumpVel^2 / (2 * gravity) = ~144
  playerSpeed: 270,
  mobSpeed: 55,
  bossSpeed: 85,
  dropTime: 0.25,
  attackRange: 70, // reach beyond the edge of the target
  skillRange: { strike: 150, cyclone: 230, starfall: 720 } as Record<string, number>,
  mobAggroRange: 240,
  maxMobs: 9,
  mobSpawnInterval: 0.9,
  manualTimeout: 2, // seconds after the last input before AUTO takes over again
  viewHeight: 430, // world units visible vertically
};

export const PLAYER_SIZE = { w: 44, h: 56 };
export const MOB_SIZE = { w: 58, h: 50 };
export const BOSS_SIZE = { w: 130, h: 118 };

/** One layout per chapter theme; they repeat when chapters loop. */
export const LAYOUTS: MapLayout[] = [
  // Sprout Meadow: gentle, one tier with a couple of high ledges
  {
    width: 2400,
    platforms: [
      { x1: 300, x2: 780, y: 130 },
      { x1: 460, x2: 640, y: 260 },
      { x1: 1000, x2: 1480, y: 130 },
      { x1: 1720, x2: 2180, y: 130 },
      { x1: 1850, x2: 2060, y: 260 },
    ],
  },
  // Whisper Woods: staggered branches
  {
    width: 2700,
    platforms: [
      { x1: 200, x2: 600, y: 125 },
      { x1: 700, x2: 1100, y: 250 },
      { x1: 1150, x2: 1550, y: 125 },
      { x1: 1600, x2: 2000, y: 250 },
      { x1: 2050, x2: 2500, y: 125 },
    ],
  },
  // Ember Canyon: long ledges
  {
    width: 2800,
    platforms: [
      { x1: 150, x2: 1000, y: 135 },
      { x1: 1250, x2: 2500, y: 135 },
      { x1: 600, x2: 900, y: 270 },
      { x1: 1600, x2: 2100, y: 270 },
    ],
  },
  // Frostpeak: many small ledges
  {
    width: 2600,
    platforms: [
      { x1: 250, x2: 520, y: 120 },
      { x1: 640, x2: 900, y: 240 },
      { x1: 1020, x2: 1300, y: 120 },
      { x1: 1180, x2: 1420, y: 250 },
      { x1: 1560, x2: 1840, y: 130 },
      { x1: 1960, x2: 2250, y: 240 },
      { x1: 2100, x2: 2400, y: 120 },
    ],
  },
  // Skyreach Ruins: towers
  {
    width: 3000,
    platforms: [
      { x1: 300, x2: 700, y: 130 },
      { x1: 400, x2: 600, y: 260 },
      { x1: 1100, x2: 1900, y: 130 },
      { x1: 1300, x2: 1700, y: 260 },
      { x1: 2300, x2: 2700, y: 130 },
      { x1: 2400, x2: 2600, y: 260 },
    ],
  },
];

export interface Surface extends Platform {
  index: number; // -1 = ground
}

export function surfaces(layout: MapLayout): Surface[] {
  return [
    { x1: 0, x2: layout.width, y: 0, index: -1 },
    ...layout.platforms.map((p, i) => ({ ...p, index: i })),
  ];
}

export function surfaceAt(layout: MapLayout, index: number): Surface {
  if (index < 0) return { x1: 0, x2: layout.width, y: 0, index: -1 };
  return { ...layout.platforms[index], index };
}
