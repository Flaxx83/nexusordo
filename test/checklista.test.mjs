// Checklista på aktiviteter (#71): parsning av Planners checklistpunkter och sammanslagning vid Uppdatera från Excel.
// Testdata är påhittad. Funktionerna läses direkt ur app/script.js. Kör: node --test "test/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const XLSX = require('../app/vendor/xlsx.full.min.js');
const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s; const fmtShortY = x => x || "–"; const fmtDayY = n => String(n); const window = { XLSX };',
  pick(/const clamp = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const todayDay = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), blk('const PMI_PHASES', '\n];') + '\n];',
  blk('const COLMAP', 'function mergeImport('), blk('function mergeImport(', 'const fmtShortY'),
  pick(/const lc = .*;/), blk('const TP_SHEET', 'async function openPlanExport('), pick(/const TPL_FORMAT = .*;/),
].join('\n');
const F = new Function('XLSX', code + `\nreturn { parseChecks, parseCheckCount, plannerChecksOf, checkStat, checksAllDone, mergeChecks, cleanChecks, normCheck,
  parseWorkbook, mergeImport, buildExport, exportWorkbook, readExport };`)(XLSX);

test('punkter separerade med semikolon blir obockade Planner-punkter', () => {
  const c = F.parseChecks(' Skicka förfrågan ;Ta emot  svar;; skicka förfrågan;Granska. ', '2026-10-30T08:00:00Z');
  assert.deepEqual(c.map(x => x.text), ['Skicka förfrågan', 'Ta emot svar', 'Granska.']);
  assert.ok(c.every(x => x.done === false && x.src === 'planner' && x.at === '2026-10-30T08:00:00Z'));
  assert.equal(new Set(c.map(x => x.id)).size, 3);
  assert.deepEqual(F.parseChecks(''), []);
  assert.deepEqual(F.parseChecks(null), []);
});

test('Planners räknare "2/3" och äldre planer med bara task.checklist', () => {
  assert.deepEqual(F.parseCheckCount('2/3'), { done: 2, total: 3 });
  assert.deepEqual(F.parseCheckCount(' 0 / 13 '), { done: 0, total: 13 });
  assert.equal(F.parseCheckCount(''), null);
  assert.equal(F.parseCheckCount('0/0'), null);
  assert.deepEqual(F.plannerChecksOf({ checklist: '1/4' }), { done: 1, total: 4 });
  assert.deepEqual(F.plannerChecksOf({ plannerChecks: { done: 3, total: 3 }, checklist: '1/4' }), { done: 3, total: 3 });
  assert.equal(F.plannerChecksOf({}), null);
  assert.equal(F.checkStat({}), null);
});

test('alla punkter klara men aktiviteten inte klar markeras', () => {
  const checks = [{ id: 'c1', text: 'A', done: true }, { id: 'c2', text: 'B', done: true }];
  assert.deepEqual(F.checkStat({ checks }), { done: 2, total: 2 });
  assert.equal(F.checksAllDone({ checks, progress: 50 }), true);
  assert.equal(F.checksAllDone({ checks, progress: 100 }), false);
  assert.equal(F.checksAllDone({ checks: [checks[0], { id: 'c3', text: 'C', done: false }], progress: 0 }), false);
  assert.equal(F.checksAllDone({ progress: 0 }), false);
});

test('sammanslagning: bockar och NexusOrdo-punkter behålls, nya läggs till, obockade borttagna tas bort', () => {
  const old = [
    { id: 'c1', text: 'Skicka förfrågan', done: true, src: 'planner', at: 'x' },
    { id: 'c2', text: 'Ta emot svar', done: false, src: 'planner' },
    { id: 'c3', text: 'Boka möte', done: false, src: 'planner' },     // borta i Planner, obockad → tas bort
    { id: 'c4', text: 'Ring leverantör', done: true, src: 'planner' }, // borta i Planner, bockad → behålls
    { id: 'c5', text: 'Egen punkt', done: false, src: 'tp' },          // tillagd i NexusOrdo → behålls
    { id: 'c6', text: 'Granska ritning (TP)', ptext: 'Granska ritning', done: false, src: 'planner' }, // ändrad text, matchas på ptext
  ];
  const fresh = F.parseChecks('skicka  FÖRFRÅGAN.;Ta emot svar;Granska ritning;Ny punkt');
  const r = F.mergeChecks(old, fresh);
  assert.deepEqual(r.checks.map(c => c.text), ['Skicka förfrågan', 'Ta emot svar', 'Ring leverantör', 'Egen punkt', 'Granska ritning (TP)', 'Ny punkt']);
  assert.equal(r.checks[0].done, true);
  assert.deepEqual(r.added, ['Ny punkt']);
  assert.deepEqual(r.removed, ['Boka möte']);
  assert.deepEqual(r.kept, ['Ring leverantör']);
  assert.equal(new Set(r.checks.map(c => c.id)).size, r.checks.length, 'unika id');
  // Samma export igen ändrar ingenting
  const again = F.mergeChecks(r.checks, fresh);
  assert.deepEqual(again.checks, r.checks);
  assert.deepEqual([again.added, again.removed], [[], []]);
});

