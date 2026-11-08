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
export type WeaponKind = 'arc' | 'arrow' | 'bolt' | 'orbit' | 'storm' | 'nova' | 'axe' | 'pool' | 'aura' | 'beam' | 'meteor' | 'summon';
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
  /** fire: Ignite and Combust work with it; shock: Overload and Static work with it */
  fire?: boolean;
  shock?: boolean;
  /** built-in burn (fraction of the hit over 3 s) */
  burn?: number;
  /** heals this fraction of the damage it deals */
  leech?: number;
  /** slows what it hits (pools, auras) */
  slow?: boolean;
  /** a sharpshooter weapon (Headshot works with it) */
  shot?: boolean;
}

export const WEAPONS: WeaponDef[] = [
  // Warrior
  { id: 'cleave', name: 'Cleave', icon: '🪓', desc: 'Wide sweeps at the closest foes, front then back.', kind: 'arc', dmg: 14, cd: 1.0, count: 1, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#e6ecf2' },
  { id: 'whirl', name: 'Whirlwind', icon: '🌀', desc: 'Spinning axes circle you for a few seconds.', kind: 'orbit', dmg: 12, cd: 4.0, count: 2, area: 1, pierce: 0, speed: 3.4, duration: 3, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#cfd8e3' },
  { id: 'quake', name: 'Ground Slam', icon: '💥', desc: 'A shockwave from your feet that slows what it hits.', kind: 'nova', dmg: 12, cd: 2.8, count: 1, area: 1, pierce: 0, speed: 0, duration: 1.5, ups: ['dmg', 'cd', 'area', 'duration'], color: '#e0b073' },
  { id: 'hatchet', name: 'Hurled Axe', icon: '🪃', desc: 'Thrown out and back, cutting everything twice.', kind: 'axe', dmg: 16, cd: 1.8, count: 1, area: 1, pierce: 99, speed: 620, duration: 0, ups: ['dmg', 'cd', 'count', 'area', 'speed'], color: '#c0a070' },
  // Archer
  { id: 'longbow', name: 'Longbow', icon: '🏹', desc: 'Arrows at the nearest foe.', kind: 'arrow', dmg: 11, cd: 0.8, count: 1, area: 1, pierce: 1, speed: 900, duration: 0, ups: ['dmg', 'cd', 'count', 'pierce', 'speed'], color: '#e0c08a', shot: true },
  { id: 'rain', name: 'Arrow Rain', icon: '🌧️', desc: 'Volleys fall on random foes nearby.', kind: 'storm', dmg: 15, cd: 1.6, count: 3, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#e0c08a' },
  { id: 'traps', name: 'Spike Traps', icon: '🪤', desc: 'Throws spike fields among your foes.', kind: 'pool', dmg: 4.5, cd: 2.6, count: 1, area: 1, pierce: 0, speed: 0, duration: 3.5, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#b08a5a' },
  { id: 'disc', name: 'Ricochet Disc', icon: '🥏', desc: 'A disc that flies out and back through foes.', kind: 'axe', dmg: 13, cd: 1.5, count: 1, area: 1, pierce: 99, speed: 760, duration: 0, ups: ['dmg', 'cd', 'count', 'speed'], color: '#cfd8e3' },
  // Mage
  { id: 'ember', name: 'Ember Bolt', icon: '🔥', desc: 'Seeking fire that bursts on impact.', kind: 'bolt', dmg: 13, cd: 1.1, count: 1, area: 1, pierce: 0, speed: 520, duration: 0, ups: ['dmg', 'cd', 'count', 'area', 'speed'], color: '#ff8c42', fire: true },
  { id: 'spark', name: 'Sky Spark', icon: '⚡', desc: 'Lightning strikes random foes nearby.', kind: 'storm', dmg: 18, cd: 1.6, count: 2, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#ffe66d', shock: true },
  { id: 'frost', name: 'Frost Ring', icon: '❄️', desc: 'A freezing ring that slows what it touches.', kind: 'nova', dmg: 9, cd: 2.6, count: 1, area: 1, pierce: 0, speed: 0, duration: 2, ups: ['dmg', 'cd', 'area', 'duration'], color: '#a8e6ff' },
  { id: 'orbs', name: 'Arcane Orbs', icon: '🔮', desc: 'Orbs of force circle you for a few seconds.', kind: 'orbit', dmg: 8, cd: 4.5, count: 2, area: 1, pierce: 0, speed: 2.8, duration: 3.5, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#b388ff' },
  // ---- job advancement abilities (granted at Lv 10 / 15 / 25) ----
  // Warrior: Berserker
  { id: 'rend', name: 'Rending Blades', icon: '🩸', desc: 'Fast blades circle you and drink blood (heal 2% of damage).', kind: 'orbit', dmg: 12, cd: 3.5, count: 3, area: 0.9, pierce: 0, speed: 5, duration: 3, ups: ['dmg', 'cd', 'count', 'duration'], color: '#e05a5a', leech: 0.02 },
  { id: 'bloodnova', name: 'Blood Nova', icon: '💢', desc: 'A red burst around you; heals 3% of the damage it deals.', kind: 'nova', dmg: 26, cd: 3.2, count: 1, area: 1.1, pierce: 0, speed: 0, duration: 0.5, ups: ['dmg', 'cd', 'area'], color: '#d9383b', leech: 0.03 },
  { id: 'warcleave', name: 'Warlord Cleave', icon: '⚔️', desc: 'Huge sweeps in every direction at once.', kind: 'arc', dmg: 42, cd: 2.0, count: 4, area: 1.5, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'area'], color: '#ff9a7a' },
  // Warrior: Guardian
  { id: 'shieldtoss', name: 'Shield Toss', icon: '🛡️', desc: 'A heavy shield that flies out, knocks foes back and returns.', kind: 'axe', dmg: 18, cd: 2.0, count: 1, area: 1.3, pierce: 99, speed: 560, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#9fb4d0' },
  { id: 'consecrate', name: 'Holy Ground', icon: '🌟', desc: 'Blessed ground around you that burns and slows foes.', kind: 'aura', dmg: 12, cd: 0.5, count: 1, area: 1.6, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'area'], color: '#ffe08a', slow: true },
  { id: 'judgment', name: 'Judgment', icon: '⚜️', desc: 'Pillars of light crash down on foes around you.', kind: 'storm', dmg: 60, cd: 2.4, count: 4, area: 1.6, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#fff1a8' },
  // Archer: Ranger
  { id: 'wolves', name: 'Wolf Pack', icon: '🐺', desc: 'Spirit wolves hunt the foes around you.', kind: 'summon', dmg: 12, cd: 0.6, count: 2, area: 1, pierce: 0, speed: 380, duration: 0, ups: ['dmg', 'cd', 'count', 'speed'], color: '#b9c7d6' },
  { id: 'brambles', name: 'Bramble Field', icon: '🌿', desc: 'Thorny patches that slow and cut foes.', kind: 'pool', dmg: 7, cd: 2.2, count: 2, area: 1.2, pierce: 0, speed: 0, duration: 4, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#7bc96f', slow: true },
  { id: 'stampede', name: 'Spirit Stampede', icon: '🦌', desc: 'A wide rush of spirit beasts tramples a whole line.', kind: 'beam', dmg: 38, cd: 2.6, count: 1, area: 2.4, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#a8f0c6' },
  // Archer: Marksman
  { id: 'pierce', name: 'Piercing Shot', icon: '➶', desc: 'A shot that goes through everything in a long line.', kind: 'beam', dmg: 24, cd: 1.6, count: 1, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#ffe0a0', shot: true },
  { id: 'snipe', name: 'Snipe', icon: '🎯', desc: 'A slow, huge hit on the toughest foe in sight.', kind: 'arrow', dmg: 75, cd: 2.8, count: 1, area: 1.4, pierce: 3, speed: 1700, duration: 0, ups: ['dmg', 'cd', 'count', 'pierce'], color: '#ff6b6b', shot: true },
  { id: 'barrage', name: 'Barrage', icon: '🎇', desc: 'A storm of arrows over everything nearby.', kind: 'storm', dmg: 22, cd: 1.8, count: 8, area: 1.1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#e0c08a', shot: true },
  // Mage: Pyromancer
  { id: 'meteor', name: 'Meteor', icon: '☄️', desc: 'A falling star that crushes a group of foes.', kind: 'meteor', dmg: 30, cd: 2.2, count: 1, area: 1.2, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#ff7b2e', fire: true, burn: 0.3 },
  { id: 'wreath', name: 'Flame Wreath', icon: '🌞', desc: 'Fire orbs circle you, setting foes alight.', kind: 'orbit', dmg: 14, cd: 3.5, count: 3, area: 1.2, pierce: 0, speed: 3, duration: 4, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#ff9a3c', fire: true, burn: 0.5 },
  { id: 'inferno', name: 'Inferno', icon: '🌋', desc: 'Pools of fire that keep everything in them burning.', kind: 'pool', dmg: 18, cd: 2.4, count: 2, area: 1.5, pierce: 0, speed: 0, duration: 4, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#ff5a1f', fire: true, burn: 0.4 },
  // Mage: Stormcaller
  { id: 'lance', name: 'Lightning Lance', icon: '🔱', desc: 'A bolt of lightning through a long line of foes.', kind: 'beam', dmg: 22, cd: 1.4, count: 1, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#8fd3ff', shock: true },
  { id: 'tempest', name: 'Tempest Orb', icon: '🌪️', desc: 'A slow storm ball that bursts in a wide blast.', kind: 'bolt', dmg: 40, cd: 2.2, count: 1, area: 2.0, pierce: 0, speed: 300, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#a8e6ff', shock: true },
  { id: 'thunder', name: 'Thunderstorm', icon: '⛈️', desc: 'Lightning rains down on everything around you.', kind: 'storm', dmg: 32, cd: 1.6, count: 6, area: 1.3, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#d6f0ff', shock: true },
];
export const WEAPON: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

// ---------------------------------------------------------------- class passives
export type PStat =
  | 'dmg' | 'cd' | 'speed' | 'maxHp' | 'pickup' | 'xp' | 'luck' | 'area' | 'count' | 'crit' | 'armor' | 'regen' | 'curse' | 'gold' | 'duration' | 'critDmg' | 'jump' | 'pierce';

/** Special passive effects, handled in run.ts. The value is the summed amount. */
export type PSpecial =
  | 'bloodlust' | 'berserk' | 'retaliate' | 'execute' | 'momentum'
  | 'mark' | 'kite' | 'sharpshot' | 'volley'
  | 'shield' | 'ignite' | 'frostbite' | 'echo' | 'chain'
  | 'leech' | 'rampage' | 'block' | 'pack' | 'headshot' | 'steady' | 'combust' | 'static';

export interface PassiveDef {
  id: string;
  name: string;
  icon: string;
  /** stats per pick (scaled by rarity unless flat) */
  stats?: Partial<Record<PStat, number>>;
  /** special effect amount per pick */
  special?: PSpecial;
  step?: number;
  /** text for a special amount */
  text?: (v: number) => string;
  flat?: boolean;
  max: number;
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
export const PASSIVES: Record<JobId, PassiveDef[]> = {
  warrior: [
    { id: 'giant', name: "Giant's Strength", icon: '💪', stats: { dmg: 0.12, area: 0.06 }, max: 5 },
    { id: 'ironskin', name: 'Iron Skin', icon: '🛡️', stats: { armor: 0.06 }, max: 5 },
    { id: 'vigor', name: 'Vigor', icon: '❤️', stats: { maxHp: 25, regen: 0.3 }, max: 5 },
    { id: 'bloodlust', name: 'Bloodlust', icon: '🩸', special: 'bloodlust', step: 0.5, text: (v) => `Kills heal ${Math.round(v * 10) / 10} HP`, max: 5 },
    { id: 'berserk', name: 'Berserker', icon: '😤', special: 'berserk', step: 0.5, text: (v) => `Up to +${pct(v)} attack speed as your HP drops`, max: 5 },
    { id: 'retaliate', name: 'Retaliation', icon: '⚔️', special: 'retaliate', step: 1, text: (v) => `Getting hit releases a shockwave (${pct(v * 2)} damage)`, max: 5 },
    { id: 'execute', name: 'Executioner', icon: '🪦', special: 'execute', step: 0.05, text: (v) => `Hits kill foes under ${pct(v)} HP (not bosses)`, max: 4 },
    { id: 'hardened', name: 'Battle Hardened', icon: '🎖️', stats: { cd: 0.07, armor: 0.03 }, max: 5 },
    { id: 'reach', name: 'Long Reach', icon: '📏', stats: { area: 0.12, duration: 0.1 }, max: 5 },
    { id: 'momentum', name: 'Momentum', icon: '🏃', special: 'momentum', step: 0.1, text: (v) => `+${pct(v)} damage while moving`, max: 5 },
  ],
  archer: [
    { id: 'eagle', name: 'Eagle Eye', icon: '🦅', stats: { crit: 0.06 }, max: 5 },
    { id: 'deadly', name: 'Deadly Aim', icon: '🎯', stats: { critDmg: 0.3 }, max: 5 },
    { id: 'fleet', name: 'Fleet Foot', icon: '👟', stats: { speed: 0.08, jump: 0.1 }, max: 5 },
    { id: 'quickdraw', name: 'Quickdraw', icon: '⏱️', stats: { cd: 0.08 }, max: 5 },
    { id: 'multishot', name: 'Multishot', icon: '➕', stats: { count: 1 }, flat: true, max: 3 },
    { id: 'piercing', name: 'Barbed Tips', icon: '📌', stats: { pierce: 1 }, flat: true, max: 3 },
    { id: 'mark', name: "Hunter's Mark", icon: '🔻', special: 'mark', step: 0.08, text: (v) => `Foes you've hit take +${pct(v)} damage`, max: 5 },
    { id: 'kite', name: 'Kiting', icon: '💨', special: 'kite', step: 0.1, text: (v) => `+${pct(v)} attack speed while moving`, max: 5 },
    { id: 'sharpshot', name: 'Sharpshooter', icon: '🔭', special: 'sharpshot', step: 0.15, text: (v) => `+${pct(v)} damage to foes far away`, max: 5 },
    { id: 'volley', name: 'Volley', icon: '🎆', special: 'volley', step: 1, flat: true, text: (v) => `Every 5th Longbow shot fires a fan of ${2 + v * 2} extra arrows`, max: 3 },
  ],
  mage: [
    { id: 'arcane', name: 'Arcane Power', icon: '✨', stats: { dmg: 0.1 }, max: 5 },
    { id: 'spellhaste', name: 'Spell Haste', icon: '⏱️', stats: { cd: 0.08 }, max: 5 },
    { id: 'wide', name: 'Wide Magic', icon: '🔵', stats: { area: 0.1, duration: 0.08 }, max: 5 },
    { id: 'study', name: 'Studious', icon: '📘', stats: { xp: 0.12, pickup: 0.15 }, max: 5 },
    { id: 'glass', name: 'Glass Cannon', icon: '🍷', stats: { dmg: 0.2, maxHp: -10 }, max: 3 },
    { id: 'shield', name: 'Mana Shield', icon: '🫧', special: 'shield', step: 15, text: (v) => `A shield soaks ${Math.round(v)} damage, refills when you avoid hits`, max: 5 },
    { id: 'ignite', name: 'Ignite', icon: '🔥', special: 'ignite', step: 0.4, text: (v) => `Fire abilities burn for ${pct(v)} of the hit over 3s`, max: 5 },
    { id: 'frostbite', name: 'Frostbite', icon: '🥶', special: 'frostbite', step: 0.15, text: (v) => `Slowed foes take +${pct(v)} damage`, max: 5 },
    { id: 'chain', name: 'Overload', icon: '🌩️', special: 'chain', step: 1, flat: true, text: (v) => `Lightning strikes jump to ${v} more foe${v > 1 ? 's' : ''}`, max: 3 },
    { id: 'echo', name: 'Echo', icon: '🔁', special: 'echo', step: 0.08, text: (v) => `${pct(v)} chance to cast an ability twice`, max: 5 },
  ],
};

// ---------------------------------------------------------------- job advancements
/** Levels at which your job advances (the first one is where you pick a branch). */
export const ADVANCE_LEVELS = [10, 15, 25];
export interface BranchTier {
  /** job title at this tier */
  title: string;
  ability: string;
  passives: PassiveDef[];
}
export interface BranchDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  desc: string;
  tiers: BranchTier[];
}
export const BRANCHES: Record<JobId, BranchDef[]> = {
  warrior: [
    {
      id: 'berserker', name: 'Berserker', icon: '🩸', color: '#e05a5a', desc: 'All offence. Drinks blood to stay alive and snowballs off kills.',
      tiers: [
        { title: 'Berserker', ability: 'rend', passives: [
          { id: 'leech', name: 'Blood Drinker', icon: '🧛', special: 'leech', step: 0.01, text: (v) => `All damage heals ${pct(v)} of itself`, max: 5 },
          { id: 'savage', name: 'Savagery', icon: '🐗', stats: { dmg: 0.15, armor: -0.03 }, max: 5 },
        ] },
        { title: 'Bloodreaver', ability: 'bloodnova', passives: [
          { id: 'rampage', name: 'Rampage', icon: '🔥', special: 'rampage', step: 0.01, text: (v) => `Each kill: +${pct(v)} damage for 3s (stacks to 30)`, max: 5 },
          { id: 'frenzied', name: 'Frenzied', icon: '🌪️', stats: { cd: 0.1, speed: 0.04 }, max: 5 },
        ] },
        { title: 'Warlord', ability: 'warcleave', passives: [
          { id: 'carnage', name: 'Carnage', icon: '💀', stats: { area: 0.12, critDmg: 0.25 }, max: 5 },
          { id: 'undying', name: 'Undying Rage', icon: '😡', stats: { maxHp: 30, regen: 0.6 }, max: 5 },
        ] },
      ],
    },
    {
      id: 'guardian', name: 'Guardian', icon: '🛡️', color: '#9fb4d0', desc: 'A wall. Blocks hits, punishes anyone who touches you, holy light.',
      tiers: [
        { title: 'Guardian', ability: 'shieldtoss', passives: [
          { id: 'block', name: 'Shield Block', icon: '🛡️', special: 'block', step: 0.05, text: (v) => `${pct(v)} chance to block a hit completely`, max: 5 },
          { id: 'bastion', name: 'Bastion', icon: '🏰', stats: { armor: 0.05, maxHp: 20 }, max: 5 },
        ] },
        { title: 'Crusader', ability: 'consecrate', passives: [
          { id: 'spikes', name: 'Spiked Plate', icon: '🌵', special: 'retaliate', step: 0.6, text: (v) => `Getting hit releases a shockwave (${pct(v * 2)} damage)`, max: 5 },
          { id: 'faith', name: 'Faith', icon: '🙏', stats: { regen: 0.8, duration: 0.1 }, max: 5 },
        ] },
        { title: 'Paragon', ability: 'judgment', passives: [
          { id: 'radiance', name: 'Radiance', icon: '☀️', stats: { dmg: 0.12, area: 0.1 }, max: 5 },
          { id: 'aegis', name: 'Aegis', icon: '🔰', special: 'block', step: 0.04, text: (v) => `+${pct(v)} block chance`, max: 5 },
        ] },
      ],
    },
  ],
  archer: [
    {
      id: 'ranger', name: 'Ranger', icon: '🐺', color: '#7bc96f', desc: 'Nature and beasts. Wolves fight beside you, the ground turns against foes.',
      tiers: [
        { title: 'Ranger', ability: 'wolves', passives: [
          { id: 'packleader', name: 'Pack Leader', icon: '🐾', special: 'pack', step: 1, flat: true, text: (v) => `+${v} wolf`, max: 3 },
          { id: 'wild', name: 'Call of the Wild', icon: '🌲', stats: { dmg: 0.1, speed: 0.04 }, max: 5 },
        ] },
        { title: 'Beastwarden', ability: 'brambles', passives: [
          { id: 'thornskin', name: 'Thornskin', icon: '🌵', stats: { armor: 0.04, regen: 0.4 }, max: 5 },
          { id: 'harmony', name: 'Harmony', icon: '🍃', stats: { duration: 0.12, area: 0.08 }, max: 5 },
        ] },
        { title: 'Wildheart', ability: 'stampede', passives: [
          { id: 'alpha', name: 'Alpha', icon: '👑', stats: { dmg: 0.15, cd: 0.06 }, max: 5 },
          { id: 'verdant', name: 'Verdant', icon: '💚', stats: { maxHp: 25, pickup: 0.2 }, max: 5 },
        ] },
      ],
    },
    {
      id: 'marksman', name: 'Marksman', icon: '🎯', color: '#ffd166', desc: 'Precision. Huge single shots, crits and headshots from far away.',
      tiers: [
        { title: 'Marksman', ability: 'pierce', passives: [
          { id: 'headshot', name: 'Headshot', icon: '🎯', special: 'headshot', step: 0.04, text: (v) => `Shots have ${pct(v)} chance to deal triple damage`, max: 5 },
          { id: 'steady', name: 'Steady Hands', icon: '🧘', special: 'steady', step: 0.12, text: (v) => `+${pct(v)} damage while standing still`, max: 5 },
        ] },
        { title: 'Sniper', ability: 'snipe', passives: [
          { id: 'scope', name: 'Long Scope', icon: '🔭', stats: { critDmg: 0.35, crit: 0.03 }, max: 5 },
          { id: 'hollow', name: 'Hollow Points', icon: '🔩', stats: { pierce: 1, dmg: 0.06 }, flat: true, max: 3 },
        ] },
        { title: 'Deadeye', ability: 'barrage', passives: [
          { id: 'executioner', name: 'Kill Shot', icon: '🪦', special: 'execute', step: 0.05, text: (v) => `Hits kill foes under ${pct(v)} HP (not bosses)`, max: 4 },
          { id: 'trueaim', name: 'True Aim', icon: '✴️', stats: { crit: 0.06, cd: 0.05 }, max: 5 },
        ] },
      ],
    },
  ],
  mage: [
    {
      id: 'pyro', name: 'Pyromancer', icon: '🔥', color: '#ff7b2e', desc: 'Fire everywhere. Everything burns, and burning foes explode.',
      tiers: [
        { title: 'Pyromancer', ability: 'meteor', passives: [
          { id: 'kindling', name: 'Kindling', icon: '🪵', special: 'ignite', step: 0.3, text: (v) => `Fire abilities burn for +${pct(v)} of the hit`, max: 5 },
          { id: 'heat', name: 'Searing Heat', icon: '🌡️', stats: { dmg: 0.12 }, max: 5 },
        ] },
        { title: 'Flamecaller', ability: 'wreath', passives: [
          { id: 'combust', name: 'Combustion', icon: '💥', special: 'combust', step: 0.15, text: (v) => `Burning foes explode on death (${pct(v)} of their max HP)`, max: 5 },
          { id: 'blaze', name: 'Blaze', icon: '🔆', stats: { area: 0.1, cd: 0.05 }, max: 5 },
        ] },
        { title: 'Phoenix Sage', ability: 'inferno', passives: [
          { id: 'rebirth', name: 'Ashen Rebirth', icon: '🐦', stats: { regen: 1, maxHp: 15 }, max: 5 },
          { id: 'sun', name: 'Heart of the Sun', icon: '🌞', stats: { dmg: 0.18, duration: 0.1 }, max: 5 },
        ] },
      ],
    },
    {
      id: 'storm', name: 'Stormcaller', icon: '⚡', color: '#8fd3ff', desc: 'Lightning. Fast casts, strikes that jump from foe to foe.',
      tiers: [
        { title: 'Stormcaller', ability: 'lance', passives: [
          { id: 'static', name: 'Static', icon: '🔌', special: 'static', step: 0.08, text: (v) => `Hits have ${pct(v)} chance to zap a nearby foe`, max: 5 },
          { id: 'charged', name: 'Charged', icon: '🔋', stats: { cd: 0.1 }, max: 5 },
        ] },
        { title: 'Tempest', ability: 'tempest', passives: [
          { id: 'conduct', name: 'Conductor', icon: '🌩️', special: 'chain', step: 1, flat: true, text: (v) => `Lightning strikes jump to ${v} more foe${v > 1 ? 's' : ''}`, max: 3 },
          { id: 'galeforce', name: 'Gale Force', icon: '💨', stats: { speed: 0.08, area: 0.06 }, max: 5 },
        ] },
        { title: 'Thunderlord', ability: 'thunder', passives: [
          { id: 'overcharge', name: 'Overcharge', icon: '⚡', stats: { dmg: 0.15, crit: 0.04 }, max: 5 },
          { id: 'eye', name: 'Eye of the Storm', icon: '🌀', special: 'shield', step: 25, text: (v) => `A shield soaks ${Math.round(v)} damage, refills when you avoid hits`, max: 5 },
        ] },
      ],
    },
  ],
};
export const BRANCH: Record<string, BranchDef> = Object.fromEntries(Object.values(BRANCHES).flat().map((b) => [b.id, b]));

export const PASSIVE: Record<string, PassiveDef> = Object.fromEntries(
  [...Object.values(PASSIVES).flat(), ...Object.values(BRANCHES).flat().flatMap((b) => b.tiers.flatMap((t) => t.passives))].map((p) => [p.id, p]),
);

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
  /** the class's 4 abilities; the first is the one you start with */
  abilities: string[];
  passive: string;
  stats: Partial<Record<PStat, number>>;
  hp: number;
  speed: number;
}
export const HEROES: Record<JobId, HeroDef> = {
  warrior: { job: 'warrior', name: 'Warrior', abilities: ['cleave', 'whirl', 'quake', 'hatchet'], passive: 'Sturdy: 10% less damage taken, +0.5 HP regen', stats: { armor: 0.1, regen: 0.5 }, hp: 140, speed: 225 },
  archer: { job: 'archer', name: 'Archer', abilities: ['longbow', 'rain', 'traps', 'disc'], passive: 'Nimble: +10% move speed, +8% crit chance', stats: { speed: 0.1, crit: 0.08 }, hp: 100, speed: 235 },
  mage: { job: 'mage', name: 'Mage', abilities: ['ember', 'spark', 'frost', 'orbs'], passive: 'Scholar: +15% size, +15% EXP', stats: { area: 0.15, xp: 0.15 }, hp: 90, speed: 225 },
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
export const MINI_BOSS: BossDef = { name: 'Bog Warden', color: '#4f9d69', r: 70, hp: 24000, speed: 95, dmg: 20 };
export const FINAL_BOSS: BossDef = { name: 'The Gloom Tide', color: '#7a3fb5', r: 95, hp: 260000, speed: 105, dmg: 28 };

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
  curse: 'Peril', gold: 'Gold gain', duration: 'Duration', critDmg: 'Crit damage', jump: 'Jump time', pierce: 'Pierce',
};
/** Stats shown as a percent (the others are flat numbers). */
export const PCT_STATS = new Set<PStat>(['dmg', 'cd', 'speed', 'pickup', 'xp', 'area', 'crit', 'armor', 'curse', 'gold', 'duration', 'critDmg', 'jump']);
export function fmtStat(stat: PStat, v: number): string {
  const sign = v < 0 ? '-' : '+';
  if (PCT_STATS.has(stat)) return `${sign}${Math.round(Math.abs(v) * 100)}%`;
  return `${sign}${Math.round(Math.abs(v) * 10) / 10}`;
}
