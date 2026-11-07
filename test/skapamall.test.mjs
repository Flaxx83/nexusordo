// Tester för Skapa mall (#73): plan → mall → templateTasks → likvärdig plan, ankare, urval, rensning och mallfilen.
// Bara påhittad data. Funktionerna läses direkt ur app/script.js. Kör: node --test "test/*.test.mjs"
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
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const uid = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/function parseWeek\([\s\S]*?\n}\n/),
  pick(/const normName = .*;/), pick(/const TPL_GATES = .*;/), pick(/const TPL_SEP = .*;/), pick(/const weekMon = .*;/), pick(/const gateCodeRe = .*;/),
  pick(/function repeatVals\([\s\S]*?\n}\n/), pick(/function repeatSlots\([\s\S]*?\n}\n/), pick(/function repeatSpan\([\s\S]*?\n}\n/), pick(/function templateTasks\([\s\S]*?\n}\n/), pick(/const PMI_GATE_RE = .*;/), pick(/const isGateMs = .*;/),
  pick(/const TP_CHUNK = .*|const TP_SHEET = .*;/), pick(/const tpObj = .*;/), pick(/function tpChunks\([\s\S]*?\n}\n/),
  pick(/const PALETTE_IDS = .*;/), pick(/const isHexColor = .*;/), pick(/function cleanPhaseColors\([\s\S]*?\n}\n/),
  blk('const TPL_FORMAT', '// Lagring: tp_templates'),
].join('\n');
const F = new Function('XLSX', 'TEMPLATE_LIB', code + '\nreturn { templateTasks, planToTemplate, templateLib, tplColorSettings, tplCounts, cleanTemplate, templateWorkbook, readTemplateWb, tplAnchorKey, toDay, fromDay, weekMon, parseWeek, TPL_SHEET };')(XLSX, JSON.parse(readFileSync(new URL('../mallar/mallbibliotek.json', import.meta.url), 'utf8')));
const { templateTasks, planToTemplate, templateLib, tplCounts, cleanTemplate, templateWorkbook, readTemplateWb, tplAnchorKey, toDay, weekMon, parseWeek } = F;

const CODES = ['FIKTIVVIEW01', 'FIKTIVOWNER2'];
const fiktiv = () => ({
  id: 'plan-fiktiv-1', name: 'Fiktiv plan Omega',
  settings: { owner: 'agare@exempel.se', sharedWith: ['pl@exempel.se'], viewCode: CODES[0], ownerCode: CODES[1], bucketOrder: ['Förstudie', 'Utveckling'],
    phaseCodes: { Förstudie: 'G1', Utveckling: 'G2' }, risks: [{ id: 'r1', desc: 'Fiktiv risk', owner: 'risk@exempel.se' }] },
  tasks: [
    { id: 'a1', name: 'Kravställning', bucket: 'Förstudie', start: '2027-01-06', end: '2027-01-29', progress: 50, deps: [], notes: 'hemlig anteckning',
      checks: [{ id: 'c1', text: 'Intressenter', done: true, src: 'tp' }, { id: 'c2', text: 'Krav', done: false, src: 'planner' }] },
    { id: 'a4', name: 'Granskning', bucket: 'Förstudie', start: '2027-01-25', end: '2027-01-29', deps: [] },
    { id: 'a2', name: 'Konceptval', bucket: 'Förstudie', start: '2027-02-01', end: '2027-02-19', deps: ['a1', 'a4'] },
    { id: 'g1', name: 'Gate G1', bucket: 'Förstudie', start: '2027-02-26', end: '2027-02-26', milestone: true, gate: true, deps: ['a2'] },
    { id: 'a3', name: 'Detaljkonstruktion', bucket: 'Utveckling', start: '2027-03-01', end: '2027-05-14', deps: ['g1'], assignees: 'person@exempel.se' },
    { id: 'm1', name: 'Kundmöte', bucket: 'Utveckling', start: '2027-04-14', end: '2027-04-14', milestone: true, deps: [] },
    { id: 'a5', name: 'Granskning', bucket: 'Utveckling', start: '2027-05-17', end: '2027-05-21', deps: ['a3'] },
    { id: 'a6', name: 'Leverans', bucket: 'Utveckling', start: '2027-05-24', end: '2027-05-28', deps: ['a5'] },
    { id: 'u1', name: 'Utan datum', bucket: 'Utveckling', deps: [] },
  ],
});
const wkOf = iso => weekMon(toDay(iso));
// Jämför två planer på veckonivå: namn, fas, start-/slutvecka, milstolpe, gate, beroenden (namn + fas) och checklistans text
function shape(tasks, shiftW = 0) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  return tasks.filter(t => t.start || t.end).map(t => ({
    name: t.name, bucket: t.bucket, s: wkOf(t.start || t.end) + shiftW * 7, e: wkOf(t.end || t.start) + shiftW * 7, ms: !!t.milestone, gate: !!t.gate,
    deps: (t.deps || []).map(d => byId.get(d)).filter(Boolean).map(x => x.bucket + '|' + x.name).sort(),
    checks: (t.checks || []).map(c => c.text),
  })).sort((a, b) => (a.bucket + a.name + a.s).localeCompare(b.bucket + b.name + b.s));
}
const build = (tpl, week) => templateTasks(templateLib(tpl), { groups: ['own'], gates: { [tpl.anchor.key]: parseWeek(week, true) } });

