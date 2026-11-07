// Insats i timmar och belastning per person (#94): arbetskolumnerna i Premium (sv/en), sammanslagning vid Uppdatera från Excel,
// svenska helgdagar, kapacitet och belastning per person och vecka. Testdata är påhittad. Kör: node --test "test/*.test.mjs"
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
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), blk('const PMI_PHASES', 'function pmiColorOf'),
  blk('const COLMAP', 'function mergeImport('), blk('function mergeImport(', 'const fmtShortY'),
  pick(/const lc = .*;/), blk('const TP_SHEET', 'async function openPlanExport('), pick(/const TPL_FORMAT = .*;/),
].join('\n');
const F = new Function('XLSX', code + `\nreturn { parseWork, effortFrom, effortPlanned, effortLeft, peopleOf, isDefaultEffort, mergeEffort, easterDay, seHolidays,
  calendarOf, isWorkday, capacityOf, mergeCapacity, loadLevel, workload, parseWorkbook, mergeImport, buildExport, exportWorkbook, readExport, utcDay, fromDay, toDay };`)(XLSX);

const d = s => new Date(s + 'T09:00:00');
function book(sheet, head, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Namn på projekt', 'Testprojekt Beta'], [], head, ...rows], { cellDates: true }), sheet);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'Testprojekt Beta.xlsx', arrayBuffer: async () => buf };
}
const headSv = ['Uppgiftsnummer', 'Namn', 'Tilldelat till', 'Start', 'Avslutas', 'Varaktighet', 'Bucket', '% slutfört', 'Arbete', 'Slutfört arbete', 'Återstående arbete', 'Slutfört'];
const headEn = ['Task number', 'Name', 'Assigned to', 'Start', 'Finish', 'Duration', 'Bucket', '% complete', 'Work', 'Completed work', 'Remaining work'];

test('arbete i timmar, dagar och veckor på svenska och engelska', () => {
  assert.equal(F.parseWork('8 timmar'), 8);
  assert.equal(F.parseWork('8 hrs'), 8);
  assert.equal(F.parseWork('8 hours'), 8);
  assert.equal(F.parseWork('1 timme'), 1);
  assert.equal(F.parseWork('1214,4 timmar'), 1214.4);
  assert.equal(F.parseWork('1 214,4 timmar'), 1214.4);
  assert.equal(F.parseWork('1,214.5 hrs'), 1214.5);
  assert.equal(F.parseWork('2 dagar'), 16);
  assert.equal(F.parseWork('2 days'), 16);
  assert.equal(F.parseWork('1 dag'), 8);
  assert.equal(F.parseWork('1 vecka'), 40);
  assert.equal(F.parseWork('2 weeks'), 80);
  assert.equal(F.parseWork('3w'), 120);
  assert.equal(F.parseWork('90 min'), 1.5);
  assert.equal(F.parseWork(12.5), 12.5);
  assert.equal(F.parseWork('0 timmar'), 0);
  for (const v of ['', null, 'ej angivet', '-5 h', '8 furlongs', -1]) assert.equal(F.parseWork(v), null, String(v));
});

test('planerat, kvar (härlett när det saknas) och Planners standardinsats', () => {
  assert.equal(F.effortFrom(null, null, null), null);
  const e = F.effortFrom(16, 4, null, 'tp');
  assert.deepEqual(e, { planned: 16, done: 4, remaining: null, src: 'tp' });
  assert.equal(F.effortLeft({ effort: e, progress: 0 }), 12);
  assert.equal(F.effortLeft({ effort: F.effortFrom(20, null, null), progress: 25 }), 15);
  assert.equal(F.effortLeft({ effort: F.effortFrom(20, 5, 3), progress: 25 }), 3);
  assert.equal(F.effortLeft({ effort: F.effortFrom(20, 5, 3), progress: 100 }), 0);
  assert.equal(F.effortPlanned(F.effortFrom(null, 6, 2)), 8);
  assert.deepEqual(F.peopleOf('Anna A, Bertil B; Anna A'), ['Anna A', 'Bertil B']);
  assert.equal(F.isDefaultEffort(48, '1 dag', 6), true);
  assert.equal(F.isDefaultEffort(4048, '506 dagar', 1), true);
  assert.equal(F.isDefaultEffort(8, '236 dagar', 1), false);
});

