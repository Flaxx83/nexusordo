// Tester för versionshistorik och papperskorg (#76): rotation, skillnad mot nu, återställning med samma koder och papperskorgen.
// Bara påhittad data. Funktionerna läses direkt ur app/script.js. Kör: node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const code = [
  pick(/const DAY = .*;/), pick(/const VER_KEEP = .*;/),
  pick(/function pruneVersions\([\s\S]*?\n}\n/), pick(/const sameDay = .*;/),
  pick(/function verCounts\([\s\S]*?\n}\n/), pick(/function verDiff\([\s\S]*?\n}\n/),
  pick(/function restoreFrom\([\s\S]*?\n}\n/),
  pick(/const isDeleted = .*;/), pick(/const trashDays = .*;/), pick(/const trashExpired = .*;/), pick(/const splitTrash = .*;/),
  pick(/const TP_SECRET = .*;/), pick(/const tpObj = .*;/), pick(/const tpClean = .*;/), pick(/const tpSettings = .*;/),
].join('\n');
const f = new Function(code + '\nreturn { pruneVersions, sameDay, verCounts, verDiff, restoreFrom, isDeleted, trashDays, trashExpired, splitTrash, tpSettings, VER_KEEP, VER_WEEKS, VER_KEEP_LOCAL, TRASH_DAYS };')();
const { pruneVersions, sameDay, verCounts, verDiff, restoreFrom, isDeleted, trashDays, trashExpired, splitTrash, tpSettings } = f;

const NOW = '2026-11-02T12:00:00.000Z';
const ago = (days, h = 0) => new Date(Date.parse(NOW) - days * 864e5 - h * 36e5).toISOString();

test('standardvärden: 30 versioner, 8 veckor, 10 lokalt, 30 dagar i papperskorgen', () => {
  assert.equal(f.VER_KEEP, 30); assert.equal(f.VER_WEEKS, 8); assert.equal(f.VER_KEEP_LOCAL, 10); assert.equal(f.TRASH_DAYS, 30);
});

test('rotation: under taket tas inget bort', () => {
  const vs = Array.from({ length: 12 }, (_, i) => ({ id: 'v' + i, at: ago(i) }));
  assert.deepEqual(pruneVersions(vs, NOW), []);
});

test('rotation: de 30 senaste behålls, äldre utan veckoskydd tas bort', () => {
  // 40 versioner samma dag (t.ex. många uppdateringar) → de 10 äldsta tas bort
  const vs = Array.from({ length: 40 }, (_, i) => ({ id: 'v' + i, at: ago(0, i * 0.1) }));
  const drop = pruneVersions(vs, NOW);
  assert.equal(drop.length, 10);
  assert.deepEqual(new Set(drop), new Set(Array.from({ length: 10 }, (_, i) => 'v' + (30 + i))));
});

test('rotation: minst en per vecka i 8 veckor även när de 30 senaste är från idag', () => {
  const today = Array.from({ length: 35 }, (_, i) => ({ id: 't' + i, at: ago(0, i * 0.1) }));
  const weekly = Array.from({ length: 10 }, (_, w) => ({ id: 'w' + w, at: ago(w * 7 + 3) })); // en mitt i varje vecka bakåt
  const drop = new Set(pruneVersions([...today, ...weekly], NOW));
  for (let w = 1; w < 8; w++) assert.ok(!drop.has('w' + w), `vecka ${w} ska behållas`);
  assert.ok(drop.has('w8') && drop.has('w9'), 'äldre än 8 veckor tas bort');
  assert.ok(drop.has('t34'), 'överskott från idag tas bort');
  assert.ok(!drop.has('t0'));
});

test('rotation: bara den senaste i en vecka skyddas', () => {
  const vs = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i, at: ago(0, i * 0.1) })),
    { id: 'a', at: ago(10) }, { id: 'b', at: ago(11) }, { id: 'c', at: ago(12) },
  ];
  const drop = pruneVersions(vs, NOW);
  assert.deepEqual(drop.sort(), ['b', 'c']);
});

