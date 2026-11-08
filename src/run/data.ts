// Content tables for the run mode (survivors-style roguelite). All balance lives here.
import { JobId } from '../data';

export const RUN = {
  /** Run length in seconds; the final boss arrives when the clock hits zero. */
  length: 600,
  miniBossAt: 300,
  arenaTiles: 64,
  maxEnemies: 420,
  spawnMin: 760,
  spawnMax: 1050,
  /** Enemies further than this from the hero are moved back into the ring around them. */
  leash: 1500,
  chests: 22,
  shrines: 6,
  chestCost: 12,
  chestCostGrowth: 1.45,
  jumpTime: 0.5,
  jumpRest: 0.4,
  contactIframes: 0.45,
  rerolls: 3,
  /** Overtime: if the final boss is still alive, every enemy gets this much tougher per second. */
  overtimeHp: 0.01,
};

export type RarityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export interface RunRarity {
  id: RarityId;
  name: string;
  color: string;
  mult: number;
  weight: number;
}
export const RUN_RARITIES: RunRarity[] = [
  { id: 'common', name: 'Common', color: '#c9c2b0', mult: 1, weight: 60 },
  { id: 'uncommon', name: 'Uncommon', color: '#6ccf5a', mult: 1.25, weight: 25 },
  { id: 'rare', name: 'Rare', color: '#4ea1ff', mult: 1.55, weight: 10 },
  { id: 'epic', name: 'Epic', color: '#b388ff', mult: 1.9, weight: 4 },
  { id: 'legendary', name: 'Legendary', color: '#ffd166', mult: 2.4, weight: 1 },
];

/** Rolls a rarity; luck (0..) moves weight from common toward the top. */
export function rollRarity(luck: number, rand: () => number, floor = 0): RunRarity {
  const ws = RUN_RARITIES.map((r, i) => (i < floor ? 0 : r.weight * (i === 0 ? Math.max(0.2, 1 - luck / 150) : 1 + (luck / 40) * i)));
  let t = rand() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ws.length; i++) {
    t -= ws[i];
    if (t <= 0) return RUN_RARITIES[i];
  }
  return RUN_RARITIES[0];
}

// ---------------------------------------------------------------- weapons
export type WeaponKind = 'arc' | 'arrow' | 'bolt' | 'orbit' | 'storm' | 'nova' | 'axe' | 'pool' | 'aura';
export type WStat = 'dmg' | 'cd' | 'count' | 'area' | 'pierce' | 'speed' | 'duration';
export const WSTAT_NAME: Record<WStat, string> = {
  dmg: 'Damage',
  cd: 'Attack speed',
  count: 'Projectiles',
  area: 'Size',
  pierce: 'Pierce',
  speed: 'Projectile speed',
  duration: 'Duration',
};
/** How much one upgrade of a stat gives at common rarity (scaled by rarity). Count/pierce are flat. */
export const WSTAT_STEP: Record<WStat, number> = { dmg: 0.22, cd: 0.1, count: 1, area: 0.12, pierce: 1, speed: 0.15, duration: 0.18 };

export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  kind: WeaponKind;
  dmg: number;
  /** seconds between casts */
  cd: number;
  count: number;
  area: number;
  pierce: number;
  speed: number;
  duration: number;
  /** stats an upgrade can roll */
  ups: WStat[];
  color: string;
}

