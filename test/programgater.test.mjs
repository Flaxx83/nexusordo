// Tester för programgater och gate-översikten (#21): cleanProgramGates, gateMatrix (projekt × gater med avvikelse mot programgaten),
// lägeslogiken (gateCellState), filtret Bara avvikelser, påverkade beroenden (#22) och Excel-tabellen.
// Bara påhittade planer med PMI-gater (G1–G4, plus en egen G5).
// Kör: node --test "test/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/), pick(/const dObj = .*;/),
  pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/), pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/),
  pick(/function parseWeek\([\s\S]*?\n}\n/), pick(/const normName = .*;/),
  pick(/const wkDiff = .*;/), pick(/const planProject = .*;/),
  pick(/const ST_RANK = .*;/), pick(/const worstOf = .*;/), pick(/const statusOverall = .*;/),
  pick(/const GOAL_STATUS_TXT = .*;/), pick(/const PMI_GATE_RE = .*;/), pick(/const isGateMs = .*;/),
  blk('const GEN_PRE = ', '// Bara giltiga punkter för gater som finns'),
  pick(/function planGates\([\s\S]*?\n}\n/), pick(/function taskGate\([\s\S]*?\n}\n/), pick(/function gateMsOf\([\s\S]*?\n}\n/),
  blk('const datedGates = ', '\n/* ====='),
  blk('const PG_STATUS = ', '/* ---------- Sample plan'),
].join('\n');
const F = new Function(code + '\nreturn { gateImpact, cleanProgramGates, gateMatrix, gateCellState, gateRowsShown, gateMatrixAoa, fmtDevW, planGateMap, gateSource, toDay, fromDay, parseWeek };')();
const { gateImpact, cleanProgramGates, gateMatrix, gateCellState, gateRowsShown, gateMatrixAoa, fmtDevW, planGateMap, gateSource, toDay, fromDay, parseWeek } = F;

const fri = yyww => fromDay(parseWeek(yyww, true));
const TODAY = toDay('2026-10-30');
const ms = (id, name, yyww, extra = {}) => ({ id, name, milestone: true, gate: true, start: fri(yyww), end: fri(yyww), progress: 0, ...extra });
const P = (id, name, project, tasks = []) => ({ id, name, settings: { project }, tasks });
// Påhittat program: Projekt Alfa (fiktivt) huvudplan + två delprojekt + stödprojekt, och en fristående plan.
// PMI-gaterna G1–G4 plus en egen gate G5 (milstolpen heter G5, koden blir namnet).
const MAIN = P('m', 'Projekt Alfa (fiktivt)', { l1: 'Projekt Alfa (fiktivt)', role: 'main' }, [
  ms('m-g1', 'Gate G1', '2622', { goalStatus: 'done', progress: 100, actual: { day: fri('2622'), week: '2622', src: 'planner' } }),
  ms('m-g2', 'Gate G2', '2651', { goalStatus: 'ontrack' }), ms('m-g3', 'Gate G3', '2722'), ms('m-g4', 'Gate G4', '2751'), ms('m-g5', 'G5', '2813'),
  { id: 'm-t1', name: 'Lokaler fastställda', bucket: 'Executing', start: '2026-09-01', end: '2026-11-13', progress: 20 },
]);
const C = P('c', 'Delprojekt C (fiktivt)', { l1: 'Projekt Alfa (fiktivt)', l2: 'Delprojekt C (fiktivt)' }, [
  ms('c-g1', 'Gate G1', '2622', { goalStatus: 'done' }), ms('c-g2', 'Gate G2', '2648'), ms('c-g3', 'Gate G3', '2726'), ms('c-g4', 'Gate G4', '2744'), ms('c-g5', 'G5', '2751'),
  { id: 'c-t1', name: 'Elkapacitet utökad', bucket: 'Executing', start: '2026-11-02', end: '2026-12-01', progress: 0 },
]);
const D = P('d', 'Delprojekt D (fiktivt)', { l1: 'Projekt Alfa (fiktivt)', l2: 'Delprojekt D (fiktivt)' }, [{ id: 'd-t1', name: 'Ytor', start: '2026-09-01', end: '2026-10-01', progress: 50 }]);
const IT = P('i', 'IT (fiktivt)', { l1: 'Projekt Alfa (fiktivt)', l2: 'IT (fiktivt)', gates: 'none' }, [ms('i-g1', 'Gate G1', '2630')]);
const LONE = P('h', 'Fristående plan (fiktiv)', {}, [
  ms('h-g1', 'Gate G1', '2618'), ms('h-g2', 'Gate G2', '2702', { goalStatus: 'offtrack' }), ms('h-g3', 'Gate G3', '2722', { goalStatus: 'atrisk' }),
]);
const PLANS = new Map([MAIN, C, D, IT, LONE].map(p => [p.id, p]));
const PROG = { id: 'p', name: 'Program X (test)', plans: ['h', 'm', 'c', 'd', 'i', 'saknas'].map(planId => ({ planId })), milestones: [
  { id: 'pg1', code: 'G1', name: 'Programmets G1', week: '2622', status: 'done' },
  { id: 'pg2', code: 'G2', week: '2651', status: 'ontrack' },
  { id: 'pg3', code: 'G3', date: '2027-06-04', status: 'notstarted' },
  { id: 'pg4', code: 'G4', week: '2751', status: 'notstarted' },
  { id: 'pg5', code: 'G5', week: '2813', status: 'notstarted' },
] };
const K = ['G1', 'G2', 'G3', 'G4', 'G5'];
const cellOf = (m, planId, key) => m.rows.find(r => r.planId === planId).cells[key];

