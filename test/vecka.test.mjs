// Tester för vecka som ÅÅVV (#39). Funktionerna läses direkt ur app/script.js.
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
].join('\n');
const { parseWeek, fmtYYWW, toDay, fromDay } = new Function(code + '\nreturn { parseWeek, fmtYYWW, toDay, fromDay };')();

test('ÅÅVV för ett datum', () => {
  assert.equal(fmtYYWW(toDay('2026-11-02')), '2645');
  assert.equal(fmtYYWW(toDay('2026-12-31')), '2653'); // 2026 har vecka 53
  assert.equal(fmtYYWW(toDay('2027-01-01')), '2653');
  assert.equal(fmtYYWW(toDay('2027-01-04')), '2701');
  assert.equal(fmtYYWW(null), '');
});

test('2645 blir måndag vecka 45 2026, fredag som slutdatum', () => {
  assert.equal(fromDay(parseWeek('2645')), '2026-11-02');
  assert.equal(fromDay(parseWeek('2645', true)), '2026-11-06');
});

test('andra skrivsätt', () => {
  assert.equal(fromDay(parseWeek('26-45')), '2026-11-02');
  assert.equal(fromDay(parseWeek('v45 2026')), '2026-11-02');
  assert.equal(fromDay(parseWeek('W45-26')), '2026-11-02');
  assert.equal(fromDay(parseWeek('2653')), '2026-12-28');
});

test('ogiltiga veckor ger null', () => {
  assert.equal(parseWeek('2654'), null);
  assert.equal(parseWeek('2553'), null); // 2025 har bara 52 veckor
  assert.equal(parseWeek('hej'), null);
  assert.equal(parseWeek(''), null);
});