export const WEAPONS: WeaponDef[] = [
  { id: 'cleaver', name: 'Cleaver', icon: '🪓', desc: 'Wide sweeps at the closest foes.', kind: 'arc', dmg: 14, cd: 1.0, count: 1, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#e6ecf2' },
  { id: 'longbow', name: 'Longbow', icon: '🏹', desc: 'Arrows at the nearest foe.', kind: 'arrow', dmg: 11, cd: 0.8, count: 1, area: 1, pierce: 1, speed: 900, duration: 0, ups: ['dmg', 'cd', 'count', 'pierce', 'speed'], color: '#e0c08a' },
  { id: 'ember', name: 'Ember Bolt', icon: '🔥', desc: 'Seeking fire that bursts on impact.', kind: 'bolt', dmg: 13, cd: 1.1, count: 1, area: 1, pierce: 0, speed: 520, duration: 0, ups: ['dmg', 'cd', 'count', 'area', 'speed'], color: '#ff8c42' },
  { id: 'blades', name: 'Whirling Blades', icon: '🌀', desc: 'Blades spin around you.', kind: 'orbit', dmg: 8, cd: 4.5, count: 2, area: 1, pierce: 0, speed: 3.2, duration: 3, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#cfd8e3' },
  { id: 'spark', name: 'Sky Spark', icon: '⚡', desc: 'Lightning strikes random foes nearby.', kind: 'storm', dmg: 18, cd: 1.6, count: 2, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#ffe66d' },
  { id: 'frost', name: 'Frost Ring', icon: '❄️', desc: 'A freezing ring that slows what it touches.', kind: 'nova', dmg: 9, cd: 2.6, count: 1, area: 1, pierce: 0, speed: 0, duration: 2, ups: ['dmg', 'cd', 'area', 'duration'], color: '#a8e6ff' },
  { id: 'axe', name: 'Homing Axe', icon: '🪃', desc: 'Thrown out and back, cutting everything twice.', kind: 'axe', dmg: 16, cd: 1.8, count: 1, area: 1, pierce: 99, speed: 620, duration: 0, ups: ['dmg', 'cd', 'count', 'area', 'speed'], color: '#c0a070' },
  { id: 'venom', name: 'Venom Flask', icon: '🧪', desc: 'Leaves poison pools among your foes.', kind: 'pool', dmg: 6, cd: 2.4, count: 1, area: 1, pierce: 0, speed: 0, duration: 3.5, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#8fdc5a' },
  { id: 'thorns', name: 'Bramble Aura', icon: '🌿', desc: 'Constant damage to everything close.', kind: 'aura', dmg: 5, cd: 0.5, count: 1, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'area'], color: '#7bc96f' },
];
export const WEAPON: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

// ---------------------------------------------------------------- tomes (passive stat slots)
export type PStat =
  | 'dmg' | 'cd' | 'speed' | 'maxHp' | 'pickup' | 'xp' | 'luck' | 'area' | 'count' | 'crit' | 'armor' | 'regen' | 'curse' | 'gold' | 'duration' | 'critDmg' | 'jump';

export interface TomeDef {
  id: string;
  name: string;
  icon: string;
  stat: PStat;
  /** amount per level at common rarity (fractions are percent) */
  step: number;
  /** count style tomes ignore rarity */
  flat?: boolean;
  maxLevel?: number;
  desc: string;
}
export const TOMES: TomeDef[] = [
  { id: 'might', name: 'Tome of Might', icon: '💪', stat: 'dmg', step: 0.1, desc: 'Damage' },
  { id: 'haste', name: 'Tome of Haste', icon: '⏱️', stat: 'cd', step: 0.07, desc: 'Attack speed' },
  { id: 'swift', name: 'Tome of Wind', icon: '👟', stat: 'speed', step: 0.07, desc: 'Move speed' },
  { id: 'vital', name: 'Tome of Vigor', icon: '❤️', stat: 'maxHp', step: 20, desc: 'Max HP' },
  { id: 'magnet', name: 'Tome of Pull', icon: '🧲', stat: 'pickup', step: 0.3, desc: 'Pickup range' },
  { id: 'wisdom', name: 'Tome of Insight', icon: '📘', stat: 'xp', step: 0.1, desc: 'EXP gain' },
  { id: 'fortune', name: 'Tome of Fortune', icon: '🍀', stat: 'luck', step: 10, desc: 'Luck' },
  { id: 'reach', name: 'Tome of Reach', icon: '🔵', stat: 'area', step: 0.1, desc: 'Size' },
  { id: 'plenty', name: 'Tome of Plenty', icon: '➕', stat: 'count', step: 1, flat: true, maxLevel: 3, desc: 'Projectiles' },
  { id: 'precision', name: 'Tome of Precision', icon: '🎯', stat: 'crit', step: 0.06, desc: 'Crit chance' },
  { id: 'guard', name: 'Tome of Guard', icon: '🛡️', stat: 'armor', step: 0.05, desc: 'Damage taken down' },
  { id: 'renewal', name: 'Tome of Renewal', icon: '💚', stat: 'regen', step: 0.6, desc: 'HP regen /s' },
  { id: 'peril', name: 'Tome of Peril', icon: '💀', stat: 'curse', step: 0.12, desc: 'More and tougher foes, more EXP and gold' },
];
export const TOME: Record<string, TomeDef> = Object.fromEntries(TOMES.map((t) => [t.id, t]));

// ---------------------------------------------------------------- items (from chests, unlimited)
export interface ItemDef {
  id: string;
  name: string;
  icon: string;
  rarity: RarityId;
  desc: string;
  stats?: Partial<Record<PStat, number>>;
  /** special effects handled in run.ts */
  proc?: 'lifesteal' | 'thorns' | 'bomb' | 'revive' | 'storm' | 'frenzy';
}
export const ITEMS: ItemDef[] = [
  { id: 'coin', name: 'Lucky Coin', icon: '🪙', rarity: 'common', desc: '+10 luck', stats: { luck: 10 } },
  { id: 'boots', name: 'Spring Boots', icon: '🥾', rarity: 'common', desc: '+10% move speed', stats: { speed: 0.1 } },
  { id: 'heart', name: 'Big Heart', icon: '💗', rarity: 'common', desc: '+25 max HP', stats: { maxHp: 25 } },
  { id: 'tooth', name: 'Gold Tooth', icon: '🦷', rarity: 'common', desc: '+25% gold', stats: { gold: 0.25 } },
  { id: 'feather', name: 'Feather', icon: '🪶', rarity: 'common', desc: '+20% jump time', stats: { jump: 0.2 } },
  { id: 'hourglass', name: 'Hourglass', icon: '⌛', rarity: 'uncommon', desc: '+10% attack speed', stats: { cd: 0.1 } },
  { id: 'plate', name: 'Iron Plate', icon: '🧱', rarity: 'uncommon', desc: '8% less damage taken', stats: { armor: 0.08 } },
  { id: 'moon', name: 'Moon Shard', icon: '🌙', rarity: 'uncommon', desc: '+15% EXP', stats: { xp: 0.15 } },
  { id: 'fang', name: 'Vampire Fang', icon: '🦇', rarity: 'uncommon', desc: 'Kills heal 1 HP', proc: 'lifesteal' },
  { id: 'spikes', name: 'Thorn Mail', icon: '🌵', rarity: 'uncommon', desc: 'Foes that touch you take 40 damage', proc: 'thorns' },
  { id: 'lens', name: 'Glass Lens', icon: '🔍', rarity: 'rare', desc: '+8% crit, +40% crit damage', stats: { crit: 0.08, critDmg: 0.4 } },
  { id: 'bomb', name: 'Bomb Pouch', icon: '💣', rarity: 'rare', desc: '10% of kills explode', proc: 'bomb' },
  { id: 'hilt', name: 'Heavy Hilt', icon: '🗡️', rarity: 'rare', desc: '+20% damage', stats: { dmg: 0.2 } },
  { id: 'bottle', name: 'Storm Bottle', icon: '🫙', rarity: 'epic', desc: 'Every 4s lightning hits 4 foes', proc: 'storm' },
  { id: 'drum', name: 'War Drum', icon: '🥁', rarity: 'epic', desc: 'Under 50% HP: +40% attack speed', proc: 'frenzy' },
  { id: 'phoenix', name: 'Phoenix Plume', icon: '🔆', rarity: 'legendary', desc: 'Revive once at full HP', proc: 'revive' },
];
export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// ---------------------------------------------------------------- heroes
export interface HeroDef {
  job: JobId;
  name: string;
  weapon: string;
  passive: string;
  stats: Partial<Record<PStat, number>>;
  hp: number;
  speed: number;
}
export const HEROES: Record<JobId, HeroDef> = {
  warrior: { job: 'warrior', name: 'Warrior', weapon: 'cleaver', passive: 'Sturdy: +40 max HP, 10% less damage taken, +0.5 HP regen', stats: { armor: 0.1, regen: 0.5 }, hp: 140, speed: 225 },
  archer: { job: 'archer', name: 'Archer', weapon: 'longbow', passive: 'Nimble: +10% move speed, +8% crit chance', stats: { speed: 0.1, crit: 0.08 }, hp: 100, speed: 235 },
  mage: { job: 'mage', name: 'Mage', weapon: 'ember', passive: 'Scholar: +15% size, +15% EXP', stats: { area: 0.15, xp: 0.15 }, hp: 90, speed: 225 },
};

// ---------------------------------------------------------------- enemies
export interface EnemyDef {
  id: string;
  color: string;
  r: number;
  hp: number;
  speed: number;
  dmg: number;
  xp: number;
  /** from this run minute on */
  from: number;
  weight: number;
  ranged?: boolean;
}
export const ENEMIES: EnemyDef[] = [
  { id: 'sprout', color: '#6ccf5a', r: 20, hp: 12, speed: 92, dmg: 8, xp: 1, from: 0, weight: 10 },
  { id: 'swift', color: '#5ab4e6', r: 15, hp: 8, speed: 150, dmg: 6, xp: 1, from: 1, weight: 6 },
  { id: 'spitter', color: '#9b6bd6', r: 22, hp: 22, speed: 80, dmg: 8, xp: 3, from: 2, weight: 3, ranged: true },
  { id: 'brute', color: '#d9534f', r: 32, hp: 60, speed: 72, dmg: 16, xp: 4, from: 3, weight: 4 },
  { id: 'stone', color: '#8d8f99', r: 40, hp: 180, speed: 58, dmg: 24, xp: 10, from: 6, weight: 2 },
];
export const ELITE = { hpMult: 9, rMult: 1.45, dmgMult: 1.5, xpMult: 12, color: '#e0b84a', every: 55 };

/** Enemy HP multiplier at run time t (seconds). */
export function enemyHpScale(t: number): number {
  const m = t / 60;
  return 1 + m * 0.5 + m * m * 0.2;
}
/** Enemies spawned per second at time t. */
export function spawnRate(t: number): number {
  const m = t / 60;
  return 2.2 + m * 1.9 + m * m * 0.12;
}

export interface BossDef {
  name: string;
  color: string;
  r: number;
  hp: number;
  speed: number;
  dmg: number;
}
export const MINI_BOSS: BossDef = { name: 'Bog Warden', color: '#4f9d69', r: 70, hp: 16000, speed: 95, dmg: 20 };
export const FINAL_BOSS: BossDef = { name: 'The Gloom Tide', color: '#7a3fb5', r: 95, hp: 140000, speed: 105, dmg: 28 };

// ---------------------------------------------------------------- levels
export function xpToNext(level: number): number {
  const n = level - 1;
  return Math.round(5 + n * 4.5 + n * n * 0.32);
}

export interface Shrine {
  id: string;
  name: string;
  stat: PStat;
  amount: number;
}
/** Shrine boons: picked from 3 after standing in the shrine for a few seconds. */
export const SHRINE_BOONS: Shrine[] = [
  { id: 'sdmg', name: 'Damage', stat: 'dmg', amount: 0.12 },
  { id: 'scd', name: 'Attack speed', stat: 'cd', amount: 0.08 },
  { id: 'shp', name: 'Max HP', stat: 'maxHp', amount: 25 },
  { id: 'sspd', name: 'Move speed', stat: 'speed', amount: 0.07 },
  { id: 'sarea', name: 'Size', stat: 'area', amount: 0.1 },
  { id: 'scrit', name: 'Crit chance', stat: 'crit', amount: 0.06 },
  { id: 'sluck', name: 'Luck', stat: 'luck', amount: 12 },
  { id: 'sxp', name: 'EXP gain', stat: 'xp', amount: 0.12 },
  { id: 'sarmor', name: 'Damage taken down', stat: 'armor', amount: 0.05 },
];
export const SHRINE_TIME = 3;
export const SHRINE_RADIUS = 110;

export const STAT_LABEL: Record<PStat, string> = {
  dmg: 'Damage', cd: 'Attack speed', speed: 'Move speed', maxHp: 'Max HP', pickup: 'Pickup range', xp: 'EXP gain',
  luck: 'Luck', area: 'Size', count: 'Projectiles', crit: 'Crit chance', armor: 'Damage taken down', regen: 'HP regen',
  curse: 'Peril', gold: 'Gold gain', duration: 'Duration', critDmg: 'Crit damage', jump: 'Jump time',
};
/** Stats shown as a percent (the others are flat numbers). */
export const PCT_STATS = new Set<PStat>(['dmg', 'cd', 'speed', 'pickup', 'xp', 'area', 'crit', 'armor', 'curse', 'gold', 'duration', 'critDmg', 'jump']);
export function fmtStat(stat: PStat, v: number): string {
  if (PCT_STATS.has(stat)) return `+${Math.round(v * 100)}%`;
  return `+${Math.round(v * 10) / 10}`;
}
