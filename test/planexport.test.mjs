// Export och import av planer (#69): rundresa export → import, att koder rensas och att felaktiga filer avvisas.
// Testdata är påhittad. Funktionerna läses direkt ur app/script.js.
// Kör: node --test "test/*.test.mjs"
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
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const dObj = .*;/), pick(/const weekday = .*;/),
  pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/), pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/const lc = .*;/),
  pick(/const PALETTE_IDS = .*;/), pick(/const isHexColor = .*;/), pick(/function cleanPhaseColors\([\s\S]*?\n}\n/),
  blk('const TP_SHEET', 'async function openPlanExport('), blk('/* ---------- Baslinjer (#5)', '/* ---------- slut baslinjer'),
].join('\n');
const F = new Function('XLSX', code + '\nreturn { TP_SHEET, buildExport, exportWorkbook, readExport, prepareImport, remapProgram, tpChunks };')(XLSX);

const CODES = ['K7XQM3PA9TRD', 'ZZTOPSECRET1', 'PGVIEWCODE22', 'PGOWNERCODE3'];
const alfa = {
  id: 'p1', name: 'Testprojekt Alfa', imported_at: '2026-10-01T08:00:00Z',
  tasks: [
    { id: 't1', name: 'Förstudie', bucket: 'FEASIBILITY STUDY', start: '2026-01-05', end: '2026-03-27', progress: 100, deps: [], notes: 'anteckning 😀',
      links: [{ id: 'l1', url: 'https://contoso.sharepoint.com/:w:/r/x.docx', title: 'Spec' }] },
    { id: 't2', name: 'Gate DG', bucket: 'FEASIBILITY STUDY', start: '2026-05-29', end: '2026-05-29', milestone: true, gate: true, deps: ['t1'],
      actual: { day: '2026-05-29', week: '2622', src: 'manual', at: '2026-05-29T10:00:00Z' } },
    { id: 't3', name: 'Detaljkonstruktion', bucket: 'DEVELOPMENT', start: '2026-06-01', end: '2026-09-25', progress: 30, deps: ['t2'], imp: { start: '2026-06-01', end: '2026-09-18' } },
  ],
  settings: {
    owner: 'test.person@example.com', sharedWith: ['annan@example.com'], viewCode: CODES[0], ownerCode: CODES[1],
    bucketOrder: ['FEASIBILITY STUDY', 'DEVELOPMENT'], people: [{ name: 'Test Person', email: 'test.person@example.com' }],
    risks: [{ id: 'r1', no: 1, desc: 'Leveransrisk', p: 3, c: 4, owner: 'Test Person', status: 'Y', ready: '2645' }],
    status: [{ week: '2644', dims: { time: 'Y', fin: 'G' }, comment: 'OK', actions: [{ text: 'Följ upp', state: 'ongoing', owner: 'Test Person' }] }],
    snapshots: [{ at: '2026-10-01', src: 'import', ms: { t2: '2026-05-29' } }],
    project: { ba: 'Test BA', pcode: 'P-0001', l1: 'Alfa', role: 'main' },
    gateChecks: { D: { 1: { s: 0, c: 'klar', at: '2026-05-01' } } },
  },
};
const beta = { id: 'p2', name: 'Testprojekt Beta', tasks: [{ id: 'b1', name: 'Steg 1', bucket: 'Övrigt', start: '2026-02-02', end: '2026-02-27', deps: [] }],
  settings: { viewCode: 'BETAVIEW0001', ownerCode: 'BETAOWNER001' } };
const prog = { id: 'g1', name: 'Testprogram', plans: [{ planId: 'p1', addedAt: '2026-10-01', addedBy: 'x@example.com' }, { planId: 'p2' }, { planId: 'saknas' }],
  dependencies: [{ id: 'd1', from: { planId: 'p1', taskId: 't3', name: 'Detaljkonstruktion' }, to: { planId: 'p2', taskId: 'b1', name: 'Steg 1' }, type: 'FS', lag: 0 }],
  milestones: [], requests: [], settings: { owner: 'x@example.com', viewCode: CODES[2], ownerCode: CODES[3] } };

const roundtrip = (pls, progs = []) => {
  const wb = F.exportWorkbook(F.buildExport(pls, progs, '2026-10-29T10:00:00.000Z'));
  return XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
};
const strip = s => { const o = { ...s }; for (const k of ['owner', 'sharedWith', 'viewCode', 'ownerCode']) delete o[k]; return o; };

