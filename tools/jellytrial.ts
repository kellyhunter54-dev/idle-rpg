// King Jelly trial: AUTO plays a run until the given level, then walks into the lair.
// npx tsx tools/jellytrial.ts [job] [level] [runs] [god]
import { JobId } from '../src/data';
import { Run } from '../src/run/run';

const job = (process.argv[2] ?? 'archer') as JobId;
const enterAt = Number(process.argv[3] ?? 14);
const runs = Number(process.argv[4] ?? 4);
const god = process.argv[5] === 'god';
const p3 = process.argv.includes('p3');
let seed = 777;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let r = 0; r < runs; r++) {
  const run = new Run(job, 500 + r, rand);
  run.auto = true;
  const dt = 1 / 30;
  // level up in the world first (no lair yet)
  while (!run.ended && run.level < enterAt && run.t < 900) {
    run.lairCleared = true;
    run.update(dt);
    while (run.choices) run.autoPick();
  }
  run.lairCleared = false;
  run.hp = run.stats.maxHp;
  run.enterLair();
  let t = 0;
  let maxPhase = 0;
  const j = run.jelly!;
  if (p3) j.damage(j.pool.maxHp * 0.51);
  let p3t = 0;
  let goo = 0;
  let tele = 0;
  let samples = 0;
  while (!run.ended && run.inLair && !j.done && t < 400) {
    if (god) {
      run.hp = run.stats.maxHp;
      j.slimed = 0;
    }
    run.update(dt);
    while (run.choices) run.autoPick();
    t += dt;
    maxPhase = Math.max(maxPhase, j.phase);
    if (j.phase === 2) {
      p3t += dt;
      goo += j.goo.length;
      tele += run.telegraphs.length;
      samples++;
    }
  }
  console.log(`run ${r} [${run.title} lv${run.level}]: ${j?.done ? 'WIN' : run.ended ? 'dead' : 'timeout'} after ${Math.round(t)}s, phase ${maxPhase + 1}, pool ${j ? Math.round((Math.max(0, j.pool.hp) / j.pool.maxHp) * 100) : 0}% of ${j ? Math.round(j.pool.maxHp) : 0}, slimed ${j?.slimed ?? '-'} | phase3 alive ${Math.round(p3t)}s, avg goo ${Math.round(goo / (samples || 1))}, avg circles ${Math.round(tele / (samples || 1))} taken s${Math.round(run.taken.slam)}`);
}
