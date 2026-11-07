// Kritisk linje, slack och marginal till nästa gate (#4): arbetsdagar med svenska helgdagar, FS/SS/FF/SF och fördröjning, mål = planens slut
// eller en gate, cirklar och saknade datum, beroendetäckning. Bara beräkning – inga datum ändras. Påhittad data. Kör: node --test "test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const clamp = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const todayDay = .*;/), pick(/const weekday = .*;/), pick(/const PMI_GATE_RE = .*;/), pick(/const isGateMs = .*;/),
  pick(/function easterDay\([\s\S]*?\n}\n/), pick(/function seHolidays\([\s\S]*?\n}\n/), pick(/const HOLIDAY_CACHE = .*;/), pick(/const seHolidaySet = .*;/),
  pick(/function calendarOf\([\s\S]*?\n}\n/), pick(/const isWorkday = .*;/),
  blk('/* ---------- Kritisk linje, slack och marginal', '/* ---------- slut kritisk linje'),
].join('\n');
const F = new Function(code + '\nreturn { criticalPath, cpChain, fromDay, depCoverage, nextGateMargin, fmtSlack, workAxis, calendarOf, toDay, CRIT_COVERAGE };')();
const cal = F.calendarOf({}), D = F.toDay;
const T = (id, start, end, deps = [], x = {}) => ({ id, name: id, start, end, deps, progress: 0, ...x });
const M = (id, date, deps = [], x = {}) => ({ id, name: id, start: date, end: date, milestone: true, deps, progress: 0, ...x });

// Påhittad plan (november 2026, mån–fre): a → b → c → G1; x utan beroenden; d → b
const plan = () => [
  T('a', '2026-11-02', '2026-11-06'),                 // v45
  T('b', '2026-11-09', '2026-11-13', ['a', 'd']),     // v46
  T('c', '2026-11-16', '2026-11-20', ['b']),          // v47
  M('G1', '2026-11-27', ['c'], { bucket: 'Initiating' }), // fredag v48
  T('d', '2026-11-02', '2026-11-04'),                 // mån–ons v45
  T('x', '2026-11-02', '2026-11-03'),
];

test('arbetsdagsaxel: helger och svenska helgdagar räknas inte', () => {
  const ax = F.workAxis(D('2026-12-20'), D('2027-01-10'), cal);
  // 21–31 dec: mån 21, tis 22, ons 23 (julafton, juldagen, annandag fre/lör) → 28, 29, 30 (nyårsafton 31 ledig)
  assert.equal(ax.cum(D('2026-12-31')) - ax.cum(D('2026-12-20')), 6);
  assert.equal(F.fromDay(ax.dayOf(ax.cum(D('2026-12-23')) + 1)), '2026-12-28', 'nästa arbetsdag efter 23 dec är 28 dec');
  const none = F.workAxis(D('2026-12-20'), D('2027-01-10'), F.calendarOf({ calendar: { holidays: 'none' } }));
  assert.equal(none.cum(D('2026-12-31')) - none.cum(D('2026-12-20')), 9);
});

test('planens slut: tidigaste/senaste datum och slack i arbetsdagar, kritiska och nära kritiska', () => {
  const cp = F.criticalPath(plan(), { calendar: cal });
  const r = id => cp.byId.get(id);
  assert.equal(cp.end, '2026-11-27');
  assert.deepEqual(['a', 'b', 'c', 'G1'].map(id => r(id).slack), [5, 5, 5, 0], 'fem arbetsdagar luft före G1 (vecka 48 är tom)');
  assert.equal(r('d').slack, 7, 'd slutar onsdag – två dagar mer än a');
  assert.equal(r('x').slack, 18, 'utan beroenden: luft till planens slut');
  assert.deepEqual(cp.critical, ['G1']);
  assert.deepEqual(cp.near.sort(), ['a', 'b', 'c'], 'slack ≤ en arbetsvecka');
  assert.deepEqual({ es: r('c').es, ef: r('c').ef, ls: r('c').ls, lf: r('c').lf }, { es: '2026-11-16', ef: '2026-11-20', ls: '2026-11-23', lf: '2026-11-27' });
  assert.deepEqual({ es: r('b').es, ls: r('b').ls }, { es: '2026-11-09', ls: '2026-11-16' });
  assert.equal(r('G1').ls, '2026-11-27', 'milstolpen har samma start och slut');
  assert.equal(cp.target, 'end'); assert.ok(cp.targetOk);
});

