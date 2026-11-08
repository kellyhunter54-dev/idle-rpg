// All game content and balance numbers live here so they are easy to tweak.

export type Rarity = 'common' | 'rare' | 'epic' | 'unique' | 'legendary';
export type Slot = 'weapon' | 'armor' | 'accessory';

export const BALANCE = {
  killsPerStage: 15,
  bossTimeLimit: 180, // seconds until the boss enrages (faster, harder hits)
  bossActionEvery: [2.6, 2.0, 1.5], // seconds between special attacks per phase
  bossEnragedEvery: 1.05,
  bossEnrageDamage: 1.5,
  bossPhaseAt: [0.6, 0.25],
  bossMeleePct: 0.22,
  // The Echoing Hollow (manual-only cave)
  caveExpMult: 2.5,
  caveGoldMult: 1.5,
  caveCamps: 26,
  caveRespawn: [6, 10] as number[],
  caveLevelBonus: 2, // monsters are your level up to this many levels higher (deeper = higher)
  flaskCharges: 3,
  flaskHeal: 0.45,
  flaskRegen: 45, // seconds per charge while out in the world
  bossHpMult: [80, 110, 170] as number[], // per zone
  bossRespawn: 30, // seconds before a beaten boss can be fought again
  bossLeash: 900, // boss resets if you run this far from its altar
  bossAtkMult: 1.6,
  bossGoldMult: 10,
  bossExpMult: 10,

  mobHpBase: 3000,
  mobHpGrowth: 1.25, // per monster level
  mobAtkBase: 45,
  mobAtkGrowth: 1.22,
  goldBase: 3,
  goldGrowth: 1.22,
  expBase: 3,
  expGrowth: 1.13,

  gemDropChance: 0.04,
  bossFirstClearGems: 30,

  respawnDelay: 0.6,
  playerDeathDelay: 2,
  playerAttackInterval: 1.0,
  mobAttackInterval: 1.6,
  companionAttackInterval: 1.5,
  healOnKillPct: 0.15,
  baseCritDmg: 1.5,

  offlineCapHours: 8,
  offlineEfficiency: 0.5,
  offlineMinSeconds: 60,

  summonCost: 50,
  summon10Cost: 450,
  startingGems: 1000,

  partySize: 3,
  ownedEffectRatio: 0.2, // "owned" bonus is 20% of the equipped bonus
};

export interface RarityDef {
  id: Rarity;
  name: string;
  color: string;
  weight: number; // summon weight
  mult: number; // power multiplier
}

export const RARITIES: RarityDef[] = [
  { id: 'common', name: 'Common', color: '#9aa4b2', weight: 60, mult: 1 },
  { id: 'rare', name: 'Rare', color: '#4ea1ff', weight: 28, mult: 2.5 },
  { id: 'epic', name: 'Epic', color: '#b46cff', weight: 9, mult: 6 },
  { id: 'unique', name: 'Unique', color: '#ffc23d', weight: 2.6, mult: 15 },
  { id: 'legendary', name: 'Legendary', color: '#5dff9b', weight: 0.4, mult: 40 },
];

export const RARITY: Record<Rarity, RarityDef> = Object.fromEntries(
  RARITIES.map((r) => [r.id, r]),
) as Record<Rarity, RarityDef>;

export function rarityIndex(r: Rarity): number {
  return RARITIES.findIndex((x) => x.id === r);
}

// ---------- Player level ----------
export function expToNext(level: number): number {
  return Math.floor(650 * Math.pow(1.18, level - 1));
}
/**
 * Your level is the main source of power: base ATK and HP grow at about the same rate
 * monsters get tougher, so out-levelling something really matters.
 */
export const LEVEL_POWER = { atkBase: 30, atkGrowth: 1.25, hpBase: 160, hpGrowth: 1.22 };
export function levelBaseAtk(level: number): number {
  return LEVEL_POWER.atkBase * Math.pow(LEVEL_POWER.atkGrowth, level - 1);
}
export function levelBaseHp(level: number): number {
  return LEVEL_POWER.hpBase * Math.pow(LEVEL_POWER.hpGrowth, level - 1);
}