test('cleanProgramGates: kod krävs och är unik, vecka → fredag, status och sortering på datum', () => {
  const g = cleanProgramGates([
    { id: 'a', code: ' G2 ', name: 'Programmets  G2', week: '2651', status: 'ontrack', note: 'x' },
    { id: 'b', code: 'g1', week: 'v22 2026', status: 'konstig' },
    { code: 'G1', week: '2601' }, // samma kod som b (utan skiftläge) – tas bort
    { code: '', name: 'Utan kod', week: '2601' },
    { id: 'c', code: 'G3', date: '2027-02-30', week: '2722' }, // ogiltigt datum → veckan
    { id: 'a', code: 'G4' }, // samma id → nytt id, utan datum sist
    null, 'skräp',
  ]);
  assert.deepEqual(g.map(x => [x.code, x.week, x.date, x.status]), [['g1', '2622', '2026-05-29', 'notstarted'], ['G2', '2651', '2026-12-18', 'ontrack'], ['G3', '2722', '2027-06-04', 'notstarted'], ['G4', null, null, 'notstarted']]);
  assert.equal(g[1].name, 'Programmets G2');
  assert.equal(g[1].note, 'x');
  assert.equal(new Set(g.map(x => x.id)).size, 4, 'unika id');
  assert.notEqual(g[3].id, 'a');
  assert.deepEqual(cleanProgramGates(null), []);
  assert.deepEqual(cleanProgramGates([{ code: 'G5', date: '2027-12-17', week: '2601' }]).map(x => x.week), ['2750'], 'datum går före vecka');
  assert.equal(cleanProgramGates(Array.from({ length: 60 }, (_, i) => ({ code: 'G' + i }))).length, 40, 'högst 40');
});

test('gateCellState: grå saknas, grön klar/i tid, orange nära eller i riskzonen, röd efter programgaten', () => {
  assert.equal(gateCellState({ undated: true }), 'missing');
  assert.equal(gateCellState({ day: 1, done: true, devW: 3 }), 'done', 'klar är grön även om den blev sen');
  assert.equal(gateCellState({ day: 1, devW: 1, devD: 7 }), 'late');
  assert.equal(gateCellState({ day: 1, devW: 0, devD: 4 }), 'near', 'senare inom samma vecka');
  assert.equal(gateCellState({ day: 1, devW: 0, devD: 0 }), 'ok');
  assert.equal(gateCellState({ day: 1, devW: -2, devD: -14 }), 'ok', 'före programgaten är i tid');
  assert.equal(gateCellState({ day: 1, devW: -2, devD: -14, gs: 'atrisk' }), 'near');
  assert.equal(gateCellState({ day: 1, devW: -2, devD: -14, gs: 'offtrack' }), 'late');
  assert.equal(gateCellState({ day: 1, devW: null, devD: null }), 'nopg');
  assert.equal(gateCellState({ day: 1, devW: null, devD: null, overdue: true }), 'near', 'passerad utan utfall');
});

