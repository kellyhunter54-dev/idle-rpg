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
  // Glaive (replaced Spike Traps)
  glaive: () => {
    const bounceCaps = (): PathNode[] => [
      X('seeker', 'Seeker', '🧭', 'The glaive curves toward foes, and +1 bounce.', { mod: (d) => ({ homing: true, bounce: (d.bounce ?? 0) + 1 }) }),
      X('grandfinale', 'Grand Finale', '🎆', 'The last bounce explodes.', { mod: () => ({ bounceBlast: true }) }),
    ];
    const razorCaps = (): PathNode[] => [
      X('bloodletter', 'Bloodletter', '🩸', 'Bleeding foes take +60% from the glaive.', { mod: (d) => ({ ampBleed: (d.ampBleed ?? 0) + 0.6 }) }),
      X('keenedge', 'Keen Edge', '🔪', '+30% crit chance and +25% damage.', { mult: { dmg: 1.25 }, mod: (d) => ({ crit: (d.crit ?? 0) + 0.3 }) }),
    ];
    const twinCaps = (): PathNode[] => [
      X('glaivestorm', 'Glaive Storm', '🌪️', '+2 glaives.', { mult: { count: 2 } }),
      X('whirling', 'Whirling Death', '💥', 'Each glaive explodes on its last bounce.', { mod: () => ({ bounceBlast: true }) }),
    ];
    return [
      X('ricochet', 'Ricochet', '↩️', '+2 bounces (6 hits).', {
        color: '#8fd3ff', rename: 'Ricochet Glaive', mod: (d) => ({ bounce: (d.bounce ?? 3) + 2, color: '#8fd3ff' }),
        next: () => [
          X('trickshot', 'Trick Shot', '🎩', 'Each bounce hits 30% harder than the last.', { mod: () => ({ bounceAmp: 0.3 }), next: bounceCaps }),
          X('pinball', 'Pinball', '🎱', '+3 bounces.', { mod: (d) => ({ bounce: (d.bounce ?? 5) + 3 }), next: bounceCaps }),
        ],
      }),
      X('razor', 'Razor Glaive', '🔪', 'Every hit makes foes bleed, and +20% damage.', {
        color: '#ff6b6b', rename: 'Razor Glaive', mult: { dmg: 1.2 }, mod: () => ({ bleedHit: 0.5, color: '#ff6b6b' }),
        next: () => [
          X('serrated', 'Serrated Edge', '🪚', 'Bleeding foes take +40% from the glaive.', { mod: () => ({ ampBleed: 0.4 }), next: razorCaps }),
          X('deepcuts', 'Deep Cuts', '🩸', 'The bleed is twice as strong.', { mod: () => ({ bleedHit: 1 }), next: razorCaps }),
        ],
      }),
      X('twin', 'Twin Glaives', '♊', 'Throws 2 glaives (each 80% damage).', {
        color: '#b9f5c8', rename: 'Twin Glaives', mult: { count: 1, dmg: 0.8 }, mod: () => ({ color: '#b9f5c8' }),
        next: () => [
          X('splitting', 'Splitting Glaive', '🔸', 'Each glaive splits in two on its first hit.', { mod: () => ({ splitHit: true }), next: twinCaps }),
          X('heavy', 'Heavy Glaive', '🔨', '+30% damage, and hits stun normal foes for 0.4s.', { mult: { dmg: 1.3 }, mod: () => ({ stun: 0.4 }), next: twinCaps }),
        ],
      }),
    ];
  },
  // Explosive Shot (sticks in a foe, fuse 3s; every form hangs off that explosion)
  blast: () => {
    const clusterCaps = (): PathNode[] => [
      X('daisychain', 'Daisy Chain', '🎆', 'Bomblets split into 2 more bomblets.', { mod: () => ({ cluster2: true }) }),
      X('payload', 'Heavy Payload', '🏋️', '+50% damage and bigger blasts.', { mult: { dmg: 1.5, area: 1.25 } }),
    ];
    const demoCaps = (): PathNode[] => [
      X('demolition', 'Demolition', '🏚️', 'The blast finishes normal foes under 30% HP and hits bosses 50% harder.', { mod: () => ({ demolish: 0.3 }) }),
      X('shaped', 'Shaped Charge', '🎯', 'A longer fuse, and the whole payload goes into the stuck foe (x2).', { mod: () => ({ shaped: true }) }),
    ];
    const shardCaps = (): PathNode[] => [
      X('frag', 'Fragmentation', '💢', 'Every shard bursts where it hits.', { mod: () => ({ fragBlast: true }) }),
      X('seeking', 'Seeking Shards', '🧲', 'Shards curve toward foes, and +2 more of them.', { mod: (d) => ({ homeShards: true, shrapnel: (d.shrapnel ?? 0) + 2 }) }),
    ];
    return [
      X('cluster', 'Cluster Bomb', '🧨', 'The explosion throws 4 bomblets around that go off a moment later.', {
        color: '#ff9a3c', rename: 'Cluster Bomb', mod: () => ({ cluster: 4, color: '#ff9a3c' }),
        next: () => [
          X('carpet', 'Carpet Bomb', '🎇', '+3 bomblets.', { mod: (d) => ({ cluster: (d.cluster ?? 4) + 3 }), next: clusterCaps }),
          X('concussive', 'Concussive', '😵', 'The explosion knocks foes back and stuns them for 1s.', { mod: () => ({ stun: 1 }), next: clusterCaps }),
        ],
      }),
      X('sticky', 'Demolitions', '🧷', '+30% damage, and your other hits on the stuck foe add 15% of their damage to the bomb.', {
        color: '#ff6b4a', rename: 'Demolition Charge', mult: { dmg: 1.3 }, mod: () => ({ stickFeed: 0.15, color: '#ff6b4a' }),
        next: () => [
          X('overpacked', 'Overpacked', '📦', '+30% damage, and your hits feed the bomb more (40%).', { mult: { dmg: 1.3 }, mod: () => ({ stickFeed: 0.4 }), next: demoCaps }),
          X('chaindet', 'Chain Detonation', '🔗', 'When the bomb goes off, it plants another on the nearest foe.', { mod: () => ({ restick: true }), next: demoCaps }),
        ],
      }),
      X('shrapnel', 'Shrapnel Bomb', '✳️', 'The explosion throws 8 piercing shards outward.', {
        color: '#ffcf8a', rename: 'Shrapnel Bomb', mod: () => ({ shrapnel: 8, color: '#ffcf8a' }),
        next: () => [
          X('flechette', 'Flechettes', '🪡', '+4 shards and they pierce 2 more foes.', { mult: { pierce: 2 }, mod: (d) => ({ shrapnel: (d.shrapnel ?? 8) + 4 }), next: shardCaps }),
          X('barbedshrap', 'Barbed Shrapnel', '🪝', 'Shards and the blast make foes bleed.', { mod: () => ({ bleedHit: 0.5 }), next: shardCaps }),
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
    const barrageCaps = (): PathNode[] => [
      X('endlessvolley', 'Endless Volley', '♾️', '+2 more fans in every barrage.', { mod: (d) => ({ volleys: (d.volleys ?? 3) + 2 }) }),
      X('seekerarrows', 'Seeker Arrows', '🧭', 'Arrows curve toward foes.', { mod: () => ({ homing: true }) }),
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
      X('barrage', 'Barrage', '🏹', 'Fires 3 fans back to back, each a bit tighter (70% damage each).', {
        color: '#8fd3ff', rename: 'Barrage', mult: { dmg: 0.7 }, mod: (d) => ({ volleys: 3, spread: (d.spread ?? 0.22) * 0.8, color: '#8fd3ff' }),
        next: () => [
          X('reload', 'Quick Reload', '⏱️', '+40% attack speed.', { mult: { haste: 0.4 }, next: barrageCaps }),
          X('barbedvolley', 'Barbed Volley', '🪝', 'Every arrow makes foes bleed.', { mod: () => ({ bleedHit: 0.4 }), next: barrageCaps }),
        ],
      }),
      X('arrownova', 'Arrow Nova', '✴️', 'The fan becomes a full ring of arrows: +3 arrows, and it fires twice as often.', {
        color: '#b9f5c8', rename: 'Arrow Nova', mult: { count: 3, haste: 1 }, mod: () => ({ ring: true, color: '#b9f5c8' }),
        next: () => [
          X('spiral', 'Spiral', '🌀', 'A second ring follows, turned half a step.', { mod: () => ({ doubleTap: true }), next: novaCaps }),
          X('thornwall', 'Thorn Wall', '🧱', 'Arrows stop and hang in the air for 8s: a wide ring of thorns the horde has to cross. They hit 3x as hard and fire 30% faster.', { mult: { dmg: 3, haste: 0.3 }, mod: () => ({ hang: 8 }), next: novaCaps }),
        ],
      }),
    ];
  },
};

// ---------------------------------------------------------------- Hunter (test hero): Kelly's Rain of Fire tree (Temp Talents sheet)
// The only upgrades the Hunter gets: one pick per level. Tier 4 picks lead to exactly one tier 5 capstone.
// Effects live in run.ts (Run.hn(id)); nodes here only carry names, text and plain stat changes.
// Burn = weak stacking dot (max 5). Ablaze = strong single dot that can't be refreshed (until Ablazed).
const H = (id: string, name: string, icon: string, desc: string, rest: Partial<PathNode> = {}): PathNode => ({ id, name, icon, desc, ...rest });
const cap = (n: PathNode): (() => PathNode[]) => () => [n];
export const HUNTER_TREE = (): PathNode[] => [
  H('rainfire', 'Rain of Fire', '🔥', 'Fire damage. 10% increased damage.', {
    color: '#ff7b2e', rename: 'Rain of Fire', mult: { dmg: 1.1 }, mod: () => ({ fire: true, color: '#ff7b2e' }),
    next: () => [
      H('wildfire', 'Wild Fire', '🔥', '0 arrow damage. Mobs in the rain gain a stacking Burn (a stack every 0.5s, max 5).', {
        next: () => [
          H('flashpoint', 'Flash Point', '💥', 'Consumes 5 Burn stacks to explode: massive damage to that mob, 50% of it as AoE around.', {
            next: () => [
              H('delayedburn', 'Delayed Burn', '⏳', 'Burn lasts 3x as long. Each stack applied triggers a Flash Point scaled by the stack count. Still only consumes at 5 stacks.', {
                next: cap(H('repeatingburn', 'Repeating Burn', '🔁', 'When a Burn reaches 5 stacks it resets to 1 stack. The AoE is no longer reduced.')),
              }),
              H('livingbomb', 'Living Bomb', '💣', 'Instead of consuming, 5 stacks turn into a Living Bomb for 12s (no Burn stacks meanwhile). It triggers Flash Point every 3s, and the final explosion deals double damage.', {
                next: cap(H('unlimitedbomb', 'Unlimited Bomb', '♾️', 'Living Bomb explosions add 1 Burn stack to every mob hit. The final explosion adds 2.')),
              }),
            ],
          }),
          H('spreadash', 'Spreading Ash', '🌫️', 'Mobs dying with Burn spread 1 stack to a mob within 15 yards (one without a Burn), refreshing it.', {
            next: () => [
              H('creepingash', 'Creeping Ash', '🐌', 'A 5 stack Burn jumps to 1 target as 1 stack when it expires. A Burn about to expire below 5 stacks gains a stack and refreshes instead.', {
                next: cap(H('everlastingash', 'Everlasting Ash', '♾️', 'A 5 stack Burn no longer expires.')),
              }),
              H('jumpingash', 'Jumping Ash', '🦘', 'Ash jumps to 2 targets, and the range is 40 yards.', {
                next: cap(H('jumpingash2', 'Jumping Ash v2', '📈', 'Each jump increases the Burn damage by 2%.')),
              }),
            ],
          }),
        ],
      }),
      H('smolder', 'Smoldering Ground', '♨️', 'Rain of Fire lasts 1 second and leaves a pool of fire for 8s. Mobs who enter it are set Ablaze.', {
        mult: { duration: 1 / 3 },
        next: () => [
          H('spreadground', 'Spreading Ground', '🌋', 'Each mob inside adds 2s to the ground, up to 15s. Every 2s the ground grows 5%.', {
            next: () => [
              H('movingground', 'Moving Ground', '🏃', 'The ground lasts twice as long, and every 5s sends out a fire patch that chases the closest mob not Ablaze, setting it Ablaze on contact.', {
                next: cap(H('scorchedearth', 'Scorched Earth', '🔥', 'Sends 3 fire patches, and they chase twice as fast.')),
              }),
              H('lethalground', 'Lethal Ground', '☠️', 'No longer sets Ablaze. The ground deals damage instead, +5% for each second added to its duration.', {
                next: cap(H('everlastingground', 'Everlasting Ground', '♾️', 'Mobs that die on the ground feed it: +2s each. No cap.')),
              }),
            ],
          }),
          H('ember', 'Detonating Ember', '💥', 'When the ground expires it explodes, sending a shockwave 20 yards out that sets everything caught Ablaze.', {
            next: () => [
              H('ablazed', 'Ablazed', '🔥', 'Ablaze can now be refreshed: fire attacks against an Ablazed mob refresh it.', {
                next: cap(H('ablazedv2', 'Ablazed v2', '🔥', 'Ablaze damage +5% for each mob that is Ablaze. All fire damage applies Ablaze.')),
              }),
              H('swiftablaze', 'Swift Ablaze', '⏱️', 'Applying Ablaze reduces the cooldown of Rain of Fire by 1 second.', {
                next: cap(H('detonate', 'Ablazed (Detonate)', '💥', "Ablazed mobs explode when hit by your auto attack: 100% of the Ablaze's full damage to that mob and 50% as AoE.")),
              }),
            ],
          }),
        ],
      }),
      H('heatwave', 'Heat Wave', '🌡️', 'No more arrows: a gas/heat cloud for 10s. Mobs inside take 2x damage from normal attacks and 4x from fire.', {
        color: '#ffb066', mult: { duration: 10 / 3 }, mod: () => ({ color: '#ffb066' }),
        next: () => [
          H('vapor', 'Ignited Vapor', '🔥', 'Attacking a mob in the cloud makes the gas ignite, dealing fire damage to every mob inside (at most twice a second).', {
            next: () => [
              H('growinggas', 'Growing Gas', '🌫️', 'The cloud grows over time and lasts twice as long.', {
                mult: { duration: 2 },
                next: cap(H('overheating', 'Overheating Gas', '♨️', 'The cloud deals fire damage to every mob inside.')),
              }),
              H('lethalvapor', 'Lethal Vapor', '☠️', 'The cloud is twice as big. Mobs lingering inside for 7s are Poisoned for 10s (a dot).', {
                mult: { area: 2 },
                next: cap(H('poisonamp', 'Poison Amplification', '🧪', 'Poisoned mobs take double the Heat Wave effect (4x from attacks, 8x from fire).')),
              }),
            ],
          }),
          H('suffocate', 'Suffocation', '😵', 'Mobs inside are slowed 50%. After 3s inside they are stunned for 1.5s.', {
            next: () => [
              H('confused', 'Confused', '💫', 'After the stun ends, mobs (not bosses) become deranged and attack other mobs for 3s.', {
                next: cap(H('taunt', 'Ablazed v2 (Taunt)', '📣', 'If a deranged mob gets a kill, it taunts every mob within 15 yards and stays deranged until killed.')),
              }),
              H('dmgamp', 'Damage Amp', '🎯', 'After the stun ends, mobs take 4x damage from everything for 4s.', {
                next: cap(H('dmgamp2', 'Damage Amp x2', '🎯', "Mobs that can't be stunned (bosses) get a 10s debuff instead: 15x damage taken from all abilities.")),
              }),
            ],
          }),
        ],
      }),
    ],
  }),
];
/** The next options in a fixed tree, given the ids picked so far. */
export function treeNext(roots: PathNode[], chosen: string[]): PathNode[] {
  let opts = roots;
  for (const id of chosen) {
    const n = opts.find((o) => o.id === id);
    if (!n?.next) return [];
    opts = n.next();
  }
  return opts;
}

// ---------------------------------------------------------------- job forms (tier 1, needs that job)
/** Which base ability turns into which job ability. */
export const JOB_FORMS: Record<string, Record<string, string>> = {
  berserker: { cleave: 'warcleave', whirl: 'rend', quake: 'bloodnova', hatchet: 'reaver' },
  guardian: { cleave: 'holycleave', whirl: 'consecrate', quake: 'judgment', hatchet: 'shieldtoss' },
  ranger: { rain: 'thornrain', blast: 'wolves', fan: 'stampede' },
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