// ---------- Growth (gold upgrades) ----------
export type GrowthKey = 'atk' | 'hp' | 'critRate' | 'critDmg';

export interface GrowthDef {
  key: GrowthKey;
  name: string;
  icon: string;
  max: number;
  value: (lvl: number) => number;
  cost: (lvl: number) => number;
  display: 'flat' | 'pct';
}

export const GROWTH: GrowthDef[] = [
  {
    key: 'atk', name: 'Attack', icon: '⚔️', max: Infinity, display: 'pct',
    value: (l) => l * 0.03, // +3% ATK per upgrade, on top of your level
    cost: (l) => 10 * Math.pow(1.09, l),
  },
  {
    key: 'hp', name: 'Max HP', icon: '❤️', max: Infinity, display: 'pct',
    value: (l) => l * 0.03, // +3% HP per upgrade
    cost: (l) => 10 * Math.pow(1.09, l),
  },
  {
    key: 'critRate', name: 'Crit Rate', icon: '🎯', max: 250, display: 'pct',
    value: (l) => l * 0.002,
    cost: (l) => 50 * Math.pow(1.09, l),
  },
  {
    key: 'critDmg', name: 'Crit Damage', icon: '💥', max: Infinity, display: 'pct',
    value: (l) => l * 0.01,
    cost: (l) => 40 * Math.pow(1.08, l),
  },
];

// ---------- Gear ----------
export const SLOTS: Slot[] = ['weapon', 'armor', 'accessory'];
export const SLOT_INFO: Record<Slot, { name: string; icon: string; stat: string }> = {
  weapon: { name: 'Weapon', icon: '🗡️', stat: 'ATK' },
  armor: { name: 'Armor', icon: '🛡️', stat: 'HP' },
  accessory: { name: 'Accessory', icon: '💍', stat: 'Crit DMG' },
};
const SLOT_BASE: Record<Slot, number> = { weapon: 0.1, armor: 0.1, accessory: 0.08 };

export const TIERS = [1, 2, 3, 4]; // higher is better
export const TIER_WEIGHTS = [50, 30, 15, 5];
export const TIER_NAMES = ['I', 'II', 'III', 'IV'];

export function gearId(slot: Slot, rarity: Rarity, tier: number): string {
  return `${slot}:${rarity}:${tier}`;
}
export function parseGear(id: string): { slot: Slot; rarity: Rarity; tier: number } {
  const [slot, rarity, tier] = id.split(':');
  return { slot: slot as Slot, rarity: rarity as Rarity, tier: Number(tier) };
}
export function gearName(id: string): string {
  const g = parseGear(id);
  return `${RARITY[g.rarity].name} ${SLOT_INFO[g.slot].name} ${TIER_NAMES[g.tier - 1]}`;
}
/** Equipped bonus as a fraction, e.g. 0.25 = +25% */
export function gearEffect(id: string, level: number): number {
  const g = parseGear(id);
  const tierF = 1 + (g.tier - 1) * 0.5;
  return SLOT_BASE[g.slot] * RARITY[g.rarity].mult * tierF * (1 + 0.25 * level);
}
export function gearScore(id: string, level: number): number {
  return gearEffect(id, level);
}
/** Extra copies needed to go from `level` to `level + 1`. */
export function enhanceCopies(level: number): number {
  return level + 1;
}

// ---------- Companions ----------
export interface CompanionDef {
  id: string;
  name: string;
  rarity: Rarity;
  icon: string;
  color: string;
}

