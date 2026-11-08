// Balance simulator: plays the game headlessly with a simple "buy cheapest useful
// upgrade" strategy and prints progress over time. Run with: npm run sim -- <hours> <warrior|archer|mage>
import { GROWTH, JobId } from '../src/data';
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
let lastChallenge = 0;

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
  // Spend gems
  if (game.state.gems >= 450) {
    if (rand() < 0.5) game.summonGear(10);
    else game.summonCompanions(10);
    game.enhanceAllGear();
    game.enhanceAllCompanions();
    game.equipAllBest();
    game.autoParty();
  }
  // Retry boss every 60s
  if (game.state.bossFailed && t - lastChallenge > 60) {
    lastChallenge = t;
    game.challengeBoss();
  }

  if (t >= nextReport) {
    nextReport += 600;
    const s = game.state;
    console.log(
      `${(t / 60).toFixed(0).padStart(4)}m  stage ${String(s.stage).padStart(3)} (max ${s.maxStage})  lv ${String(s.level).padStart(3)}  ` +
        `atkLv ${s.growth.atk} hpLv ${s.growth.hp}  ATK ${game.stats.atk.toExponential(2)}  HP ${game.stats.maxHp.toExponential(2)}  ` +
        `deaths ${s.totals.deaths}  summons ${s.totals.summons}`,
    );
  }
}
