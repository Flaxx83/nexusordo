// Burndown (#95): mått, sparade värden (en gång per dag, tak), historik bakåt från versioner och ögonblicksbilder, idealkurva på arbetsdagar,
// sprintar, velocity och programmets summa. Påhittad data. Kör: node --test "test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const clamp = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const todayDay = .*;/), pick(/const weekday = .*;/),
  blk('/* ---------- Insats och belastning (#94)', '/* ---------- slut burndown'),
].join('\n');
const F = new Function(code + `\nreturn { burnTaskValue, burnValue, burnMeasures, burnAuto, recordSample, planSamples, burnRecord, estimateAt, backfill, idealLine,
  detectSprints, burnSeries, burnAt, velocity, programBurn, cleanBurn, toDay, fromDay, calendarOf, BURN_CAP };`)();
const D = F.toDay, cal = F.calendarOf({});

// Påhittad Scrum-plan: Sprint 1 (2 v från mån 2026-10-05), Sprint 2 (från mån 2026-10-19), Sprint 3 (från mån 2026-11-02)
const scrum = () => ({ tasks: [
  { id: 'b', name: 'Product Backlog', bucket: 'Sprint 0', start: '2026-09-28', end: '2026-10-02', progress: 100 },
  { id: 's1a', name: 'Inloggning', bucket: 'Sprint 1', start: '2026-10-05', end: '2026-10-09', progress: 100, effort: { planned: 16, done: 16, remaining: 0, src: 'tp' }, checks: [{ id: 'c1', text: 'a', done: true }, { id: 'c2', text: 'b', done: false }] },
  { id: 's1b', name: 'Sök', bucket: 'Sprint 1', start: '2026-10-05', end: '2026-10-16', progress: 100, effort: { planned: 24, done: null, remaining: null, src: 'tp' } },
  { id: 's1r', name: 'Sprint Review', bucket: 'Sprint 1', start: '2026-10-16', end: '2026-10-16', milestone: true, progress: 100 },
  { id: 's2a', name: 'Kundvagn', bucket: 'Sprint 2', start: '2026-10-19', end: '2026-10-30', progress: 50, effort: { planned: 40, done: 20, remaining: null, src: 'tp' } },
  { id: 's2b', name: 'Betalning', bucket: 'Sprint 2', start: '2026-10-19', end: '2026-10-30', progress: 0, effort: { planned: 80, done: null, remaining: null, src: 'planner', dflt: true } },
  { id: 's3a', name: 'Rapporter', bucket: 'Sprint 3', start: '2026-11-02', end: '2026-11-13', progress: 0, effort: { planned: 30, done: null, remaining: null, src: 'tp' } },
], settings: {} });

test('mått per aktivitet: timmar utan Planners standardinsats, checklistpunkter och aktivitetspoäng', () => {
  const p = scrum(), t = id => p.tasks.find(x => x.id === id);
  assert.deepEqual(F.burnTaskValue(t('s2a'), 'hours'), { rem: 20, tot: 40 });
  assert.equal(F.burnTaskValue(t('s2b'), 'hours'), null, 'standardinsats räknas inte');
  assert.deepEqual(F.burnTaskValue({ ...t('s2b'), effort: { ...t('s2b').effort, src: 'tp' } }, 'hours'), { rem: 80, tot: 80 }, 'ändrad i NexusOrdo räknas');
  assert.deepEqual(F.burnTaskValue(t('s1a'), 'checks'), { rem: 0, tot: 2 }, 'klar aktivitet = alla punkter klara');
  assert.deepEqual(F.burnTaskValue({ ...t('s1a'), progress: 50 }, 'checks'), { rem: 1, tot: 2 });
  assert.deepEqual(F.burnTaskValue(t('s2a'), 'points'), { rem: 0.5, tot: 1 });
  assert.equal(F.burnTaskValue(t('s1r'), 'points'), null, 'milstolpar räknas inte');
  assert.deepEqual(F.burnValue(p.tasks, 'hours'), { remaining: 50, total: 110, n: 4 });
  assert.deepEqual(F.burnValue(p.tasks, 'points'), { remaining: 2.5, total: 6, n: 6 });
});

