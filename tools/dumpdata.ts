// Dumps every Gloomtide content table to JSON (sheet name -> rows) for the design spreadsheet.
// npx tsx tools/dumpdata.ts > out.json
import {
  RUN, RUN_RARITIES, WSTAT_NAME, WSTAT_STEP, WEAPONS, WEAPON, PASSIVES, ADVANCE_LEVELS, ABILITY_LEVELS, PATH_PLAYER, PATH_ABILITY,
  CORE_RATE, CORE_MAX, CLASS_CORE, BRANCHES, TALENT_LEVELS, CLASS_TALENTS, BRANCH_TALENTS, ITEMS, HEROES, ENEMIES, ELITE,
  enemyHpScale, spawnRate, MINI_BOSS, FINAL_BOSS, xpToNext, SHRINE_BOONS, SHRINE_TIME, STAT_LABEL, PCT_STATS,
  type PassiveDef, type WeaponDef, type PStat, type CoreDef,
} from '../src/run/data';
import { pathRoots, JOB_FORMS, type PathNode } from '../src/run/paths';
import { JELLY } from '../src/run/jelly';

type Row = Record<string, string | number | boolean | null>;
const out: Record<string, Row[]> = {};
const JOBS = ['warrior', 'archer', 'mage'] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const statText = (stats?: Partial<Record<PStat, number>>) =>
  stats ? Object.entries(stats).map(([k, v]) => `${STAT_LABEL[k as PStat]} ${v! >= 0 ? '+' : ''}${PCT_STATS.has(k as PStat) ? pct(v!) : v}`).join(', ') : '';
const passiveText = (p: PassiveDef, n = 1) => {
  const parts: string[] = [];
  if (p.desc) return p.desc;
  if (p.stats) parts.push(statText(Object.fromEntries(Object.entries(p.stats).map(([k, v]) => [k, v! * n]))));
  if (p.special && p.text) parts.push(p.text((p.step ?? 0) * n));
  return parts.join('; ');
};

// ---- Overview / rules
const ov: Row[] = [];
const rule = (area: string, item: string, value: string | number, notes = '') => ov.push({ Area: area, Item: item, Value: value, Notes: notes });
rule('Run', 'Run length', `${RUN.length / 60} min`, 'Final boss when the clock hits 0; killing it wins');
rule('Run', 'King Jelly lair', 'Any time', 'Door on the map from the start; E to enter; run clock pauses inside');
rule('Run', 'EXP', RUN.xpOnKill ? 'On kill' : 'Gems', 'RUN.xpOnKill');
rule('Run', 'Rerolls per run', RUN.rerolls);
rule('Run', 'Chests on map', RUN.chests, `Gold chest cost ${RUN.chestCost}, x${RUN.chestCostGrowth} each open; elite/boss chests free`);
rule('Run', 'Shrines', RUN.shrines, `Stand inside ${SHRINE_TIME}s for a boon pick`);
rule('Run', 'Overtime', `+${pct(RUN.overtimeHp)} enemy HP per second`, 'If the final boss is still alive');
rule('Run', 'Jump', `${RUN.jumpTime}s, ${RUN.jumpRest}s rest`, 'Space jumps over bodies (not shots or slams)');
rule('Run', 'Max enemies', RUN.maxEnemies);
rule('Run', 'Spawn distance', `${RUN.spawnMin}-${RUN.spawnMax}`);
rule('Progression', 'Auto attack', 'Lv 1', 'Weapon slot 0');
rule('Progression', 'Base abilities unlock', ABILITY_LEVELS.map((l) => `Lv ${l}`).join(', '), 'Slots 1-4, automatic');
rule('Progression', 'Job advancement', ADVANCE_LEVELS.map((l) => `Lv ${l}`).join(', '), 'Lv 10 picks a branch; later tiers swap the auto attack and add passives');
rule('Progression', 'Talent choices', TALENT_LEVELS.map((l) => `Lv ${l}`).join(', '), 'Pick 1 of 2; Lv 40 pair are keystones');
rule('Progression', 'Ability path tiers', PATH_PLAYER.map((l, i) => `Tier ${i + 1}: you Lv ${l} + ability Lv ${PATH_ABILITY[i]}`).join('; '));
rule('Progression', 'Choice order', 'Unlocks > advancement > talent > path > level-up');
rule('Progression', 'Level-up cards', 3, 'Rolled rarity (luck shifts it); upgrade owned abilities or take passives');
for (let l = 1; l <= 60; l += l < 10 ? 1 : 5) rule('EXP curve', `Lv ${l} > ${l + 1}`, xpToNext(l));
rule('Ultimate', 'Resource max', CORE_MAX);
rule('Ultimate', 'Fill cap', `${CORE_RATE} per second`, 'From hits and kills');
for (const r of RUN_RARITIES) rule('Rarity', r.name, `x${r.mult}`, `Weight ${r.weight}`);
for (const [k, v] of Object.entries(WSTAT_STEP)) rule('Ability upgrade step (common)', WSTAT_NAME[k as keyof typeof WSTAT_NAME], k === 'count' || k === 'pierce' ? `+${v}` : `+${pct(v)}`, 'Scaled by rarity; count/pierce flat');
for (const m of [0, 2, 4, 6, 8, 10]) rule('Scaling', `Minute ${m}`, `Enemy HP x${enemyHpScale(m * 60).toFixed(2)}`, `${spawnRate(m * 60).toFixed(1)} spawns/s`);
out['Rules'] = ov;