test('gateMatrix: rader grupperade huvudprojekt → huvudplan och delprojekt, kolumner i datumordning', () => {
  const m = gateMatrix(PROG, PLANS, { today: TODAY });
  assert.deepEqual(m.rows.map(r => [r.type, r.planId || r.key, r.level]), [['plan', 'h', 0], ['group', 'projekt alfa (fiktivt)', 0], ['main', 'm', 1], ['sub', 'c', 1], ['sub', 'd', 1], ['sub', 'i', 1]]);
  assert.deepEqual(m.cols.map(c => c.key), K);
  assert.ok(m.cols.every(c => c.pg));
  assert.equal(m.missing, 1, 'plan som inte finns räknas');
  assert.deepEqual(m.rows.filter(r => r.mode).map(r => r.mode), ['own', 'own', 'own', 'inherited', 'none']);
  assert.equal(m.rows[4].from, 'Projekt Alfa (fiktivt)');
});

test('gateMatrix: avvikelse i veckor mot programgaten med samma kod och färg per cell', () => {
  const m = gateMatrix(PROG, PLANS, { today: TODAY });
  const c = (p, k) => cellOf(m, p, k);
  assert.equal(c('m', 'G1').state, 'done'); assert.equal(c('m', 'G1').act.week, '2622');
  assert.deepEqual([c('m', 'G2').devW, c('m', 'G2').state], [0, 'ok']);
  assert.deepEqual([c('c', 'G2').devW, c('c', 'G2').state], [-3, 'ok']);
  assert.deepEqual([c('c', 'G3').devW, c('c', 'G3').state, c('c', 'G3').week], [4, 'late', '2726']);
  assert.deepEqual([c('c', 'G5').devW, c('c', 'G5').state], [-14, 'ok']);
  assert.equal(c('c', 'G1').state, 'done', 'Klar utan utfall');
  // Ärvda gater: samma vecka som huvudplanen, märkta inherited
  assert.ok(c('d', 'G2').inherited); assert.equal(c('d', 'G2').week, '2651'); assert.equal(c('d', 'G2').state, 'ok');
  // Stödprojekt: inga celler
  assert.ok(K.every(k => c('i', k).state === 'none'));
  // Fristående plan: G1 passerad utan utfall men före programgaten → orange (passerad), G2 +4 v (2026 har 53 veckor) och Ur fas → röd, G3 i tid men I riskzonen → orange, G4/G5 saknas → grå
  assert.deepEqual([c('h', 'G1').devW, c('h', 'G1').state], [-4, 'near']);
  assert.deepEqual([c('h', 'G2').devW, c('h', 'G2').state, c('h', 'G2').gs], [4, 'late', 'offtrack']);
  assert.equal(c('h', 'G3').state, 'near');
  assert.equal(c('h', 'G4').state, 'missing'); assert.equal(c('h', 'G4').pgWeek, '2751');
  assert.deepEqual(m.rows.filter(r => r.type !== 'group').map(r => [r.planId, r.dev, r.late]), [['h', 3, 1], ['m', 0, 0], ['c', 1, 1], ['d', 0, 0], ['i', 0, 0]]);
  assert.deepEqual([m.rows[1].dev, m.rows[1].late, m.rows[1].kids], [1, 1, ['m', 'c', 'd', 'i']]);
  assert.deepEqual(m.summary, { late: 2, near: 2, ok: 11, done: 3, missing: 2, nopg: 0 });
});

