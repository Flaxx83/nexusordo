// Varning när en ny import eller uppdatering bryter beroenden mellan projekt i ett program (#22).
// Testdata är påhittad: två fiktiva planer (Projekt Alfa och Projekt Beta) som byggs här.
// Funktionerna läses direkt ur app/script.js. Kör: node --test test/*.test.mjs
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
  'let LANG = "sv"; const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s; const fmtShortY = x => x || "–"; const fmtDayY = n => String(n); const window = { XLSX };',
  pick(/const clamp = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const todayDay = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), blk('const PMI_PHASES', '\n];') + '\n];',
  blk('const COLMAP', 'function mergeImport('), blk('function mergeImport(', 'const fmtShortY'), pick(/const lc = .*;/),
  blk('const TP_SHEET', 'async function openPlanExport('), pick(/const TPL_FORMAT = .*;/),
  pick(/const DEP_ORDER = .*;/), pick(/function depStatus\([\s\S]*?\n}\n/), pick(/function refTask\([\s\S]*?\n}\n/),
  blk('const DEP_BAD', '// Vem som har sett notisen'),
].join('\n');
const F = new Function('XLSX', code + '\nreturn { parseWorkbook, mergeImport, depStatus, depImpact, fmtDW, addDepAlerts, unseenAlerts, changedDeps, markAlertsSeen, toDay, DEP_ALERT_MAX };')(XLSX);

const idag = F.toDay('2026-10-22');
const T = (id, name, start, end, extra = {}) => ({ id, name, start, end, bucket: 'Development', progress: 0, ...extra });

// ---------- Ren funktion depImpact ----------
const alfa = { id: 'alfa', name: 'Projekt Alfa (fiktivt)', tasks: [T('f6', 'Placering av ugnar fastställd', '2026-08-31', '2026-11-13')] };
const beta = { id: 'beta', name: 'Projekt Beta (fiktivt)', tasks: [T('h52', 'Genomförda simuleringar', '2026-12-07', '2027-03-26')] };
const dep = (id, from, to, extra = {}) => ({ id, from: { planId: from[0].id, taskId: from[1] }, to: { planId: to[0].id, taskId: to[1] }, type: 'FS', lag: 0, ...extra });
const prog = { id: 'pg1', name: 'Program X (fiktivt)', plans: [{ planId: 'alfa' }, { planId: 'beta' }], dependencies: [dep('d1', [alfa, 'f6'], [beta, 'h52'])], settings: {} };
const byId = new Map([alfa, beta].map(p => [p.id, p]));
const move = (pl, id, start, end) => pl.tasks.map(t => t.id === id ? { ...t, start, end } : t);

test('föregångaren flyttas så att beroendet blir blockerat: marginal före och efter och antal dagar', () => {
  const r = F.depImpact([prog], byId, 'alfa', move(alfa, 'f6', '2026-08-31', '2026-12-18'), idag);
  assert.equal(r.length, 1);
  const x = r[0];
  assert.equal(x.programId, 'pg1'); assert.equal(x.depId, 'd1'); assert.equal(x.mine, 'from');
  assert.deepEqual(x.before, { status: 'ok', margin: 23 });
  assert.deepEqual(x.after, { status: 'blockerad', margin: -12 });
  assert.equal(x.deltaDays, -35);
  assert.equal(x.to.plan, 'Projekt Beta (fiktivt)'); assert.equal(x.to.task, 'Genomförda simuleringar');
  assert.equal(x.from.task, 'Placering av ugnar fastställd');
  assert.equal(x.type, 'FS'); assert.equal(x.lag, 0);
});

test('efterföljaren flyttas närmare: risk (under en veckas marginal)', () => {
  const r = F.depImpact([prog], byId, 'beta', move(beta, 'h52', '2026-11-18', '2027-03-26'), idag);
  assert.equal(r.length, 1);
  assert.equal(r[0].mine, 'to');
  assert.deepEqual(r[0].after, { status: 'risk', margin: 4 });
  assert.equal(r[0].deltaDays, -19);
});