export const COMPANIONS: CompanionDef[] = [
  { id: 'sprout', name: 'Sprout', rarity: 'common', icon: '🌱', color: '#7bd389' },
  { id: 'pebble', name: 'Pebble', rarity: 'common', icon: '🪨', color: '#a8a29e' },
  { id: 'puff', name: 'Puff', rarity: 'common', icon: '☁️', color: '#e5e7eb' },
  { id: 'emberfox', name: 'Ember Fox', rarity: 'rare', icon: '🦊', color: '#ff8a4c' },
  { id: 'tideotter', name: 'Tide Otter', rarity: 'rare', icon: '🦦', color: '#4cc9f0' },
  { id: 'mossgolem', name: 'Moss Golem', rarity: 'rare', icon: '🗿', color: '#6a994e' },
  { id: 'stormowl', name: 'Storm Owl', rarity: 'epic', icon: '🦉', color: '#9d4edd' },
  { id: 'frostlynx', name: 'Frost Lynx', rarity: 'epic', icon: '🐈', color: '#90e0ef' },
  { id: 'sundrake', name: 'Sun Drake', rarity: 'unique', icon: '🐉', color: '#ffb703' },
  { id: 'voidkitsune', name: 'Void Kitsune', rarity: 'legendary', icon: '🌌', color: '#c77dff' },
];
export const COMPANION: Record<string, CompanionDef> = Object.fromEntries(
  COMPANIONS.map((c) => [c.id, c]),
);

/** Each hit deals player ATK x this. */
export function companionHitMult(id: string, level: number): number {
  return 0.2 * RARITY[COMPANION[id].rarity].mult * (1 + 0.25 * level);
}
/** Owned bonus: +ATK% for every companion you own. */
export function companionOwnedAtk(id: string, level: number): number {
  return 0.02 * RARITY[COMPANION[id].rarity].mult * (1 + 0.25 * level);
}

// ---------- Jobs & skills ----------
export type JobId = 'warrior' | 'archer' | 'mage';

/** How a skill behaves. game.ts implements each type. */
export type SkillType =
  | 'dash' // dash toward aim, hitting everything along the way
  | 'spin' // hit everything around you
  | 'groundAoe' // delayed blast at the aimed spot
  | 'pierce' // fast projectile that passes through enemies
  | 'fan' // spread of projectiles
  | 'fireball'; // projectile that explodes on impact

export interface SkillDef {
  id: string;
  name: string;
  type: SkillType;
  unlock: number; // player level
  cd: number;
  mult: number; // x ATK per hit
  color: string;
  icon: string;
  radius?: number; // spin / groundAoe / fireball explosion
  range?: number; // how far it can be aimed or travel
  delay?: number; // groundAoe delay
  count?: number; // fan projectiles
}

export interface BasicAttack {
  kind: 'melee' | 'arrow' | 'bolt';
  range: number; // melee: reach beyond your body; ranged: max travel distance
  interval: number; // seconds between attacks
  mult: number; // x ATK
  speed?: number; // projectile speed
  splash?: number; // bolt explosion radius
}

export interface JobDef {
  id: JobId;
  name: string;
  icon: string;
  color: string; // cloak / theme color
  desc: string;
  basic: BasicAttack;
  atkMult: number;
  hpMult: number;
  critBonus: number;
  damageTaken: number; // 1 = normal, 0.65 = takes 35% less
  skills: SkillDef[];
}

