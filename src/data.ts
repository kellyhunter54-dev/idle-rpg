// All game content and balance numbers live here so they are easy to tweak.

export type Rarity = 'common' | 'rare' | 'epic' | 'unique' | 'legendary';
export type Slot = 'weapon' | 'armor' | 'accessory';

export const BALANCE = {
  killsPerStage: 15,
  bossTimeLimit: 30, // seconds
  bossHpMult: 8,
  bossAtkMult: 1.6,
  bossGoldMult: 10,
  bossExpMult: 10,

  mobHpBase: 40,
  mobHpGrowth: 1.13, // per stage
  mobAtkBase: 3,
  mobAtkGrowth: 1.115,
  goldBase: 3,
  goldGrowth: 1.13,
  expBase: 4,
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
  return Math.floor(25 * Math.pow(1.12, level - 1) + 10 * level);
}
export function levelBaseAtk(level: number): number {
  return 10 + 3 * (level - 1);
}
export function levelBaseHp(level: number): number {
  return 100 + 20 * (level - 1);
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
    key: 'atk', name: 'Attack', icon: '⚔️', max: Infinity, display: 'flat',
    value: (l) => 100 * (Math.pow(1.05, l) - 1),
    cost: (l) => 10 * Math.pow(1.07, l),
  },
  {
    key: 'hp', name: 'Max HP', icon: '❤️', max: Infinity, display: 'flat',
    value: (l) => 500 * (Math.pow(1.05, l) - 1),
    cost: (l) => 10 * Math.pow(1.07, l),
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

// ---------- Skills ----------
export interface SkillDef {
  id: string;
  name: string;
  unlock: number; // player level
  cd: number;
  mult: number; // x ATK
  color: string;
  icon: string;
}

export const SKILLS: SkillDef[] = [
  { id: 'strike', name: 'Dash Strike', unlock: 1, cd: 4, mult: 3, color: '#ffd166', icon: '⚡' },
  { id: 'cyclone', name: 'Cyclone', unlock: 8, cd: 10, mult: 8, color: '#4ecdc4', icon: '🌀' },
  { id: 'starfall', name: 'Starfall', unlock: 20, cd: 25, mult: 25, color: '#c77dff', icon: '🌠' },
];

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
  name: string;
  color: string;
  hp: number;
  atk: number;
  gold: number;
  exp: number;
  boss: boolean;
}

export function mobFor(stage: number, boss: boolean, rand = Math.random): MobStats {
  const B = BALANCE;
  const n = stage - 1;
  const c = chapterOf(stage).def;
  const pick = c.mobs[Math.floor(rand() * c.mobs.length)];
  const hp = B.mobHpBase * Math.pow(B.mobHpGrowth, n);
  const atk = B.mobAtkBase * Math.pow(B.mobAtkGrowth, n);
  const gold = B.goldBase * Math.pow(B.goldGrowth, n);
  const exp = B.expBase * Math.pow(B.expGrowth, n);
  if (!boss) return { name: pick.name, color: pick.color, hp, atk, gold, exp, boss };
  return {
    name: c.boss, color: pick.color, boss,
    hp: hp * B.bossHpMult, atk: atk * B.bossAtkMult,
    gold: gold * B.bossGoldMult, exp: exp * B.bossExpMult,
  };
}
