// Tester för statusberäkningen av beroenden mellan projekt (#19).
// Funktionerna läses direkt ur app/script.js så att det är samma kod som i appen.
// Kör: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const code = [
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/),
  pick(/function depStatus\([\s\S]*?\n}\n/),
].join('\n');
const { depStatus, toDay } = new Function(code + '\nreturn { depStatus, toDay };')();

const T = (start, end, progress = 0) => ({ start, end, progress });
const idag = toDay('2026-10-22');

test('blockerad när efterföljaren startar innan föregångaren är klar (fiktiva projekt)', () => {
  const r = depStatus(T('2026-08-31', '2026-11-13', 40), T('2026-07-01', '2026-10-29'), { type: 'FS' }, idag);
  assert.equal(r.status, 'blockerad');
  assert.equal(r.margin, toDay('2026-07-01') - toDay('2026-11-13') - 1);
});

test('ok med god marginal', () => {
  const r = depStatus(T('2026-06-15', '2026-10-15', 80), T('2026-11-02', '2027-01-01'), { type: 'FS' }, toDay('2026-10-01'));
  assert.deepEqual(r, { status: 'ok', margin: 17 });
});

test('risk med under en veckas marginal ("precis")', () => {
  const r = depStatus(T('2026-12-07', '2027-01-29'), T('2027-02-01', '2027-06-30'), { type: 'FS' }, idag);
  assert.deepEqual(r, { status: 'risk', margin: 2 });
});

test('risk när föregångaren är försenad trots marginal', () => {
  const r = depStatus(T('2026-06-01', '2026-09-30', 50), T('2026-12-01', '2027-01-31'), { type: 'FS' }, idag);
  assert.equal(r.status, 'risk');
});

test('klar när föregångaren är klar, oavsett datum', () => {
  assert.equal(depStatus(T('2026-01-01', '2026-12-31', 100), T('2026-02-01', '2026-03-01'), {}, idag).status, 'klar');
});

test('fördröjning räknas med', () => {
  const r = depStatus(T('2026-01-01', '2026-01-10'), T('2026-01-20', '2026-02-01'), { type: 'FS', lag: 14 }, toDay('2026-01-01'));
  assert.deepEqual(r, { status: 'blockerad', margin: -5 });
});

test('start → start och slut → slut', () => {
  assert.equal(depStatus(T('2026-03-01', '2026-06-01'), T('2026-02-15', '2026-07-01'), { type: 'SS' }, toDay('2026-01-01')).status, 'blockerad');
  assert.deepEqual(depStatus(T('2026-03-01', '2026-06-01'), T('2026-04-01', '2026-06-20'), { type: 'FF' }, toDay('2026-01-01')), { status: 'ok', margin: 19 });
});

test('saknas när en aktivitet inte finns eller saknar datum', () => {
  assert.equal(depStatus(null, T('2026-01-01', '2026-01-02'), {}, idag).status, 'saknas');
  assert.equal(depStatus(T(null, null), T('2026-01-01', '2026-01-02'), {}, idag).status, 'saknas');
});