test('rotation lokalt: tak 10, inga veckor', () => {
  const vs = Array.from({ length: 14 }, (_, i) => ({ id: 'v' + i, at: ago(i * 3) }));
  assert.equal(pruneVersions(vs, NOW, 10, 0).length, 4);
});

test('samma dag avgör den dagliga kopian', () => {
  assert.ok(sameDay(NOW, NOW));
  assert.ok(!sameDay(ago(1), NOW));
});

const fictive = () => ({
  name: 'Fiktiv plan A',
  tasks: [
    { id: 't1', name: 'Konceptstudie', bucket: 'Initiating', start: '2026-11-02', end: '2026-11-27', progress: 50, deps: [] },
    { id: 't2', name: 'Gate G1', bucket: 'Initiating', start: '2026-12-04', end: '2026-12-04', progress: 0, deps: ['t1'], milestone: true },
    { id: 't3', name: 'Offertförfrågan', bucket: 'Planning', start: '2026-12-07', end: '2027-01-15', progress: 0, deps: ['t2'] },
  ],
  settings: {
    risks: [{ id: 'r1', desc: 'Leveransrisk', p: 3, c: 4 }], status: [{ week: '2645', overall: 'Y' }],
    gateChecks: { F: { 1: { s: 0 }, 2: { s: 50 } } },
  },
  imported_at: '2026-10-20T08:00:00.000Z',
});

test('antal: aktiviteter, risker, beroenden, statusveckor och checklistsvar', () => {
  assert.deepEqual(verCounts('plan', fictive()), { tasks: 3, risks: 1, deps: 2, status: 1, checks: 2 });
  assert.deepEqual(verCounts('program', { plans: [{ planId: 'a' }, { planId: 'b' }], dependencies: [{}], milestones: [] }), { plans: 2, deps: 1, ms: 0 });
  assert.deepEqual(verCounts('plan', null), { tasks: 0, risks: 0, deps: 0, status: 0, checks: 0 });
});

test('skillnad: en dålig ny import (risker borta, ny aktivitet, ändrade datum)', () => {
  const ver = fictive();
  const cur = fictive();
  cur.tasks = [{ ...cur.tasks[0], end: '2026-12-11' }, { id: 't9', name: 'Ny aktivitet', bucket: 'Övrigt', deps: [] }];
  cur.settings.risks = [];
  const d = verDiff('plan', ver, cur);
  assert.deepEqual(d.onlyVer, ['Gate G1', 'Offertförfrågan']);
  assert.deepEqual(d.onlyCur, ['Ny aktivitet']);
  assert.deepEqual(d.changed, ['Konceptstudie']);
  assert.deepEqual(d.counts.find(c => c.k === 'risks'), { k: 'risks', ver: 1, cur: 0 });
  assert.equal(d.name, null);
});

test('skillnad: identiska ger inga listor', () => {
  const d = verDiff('plan', fictive(), fictive());
  assert.deepEqual([d.onlyVer, d.onlyCur, d.changed, d.name], [[], [], [], null]);
});

test('skillnad för program: planer som bara finns i den ena', () => {
  const d = verDiff('program', { name: 'P', plans: [{ planId: 'a' }, { planId: 'b' }] }, { name: 'P', plans: [{ planId: 'b' }, { planId: 'c' }] });
  assert.deepEqual([d.onlyVer, d.onlyCur], [['a'], ['c']]);
});

test('återställning: innehållet från versionen, utan papperskorgens markering', () => {
  const ver = fictive();
  ver.settings.deleted_at = '2026-10-21T08:00:00.000Z';
  const cur = { id: 'plan-1', name: 'Fiktiv plan A', tasks: [], settings: {} };
  const r = restoreFrom('plan', ver, cur);
  assert.equal(r.tasks.length, 3);
  assert.equal(r.settings.risks.length, 1);
  assert.equal('deleted_at' in r.settings, false);
  assert.equal(r.imported_at, '2026-10-20T08:00:00.000Z');
  assert.equal('id' in r, false, 'id ändras aldrig');
  // versionens data ändras inte (djup kopia)
  r.tasks[0].name = 'x';
  assert.equal(ver.tasks[0].name, 'Konceptstudie');
});