// ---- Heroes
out['Classes'] = JOBS.map((j) => {
  const h = HEROES[j];
  const c = CLASS_CORE[j];
  return {
    Class: h.name, HP: h.hp, 'Move speed': h.speed, 'Auto attack': WEAPON[h.basic].name,
    'Ability Lv 2': WEAPON[h.abilities[0]].name, 'Ability Lv 4': WEAPON[h.abilities[1]].name, 'Ability Lv 6': WEAPON[h.abilities[2]].name, 'Ability Lv 10': WEAPON[h.abilities[3]].name,
    'Class passive': h.passive, Resource: c.resource, Ultimate: c.name,
    'Branch A': BRANCHES[j][0].name, 'Branch B': BRANCHES[j][1].name,
  };
});

// ---- Abilities (who uses each)
const usedBy: Record<string, string[]> = {};
const use = (id: string, how: string) => (usedBy[id] ??= []).push(how);
for (const j of JOBS) {
  use(HEROES[j].basic, `${cap(j)} auto attack`);
  HEROES[j].abilities.forEach((a, i) => use(a, `${cap(j)} base (Lv ${ABILITY_LEVELS[i]})`));
  for (const b of BRANCHES[j]) {
    b.tiers.forEach((t, i) => t.swaps.forEach(([o, n]) => use(n, `${b.name} T${i + 1} (${t.title}) replaces ${WEAPON[o]?.name ?? o}`)));
    for (const [base, form] of Object.entries(JOB_FORMS[b.id] ?? {})) use(form, `${b.name} job form of ${WEAPON[base]?.name ?? base}`);
  }
}
const flags = (w: WeaponDef) =>
  (['fire', 'shock', 'slow', 'shot', 'follow'] as const).filter((f) => w[f]).concat(
    (['burn', 'leech', 'spread', 'freeze', 'chain', 'blast', 'crit'] as const).filter((f) => w[f]).map((f) => `${f} ${w[f]}` as never),
  ).join(', ');
out['Abilities'] = WEAPONS.map((w) => ({
  Ability: w.name, Id: w.id, 'Used by': (usedBy[w.id] ?? ['(unused)']).join('; '), Kind: w.kind, Damage: w.dmg, 'Cooldown s': w.cd, Count: w.count,
  Size: w.area, Pierce: w.pierce, Speed: w.speed, 'Duration s': w.duration, 'DPS est (1 target)': Math.round((w.dmg * w.count) / w.cd * 10) / 10,
  'Upgrades roll': w.ups.map((u) => WSTAT_NAME[u]).join(', '), Tags: flags(w), Description: w.desc,
}));

