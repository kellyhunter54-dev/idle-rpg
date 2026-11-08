// Boss difficulty harness. Levels a character with the normal sim policy, snapshots it at
// a few levels around each boss, then fights the boss many times with AUTO-like and
// skilled reaction times. Run with: npx tsx tools/bosstrial.ts <job> [zone]
import { JobId, ZONES } from '../src/data';
import { Game } from '../src/game';
import { GameState, migrate, newState } from '../src/state';

let seed = 7;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const job = (process.argv[2] ?? 'warrior') as JobId;
const onlyZone = process.argv[3] !== undefined ? Number(process.argv[3]) : -1;

function spend(game: Game) {
  game.autoAssignTalents();
  for (let i = 0; i < 30; i++) {
    const pick = game.state.growth.hp < game.state.growth.atk * 0.7 ? 'hp' : 'atk';
    const crit = game.state.growth.critRate >= 250 ? 'critDmg' : 'critRate';
    const opts = [pick, crit, 'critDmg'] as const;
    const best = [...opts].sort((a, b) => game.growthCost(a) - game.growthCost(b))[0];
    if (!game.buyGrowth(best)) break;
  }
  if (game.state.gems >= 450) {
    if (rand() < 0.5) game.summonGear(10);
    else game.summonCompanions(10);
    game.enhanceAllGear();
    game.enhanceAllCompanions();
    game.equipAllBest();
    game.autoParty();
  }
}

// 1. progress and snapshot
const snaps = new Map<number, GameState>();
const want = new Set<number>();
ZONES.forEach((z, i) => {
  if (onlyZone < 0 || onlyZone === i) for (const d of [0, 3, 6]) want.add(z.bossLevel + d);
});
const g = new Game(newState('T', job), rand);
g.summonGear(10);
g.summonCompanions(10);
let t = 0;
let lastDecision = 0;
const levelAt: Record<number, number> = {};
while (t < 60 * 3600 && snaps.size < want.size) {
  g.update(0.05);
  t += 0.05;
  spend(g);
  if (t - lastDecision > 30 && g.inLair < 0 && !g.travelGoal) {
    lastDecision = t;
    let z = 0;
    for (let i = 0; i < ZONES.length; i++) if (g.state.level >= ZONES[i].minLevel) z = i;
    if (z !== g.zone) g.travelToZone(z);
  }
  if (want.has(g.state.level) && !snaps.has(g.state.level)) {
    snaps.set(g.state.level, JSON.parse(JSON.stringify(g.state)));
    levelAt[g.state.level] = t;
  }
}
console.log(`${job}: reached levels`, Object.entries(levelAt).map(([l, tt]) => `Lv${l}@${(tt / 3600).toFixed(1)}h`).join(' '));

// 2. fight
function fight(state: GameState, zone: number, skilled: boolean): { win: boolean; secs: number; flasks: number } {
  const s = migrate(JSON.parse(JSON.stringify(state)));
  s.bossesCleared = Math.max(s.bossesCleared, zone);
  const game = new Game(s, rand);
  if (skilled) {
    game.aiReaction = 0.2;
    game.aiJitter = 0.1;
    game.aiMiss = 0;
  }
  (game as unknown as { enterLair(z: number): void }).enterLair(zone);
  game.goToBoss(zone);
  const kills0 = s.bossKills[zone] ?? 0;
  const deaths0 = s.totals.deaths;
  let tt = 0;
  while (tt < 600) {
    game.update(0.05);
    tt += 0.05;
    if ((s.bossKills[zone] ?? 0) > kills0) return { win: true, secs: tt, flasks: 3 - game.flasks };
    if (s.totals.deaths > deaths0) return { win: false, secs: tt, flasks: 3 };
  }
  return { win: false, secs: tt, flasks: 3 };
}

for (let z = 0; z < ZONES.length; z++) {
  if (onlyZone >= 0 && z !== onlyZone) continue;
  for (const d of [0, 3, 6]) {
    const lvl = ZONES[z].bossLevel + d;
    const snap = snaps.get(lvl);
    if (!snap) continue;
    for (const [label, sk] of [['AUTO', false], ['skilled', true]] as const) {
      const res = Array.from({ length: 8 }, () => fight(snap, z, sk));
      const wins = res.filter((x) => x.win);
      const avg = wins.length ? wins.reduce((a, b) => a + b.secs, 0) / wins.length : 0;
      console.log(`  ${ZONES[z].name.padEnd(14)} boss Lv${ZONES[z].bossLevel} vs Lv${lvl} ${label.padEnd(7)}: ${wins.length}/8 wins${wins.length ? `, ~${Math.round(avg)}s` : ''}`);
    }
  }
}