test('gateMatrix: utfallet jämförs med programgaten; senare samma vecka blir orange; utan programgate ingen avvikelse', () => {
  const late = P('x', 'Utfall (fiktiv)', {}, [ms('x-g1', 'Gate G1', '2622', { actual: { day: fri('2624'), week: '2624', src: 'tp' } })]);
  const prog = { plans: [{ planId: 'x' }, { planId: 'y' }], milestones: [{ code: 'G1', week: '2622' }, { code: 'G2', date: '2026-12-14' }] };
  const near = P('y', 'Nära (fiktiv)', {}, [ms('y-g2', 'Gate G2', '2651'), ms('y-g4', 'Gate G4', '2751')]);
  const m = gateMatrix(prog, { x: late, y: near }, { today: TODAY });
  assert.deepEqual([cellOf(m, 'x', 'G1').devW, cellOf(m, 'x', 'G1').state], [2, 'done']);
  assert.deepEqual([cellOf(m, 'y', 'G2').devW, cellOf(m, 'y', 'G2').devD, cellOf(m, 'y', 'G2').state], [0, 4, 'near']);
  assert.deepEqual([cellOf(m, 'y', 'G4').devW, cellOf(m, 'y', 'G4').state], [null, 'nopg']);
  assert.equal(m.cols.find(c => c.key === 'G4').pg, null);
  assert.equal(cellOf(m, 'x', 'G4').state, 'none', 'ingen gate och ingen programgate = tom cell');
  assert.equal(cellOf(m, 'x', 'G2').state, 'missing');
});

test('gateMatrix: gate utan datum är grå och räknas inte som egen (delprojektet ärver)', () => {
  const und = P('u', 'Utan datum (fiktiv)', { l1: 'Projekt Alfa (fiktivt)', l2: 'U' }, [{ id: 'u-g1', name: 'Gate G1', milestone: true, gate: true, start: null, end: null }]);
  const lone = P('v', 'Ensam utan datum (fiktiv)', {}, [{ id: 'v-g1', name: 'Gate G1', milestone: true, gate: true, start: null, end: null }]);
  const m = gateMatrix({ plans: [{ planId: 'm' }, { planId: 'u' }, { planId: 'v' }], milestones: PROG.milestones }, new Map([[MAIN.id, MAIN], [und.id, und], [lone.id, lone]]), { today: TODAY });
  assert.equal(m.rows.find(r => r.planId === 'u').mode, 'inherited');
  assert.equal(cellOf(m, 'v', 'G1').state, 'missing'); assert.ok(cellOf(m, 'v', 'G1').undated);
});

test('gateMatrix: planens egna gater (settings.gates) mot programgater med fria koder, ordning efter datum', () => {
  const gs = [{ id: 'g1', code: 'G1', name: 'Start' }, { id: 'g2', code: 'G2', name: 'Beslut' }, { id: 'g3', code: 'G3', name: 'Driftsättning' }];
  const main = P('b', 'Ny besöksreception (fiktiv)', { l1: 'Besök (fiktivt)', role: 'main' }, [
    { ...ms('b1', 'G1 Start', '2641'), gateId: 'g1' }, ms('b2', 'Beslut G2', '2705'), ms('b3', 'Klart', '2716', { gateId: 'g3' })]);
  main.settings.gates = gs;
  const sub = P('s', 'Delprojekt IT (fiktivt)', { l1: 'Besök (fiktivt)', l2: 'IT' }, [{ ...ms('s1', 'G1', '2642') }, { ...ms('s2', 'G2', '2708') }]);
  sub.settings.gates = gs.slice(0, 2);
  const inh = P('e', 'Delprojekt Utbildning (fiktivt)', { l1: 'Besök (fiktivt)', l2: 'Utbildning' }, [{ id: 'e1', name: 'Kurs', start: '2026-11-02', end: '2026-11-20' }]);
  const prog = { plans: ['b', 's', 'e'].map(planId => ({ planId })), milestones: [{ code: 'g2', week: '2705' }, { code: 'G1', week: '2641', status: 'done' }, { code: 'G4', week: '2725' }] };
  const m = gateMatrix(prog, new Map([main, sub, inh].map(p => [p.id, p])), { today: TODAY });
  assert.deepEqual(m.cols.map(c => [c.key, c.code, !!c.pg]), [['G1', 'G1', true], ['G2', 'g2', true], ['G3', 'G3', false], ['G4', 'G4', true]]);
  // G1 (2641) har passerat utan utfall → orange
  assert.deepEqual(['G1', 'G2', 'G3', 'G4'].map(k => cellOf(m, 'b', k).state), ['near', 'ok', 'nopg', 'missing']);
  assert.equal(cellOf(m, 'b', 'G3').taskId, 'b3', 'milstolpen kopplad med gateId');
  assert.deepEqual(['G1', 'G2'].map(k => cellOf(m, 's', k).devW), [1, 3]);
  assert.deepEqual(['G1', 'G2', 'G3', 'G4'].map(k => cellOf(m, 's', k).state), ['late', 'late', 'none', 'missing']);
  assert.equal(m.rows.find(r => r.planId === 'e').mode, 'inherited');
  assert.equal(cellOf(m, 'e', 'G2').week, '2705'); assert.ok(cellOf(m, 'e', 'G2').inherited);
  assert.deepEqual(Object.keys(planGateMap(main)), ['G1', 'G2', 'G3']);
  assert.deepEqual(Object.keys(planGateMap(MAIN)), K, 'härledda ur gate-milstolparna');
});

