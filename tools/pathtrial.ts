// Archer ability paths: plays a run per full path (form > follow-up > capstone) and reports that ability's damage.
// npx tsx tools/pathtrial.ts [ability] [minutes] [form] [seed]   (ability: rain | glaive | blast | fan; all = every ability)
import { Run } from '../src/run/run';
import { pathRoots } from '../src/run/paths';

const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : '';
const form = process.argv[4] ?? '';
const seed0 = Number(process.argv[5] ?? 777);
const mins = Number(process.argv[3] ?? 9);
const bases = only ? [only] : ['rain', 'glaive', 'blast', 'fan'];

for (const base of bases) {
  const combos: string[][] = [];
  for (const a of pathRoots(base, null)) if (!form || a.id === form) for (const b of a.next?.() ?? []) for (const c of b.next?.() ?? []) combos.push([a.id, b.id, c.id]);
  console.log(`== ${base} (${combos.length} paths)`);
  for (const want of combos) {
    let seed = seed0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const run = new Run('archer', 4242, rand);
    run.auto = true;
    const dt = 1 / 30;
    let late = 0;
    let lateT = 0;
    while (!run.ended && run.t < mins * 60) {
      run.iframes = 9;
      run.hp = run.stats.maxHp;
      const before = run.weapons.find((w) => w.base === base)?.total ?? 0;
      run.update(dt);
      let guard = 0;
      while (run.choices) {
        const ch = run.choices;
        if (++guard > 30) {
          console.log('stuck', run.choiceTitle, ch.map((c) => `${c.kind}:${c.id}`).join(' '));
          process.exit(1);
        }
        let k = -1;
        if (ch[0].kind === 'path') k = ch.findIndex((c) => want.includes(c.id));
        else k = ch.findIndex((c) => c.kind === 'weapon' && c.id === base);
        if (k >= 0) run.pick(k);
        else run.autoPick();
      }
      const w = run.weapons.find((x) => x.base === base);
      if (w && run.t > 300 && w.path.length >= 1) {
        late += w.total - before;
        lateT += dt;
      }
    }
    const w = run.weapons.find((x) => x.base === base)!;
    const all = run.weapons.reduce((a, x) => a + x.total, 0);
    console.log(`${want.join(' > ').padEnd(38)} got [${w.path.join('>')}] lv${w.level} dps(5m+) ${Math.round(late / Math.max(1, lateT))} share ${Math.round((w.total / all) * 100)}% kills ${run.kills} lv${run.level}`);
  }
}
