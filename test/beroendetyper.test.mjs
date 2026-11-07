// Beroendetyper SS/FF/SF och fördröjning från Planner Premium (#83): tolkning av "26AS", "24SS+2 days" m.m. på svenska och engelska.
// Bara påhittade strängar och planer. Funktionerna läses direkt ur app/script.js. Kör: node --test "test/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s; let LANG = "sv";',
  pick(/const clamp = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const weekday = .*;/), pick(/const cpType = .*;/), pick(/const cpLag = .*;/),
  pick(/function easterDay\([\s\S]*?\n}\n/), pick(/function seHolidays\([\s\S]*?\n}\n/), pick(/const HOLIDAY_CACHE = .*;/), pick(/const seHolidaySet = .*;/),
  pick(/function calendarOf\([\s\S]*?\n}\n/), pick(/const isWorkday = .*;/),
  blk('/* ---------- Beroendetyper och fördröjning (#83)', '/* ---------- slut beroendetyper'),
].join('\n');
const F = new Function(code + '\nreturn { parseDepRef, parseDepCell, depLagFromPct, depInfoOf, fmtDepType, taskDepCheck, addWorkdays, calendarOf, toDay, setLang: l => LANG = l };')();
const R = (s, lang) => { const r = F.parseDepRef(s, lang); return r && { ...r }; };

test('svenska koder: AS → FS, SS, AA → FF, SA → SF', () => {
  assert.deepEqual(R('26AS', 'sv'), { num: '26', type: 'FS', lagDays: 0, lagPct: null });
  assert.equal(R('3SS', 'sv').type, 'SS');
  assert.equal(R('3AA', 'sv').type, 'FF');
  assert.equal(R('3SA', 'sv').type, 'SF');
  assert.equal(R('3as').type, 'FS', 'gemener går också');
});

test('engelska koder FS/SS/FF/SF och bara nummer = FS', () => {
  for (const t of ['FS', 'SS', 'FF', 'SF']) assert.equal(R('12' + t, 'en').type, t);
  assert.deepEqual(R('7'), { num: '7', type: 'FS', lagDays: 0, lagPct: null });
});

test('fördröjning: dagar, timmar ÷ 8, veckor × 5, minus, procent', () => {
  assert.equal(R('24SS+2 days', 'en').lagDays, 2);
  assert.equal(R('24FS-1 d', 'en').lagDays, -1);
  assert.equal(R('24FS+3 hrs', 'en').lagDays, 0.38);
  assert.equal(R('24FF+16 hrs', 'en').lagDays, 2);
  assert.equal(R('24FS+1 wk', 'en').lagDays, 5);
  assert.equal(R('24FS+1 mo', 'en').lagDays, 20);
  assert.equal(R('24FS+7 ed', 'en').lagDays, 5, 'kalenderdagar × 5/7');
  const p = R('24SF+10%', 'en'); assert.equal(p.lagPct, 10); assert.equal(p.lagDays, null);
  assert.equal(R('26AS+2 dagar', 'sv').lagDays, 2);
  assert.equal(R('26SS+1 vecka', 'sv').lagDays, 5);
  assert.equal(R('26AA−4 timmar', 'sv').lagDays, -0.5, 'typografiskt minus');
  assert.equal(R('26AS+1,5 d', 'sv').lagDays, 1.5, 'decimalkomma');
});

test('udda mellanrum', () => {
  assert.deepEqual(R('  27 SS + 2 days ', 'en'), { num: '27', type: 'SS', lagDays: 2, lagPct: null });
  assert.deepEqual(R('27SS +2d'), { num: '27', type: 'SS', lagDays: 2, lagPct: null });
  assert.deepEqual(R('27 AA\t-1 d.', 'sv'), { num: '27', type: 'FF', lagDays: -1, lagPct: null });
});

test('okända koder och enheter ger null', () => {
  assert.equal(R('27XY'), null);
  assert.equal(R('27FS+2 parsecs'), null);
  assert.equal(R('abc'), null);
  assert.equal(R(''), null);
});

test('parseDepCell: lista, dubbletter, okänt som slut–start, procent sparas för senare', () => {
  const c = F.parseDepCell('26AS, 23SS+2 d; 23FS, 9XY, 5FF+50%', 'sv');
  assert.deepEqual(c.deps, ['p_26', 'p_23', 'p_9', 'p_5']);
  assert.deepEqual({ ...c.info.p_23 }, { type: 'SS', lag: 2, src: 'planner' });
  assert.deepEqual({ ...c.info.p_9 }, { type: 'FS', lag: 0, src: 'planner' });
  assert.equal(c.pct.p_5, 50);
  assert.deepEqual(F.parseDepCell('', 'en').deps, []);
});