test('målet en gate: bara gatens föregångare räknas, kedjan som driver gaten', () => {
  const ts = [...plan(), T('efter', '2026-11-30', '2026-12-18', ['G1'])];
  const cp = F.criticalPath(ts, { calendar: cal, target: 'G1' });
  assert.equal(cp.end, '2026-11-27');
  assert.equal(cp.byId.get('x').slack, null, 'x hör inte till gatens kedja');
  assert.equal(cp.byId.get('x').inScope, false);
  assert.equal(cp.byId.get('efter').slack, null, 'efter gaten räknas inte');
  assert.equal(cp.byId.get('c').slack, 5);
  assert.deepEqual(F.cpChain(cp, 'G1'), ['a', 'b', 'c', 'G1'], 'a (5 d) före d (7 d)');
  const endCp = F.criticalPath(ts, { calendar: cal });
  assert.deepEqual(endCp.critical.sort(), ['G1', 'efter'], 'mot planens slut: G1 och efter, kedjan före har vecka 48 som luft');
  assert.equal(endCp.byId.get('c').slack, 5);
  assert.equal(F.criticalPath(ts, { calendar: cal, target: 'saknas' }).targetOk, false);
});

test('röd pil (efterföljaren börjar för tidigt) ger negativ slack', () => {
  const ts = [T('a', '2026-11-02', '2026-11-11'), T('b', '2026-11-09', '2026-11-13', ['a']), M('G', '2026-11-13', ['b'])];
  const cp = F.criticalPath(ts, { calendar: cal, target: 'G' });
  assert.equal(cp.byId.get('a').slack, -3, 'a måste vara klar fredag 6/11 men slutar onsdag 11/11');
  assert.equal(cp.byId.get('b').slack, 0);
  assert.deepEqual(cp.critical.sort(), ['a', 'b'], 'gaten själv är målet, inte kritisk');
  assert.equal(cp.byId.get('G').isTarget, true);
  assert.equal(cp.byId.get('b').es, '2026-11-12', 'tidigaste start efter a');
});

test('helgdag i kedjan: luften räknas i arbetsdagar', () => {
  // a slutar 30 dec, b börjar 4 jan (31 dec och 1 jan lediga, 2–3 helg) → ingen luft
  const ts = [T('a', '2026-12-28', '2026-12-30'), T('b', '2027-01-04', '2027-01-08', ['a'])];
  assert.equal(F.criticalPath(ts, { calendar: cal }).byId.get('a').slack, 0);
  assert.equal(F.criticalPath(ts, { calendar: F.calendarOf({ calendar: { holidays: 'none' } }) }).byId.get('a').slack, 2, 'utan helgdagar: 31 dec och 1 jan är arbetsdagar');
});

