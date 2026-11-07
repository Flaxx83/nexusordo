// Tester för import av Planner Premium-export på svenska och skyddet mot fel exportformat vid uppdatering (2026-10-29).
// Testdata är påhittad och byggs i minnet. Funktionerna läses direkt ur app/script.js.
// Kör: node --test test/*.test.mjs
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
  blk('const COLMAP', 'function mergeImport('), blk('function mergeImport(', 'const fmtShortY'), blk('function mergeWarnings(', 'const mergeWarnHTML'),
  pick(/const lc = .*;/), blk('const TP_SHEET', 'async function openPlanExport('), pick(/const TPL_FORMAT = .*;/),
].join('\n');
const { parseWorkbook, mergeImport, mergeWarnings, buildExport, exportWorkbook } = new Function('XLSX', code + '\nreturn { parseWorkbook, mergeImport, mergeWarnings, buildExport, exportWorkbook };')(XLSX);

// Påhittad plan i Premiums svenska exportformat (flikar Projektuppgifter och Projektmål)
const d = s => new Date(s + 'T09:00:00');
const head = ['Uppgiftsnummer', 'Dispositionsnummer', 'Namn', 'Tilldelat till', 'Start', 'Avslutas', 'Varaktighet', 'Bucket', '% slutfört', 'Prioritet',
  'Beroende av', 'Underordnade (efter)', 'Arbete', 'Slutfört arbete', 'Återstående arbete', 'Milstolpe', 'Anteckningar', 'Slutfört', 'Checklisteobjekt', 'Etiketter', 'Goal'];
const rows = [
  ['Namn på projekt', 'Testprojekt Alfa'], ['Exporterat den', '2026-10-29'], [],
  head,
  ['1', '1', 'Förstudie', 'Test Person', d('2026-01-05'), d('2026-03-27'), '60 dagar', 'INITIATING', 1, 'Medium', '', '2AS', '8 timmar', '8 timmar', '0 timmar', 'Nej', '', '', '', '', 'G1'],
  ['2', '2', 'Konceptval', 'Test Person', d('2026-03-30'), d('2026-05-22'), '40 dagar', 'INITIATING', 0.3, 'Medium', '1AS', '3AS', '8 timmar', '2 timmar', '6 timmar', 'Nej', '', '', '', '', 'G1'],
  ['3', '3', 'Detaljkonstruktion', 'Test Person', d('2026-06-01'), d('2026-09-25'), '84 dagar', 'PLANNING', 0, 'Medium', '2AS', '', '8 timmar', '0 timmar', '8 timmar', 'Nej', '', '', '', '', 'G2'],
  ['4', '4', 'Upphandling', 'Test Person', d('2026-06-01'), d('2026-08-28'), '64 dagar', 'PLANNING', 0, 'Medium', '2AS', '', '8 timmar', '0 timmar', '8 timmar', 'Nej', '', '', '', '', 'G2'],
  ['5', '5', 'Installation', 'Test Person', d('2026-10-05'), d('2026-12-18'), '55 dagar', 'EXECUTING', 0, 'Medium', '3AS, 4AS', '', '8 timmar', '0 timmar', '8 timmar', 'Nej', '', '', '', '', 'G3'],
];
const goals = [
  ['Namn', 'Prioritet', 'Status', 'Startdatum', 'Slutdatum', 'Beskrivning', 'Anslutna uppgifter'],
  ['G1', 'Medium', 'Stängt', '', d('2026-05-29'), '', '1-Förstudie, 2-Konceptval'],
  ['G2', 'Medium', 'Ej påbörjad', '', d('2026-09-25'), '', '3-Detaljkonstruktion, 4-Upphandling'],
];
function premiumSv() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Projektuppgifter');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(goals, { cellDates: true }), 'Projektmål');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'Testprojekt Alfa.xlsx', arrayBuffer: async () => buf };
}

test('Premium på svenska: start, slut, ID, beroenden och gater läses', async () => {
  const imp = await parseWorkbook(premiumSv());
  for (const c of ['id', 'start', 'end', 'depends', 'bucket']) assert.ok(imp.cols.includes(c), c);
  const t = imp.tasks.filter(x => !x.gate);
  assert.equal(t.length, 5);
  assert.deepEqual([t[0].start, t[0].end], ['2026-01-05', '2026-03-27']);
  assert.ok(t.every(x => x.start < x.end), 'inga endagsaktiviteter');
  assert.ok(t.every(x => x.positional));
  assert.deepEqual(t[4].deps, ['p_3', 'p_4']);
  assert.equal(t[0].progress, 100);
  const g = imp.tasks.filter(x => x.gate);
  assert.deepEqual(g.map(x => x.name), ['Gate G1', 'Gate G2']);
  assert.equal(g[0].goalStatus, 'done');
  assert.equal(g[1].goalStatus, 'notstarted');
});

test('"Slutfört arbete" tolkas aldrig som slutdatum', async () => {
  const noEnd = rows.map((r, i) => i === 3 ? r.map(h => h === 'Avslutas' ? 'Okänd kolumn' : h) : r);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(noEnd, { cellDates: true }), 'Projektuppgifter');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const imp = await parseWorkbook({ name: 'x.xlsx', arrayBuffer: async () => buf });
  assert.ok(!imp.cols.includes('end'));
});