export const JOBS: Record<JobId, JobDef> = {
  warrior: {
    id: 'warrior', name: 'Warrior', icon: '🛡️', color: '#3d5a80',
    desc: 'Up close and sturdy. Cleaves groups with every swing, has the most HP and takes 35% less damage.',
    basic: { kind: 'melee', range: 80, interval: 1.0, mult: 1 },
    atkMult: 1.3, hpMult: 1.5, critBonus: 0, damageTaken: 0.65,
    skills: [
      { id: 'dash', name: 'Dash Strike', type: 'dash', unlock: 1, cd: 4, mult: 3, color: '#ffd166', icon: '⚡', range: 190 },
      { id: 'whirl', name: 'Whirlwind', type: 'spin', unlock: 8, cd: 10, mult: 8, color: '#4ecdc4', icon: '🌀', radius: 160 },
      { id: 'quake', name: 'Earthshatter', type: 'groundAoe', unlock: 20, cd: 25, mult: 25, color: '#d4a373', icon: '💥', radius: 180, range: 260, delay: 0.35 },
    ],
  },
  archer: {
    id: 'archer', name: 'Archer', icon: '🏹', color: '#4f6d3a',
    desc: 'Fast arrows from a distance. Keeps away from enemies and crits more often.',
    basic: { kind: 'arrow', range: 390, interval: 0.75, mult: 0.7, speed: 950 },
    atkMult: 0.85, hpMult: 0.85, critBonus: 0.05, damageTaken: 1,
    skills: [
      { id: 'pierce', name: 'Piercing Arrow', type: 'pierce', unlock: 1, cd: 4, mult: 3, color: '#e9c46a', icon: '➶', range: 620 },
      { id: 'rain', name: 'Arrow Rain', type: 'groundAoe', unlock: 8, cd: 10, mult: 8, color: '#90be6d', icon: '🌧️', radius: 150, range: 460, delay: 0.6 },
      { id: 'volley', name: 'Volley', type: 'fan', unlock: 20, cd: 25, mult: 10, color: '#f4a261', icon: '🎯', range: 480, count: 7 },
    ],
  },
  mage: {
    id: 'mage', name: 'Mage', icon: '🔮', color: '#5a3d80',
    desc: 'Exploding spells that hit groups. Hardest hitter, but fragile.',
    basic: { kind: 'bolt', range: 390, interval: 1.1, mult: 1.2, speed: 650, splash: 55 },
    atkMult: 0.9, hpMult: 0.8, critBonus: 0, damageTaken: 1,
    skills: [
      { id: 'fireball', name: 'Fireball', type: 'fireball', unlock: 1, cd: 4, mult: 3.5, color: '#f3722c', icon: '🔥', radius: 110, range: 460 },
      { id: 'nova', name: 'Frost Nova', type: 'spin', unlock: 8, cd: 10, mult: 8, color: '#90e0ef', icon: '❄️', radius: 185 },
      { id: 'meteor', name: 'Meteor', type: 'groundAoe', unlock: 20, cd: 25, mult: 27, color: '#c77dff', icon: '☄️', radius: 155, range: 460, delay: 0.6 },
    ],
  },
};

export const JOB_LIST: JobDef[] = [JOBS.warrior, JOBS.archer, JOBS.mage];

export function jobOf(state: { job?: string }): JobDef {
  return JOBS[(state.job as JobId) ?? 'warrior'] ?? JOBS.warrior;
}

// ---------- World ----------
export interface ChapterDef {
  name: string;
  sky: [string, string];
  ground: string;
  mobs: { name: string; color: string }[];
  boss: string;
  floor: [string, string]; // isometric floor tile colors (two shades)
  tree: string;
  rock: string;
}

export const CHAPTERS: ChapterDef[] = [
  {
    name: 'Sprout Meadow', sky: ['#9be7ff', '#e0f7ff'], ground: '#6cbf5a',
    mobs: [{ name: 'Jelly', color: '#7ee081' }, { name: 'Beetle', color: '#c08552' }, { name: 'Sprig', color: '#a7c957' }],
    boss: 'King Jelly',
    floor: ['#3f5a2c', '#46632f'], tree: '#1f3d1c', rock: '#6b6b5e',
  },
  {
    name: 'Whisper Woods', sky: ['#4a6c4f', '#a3c9a8'], ground: '#3d5a3a',
    mobs: [{ name: 'Shroomling', color: '#e76f51' }, { name: 'Bark Imp', color: '#8d6e63' }, { name: 'Wisp', color: '#b8f2e6' }],
    boss: 'Elder Treant',
    floor: ['#2c3a2a', '#31402e'], tree: '#14261a', rock: '#55594c',
  },
  {
    name: 'Ember Canyon', sky: ['#ff9e64', '#ffd6a5'], ground: '#9c4a1a',
    mobs: [{ name: 'Cinder', color: '#ff5400' }, { name: 'Scorpid', color: '#c1121f' }, { name: 'Ash Bat', color: '#6d6875' }],
    boss: 'Magma Titan',
    floor: ['#5a3524', '#633b28'], tree: '#3a1f14', rock: '#7a4a32',
  },
  {
    name: 'Frostpeak', sky: ['#a9d6e5', '#edf6f9'], ground: '#cfe8f3',
    mobs: [{ name: 'Snowpup', color: '#ffffff' }, { name: 'Ice Sprite', color: '#90e0ef' }, { name: 'Yeti Cub', color: '#d9d9d9' }],
    boss: 'Glacier Wyrm',
    floor: ['#8fa3b0', '#9aaebb'], tree: '#2f4a52', rock: '#c7d3da',
  },
  {
    name: 'Skyreach Ruins', sky: ['#3a0ca3', '#7209b7'], ground: '#4a4e69',
    mobs: [{ name: 'Gargoyle', color: '#9a8c98' }, { name: 'Rune Eye', color: '#f72585' }, { name: 'Sky Ray', color: '#4cc9f0' }],
    boss: 'The Warden',
    floor: ['#34304a', '#3a3552'], tree: '#1e1b2e', rock: '#5e5878',
  },
];

