// Content tables for the run mode (survivors-style roguelite). All balance lives here.
import { JobId } from '../data';

export const RUN = {
  /** Run length in seconds; the final boss arrives when the clock hits zero. */
  length: 600,
  miniBossAt: 300,
  arenaTiles: 64,
  maxEnemies: 420,
  spawnMin: 880,
  spawnMax: 1200,
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
  /** true: EXP goes straight to you on kill. false: foes drop gems you have to pick up. */
  xpOnKill: true,
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
export type WeaponKind = 'arc' | 'arrow' | 'bolt' | 'orbit' | 'storm' | 'nova' | 'axe' | 'pool' | 'aura' | 'beam' | 'meteor' | 'summon' | 'rain';
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
  /** arrows: angle between arrows in one volley (all fired at once) */
  spread?: number;
  // ---- path effects (ability paths add these) ----
  /** chance a hit freezes a foe in place for 1 s (bosses are only slowed) */
  freeze?: number;
  /** lightning hits jump to this many more foes (60% damage) */
  chain?: number;
  /** hits explode in this radius for 50% damage */
  blast?: number;
  /** this ability hits harder against chilled / shocked / burning foes */
  ampChill?: number;
  ampShock?: number;
  ampBurn?: number;
  /** pools / rain: the zone follows you */
  follow?: boolean;
  /** extra crit chance for this ability */
  crit?: number;
  // ---- archer path mechanics (paths.ts ARCHER_TREES) ----
  /** zones: radius grows from 70% to 70% + grow over the zone's life */
  grow?: number;
  /** hits leave foes Soaked: take this much more damage from everything for 2 s */
  soak?: number;
  /** zones pull normal foes toward the middle (units a second) */
  pull?: number;
  /** when a zone ends, everything inside takes this many ticks' damage at once */
  finale?: number;
  /** a new zone opens with a hit worth this many ticks */
  opener?: number;
  /** rain sits on the toughest foe and follows it */
  track?: boolean;
  /** kills inside the rain open a new cloud on the nearest foe, up to this many at once */
  spawnOnKill?: number;
  /** each new cloud hits this much harder */
  spawnAmp?: number;
  /** traps wait armed until a foe steps on them, then explode for this many times the damage */
  mine?: number;
  /** a mine going off sets off mines nearby and leaves spikes behind */
  chainMine?: boolean;
  /** explosions / close hits stun normal foes this long (bosses are only slowed) */
  stun?: number;
  /** explosion radius multiplier for mines and charges */
  boomSize?: number;
  /** bear trap: snaps the first foe for this many times the damage and holds it */
  snare?: number;
  /** Snared foes take this much more damage from everything */
  snareAmp?: number;
  /** seconds a snared foe is held */
  snareHold?: number;
  /** the snap fills the bleed stacks at once */
  snareBleed?: boolean;
  /** the snap drags foes nearby to the snared one */
  tether?: boolean;
  /** zones land at your feet as you move */
  atFeet?: boolean;
  /** zone ticks hit the same foe harder each time (+25% a tick), up to this multiplier */
  ramp?: number;
  /** this ability's hits bleed (share of the hit, like the talent) */
  bleedHit?: number;
  /** this ability hits bleeding foes harder */
  ampBleed?: number;
  /** explosions throw this many bomblets around */
  cluster?: number;
  /** bomblets split once more */
  cluster2?: boolean;
  /** sticky charge: the arrow sticks and blows up later for this many times its hit */
  stick?: number;
  /** share of your other hits on a stuck foe that feeds the charge */
  stickFeed?: number;
  /** a charge going off plants another on the nearest foe */
  restick?: boolean;
  /** charge blasts finish normal foes under this much HP */
  demolish?: number;
  /** charge: all of the payload goes into the stuck foe */
  shaped?: boolean;
  /** explosions throw this many shards outward */
  shrapnel?: number;
  /** shards burst on hit */
  fragBlast?: boolean;
  /** shards seek foes */
  homeShards?: boolean;
  /** extra damage within 320 range */
  closeAmp?: number;
  /** arrows split in two on their first hit */
  splitHit?: boolean;
  /** a second volley right after the first */
  doubleTap?: boolean;
  /** arrows bounce to this many more foes */
  bounce?: number;
  /** each bounce hits this much harder */
  bounceAmp?: number;
  /** arrows curve toward foes */
  homing?: boolean;
  /** the last bounce explodes */
  bounceBlast?: boolean;
  /** a fan that goes all the way around */
  ring?: boolean;
  /** arrows stop and hang in the air for this many seconds */
  hang?: number;
}