test('förvalt mått: timmar om minst hälften har insats, annars checklista, annars aktivitetspoäng', () => {
  const p = scrum();
  assert.equal(F.burnAuto(p.tasks), 'hours'); // 4 av 6 aktiviteter
  const few = p.tasks.map(t => t.id === 's1b' || t.id === 's2a' ? { ...t, effort: undefined } : t);
  assert.equal(F.burnAuto(few), 'points'); // 2 av 6 med timmar, 1 med checklista
  const chk = few.map(t => t.milestone ? t : { ...t, checks: [{ id: 'c1', text: 'x', done: false }] });
  assert.equal(F.burnAuto(chk), 'checks');
  assert.deepEqual(F.burnMeasures(p.tasks).map(m => m.measure), ['hours', 'checks', 'points']);
});

test('recordSample: ett värde per dag och serie, oförändrat sparas inte, tak', () => {
  const s = (day, rem, tot = 10, scope = 'plan', measure = 'points') => ({ day, scope, measure, remaining: rem, total: tot });
  let l = F.recordSample([], s('2026-10-01', 10));
  l = F.recordSample(l, s('2026-10-01', 9)); // samma dag ersätter
  assert.deepEqual(l, [s('2026-10-01', 9)]);
  l = F.recordSample(l, s('2026-10-02', 9)); // oförändrat
  assert.equal(l.length, 1);
  l = F.recordSample(l, s('2026-10-03', 8));
  l = F.recordSample(l, s('2026-10-03', 9)); // tillbaka till förra värdet samma dag → tas bort
  assert.deepEqual(l, [s('2026-10-01', 9)]);
  l = F.recordSample(l, s('2026-10-04', 7, 12));
  l = F.recordSample(l, s('2026-10-04', 5, 5, 'ph:Sprint 1')); // annan serie
  l = F.recordSample(l, s('2026-09-01', 1)); // äldre dag ignoreras
  assert.equal(l.length, 3);
  let big = [];
  for (let i = 0; i < 450; i++) big = F.recordSample(big, s(F.fromDay(D('2025-01-01') + i), 450 - i));
  assert.equal(big.length, F.BURN_CAP);
  assert.equal(big[0].day, F.fromDay(D('2025-01-01') + 50), 'de äldsta tas bort');
  assert.equal(F.recordSample(big, s(F.fromDay(D('2025-01-01') + 450), 0), 10).length, 10);
});

test('burnRecord sparar hela planen och varje fas i de mått som finns', () => {
  const p = scrum();
  const burn = F.burnRecord([], p.tasks, '2026-10-20');
  const plan = burn.filter(x => x.scope === 'plan').map(x => x.measure);
  assert.deepEqual(plan, ['hours', 'checks', 'points']);
  assert.deepEqual(burn.find(x => x.scope === 'ph:Sprint 2' && x.measure === 'hours'), { day: '2026-10-20', scope: 'ph:Sprint 2', measure: 'hours', remaining: 20, total: 40 });
  assert.ok(!burn.some(x => x.scope === 'ph:Sprint 0' && x.measure === 'hours'));
  assert.deepEqual(F.burnRecord(burn, p.tasks, '2026-10-21'), burn, 'oförändrad plan nästa dag → inget nytt');
});

test('idealLine: från total till 0, nedåt bara på arbetsdagar (helger och svenska helgdagar platta)', () => {
  const l = F.idealLine('2026-10-05', '2026-10-16', 90, cal); // mån–fre två veckor: 9 steg
  assert.equal(l.length, 12);
  assert.deepEqual(l[0], { d: D('2026-10-05'), v: 90 });
  assert.equal(l.find(x => x.d === D('2026-10-09')).v, 50); // 4 steg
  assert.equal(l.find(x => x.d === D('2026-10-10')).v, 50); // lördag
  assert.equal(l.find(x => x.d === D('2026-10-11')).v, 50); // söndag
  assert.equal(l[l.length - 1].v, 0);
  const jul = F.idealLine('2026-12-21', '2026-12-28', 4, cal); // 22, 23, (24–27 lediga), 28 → 3 steg
  assert.equal(jul.find(x => x.d === D('2026-12-25')).v, jul.find(x => x.d === D('2026-12-23')).v);
  assert.equal(jul[jul.length - 1].v, 0);
  assert.deepEqual(F.idealLine('2026-10-05', '2026-10-01', 5, cal), []);
  assert.deepEqual(F.idealLine('2026-10-05', '2026-10-05', 5, cal), [{ d: D('2026-10-05'), v: 5 }, { d: D('2026-10-05'), v: 0 }]);
});