export const STAGES_PER_CHAPTER = 10;

export function chapterOf(stage: number): { def: ChapterDef; chapter: number; sub: number; loop: number } {
  const chapter = Math.floor((stage - 1) / STAGES_PER_CHAPTER);
  const sub = ((stage - 1) % STAGES_PER_CHAPTER) + 1;
  return { def: CHAPTERS[chapter % CHAPTERS.length], chapter: chapter + 1, sub, loop: Math.floor(chapter / CHAPTERS.length) };
}

export function stageLabel(stage: number): string {
  const c = chapterOf(stage);
  const loop = c.loop > 0 ? ` +${c.loop}` : '';
  return `${c.def.name}${loop} ${c.chapter}-${c.sub}`;
}

export interface MobStats {
  level: number;
  name: string;
  color: string;
  hp: number;
  atk: number;
  gold: number;
  exp: number;
  boss: boolean;
}

/** @deprecated stage-based mobs from before zones; kept for the old offline formula. */
export function mobFor(stage: number, boss: boolean, rand = Math.random): MobStats {
  const B = BALANCE;
  const n = stage - 1;
  const c = chapterOf(stage).def;
  const pick = c.mobs[Math.floor(rand() * c.mobs.length)];
  const hp = B.mobHpBase * Math.pow(B.mobHpGrowth, n);
  const atk = B.mobAtkBase * Math.pow(B.mobAtkGrowth, n);
  const gold = B.goldBase * Math.pow(B.goldGrowth, n);
  const exp = B.expBase * Math.pow(B.expGrowth, n);
  if (!boss) return { level: stage, name: pick.name, color: pick.color, hp, atk, gold, exp, boss };
  return {
    level: stage, name: c.boss, color: pick.color, boss,
    hp: hp * B.bossHpMult[0], atk: atk * B.bossAtkMult,
    gold: gold * B.bossGoldMult, exp: exp * B.bossExpMult,
  };
}

// ---------- Zones ----------
export interface ZoneDef {
  name: string;
  minLevel: number; // monster level at the entrance
  maxLevel: number; // monster level at the far end
  bossLevel: number;
  chapter: number; // index into CHAPTERS for colors, monsters and boss name
  /** Items you must bring to summon the boss in its lair. Empty = free (for now). */
  offering: { item: string; count: number }[];
  /** The boss's moves in each phase (phase 2 at 60% HP, phase 3 at 25%). */
  bossKit: BossMove[][];
}

/**
 * Boss attacks. All are telegraphed on the ground first.
 *  slam: circle under you        chase: 3 slams that follow you      cone: breath in front of the boss
 *  charge: line, boss rushes it   nova: ring around the boss (hug it)  rain: scattered circles near you
 *  cross: two lines crossing at your position                         adds: calls minions
 */
export type BossMove = 'slam' | 'chase' | 'cone' | 'charge' | 'nova' | 'rain' | 'cross' | 'adds';

/** Share of your max HP each boss attack takes at equal level (before your job's damage reduction). */
export const BOSS_MOVE_PCT: Record<BossMove, number> = {
  slam: 0.45, chase: 0.3, cone: 0.4, charge: 0.5, nova: 0.4, rain: 0.3, cross: 0.4, adds: 0,
};

/**
 * How much of that %HP damage still lands when you out-level (or under-level) the boss.
 * Equal level = 100%, +6 levels = ~55%, +10 = ~25%, below the boss it gets worse.
 */
export function bossPctScale(bossLevel: number, playerLevel: number): number {
  const d = playerLevel - bossLevel;
  return Math.max(0.12, Math.min(1.3, 1 - 0.075 * d));
}

