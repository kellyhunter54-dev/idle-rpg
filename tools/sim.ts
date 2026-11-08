// Balance simulator: plays the game headlessly. AUTO fights; this script plays the "human"
// part: spends gold, summons, moves to the next zone when leveled enough and fights bosses.
// Run with: npm run sim -- <hours> <warrior|archer|mage>
import { GROWTH, JobId, ZONES } from '../src/data';
import { Game } from '../src/game';
import { newState } from '../src/state';

let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const job = (process.argv[3] ?? 'warrior') as JobId;
const game = new Game(newState('Sim', job), rand);
console.log(`Simulating a ${job}`);
game.summonGear(10);
game.summonCompanions(10);

const dt = 0.05;
const hours = Number(process.argv[2] ?? 3);
let t = 0;
let nextReport = 0;
let nextDecision = 0;
const milestones: string[] = [];
let lastCleared = 0;

while (t < hours * 3600) {
  game.update(dt);
  t += dt;

  // Spend gold: alternate between ATK and HP, sprinkle crit
  for (let i = 0; i < 20; i++) {
    const options = GROWTH.map((g) => ({ key: g.key, cost: game.state.growth[g.key] >= g.max ? Infinity : game.growthCost(g.key) }));
    const atk = options.find((o) => o.key === 'atk')!;
    const hp = options.find((o) => o.key === 'hp')!;
    const pick = game.state.growth.hp < game.state.growth.atk * 0.7 ? hp : atk;
    const crit = options.find((o) => o.key === 'critRate')!;
    const cdmg = options.find((o) => o.key === 'critDmg')!;
    const choice = [pick, crit, cdmg].sort((a, b) => a.cost - b.cost)[0];
    if (!game.buyGrowth(choice.key)) break;
  }
  if (game.state.gems >= 450) {
    if (rand() < 0.5) game.summonGear(10);
    else game.summonCompanions(10);
    game.enhanceAllGear();
    game.enhanceAllCompanions();
    game.equipAllBest();
    game.autoParty();
  }

  // Decisions a player would make every 30s
  if (t >= nextDecision && !game.inBossFight && !game.travelGoal && game.inLair < 0 && game.deadTimer <= 0) {
    nextDecision = t + 30;
    const lvl = game.state.level;
    const cleared = game.state.bossesCleared;
    if (cleared < ZONES.length && lvl >= ZONES[cleared].bossLevel - 1 && game.zone === cleared && game.bossStatus(cleared) === 'ready') {
      game.goToBoss(cleared);
    } else {
      let want = 0;
      for (let z = 0; z < ZONES.length; z++) if (lvl >= ZONES[z].minLevel && z <= cleared) want = z;
      if (want !== game.zone) game.travelToZone(want);
    }
  }
  if (game.state.bossesCleared > lastCleared) {
    lastCleared = game.state.bossesCleared;
    milestones.push(`${(t / 60).toFixed(0)}m: beat ${ZONES[lastCleared - 1].name} boss at Lv ${game.state.level}`);
  }

  if (t >= nextReport) {
    nextReport += 900;
    const s = game.state;
    console.log(
      `${(t / 60).toFixed(0).padStart(4)}m  zone ${game.zone} lv ${String(s.level).padStart(3)}  exp/h ${Math.round(game.expPerHour()).toExponential(1)}  ` +
        `atkLv ${s.growth.atk} hpLv ${s.growth.hp}  bosses ${s.bossesCleared}  deaths ${s.totals.deaths}  kills ${s.totals.kills}`,
    );
  }
}
for (const m of milestones) console.log('  ' + m);
