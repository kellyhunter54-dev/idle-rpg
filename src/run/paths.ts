// Ability paths: every base ability grows its own little tree over a run.
// Tier 1: pick a form (Fire / Frost / Storm, or your job's form of the ability).
// Tier 2: choices that depend on that form.  Tier 3: a capstone for your tier 2 pick, or one of the ability's own capstones.
// Every pick locks out the others; the ability keeps its upgrades all the way.
import { JobId } from '../data';
import { WEAPON, WeaponDef } from './data';

export interface PathNode {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** colour for the card and the ability (elements) */
  color?: string;
  /** new name for the ability; {n} is the current name */
  rename?: string;
  /** turn into another ability (keeps the upgrades, like a job form) */
  becomes?: string;
  /** changes to the ability's definition, given the current one */
  mod?: (d: WeaponDef) => Partial<WeaponDef>;
  /** stat changes on the owned ability: dmg/area/duration/speed multiply, count/pierce add, haste adds attack speed */
  mult?: { dmg?: number; area?: number; duration?: number; speed?: number; count?: number; pierce?: number; haste?: number };
  /** options for the next tier */
  next?: () => PathNode[];
  /** tier 3 nodes that come from the element / job line rather than the ability */
  cap?: boolean;
}

// ---------------------------------------------------------------- elements (any ability)
const FIRE_CAPS = {
  sunfire: { id: 'sunfire', name: 'Sunfire', icon: '☀️', cap: true, desc: '+40% damage, and +30% more against burning foes.', mult: { dmg: 1.4 }, mod: (d) => ({ ampBurn: (d.ampBurn ?? 0) + 0.3 }) } as PathNode,
  meltdown: { id: 'meltdown', name: 'Meltdown', icon: '💥', cap: true, desc: 'Explosions are 80% bigger and burn twice as hard.', mod: (d) => ({ blast: (d.blast ?? 70) * 1.8, burn: (d.burn ?? 0.4) * 2 }) } as PathNode,
};
const FROST_CAPS = {
  glacier: { id: 'glacier', name: 'Glacier', icon: '🏔️', cap: true, desc: '+40% size and a 35% chance to freeze.', mult: { area: 1.4 }, mod: () => ({ freeze: 0.35 }) } as PathNode,
  zero: { id: 'zero', name: 'Absolute Zero', icon: '🧊', cap: true, desc: '+20% damage; chilled foes take +60% from this ability.', mult: { dmg: 1.2 }, mod: (d) => ({ ampChill: (d.ampChill ?? 0) + 0.3 }) } as PathNode,
};
const STORM_CAPS = {
  tempest: { id: 'tempest', name: 'Tempest', icon: '🌪️', cap: true, desc: 'Lightning jumps to 2 more foes, and +20% damage.', mult: { dmg: 1.2 }, mod: (d) => ({ chain: (d.chain ?? 0) + 2 }) } as PathNode,
  supercell: { id: 'supercell', name: 'Supercell', icon: '⛈️', cap: true, desc: '+50% damage against shocked foes, +20% attack speed.', mult: { haste: 0.2 }, mod: (d) => ({ ampShock: (d.ampShock ?? 0) + 0.5 }) } as PathNode,
};
const ELEMENTS = (abilityCaps: () => PathNode[]): PathNode[] => [
  {
    id: 'fire', name: 'Flame', icon: '🔥', color: '#ff8c42', rename: '{n} of Flame', desc: 'Hits set foes on fire (burn 40% of the hit over 3s).',
    mod: () => ({ fire: true, burn: 0.4, color: '#ff8c42' }),
    next: () => [
      { id: 'inferno_p', name: 'Inferno', icon: '🌋', desc: '+35% size, and burns 50% harder.', mult: { area: 1.35 }, mod: (d) => ({ burn: (d.burn ?? 0.4) * 1.5 }), next: () => [FIRE_CAPS.sunfire, ...abilityCaps()] },
      { id: 'firebrand', name: 'Firebrand', icon: '🧨', desc: 'Hits explode in a small blast for 50% damage.', mod: (d) => ({ blast: Math.max(d.blast ?? 0, 70) }), next: () => [FIRE_CAPS.meltdown, ...abilityCaps()] },
    ],
  },
  {
    id: 'frost', name: 'Frost', icon: '❄️', color: '#a8e6ff', rename: '{n} of Frost', desc: 'Hits chill (slow) foes, with a 10% chance to freeze them in place.',
    mod: () => ({ slow: true, freeze: 0.1, color: '#a8e6ff' }),
    next: () => [
      { id: 'deepfreeze', name: 'Deep Freeze', icon: '🥶', desc: '25% freeze chance and +20% damage.', mult: { dmg: 1.2 }, mod: (d) => ({ freeze: Math.max(d.freeze ?? 0, 0.25) }), next: () => [FROST_CAPS.glacier, ...abilityCaps()] },
      { id: 'shatter', name: 'Shatter', icon: '🔹', desc: 'Chilled foes take +30% from this ability, and hits shatter into shards (small blast).', mod: (d) => ({ ampChill: (d.ampChill ?? 0) + 0.3, blast: Math.max(d.blast ?? 0, 55) }), next: () => [FROST_CAPS.zero, ...abilityCaps()] },
    ],
  },
  {
    id: 'storm', name: 'Storm', icon: '⚡', color: '#ffe66d', rename: '{n} of Storms', desc: 'Hits shock foes (+10% damage taken) and jump to 1 more foe.',
    mod: (d) => ({ shock: true, chain: (d.chain ?? 0) + 1, color: '#ffe66d' }),
    next: () => [
      { id: 'chainlight', name: 'Chain Lightning', icon: '🔗', desc: 'Lightning jumps to 2 more foes.', mod: (d) => ({ chain: (d.chain ?? 0) + 2 }), next: () => [STORM_CAPS.tempest, ...abilityCaps()] },
      { id: 'overcharge', name: 'Overcharge', icon: '🔋', desc: '+30% damage against shocked foes, +15% attack speed.', mult: { haste: 0.15 }, mod: (d) => ({ ampShock: (d.ampShock ?? 0) + 0.3 }), next: () => [STORM_CAPS.supercell, ...abilityCaps()] },
    ],
  },
];