test('sprintar känns igen på fasnamnet (Sprint N, Iteration N, PI N) i startordning', () => {
  const s = F.detectSprints(scrum());
  assert.deepEqual(s.map(x => [x.bucket, x.n]), [['Sprint 0', 0], ['Sprint 1', 1], ['Sprint 2', 2], ['Sprint 3', 3]]);
  assert.equal(s[1].start, D('2026-10-05')); assert.equal(s[1].end, D('2026-10-16'));
  const other = { tasks: [{ bucket: 'PI 2', start: '2027-01-04', end: '2027-03-12' }, { bucket: 'PI 1', start: '2026-10-05', end: '2026-12-11' }, { bucket: 'Pilot 1', start: '2026-10-05', end: '2026-10-06' }, { bucket: 'Releases', start: '2026-12-01', end: '2026-12-01' }] };
  assert.deepEqual(F.detectSprints(other).map(x => x.bucket), ['PI 1', 'PI 2']);
});

test('burnSeries: sparade värden, uppskattning vid start, värdet idag, ideal och ändrat omfång', () => {
  const p = scrum(), today = D('2026-10-28');
  p.settings.burn = [
    { day: '2026-10-19', scope: 'ph:Sprint 2', measure: 'hours', remaining: 40, total: 40 },
    { day: '2026-10-23', scope: 'ph:Sprint 2', measure: 'hours', remaining: 30, total: 40 },
    { day: '2026-10-26', scope: 'ph:Sprint 2', measure: 'hours', remaining: 35, total: 50 },
  ];
  const s = F.burnSeries(p, 'ph:Sprint 2', 'hours', cal, { today });
  assert.equal(s.start, D('2026-10-19')); assert.equal(s.end, D('2026-10-30'));
  assert.deepEqual(s.points.map(x => [F.fromDay(x.d), x.remaining, x.src]), [['2026-10-19', 40, 'rec'], ['2026-10-23', 30, 'rec'], ['2026-10-26', 35, 'rec'], ['2026-10-28', 20, 'now']]);
  assert.deepEqual(s.changes, [{ d: D('2026-10-26'), from: 40, to: 50 }]);
  assert.equal(s.ideal[0].v, 40, 'idealet börjar på totalen vid start');
  assert.equal(s.ideal[s.ideal.length - 1].v, 0);
  // värden före sprintens start: bara det senaste, flyttat till start
  p.settings.burn.unshift({ day: '2026-10-01', scope: 'ph:Sprint 2', measure: 'hours', remaining: 41, total: 41 }, { day: '2026-10-12', scope: 'ph:Sprint 2', measure: 'hours', remaining: 42, total: 42 });
  p.settings.burn = p.settings.burn.filter(x => x.day !== '2026-10-19');
  assert.deepEqual(F.burnSeries(p, 'ph:Sprint 2', 'hours', cal, { today }).points.slice(0, 2).map(x => [F.fromDay(x.d), x.remaining]), [['2026-10-19', 42], ['2026-10-23', 30]]);
  // utan historik: uppskattning vid start från klara aktiviteters slutdatum
  const q = scrum(); q.tasks.find(t => t.id === 's1b').progress = 100;
  const s1 = F.burnSeries(q, 'ph:Sprint 1', 'hours', cal, { today });
  assert.deepEqual(s1.points.map(x => [F.fromDay(x.d), x.remaining, x.src]), [['2026-10-05', 40, 'est'], ['2026-10-16', 0, 'est'], ['2026-10-28', 0, 'now']]);
  // framtida sprint: bara idag
  const s3 = F.burnSeries(q, 'ph:Sprint 3', 'points', cal, { today });
  assert.equal(s3.points.length, 1); assert.equal(s3.ideal[0].v, 1);
});