test('checklistans "3/3" i kolumnen Slutfört blir aldrig ett datum', async () => {
  const chk = rows.map((r, i) => i === 4 ? r.map((v, j) => j === head.indexOf('Slutfört') ? '3/3' : v) : r);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(chk, { cellDates: true }), 'Projektuppgifter');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const imp = await parseWorkbook({ name: 'x.xlsx', arrayBuffer: async () => buf });
  assert.deepEqual([imp.tasks[0].start, imp.tasks[0].end], ['2026-01-05', '2026-03-27']);
});

test('uppdatering med annat exportformat: namn + fas matchas och varningar visas', async () => {
  const imp = await parseWorkbook(premiumSv());
  const plan = { tasks: imp.tasks.map(t => ({ ...t, notes: t.name === 'Förstudie' ? 'viktig anteckning' : '' })) };
  // Fel format: utan ID- och slutkolumn → namnbaserade ID och start = slut
  const bad = { ...imp, cols: imp.cols.filter(c => c !== 'id' && c !== 'end'),
    tasks: imp.tasks.filter(t => !t.gate).map(t => ({ ...t, id: `p_n:${t.bucket}|${t.name}`, plannerId: `n:${t.bucket}|${t.name}`, positional: false, end: t.start, deps: [] })) };
  const res = mergeImport(plan, bad);
  assert.equal(res.added, 0, 'aktiviteterna känns igen på namn + fas');
  assert.equal(res.tasks.find(t => t.name === 'Förstudie').notes, 'viktig anteckning');
  const w = mergeWarnings(plan.tasks, res, bad);
  assert.ok(w.some(x => /slutdatum/.test(x)));
  assert.ok(w.some(x => /5 av 5 aktiviteter blir endagsaktiviteter/.test(x)));
  assert.ok(w.some(x => /Gaterna från Planner \(2\)/.test(x)));
  // Rätt fil igen ger inga varningar
  assert.deepEqual(mergeWarnings(plan.tasks, mergeImport(plan, imp), imp), []);
});

test('NexusOrdo-export (#69) känns igen före Planner-formaten', async () => {
  const imp = await parseWorkbook(premiumSv());
  const wb = exportWorkbook(buildExport([{ id: 'a', name: 'Testprojekt Alfa', tasks: imp.tasks, settings: {} }], [], '2026-10-29T10:00:00Z'));
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const res = await parseWorkbook({ name: 'Testprojekt Alfa – NexusOrdo.xlsx', arrayBuffer: async () => buf });
  assert.ok(res.timeplan, 'tolkas som NexusOrdo-export, inte som Planner');
  assert.equal(res.timeplan.plans[0].tasks.length, imp.tasks.length);
});

// Vanlig Planner-export på svenska (flikar Konsoliderade data / Mål, kolumnen Avslutsdatum) – 2026-11-02
test('svensk Planner-export: målens Avslutsdatum och status läses, befintliga datum töms aldrig', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Abonnemangs-ID', 'Planens namn', 'Datum för export '], ['x', 'Testplan Beta', '2026-11-02']]), 'Plan');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Uppgifts-ID', 'Uppgiftens namn', 'Bucket', 'Mål', 'Status', 'Startdatum', 'Förfallodatum'],
    ['t1', 'Förstudie', 'Initiating', 'G1', 'Slutförd', '2026-01-05', '2026-03-27'],
    ['t2', 'Konstruktion', 'Planning', 'G2', 'Pågår', '2026-04-06', '2026-09-25'],
  ]), 'Konsoliderade data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Mål-ID', 'Målnamn', 'Status', 'Prioritet', 'Startdatum', 'Avslutsdatum', 'Anslutna uppgifter'],
    ['g1', 'G1', 'Stängd', '5', '', '2026-04-03', 'Förstudie'],
    ['g2', 'G2', 'På rätt spår', '5', '', '2026-10-02', 'Konstruktion'],
  ]), 'Mål');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const imp = await parseWorkbook({ name: 'x.xlsx', arrayBuffer: async () => buf });
  assert.equal(imp.planName, 'Testplan Beta');
  const g = imp.tasks.filter(t => t.gate);
  assert.deepEqual(g.map(t => [t.name, t.end, t.goalStatus]), [['Gate G1', '2026-04-03', 'done'], ['Gate G2', '2026-10-02', 'ontrack']]);
  // En fil utan måldatum tömmer inte gaternas datum
  const noDates = { ...imp, tasks: imp.tasks.map(t => t.gate ? { ...t, start: null, end: null } : t) };
  const res = mergeImport({ tasks: imp.tasks }, noDates);
  assert.deepEqual(res.tasks.filter(t => t.gate).map(t => t.end), ['2026-04-03', '2026-10-02']);
  assert.equal(res.report.keptDates.length, 2);
  assert.ok(mergeWarnings(imp.tasks, res, noDates).some(w => /2 gater saknar datum/.test(w)));
});