// ---------------------------------------------------------------- each ability's own capstones
const C = (id: string, name: string, icon: string, desc: string, rest: Partial<PathNode>): PathNode => ({ id, name, icon, desc, ...rest });
const ABILITY_CAPS: Record<string, PathNode[]> = {
  // Archer
  rain: [C('stormcloud', 'Storm Cloud', '☁️', 'The rain follows you around, and lasts 30% longer.', { mult: { duration: 1.3 }, mod: () => ({ follow: true }) }), C('deluge', 'Deluge', '🌊', '+2 rain zones at a time.', { mult: { count: 2, dmg: 0.9 } })],
  traps: [C('minefield', 'Minefield', '💣', '+2 traps, and each one bursts when it lands.', { mult: { count: 2 }, mod: (d) => ({ blast: Math.max(d.blast ?? 0, 60) }) }), C('snare', 'Snare', '🪢', 'Traps hold foes: 30% freeze chance and a slow.', { mod: () => ({ freeze: 0.3, slow: true }) })],
  blast: [C('cluster', 'Cluster Bomb', '🎆', 'Explosions are 60% bigger.', { mod: (d) => ({ blast: (d.blast ?? 80) * 1.6 }) }), C('volleyfire', 'Volley Fire', '🎯', '+2 shots per volley, +20% attack speed.', { mult: { count: 2, haste: 0.2 } })],
  fan: [C('hail', 'Hail of Arrows', '🌨️', '+4 arrows in every fan.', { mult: { count: 4 } }), C('bodkin', 'Bodkin Points', '🗡️', '+3 pierce and +30% damage.', { mult: { pierce: 3, dmg: 1.3 } })],
  // Warrior
  cleave: [C('execarc', "Executioner's Arc", '🪓', '+50% damage, +10% crit chance.', { mult: { dmg: 1.5 }, mod: (d) => ({ crit: (d.crit ?? 0) + 0.1 }) }), C('whirlarc', 'Whirling Arc', '🌀', '+2 sweeps in every swing.', { mult: { count: 2 } })],
  whirl: [C('bladestorm', 'Bladestorm', '🌪️', '+2 blades and they spin 40% longer.', { mult: { count: 2, duration: 1.4 } }), C('razor', 'Razor Edge', '🔪', '+60% damage.', { mult: { dmg: 1.6 } })],
  quake: [C('aftershock', 'Aftershock', '〰️', 'Every slam sends a second shockwave.', { mult: { count: 2 } }), C('earthbreaker', 'Earthbreaker', '⛰️', '+50% size, +20% damage.', { mult: { area: 1.5, dmg: 1.2 } })],
  hatchet: [C('twinaxe', 'Twin Axes', '🪓', '+1 axe per throw.', { mult: { count: 1 } }), C('heavyaxe', 'Heavy Axe', '⚒️', '+60% damage, +30% size.', { mult: { dmg: 1.6, area: 1.3 } })],
  // Mage
  spark: [C('thunderhead', 'Thunderhead', '🌩️', '+3 strikes per cast.', { mult: { count: 3 } }), C('focusbolt', 'Focused Bolt', '⚡', '+70% damage, +30% size.', { mult: { dmg: 1.7, area: 1.3 } })],
  frost: [C('permafrost', 'Permafrost', '🧊', 'Chills last 60% longer and +20% damage.', { mult: { duration: 1.6, dmg: 1.2 } }), C('twinring', 'Twin Rings', '⭕', 'Every cast sends a second ring.', { mult: { count: 2 } })],
  orbs: [C('orbitfield', 'Orbit Field', '🪐', '+2 orbs and +30% size.', { mult: { count: 2, area: 1.3 } }), C('heavyorbs', 'Heavy Orbs', '⚫', '+60% damage.', { mult: { dmg: 1.6 } })],
  ember: [C('scatter', 'Scatter Shot', '🎇', '+2 bolts per cast.', { mult: { count: 2 } }), C('greatball', 'Great Fireball', '☄️', '+60% size, +40% damage.', { mult: { area: 1.6, dmg: 1.4 } })],
};