test('backfill: versionerna ger exakta värden, ögonblicksbilderna uppskattade, sparade vinner samma dag', () => {
  const p = scrum(), today = D('2026-10-28');
  const old = JSON.parse(JSON.stringify(p.tasks)); old.find(t => t.id === 's1b').progress = 50; Object.assign(old.find(t => t.id === 's1a'), { progress: 0, effort: { planned: 16, done: 0, remaining: 16, src: 'tp' } });
  const versions = [{ at: '2026-10-08T10:00:00Z', data: { tasks: old } }, { at: '2026-10-08T07:00:00Z', data: { tasks: [] } }, { at: '2026-10-29T08:00:00Z', data: { tasks: old } }];
  const snapshots = [{ at: '2026-10-08' }, { at: '2026-10-12' }];
  const ex = F.backfill({ versions, snapshots, tasks: p.tasks, today });
  const v = ex.find(x => x.day === '2026-10-08' && x.scope === 'ph:Sprint 1' && x.measure === 'hours');
  assert.deepEqual(v, { day: '2026-10-08', scope: 'ph:Sprint 1', measure: 'hours', remaining: 28, total: 40, src: 'ver' }, 'den senaste versionen samma dag');
  const e = ex.find(x => x.day === '2026-10-12' && x.scope === 'ph:Sprint 1' && x.measure === 'hours');
  assert.deepEqual(e, { day: '2026-10-12', scope: 'ph:Sprint 1', measure: 'hours', remaining: 24, total: 40, src: 'est' }, 's1a klar 10-09, s1b klar 10-16');
  assert.ok(!ex.some(x => x.day >= '2026-10-28'), 'inget från idag och framåt');
  p.settings.burn = [{ day: '2026-10-12', scope: 'ph:Sprint 1', measure: 'hours', remaining: 20, total: 40 }];
  const s = F.burnSeries(p, 'ph:Sprint 1', 'hours', cal, { today, extra: ex });
  assert.deepEqual(s.points.map(x => [F.fromDay(x.d), x.remaining, x.src]), [['2026-10-05', 40, 'est'], ['2026-10-08', 28, 'ver'], ['2026-10-12', 20, 'rec'], ['2026-10-16', 0, 'est'], ['2026-10-28', 0, 'now']]);
});

test('velocity: klart per sprint vid sprintens slut och medel för avslutade sprintar', () => {
  const p = scrum(), today = D('2026-10-28');
  p.settings.burn = [{ day: '2026-10-16', scope: 'ph:Sprint 1', measure: 'points', remaining: 0.5, total: 2 }];
  const v = F.velocity(p, 'points', cal, { today });
  assert.deepEqual(v.rows.map(r => [r.bucket, r.done, r.state]), [['Sprint 0', 1, 'done'], ['Sprint 1', 1.5, 'done'], ['Sprint 2', 0.5, 'active'], ['Sprint 3', 0, 'future']]);
  assert.equal(v.avg, 1.25);
});

test('programmet: summan när måttet finns i alla planer, annars per plan', () => {
  const a = scrum(), b = { id: 'b', tasks: [{ id: 'x', bucket: 'Fas A', start: '2026-10-01', end: '2026-11-30', progress: 25, effort: { planned: 100, done: null, remaining: null, src: 'tp' } }], settings: {} };
  a.id = 'a';
  const today = D('2026-10-28');
  const r = F.programBurn([a, b], null, cal, { today });
  assert.equal(r.mode, 'sum'); assert.equal(r.measure, 'hours');
  assert.equal(r.sum.remaining, 50 + 75); assert.equal(r.sum.total, 110 + 100);
  assert.equal(r.sum.start, D('2026-09-28')); assert.equal(r.sum.end, D('2026-11-30'));
  const c = { id: 'c', tasks: [{ id: 'y', bucket: 'Fas', start: '2026-10-01', end: '2026-10-30', progress: 0 }], settings: {} };
  const r2 = F.programBurn([a, c], 'hours', cal, { today });
  assert.equal(r2.mode, 'per');
  assert.deepEqual(r2.series.map(x => x.s.measure), ['hours', 'points']);
  const r3 = F.programBurn([a, c], null, cal, { today });
  assert.equal(r3.mode, 'sum'); assert.equal(r3.measure, 'points');
});

test('cleanBurn (fil #69): bara giltiga rader och tal', () => {
  assert.deepEqual(F.cleanBurn([{ day: '2026-10-01', scope: 'plan', measure: 'hours', remaining: '5', total: 8, x: 1 }, { day: 'igår', scope: 'plan', measure: 'hours', remaining: 1, total: 1 },
    { day: '2026-10-01', scope: 'annat', measure: 'hours', remaining: 1, total: 1 }, { day: '2026-10-01', scope: 'ph:A', measure: 'kr', remaining: 1, total: 1 }]),
  [{ day: '2026-10-01', scope: 'plan', measure: 'hours', remaining: 5, total: 8 }]);
  assert.deepEqual(F.cleanBurn('x'), []);
});