test('punkt med ändrad text som försvunnit i Planner behålls', () => {
  const r = F.mergeChecks([{ id: 'c1', text: 'Min text', ptext: 'Planners text', done: false, src: 'planner' }], []);
  assert.deepEqual(r.checks.map(c => c.text), ['Min text']);
  assert.deepEqual(r.kept, ['Min text']);
});

test('cleanChecks släpper bara igenom giltiga punkter', () => {
  const c = F.cleanChecks([{ id: 'c1', text: ' A ', done: true, src: 'planner', at: 'x', evil: 1 }, { text: '' }, null, { text: 'B', done: 'ja' }]);
  assert.deepEqual(c, [{ id: 'c1', text: 'A', done: true, src: 'planner', at: 'x' }, { id: 'c2', text: 'B', done: false, src: 'tp', at: null }]);
  assert.deepEqual(F.cleanChecks('x'), []);
});

// Påhittad plan i Planners engelska exportformat
const head = ['Task ID', 'Task Name', 'Bucket Name', 'Progress', 'Start date', 'Due date', 'Checklist Items', 'Completed Checklist Items'];
function planner(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), 'Tasks');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'Testplan Beta.xlsx', arrayBuffer: async () => buf };
}

test('import och Uppdatera från Excel behåller bockar och egna punkter', async () => {
  const v1 = await F.parseWorkbook(planner([
    ['a1', 'Offert', 'Inköp', 'In progress', '2026-11-02', '2026-11-20', 'Skicka RFQ;Ta emot svar;Jämför', '1/3'],
    ['a2', 'Beställning', 'Inköp', 'Not started', '2026-11-23', '2026-11-27', '', ''],
  ]));
  const [t1, t2] = v1.tasks;
  assert.deepEqual(t1.checks.map(c => c.text), ['Skicka RFQ', 'Ta emot svar', 'Jämför']);
  assert.deepEqual(t1.plannerChecks, { done: 1, total: 3 });
  assert.deepEqual(t2.checks, []);
  assert.equal(t1.checklist, undefined);
  // Användaren bockar av och lägger till en egen punkt i NexusOrdo
  const plan = { tasks: v1.tasks.map(t => ({ ...t })) };
  plan.tasks[0].checks[0].done = true;
  plan.tasks[0].checks.push({ id: 'x1', text: 'Fråga ekonomi', done: false, src: 'tp', at: null });
  const v2 = await F.parseWorkbook(planner([
    ['a1', 'Offert', 'Inköp', 'In progress', '2026-11-02', '2026-11-20', 'Skicka RFQ;Jämför;Förhandla', '2/3'],
    ['a2', 'Beställning', 'Inköp', 'Not started', '2026-11-23', '2026-11-27', 'Skicka order', '0/1'],
  ]));
  const res = F.mergeImport(plan, v2);
  const a1 = res.tasks.find(t => t.plannerId === 'a1'), a2 = res.tasks.find(t => t.plannerId === 'a2');
  assert.deepEqual(a1.checks.map(c => [c.text, c.done]), [['Skicka RFQ', true], ['Jämför', false], ['Fråga ekonomi', false], ['Förhandla', false]]);
  assert.deepEqual(a1.plannerChecks, { done: 2, total: 3 });
  assert.deepEqual(a2.checks.map(c => c.text), ['Skicka order']);
  const r1 = res.report.checks.find(c => c.name === 'Offert');
  assert.deepEqual([r1.added, r1.removed, r1.kept], [['Förhandla'], ['Ta emot svar'], []]);
  assert.ok(res.report.changed.some(c => c.name === 'Offert' && c.what.includes('checklista +1 −1')));
  // Fil utan checklistkolumn rör inte punkterna
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head.slice(0, 6), ['a1', 'Offert', 'Inköp', 'In progress', '2026-11-02', '2026-11-20']]), 'Tasks');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const v3 = await F.parseWorkbook({ name: 'x.xlsx', arrayBuffer: async () => buf });
  const res3 = F.mergeImport({ tasks: res.tasks }, v3);
  assert.deepEqual(res3.tasks.find(t => t.plannerId === 'a1').checks, a1.checks);
});

test('punkter och bockar följer med i export → import (#69)', () => {
  const p = { id: 'p1', name: 'Testplan Beta', tasks: [{ id: 't1', name: 'Offert', start: '2026-11-02', end: '2026-11-20', deps: [],
    checks: [{ id: 'c1', text: 'Skicka RFQ', done: true, src: 'planner', at: '2026-10-30T08:00:00Z' }, { id: 'c2', text: 'Egen', done: false, src: 'tp', at: null }],
    plannerChecks: { done: 1, total: 1 } }], settings: {} };
  const wb = F.exportWorkbook(F.buildExport([p], []));
  const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  const d = F.readExport(back);
  assert.deepEqual(d.plans[0].tasks[0].checks, p.tasks[0].checks);
  assert.deepEqual(d.plans[0].tasks[0].plannerChecks, { done: 1, total: 1 });
});