test('återställning tar bort deleted_at och deleted_by', () => {
  const ver = fictive();
  ver.settings.deleted_at = '2026-10-30T10:00:00Z'; ver.settings.deleted_by = 'x';
  const r = restoreFrom('plan', ver, { name: 'Fiktiv plan A', settings: {} });
  assert.equal(r.settings.deleted_at, undefined);
  assert.equal(r.settings.deleted_by, undefined);
});

test('uppdatera → återställ föregående → ångra återställningen (kedja av versioner)', () => {
  const versions = [];
  let cur = { id: 'plan-1', ...fictive() };
  const save = reason => versions.push({ reason, data: JSON.parse(JSON.stringify({ name: cur.name, tasks: cur.tasks, settings: cur.settings, imported_at: cur.imported_at })) });
  // Uppdatering som tappar aktiviteter och risker – version sparas före
  save('update');
  cur = { ...cur, tasks: cur.tasks.slice(0, 1), settings: { ...cur.settings, risks: [] } };
  // Återställ föregående: nuvarande sparas först
  save('restore');
  cur = { id: cur.id, ...restoreFrom('plan', versions[0].data, cur) };
  assert.equal(cur.tasks.length, 3); assert.equal(cur.settings.risks.length, 1);
  // Ångra återställningen = återställ versionen "Före återställning"
  save('restore');
  cur = { id: cur.id, ...restoreFrom('plan', versions[1].data, cur) };
  assert.equal(cur.tasks.length, 1); assert.equal(cur.settings.risks.length, 0);
  assert.equal(cur.id, 'plan-1');
});

test('program återställs med versionens planer och beroenden', () => {
  const ver = { name: 'Fiktivt program', plans: [{ planId: 'a' }], dependencies: [{ id: 'd1' }], milestones: [], requests: [], settings: {} };
  const r = restoreFrom('program', ver, { name: 'Fiktivt program', settings: {} });
  assert.deepEqual(r.plans, [{ planId: 'a' }]);
  assert.equal(r.dependencies.length, 1);
});

test('papperskorg: borttagna skiljs ut, 30 dagar räknas från deleted_at', () => {
  const a = { id: 'a', settings: {} }, b = { id: 'b', settings: { deleted_at: ago(5) } }, c = { id: 'c', settings: { deleted_at: ago(31) } };
  const { live, trash } = splitTrash([a, b, c]);
  assert.deepEqual(live.map(x => x.id), ['a']);
  assert.deepEqual(trash.map(x => x.id), ['b', 'c']);
  assert.ok(!isDeleted(a) && isDeleted(b));
  assert.equal(trashDays(b, NOW), 5);
  assert.ok(!trashExpired(b, NOW));
  assert.ok(trashExpired(c, NOW));
  assert.ok(trashExpired({ settings: { deleted_at: ago(30) } }, NOW));
  assert.ok(!trashExpired({ settings: { deleted_at: ago(29, 23) } }, NOW));
});

test('export (#69) tar bort deleted_at, koder och ägare', () => {
  const s = tpSettings({ owner: 'x', viewCode: 'A', ownerCode: 'B', sharedWith: ['y'], deleted_at: ago(1), deleted_by: 'x', risks: [{ owner: 'Anna' }] });
  assert.deepEqual(s, { risks: [{ owner: 'Anna' }] });
});

test('återställa en version: alltid tillåtet när planen eller programmet finns', () => {
  const canRestoreVer = new Function(pick(/const canRestoreVer = .*;/) + '\nreturn canRestoreVer;')();
  for (const kind of ['plan', 'program']) assert.equal(canRestoreVer(kind, { settings: {} }), true, kind);
  assert.equal(canRestoreVer('plan', null), false);
});