export const ZONES: ZoneDef[] = [
  {
    name: 'Sprout Meadow', minLevel: 1, maxLevel: 10, bossLevel: 12, chapter: 0, offering: [],
    bossKit: [['slam', 'cone', 'charge'], ['slam', 'chase', 'cone', 'adds'], ['chase', 'nova', 'rain', 'charge']],
  },
  {
    name: 'Whisper Woods', minLevel: 10, maxLevel: 20, bossLevel: 22, chapter: 1, offering: [],
    bossKit: [['cross', 'nova', 'slam'], ['cross', 'rain', 'adds', 'nova'], ['cross', 'chase', 'rain', 'nova']],
  },
  {
    name: 'Ember Canyon', minLevel: 20, maxLevel: 30, bossLevel: 32, chapter: 2, offering: [],
    bossKit: [['charge', 'rain', 'slam'], ['charge', 'nova', 'rain', 'cross', 'adds'], ['chase', 'charge', 'rain', 'cross', 'nova']],
  },
];

export const CAVE = { name: 'Echoing Hollow', zone: 99 };

export function bossName(z: number): string {
  return CHAPTERS[(ZONES[z] ?? ZONES[0]).chapter].boss;
}

export function zoneLabel(z: number): string {
  const d = ZONES[z] ?? ZONES[0];
  return `${d.name} (Lv ${d.minLevel}-${d.maxLevel})`;
}

/** Brand new heroes are weak, so the first few monster levels are much softer. */
function earlyRamp(level: number): number {
  return Math.min(1, 0.02 * Math.pow(1.9, level - 1));
}

/** Monster stats for a level in a zone. Bosses use the zone's boss. */
export function mobForZone(zone: number, level: number, boss: boolean, rand = Math.random): MobStats {
  const B = BALANCE;
  const z = ZONES[zone] ?? ZONES[0];
  const c = CHAPTERS[z.chapter];
  const pick = c.mobs[Math.floor(rand() * c.mobs.length)];
  const n = level - 1;
  const hp = B.mobHpBase * Math.pow(B.mobHpGrowth, n) * earlyRamp(level);
  const atk = B.mobAtkBase * Math.pow(B.mobAtkGrowth, n) * Math.sqrt(earlyRamp(level));
  const gold = B.goldBase * Math.pow(B.goldGrowth, n);
  const exp = B.expBase * Math.pow(B.expGrowth, n);
  if (!boss) return { level, name: pick.name, color: pick.color, hp, atk, gold, exp, boss };
  return {
    level, name: c.boss, color: pick.color, boss,
    hp: hp * (B.bossHpMult[zone] ?? B.bossHpMult[B.bossHpMult.length - 1]), atk: atk * B.bossAtkMult,
    gold: gold * B.bossGoldMult, exp: exp * B.bossExpMult,
  };
}

/**
 * EXP multiplier for killing a monster of `mobLevel` at `playerLevel`.
 * Higher monsters give a bonus; anything more than a few levels below gives almost nothing.
 */
export function expLevelMult(mobLevel: number, playerLevel: number): number {
  const d = mobLevel - playerLevel;
  if (d >= 0) return Math.min(1.5, 1 + 0.1 * d);
  return Math.max(0.02, 1 + 0.16 * d);
}

/** Damage the hero deals to a monster above their level is reduced... */
export function dealtLevelMult(mobLevel: number, playerLevel: number): number {
  const d = mobLevel - playerLevel;
  return d > 0 ? Math.max(0.25, 1 - 0.08 * d) : 1;
}

/** ...and damage it deals to the hero is increased. */
export function takenLevelMult(mobLevel: number, playerLevel: number): number {
  const d = mobLevel - playerLevel;
  return d > 0 ? 1 + 0.15 * d : Math.max(0.5, 1 + 0.03 * d);
}

/** Text color for a monster's level compared to yours (classic MMO con colors). */
export function levelColor(mobLevel: number, playerLevel: number): string {
  const d = mobLevel - playerLevel;
  if (d >= 5) return '#ff3b3b';
  if (d >= 3) return '#ff8c3b';
  if (d >= -2) return '#f2e6c9';
  if (d >= -6) return '#7bd389';
  return '#8a8a8a';
}
