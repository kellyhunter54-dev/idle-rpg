import {
  BALANCE, GROWTH, Slot, companionOwnedAtk, gearEffect, jobOf, levelBaseAtk, levelBaseHp, parseGear,
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
  const atk = (levelBaseAtk(state.level) + growthValue(state, 'atk')) * (1 + atkPct) * job.atkMult;
  const maxHp = (levelBaseHp(state.level) + growthValue(state, 'hp')) * (1 + hpPct) * job.hpMult;
  const critRate = Math.min(1, growthValue(state, 'critRate') + job.critBonus);
  const critDmg = BALANCE.baseCritDmg + growthValue(state, 'critDmg') + bonus.accessory;
  const power = atk * (1 + critRate * (critDmg - 1)) * 10 + maxHp;

  return { atk, maxHp, critRate, critDmg, atkPct, hpPct, power };
}