test('rundresa: planen kommer tillbaka oförändrad utom koder, ägare och delning', () => {
  const data = F.readExport(roundtrip([alfa]));
  assert.equal(data.exportedAt, '2026-10-29T10:00:00.000Z');
  assert.equal(data.plans.length, 1);
  const p = data.plans[0];
  assert.equal(p.name, alfa.name);
  assert.equal(p.imported_at, alfa.imported_at);
  assert.deepEqual(p.tasks, alfa.tasks);
  assert.deepEqual(p.settings, strip(alfa.settings));
  assert.equal(p.settings.risks[0].owner, 'Test Person', 'riskens ansvarig ska inte tas bort');
});

test('inga koder, ägare eller delning finns någonstans i filen', () => {
  const wb = roundtrip([alfa, beta], [prog]);
  const all = wb.SheetNames.map(n => JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }))).join('\n');
  for (const c of [...CODES, 'BETAVIEW0001', 'BETAOWNER001']) assert.ok(!all.includes(c), `koden ${c} finns i exporten`);
  assert.ok(!all.includes('annan@example.com'));
  assert.ok(!/viewCode|ownerCode|sharedWith/.test(all));
});

test('läsbara flikar och en dold TimePlan-data', () => {
  const one = roundtrip([alfa]);
  assert.deepEqual(one.SheetNames, ['Aktiviteter', 'Risker', 'Veckostatus', 'Projektuppgifter', F.TP_SHEET]);
  const hidden = one.Workbook.Sheets.find(s => s.name === F.TP_SHEET);
  assert.ok(hidden.Hidden, 'TimePlan-data ska vara dold');
  const rows = XLSX.utils.sheet_to_json(one.Sheets.Aktiviteter, { header: 1 });
  const head = rows.findIndex(r => r[0] === 'Fas');
  assert.deepEqual(rows[head + 1].slice(0, 6), ['FEASIBILITY STUDY', 'Förstudie', '2026-01-05', '2026-03-27', '2602', '2613']);
  assert.equal(rows[head + 3][8], 'Gate DG', 'beroenden visas med namn');
  const many = roundtrip([alfa, beta], [prog]);
  assert.deepEqual(many.SheetNames, ['Planer', 'Testprojekt Alfa', 'Testprojekt Beta', F.TP_SHEET]);
});

test('stora planer delas i bitar under Excels cellgräns, även mitt i en emoji', () => {
  const s = 'a'.repeat(29999) + '😀' + 'b'.repeat(70000);
  const parts = F.tpChunks(s);
  assert.equal(parts.join(''), s);
  assert.ok(parts.every(x => x.length <= 30000));
  assert.ok(parts.every(x => !/[\uD800-\uDBFF]$/.test(x)), 'inget surrogatpar delas');
  const big = { ...alfa, tasks: Array.from({ length: 800 }, (_, i) => ({ id: 'x' + i, name: `Aktivitet ${i} 😀 med ett lite längre namn`, bucket: 'DEVELOPMENT', start: '2026-06-01', end: '2026-06-05', deps: [], notes: 'n'.repeat(40) })) };
  const data = F.readExport(roundtrip([big]));
  assert.deepEqual(data.plans[0].tasks, big.tasks);
});

test('program följer med och pekar om till de nya planerna', () => {
  const data = F.readExport(roundtrip([alfa, beta], [prog]));
  const pr = data.programs[0];
  assert.deepEqual(pr.plans.map(r => r.planId), ['p1', 'p2'], 'planer som inte exporterades tas bort');
  assert.ok(!('addedBy' in pr.plans[0]));
  assert.deepEqual(pr.settings, {});
  const prep = F.prepareImport(data, [], [], ' (importerad 2026-10-29)');
  const m = F.remapProgram(prep.programs[0], { p1: 'new1', p2: 'new2' });
  assert.deepEqual(m.plans.map(r => r.planId), ['new1', 'new2']);
  assert.equal(m.dependencies[0].from.planId, 'new1');
  assert.equal(m.dependencies[0].to.planId, 'new2');
  assert.equal(m.dependencies[0].from.taskId, 't3');
});

