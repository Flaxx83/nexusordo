// Baslinjer (#5): spara, avvikelse, sammanfattning och vitlistan för filer. Påhittad data. Kör: node --test "test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  blk('/* ---------- Baslinjer (#5)', '/* ---------- slut baslinjer')].join('\n');
const F = new Function(code + '\nreturn { BL_MAX, makeBaseline, baselinesOf, baselineVar, baselineSummary, cleanBaselines };')();

const plan = () => [
  { id: 'a', name: 'Förstudie', start: '2026-01-05', end: '2026-02-27' },
  { id: 'b', name: 'Konstruktion', start: '2026-03-02', end: '2026-05-29' },
  { id: 'g', name: 'Gate 1', end: '2026-05-29', milestone: true },
  { id: 'u', name: 'Utan datum' },
];

test('makeBaseline sparar start och slut för aktiviteter och milstolpar med datum', () => {
  const bl = F.makeBaseline(plan(), '  Inför gate 1 ', '2026-01-02T08:00:00Z', 'bl1');
  assert.deepEqual(bl, { id: 'bl1', name: 'Inför gate 1', at: '2026-01-02T08:00:00Z',
    tasks: { a: { s: '2026-01-05', e: '2026-02-27' }, b: { s: '2026-03-02', e: '2026-05-29' }, g: { s: '2026-05-29', e: '2026-05-29' } } });
  assert.equal(F.makeBaseline([], '').name, 'Baslinje');
  assert.ok(F.makeBaseline([], 'x').id.startsWith('bl'));
});

test('baselineVar ger avvikelsen i dagar (positivt = senare)', () => {
  const bl = F.makeBaseline(plan(), 'B', 'x', 'bl1');
  const now = plan(); now[1].start = '2026-03-09'; now[1].end = '2026-06-05'; now[0].end = '2026-02-20';
  assert.deepEqual(F.baselineVar(now[1], bl), { s: '2026-03-02', e: '2026-05-29', ds: 7, de: 7 });
  assert.equal(F.baselineVar(now[0], bl).de, -7);
  assert.equal(F.baselineVar(now[2], bl).de, 0);
  assert.equal(F.baselineVar({ id: 'ny', start: '2026-01-01', end: '2026-01-02' }, bl), null, 'ny aktivitet');
  assert.equal(F.baselineVar({ id: 'a' }, bl), null, 'saknar datum nu');
  assert.equal(F.baselineVar(now[0], null), null);
});

test('baselineSummary räknar senare, tidigare, oförändrade, nya och borttagna', () => {
  const bl = F.makeBaseline(plan(), 'B', 'x', 'bl1');
  const now = plan().filter(t => t.id !== 'g');
  now[1].end = '2026-06-12'; now[0].end = '2026-02-20';
  now.push({ id: 'n', name: 'Ny', start: '2026-04-01', end: '2026-04-10' });
  assert.deepEqual(F.baselineSummary(now, bl), { later: 1, earlier: 1, same: 0, added: 1, removed: 1, maxLate: 14 });
  assert.deepEqual(F.baselineSummary(now, null), { later: 0, earlier: 0, same: 0, added: 0, removed: 0, maxLate: 0 });
});

test('baslinjen överlever att aktiviteterna byts ut (samma id efter import)', () => {
  const bl = F.makeBaseline(plan(), 'B', 'x', 'bl1');
  const imported = plan().map(t => ({ ...t, name: t.name + ' (ny text)' }));
  assert.equal(F.baselineSummary(imported, bl).same, 3);
});

test('cleanBaselines släpper bara igenom giltiga baslinjer, högst BL_MAX', () => {
  const ok = F.makeBaseline(plan(), 'B', '2026-01-02T08:00:00Z', 'bl1');
  const out = F.cleanBaselines([ok, ok, { id: 'x' }, null, 'text', { id: 'bad', tasks: { a: { s: 'igår', e: '2026-01-01' }, b: { s: '2026-01-01', e: '2026-01-02', extra: 1 } }, name: 5, viewCode: 'K' }]);
  assert.equal(out.length, 2, 'dubbletter och skräp bort');
  assert.deepEqual(out[1], { id: 'bad', name: '5', at: '', tasks: { b: { s: '2026-01-01', e: '2026-01-02' } } });
  assert.deepEqual(F.cleanBaselines('x'), []);
  const many = Array.from({ length: 15 }, (_, i) => F.makeBaseline(plan(), 'B' + i, 'x', 'bl' + i));
  assert.equal(F.cleanBaselines(many).length, F.BL_MAX);
  assert.equal(F.BL_MAX, 11);
});

test('appens kod: baslinjen följer med i filen och visas i Gantt, tooltip och panel', () => {
  assert.match(src, /settings: tpBaselines\(tpBurn\(/, 'readExport rensar baslinjerna');
  assert.match(src, /\$\{blMark\(t, yc\)\}<g class="bar/, 'grå stapel under aktiviteten');
  assert.match(src, /\$\{blTipRow\(t\)\}/);
  assert.match(src, /blPanelHTML\(t\)/);
  assert.match(src, /act === 'baselines'/);
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-act="baselines" class="no-prog"/);
  assert.match(html, /id="blSel"/);
});
