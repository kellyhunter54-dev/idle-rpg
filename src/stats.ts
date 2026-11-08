import {
  BALANCE, GROWTH, MANA, Slot, TALENT_NODE, TALENT_STATS, TALENT_TREES, TalentStat, companionOwnedAtk, gearEffect, jobOf,
  levelBaseAtk, levelBaseHp, parseGear, talentPointsForLevel,
} from './data';
import { GameState } from './state';

export interface Stats {
  atk: number;
  maxHp: number;
  critRate: number;
  critDmg: number; // multiplier, e.g. 1.5
  atkPct: number;
  hpPct: number;
  power: number; // single "combat power" number for display
  atkSpeed: number; // multiplier on attack rate (1 = normal)
  offhandChance: number;
  offhandRatio: number;
  cdr: number; // skill cooldown reduction (0..0.5)
  maxMana: number; // 0 for jobs without mana
  manaRegen: number; // per second
  /** Every talent number, summed (rank x per-rank value). */
  t: TalentStats;
}

export type TalentStats = Record<TalentStat, number>;

/** Sums the allocated talents of the character's own job tree. */
export function talentStats(state: GameState): TalentStats {
  // every stat starts at 0, even ones no current talent uses (so maths never sees undefined)
  const t = Object.fromEntries(TALENT_STATS.map((k) => [k, 0])) as TalentStats;
  const tree = TALENT_TREES[jobOf(state).id];
  for (const n of tree.nodes) {
    const rank = Math.min(n.maxRank, state.talents[n.id] ?? 0);
    if (rank <= 0) continue;
    for (const [k, v] of Object.entries(n.perRank) as [TalentStat, number][]) t[k] += v * rank;
  }
  return t;
}

export function talentsSpent(state: GameState): number {
  const tree = TALENT_TREES[jobOf(state).id];
  return tree.nodes.reduce((a, n) => a + Math.min(n.maxRank, state.talents[n.id] ?? 0), 0);
}

export function talentsAvailable(state: GameState): number {
  return talentPointsForLevel(state.level) - talentsSpent(state);
}

/** Can this node take another point? Returns a reason if not. */
export function talentBlocked(state: GameState, id: string): string | null {
  const n = TALENT_NODE[id];
  if (!n || !TALENT_TREES[jobOf(state).id].nodes.includes(n)) return 'Not in your tree.';
  if ((state.talents[id] ?? 0) >= n.maxRank) return 'Already at max rank.';
  if (talentsAvailable(state) <= 0) return 'No talent points left. You earn one each level.';
  const spent = talentsSpent(state);
  if (spent < n.reqPoints) return `Spend ${n.reqPoints - spent} more point${n.reqPoints - spent === 1 ? '' : 's'} in this tree to unlock.`;
  return null;
}

function growthValue(state: GameState, key: string): number {
  const def = GROWTH.find((g) => g.key === key)!;
  return def.value(state.growth[def.key]);
}

export function computeStats(state: GameState): Stats {
  const bonus: Record<Slot, number> = { weapon: 0, armor: 0, accessory: 0 };

  // Owned effects: every gear piece you own gives a fraction of its bonus.
  for (const [id, o] of Object.entries(state.gear)) {
    if (o.count <= 0) continue;
    bonus[parseGear(id).slot] += gearEffect(id, o.level) * BALANCE.ownedEffectRatio;
  }
  // Equipped effects
  for (const slot of Object.keys(state.equipped) as Slot[]) {
    const id = state.equipped[slot];
    const o = id ? state.gear[id] : undefined;
    if (id && o) bonus[slot] += gearEffect(id, o.level);
  }

  let compAtk = 0;
  for (const [id, o] of Object.entries(state.companions)) {
    if (o.count > 0) compAtk += companionOwnedAtk(id, o.level);
  }

  const atkPct = bonus.weapon + compAtk;
  const hpPct = bonus.armor;
  const job = jobOf(state);
  const t = talentStats(state);
  // level sets the base; Growth upgrades and gear multiply it
  const atk = levelBaseAtk(state.level) * (1 + growthValue(state, 'atk')) * (1 + atkPct) * job.atkMult * (1 + t.atkPct);
  const maxHp = levelBaseHp(state.level) * (1 + growthValue(state, 'hp')) * (1 + hpPct) * job.hpMult;
  const critRate = Math.min(1, growthValue(state, 'critRate') + job.critBonus + t.critRate);
  const critDmg = BALANCE.baseCritDmg + growthValue(state, 'critDmg') + bonus.accessory + t.critDmg;
  const power = atk * (1 + critRate * (critDmg - 1)) * 10 + maxHp;

  const hasMana = job.id === 'mage';
  return {
    atk, maxHp, critRate, critDmg, atkPct, hpPct, power,
    atkSpeed: 1 + t.atkSpeed,
    offhandChance: t.offhandChance,
    offhandRatio: 0.5 + t.offhandRatio,
    cdr: Math.min(0.5, t.cdr),
    maxMana: hasMana ? MANA.base : 0,
    manaRegen: hasMana ? MANA.regen * (1 + t.manaRegen) : 0,
    t,
  };
}
