// Ability paths: every base ability grows its own little tree over a run.
// Tier 1: pick a form (Archer: hand-made forms per ability; others: Fire / Frost / Storm), or your job's form of the ability.
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

// ---------------------------------------------------------------- Archer: hand-made trees (no elements)
// Each base ability has three forms that play differently, each with its own follow-ups and capstones.
const X = (id: string, name: string, icon: string, desc: string, rest: Partial<PathNode>): PathNode => ({ id, name, icon, desc, ...rest });
const ARCHER_TREES: Record<string, () => PathNode[]> = {
  // Arrow Rain
  rain: () => {
    const monsoonCaps = (): PathNode[] => [
      X('typhoon', 'Typhoon', '🌀', 'The pull is twice as strong and the storm is 30% bigger.', { mult: { area: 1.3 }, mod: (d) => ({ pull: (d.pull ?? 0) + 160 }) }),
      X('tidalwave', 'Tidal Wave', '🌊', 'When the storm ends, a wave hits everything inside for 12 ticks of damage.', { mod: () => ({ finale: 12 }) }),
    ];
    const huntCaps = (): PathNode[] => [
      X('redrain', 'Red Rain', '🩸', 'Bleeding foes take +50% from the rain, and it bleeds even harder.', { mod: (d) => ({ ampBleed: 0.5, bleedHit: (d.bleedHit ?? 0) + 0.25 }) }),
      X('execution', 'Execution', '⚖️', 'The last moment of the rain drops one huge arrow: 20 ticks of damage on everything under it.', { mod: () => ({ finale: 20 }) }),
    ];
    const burstCaps = (): PathNode[] => [
      X('endless', 'Endless Storm', '♾️', 'Up to 12 clouds at once, and they last 40% longer.', { mult: { duration: 1.4 }, mod: () => ({ spawnOnKill: 12 }) }),
      X('thunderhead', 'Thunderhead', '🌩️', 'Every new cloud opens with a crash worth 4 ticks.', { mod: () => ({ opener: 4 }) }),
    ];
    return [
      X('monsoon', 'Monsoon', '🌧️', 'A slow-growing storm: lasts 40% longer and swells to 140% size.', {
        color: '#7fb8ff', rename: 'Monsoon', mult: { duration: 1.4 }, mod: () => ({ grow: 0.7, color: '#7fb8ff' }),
        next: () => [
          X('soaking', 'Soaking Rain', '💧', 'Foes in the rain are Soaked: +12% damage from everything you do.', { mod: () => ({ soak: 0.12 }), next: monsoonCaps }),
          X('undertow', 'Undertow', '🌀', 'The storm drags foes toward its middle.', { mod: () => ({ pull: 90 }), next: monsoonCaps }),
        ],
      }),
      X('huntrain', "Hunter's Rain", '🎯', 'The rain locks onto the toughest foe and follows it. +25% damage.', {
        color: '#ff8a5c', rename: "Hunter's Rain", mult: { dmg: 1.25 }, mod: () => ({ track: true, color: '#ff8a5c' }),
        next: () => [
          X('barbedrain', 'Barbed Rain', '🪝', 'Every arrow makes them bleed.', { mod: () => ({ bleedHit: 0.4 }), next: huntCaps }),
          X('deadlyaim', 'Deadly Aim', '🎯', '+25% crit chance and +20% damage.', { mult: { dmg: 1.2 }, mod: (d) => ({ crit: (d.crit ?? 0) + 0.25 }), next: huntCaps }),
        ],
      }),
      X('cloudburst', 'Cloudburst', '⛈️', 'A kill in the rain opens a new cloud on the nearest foe (up to 6 at once).', {
        color: '#b7a6ff', rename: 'Cloudburst', mod: () => ({ spawnOnKill: 6, color: '#b7a6ff' }),
        next: () => [
          X('showers', 'Scattered Showers', '🌦️', '+2 clouds per cast, each a bit smaller.', { mult: { count: 2, area: 0.85 }, next: burstCaps }),
          X('gathering', 'Gathering Storm', '🌫️', 'Clouds born from kills hit 40% harder.', { mod: () => ({ spawnAmp: 0.4 }), next: burstCaps }),
        ],
      }),
    ];
  },
  // Spike Traps
  traps: () => {
    const mineCaps = (): PathNode[] => [
      X('minefield', 'Minefield', '🗺️', '+3 mines per throw, and they wait twice as long.', { mult: { count: 3, duration: 2 } }),
      X('bigbang', 'Big Bang', '💥', 'Blasts are 70% bigger and stun foes for 1s.', { mod: () => ({ boomSize: 1.7, stun: 1 }) }),
    ];
    const bearCaps = (): PathNode[] => [
      X('prize', "Hunter's Prize", '🏆', 'Snared foes take +50% damage (up from +25%) and are held twice as long.', { mod: () => ({ snareAmp: 0.5, snareHold: 3 }) }),
      X('steeljaws', 'Steel Jaws', '⚙️', '+2 traps per throw, and the snap hits 50% harder.', { mult: { count: 2, dmg: 1.5 } }),
    ];
    const caltropCaps = (): PathNode[] => [
      X('hemorrhage', 'Hemorrhage', '🩸', 'Bleeding foes take +60% from the spikes.', { mod: (d) => ({ ampBleed: 0.6, bleedHit: Math.max(d.bleedHit ?? 0, 0.3) }) }),
      X('ironmaiden', 'Iron Maiden', '⛓️', 'Spikes grind up to x5 and the fields are 30% bigger.', { mult: { area: 1.3 }, mod: () => ({ ramp: 5 }) }),
    ];
    return [
      X('landmine', 'Landmines', '💣', 'Traps become hidden mines that wait for a foe, then blow up for 10x damage.', {
        color: '#ffb35c', rename: 'Landmines', mod: () => ({ mine: 10, color: '#ffb35c' }),
        next: () => [
          X('claymore', 'Claymore', '🧨', 'Each blast throws 8 shards in a ring.', { mod: () => ({ shrapnel: 8 }), next: mineCaps }),
          X('chainreact', 'Chain Reaction', '🔗', 'A blast sets off every mine near it and leaves spikes behind.', { mod: () => ({ chainMine: true }), next: mineCaps }),
        ],
      }),
      X('beartrap', 'Bear Trap', '🦴', 'A trap snaps shut on the toughest foe: 10x damage, holds it 1.5s, and it is Snared (+25% damage from everything).', {
        color: '#c8ccd4', rename: 'Bear Trap', mod: () => ({ snare: 10, snareAmp: 0.25, snareHold: 1.5, color: '#c8ccd4' }),
        next: () => [
          X('barbedjaws', 'Barbed Jaws', '🪝', 'The snap fills the bleed to 5 stacks at once.', { mod: () => ({ snareBleed: true }), next: bearCaps }),
          X('tether', 'Tether', '⛓️', 'The snap drags every foe nearby onto the trapped one and dazes them.', { mod: () => ({ tether: true }), next: bearCaps }),
        ],
      }),
      X('caltrops', 'Caltrops', '✴️', 'Spikes scatter at your feet as you move: +2 fields that last longer, hit 2.5x as hard, and slow.', {
        color: '#9aa3b5', rename: 'Caltrops', mult: { count: 2, dmg: 2.5, duration: 1.6 }, mod: () => ({ atFeet: true, slow: true, color: '#9aa3b5' }),
        next: () => [
          X('barbedcal', 'Barbed Caltrops', '🪝', 'The spikes make foes bleed.', { mod: () => ({ bleedHit: 0.35 }), next: caltropCaps }),
          X('grinding', 'Grinding Spikes', '⚙️', 'Every tick on the same foe cuts 25% deeper (up to x3).', { mod: () => ({ ramp: 3 }), next: caltropCaps }),
        ],
      }),
    ];
  },
  // Explosive Shot
  blast: () => {
    const clusterCaps = (): PathNode[] => [
      X('daisychain', 'Daisy Chain', '🎆', 'Bomblets split into 2 more bomblets.', { mod: () => ({ cluster2: true }) }),
      X('payload', 'Heavy Payload', '🏋️', '+50% damage and bigger blasts.', { mult: { dmg: 1.5, area: 1.25 } }),
    ];
    const stickCaps = (): PathNode[] => [
      X('demolition', 'Demolition', '🏚️', 'Charges finish normal foes under 30% HP and hit bosses 50% harder.', { mod: () => ({ demolish: 0.3 }) }),
      X('shaped', 'Shaped Charge', '🎯', 'A longer fuse, and the whole payload goes into the stuck foe (x2).', { mod: () => ({ shaped: true }) }),
    ];
    const shardCaps = (): PathNode[] => [
      X('frag', 'Fragmentation', '💢', 'Every shard bursts where it hits.', { mod: () => ({ fragBlast: true }) }),
      X('seeking', 'Seeking Shards', '🧲', 'Shards curve toward foes, and +2 more of them.', { mod: (d) => ({ homeShards: true, shrapnel: (d.shrapnel ?? 0) + 2 }) }),
    ];
    return [
      X('cluster', 'Cluster Bomb', '🧨', 'The blast throws 3 bomblets around that go off a moment later.', {
        color: '#ff9a3c', rename: 'Cluster Bomb', mod: () => ({ cluster: 3, color: '#ff9a3c' }),
        next: () => [
          X('carpet', 'Carpet Bomb', '🎇', '+3 bomblets.', { mod: (d) => ({ cluster: (d.cluster ?? 3) + 3 }), next: clusterCaps }),
          X('concussive', 'Concussive', '😵', 'Blasts knock foes back hard and stun them for 0.6s.', { mod: () => ({ stun: 0.6 }), next: clusterCaps }),
        ],
      }),
      X('sticky', 'Sticky Charge', '🧷', 'The arrow sticks in the toughest foe and blows up 1.2s later for 1.5x. Your other hits on that foe add to the bomb.', {
        color: '#ff6b4a', rename: 'Sticky Charge', mod: () => ({ blast: 0, stick: 1.5, stickFeed: 0.04, color: '#ff6b4a' }),
        next: () => [
          X('overpacked', 'Overpacked', '📦', '+30% damage, and your hits feed the bomb 3x as much.', { mult: { dmg: 1.3 }, mod: () => ({ stickFeed: 0.12 }), next: stickCaps }),
          X('chaindet', 'Chain Detonation', '🔗', 'When a charge goes off, it plants another on the nearest foe.', { mod: () => ({ restick: true }), next: stickCaps }),
        ],
      }),
      X('shrapnel', 'Shrapnel Shot', '✳️', 'The blast throws 6 piercing shards outward.', {
        color: '#ffcf8a', rename: 'Shrapnel Shot', mod: () => ({ shrapnel: 6, color: '#ffcf8a' }),
        next: () => [
          X('flechette', 'Flechettes', '🪡', '+4 shards and they pierce 2 more foes.', { mult: { pierce: 2 }, mod: (d) => ({ shrapnel: (d.shrapnel ?? 6) + 4 }), next: shardCaps }),
          X('barbedshrap', 'Barbed Shrapnel', '🪝', 'Shards and blasts make foes bleed.', { mod: () => ({ bleedHit: 0.5 }), next: shardCaps }),
        ],
      }),
    ];
  },
  // Fan of Arrows
  fan: () => {
    const shotgunCaps = (): PathNode[] => [
      X('doublebarrel', 'Double Barrel', '🔫', 'Fires a second blast right after the first.', { mod: () => ({ doubleTap: true }) }),
      X('pointblank', 'Point Blank', '💥', 'Up close it hits even harder (+80%) with +20% crit chance.', { mod: (d) => ({ closeAmp: (d.closeAmp ?? 0) + 0.8, crit: (d.crit ?? 0) + 0.2 }) }),
    ];
    const bounceCaps = (): PathNode[] => [
      X('seeker', 'Seeker', '🧭', 'Arrows curve toward foes, and +1 bounce.', { mod: (d) => ({ homing: true, bounce: (d.bounce ?? 0) + 1 }) }),
      X('grandfinale', 'Grand Finale', '🎆', 'The last bounce explodes.', { mod: () => ({ bounceBlast: true }) }),
    ];
    const novaCaps = (): PathNode[] => [
      X('arrowstorm', 'Arrow Storm', '🌪️', '+6 arrows in the ring.', { mult: { count: 6 } }),
      X('barbedring', 'Barbed Ring', '🪝', 'The ring makes foes bleed, and +20% damage.', { mult: { dmg: 1.2 }, mod: () => ({ bleedHit: 0.5 }) }),
    ];
    return [
      X('shotgun', 'Shotgun', '💨', 'A tight cone: +2 arrows that pierce 1 more foe, +30% damage, and double damage up close.', {
        color: '#ffd166', rename: 'Shotgun Volley', mult: { count: 2, dmg: 1.3, pierce: 1 }, mod: (d) => ({ spread: (d.spread ?? 0.22) * 0.5, closeAmp: 1, color: '#ffd166' }),
        next: () => [
          X('buckshot', 'Buckshot', '🔸', 'Each arrow splits in two when it hits.', { mod: () => ({ splitHit: true }), next: shotgunCaps }),
          X('knockdown', 'Knockdown', '🥊', 'Up close, arrows stun foes for 0.5s.', { mod: () => ({ stun: 0.5 }), next: shotgunCaps }),
        ],
      }),
      X('ricochet', 'Ricochet', '↩️', 'Arrows bounce to 2 more foes after a hit.', {
        color: '#8fd3ff', rename: 'Ricochet', mod: () => ({ bounce: 2, color: '#8fd3ff' }),
        next: () => [
          X('trickshot', 'Trick Shot', '🎩', 'Each bounce hits 30% harder than the last.', { mod: () => ({ bounceAmp: 0.3 }), next: bounceCaps }),
          X('pinball', 'Pinball', '🎱', '+3 bounces.', { mod: (d) => ({ bounce: (d.bounce ?? 2) + 3 }), next: bounceCaps }),
        ],
      }),
      X('arrownova', 'Arrow Nova', '✴️', 'The fan becomes a full ring of arrows: +3 arrows.', {
        color: '#b9f5c8', rename: 'Arrow Nova', mult: { count: 3 }, mod: () => ({ ring: true, color: '#b9f5c8' }),
        next: () => [
          X('spiral', 'Spiral', '🌀', 'A second ring follows, turned half a step.', { mod: () => ({ doubleTap: true }), next: novaCaps }),
          X('thornwall', 'Thorn Wall', '🧱', 'Arrows stop and hang in the air for 3s: a wide ring of thorns the horde has to cross. They hit 3x as hard and fire 30% faster.', { mult: { dmg: 3, haste: 0.3 }, mod: () => ({ hang: 3 }), next: novaCaps }),
        ],
      }),
    ];
  },
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
  const out = ARCHER_TREES[base] ? ARCHER_TREES[base]() : ELEMENTS(caps);
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