test('plan → mall: veckor relativt planens start (durW, endW) som i mallbiblioteket', () => {
  const tpl = planToTemplate(fiktiv(), { name: 'Omega-mall', description: 'Påhittad' });
  assert.equal(tpl.format, 'timeplan-template');
  assert.deepEqual(tpl.anchor, { key: 'START', name: 'Start' });
  assert.deepEqual(tpl.phases, [{ name: 'Förstudie', gate: 'G1' }, { name: 'Utveckling', gate: 'G2' }]);
  const it = n => tpl.groups[0].items.find(i => i.name === n);
  assert.deepEqual([it('Kravställning').endW, it('Kravställning').durW], [-3, 4]); // v1–v4 2027, start v1
  assert.deepEqual([it('Gate G1').endW, it('Gate G1').durW, it('Gate G1').milestone, it('Gate G1').gateMs], [-7, 0, true, true]);
  assert.ok(!it('Kundmöte').gateMs);
  assert.deepEqual(it('Kravställning').checks, ['Intressenter', 'Krav']);
  assert.ok(!tpl.groups[0].items.some(i => i.name === 'Utan datum'), 'aktiviteter utan datum följer inte med');
  assert.equal(tplCounts(tpl).items, 8);
});

test('beroenden blir after med namn; dubblettnamn får fasprefix', () => {
  const tpl = planToTemplate(fiktiv());
  const it = (n, ph) => tpl.groups[0].items.find(i => i.name === n && i.phase === ph);
  assert.deepEqual(it('Konceptval', 'Förstudie').after, ['Kravställning', 'Förstudie › Granskning']);
  assert.deepEqual(it('Leverans', 'Utveckling').after, ['Utveckling › Granskning']);
  assert.deepEqual(it('Detaljkonstruktion', 'Utveckling').after, ['Gate G1']);
});

test('rundresa plan → mall → templateTasks ger samma faser, veckor, beroenden och checklistor', () => {
  const p = fiktiv();
  const tpl = planToTemplate(p);
  const r = build(tpl, '2701');
  assert.deepEqual(shape(r.tasks), shape(p.tasks));
  assert.ok(r.tasks.every(t => (t.checks || []).every(c => c.done === false)), 'bockarna följer inte med');
  assert.equal(r.deps, tplCounts(tpl).deps);
  // Aktiviteter börjar måndag och slutar fredag; milstolpar behåller veckodagen (#77: day), annars fredag
  for (const t of r.tasks) {
    if (!t.milestone) { assert.equal(new Date(t.end).getUTCDay(), 5); assert.equal(new Date(t.start).getUTCDay(), 1); }
    else assert.equal(new Date(t.end).getUTCDay(), new Date(p.tasks.find(x => x.name === t.name).end).getUTCDay());
  }
  assert.equal(tpl.groups[0].items.find(i => i.name === 'Kundmöte').day, 2);
  assert.equal(r.tasks.find(t => t.name === 'Kundmöte').end, '2027-04-14');
});

test('ankare vid en gate: allt flyttas med gatens vecka', () => {
  const p = fiktiv();
  const tpl = planToTemplate(p, { anchor: 'g1' });
  assert.equal(tpl.anchor.key, 'G1');
  assert.equal(tpl.groups[0].items.find(i => i.name === 'Gate G1').endW, 0);
  assert.equal(tpl.groups[0].items.find(i => i.name === 'Kravställning').endW, 4);
  const r = build(tpl, '2718'); // G1 tio veckor senare än i planen (v8 → v18)
  assert.deepEqual(shape(r.tasks), shape(p.tasks, 10));
});

test('urval: bara valda aktiviteter, beroenden till icke valda tas bort, ankargaten tas med', () => {
  const tpl = planToTemplate(fiktiv(), { ids: ['a2', 'a3'], anchor: 'g1' });
  const names = tpl.groups[0].items.map(i => i.name);
  assert.deepEqual(names, ['Konceptval', 'Gate G1', 'Detaljkonstruktion']);
  assert.equal(tpl.groups[0].items[0].after, undefined);
  assert.deepEqual(tpl.groups[0].items[2].after, ['Gate G1']);
});

test('mallen innehåller inga koder, ägare, e-post, plan-id, anteckningar eller risker', () => {
  const json = JSON.stringify(cleanTemplate(planToTemplate(fiktiv())));
  for (const s of [...CODES, '@', 'plan-fiktiv-1', 'hemlig', 'Fiktiv risk', '"a1"', '"g1"', 'progress']) assert.ok(!json.includes(s), 'läcker: ' + s);
});

