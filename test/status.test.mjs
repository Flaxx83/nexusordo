// Tester för veckostatus (#42): vecka, sämsta färg, förslag från trend/risker/checklista och ekonomi.
// Funktionerna läses direkt ur app/script.js. Kör: node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const fn = n => pick(new RegExp(`function ${n}\\([\\s\\S]*?\\n}\\n`));
const one = n => pick(new RegExp(`const ${n} = .*;`));
const code = [
  one('DAY'), one('utcDay'), one('toDay'), one('fromDay'), one('dObj'), one('weekday'), one('yearStart'), one('isoWeek'), one('isoWeekYear'), one('fmtYYWW'),
  fn('parseWeek'), one('MTA_GATE_RE'), fn('msTrend'), one('riskValue'), one('riskHigh'), one('riskReadyDay'), fn('riskDue'),
  pick(/const ST_DIMS = \[[\s\S]*?\n\];/), one('ST_RANK'), one('statusWeekKey'), one('worstOf'),
  fn('upsertStatus'), fn('suggestTime'), fn('suggestRisk'), fn('suggestDeliv'), fn('moneyColour'),
].join('\n');
const S = new Function(code + '\nreturn { toDay, statusWeekKey, worstOf, upsertStatus, suggestTime, suggestRisk, suggestDeliv, moneyColour, ST_DIMS };')();
const today = S.toDay('2026-10-29');

test('vecka som ÅÅVV och sämsta färgen', () => {
  assert.equal(S.statusWeekKey(today), '2644');
  assert.equal(S.worstOf(['G', 'Y', null, 'G']), 'Y');
  assert.equal(S.worstOf(['G', 'R', 'Y']), 'R');
  assert.equal(S.worstOf([null, undefined]), null);
  assert.equal(S.ST_DIMS.length, 11);
});

test('en post per vecka, sorterad', () => {
  let l = S.upsertStatus([], { week: '2644', overall: 'G' });
  l = S.upsertStatus(l, { week: '2643', overall: 'Y' });
  l = S.upsertStatus(l, { week: '2644', overall: 'R' });
  assert.deepEqual(l.map(e => `${e.week}${e.overall}`), ['2643Y', '2644R']);
  l = S.upsertStatus(l, { week: '2701', overall: 'G' });
  assert.equal(l[l.length - 1].week, '2701');
});

const plan = (shifts, late = 0) => {
  const tasks = shifts.map((d, i) => ({ id: 'g' + i, name: ['Gate G1', 'Gate G2', 'Gate G3'][i], milestone: true, end: '2027-01-01' }));
  for (let i = 0; i < late; i++) tasks.push({ id: 't' + i, name: 'A', end: '2026-10-01', progress: 10 });
  const base = { at: '2026-09-01', ms: Object.fromEntries(tasks.filter(t => t.milestone).map(t => [t.id, '2026-12-01'])) };
  const now = { at: '2026-10-28', ms: Object.fromEntries(tasks.filter(t => t.milestone).map((t, i) => [t.id, new Date(Date.UTC(2026, 11, 1) + shifts[i] * 864e5).toISOString().slice(0, 10)])) };
  return { tasks, settings: { snapshots: [base, now] } };
};
test('tidplan: gate flyttad ≥ 4 v röd, 1–3 v gul, försenade gul, annars grön', () => {
  assert.deepEqual(S.suggestTime(plan([0, 35, 0]), today), { v: 'R', code: 'slipBig', n: 1 });
  assert.deepEqual(S.suggestTime(plan([0, 14, 7]), today), { v: 'Y', code: 'slipSmall', n: 2 });
  assert.deepEqual(S.suggestTime(plan([0, 0, -21], 2), today), { v: 'Y', code: 'late', n: 2 });
  assert.equal(S.suggestTime(plan([0, 3, 0]), today).v, 'G');
});

test('risk: höga röd, försenade åtgärder gul, ingen lista gul, annars grön', () => {
  assert.equal(S.suggestRisk([], today).code, 'noRisks');
  assert.deepEqual(S.suggestRisk([{ p: 4, c: 4 }, { p: 1, c: 1 }], today), { v: 'R', code: 'riskHigh', n: 1 });
  assert.deepEqual(S.suggestRisk([{ p: 2, c: 2, ready: '2640' }], today), { v: 'Y', code: 'riskOver', n: 1 });
  assert.equal(S.suggestRisk([{ p: 2, c: 2, ready: '2650' }, { p: 5, c: 5, closed: true }], today).v, 'G');
});

test('leverabler från gate-checklistan och ekonomi enligt 5 %-regeln', () => {
  assert.equal(S.suggestDeliv(null), null);
  assert.equal(S.suggestDeliv({ total: 10, ok: 2, warn: 1, crit: 1 }).v, 'R');
  assert.equal(S.suggestDeliv({ total: 10, ok: 2, warn: 1, crit: 0 }).v, 'Y');
  assert.equal(S.suggestDeliv({ total: 10, ok: 10, warn: 0, crit: 0 }).v, 'G');
  assert.equal(S.moneyColour({ request: 10, forecast: 10 }), 'G');
  assert.equal(S.moneyColour({ request: 10, forecast: 10.5 }), 'Y');
  assert.equal(S.moneyColour({ request: 10, forecast: 10.6 }), 'R');
  assert.equal(S.moneyColour({ request: 10, forecast: null }), null);
  assert.equal(S.moneyColour({}), null);
});