// ---- Passives
const pRows: Row[] = [];
for (const j of JOBS) for (const p of PASSIVES[j]) pRows.push({ Class: cap(j), Source: 'Class pool', Passive: p.name, 'Max picks': p.max, 'Per pick (common)': passiveText(p, 1), 'At max (common)': passiveText(p, p.max), Id: p.id });
for (const j of JOBS)
  for (const b of BRANCHES[j])
    b.tiers.forEach((t, i) => {
      for (const p of t.passives) pRows.push({ Class: cap(j), Source: `${b.name} T${i + 1} (Lv ${ADVANCE_LEVELS[i]})`, Passive: p.name, 'Max picks': p.max, 'Per pick (common)': passiveText(p, 1), 'At max (common)': passiveText(p, p.max), Id: p.id });
    });
out['Passives'] = pRows;

// ---- Job advancement
const advRows: Row[] = [];
for (const j of JOBS)
  for (const b of BRANCHES[j])
    b.tiers.forEach((t, i) =>
      advRows.push({
        Class: cap(j), Branch: b.name, Tier: i + 1, Level: ADVANCE_LEVELS[i], Title: t.title,
        'Ability swaps': t.swaps.map(([o, n]) => `${WEAPON[o]?.name ?? o} > ${WEAPON[n]?.name ?? n}`).join('; ') || '(none)',
        'Passives added': t.passives.map((p) => p.name).join(', '), 'Branch theme': i === 0 ? b.desc : '', Ultimate: i === 0 ? b.core.name : '',
      }),
    );
out['Job Advancement'] = advRows;

// ---- Ultimates
const coreRow = (who: string, c: CoreDef): Row => ({
  'Class / Branch': who, Ultimate: c.name, Resource: c.resource, 'Duration s': c.dur, Effect: c.desc, 'Builds from': c.gain.tag,
  'Per hit': c.gain.hit, 'Per crit': c.gain.crit ?? '', 'Per kill': c.gain.kill ?? '', 'When hurt': c.gain.hurt ?? '', 'Regen /s': c.gain.regen ?? '',
});
out['Ultimates'] = [...JOBS.map((j) => coreRow(`${cap(j)} (Lv 1-9)`, CLASS_CORE[j])), ...JOBS.flatMap((j) => BRANCHES[j].map((b) => coreRow(`${b.name} (Lv 10+)`, b.core)))];

// ---- Talents
const tRows: Row[] = [];
for (const j of JOBS) {
  const [a, b] = CLASS_TALENTS[j];
  tRows.push({ Class: cap(j), Branch: '(any)', Level: TALENT_LEVELS[0], 'Option A': a.name, 'A does': a.desc ?? '', 'Option B': b.name, 'B does': b.desc ?? '' });
  for (const br of BRANCHES[j])
    (BRANCH_TALENTS[br.id] ?? []).forEach(([x, y], i) =>
      tRows.push({ Class: cap(j), Branch: br.name, Level: TALENT_LEVELS[i + 1], 'Option A': x.name, 'A does': x.desc ?? '', 'Option B': y.name, 'B does': y.desc ?? '' }),
    );
}
out['Talents'] = tRows;