test('typ och fördröjning: SS, FF, SF och lag från depInfo (#83) eller programmets länkar', () => {
  const base = (type, lag) => [T('a', '2026-11-02', '2026-11-06'), T('b', '2026-11-09', '2026-11-20', ['a'], { depInfo: { a: { type, lag } } })];
  const s = (type, lag) => F.criticalPath(base(type, lag), { calendar: cal }).byId.get('a').slack;
  assert.equal(s('FS', 0), 0);
  assert.equal(s('FS', 2), -2, 'två dagars fördröjning efter a gör a två dagar sen');
  assert.equal(s('SS', 0), 5, 'SS: b får börja när a börjar → a:s start kan flyttas till b:s start');
  assert.equal(s('FF', 0), 10, 'FF: a får sluta när b slutar');
  assert.equal(s('SF', 0), 10, 'SF: b får sluta när a börjar – begränsas av planens slut');
  assert.equal(s('SF', 12), 3, 'SF med 12 dagars fördröjning: b slutar tidigast 12 arbetsdagar efter a:s start');
  assert.equal(s('xx', 0), 0, 'okänd typ = FS');
  const links = F.criticalPath([T('a', '2026-11-02', '2026-11-06'), T('b', '2026-11-09', '2026-11-20')], { calendar: cal, links: [{ from: 'a', to: 'b', type: 'FS', lag: 1 }] });
  assert.equal(links.byId.get('a').slack, -1);
});

test('cirklar och saknade datum: rapporteras, ingen oändlig loop', () => {
  const ts = [T('a', '2026-11-02', '2026-11-06', ['c']), T('b', '2026-11-09', '2026-11-13', ['a']), T('c', '2026-11-16', '2026-11-20', ['b']),
    T('efter', '2026-11-23', '2026-11-27', ['c']), T('fri', '2026-11-02', '2026-11-06'), T('utan', null, null), T('beroende', '2026-11-09', '2026-11-13', ['utan'])];
  const cp = F.criticalPath(ts, { calendar: cal });
  assert.deepEqual(cp.cycles.sort(), ['a', 'b', 'c']);
  assert.deepEqual(cp.afterCycle, ['efter']);
  assert.deepEqual(cp.missing, ['utan']);
  assert.deepEqual(cp.broken, [{ from: 'utan', to: 'beroende' }]);
  assert.equal(cp.byId.get('a').slack, null);
  assert.equal(cp.byId.get('fri').slack, 15);
  assert.equal(cp.byId.get('beroende').slack, 10, 'beroendet till aktiviteten utan datum hoppas över');
  const self = F.criticalPath([T('s', '2026-11-02', '2026-11-06', ['s', 'okänd'])], { calendar: cal });
  assert.equal(self.byId.get('s').slack, 0, 'beroende på sig själv och okända id ignoreras');
  assert.deepEqual(F.criticalPath([], {}).critical, []);
});

test('klara aktiviteter: står på sina datum och markeras aldrig som kritiska', () => {
  const ts = [T('a', '2026-11-02', '2026-11-11', [], { progress: 100 }), T('b', '2026-11-09', '2026-11-13', ['a'])];
  const cp = F.criticalPath(ts, { calendar: cal });
  assert.equal(cp.byId.get('a').done, true);
  assert.equal(cp.byId.get('a').critical, false);
  assert.deepEqual(cp.critical, ['b']);
});

test('programmet per plan: utan länk räknas varje plans slut för sig', () => {
  const ts = [T('p1›a', '2026-11-02', '2026-11-06', [], { _plan: 'p1' }), T('p2›a', '2026-11-02', '2026-12-18', [], { _plan: 'p2' })];
  const grp = t => t._plan;
  assert.equal(F.criticalPath(ts, { calendar: cal, group: grp }).byId.get('p1›a').slack, 0);
  assert.equal(F.criticalPath(ts, { calendar: cal }).byId.get('p1›a').slack, 30, 'utan grupp: programmets slut');
  const linked = F.criticalPath(ts.concat(T('p2›b', '2026-11-09', '2026-11-13', [], { _plan: 'p2' })), { calendar: cal, group: grp, links: [{ from: 'p1›a', to: 'p2›b' }] });
  assert.equal(linked.byId.get('p1›a').slack, 0, 'länken till p2 styr');
  assert.equal(linked.byId.get('p2›b').slack, 25);
});