test('gateSource: inherit och none som i #67', () => {
  assert.equal(gateSource({ ...C, settings: { project: { ...C.settings.project, gates: 'inherit' } } }, MAIN).mode, 'inherited');
  assert.equal(gateSource(C, MAIN).mode, 'own');
  assert.equal(gateSource(IT, MAIN).mode, 'none');
  assert.equal(gateSource(D, null).mode, 'empty');
});

test('Bara avvikelser: projekt med röd eller orange cell och deras huvudprojekt', () => {
  const m = gateMatrix(PROG, PLANS, { today: TODAY });
  assert.deepEqual(gateRowsShown(m.rows, true).map(r => r.planId || r.key), ['h', 'projekt alfa (fiktivt)', 'c']);
  assert.equal(gateRowsShown(m.rows, false), m.rows);
  const calm = gateMatrix({ ...PROG, plans: [{ planId: 'm' }, { planId: 'd' }] }, PLANS, { today: TODAY });
  assert.deepEqual(gateRowsShown(calm.rows, true), []);
});

test('påverkade beroenden (#22) markerar raden och gaten efter aktiviteten', () => {
  const changed = new Map([['d1', { depId: 'd1', from: { planId: 'c', taskId: 'c-t1', task: 'Elkapacitet utökad' }, to: { planId: 'm', taskId: 'm-t1', task: 'Lokaler fastställda' },
    after: { status: 'blockerad', margin: -10 }, before: { status: 'ok', margin: 11 }, deltaDays: -21, planName: 'Delprojekt C (fiktivt)', at: '2026-10-30T10:00:00Z' }]]);
  const m = gateMatrix(PROG, PLANS, { today: TODAY, changed });
  // C: aktiviteten slutar 2026-12-01, efter G2 (2648) → G3 2726. Huvudplanen: slutar 2026-11-13 → G2 2651
  assert.deepEqual(K.filter(k => cellOf(m, 'c', k).alerts.length), ['G3']);
  assert.deepEqual(K.filter(k => cellOf(m, 'm', k).alerts.length), ['G2']);
  assert.equal(cellOf(m, 'c', 'G3').alerts[0].status, 'blockerad');
  assert.equal(m.rows.find(r => r.planId === 'c').alerts.length, 1);
  assert.equal(m.rows.find(r => r.type === 'group').alerts.length, 2);
  assert.equal(m.rows.find(r => r.planId === 'h').alerts.length, 0);
  // Ändrade beroenden som array fungerar också; okänd plan ignoreras
  assert.doesNotThrow(() => gateMatrix(PROG, PLANS, { today: TODAY, changed: [{ depId: 'x', from: { planId: 'okänd' }, to: null }] }));
});

test('Excel-tabellen: veckor som tal, avvikelse i veckor och läge per gate', () => {
  const m = gateMatrix(PROG, PLANS, { today: TODAY });
  const aoa = gateMatrixAoa(m, 'Program X (test)', TODAY);
  assert.deepEqual(aoa[0], ['Program', 'Program X (test)']);
  assert.deepEqual(aoa[1], ['Exporterad', '2026-10-30']);
  assert.equal(aoa[3].length, 3 + 4 * m.cols.length);
  assert.deepEqual(aoa[3].slice(0, 7), ['Projekt', 'Huvudprojekt', 'Gater', 'G1 plan', 'G1 utfall', 'G1 avvikelse (v)', 'G1 läge']);
  assert.deepEqual(aoa[4].slice(0, 7), ['Programgate', '', '', 2622, '', '', 'Klar']);
  const c = aoa.find(r => r[0] === 'Delprojekt C (fiktivt)');
  assert.deepEqual(c.slice(1, 3), ['Projekt Alfa (fiktivt)', '']);
  assert.deepEqual(c.slice(11, 15), [2726, '', 4, 'Efter programgaten']);
  const d = aoa.find(r => r[0] === 'Delprojekt D (fiktivt)');
  assert.equal(d[2], 'ärvda från Projekt Alfa (fiktivt)');
  assert.equal(aoa.find(r => r[0] === 'Fristående plan (fiktiv)')[1], '', 'fristående plan har inget huvudprojekt');
  assert.equal(aoa.length, 5 + 5, 'grupprader blir ingen egen rad');
});