test('Premium på svenska: Arbete, Slutfört arbete och Återstående arbete läses – och "Slutfört arbete" är aldrig ett datum', async () => {
  const imp = await F.parseWorkbook(book('Projektuppgifter', headSv, [
    ['1', 'Förstudie', 'Testperson A', d('2026-11-02'), d('2026-11-13'), '10 dagar', 'Förstudie', 0.5, '40 timmar', '1214,4 timmar', '24 timmar', ''],
    ['2', 'Konstruktion', 'Testperson A, Testperson B', d('2026-11-02'), d('2026-11-06'), '5 dagar', 'Förstudie', 0, '80 timmar', '0 timmar', '80 timmar', ''],
    ['3', 'Utan insats', 'Testperson B', d('2026-11-02'), d('2026-11-06'), '5 dagar', 'Förstudie', 0, '', '', '', ''],
  ]));
  for (const c of ['work', 'workDone', 'workLeft', 'end', 'completed']) assert.ok(imp.cols.includes(c), c);
  const [a, b, c] = imp.tasks;
  assert.deepEqual([a.end, b.end], ['2026-11-13', '2026-11-06'], 'slutdatum från Avslutas');
  assert.deepEqual(a.effort, { planned: 40, done: 1214.4, remaining: 24, src: 'planner' });
  assert.equal(b.effort.dflt, true, '5 dagar × 8 h × 2 personer = Planners standard');
  assert.equal(a.effort.dflt, undefined);
  assert.equal(c.effort, null);
  // Utan Avslutas: "Slutfört arbete" blir arbetskolumnen, aldrig slutdatum
  const noEnd = await F.parseWorkbook(book('Projektuppgifter', headSv.map(h => h === 'Avslutas' ? 'Okänd' : h), [['1', 'X', '', d('2026-11-02'), '', '', 'F', 0, '8 timmar', '8 timmar', '0 timmar', '']]));
  assert.ok(!noEnd.cols.includes('end') && !noEnd.cols.includes('finish'));
  assert.equal(noEnd.tasks[0].effort.done, 8);
});

test('Premium på engelska och fil utan arbetskolumner', async () => {
  const imp = await F.parseWorkbook(book('Project tasks', headEn, [['1', 'Design', 'Test Person', d('2026-11-02'), d('2026-11-13'), '10 days', 'Plan', 0, '2 days', '1 day', '8 hrs']]));
  assert.deepEqual(imp.tasks[0].effort, { planned: 16, done: 8, remaining: 8, src: 'planner' });
  const none = await F.parseWorkbook(book('Project tasks', headEn.slice(0, 8), [['1', 'Design', 'Test Person', d('2026-11-02'), d('2026-11-13'), '10 days', 'Plan', 0]]));
  assert.ok(!('effort' in none.tasks[0]));
});

test('sammanslagning: Planner skriver över, NexusOrdo-insats behålls tills Planner ändrar sin', () => {
  const pl = (p, r) => F.effortFrom(p, null, r, 'planner'), tp = (p, r) => F.effortFrom(p, null, r, 'tp');
  assert.deepEqual(F.mergeEffort(null, undefined, pl(8, 8)).change.kind, 'new');
  assert.equal(F.mergeEffort(pl(8, 8), pl(8, 8), pl(8, 8)).change, null);
  const ch = F.mergeEffort(pl(8, 8), pl(8, 8), pl(16, 16));
  assert.equal(ch.change.kind, 'changed'); assert.equal(ch.effort.planned, 16);
  // Ändrad i NexusOrdo (24 h), Planner fortfarande 8 → behålls
  const kept = F.mergeEffort(tp(24, 24), pl(8, 8), pl(8, 8));
  assert.equal(kept.effort.planned, 24); assert.equal(kept.effort.src, 'tp'); assert.equal(kept.change.kind, 'kept');
  // Planner har ändrat sitt värde → Planner vinner och det rapporteras
  const ow = F.mergeEffort(tp(24, 24), pl(8, 8), pl(16, 16));
  assert.equal(ow.effort.planned, 16); assert.equal(ow.effort.src, 'planner'); assert.equal(ow.change.kind, 'overwritten');
  // Okänt tidigare Planner-värde (äldre plan) → NexusOrdos värde behålls
  assert.equal(F.mergeEffort(tp(24, 24), undefined, pl(16, 16)).effort.planned, 24);
});