export const WEAPONS: WeaponDef[] = [
  // ---------------- Warrior: auto attack + base abilities
  { id: 'slash', name: 'Slash', icon: '🗡️', desc: 'Your auto attack: a quick cut at the closest foe.', kind: 'arc', dmg: 12, cd: 0.7, count: 1, area: 0.75, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'area'], color: '#e6ecf2' },
  { id: 'cleave', name: 'Cleave', icon: '🪓', desc: 'Wide sweeps at the closest foes, front then back.', kind: 'arc', dmg: 16, cd: 1.6, count: 2, area: 1.1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#e6ecf2' },
  { id: 'whirl', name: 'Whirlwind', icon: '🌀', desc: 'Spinning axes circle you for a few seconds.', kind: 'orbit', dmg: 12, cd: 4.0, count: 2, area: 1, pierce: 0, speed: 3.4, duration: 3, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#cfd8e3' },
  { id: 'quake', name: 'Ground Slam', icon: '💥', desc: 'A shockwave from your feet that slows what it hits.', kind: 'nova', dmg: 14, cd: 2.8, count: 1, area: 1, pierce: 0, speed: 0, duration: 1.5, ups: ['dmg', 'cd', 'area', 'duration'], color: '#e0b073' },
  { id: 'hatchet', name: 'Hurled Axe', icon: '🪃', desc: 'Thrown out and back, cutting everything twice.', kind: 'axe', dmg: 18, cd: 1.8, count: 1, area: 1, pierce: 99, speed: 620, duration: 0, ups: ['dmg', 'cd', 'count', 'area', 'speed'], color: '#c0a070' },
  // Berserker
  { id: 'fslash', name: 'Frenzied Slash', icon: '🩸', desc: 'Faster, hungrier cuts that heal 1% of their damage.', kind: 'arc', dmg: 16, cd: 0.45, count: 1, area: 0.85, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'area'], color: '#ff8a8a', leech: 0.01 },
  { id: 'rend', name: 'Rending Blades', icon: '🩸', desc: 'Fast blades circle you and drink blood (heal 2% of damage).', kind: 'orbit', dmg: 18, cd: 3.2, count: 3, area: 1, pierce: 0, speed: 5, duration: 3.5, ups: ['dmg', 'cd', 'count', 'duration'], color: '#e05a5a', leech: 0.02 },
  { id: 'bloodnova', name: 'Blood Nova', icon: '💢', desc: 'A red burst around you; heals 3% of the damage it deals.', kind: 'nova', dmg: 20, cd: 2.8, count: 1, area: 1.2, pierce: 0, speed: 0, duration: 1.5, ups: ['dmg', 'cd', 'area'], color: '#d9383b', leech: 0.03 },
  { id: 'warcleave', name: 'Warlord Cleave', icon: '⚔️', desc: 'Huge sweeps in every direction at once.', kind: 'arc', dmg: 30, cd: 1.8, count: 4, area: 1.6, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'area'], color: '#ff9a7a' },
  { id: 'reaver', name: 'Reaver Axes', icon: '🪓', desc: 'Two blood-soaked axes out and back; heal 2% of damage.', kind: 'axe', dmg: 40, cd: 1.6, count: 2, area: 1.3, pierce: 99, speed: 680, duration: 0, ups: ['dmg', 'cd', 'count', 'area', 'speed'], color: '#e05a5a', leech: 0.02 },
  // Guardian
  { id: 'bash', name: 'Shield Bash', icon: '🛡️', desc: 'Heavy bashes that throw foes back.', kind: 'arc', dmg: 18, cd: 0.8, count: 1, area: 0.9, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'area'], color: '#9fb4d0' },
  { id: 'shieldtoss', name: 'Shield Toss', icon: '🛡️', desc: 'A heavy shield that flies out, knocks foes back and returns.', kind: 'axe', dmg: 24, cd: 1.8, count: 1, area: 1.3, pierce: 99, speed: 560, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#9fb4d0' },
  { id: 'consecrate', name: 'Holy Ground', icon: '🌟', desc: 'Blessed ground around you that burns and slows foes.', kind: 'aura', dmg: 14, cd: 0.5, count: 1, area: 1.6, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'area'], color: '#ffe08a', slow: true },
  { id: 'judgment', name: 'Judgment', icon: '⚜️', desc: 'Pillars of light crash down on foes around you.', kind: 'storm', dmg: 34, cd: 2.2, count: 4, area: 1.6, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#fff1a8' },
  { id: 'holycleave', name: 'Holy Cleave', icon: '✨', desc: 'Radiant sweeps that slow everything they touch.', kind: 'arc', dmg: 34, cd: 1.4, count: 2, area: 1.5, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#fff1a8', slow: true },
  // ---------------- Archer
  { id: 'longbow', name: 'Longbow', icon: '🏹', desc: 'Your auto attack: arrows at the nearest foe.', kind: 'arrow', dmg: 11, cd: 0.7, count: 1, area: 1, pierce: 1, speed: 900, duration: 0, ups: ['dmg', 'cd', 'count', 'pierce', 'speed'], color: '#e0c08a', shot: true },
  { id: 'rain', name: 'Arrow Rain', icon: '🌧️', desc: 'Arrows keep raining on a patch of ground for a few seconds.', kind: 'rain', dmg: 4, cd: 3.2, count: 1, area: 1, pierce: 0, speed: 0, duration: 2.5, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#e0c08a', shot: true },
  { id: 'traps', name: 'Spike Traps', icon: '🪤', desc: 'Throws spike fields among your foes.', kind: 'pool', dmg: 5, cd: 2.6, count: 1, area: 1, pierce: 0, speed: 0, duration: 3.5, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#b08a5a' },
  { id: 'blast', name: 'Explosive Shot', icon: '💥', desc: 'An arrow that bursts on impact, hitting everything around it.', kind: 'arrow', dmg: 16, cd: 1.6, count: 1, area: 1, pierce: 0, speed: 800, duration: 0, ups: ['dmg', 'cd', 'count', 'area', 'speed'], color: '#ffb35c', shot: true, blast: 80 },
  { id: 'fan', name: 'Fan of Arrows', icon: '🎐', desc: 'A wide spread of arrows in front of you.', kind: 'arrow', dmg: 13, cd: 1.6, count: 5, area: 1, pierce: 1, speed: 850, duration: 0, ups: ['dmg', 'cd', 'count', 'pierce'], color: '#e0c08a', shot: true, spread: 0.22 },
  // Ranger
  { id: 'thornarrow', name: 'Thorn Arrow', icon: '🌿', desc: 'Arrows tipped with thorns that slow and go through foes.', kind: 'arrow', dmg: 15, cd: 0.6, count: 1, area: 1, pierce: 2, speed: 900, duration: 0, ups: ['dmg', 'cd', 'count', 'pierce'], color: '#9be38a', shot: true, slow: true },
  { id: 'wolves', name: 'Wolf Pack', icon: '🐺', desc: 'Spirit wolves hunt the foes around you.', kind: 'summon', dmg: 16, cd: 0.6, count: 2, area: 1, pierce: 0, speed: 380, duration: 0, ups: ['dmg', 'cd', 'count', 'speed'], color: '#b9c7d6' },
  { id: 'brambles', name: 'Bramble Field', icon: '🌿', desc: 'Thorny patches that slow and cut foes.', kind: 'pool', dmg: 10, cd: 2.2, count: 2, area: 1.2, pierce: 0, speed: 0, duration: 4, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#7bc96f', slow: true },
  { id: 'stampede', name: 'Spirit Stampede', icon: '🦌', desc: 'A wide rush of spirit beasts tramples a whole line.', kind: 'beam', dmg: 44, cd: 2.4, count: 1, area: 2.4, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#a8f0c6' },
  { id: 'thornrain', name: 'Rain of Thorns', icon: '🍃', desc: 'A long, wide rain of thorns that slows everything under it.', kind: 'rain', dmg: 7, cd: 3.0, count: 1, area: 1.4, pierce: 0, speed: 0, duration: 3.5, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#9be38a', slow: true },
  // Marksman
  { id: 'aimed', name: 'Aimed Shot', icon: '🎯', desc: 'Slower, heavier shots that pierce.', kind: 'arrow', dmg: 24, cd: 0.9, count: 1, area: 1.1, pierce: 3, speed: 1300, duration: 0, ups: ['dmg', 'cd', 'count', 'pierce'], color: '#ffe0a0', shot: true },
  { id: 'pierce', name: 'Piercing Shot', icon: '➶', desc: 'A shot that goes through everything in a long line.', kind: 'beam', dmg: 30, cd: 1.5, count: 1, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#ffe0a0', shot: true },
  { id: 'snipe', name: 'Snipe', icon: '🔭', desc: 'A slow, huge hit on the toughest foe in sight.', kind: 'arrow', dmg: 80, cd: 2.6, count: 1, area: 1.4, pierce: 3, speed: 1700, duration: 0, ups: ['dmg', 'cd', 'count', 'pierce'], color: '#ff6b6b', shot: true },
  { id: 'barrage', name: 'Barrage', icon: '🎇', desc: 'A dense rain of arrows over a huge area.', kind: 'rain', dmg: 8, cd: 2.8, count: 2, area: 1.5, pierce: 0, speed: 0, duration: 3, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#e0c08a', shot: true },
  // ---------------- Mage
  { id: 'missile', name: 'Arcane Missile', icon: '✨', desc: 'Your auto attack: a seeking bolt of force.', kind: 'bolt', dmg: 11, cd: 0.75, count: 1, area: 0.5, pierce: 0, speed: 600, duration: 0, ups: ['dmg', 'cd', 'count', 'speed'], color: '#c9a7ff' },
  { id: 'spark', name: 'Sky Spark', icon: '⚡', desc: 'Lightning strikes random foes nearby.', kind: 'storm', dmg: 18, cd: 1.6, count: 2, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#ffe66d', shock: true },
  { id: 'frost', name: 'Frost Ring', icon: '❄️', desc: 'A freezing ring that slows what it touches.', kind: 'nova', dmg: 10, cd: 2.6, count: 1, area: 1, pierce: 0, speed: 0, duration: 2, ups: ['dmg', 'cd', 'area', 'duration'], color: '#a8e6ff' },
  { id: 'orbs', name: 'Arcane Orbs', icon: '🔮', desc: 'Orbs of force circle you for a few seconds.', kind: 'orbit', dmg: 10, cd: 4.5, count: 2, area: 1, pierce: 0, speed: 2.8, duration: 3.5, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#b388ff' },
  { id: 'ember', name: 'Fireball', icon: '🔥', desc: 'Seeking fire that bursts on impact.', kind: 'bolt', dmg: 22, cd: 1.4, count: 1, area: 1.2, pierce: 0, speed: 520, duration: 0, ups: ['dmg', 'cd', 'count', 'area', 'speed'], color: '#ff8c42', fire: true },
  // Pyromancer
  { id: 'firemissile', name: 'Fire Missile', icon: '🔥', desc: 'Seeking fire bolts that set foes alight.', kind: 'bolt', dmg: 15, cd: 0.65, count: 1, area: 0.7, pierce: 0, speed: 620, duration: 0, ups: ['dmg', 'cd', 'count', 'speed'], color: '#ff8c42', fire: true, burn: 0.3 },
  { id: 'meteor', name: 'Meteor', icon: '☄️', desc: 'A falling star that crushes a group of foes.', kind: 'meteor', dmg: 40, cd: 2.0, count: 1, area: 1.3, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#ff7b2e', fire: true, burn: 0.3 },
  { id: 'wreath', name: 'Flame Wreath', icon: '🌞', desc: 'Fire orbs circle you, setting foes alight.', kind: 'orbit', dmg: 16, cd: 3.5, count: 3, area: 1.2, pierce: 0, speed: 3, duration: 4, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#ff9a3c', fire: true, burn: 0.5 },
  { id: 'inferno', name: 'Inferno', icon: '🌋', desc: 'Pools of fire that keep everything in them burning.', kind: 'pool', dmg: 20, cd: 2.4, count: 2, area: 1.5, pierce: 0, speed: 0, duration: 4, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#ff5a1f', fire: true, burn: 0.4 },
  { id: 'flamenova', name: 'Flame Nova', icon: '🔆', desc: 'A ring of fire bursts out from you.', kind: 'nova', dmg: 20, cd: 2.2, count: 1, area: 1.3, pierce: 0, speed: 0, duration: 1, ups: ['dmg', 'cd', 'area'], color: '#ff9a3c', fire: true, burn: 0.4 },
  // Stormcaller
  { id: 'shockmissile', name: 'Shock Missile', icon: '⚡', desc: 'Crackling bolts that fly faster.', kind: 'bolt', dmg: 14, cd: 0.55, count: 1, area: 0.6, pierce: 0, speed: 800, duration: 0, ups: ['dmg', 'cd', 'count', 'speed'], color: '#8fd3ff', shock: true },
  { id: 'lance', name: 'Lightning Lance', icon: '🔱', desc: 'A bolt of lightning through a long line of foes.', kind: 'beam', dmg: 30, cd: 1.3, count: 1, area: 1, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#8fd3ff', shock: true },
  { id: 'balllight', name: 'Ball Lightning', icon: '🟡', desc: 'Crackling orbs circle you, fast and wide.', kind: 'orbit', dmg: 18, cd: 3.2, count: 3, area: 1.3, pierce: 0, speed: 4, duration: 4, ups: ['dmg', 'cd', 'count', 'area', 'duration'], color: '#fff07a', shock: true },
  { id: 'thunder', name: 'Thunderstorm', icon: '⛈️', desc: 'Lightning rains down on everything around you.', kind: 'storm', dmg: 26, cd: 1.5, count: 6, area: 1.3, pierce: 0, speed: 0, duration: 0, ups: ['dmg', 'cd', 'count', 'area'], color: '#d6f0ff', shock: true },
  { id: 'thunderclap', name: 'Thunderclap', icon: '🌩️', desc: 'A booming ring of lightning that stuns foes in place.', kind: 'nova', dmg: 20, cd: 2.4, count: 1, area: 1.3, pierce: 0, speed: 0, duration: 2, ups: ['dmg', 'cd', 'area', 'duration'], color: '#d6f0ff', shock: true },
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
  | 'leech' | 'rampage' | 'block' | 'pack' | 'headshot' | 'steady' | 'combust' | 'static'
  // ultimate (core) modifiers
  | 'coreGain' | 'coreDur' | 'corePower' | 'split' | 'secondNature' | 'trueshot'
  // bleed (talents)
  | 'bleed' | 'bleedAmp' | 'bleedHeal' | 'rupture' | 'critBleed' | 'eternalPack' | 'burnAmp';

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
  /** talents: more specials on the same pick, and a fixed description for the card */
  extra?: [PSpecial, number][];
  desc?: string;
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
    { id: 'volley', name: 'Volley', icon: '🎆', special: 'volley', step: 1, flat: true, text: (v) => `Every 5th auto attack fires a fan of ${2 + v * 2} extra arrows`, max: 3 },
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
/** Levels at which the 4 base abilities unlock (the auto attack is there from level 1). */
export const ABILITY_LEVELS = [2, 4, 6, 10];
/** Ability path tiers: tier k opens when you are at least PATH_PLAYER[k] and the ability is at least PATH_ABILITY[k]. */
export const PATH_PLAYER = [10, 15, 25];
export const PATH_ABILITY = [2, 5, 8];
export interface BranchTier {
  /** job title at this tier */
  title: string;
  /** [old ability, new ability]: the new one takes the old one's slot and keeps its upgrades */
  swaps: [string, string][];
  passives: PassiveDef[];
}
export interface BranchDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  desc: string;
  /** the job's ultimate; replaces the class one at Lv 10 */
  core: CoreDef;
  tiers: BranchTier[];
}

// ---------------------------------------------------------------- class resource + ultimate (F)
export type CoreId = 'battlecry' | 'bloodrage' | 'divine' | 'deadeye' | 'packfrenzy' | 'arcanesurge' | 'firestorm' | 'stormavatar';
/** Which hits build the resource. */
export type CoreTag = 'melee' | 'shot' | 'nature' | 'fire' | 'shock' | 'any';
export interface CoreDef {
  id: CoreId;
  name: string;
  icon: string;
  /** resource name shown on the bar */
  resource: string;
  color: string;
  desc: string;
  /** seconds the ultimate lasts */
  dur: number;
  gain: { tag: CoreTag; hit: number; crit?: number; kill?: number; hurt?: number; regen?: number };
}
/** The resource can't fill faster than this many points per second (from hits and kills). */
export const CORE_RATE = 11;
export const CORE_MAX = 100;
export const CLASS_CORE: Record<JobId, CoreDef> = {
  warrior: { id: 'battlecry', name: 'Battle Cry', icon: '📯', resource: 'Rage', color: '#e05a5a', dur: 6, desc: '+30% damage and +15% attack speed for 6s.', gain: { tag: 'melee', hit: 2, kill: 1, hurt: 3 } },
  archer: { id: 'deadeye', name: 'Deadeye', icon: '🎯', resource: 'Focus', color: '#ffd166', dur: 6, desc: 'Your auto attack fires empowered arrows: +40% damage, faster, piercing everything. 6s.', gain: { tag: 'shot', hit: 3, crit: 2 } },
  mage: { id: 'arcanesurge', name: 'Arcane Surge', icon: '🔮', resource: 'Mana', color: '#b388ff', dur: 6, desc: 'Every ability is ready at once, then +40% attack speed for 6s.', gain: { tag: 'any', hit: 0.5, regen: 6 } },
};
const CORES: Record<string, CoreDef> = {
  berserker: { id: 'bloodrage', name: 'Bloodrage', icon: '🩸', resource: 'Rage', color: '#e05a5a', dur: 8, desc: '+40% damage, +40% attack speed, +20% size and heal 3% of all damage for 8s.', gain: { tag: 'melee', hit: 2, kill: 1, hurt: 3 } },
  guardian: { id: 'divine', name: 'Divine Shield', icon: '🔆', resource: 'Resolve', color: '#fff1a8', dur: 5, desc: 'Immune to damage for 5s while holy light bursts around you.', gain: { tag: 'melee', hit: 1.5, hurt: 6 } },
  ranger: { id: 'packfrenzy', name: 'Call of the Pack', icon: '🐺', resource: 'Bond', color: '#7bc96f', dur: 8, desc: '+2 wolves for 8s, and your wolves bite 60% faster.', gain: { tag: 'nature', hit: 2, kill: 1 } },
  marksman: { id: 'deadeye', name: 'Deadeye', icon: '🎯', resource: 'Focus', color: '#ffd166', dur: 6, desc: 'Your auto attack fires empowered arrows: +40% damage, faster, piercing everything. 6s.', gain: { tag: 'shot', hit: 3, crit: 2 } },
  pyro: { id: 'firestorm', name: 'Firestorm', icon: '☄️', resource: 'Heat', color: '#ff7b2e', dur: 8, desc: 'Meteors rain on your foes for 8s and everything burns twice as hard.', gain: { tag: 'fire', hit: 2, kill: 1 } },
  storm: { id: 'stormavatar', name: 'Storm Avatar', icon: '🌩️', resource: 'Charge', color: '#8fd3ff', dur: 8, desc: 'Lightning strikes foes around you 5 times a second and +30% attack speed for 8s.', gain: { tag: 'shock', hit: 2, kill: 1 } },
};
const cGain = (id: string, name: string, icon: string, res: string): PassiveDef => ({ id, name, icon, special: 'coreGain', step: 0.2, text: (v) => `${res} builds ${pct(v)} faster`, max: 3 });
const cDur = (id: string, name: string, icon: string, ult: string, step = 2): PassiveDef => ({ id, name, icon, special: 'coreDur', step, flat: true, text: (v) => `${ult} lasts ${v}s longer`, max: 2 });
const cPow = (id: string, name: string, icon: string, ult: string): PassiveDef => ({ id, name, icon, special: 'corePower', step: 0.25, text: (v) => `${ult} is ${pct(v)} stronger`, max: 3 });
export const BRANCHES: Record<JobId, BranchDef[]> = {
  warrior: [
    {
      id: 'berserker', name: 'Berserker', icon: '🩸', color: '#e05a5a', desc: 'All offence. Drinks blood to stay alive and snowballs off kills.',
      core: CORES.berserker,
      tiers: [
        { title: 'Berserker', swaps: [['slash', 'fslash'], ['whirl', 'rend']], passives: [
          cGain('fury', 'Fury', '😤', 'Rage'),
          { id: 'leech', name: 'Blood Drinker', icon: '🧛', special: 'leech', step: 0.01, text: (v) => `All damage heals ${pct(v)} of itself`, max: 5 },
          { id: 'savage', name: 'Savagery', icon: '🐗', stats: { dmg: 0.15, armor: -0.03 }, max: 5 },
        ] },
        { title: 'Bloodreaver', swaps: [['quake', 'bloodnova']], passives: [
          cDur('unending', 'Unending Rage', '⏳', 'Bloodrage'),
          { id: 'rampage', name: 'Rampage', icon: '🔥', special: 'rampage', step: 0.01, text: (v) => `Each kill: +${pct(v)} damage for 3s (stacks to 30)`, max: 5 },
          { id: 'frenzied', name: 'Frenzied', icon: '🌪️', stats: { cd: 0.1, speed: 0.04 }, max: 5 },
        ] },
        { title: 'Warlord', swaps: [['cleave', 'warcleave'], ['hatchet', 'reaver']], passives: [
          cPow('warcry', 'Warlord\'s Cry', '📯', 'Bloodrage'),
          { id: 'carnage', name: 'Carnage', icon: '💀', stats: { area: 0.12, critDmg: 0.25 }, max: 5 },
          { id: 'undying', name: 'Undying Rage', icon: '😡', stats: { maxHp: 30, regen: 0.6 }, max: 5 },
        ] },
      ],
    },
    {
      id: 'guardian', name: 'Guardian', icon: '🛡️', color: '#9fb4d0', desc: 'A wall. Blocks hits, punishes anyone who touches you, holy light.',
      core: CORES.guardian,
      tiers: [
        { title: 'Guardian', swaps: [['slash', 'bash'], ['hatchet', 'shieldtoss']], passives: [
          cGain('zeal', 'Zeal', '🙏', 'Resolve'),
          { id: 'block', name: 'Shield Block', icon: '🛡️', special: 'block', step: 0.05, text: (v) => `${pct(v)} chance to block a hit completely`, max: 5 },
          { id: 'bastion', name: 'Bastion', icon: '🏰', stats: { armor: 0.05, maxHp: 20 }, max: 5 },
        ] },
        { title: 'Crusader', swaps: [['whirl', 'consecrate']], passives: [
          cDur('devotion', 'Devotion', '⏳', 'Divine Shield', 1),
          { id: 'spikes', name: 'Spiked Plate', icon: '🌵', special: 'retaliate', step: 0.6, text: (v) => `Getting hit releases a shockwave (${pct(v * 2)} damage)`, max: 5 },
          { id: 'faith', name: 'Faith', icon: '🙏', stats: { regen: 0.8, duration: 0.1 }, max: 5 },
        ] },
        { title: 'Paragon', swaps: [['quake', 'judgment'], ['cleave', 'holycleave']], passives: [
          cPow('retribution', 'Retribution', '⚜️', 'Divine Shield\'s holy light'),
          { id: 'radiance', name: 'Radiance', icon: '☀️', stats: { dmg: 0.12, area: 0.1 }, max: 5 },
          { id: 'aegis', name: 'Aegis', icon: '🔰', special: 'block', step: 0.04, text: (v) => `+${pct(v)} block chance`, max: 5 },
        ] },
      ],
    },
  ],
  archer: [
    {
      id: 'ranger', name: 'Ranger', icon: '🐺', color: '#7bc96f', desc: 'Nature and beasts. Wolves fight beside you, the ground turns against foes.',
      core: CORES.ranger,
      tiers: [
        { title: 'Ranger', swaps: [['longbow', 'thornarrow'], ['blast', 'wolves']], passives: [
          cGain('bond', 'Primal Bond', '🤝', 'Bond'),
          { id: 'packleader', name: 'Pack Leader', icon: '🐾', special: 'pack', step: 1, flat: true, text: (v) => `+${v} wolf`, max: 3 },
          { id: 'wild', name: 'Call of the Wild', icon: '🌲', stats: { dmg: 0.1, speed: 0.04 }, max: 5 },
        ] },
        { title: 'Beastwarden', swaps: [['traps', 'brambles']], passives: [
          cDur('longhowl', 'Long Howl', '⏳', 'Call of the Pack'),
          { id: 'thornskin', name: 'Thornskin', icon: '🌵', stats: { armor: 0.04, regen: 0.4 }, max: 5 },
          { id: 'harmony', name: 'Harmony', icon: '🍃', stats: { duration: 0.12, area: 0.08 }, max: 5 },
        ] },
        { title: 'Wildheart', swaps: [['fan', 'stampede'], ['rain', 'thornrain']], passives: [
          cPow('alphahowl', 'Alpha Howl', '🐺', 'Call of the Pack'),
          { id: 'alpha', name: 'Alpha', icon: '👑', stats: { dmg: 0.15, cd: 0.06 }, max: 5 },
          { id: 'verdant', name: 'Verdant', icon: '💚', stats: { maxHp: 25, pickup: 0.2 }, max: 5 },
        ] },
      ],
    },
    {
      id: 'marksman', name: 'Marksman', icon: '🎯', color: '#ffd166', desc: 'Precision. Huge single shots, crits and headshots from far away.',
      core: CORES.marksman,
      tiers: [
        { title: 'Marksman', swaps: [['longbow', 'aimed'], ['fan', 'pierce']], passives: [
          { id: 'trained', name: 'Trained Eye', icon: '👁️', special: 'coreGain', step: 0.2, text: (v) => `Focus builds ${pct(v)} faster`, max: 3 },
          { id: 'headshot', name: 'Headshot', icon: '🎯', special: 'headshot', step: 0.04, text: (v) => `Shots have ${pct(v)} chance to deal triple damage`, max: 5 },
          { id: 'steady', name: 'Steady Hands', icon: '🧘', special: 'steady', step: 0.12, text: (v) => `+${pct(v)} damage while standing still`, max: 5 },
        ] },
        { title: 'Sniper', swaps: [['blast', 'snipe']], passives: [
          { id: 'splitshot', name: 'Split Shot', icon: '🔱', special: 'split', step: 1, flat: true, text: (v) => `Each empowered shot also fires ${v} arrow${v > 1 ? 's' : ''} at other foes`, max: 2 },
          { id: 'prolong', name: 'Prolonged Focus', icon: '⏳', special: 'coreDur', step: 2, flat: true, text: (v) => `Deadeye lasts ${v}s longer`, max: 2 },
          { id: 'scope', name: 'Long Scope', icon: '🔭', stats: { critDmg: 0.35, crit: 0.03 }, max: 5 },
          { id: 'hollow', name: 'Hollow Points', icon: '🔩', stats: { pierce: 1, dmg: 0.06 }, flat: true, max: 3 },
        ] },
        { title: 'Deadeye', swaps: [['rain', 'barrage']], passives: [
          { id: 'secondnature', name: 'Second Nature', icon: '🌀', special: 'secondNature', step: 0.25, flat: true, text: (v) => `During Deadeye, each crit adds ${v.toFixed(2)}s to it`, max: 2 },
          { id: 'trueshot', name: 'Trueshot', icon: '☀️', special: 'trueshot', step: 1, flat: true, text: () => 'KEYSTONE. Deadeye has no timer: each empowered arrow drains 7 Focus, every crit refunds 10. Empowered arrows +30% damage', max: 1 },
          { id: 'executioner', name: 'Kill Shot', icon: '🪦', special: 'execute', step: 0.05, text: (v) => `Hits kill foes under ${pct(v)} HP (not bosses)`, max: 4 },
          { id: 'trueaim', name: 'True Aim', icon: '✴️', stats: { crit: 0.06, cd: 0.05 }, max: 5 },
        ] },
      ],
    },
  ],
  mage: [
    {
      id: 'pyro', name: 'Pyromancer', icon: '🔥', color: '#ff7b2e', desc: 'Fire everywhere. Everything burns, and burning foes explode.',
      core: CORES.pyro,
      tiers: [
        { title: 'Pyromancer', swaps: [['missile', 'firemissile'], ['ember', 'meteor']], passives: [
          cGain('heatwave', 'Heat Wave', '🌡️', 'Heat'),
          { id: 'kindling', name: 'Kindling', icon: '🪵', special: 'ignite', step: 0.3, text: (v) => `Fire abilities burn for +${pct(v)} of the hit`, max: 5 },
          { id: 'heat', name: 'Searing Heat', icon: '🌡️', stats: { dmg: 0.12 }, max: 5 },
        ] },
        { title: 'Flamecaller', swaps: [['orbs', 'wreath']], passives: [
          cDur('kindled', 'Undying Flame', '⏳', 'Firestorm'),
          { id: 'combust', name: 'Combustion', icon: '💥', special: 'combust', step: 0.15, text: (v) => `Burning foes explode on death (${pct(v)} of their max HP)`, max: 5 },
          { id: 'blaze', name: 'Blaze', icon: '🔆', stats: { area: 0.1, cd: 0.05 }, max: 5 },
        ] },
        { title: 'Phoenix Sage', swaps: [['spark', 'inferno'], ['frost', 'flamenova']], passives: [
          cPow('rainfire', 'Rain of Fire', '☄️', 'Firestorm'),
          { id: 'rebirth', name: 'Ashen Rebirth', icon: '🐦', stats: { regen: 1, maxHp: 15 }, max: 5 },
          { id: 'sun', name: 'Heart of the Sun', icon: '🌞', stats: { dmg: 0.18, duration: 0.1 }, max: 5 },
        ] },
      ],
    },
    {
      id: 'storm', name: 'Stormcaller', icon: '⚡', color: '#8fd3ff', desc: 'Lightning. Fast casts, strikes that jump from foe to foe.',
      core: CORES.storm,
      tiers: [
        { title: 'Stormcaller', swaps: [['missile', 'shockmissile'], ['ember', 'lance']], passives: [
          cGain('livewire', 'Live Wire', '🔌', 'Charge'),
          { id: 'static', name: 'Static', icon: '🔌', special: 'static', step: 0.08, text: (v) => `Hits have ${pct(v)} chance to zap a nearby foe`, max: 5 },
          { id: 'charged', name: 'Charged', icon: '🔋', stats: { cd: 0.1 }, max: 5 },
        ] },
        { title: 'Tempest', swaps: [['orbs', 'balllight']], passives: [
          cDur('eyestorm', 'Eye of the Storm', '⏳', 'Storm Avatar'),
          { id: 'conduct', name: 'Conductor', icon: '🌩️', special: 'chain', step: 1, flat: true, text: (v) => `Lightning strikes jump to ${v} more foe${v > 1 ? 's' : ''}`, max: 3 },
          { id: 'galeforce', name: 'Gale Force', icon: '💨', stats: { speed: 0.08, area: 0.06 }, max: 5 },
        ] },
        { title: 'Thunderlord', swaps: [['spark', 'thunder'], ['frost', 'thunderclap']], passives: [
          cPow('supercell', 'Supercell', '⛈️', 'Storm Avatar'),
          { id: 'overcharge', name: 'Overcharge', icon: '⚡', stats: { dmg: 0.15, crit: 0.04 }, max: 5 },
          { id: 'eye', name: 'Eye of the Storm', icon: '🌀', special: 'shield', step: 25, text: (v) => `A shield soaks ${Math.round(v)} damage, refills when you avoid hits`, max: 5 },
        ] },
      ],
    },
  ],
};
export const BRANCH: Record<string, BranchDef> = Object.fromEntries(Object.values(BRANCHES).flat().map((b) => [b.id, b]));

// ---------------------------------------------------------------- talent choices
/** Every few levels you pick one of two talents that shape how your job plays (rank 1, permanent). */
export const TALENT_LEVELS = [7, 13, 20, 30, 40];
export type TalentPair = [PassiveDef, PassiveDef];
type TalentSpec = { stats?: Partial<Record<PStat, number>>; sp?: [PSpecial, number][] };
const T = (id: string, name: string, icon: string, desc: string, spec: TalentSpec): PassiveDef => ({
  id, name, icon, desc, stats: spec.stats, special: spec.sp?.[0]?.[0], step: spec.sp?.[0]?.[1], extra: spec.sp?.slice(1), flat: true, max: 1,
});
const BLEED = (id: string, name: string, icon: string, what: string, share: number) =>
  T(id, name, icon, `${what} make foes bleed for ${pct(share * 2)} of the hit over 4s (stacks 5 times, bosses too).`, { sp: [['bleed', share]] });
const RUPTURE = (id: string) =>
  T(id, 'Rupture', '💥', 'KEYSTONE. A 5th bleed stack tears the wound open: all the bleed left lands at once.', { sp: [['rupture', 1]] });
/** Level 7: one class choice before your job. */
export const CLASS_TALENTS: Record<JobId, TalentPair> = {
  warrior: [BLEED('w_rend', 'Rending Strikes', '🩸', 'Your hits', 0.22), T('w_iron', 'Iron Hide', '🛡️', '+30 max HP and 10% less damage taken.', { stats: { maxHp: 30, armor: 0.1 } })],
  archer: [BLEED('a_barbed', 'Barbed Arrows', '🩸', 'Your hits', 0.25), T('a_rapid', 'Rapid Fire', '💨', '+20% attack speed.', { stats: { cd: 0.2 } })],
  mage: [T('m_ignite', 'Ignition', '🔥', 'Fire abilities burn for 40% of the hit over 3s.', { sp: [['ignite', 0.4]] }), T('m_focus', 'Focused Mind', '🧠', 'Mana builds 50% faster and +5% crit chance.', { stats: { crit: 0.05 }, sp: [['coreGain', 0.5]] })],
};
/** Levels 13 / 20 / 30 / 40: choices inside your job. */
export const BRANCH_TALENTS: Record<string, TalentPair[]> = {
  berserker: [
    [BLEED('b_rend', 'Rending Strikes', '🩸', 'Your hits', 0.2), T('b_reckless', 'Reckless', '😤', '+20% damage, but 5% more damage taken.', { stats: { dmg: 0.2, armor: -0.05 } })],
    [T('b_wind', 'Second Wind', '❤️', 'Every bleeding foe near you heals you 0.4 HP a second (up to 10 foes).', { sp: [['bleedHeal', 0.4]] }), T('b_bath', 'Bloodbath', '🌊', 'Each kill: +1.5% damage for 3s (stacks 30).', { sp: [['rampage', 0.015]] })],
    [T('b_hemo', 'Hemorrhage', '💉', 'Bleeding foes take 25% more damage.', { sp: [['bleedAmp', 0.25]] }), T('b_unstop', 'Unstoppable', '🦬', 'Bloodrage is 50% stronger.', { sp: [['corePower', 0.5]] })],
    [RUPTURE('b_rupture'), T('b_endless', 'Endless Rage', '♾️', 'KEYSTONE. Bloodrage lasts 6s longer and Rage builds 50% faster.', { sp: [['coreDur', 6], ['coreGain', 0.5]] })],
  ],
  guardian: [
    [T('g_avenger', 'Holy Avenger', '⚔️', 'Getting hit releases a shockwave for 200% damage.', { sp: [['retaliate', 1]] }), T('g_stalwart', 'Stalwart', '🛡️', '10% chance to block a hit completely.', { sp: [['block', 0.1]] })],
    [T('g_wall', 'Shield Wall', '🧱', '10% less damage taken and +25 max HP.', { stats: { armor: 0.1, maxHp: 25 } }), T('g_smite', 'Smite', '⚡', '+20% damage.', { stats: { dmg: 0.2 } })],
    [T('g_light', 'Bastion of Light', '🔆', "Divine Shield's holy light is 50% stronger.", { sp: [['corePower', 0.5]] }), T('g_zeal', 'Zealotry', '🙏', '+20% attack speed.', { stats: { cd: 0.2 } })],
    [T('g_unbreak', 'Unbreakable', '💎', 'KEYSTONE. Divine Shield lasts 3s longer and Resolve builds 50% faster.', { sp: [['coreDur', 3], ['coreGain', 0.5]] }), T('g_wrath', 'Wrath', '😠', 'KEYSTONE. Shockwaves when hit deal 400% damage, +10% block chance.', { sp: [['retaliate', 2], ['block', 0.1]] })],
  ],
  ranger: [
    [BLEED('r_fangs', 'Serrated Fangs', '🐺', 'Your hits (wolf bites too)', 0.2), T('r_tactics', 'Pack Tactics', '🐾', '+1 wolf and +15% damage.', { stats: { dmg: 0.15 }, sp: [['pack', 1]] })],
    [T('r_thorned', 'Thorned Earth', '🌵', 'Bleeding foes take 20% more damage.', { sp: [['bleedAmp', 0.2]] }), T('r_growth', 'Wild Growth', '🌱', '+25% size and +20% duration.', { stats: { area: 0.25, duration: 0.2 } })],
    [T('r_scent', 'Bloodscent', '👃', 'Every bleeding foe near you heals you 0.3 HP a second (up to 10 foes).', { sp: [['bleedHeal', 0.3]] }), T('r_alpha', "Alpha's Call", '📯', 'Call of the Pack is 50% stronger (more wolves).', { sp: [['corePower', 0.5]] })],
    [RUPTURE('r_rupture'), T('r_eternal', 'Eternal Pack', '🌕', 'KEYSTONE. Two of the Call of the Pack wolves stay with you for good.', { sp: [['eternalPack', 2]] })],
  ],
  marksman: [
    [BLEED('k_barbed', 'Barbed Shots', '🩸', 'Your hits', 0.2), T('k_precise', 'Precision', '🎯', '+10% crit chance and +30% crit damage.', { stats: { crit: 0.1, critDmg: 0.3 } })],
    [T('k_hemo', 'Hemorrhage', '💉', 'Bleeding foes take 25% more damage.', { sp: [['bleedAmp', 0.25]] }), T('k_long', 'Long Shot', '🔭', '+30% damage to foes far away.', { sp: [['sharpshot', 0.3]] })],
    [T('k_lethal', 'Lethal Wounds', '🗡️', 'Crits add 2 bleed stacks instead of 1.', { sp: [['critBleed', 1]] }), T('k_steady', 'Steady Aim', '🧘', '+30% damage while standing still.', { sp: [['steady', 0.3]] })],
    [RUPTURE('k_rupture'), T('k_rapid', 'Rapid Deadeye', '⏱️', 'KEYSTONE. Deadeye lasts 4s longer and Focus builds 50% faster.', { sp: [['coreDur', 4], ['coreGain', 0.5]] })],
  ],
  pyro: [
    [T('p_sear', 'Searing', '🔥', 'Fire abilities burn for +50% of the hit.', { sp: [['ignite', 0.5]] }), T('p_bomb', 'Living Bomb', '💣', 'Burning foes explode on death (20% of their max HP).', { sp: [['combust', 0.2]] })],
    [T('p_scorch', 'Scorched Earth', '🌋', '+30% duration and +10% size.', { stats: { duration: 0.3, area: 0.1 } }), T('p_flash', 'Flashpoint', '✴️', '+10% crit chance and +30% crit damage.', { stats: { crit: 0.1, critDmg: 0.3 } })],
    [T('p_storm', 'Raging Firestorm', '☄️', 'Firestorm is 50% stronger (more meteors).', { sp: [['corePower', 0.5]] }), T('p_kindle', 'Kindling', '🪵', 'Heat builds 50% faster.', { sp: [['coreGain', 0.5]] })],
    [T('p_heart', 'Inferno Heart', '❤️‍🔥', 'KEYSTONE. Burning foes take 30% more damage.', { sp: [['burnAmp', 0.3]] }), T('p_ever', 'Everburning', '♾️', 'KEYSTONE. Firestorm lasts 6s longer.', { sp: [['coreDur', 6]] })],
  ],
  storm: [
    [T('s_overload', 'Overload', '🌩️', 'Lightning strikes jump to 2 more foes.', { sp: [['chain', 2]] }), T('s_field', 'Static Field', '🔌', 'Hits have 15% chance to zap a nearby foe.', { sp: [['static', 0.15]] })],
    [T('s_struck', 'Thunderstruck', '⚡', '+10% crit chance and +30% crit damage.', { stats: { crit: 0.1, critDmg: 0.3 } }), T('s_quick', 'Quickening', '⏩', '+20% attack speed.', { stats: { cd: 0.2 } })],
    [T('s_eye', 'Eye of the Storm', '🌀', 'Storm Avatar is 50% stronger (more strikes).', { sp: [['corePower', 0.5]] }), T('s_wire', 'Live Wire', '🔋', 'Charge builds 50% faster.', { sp: [['coreGain', 0.5]] })],
    [T('s_endless', 'Endless Storm', '♾️', 'KEYSTONE. Storm Avatar lasts 6s longer.', { sp: [['coreDur', 6]] }), T('s_super', 'Superconductor', '🔱', 'KEYSTONE. Lightning jumps to 2 more foes and hits zap 10% of the time.', { sp: [['chain', 2], ['static', 0.1]] })],
  ],
};

export const PASSIVE: Record<string, PassiveDef> = Object.fromEntries(
  [
    ...Object.values(PASSIVES).flat(),
    ...Object.values(BRANCHES).flat().flatMap((b) => b.tiers.flatMap((t) => t.passives)),
    ...Object.values(CLASS_TALENTS).flat(),
    ...Object.values(BRANCH_TALENTS).flat(2),
  ].map((p) => [p.id, p]),
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
  /** only from King Jelly, never from chests */
  bossOnly?: boolean;
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
  { id: 'royaljelly', name: 'Royal Jelly', icon: '👑', rarity: 'legendary', desc: 'From King Jelly: +40 max HP, +1 HP regen', stats: { maxHp: 40, regen: 1 }, bossOnly: true },
  { id: 'phoenix', name: 'Phoenix Plume', icon: '🔆', rarity: 'legendary', desc: 'Revive once at full HP', proc: 'revive' },
];
export const ITEM: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// ---------------------------------------------------------------- heroes
export interface HeroDef {
  job: JobId;
  name: string;
  /** auto attack you start with */
  basic: string;
  /** 4 base abilities, unlocked at ABILITY_LEVELS */
  abilities: string[];
  passive: string;
  stats: Partial<Record<PStat, number>>;
  hp: number;
  speed: number;
}
export const HEROES: Record<JobId, HeroDef> = {
  warrior: { job: 'warrior', name: 'Warrior', basic: 'slash', abilities: ['cleave', 'whirl', 'quake', 'hatchet'], passive: 'Sturdy: 10% less damage taken, +0.5 HP regen', stats: { armor: 0.1, regen: 0.5 }, hp: 140, speed: 225 },
  archer: { job: 'archer', name: 'Archer', basic: 'longbow', abilities: ['rain', 'traps', 'blast', 'fan'], passive: 'Nimble: +10% move speed, +8% crit chance', stats: { speed: 0.1, crit: 0.08 }, hp: 100, speed: 235 },
  mage: { job: 'mage', name: 'Mage', basic: 'missile', abilities: ['spark', 'frost', 'orbs', 'ember'], passive: 'Scholar: +15% size, +15% EXP', stats: { area: 0.15, xp: 0.15 }, hp: 90, speed: 225 },
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
export const FINAL_BOSS: BossDef = { name: 'The Gloom Tide', color: '#7a3fb5', r: 95, hp: 420000, speed: 105, dmg: 28 };

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