test('fmtDevW', () => {
  assert.equal(fmtDevW(2), '+2 v'); assert.equal(fmtDevW(-1), '−1 v'); assert.equal(fmtDevW(0), '±0 v'); assert.equal(fmtDevW(null), '');
});

// #99: varning när en projektgate glider förbi programgaten – samma regel som de röda rutorna
const moved = (pl, id, yyww) => pl.tasks.map(t => t.id === id ? { ...t, start: fri(yyww), end: fri(yyww) } : t);
test('gateImpact: gate som glider minst en vecka förbi programgaten varnas, även för delprojekt som ärver den', () => {
  const imp = gateImpact([PROG], PLANS, 'm', moved(MAIN, 'm-g2', '2703'), TODAY);
  assert.deepEqual(imp.map(x => [x.planId, x.code, x.before && x.before.week, x.after.week, x.after.devW, x.inherited]),
    [['m', 'G2', '2651', '2703', 5, false], ['d', 'G2', '2651', '2703', 5, true]], '2026 har 53 veckor');
  assert.equal(imp[0].pgWeek, '2651');
  assert.equal(imp[0].program, 'Program X (test)');
});
test('gateImpact: redan sen gate varnas bara när den glider längre, inte när den flyttas tidigare eller står still', () => {
  const before = gateMatrix(PROG, PLANS, { today: TODAY }).rows.find(r => r.planId === 'c').cells.G3.devW;
  assert.ok(before >= 1, 'G3 ligger redan efter programgaten');
  const later = gateImpact([PROG], PLANS, 'c', moved(C, 'c-g3', '2730'), TODAY);
  assert.deepEqual(later.map(x => [x.code, x.before.devW, x.after.devW]), [['G3', before, before + 4]]);
  assert.deepEqual(gateImpact([PROG], PLANS, 'c', moved(C, 'c-g3', '2725'), TODAY), [], 'tidigare – ingen varning');
  assert.deepEqual(gateImpact([PROG], PLANS, 'c', C.tasks, TODAY), [], 'oförändrad – ingen varning');
  assert.deepEqual(gateImpact([PROG], PLANS, 'c', moved(C, 'c-g2', '2650'), TODAY), [], 'inom programgatens vecka');
});
test('gateImpact: program utan programgater, borttagna program och planer utanför programmet ger inget', () => {
  const t = moved(MAIN, 'm-g2', '2710');
  assert.deepEqual(gateImpact([{ ...PROG, milestones: [] }], PLANS, 'm', t, TODAY), []);
  assert.deepEqual(gateImpact([{ ...PROG, settings: { deleted_at: '2026-10-30' } }], PLANS, 'm', t, TODAY), []);
  assert.deepEqual(gateImpact([{ ...PROG, plans: [{ planId: 'h' }] }], PLANS, 'm', t, TODAY), []);
  assert.deepEqual(gateImpact([PROG], PLANS, 'finnsinte', t, TODAY), []);
});
test('appens kod: gatevarningen visas i förhandsvisningen, sparas i programmet och markeras i Gater (#99)', () => {
  assert.match(src, /const gImpact = planGateImpact\(plan, res\.tasks\)/);
  assert.equal((src.match(/saveDepAlerts\(gImpact, pl, 'gateAlerts'\)/g) || []).length, 2, 'Uppdatera från Excel och Importera → Uppdatera planen');
  assert.match(src, /\$\{gateImpactHTML\(gImpact\)\}/);
  assert.match(src, /for \(const key of \['depAlerts', 'gateAlerts'\]\)/, 'Markera som sett gäller båda');
  assert.match(src, /slips: changedGates\(program, seenKey\(\)\)/);
});