test('mergeImport: insats i rapporten, t.imp.effort sparas och fil utan arbetskolumner rör inte insatsen', async () => {
  const head = headSv;
  const v1 = await F.parseWorkbook(book('Projektuppgifter', head, [['1', 'Förstudie', 'A', d('2026-11-02'), d('2026-11-13'), '10 dagar', 'F', 0, '8 timmar', '0 timmar', '8 timmar', ''],
    ['2', 'Analys', 'A', d('2026-11-02'), d('2026-11-13'), '10 dagar', 'F', 0, '8 timmar', '0 timmar', '8 timmar', '']]));
  const plan = { tasks: F.mergeImport({ tasks: [] }, v1).tasks };
  assert.deepEqual(plan.tasks[0].imp.effort, { planned: 8, done: 0, remaining: 8, src: 'planner' });
  plan.tasks[0].effort = { planned: 30, done: 0, remaining: null, src: 'tp' }; // ändrad i NexusOrdo
  const v2 = await F.parseWorkbook(book('Projektuppgifter', head, [['1', 'Förstudie', 'A', d('2026-11-02'), d('2026-11-13'), '10 dagar', 'F', 0, '8 timmar', '0 timmar', '8 timmar', ''],
    ['2', 'Analys', 'A', d('2026-11-02'), d('2026-11-13'), '10 dagar', 'F', 0, '12 timmar', '0 timmar', '12 timmar', '']]));
  const res = F.mergeImport(plan, v2);
  assert.equal(res.tasks[0].effort.planned, 30, 'NexusOrdos värde behålls');
  assert.equal(res.tasks[1].effort.planned, 12);
  assert.deepEqual(res.report.effort.map(x => x.kind).sort(), ['changed', 'kept']);
  assert.ok(res.report.changed.some(c => c.name === 'Analys' && c.what.some(w => /insats 8 h · kvar 8 h → 12 h · kvar 12 h/.test(w))), JSON.stringify(res.report.changed));
  const v3 = await F.parseWorkbook(book('Projektuppgifter', head.slice(0, 8), [['1', 'Förstudie', 'A', d('2026-11-02'), d('2026-11-13'), '10 dagar', 'F', 0], ['2', 'Analys', 'A', d('2026-11-02'), d('2026-11-13'), '10 dagar', 'F', 0]]));
  const res3 = F.mergeImport({ tasks: res.tasks }, v3);
  assert.equal(res3.tasks[0].effort.planned, 30); assert.equal(res3.tasks[1].effort.planned, 12);
  assert.deepEqual(res3.tasks[1].imp.effort, res.tasks[1].imp.effort);
  assert.equal(res3.report.effort.length, 0);
});

test('påskdagen och svenska helgdagar', () => {
  const E = y => F.fromDay(F.easterDay(y));
  assert.deepEqual([2019, 2024, 2025, 2026, 2027, 2038].map(E), ['2019-04-21', '2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2038-04-25']);
  const h = Object.fromEntries(F.seHolidays(2026).map(x => [x.name, x.date]));
  assert.equal(h['Långfredagen'], '2026-04-03');
  assert.equal(h['Annandag påsk'], '2026-04-06');
  assert.equal(h['Kristi himmelsfärdsdag'], '2026-05-14');
  assert.equal(h['Pingstdagen'], '2026-05-24');
  assert.equal(h['Midsommarafton'], '2026-06-19');
  assert.equal(h['Midsommardagen'], '2026-06-20');
  assert.equal(h['Alla helgons dag'], '2026-10-31');
  assert.equal(F.seHolidays(2027).find(x => x.name === 'Alla helgons dag').date, '2027-11-06');
  assert.equal(F.seHolidays(2026).length, 16);
  const cal = F.calendarOf({}), none = F.calendarOf({ calendar: { holidays: 'none' } });
  assert.equal(F.isWorkday(F.toDay('2026-12-24'), cal), false);
  assert.equal(F.isWorkday(F.toDay('2026-12-24'), none), true);
  assert.equal(F.isWorkday(F.toDay('2026-12-23'), cal), true);
  assert.equal(F.isWorkday(F.toDay('2026-12-26'), none), false, 'lördag');
});