test('samma namn som en befintlig plan får tillägget (importerad datum)', () => {
  const data = F.readExport(roundtrip([alfa, beta], [prog]));
  const prep = F.prepareImport(data, ['testprojekt alfa', 'Annan plan'], ['TESTPROGRAM'], ' (importerad 2026-10-29)');
  assert.deepEqual(prep.plans.map(p => [p.name, p.renamed]), [['Testprojekt Alfa (importerad 2026-10-29)', true], ['Testprojekt Beta', false]]);
  assert.equal(prep.programs[0].name, 'Testprogram (importerad 2026-10-29)');
  assert.equal(prep.plans[0].oldId, 'p1');
});

// Bygger en fil med en egen TimePlan-data-flik
const withData = text => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['rubrik'], ...F.tpChunks(text).map(c => [c])]), F.TP_SHEET);
  return XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
};
const valid = () => F.buildExport([alfa], [], '2026-10-29T10:00:00.000Z');

test('felaktig eller manipulerad fil ger ett begripligt fel', () => {
  assert.throws(() => F.readExport(withData('{inte json')), /skadad/);
  assert.throws(() => F.readExport(withData(JSON.stringify({ ...valid(), format: 'annat' }))), /skadad/);
  assert.throws(() => F.readExport(withData(JSON.stringify({ ...valid(), version: 2 }))), /nyare version/);
  assert.throws(() => F.readExport(withData(JSON.stringify({ ...valid(), plans: [] }))), /inga planer/);
  const d1 = valid(); d1.plans[0].tasks[0].start = 'igår'; assert.throws(() => F.readExport(withData(JSON.stringify(d1))), /skadad/);
  const d2 = valid(); d2.plans[0].name = ''; assert.throws(() => F.readExport(withData(JSON.stringify(d2))), /skadad/);
  const d3 = valid(); d3.plans[0].tasks = 'x'; assert.throws(() => F.readExport(withData(JSON.stringify(d3))), /skadad/);
  const d4 = valid(); d4.plans.push({ ...d4.plans[0] }); assert.throws(() => F.readExport(withData(JSON.stringify(d4))), /skadad/);
  // Avklippt fil (en bit saknas)
  const parts = F.tpChunks(JSON.stringify(F.buildExport([{ ...alfa, tasks: Array.from({ length: 600 }, (_, i) => ({ id: 'x' + i, name: 'n'.repeat(80), deps: [] })) }])));
  assert.ok(parts.length > 1);
  assert.throws(() => F.readExport(withData(parts.slice(0, -1).join(''))), /skadad/);
});

test('manipulerad fil: inskrivna koder och farliga länkar rensas', () => {
  const d = valid();
  d.plans[0].settings.ownerCode = 'INJECTED0001'; d.plans[0].settings.owner = 'angripare@example.com';
  d.plans[0].tasks[0].links.push({ id: 'l2', url: 'javascript:alert(1)', title: 'x' }, { id: 'l3', url: 'data:text/html,x', title: 'y' });
  d.plans[0].tasks[1].viewCode = 'INJECTED0002';
  d.plans[0].tasks[1].deps = 'inte en lista';
  const p = F.readExport(withData(JSON.stringify(d))).plans[0];
  assert.ok(!('ownerCode' in p.settings) && !('owner' in p.settings));
  assert.ok(!('viewCode' in p.tasks[1]));
  assert.deepEqual(p.tasks[0].links.map(l => l.id), ['l1']);
  assert.deepEqual(p.tasks[1].deps, []);
});

test('baslinjer (#5) följer med i rundresan, skräp rensas', () => {
  const bl = { id: 'bl1', name: 'Inför gate 1', at: '2026-10-01T08:00:00Z', tasks: { t1: { s: '2026-01-05', e: '2026-02-27' } } };
  const p = { id: 'p9', name: 'Baslinjeplan', imported_at: null, tasks: [{ id: 't1', name: 'A', start: '2026-01-12', end: '2026-03-06' }],
    settings: { baselines: [bl, { id: 'x', tasks: { t1: { s: 'fel', e: 'fel' } }, viewCode: 'K7XQM3PA9TRD' }, 'skräp'] } };
  const wb = F.exportWorkbook(F.buildExport([p], [], '2026-10-29T12:00:00Z'));
  const back = F.readExport(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' }));
  assert.deepEqual(back.plans[0].settings.baselines, [bl, { id: 'x', name: 'Baslinje', at: '', tasks: {} }]);
});