// ---------------------------------------------------------------- job forms (tier 1, needs that job)
/** Which base ability turns into which job ability. */
export const JOB_FORMS: Record<string, Record<string, string>> = {
  berserker: { cleave: 'warcleave', whirl: 'rend', quake: 'bloodnova', hatchet: 'reaver' },
  guardian: { cleave: 'holycleave', whirl: 'consecrate', quake: 'judgment', hatchet: 'shieldtoss' },
  ranger: { rain: 'thornrain', traps: 'brambles', blast: 'wolves', fan: 'stampede' },
  marksman: { rain: 'barrage', blast: 'snipe', fan: 'pierce' },
  pyro: { spark: 'inferno', frost: 'flamenova', orbs: 'wreath', ember: 'meteor' },
  storm: { spark: 'thunder', frost: 'thunderclap', orbs: 'balllight', ember: 'lance' },
};
const JOB_CAPS = (jobName: string): PathNode[] => [
  C('ascended', `Ascended ${jobName}`, '👑', '+50% damage and +20% size.', { cap: true, mult: { dmg: 1.5, area: 1.2 } }),
  C('legion', 'Legion', '⚔️', '+2 to its count (more wolves, zones, strikes, blades...).', { cap: true, mult: { count: 2 } }),
];
function jobForm(branch: string, branchName: string, base: string): PathNode | null {
  const to = JOB_FORMS[branch]?.[base];
  if (!to) return null;
  const d = WEAPON[to];
  return {
    id: `job_${to}`, name: d.name, icon: d.icon, color: d.color, becomes: to,
    desc: `${branchName} form: becomes ${d.name}. ${d.desc}`,
    next: () => [
      C(`mastery_${to}`, `${d.name} Mastery`, '📈', '+35% damage and +15% size.', { mult: { dmg: 1.35, area: 1.15 }, next: () => JOB_CAPS(branchName) }),
      C(`multi_${to}`, 'Multiply', '➕', '+1 to its count and +15% attack speed.', { mult: { count: 1, haste: 0.15 }, next: () => JOB_CAPS(branchName) }),
    ],
  };
}

/** Tier 1 options for a base ability: the three elements, plus your job's form if it has one. */
export function pathRoots(base: string, branch: { id: string; name: string } | null): PathNode[] {
  const caps = () => ABILITY_CAPS[base] ?? [];
  const out = ELEMENTS(caps);
  const jf = branch ? jobForm(branch.id, branch.name, base) : null;
  if (jf) out.push(jf);
  return out;
}

/** Walks a chosen path (list of node ids) and returns the options for the next tier. */
export function pathNext(base: string, branch: { id: string; name: string } | null, chosen: string[]): PathNode[] {
  let opts = pathRoots(base, branch);
  for (const id of chosen) {
    const n = opts.find((o) => o.id === id);
    if (!n?.next) return [];
    opts = n.next();
  }
  return opts;
}

/** Looks up a chosen node (for tooltips). */
export function pathNode(base: string, branch: { id: string; name: string } | null, chosen: string[], k: number): PathNode | undefined {
  let opts = pathRoots(base, branch);
  for (let i = 0; i < k; i++) opts = opts.find((o) => o.id === chosen[i])?.next?.() ?? [];
  return opts.find((o) => o.id === chosen[k]);
}

export type { JobId };