test('kapacitet per person och för ett program', () => {
  assert.deepEqual(F.capacityOf({}), { defaultHoursPerWeek: 40, people: {} });
  assert.deepEqual(F.capacityOf({ capacity: { defaultHoursPerWeek: 32, people: { ' Anna  A ': 20, Bad: -3, X: 'abc' } } }), { defaultHoursPerWeek: 32, people: { 'Anna A': 20 } });
  const m = F.mergeCapacity({ people: { Anna: 30 } }, [{ people: { anna: 10, Bertil: 16 } }]);
  assert.deepEqual(m, { defaultHoursPerWeek: 40, people: { Anna: 30, Bertil: 16 } });
  assert.deepEqual([50, 80, 81, 100, 101, null].map(F.loadLevel), ['ok', 'ok', 'warn', 'warn', 'over', null]);
});

test('belastning: jämnt över arbetsdagarna, delat mellan tilldelade, helgdagar minskar kapaciteten', () => {
  const W = F.toDay('2026-12-21'); // v52: 24–26 december lediga → 2 arbetsdagar
  const plan = { id: 'p1', tasks: [
    // 10 arbetsdagar v50–v51 (7–18 dec), 80 h, två personer → 4 h/dag/person
    { id: 'a', name: 'Konstruktion', assignees: 'Anna A, Bertil B', start: '2026-12-07', end: '2026-12-18', progress: 0, effort: { planned: 80, done: null, remaining: null, src: 'tp' } },
    // 21 dec – 8 jan: arbetsdagar 21, 22, 23, 28, 29, 30, 4, 5, 7, 8 jan (6 jan trettondedag) = 10 → 4 h/dag
    { id: 'b', name: 'Inköp', assignees: 'Anna A', start: '2026-12-21', end: '2027-01-08', progress: 0, effort: { planned: 40, done: null, remaining: null, src: 'planner' } },
    { id: 'c', name: 'Utan insats', assignees: 'Bertil B', start: '2026-12-07', end: '2026-12-18', progress: 0 },
    { id: 'd', name: 'Ej tilldelad', assignees: '', start: '2026-12-07', end: '2026-12-11', progress: 0, effort: { planned: 10, done: null, remaining: null, src: 'tp' } },
  ] };
  const cap = { defaultHoursPerWeek: 40, people: { 'Bertil B': 20 } };
  const r = F.workload(plan, F.toDay('2026-12-07'), 4, F.calendarOf({}), cap, { basis: 'planned' });
  assert.deepEqual(r.weeks.map(F.fromDay), ['2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28']);
  const anna = r.people.find(p => p.name === 'Anna A'), bertil = r.people.find(p => p.name === 'Bertil B'), none = r.people.find(p => p.name === '');
  assert.deepEqual(anna.cells.map(c => c.hours), [20, 20, 12, 12]);
  assert.deepEqual(anna.cells.map(c => c.capacity), [40, 40, 24, 24], 'v52 och v53 har tre arbetsdagar');
  assert.deepEqual(anna.cells.map(c => c.pct), [50, 50, 50, 50]);
  assert.deepEqual(bertil.cells.map(c => [c.hours, c.capacity, c.pct, c.level]), [[20, 20, 100, 'warn'], [20, 20, 100, 'warn'], [0, 12, 0, 'ok'], [0, 12, 0, 'ok']]);
  assert.equal(none.capacity, null); assert.equal(none.cells[0].hours, 10); assert.equal(none.cells[0].pct, null);
  assert.equal(r.people[r.people.length - 1].name, '', 'ej tilldelad sist');
  assert.equal(r.missing, 1);
  assert.deepEqual(anna.cells[0].tasks, [{ planId: 'p1', id: 'a', name: 'Konstruktion', hours: 20 }]);
  // Utan helgdagar: v52 har fem arbetsdagar
  const nh = F.workload(plan, W, 1, F.calendarOf({ calendar: { holidays: 'none' } }), cap, { basis: 'planned' });
  assert.equal(nh.people.find(p => p.name === 'Anna A').cells[0].capacity, 40);
});