test('cleanTemplate: okända fält tas bort, skadade och nyare mallar avvisas', () => {
  const tpl = planToTemplate(fiktiv());
  const dirty = { ...tpl, owner: 'x@exempel.se', viewCode: CODES[0], groups: [{ ...tpl.groups[0], items: tpl.groups[0].items.map(i => ({ ...i, id: 'a1', ownerCode: CODES[1] })) }] };
  const c = cleanTemplate(dirty);
  assert.ok(!JSON.stringify(c).includes(CODES[0]) && !JSON.stringify(c).includes(CODES[1]) && !JSON.stringify(c).includes('@'));
  assert.deepEqual(c, cleanTemplate(tpl));
  assert.throws(() => cleanTemplate({ ...tpl, format: 'annat' }), /skadad/);
  assert.throws(() => cleanTemplate({ ...tpl, version: 99 }), /nyare version/);
  assert.throws(() => cleanTemplate({ ...tpl, groups: [{ items: [{ name: 'x', endW: 1.5, durW: 1 }] }] }), /skadad/);
  assert.throws(() => cleanTemplate(null), /skadad/);
});

test('mallfilen: dold flik TimePlan-mall, läses tillbaka till samma mall', () => {
  const tpl = cleanTemplate(planToTemplate(fiktiv(), { name: 'Omega-mall', description: 'Påhittad mall' }));
  const wb = templateWorkbook(tpl);
  assert.ok(wb.SheetNames.includes(F.TPL_SHEET));
  assert.equal(wb.Workbook.Sheets.find(s => s.name === F.TPL_SHEET).Hidden, 1);
  const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  assert.deepEqual(readTemplateWb(back), tpl);
  // Och ger samma plan som originalet
  assert.deepEqual(shape(build(readTemplateWb(back), '2701').tasks), shape(fiktiv().tasks));
});

test('Lägg till från mall: fasen hamnar i planens fas och dubbletter läggs inte till', () => {
  const tpl = planToTemplate(fiktiv());
  const existing = [{ id: 'x1', name: 'Kravställning', bucket: 'FÖRSTUDIE', start: '2027-01-04', end: '2027-01-29', deps: [] }];
  const bucketOf = ph => ph === 'Förstudie' ? 'FÖRSTUDIE' : ph;
  const r = templateTasks(templateLib(tpl), { groups: ['own'], gates: { START: parseWeek('2701', true) }, bucketOf }, existing);
  assert.deepEqual(r.dupes, ['Kravställning']);
  const k = r.tasks.find(t => t.name === 'Konceptval');
  assert.equal(k.bucket, 'FÖRSTUDIE');
  assert.ok(k.deps.includes('x1'), 'beroendet pekar på den befintliga aktiviteten');
});

test('ankarets nyckel: PMI-gate eller MS', () => {
  assert.equal(tplAnchorKey({ name: 'Gate G2' }), 'G2');
  assert.equal(tplAnchorKey({ name: 'G4 Closing' }), 'G4');
  assert.equal(tplAnchorKey({ name: 'Gate R signed' }), 'MS', 'inga leverantörsspecifika gater');
  assert.equal(tplAnchorKey({ name: 'Kundmöte' }), 'MS');
});

test('mall (#83): beroendetyp och fördröjning följer med i afterInfo, rensas och ger depInfo i den nya planen', () => {
  const p = fiktiv();
  const a2 = p.tasks.find(t => t.id === 'a2'); a2.depInfo = { a1: { type: 'SS', lag: 2, src: 'planner' } };
  const a5 = p.tasks.find(t => t.id === 'a5'); a5.depInfo = { a3: { type: 'FF', lag: -1 } };
  const tpl = planToTemplate(p, { name: 'Omega-mall' });
  assert.deepEqual(tpl.groups[0].items.find(x => x.name === 'Konceptval').afterInfo, { Kravställning: { type: 'SS', lag: 2 } });
  const clean = cleanTemplate(JSON.parse(JSON.stringify({ ...tpl, groups: [{ ...tpl.groups[0], items: tpl.groups[0].items.map(x => x.name === 'Konceptval' ? { ...x, afterInfo: { ...x.afterInfo, 'Okänd': { type: 'FF' }, Kravställning: { type: 'SS', lag: 2, src: 'x', extra: 1 } } } : x) }] })));
  assert.deepEqual(clean.groups[0].items.find(x => x.name === 'Konceptval').afterInfo, { Kravställning: { type: 'SS', lag: 2 } });
  const res = build(clean, '2710');
  const by = n => res.tasks.find(t => t.name === n && (n !== 'Granskning' || t.bucket === 'Utveckling'));
  assert.deepEqual(by('Konceptval').depInfo, { [by('Kravställning').id]: { type: 'SS', lag: 2 } });
  assert.deepEqual(by('Granskning').depInfo, { [by('Detaljkonstruktion').id]: { type: 'FF', lag: -1 } });
  assert.equal(by('Leverans').depInfo, undefined, 'vanligt slut–start utan info');
});
