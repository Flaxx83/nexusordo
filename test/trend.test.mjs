// Tester för milstolpetrenden (#41): ögonblicksbilder, tak, trend per milstolpe och baslinje från senaste importen.
// Funktionerna läses direkt ur app/script.js. Kör: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const code = [
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const todayDay = .*;/), pick(/const SNAP_CAP = .*;/),
  pick(/function snapshotOf\([\s\S]*?\n}\n/), pick(/function addSnapshot\([\s\S]*?\n}\n/),
  pick(/function msTrend\([\s\S]*?\n}\n/), pick(/function baselineFromImp\([\s\S]*?\n}\n/),
].join('\n');
const { snapshotOf, addSnapshot, msTrend, baselineFromImp } = new Function(code + '\nreturn { snapshotOf, addSnapshot, msTrend, baselineFromImp };')();

const plan = { tasks: [
  { id: 'g1', name: 'Gate DG', milestone: true, end: '2026-11-06' },
  { id: 'g2', name: 'Gate G2', milestone: true, end: '2027-03-05' },
  { id: 'a1', name: 'Aktivitet', milestone: false, end: '2026-12-01' },
  { id: 'g3', name: 'Gate IG', milestone: true, end: null },
] };

test('ögonblicksbilden tar bara milstolpar med datum', () => {
  const s = snapshotOf(plan, '2026-10-29', 'import');
  assert.deepEqual(s, { at: '2026-10-29', src: 'import', ms: { g1: '2026-11-06', g2: '2027-03-05' } });
});

test('samma dag och samma datum ersätter, annars läggs till', () => {
  const a = snapshotOf(plan, '2026-10-29', 'import');
  let l = addSnapshot([], a);
  l = addSnapshot(l, { ...a, src: 'manual' });
  assert.equal(l.length, 1); assert.equal(l[0].src, 'manual');
  l = addSnapshot(l, { at: '2026-10-29', src: 'update', ms: { ...a.ms, g2: '2027-03-26' } });
  assert.equal(l.length, 2); // samma dag men flyttad gate → ny punkt
  l = addSnapshot(l, { at: '2026-11-05', src: 'update', ms: l[1].ms });
  assert.equal(l.length, 3); // ny rapportvecka utan ändring → plan linje
});

test('taket behåller den första (baslinjen) och de senaste', () => {
  let l = [];
  for (let i = 0; i < 70; i++) l = addSnapshot(l, { at: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}`, src: 'update', ms: { g1: '2027-01-' + String(1 + (i % 28)).padStart(2, '0') + 'x' + i } }, 60);
  assert.equal(l.length, 60);
  assert.match(l[0].ms.g1, /x0$/);
  assert.match(l[59].ms.g1, /x69$/);
});

test('trend: punkter, flyttar och total förskjutning', () => {
  const snaps = [
    { at: '2026-09-01', src: 'baseline', ms: { g2: '2027-03-05' } },
    { at: '2026-10-01', src: 'update', ms: { g2: '2027-03-26' } },
    { at: '2026-10-15', src: 'update', ms: { g2: '2027-03-26' } },
    { at: '2026-10-29', src: 'update', ms: { g2: '2027-03-19', g1: '2026-11-06' } },
  ];
  const r = msTrend(snaps, 'g2');
  assert.equal(r.points.length, 4);
  assert.equal(r.moves, 2);
  assert.equal(r.lastMove, '2026-10-29');
  assert.equal(r.totalShiftDays, 14); // +2 veckor netto
  assert.deepEqual(msTrend(snaps, 'g1'), { points: [{ at: '2026-10-29', d: '2026-11-06', src: 'update' }], moves: 0, lastMove: null, totalShiftDays: 0 });
});

test('baslinje från senaste importen: före flytten om den finns, annars importens datum', () => {
  const tasks = [
    { id: 'g1', milestone: true, end: '2026-11-27', imp: { end: '2026-11-27' }, moved: { days: 21, fromEnd: '2026-11-06' } },
    { id: 'g2', milestone: true, end: '2027-03-05', imp: { end: '2027-03-05' } },
    { id: 'a1', milestone: false, end: '2026-12-01', imp: { end: '2026-12-01' } },
    { id: 'g3', milestone: true, end: '2027-05-01' },
  ];
  assert.deepEqual(baselineFromImp(tasks, '2026-10-20T08:00:00Z'), { at: '2026-10-20', src: 'baseline', ms: { g1: '2026-11-06', g2: '2027-03-05' } });
  assert.equal(baselineFromImp([{ id: 'x', milestone: true, end: '2027-01-01' }], null), null);
});