test('belastning på kvar: från idag, försenat kvar läggs på idag, klara räknas inte', () => {
  const today = F.toDay('2026-11-04'); // onsdag v45
  const plan = { id: 'p', tasks: [
    { id: 'a', name: 'Pågår', assignees: 'A', start: '2026-11-02', end: '2026-11-13', progress: 50, effort: { planned: 40, done: 20, remaining: null, src: 'tp' } }, // 20 h kvar över 8 dagar (4/11–13/11)
    { id: 'b', name: 'Sen', assignees: 'A', start: '2026-10-19', end: '2026-10-30', progress: 50, effort: { planned: 10, done: null, remaining: 6, src: 'tp' } },
    { id: 'c', name: 'Klar', assignees: 'A', start: '2026-11-02', end: '2026-11-06', progress: 100, effort: { planned: 40, done: 40, remaining: 0, src: 'tp' } },
  ] };
  const r = F.workload(plan, today, 2, F.calendarOf({}), F.capacityOf({}), { today });
  const a = r.people[0];
  assert.deepEqual(a.cells.map(c => c.hours), [7.5 + 6, 12.5]);
  assert.deepEqual(a.cells[0].tasks.map(t => t.name), ['Pågår', 'Sen']);
  assert.equal(r.tasks, 2);
  // Program: två planer, samma person
  const r2 = F.workload([plan, { id: 'q', tasks: [{ id: 'x', name: 'Annan plan', assignees: 'a', start: '2026-11-09', end: '2026-11-13', progress: 0, effort: { planned: 30, src: 'planner' } }] }],
    today, 2, F.calendarOf({}), F.capacityOf({}), { today });
  assert.equal(r2.people.length, 1, 'samma person i två planer (skiftläge spelar ingen roll)');
  assert.equal(r2.people[0].cells[1].hours, 42.5);
  assert.equal(r2.people[0].cells[1].level, 'over');
  // Planners standardinsats kan uteslutas
  const r3 = F.workload({ id: 'p', tasks: [{ ...plan.tasks[0], effort: { ...plan.tasks[0].effort, dflt: true } }] }, today, 1, F.calendarOf({}), F.capacityOf({}), { today, dflt: false });
  assert.equal(r3.dflt, 1); assert.equal(r3.people.length, 0);
});

