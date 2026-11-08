import { BALANCE, GrowthKey, JobId, Slot } from './data';

export interface Owned {
  count: number;
  level: number;
}

export interface GameState {
  version: number;
  lastSaved: number;
  name: string;
  job: JobId;
  level: number;
  exp: number;
  gold: number;
  gems: number;
  growth: Record<GrowthKey, number>;
  stage: number;
  maxStage: number; // highest stage reached
  kills: number; // kills on the current stage toward the boss
  bossFailed: boolean; // farming mode until the player challenges again
  gear: Record<string, Owned>;
  equipped: Record<Slot, string | null>;
  companions: Record<string, Owned>;
  party: (string | null)[];
  totals: { kills: number; bosses: number; summons: number; deaths: number };
  settings: { auto: boolean; testMode: boolean };
  /** Where the hero stands (world units); null = zone 1 entrance. */
  pos: { x: number; y: number } | null;
  /** How many zone bosses have been beaten in order (0 = none yet). */
  bossesCleared: number;
  bossKills: number[];
  /** Item bag (boss offerings etc.). Empty until the item system arrives. */
  items: Record<string, number>;
}

export const SAVE_VERSION = 1;

export function newState(name = 'Hero', job: JobId = 'warrior'): GameState {
  return {
    version: SAVE_VERSION,
    lastSaved: Date.now(),
    name,
    job,
    level: 1,
    exp: 0,
    gold: 0,
    gems: BALANCE.startingGems,
    growth: { atk: 0, hp: 0, critRate: 0, critDmg: 0 },
    stage: 1,
    maxStage: 1,
    kills: 0,
    bossFailed: false,
    gear: {},
    equipped: { weapon: null, armor: null, accessory: null },
    companions: {},
    party: Array(BALANCE.partySize).fill(null),
    totals: { kills: 0, bosses: 0, summons: 0, deaths: 0 },
    settings: { auto: true, testMode: false },
    pos: null,
    bossesCleared: 0,
    bossKills: [],
    items: {},
  };
}

/** Fills in any fields missing from older saves so new features never break old players. */
export function migrate(raw: unknown): GameState {
  const base = newState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<GameState>;
  const s: GameState = {
    ...base,
    ...r,
    growth: { ...base.growth, ...(r.growth ?? {}) },
    equipped: { ...base.equipped, ...(r.equipped ?? {}) },
    totals: { ...base.totals, ...(r.totals ?? {}) },
    settings: { ...base.settings, ...(r.settings ?? {}) },
    bossKills: Array.isArray(r.bossKills) ? r.bossKills : [],
    items: r.items && typeof r.items === 'object' ? r.items : {},
    gear: r.gear ?? {},
    companions: r.companions ?? {},
    party: base.party.map((_, i) => r.party?.[i] ?? null),
    version: SAVE_VERSION,
  };
  return s;
}