test('redan blockerat och värre tas med; bättre, oförändrat eller fortfarande ok tas inte med', () => {
  const blocked = { ...prog, dependencies: [dep('d1', [alfa, 'f6'], [beta, 'h52'])] };
  const late = { ...alfa, tasks: move(alfa, 'f6', '2026-08-31', '2026-12-18') };
  const m = new Map([[late.id, late], [beta.id, beta]]);
  const worse = F.depImpact([blocked], m, 'alfa', move(late, 'f6', '2026-08-31', '2027-01-08'), idag);
  assert.equal(worse.length, 1); assert.equal(worse[0].before.status, 'blockerad'); assert.equal(worse[0].deltaDays, -21);
  assert.equal(F.depImpact([blocked], m, 'alfa', move(late, 'f6', '2026-08-31', '2026-12-11'), idag).length, 0, 'bättre');
  assert.equal(F.depImpact([prog], byId, 'alfa', alfa.tasks, idag).length, 0, 'oförändrat');
  assert.equal(F.depImpact([prog], byId, 'alfa', move(alfa, 'f6', '2026-08-31', '2026-11-20'), idag).length, 0, 'mindre marginal men fortfarande ok');
});

test('aktivitet som tas bort ger saknas; typ och fördröjning räknas', () => {
  const r = F.depImpact([prog], byId, 'alfa', [], idag);
  assert.equal(r.length, 1); assert.equal(r[0].after.status, 'saknas'); assert.equal(r[0].deltaDays, null);
  const ss = { ...prog, dependencies: [dep('d2', [alfa, 'f6'], [beta, 'h52'], { type: 'SS', lag: 90 })] };
  const x = F.depImpact([ss], byId, 'alfa', move(alfa, 'f6', '2026-09-14', '2026-11-13'), idag)[0];
  assert.equal(x.type, 'SS'); assert.equal(x.lag, 90);
  assert.deepEqual([x.before.margin, x.after.margin], [8, -6]);
});

test('alla program som planen ingår i; borttagna program och andra planers beroenden hoppas över', () => {
  const other = { id: 'pg2', name: 'Annat program (fiktivt)', dependencies: [dep('d9', [alfa, 'f6'], [beta, 'h52'])], settings: {} };
  const trashed = { id: 'pg3', name: 'Borttaget', dependencies: [dep('d8', [alfa, 'f6'], [beta, 'h52'])], settings: { deleted_at: '2026-10-01' } };
  const r = F.depImpact([prog, other, trashed], byId, 'alfa', move(alfa, 'f6', '2026-08-31', '2026-12-18'), idag);
  assert.deepEqual(r.map(x => x.programId).sort(), ['pg1', 'pg2']);
  assert.equal(F.depImpact([prog], byId, 'okänd', [], idag).length, 0);
});

test('marginal i dagar och veckor', () => {
  assert.equal(F.fmtDW(-12), '−12 d (−1,7 v)');
  assert.equal(F.fmtDW(23), '+23 d (+3,3 v)');
  assert.equal(F.fmtDW(0), '0 d (0 v)');
  assert.equal(F.fmtDW(null), '–');
});

// ---------- Notiser i programmet (settings.depAlerts) ----------
test('notisen sparas i programmet, högst 50, och Markera som sett gäller per läsare', () => {
  const pg = { ...prog, settings: { depAlerts: [] } };
  const impact = F.depImpact([pg], byId, 'alfa', move(alfa, 'f6', '2026-08-31', '2026-12-18'), idag);
  const touched = F.addDepAlerts([pg], impact, alfa, '2026-10-30T10:00:00Z');
  assert.deepEqual(touched, [pg]);
  const a = pg.settings.depAlerts[0];
  assert.deepEqual(Object.keys(a).sort(), ['at', 'items', 'planId', 'planName', 'seenBy']);
  assert.equal(a.planName, 'Projekt Alfa (fiktivt)'); assert.deepEqual(a.seenBy, []);
  assert.equal(a.items[0].depId, 'd1'); assert.ok(!('programId' in a.items[0]));
  assert.equal(F.changedDeps(pg, 'u:a').get('d1').deltaDays, -35);
  assert.equal(F.markAlertsSeen(pg, 'u:a'), 1);
  assert.equal(F.changedDeps(pg, 'u:a').size, 0);
  assert.equal(F.changedDeps(pg, 'u:b').size, 1, 'en annan läsare ser den fortfarande');
  for (let i = 0; i < 60; i++) F.addDepAlerts([pg], impact, alfa, `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`);
  assert.equal(pg.settings.depAlerts.length, F.DEP_ALERT_MAX);
  assert.equal(F.addDepAlerts([{ id: 'pgX', settings: {} }], impact, alfa).length, 0, 'program utan påverkade beroenden får ingen notis');
});