// ---- Ability paths (full trees)
const effects = (n: PathNode, base: WeaponDef) => {
  const parts: string[] = [];
  if (n.becomes) parts.push(`becomes ${WEAPON[n.becomes]?.name ?? n.becomes}`);
  if (n.mult)
    for (const [k, v] of Object.entries(n.mult)) parts.push(k === 'count' || k === 'pierce' ? `${k} +${v}` : k === 'haste' ? `attack speed +${pct(v!)}` : `${k} x${v}`);
  if (n.mod) {
    const m = n.mod(base);
    for (const [k, v] of Object.entries(m)) if (k !== 'color') parts.push(`${k}: ${typeof v === 'number' ? Math.round(v * 1000) / 1000 : v}`);
  }
  return parts.join(', ');
};
const pathRows: Row[] = [];
const walk = (cls: string, owner: string, base: string, nodes: PathNode[], tier: number, parent: string, seen: Set<string>) => {
  for (const n of nodes) {
    const key = `${tier}|${parent}|${n.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pathRows.push({ Class: cls, 'Available to': owner, Ability: WEAPON[base].name, Tier: tier, 'Comes after': parent || '(start)', Choice: n.name, 'What it does': n.desc, Effects: effects(n, WEAPON[base]), Id: n.id });
    if (n.next && tier < 3) walk(cls, owner, base, n.next(), tier + 1, n.name, seen);
  }
};
for (const j of JOBS)
  for (const base of HEROES[j].abilities) {
    const seen = new Set<string>();
    walk(cap(j), 'Any branch', base, pathRoots(base, null), 1, '', seen);
    for (const b of BRANCHES[j]) {
      const roots = pathRoots(base, b).filter((n) => !pathRoots(base, null).some((x) => x.id === n.id));
      walk(cap(j), `${b.name} only`, base, roots, 1, '', seen);
    }
  }
out['Ability Paths'] = pathRows;

// ---- Items, enemies, bosses, shrines
out['Items'] = ITEMS.map((i) => ({ Item: i.name, Rarity: cap(i.rarity), Effect: i.desc, Stats: statText(i.stats), Special: i.proc ?? '', Source: i.bossOnly ? 'King Jelly only' : 'Chests' }));
out['Enemies'] = [
  ...ENEMIES.map((e) => ({ Enemy: e.id, Type: e.ranged ? 'Ranged' : 'Melee', HP: e.hp, Damage: e.dmg, Speed: e.speed, Size: e.r, EXP: e.xp, 'From minute': e.from, 'Spawn weight': e.weight, Notes: '' })),
  { Enemy: 'Elite (any)', Type: 'Elite', HP: `x${ELITE.hpMult}`, Damage: `x${ELITE.dmgMult}`, Speed: '', Size: `x${ELITE.rMult}`, EXP: `x${ELITE.xpMult}`, 'From minute': '', 'Spawn weight': `every ${ELITE.every}s`, Notes: 'Drops a free chest' },
  { Enemy: FINAL_BOSS.name, Type: 'Final boss', HP: FINAL_BOSS.hp, Damage: FINAL_BOSS.dmg, Speed: FINAL_BOSS.speed, Size: FINAL_BOSS.r, EXP: '', 'From minute': RUN.length / 60, 'Spawn weight': '', Notes: 'Killing it wins the run' },
  { Enemy: 'King Jelly', Type: 'Lair boss', HP: `${JELLY.hpBase} x ${JELLY.hpGrowth}^level`, Damage: '% of max HP', Speed: '', Size: '', EXP: '2 levels', 'From minute': 'any', 'Spawn weight': '', Notes: 'Splits at 80%/50%; Slimed 10 = death; drops Royal Jelly + 3 chests' },
  { Enemy: MINI_BOSS.name, Type: 'Old mini boss (off)', HP: MINI_BOSS.hp, Damage: MINI_BOSS.dmg, Speed: MINI_BOSS.speed, Size: MINI_BOSS.r, EXP: '', 'From minute': '', 'Spawn weight': '', Notes: 'Replaced by the King Jelly lair' },
];
out['Shrines'] = SHRINE_BOONS.map((s) => ({ Boon: s.name, Stat: STAT_LABEL[s.stat], Amount: PCT_STATS.has(s.stat) ? pct(s.amount) : s.amount }));

console.log(JSON.stringify(out));