test('export och import (#69): insats, kapacitet och kalender följer med och rensas', () => {
  const p = { id: 'x', name: 'Fiktiv plan Gamma', settings: { capacity: { defaultHoursPerWeek: 36, people: { 'Test A': 20, '': 5, Fel: 'x' } }, calendar: { holidays: 'none', workdays: [0, 1, 2, 3, 9] } },
    tasks: [{ id: 't1', name: 'A', start: '2026-11-02', end: '2026-11-06', progress: 0, deps: [], effort: { planned: 16, done: 4, remaining: null, src: 'tp' } },
      { id: 't2', name: 'B', start: '2026-11-02', end: '2026-11-06', progress: 0, deps: [], effort: { planned: 'mycket', done: -2, src: 'hack', dflt: true, extra: '<script>' }, imp: { effort: { planned: 8, src: 'planner' } } },
      { id: 't3', name: 'C', start: '2026-11-02', end: '2026-11-06', progress: 0, deps: [], effort: { planned: 40, src: 'planner', dflt: true } }] };
  const wb = F.exportWorkbook(F.buildExport([p], [], '2026-10-31T10:00:00Z'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const h = rows.findIndex(r => r.includes('Planerat (h)'));
  assert.ok(h > 0, 'läsbar kolumn Planerat (h)');
  assert.deepEqual(rows[h + 1].slice(-2), [16, 12]);
  const back = F.readExport(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' })).plans[0];
  assert.deepEqual(back.tasks[0].effort, { planned: 16, done: 4, remaining: null, src: 'tp' });
  assert.deepEqual(back.tasks[1].effort, { planned: null, done: 0, remaining: null, src: 'tp' });
  assert.deepEqual(back.tasks[1].imp.effort, { planned: 8, done: null, remaining: null, src: 'planner' });
  assert.equal(back.tasks[2].effort.dflt, true);
  assert.deepEqual(back.settings.capacity, { defaultHoursPerWeek: 36, people: { 'Test A': 20 } });
  assert.deepEqual(back.settings.calendar, { workdays: [0, 1, 2, 3], holidays: 'none' });
});

// Mallar (#73): bara planerade timmar följer med
const code2 = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;', pick(/const clamp = .*;/),
  pick(/const uid = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const todayDay = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/function parseWeek\([\s\S]*?\n}\n/),
  pick(/const normName = .*;/), pick(/const TPL_GATES = .*;/), pick(/const TPL_SEP = .*;/), pick(/const weekMon = .*;/), pick(/const gateCodeRe = .*;/),
  pick(/function repeatVals\([\s\S]*?\n}\n/), pick(/function repeatSlots\([\s\S]*?\n}\n/), pick(/function repeatSpan\([\s\S]*?\n}\n/), pick(/function templateTasks\([\s\S]*?\n}\n/), pick(/const isGateMs = .*;/),
  pick(/const TP_CHUNK = .*|const TP_SHEET = .*;/), pick(/const tpObj = .*;/), pick(/function tpChunks\([\s\S]*?\n}\n/),
  pick(/const PALETTE_IDS = .*;/), pick(/const isHexColor = .*;/), pick(/function cleanPhaseColors\([\s\S]*?\n}\n/),
  blk('/* ---------- Insats och belastning (#94)', '/* ---------- slut insats'), blk('const TPL_FORMAT', '// Lagring: tp_templates'),
].join('\n');
const T = new Function('XLSX', 'TEMPLATE_LIB', code2 + '\nreturn { templateTasks, planToTemplate, templateLib, cleanTemplate, templateWorkbook, readTemplateWb };')(XLSX, JSON.parse(readFileSync(new URL('../mallar/mallbibliotek.json', import.meta.url), 'utf8')));

test('mall: planerade timmar följer med, utfört och kvar gör det inte', () => {
  const p = { id: 'p', name: 'Fiktiv plan Delta', settings: {}, tasks: [
    { id: 'a', name: 'Konstruktion', bucket: 'F', start: '2027-01-04', end: '2027-01-29', progress: 50, deps: [], effort: { planned: 120, done: 60, remaining: 60, src: 'planner', dflt: true } },
    { id: 'b', name: 'Granskning', bucket: 'F', start: '2027-02-01', end: '2027-02-05', progress: 0, deps: ['a'] }] };
  const tpl = T.planToTemplate(p, { name: 'Fiktiv mall' });
  assert.equal(tpl.groups[0].items[0].effortH, 120);
  assert.ok(!('effortH' in tpl.groups[0].items[1]));
  const file = T.readTemplateWb(XLSX.read(XLSX.write(T.templateWorkbook(tpl), { type: 'array', bookType: 'xlsx' }), { type: 'array' }));
  assert.equal(file.groups[0].items[0].effortH, 120);
  assert.equal(T.cleanTemplate({ ...tpl, groups: [{ ...tpl.groups[0], items: [{ ...tpl.groups[0].items[0], effortH: 'x' }] }] }).groups[0].items[0].effortH, undefined);
  const { tasks } = T.templateTasks(T.templateLib(file), { groups: ['own'], gates: { START: 100000 } });
  const k = tasks.find(t => t.name === 'Konstruktion');
  assert.deepEqual(k.effort, { planned: 120, done: null, remaining: null, src: 'tp' });
  assert.equal(tasks.find(t => t.name === 'Granskning').effort, undefined);
});
