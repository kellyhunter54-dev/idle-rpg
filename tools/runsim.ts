// Headless run-mode balance check: AUTO steering plays full runs.
// npx tsx tools/runsim.ts [job] [runs]
import { JobId } from '../src/data';
import { Run } from '../src/run/run';

const job = (process.argv[2] ?? 'warrior') as JobId;
const runs = Number(process.argv[3] ?? 5);
let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let r = 0; r < runs; r++) {
  const run = new Run(job, 1000 + r, rand);
  run.auto = true;
  const dt = 1 / 30;
  let lastLog = 0;
  let lastDmg = 0;
  let bossT = 0;
  const t0 = Date.now();
  while (!run.ended && run.t < 780) {
    run.update(dt);
    while (run.choices) run.autoPick();
    if (run.boss && !run.boss.dead) bossT += dt;
    if (run.t - lastLog >= 60) {
      lastLog = run.t;
      const tot = run.weapons.reduce((a, w) => a + w.total, 0);
      const dps = Math.round((tot - lastDmg) / 60);
      lastDmg = tot;
      console.log(`  ${Math.round(run.t / 60)}m dps ${dps} lv${run.level} hp ${Math.round(run.hp)}/${run.stats.maxHp} kills ${run.kills} enemies ${run.enemies.length} gold ${Math.round(run.gold)} items ${run.items.length} w[${run.weapons.map((w) => w.def.id + w.level).join(',')}] t[${run.tomes.map((t) => t.id + t.level).join(',')}]`);
    }
  }
  const dmg = run.weapons.map((w) => `${w.def.id} ${Math.round(w.total / 1000)}k`).join(', ');
  console.log(`run ${r}: ${run.ended || 'timeout'} at ${Math.floor(run.t / 60)}:${String(Math.floor(run.t % 60)).padStart(2, '0')} lv${run.level} kills ${run.kills} bossTime ${Math.round(bossT)}s boss ${run.boss ? Math.round((run.boss.hp / run.boss.maxHp) * 100) + '%' : '-'} | taken c${Math.round(run.taken.contact)} s${Math.round(run.taken.shot)} b${Math.round(run.taken.slam)} | ${dmg} | ${(Date.now() - t0) / 1000}s`);
}