test('procent av föregångarens varaktighet i arbetsdagar (mån–fre)', () => {
  // 2–13 nov 2026 = 10 arbetsdagar
  assert.equal(F.depLagFromPct(10, { start: '2026-11-02', end: '2026-11-13' }), 1);
  assert.equal(F.depLagFromPct(50, { start: '2026-11-02', end: '2026-11-13' }), 5);
  assert.equal(F.depLagFromPct(50, {}), 0);
});

test('depInfoOf och fmtDepType', () => {
  const t = { deps: ['a', 'b'], depInfo: { a: { type: 'SS', lag: 2, src: 'planner' } } };
  assert.deepEqual({ ...F.depInfoOf(t, 'a') }, { type: 'SS', lag: 2, src: 'planner' });
  assert.deepEqual({ ...F.depInfoOf(t, 'b') }, { type: 'FS', lag: 0, src: '' });
  assert.equal(F.fmtDepType('SS', 2), 'SS +2 d');
  assert.equal(F.fmtDepType('FF', -1.5), 'FF −1,5 d');
  assert.equal(F.fmtDepType('FS', 0, true), '');
  F.setLang('en'); assert.equal(F.fmtDepType('FF', -1.5), 'FF −1.5 d'); F.setLang('sv');
});

// ---------- Import: påhittad Premium-liknande fil (svenska och engelska) ----------
import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('../app/vendor/xlsx.full.min.js');
const impCode = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s; const fmtShortY = x => x || "–"; const fmtDayY = n => String(n); const window = { XLSX }; let LANG = "sv";',
  pick(/const clamp = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const todayDay = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/const cpType = .*;/), blk('const PMI_PHASES', '\n];') + '\n];',
  blk('const COLMAP', 'function mergeImport('), blk('function mergeImport(', 'const fmtShortY'),
  pick(/const lc = .*;/), blk('const TP_SHEET', 'async function openPlanExport('), pick(/const TPL_FORMAT = .*;/),
].join('\n');
const I = new Function('XLSX', impCode + '\nreturn { parseWorkbook, mergeImport, buildExport, exportWorkbook };')(XLSX);
const dt = s => new Date(s + 'T09:00:00');
function premium(lang, depCells) {
  const sv = lang === 'sv';
  const head = sv ? ['Uppgiftsnummer', 'Namn', 'Start', 'Avslutas', 'Bucket', '% slutfört', 'Beroende av']
    : ['Task number', 'Name', 'Start', 'Finish', 'Bucket', '% complete', 'Depends on'];
  const rows = [[sv ? 'Namn på projekt' : 'Project name', 'Testplan Beta'], [], head,
    ['1', 'Testaktivitet A', dt('2026-11-02'), dt('2026-11-13'), 'Fas 1', 0, depCells[0]],
    ['2', 'Testaktivitet B', dt('2026-11-04'), dt('2026-11-20'), 'Fas 1', 0, depCells[1]],
    ['3', 'Testaktivitet C', dt('2026-11-09'), dt('2026-11-27'), 'Fas 2', 0, depCells[2]],
    ['4', 'Testaktivitet D', dt('2026-11-30'), dt('2026-12-04'), 'Fas 2', 0, depCells[3]]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), sv ? 'Projektuppgifter' : 'Project tasks');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'Testplan Beta.xlsx', arrayBuffer: async () => buf };
}
const plainInfo = t => Object.fromEntries(Object.entries(t.depInfo || {}).map(([k, v]) => [k, { ...v }]));

test('import sv: AS/SS/AA/SA med fördröjning blir t.deps + t.depInfo', async () => {
  const imp = await I.parseWorkbook(premium('sv', ['', '1SS+2 dagar', '1AA, 2SA-1 d', '3AS+10%, 9AS']));
  const [a, b, c, d] = imp.tasks;
  assert.deepEqual(a.deps, []); assert.equal(a.depInfo, undefined);
  assert.deepEqual(b.deps, ['p_1']); assert.deepEqual(plainInfo(b), { p_1: { type: 'SS', lag: 2, src: 'planner' } });
  assert.deepEqual(plainInfo(c), { p_1: { type: 'FF', lag: 0, src: 'planner' }, p_2: { type: 'SF', lag: -1, src: 'planner' } });
  // 10 % av C (9–27 nov = 15 arbetsdagar) = 1,5; 9 finns inte i filen och tas bort
  assert.deepEqual(d.deps, ['p_3']); assert.deepEqual(plainInfo(d), { p_3: { type: 'FS', lag: 1.5, src: 'planner' } });
  assert.ok(imp.tasks.every(t => !('_depPct' in t)));
});