test('beroendetäckning: andel aktiviteter (inte milstolpar) med beroende åt något håll', () => {
  assert.deepEqual(F.depCoverage(plan()), { n: 4, total: 5, pct: 80 });
  assert.deepEqual(F.depCoverage([T('a', '2026-11-02', '2026-11-06'), T('b', '2026-11-02', '2026-11-06', ['saknas'])]), { n: 0, total: 2, pct: 0 });
  assert.deepEqual(F.depCoverage([]), { n: 0, total: 0, pct: 0 });
  assert.equal(F.CRIT_COVERAGE, 30);
});

test('marginal till nästa gate: beroenden, fas utan beroenden, ingen gate', () => {
  const today = D('2026-11-01');
  const m = F.nextGateMargin({ tasks: plan(), settings: {} }, today, { code: t => t.name });
  assert.equal(m.gate.id, 'G1'); assert.equal(m.basis, 'deps');
  assert.equal(m.days, 5); assert.equal(m.weeks, 1);
  assert.deepEqual(m.chain.map(x => x.id), ['a', 'b', 'c', 'G1']);
  // Passerad gate (utfall) och klar gate hoppas över
  const next = F.nextGateMargin({ tasks: [...plan().map(t => t.id === 'G1' ? { ...t, actual: { week: '2648' } } : t), M('G2', '2027-03-05', [], { progress: 0 })], settings: {} }, today);
  assert.equal(next.gate.id, 'G2'); assert.equal(next.basis, 'none'); assert.equal(next.days, null);
  // Utan beroenden: sista slut i gatens fas
  const ph = F.nextGateMargin({ tasks: [T('f1', '2026-11-02', '2026-11-13', [], { bucket: 'Initiating' }), T('f2', '2026-11-02', '2026-11-06', [], { bucket: 'Initiating' }), M('G1', '2026-11-27', [], { bucket: 'Initiating' })], settings: {} }, today);
  assert.equal(ph.basis, 'phase'); assert.equal(ph.days, 10); assert.deepEqual(ph.chain.map(x => x.id), ['f1', 'G1']);
  assert.equal(F.nextGateMargin({ tasks: [T('a', '2026-11-02', '2026-11-06')], settings: {} }, today), null);
  // Gaten förbi idag räknas inte som nästa
  assert.equal(F.nextGateMargin({ tasks: plan(), settings: {} }, D('2026-12-01')), null);
});

test('slack som text', () => {
  assert.equal(F.fmtSlack(null), '–');
  assert.equal(F.fmtSlack(0), '0 d');
  assert.equal(F.fmtSlack(-3), '−3 d');
  assert.equal(F.fmtSlack(12), '2 v');
  assert.equal(F.fmtSlack(-10), '−2 v');
});

test('beräkningen ändrar aldrig aktiviteterna', () => {
  const ts = plan(), before = JSON.stringify(ts);
  F.criticalPath(ts, { calendar: cal, target: 'G1' }); F.nextGateMargin({ tasks: ts, settings: {} }, D('2026-11-01')); F.depCoverage(ts);
  assert.equal(JSON.stringify(ts), before);
});

test('#83: typ och fördröjning ur t.depInfo (från importen) styr kedjan', () => {
  // a 2–6 nov; b 4–13 nov efter a med SS +2 → tidigast start ons 4 nov = planerad, b kritisk mot planens slut
  const ts = [T('a', '2026-11-02', '2026-11-06'), T('b', '2026-11-04', '2026-11-13', ['a'], { depInfo: { a: { type: 'SS', lag: 2, src: 'planner' } } })];
  const r = F.criticalPath(ts, { calendar: cal });
  assert.equal(r.byId.get('b').slack, 0);
  assert.equal(r.byId.get('a').slack, 0, 'a driver b via SS +2');
  // Som FS (utan info) kan b tidigast starta efter a:s slut → senare tidigaste start än med SS +2
  const fs = F.criticalPath([ts[0], { ...ts[1], depInfo: undefined }], { calendar: cal });
  assert.ok(fs.byId.get('b').es > r.byId.get('b').es);
});
