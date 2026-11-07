// Tester för risklistan (#38). Funktionerna läses direkt ur app/script.js.
// Kör: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const code = [
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/function parseWeek\([\s\S]*?\n}\n/),
  pick(/const riskValue = .*;/), pick(/const riskBand = .*;/), pick(/const riskHigh = .*;/), pick(/const riskReadyDay = .*;/),
  pick(/function riskSort\([\s\S]*?\n}\n/), pick(/const riskTop5 = .*;/), pick(/function riskDue\([\s\S]*?\n}\n/),
].join('\n');
const R = new Function(code + '\nreturn { riskValue, riskBand, riskHigh, riskSort, riskTop5, riskDue, toDay };')();
const r = (no, p, c, extra = {}) => ({ id: 'r' + no, no, p, c, status: 'Y', ...extra });

test('riskvärde = sannolikhet × konsekvens', () => {
  assert.equal(R.riskValue(r(1, 4, 5)), 20);
  assert.equal(R.riskValue(r(2, null, 3)), 0);
});

test('färgband för värdet (NexusOrdos egna)', () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 14, 15, 25].map(R.riskBand), [null, 'green', 'green', 'yellow', 'yellow', 'orange', 'orange', 'red', 'red']);
});

test('hög risk = värde ≥ 15 eller status röd, men inte stängd', () => {
  assert.ok(R.riskHigh(r(1, 3, 5)));
  assert.ok(R.riskHigh(r(2, 1, 1, { status: 'R' })));
  assert.ok(!R.riskHigh(r(3, 5, 5, { closed: true })));
  assert.ok(!R.riskHigh(r(4, 2, 3)));
});

test('sortering på värde (fallande, numret avgör vid lika) och topp 5 utan stängda', () => {
  const rs = [r(1, 2, 2), r(2, 5, 5, { closed: true }), r(3, 3, 4), r(4, 4, 3), r(5, 1, 1), r(6, 5, 4), r(7, 2, 3), r(8, 1, 2)];
  assert.deepEqual(R.riskSort(rs, 'value', -1).map(x => x.no), [2, 6, 3, 4, 7, 1, 8, 5]);
  assert.deepEqual(R.riskSort(rs, 'no', 1).map(x => x.no), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(R.riskTop5(rs).map(x => x.no), [6, 3, 4, 7, 1]);
});

test('åtgärder försenade eller inom två veckor (klar senast = fredag i veckan)', () => {
  const idag = R.toDay('2026-10-29'); // torsdag v44
  const rs = [r(1, 3, 3, { ready: '2643' }), r(2, 3, 3, { ready: '2644' }), r(3, 3, 3, { ready: '2645' }), r(4, 3, 3, { ready: '2646' }),
    r(5, 3, 3, { ready: '2640', closed: true }), r(6, 3, 3, { ready: '2645/2650' }), r(7, 3, 3, {})];
  const d = R.riskDue(rs, idag);
  assert.deepEqual(d.over.map(x => x.no), [1]);
  assert.deepEqual(d.soon.map(x => x.no), [2, 3, 6]);
});