test('import en: FS/SS/FF/SF med timmar och veckor', async () => {
  const imp = await I.parseWorkbook(premium('en', ['', '1SS+3 hrs', '1FF+1 wk', '3FS']));
  assert.deepEqual(plainInfo(imp.tasks[1]), { p_1: { type: 'SS', lag: 0.38, src: 'planner' } });
  assert.deepEqual(plainInfo(imp.tasks[2]), { p_1: { type: 'FF', lag: 5, src: 'planner' } });
  assert.deepEqual(plainInfo(imp.tasks[3]), { p_3: { type: 'FS', lag: 0, src: 'planner' } });
});

test('mergeImport: typ och fördröjning översätts till bestående id, NexusOrdos egna behålls och ändrad typ listas', async () => {
  const first = await I.parseWorkbook(premium('sv', ['', '1AS', '', '3AS']));
  // Planen som den ligger i NexusOrdo: bestående id, plus ett eget beroende D → A (SS +1, NexusOrdos)
  const idOf = { p_1: 'x1', p_2: 'x2', p_3: 'x3', p_4: 'x4' };
  const tasks = first.tasks.map(t => ({ ...t, id: idOf[t.id], deps: t.deps.map(d => idOf[d]),
    ...(t.depInfo ? { depInfo: Object.fromEntries(Object.entries(t.depInfo).map(([k, v]) => [idOf[k], { ...v }])) } : {}) }));
  tasks[3].deps.push('x1'); tasks[3].depInfo.x1 = { type: 'SS', lag: 1 };
  // Ny export: B blir SS +2, C får FF från A, D:s beroende på C får +1 vecka
  const next = await I.parseWorkbook(premium('en', ['', '1SS+2 days', '1FF', '3FS+1 wk']));
  const res = I.mergeImport({ tasks }, next);
  const by = Object.fromEntries(res.tasks.map(t => [t.name, t]));
  assert.deepEqual(by['Testaktivitet B'].deps, ['x1']);
  assert.deepEqual({ ...by['Testaktivitet B'].depInfo.x1 }, { type: 'SS', lag: 2, src: 'planner' });
  assert.deepEqual({ ...by['Testaktivitet C'].depInfo.x1 }, { type: 'FF', lag: 0, src: 'planner' });
  assert.deepEqual(by['Testaktivitet D'].deps.sort(), ['x1', 'x3']);
  assert.deepEqual({ ...by['Testaktivitet D'].depInfo.x1 }, { type: 'SS', lag: 1 }, 'NexusOrdos eget beroende rörs inte');
  assert.deepEqual({ ...by['Testaktivitet D'].depInfo.x3 }, { type: 'FS', lag: 5, src: 'planner' });
  const what = n => (res.report.changed.find(c => c.name === n) || { what: [] }).what.join(' | ');
  assert.match(what('Testaktivitet B'), /beroende ”Testaktivitet A” FS → SS \+2 d/);
  assert.match(what('Testaktivitet D'), /beroende ”Testaktivitet C” FS → FS \+5 d/);
  assert.doesNotMatch(what('Testaktivitet C'), /beroende/, 'nytt beroende är ingen ändrad typ');
});

test('mergeImport: ny plan utan tidigare aktiviteter får depInfo på de nya id:na', async () => {
  const imp = await I.parseWorkbook(premium('sv', ['', '1SS', '', '']));
  const res = I.mergeImport({ tasks: [] }, imp);
  const b = res.tasks.find(t => t.name === 'Testaktivitet B');
  assert.deepEqual(Object.keys(b.depInfo), b.deps);
  assert.equal(b.depInfo[b.deps[0]].type, 'SS');
  assert.ok(res.tasks.filter(t => !t.deps.length).every(t => !t.depInfo));
});

