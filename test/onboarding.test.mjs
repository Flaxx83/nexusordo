// Onboarding i steg (#60): rundturerna pekar på element som finns, har titel och minst två steg,
// och Nytt-markeringen styrs av release-datum. Kör: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const toursSrc = pick(/function tours\(\) \{[\s\S]*?\n}\n/);

const code = [pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const TOUR_NEW_DAYS = .*;/),
  pick(/const newTours = [\s\S]*?\);\n/)].join('\n');
const { newTours } = new Function(code + '\nreturn { newTours };')();
// tours() med tr som identitet och stubbar för det som bara används när rundturen körs
const tours = new Function('tr', '$', 'hasPlanTasks', 'showView', 'closeDrawer', 'pf', 'ui', toursSrc + '\nreturn tours;')(s => s, () => null, () => false, () => {}, () => {}, null, {});

test('varje rundtur har titel och minst två steg med titel och text', () => {
  const all = tours();
  assert.ok(all.length >= 8);
  for (const t of all) {
    assert.ok(t.title, t.id);
    assert.ok(t.steps.length >= 2, `${t.id} har för få steg`);
    for (const s of t.steps) assert.ok(s.sel && s.title && s.text, `${t.id}: steg saknar sel/title/text`);
  }
  assert.ok(all.some(t => t.id === 'intro' && t.kind === 'intro'));
  for (const t of all.filter(t => t.kind === 'new')) assert.match(t.since, /^\d{4}-\d{2}-\d{2}$/);
});

test('statiska selektorer (#id och [data-…]) finns i index.html eller skapas i script.js', () => {
  const sels = tours().flatMap(t => t.steps.flatMap(s => s.sel.split(',').map(x => x.trim())));
  for (const sel of sels) {
    for (const id of sel.match(/#[A-Za-z][\w-]*/g) || []) {
      const name = id.slice(1);
      assert.ok(html.includes(`id="${name}"`) || src.includes(`id="${name}"`), `saknas: ${id}`);
    }
    for (const m of sel.matchAll(/\[data-([\w-]+)="([^"]+)"\]/g)) {
      const attr = `data-${m[1]}="${m[2]}"`;
      const dyn = new RegExp(`data-${m[1]}="\\$\\{|\\['${m[2]}'|'${m[2]}'`);
      assert.ok(html.includes(attr) || src.includes(attr) || dyn.test(src), `saknas: ${sel}`);
    }
  }
});

test('Nytt visas i 14 dagar från release-datum', () => {
  const t = [{ id: 'a', kind: 'new', since: '2026-10-28' }, { id: 'b', kind: 'new', since: '2026-10-01' }, { id: 'c', kind: 'page' }];
  assert.deepEqual(newTours(t, '2026-10-28').map(x => x.id), ['a']);
  assert.deepEqual(newTours(t, '2026-11-10').map(x => x.id), ['a']);
  assert.deepEqual(newTours(t, '2026-11-11').map(x => x.id), []);
  assert.deepEqual(newTours(t, '2026-10-27').map(x => x.id), []); // inte före release
  assert.deepEqual(newTours(t, '2026-10-10', 30).map(x => x.id), ['b']);
});