// ---------- Acceptanskriteriet: Alfas ugnsplacering flyttas fram så att Beta påverkas ----------
// Påhittad Planner-export (engelska) som byggs här
const femsFile = (endPlacering = '2026-11-13') => {
  const d = s => new Date(s + 'T09:00:00Z');
  const rows = [['Project name', 'Projekt Alfa (fiktiv testplan)'], [], ['Task number', 'Name', 'Start', 'Finish', 'Bucket', '% complete'],
    ['1', 'Förstudie klar', d('2026-06-01'), d('2026-08-28'), 'Planning', 100],
    ['2', 'Placering av ugnar fastställd', d('2026-08-31'), d(endPlacering), 'Executing', 20],
    ['3', 'Upphandling ugnar', d('2026-11-16'), d('2027-02-26'), 'Executing', 0]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Project tasks');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'Projekt Alfa (fiktiv testplan).xlsx', arrayBuffer: async () => buf };
};

test('acceptans: Projekt Alfa flyttar Placering av ugnar fastställd → varning med antal dagar för Projekt Beta', async () => {
  const imp0 = await F.parseWorkbook(femsFile());
  const femsPlan = { id: 'femsF', name: imp0.planName, tasks: F.mergeImport({ tasks: [] }, imp0).tasks, settings: {} };
  const ugn = femsPlan.tasks.find(t => t.name === 'Placering av ugnar fastställd');
  assert.equal(ugn.end, '2026-11-13');
  const h2like = { id: 'h2F', name: 'Projekt Beta (fiktivt)', tasks: [T('sim', 'Genomförda simuleringar', '2026-12-07', '2027-03-26')], settings: {} };
  const prog = { id: 'spaceF', name: 'Program X (fiktivt testprogram)', plans: [{ planId: 'femsF' }, { planId: 'h2F' }], settings: {},
    dependencies: [{ id: 'ugn-sim', from: { planId: 'femsF', taskId: ugn.id, plannerId: ugn.plannerId, positional: ugn.positional, name: ugn.name, bucket: ugn.bucket },
      to: { planId: 'h2F', taskId: 'sim', name: 'Genomförda simuleringar', bucket: 'Development' }, type: 'FS', lag: 0 }] };
  const plans = new Map([[femsPlan.id, femsPlan], [h2like.id, h2like]]);
  // Ny export där ugnsplaceringen blir klar 2027-01-15 i stället för 2026-11-13
  const imp1 = await F.parseWorkbook(femsFile('2027-01-15'));
  const res = F.mergeImport(femsPlan, imp1);
  assert.equal(res.tasks.find(t => t.id === ugn.id).end, '2027-01-15');
  const r = F.depImpact([prog], plans, 'femsF', res.tasks, idag);
  assert.equal(r.length, 1);
  assert.equal(r[0].to.plan, 'Projekt Beta (fiktivt)');
  assert.equal(r[0].after.status, 'blockerad');
  assert.equal(r[0].before.margin, 23); assert.equal(r[0].after.margin, -40); assert.equal(r[0].deltaDays, -63);
  assert.equal(F.fmtDW(r[0].deltaDays), '−63 d (−9 v)');
});

test('notisen skrivs i alla program som påverkas', () => {
  const a = { ...prog, id: 'pgA', name: 'Program A (fiktivt)', settings: {} }, b = { ...prog, id: 'pgB', name: 'Program B (fiktivt)', settings: {} };
  const impact = F.depImpact([a, b], byId, 'alfa', move(alfa, 'f6', '2026-08-31', '2026-12-18'), idag);
  assert.equal(impact.length, 2);
  assert.equal(F.addDepAlerts([a, b], impact, alfa, '2026-10-30T10:00:00Z').length, 2);
  assert.ok([a, b].every(pg => pg.settings.depAlerts.length === 1));
});