test('taskDepCheck: röd pil bara när typen bryts (SS är inte röd för att efterföljaren startar före föregångarens slut)', () => {
  const cal = F.calendarOf({}), T = (start, end, x = {}) => ({ start, end, ...x });
  const pred = T('2026-11-02', '2026-11-13');                     // mån v45 – fre v46
  const succ = T('2026-11-04', '2026-11-20');                     // startar före pred:s slut
  assert.equal(F.taskDepCheck(pred, succ, null, cal).bad, true, 'FS (utan info) röd som förut');
  assert.equal(F.taskDepCheck(pred, succ, { type: 'SS' }, cal).bad, false, 'SS ok');
  assert.equal(F.taskDepCheck(pred, succ, { type: 'SS', lag: 2 }, cal).bad, false, 'SS +2: ons = mån + 2 arbetsdagar');
  assert.equal(F.taskDepCheck(pred, succ, { type: 'SS', lag: 3 }, cal).bad, true, 'SS +3: tidigast tor');
  assert.equal(F.taskDepCheck(pred, succ, { type: 'FF' }, cal).bad, false, 'FF: slutar efter');
  assert.equal(F.taskDepCheck(pred, T('2026-11-03', '2026-11-12'), { type: 'FF' }, cal).bad, true, 'FF: slutar före');
  assert.equal(F.taskDepCheck(pred, T('2026-10-20', '2026-11-02'), { type: 'SF' }, cal).bad, false, 'SF: slut samma dag som start');
  assert.equal(F.taskDepCheck(pred, T('2026-10-20', '2026-10-30'), { type: 'SF' }, cal).bad, true);
  // FS med fördröjning: fre + 2 arbetsdagar = tis → tidigast ons
  assert.equal(F.taskDepCheck(pred, T('2026-11-17', '2026-11-20'), { type: 'FS', lag: 2 }, cal).bad, true);
  assert.equal(F.taskDepCheck(pred, T('2026-11-18', '2026-11-20'), { type: 'FS', lag: 2 }, cal).bad, false);
  assert.equal(F.taskDepCheck(pred, T('2026-11-16', '2026-11-20'), { type: 'FS' }, cal).bad, false, 'fre → mån ok');
  assert.equal(F.taskDepCheck(pred, T('2026-11-13', '2026-11-13', { milestone: true }), { type: 'FS' }, cal).bad, false, 'milstolpe samma dag ok');
  assert.equal(F.taskDepCheck(pred, T('2026-11-16', '2026-11-20'), { type: 'FS', lag: -1 }, cal).bad, false, 'negativ fördröjning');
  assert.equal(F.taskDepCheck(pred, T('2026-11-12', '2026-11-20'), { type: 'FS', lag: -1 }, cal).bad, true, 'tor ≤ tor');
  assert.equal(F.taskDepCheck(pred, {}, null, cal), null, 'utan datum');
});

test('addWorkdays hoppar över helger och svenska helgdagar', () => {
  const cal = F.calendarOf({}), D = F.toDay;
  assert.equal(F.addWorkdays(D('2026-12-23'), 1, cal), D('2026-12-28'));
  assert.equal(F.addWorkdays(D('2026-11-16'), -1, cal), D('2026-11-13'));
  assert.equal(F.addWorkdays(D('2026-11-16'), 0, cal), D('2026-11-16'));
});

test('export/import (#69): typ och fördröjning följer med, ogiltiga värden rensas, läsbar kolumn visar typen', async () => {
  const tasks = [
    { id: 'a', name: 'Testaktivitet A', start: '2026-11-02', end: '2026-11-13', deps: [] },
    { id: 'b', name: 'Testaktivitet B', start: '2026-11-04', end: '2026-11-20', deps: ['a'], depInfo: { a: { type: 'SS', lag: 2, src: 'planner' }, zz: { type: 'FF' } } },
    { id: 'c', name: 'Testaktivitet C', start: '2026-11-23', end: '2026-11-27', deps: ['b', 'a'], depInfo: { b: { type: 'XX', lag: 'abc', src: 'hack' }, a: { type: 'SF', lag: -1 } } },
  ];
  const wb = I.exportWorkbook(I.buildExport([{ id: 'p1', name: 'Testplan Beta', tasks, settings: {} }], [], '2026-11-02T10:00:00Z'));
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const res = await I.parseWorkbook({ name: 'x.xlsx', arrayBuffer: async () => buf });
  const back = Object.fromEntries(res.timeplan.plans[0].tasks.map(t => [t.id, t]));
  assert.deepEqual(plainInfo(back.b), { a: { type: 'SS', lag: 2, src: 'planner' } });
  assert.deepEqual(plainInfo(back.c), { b: { type: 'FS', lag: 0 }, a: { type: 'SF', lag: -1 } });
  const sheet = wb.SheetNames.find(n => !/timeplan-data/i.test(n));
  const txt = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 }));
  assert.match(txt, /Testaktivitet A \(SS \+2 d\)/);
});
