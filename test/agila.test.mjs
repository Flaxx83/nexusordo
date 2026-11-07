// Tester för agila mallar (#77): upprepningsblock (repeat), Scrum, PI-planering (SAFe-inspirerad) och hybrid PMI + sprintar.
// Bara påhittad data. Funktionerna läses direkt ur app/script.js. Kör: node --test "test/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const XLSX = require('../app/vendor/xlsx.full.min.js');
const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const lib = JSON.parse(readFileSync(new URL('../mallar/mallbibliotek.json', import.meta.url), 'utf8'));
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const uid = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/function parseWeek\([\s\S]*?\n}\n/),
  pick(/const normName = .*;/), pick(/const TPL_GATES = .*;/), pick(/const TPL_SEP = .*;/), pick(/const weekMon = .*;/), pick(/const gateCodeRe = .*;/),
  pick(/const agileGroups = .*;/), pick(/const agileLib = .*;/),
  pick(/function repeatVals\([\s\S]*?\n}\n/), pick(/function repeatSlots\([\s\S]*?\n}\n/), pick(/function repeatSpan\([\s\S]*?\n}\n/),
  pick(/function templateTasks\([\s\S]*?\n}\n/), pick(/const PMI_GATE_RE = .*;/), pick(/const isGateMs = .*;/),
  pick(/const TP_CHUNK = .*|const TP_SHEET = .*;/), pick(/const tpObj = .*;/), pick(/function tpChunks\([\s\S]*?\n}\n/),
  pick(/const PALETTE_IDS = .*;/), pick(/const isHexColor = .*;/), pick(/function cleanPhaseColors\([\s\S]*?\n}\n/),
  blk('const TPL_FORMAT', '// Lagring: tp_templates'),
].join('\n');
const F = new Function('XLSX', 'TEMPLATE_LIB', code + '\nreturn { planToTemplate, templateTasks, repeatVals, repeatSlots, agileGroups, agileLib, cleanTemplate, templateLib, templateWorkbook, readTemplateWb, parseWeek, toDay, fromDay };')(XLSX, lib);
const { planToTemplate, templateTasks, repeatVals, agileGroups, agileLib, cleanTemplate, templateLib, templateWorkbook, readTemplateWb, parseWeek, toDay } = F;

const wk = s => parseWeek(s, true);
const G = id => lib.groups.find(g => g.id === id);
const run = (id, repeat, gates, more = []) => templateTasks(agileLib(lib, G(id)), { groups: [...more, id], gates, repeat });
const inB = (r, b) => r.tasks.filter(t => t.bucket === b);
const one = (r, b, n) => r.tasks.find(t => t.bucket === b && t.name === n);
const dow = iso => new Date(iso + 'T00:00:00Z').getUTCDay(); // 1 = måndag, 5 = fredag
// Samma regel som pilarna i Gantt: röd när efterföljaren börjar samma dag eller före föregångaren slutar (milstolpe samma dag är OK)
const red = tasks => {
  const by = new Map(tasks.map(t => [t.id, t]));
  return tasks.flatMap(t => (t.deps || []).map(d => by.get(d)).filter(p => p && toDay(t.start || t.end) <= toDay(p.end || p.start) && !(t.milestone && toDay(t.end) >= toDay(p.end))).map(p => p.name + ' → ' + t.name));
};
const START = { START: wk('2645') }; // måndag 2026-11-02

test('repeatVals: standard, gränser och värden från fälten', () => {
  const sc = G('scrum').repeat, pi = G('pi').repeat;
  assert.deepEqual(repeatVals(sc), { count: 6, lenW: 2, every: 3 });
  assert.deepEqual(repeatVals(sc, { count: '6', lenW: '3', every: '0' }), { count: 6, lenW: 3, every: 0 });
  assert.deepEqual(repeatVals(sc, { count: 40, lenW: 9 }), { count: 26, lenW: 4, every: 3 });   // sprintar 1–4 veckor, 1–26
  assert.deepEqual(repeatVals(sc, { count: 0, lenW: '' }), { count: 1, lenW: 2, every: 3 });
  assert.deepEqual(repeatVals(pi, { count: 12, lenW: 6 }), { count: 8, lenW: 8, every: 0 });     // PI 8–12 veckor, 1–8
  assert.deepEqual(repeatVals(pi, { lenW: 13 }), { count: 4, lenW: 12, every: 0 });
});

test('Scrum 6 sprintar à 2 veckor: Sprint 0, sex sprintar med rätt datum och händelser', () => {
  const r = run('scrum', { count: 6, lenW: 2 }, START);
  assert.deepEqual(r.order, ['Sprint 0', 'Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4', 'Sprint 5', 'Sprint 6', 'Releases']);
  assert.equal(one(r, 'Sprint 0', 'Product Backlog').start, '2026-11-02');
  assert.equal(one(r, 'Sprint 0', 'Definition of Done').end, '2026-11-06');
  for (let n = 1; n <= 6; n++) {
    const b = 'Sprint ' + n, s = new Date(Date.UTC(2026, 10, 9 + (n - 1) * 14)).toISOString().slice(0, 10), e = new Date(Date.UTC(2026, 10, 20 + (n - 1) * 14)).toISOString().slice(0, 10);
    assert.deepEqual(inB(r, b).map(t => t.name), ['Sprint Planning', 'Sprint Backlog', 'Sprint Review', 'Sprint Retrospective']);
    assert.equal(one(r, b, 'Sprint Planning').end, s); assert.equal(dow(s), 1);
    assert.deepEqual([one(r, b, 'Sprint Backlog').start, one(r, b, 'Sprint Backlog').end], [s, e]);
    assert.equal(one(r, b, 'Sprint Review').end, e); assert.equal(one(r, b, 'Sprint Retrospective').end, e); assert.equal(dow(e), 5);
  }
  assert.equal(one(r, 'Sprint 6', 'Sprint Review').end, '2027-01-29');
  assert.ok(!r.tasks.some(t => /daily/i.test(t.name)), 'Daily visas inte');
  // Release var 3:e sprint, Product Goal som gate i slutet
  assert.deepEqual(inB(r, 'Releases').map(t => [t.name, t.end]), [['Product Goal', '2027-01-29'], ['Release 1', '2026-12-18'], ['Release 2', '2027-01-29']]);
  const pg = one(r, 'Releases', 'Product Goal');
  assert.ok(pg.milestone && pg.gate);
  assert.deepEqual(red(r.tasks), []);
});

test('Scrum: ändrat antal och längd, release var X:e och sista sprinten', () => {
  const r = run('scrum', { count: 4, lenW: 3, every: 3 }, START);
  assert.equal(r.order.filter(b => /^Sprint [1-9]/.test(b)).length, 4);
  assert.deepEqual([one(r, 'Sprint 2', 'Sprint Backlog').start, one(r, 'Sprint 2', 'Sprint Backlog').end], ['2026-11-30', '2026-12-18']);
  assert.deepEqual(inB(r, 'Releases').filter(t => t.name.startsWith('Release')).map(t => t.end), [one(r, 'Sprint 3', 'Sprint Review').end, one(r, 'Sprint 4', 'Sprint Review').end]);
  const none = run('scrum', { count: 5, lenW: 1, every: 0 }, START);
  assert.ok(!none.tasks.some(t => t.name.startsWith('Release')));
  assert.equal(one(none, 'Releases', 'Product Goal').end, one(none, 'Sprint 5', 'Sprint Review').end);
  assert.deepEqual(red(r.tasks), []); assert.deepEqual(red(none.tasks), []);
});

test('Scrum: beroenden hänger ihop över sprintarna', () => {
  const r = run('scrum', { count: 3, lenW: 2 }, START);
  const id = (b, n) => one(r, b, n).id;
  assert.deepEqual(one(r, 'Sprint 1', 'Sprint Planning').deps, [id('Sprint 0', 'Definition of Done')]);
  assert.deepEqual(one(r, 'Sprint 2', 'Sprint Backlog').deps, [id('Sprint 1', 'Sprint Retrospective')]);
  assert.deepEqual(one(r, 'Sprint 2', 'Sprint Review').deps, [id('Sprint 2', 'Sprint Backlog')]);
  assert.deepEqual(one(r, 'Releases', 'Product Goal').deps, [id('Sprint 3', 'Sprint Review')]);
  assert.deepEqual(one(r, 'Releases', 'Release 1').deps, [id('Sprint 3', 'Sprint Review')]);
});

test('PI-planering: 2 PI ger 2 PI med 4 iterationer + IP Iteration, System Demo och Inspect & Adapt', () => {
  const r = run('pi', { count: 2 }, START);
  assert.deepEqual(r.order, ['PI 1', 'PI 2']);
  for (const b of r.order) {
    assert.deepEqual(inB(r, b).map(t => t.name).sort(), ['IP Iteration', 'Inspect & Adapt', 'Iteration 1', 'Iteration 2', 'Iteration 3', 'Iteration 4', 'PI Planning', 'System Demo']);
  }
  assert.equal(one(r, 'PI 1', 'PI Planning').end, '2026-11-02');
  assert.deepEqual([one(r, 'PI 1', 'Iteration 1').start, one(r, 'PI 1', 'Iteration 1').end], ['2026-11-02', '2026-11-13']);
  assert.equal(one(r, 'PI 1', 'System Demo').end, one(r, 'PI 1', 'Iteration 4').end);
  assert.deepEqual([one(r, 'PI 1', 'IP Iteration').start, one(r, 'PI 1', 'Inspect & Adapt').end], ['2026-12-28', '2027-01-08']);
  assert.equal(one(r, 'PI 2', 'PI Planning').end, '2027-01-11');           // 10 veckor senare
  assert.deepEqual(one(r, 'PI 2', 'PI Planning').deps, [one(r, 'PI 1', 'Inspect & Adapt').id]);
  assert.deepEqual(red(r.tasks), []);
});

test('PI-planering: iterationerna fyller PI:t utan glapp och överlapp för 8–12 veckor', () => {
  for (let L = 8; L <= 12; L++) {
    const r = run('pi', { count: 3, lenW: L }, START);
    for (const b of r.order) {
      const its = ['Iteration 1', 'Iteration 2', 'Iteration 3', 'Iteration 4', 'IP Iteration'].map(n => one(r, b, n));
      its.forEach(t => assert.ok(dow(t.start) === 1 && dow(t.end) === 5));
      for (let i = 1; i < its.length; i++) assert.equal(toDay(its[i].start), toDay(its[i - 1].end) + 3, `${b} L=${L}`);
      assert.equal(toDay(its[4].end) - toDay(its[0].start), L * 7 - 3);
    }
    assert.deepEqual(red(r.tasks), [], 'L=' + L);
  }
});

test('Hybrid PMI + sprintar: sprintar i Executing mellan G2 och G3, inga röda pilar', () => {
  const gates = { G1: wk('2645'), G2: wk('2710'), G3: wk('2735'), G4: wk('2745') };
  const r = run('hybrid', { count: 4, lenW: 4 }, gates);
  const ex = inB(r, 'Executing').filter(t => /^Sprint \d+$/.test(t.name));
  assert.deepEqual(ex.map(t => t.name), ['Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4']);
  const g2 = one(r, 'Planning', 'Gate G2 – Project management plan approved'), g3 = one(r, 'Executing', 'Gate G3 – Deliverables accepted');
  assert.equal(toDay(ex[0].start), toDay(g2.end) + 3);                        // måndagen efter G2
  assert.deepEqual(ex[0].deps, [g2.id]);
  assert.ok(toDay(ex[3].end) <= toDay(g3.end));
  assert.equal(one(r, 'Executing', 'Sprint 2 Review').end, ex[1].end);
  assert.deepEqual(r.noFit, []);
  assert.deepEqual(red(r.tasks), []);
  // Med PMI-gruppen: fortfarande inga röda pilar
  const all = run('hybrid', { count: 4, lenW: 4 }, gates, ['pmi']);
  assert.ok(all.tasks.length >= r.tasks.length + 30);
  assert.deepEqual(red(all.tasks), []);
});

test('Hybrid: sprintar som inte får plats före gaten och faser utan startgate hoppas över', () => {
  const r = run('hybrid', { count: 10, lenW: 4 }, { G2: wk('2710'), G3: wk('2735') });
  assert.equal(inB(r, 'Executing').filter(t => /^Sprint \d+$/.test(t.name)).length, 6); // 24 veckor mellan G2 och G3
  assert.deepEqual(r.noFit, ['Sprint 7', 'Sprint 8', 'Sprint 9', 'Sprint 10']);       // får inte plats före G3
  const open = run('hybrid', { count: 10, lenW: 4 }, { G2: wk('2710') });
  assert.equal(inB(open, 'Executing').filter(t => /^Sprint \d+$/.test(t.name)).length, 10); // G3 saknar vecka: ingen slutgräns
  const noG2 = run('hybrid', { count: 2, lenW: 2 }, { G3: wk('2735') });
  assert.deepEqual(noG2.noFit, ['Sprint 1', 'Sprint 2']);                               // Executing saknar startgate
  assert.deepEqual(red(r.tasks), []);
});

test('mallval: Scrum, PI och hybrid; SAFe bara som SAFe-inspirerad', () => {
  assert.deepEqual(agileGroups(lib).map(g => g.id), ['scrum', 'pi', 'hybrid']);
  const texts = [JSON.stringify(lib), src];
  for (const t of texts) assert.deepEqual(t.match(/SAFe(?!-inspir)/g) || [], []);
});

test('cleanTemplate och mallfilen behåller repeat; mallen ger samma plan som den inbyggda', () => {
  const g = G('scrum');
  const tpl = { format: 'timeplan-template', version: 1, name: 'Fiktiv Scrum', anchor: { key: 'START', name: 'Start' }, phases: g.phases,
    groups: [{ id: 'own', anchor: 'START', items: g.items, repeat: { ...g.repeat, secret: 'x', tasks: g.repeat.tasks.map(t => ({ ...t, id: 'a1' })) } }] };
  const c = cleanTemplate(tpl);
  const rp = c.groups[0].repeat;
  assert.equal(rp.secret, undefined); assert.ok(rp.tasks.every(t => t.id === undefined));
  const { tasks: _t, ...want } = g.repeat, { tasks: _u, ...got } = rp;
  assert.deepEqual(got, want);
  assert.deepEqual(rp.tasks, g.repeat.tasks);
  assert.ok(c.phases.find(p => p.name === 'Sprint {n}').repeat);
  assert.equal(c.groups[0].items.find(i => i.name === 'Product Goal').anchor, 'END');
  const strip = r => r.tasks.map(t => [t.bucket, t.name, t.start, t.end, !!t.milestone, (t.deps || []).length]);
  const a = run('scrum', { count: 6, lenW: 2 }, START), b = templateTasks(templateLib(c), { groups: ['own'], gates: START, repeat: { count: 6, lenW: 2 } });
  assert.deepEqual(strip(b), strip(a)); assert.deepEqual(b.order, a.order);
  // Rundresa via Excel-filen
  const wb = XLSX.read(XLSX.write(templateWorkbook(c), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.deepEqual(readTemplateWb(wb), c);
  // Mall med bara ett block (utan andra aktiviteter) går bra, ett trasigt block avvisas
  assert.ok(cleanTemplate({ ...tpl, groups: [{ items: [], repeat: g.repeat }] }).groups[0].repeat);
  assert.throws(() => cleanTemplate({ ...tpl, groups: [{ items: [], repeat: { tasks: 'x' } }] }), /skadad/);
  assert.throws(() => cleanTemplate({ ...tpl, groups: [{ items: [] }] }), /skadad/);
  // Gränserna rensas: antal hålls inom countMin–countMax (1–26)
  assert.equal(cleanTemplate({ ...tpl, groups: [{ items: [], repeat: { ...g.repeat, count: 99 } }] }).groups[0].repeat.count, 26);
});

test('plan från Scrum → Spara som mall (#73) → ny plan: samma datum, även Sprint Planning på måndagen', () => {
  const r = run('scrum', { count: 6, lenW: 2 }, START);
  const plan = { name: 'Fiktiv Scrum', settings: { bucketOrder: r.order }, tasks: r.tasks };
  const tpl = cleanTemplate(planToTemplate(plan));
  const b = templateTasks(templateLib(tpl), { groups: ['own'], gates: START });
  const sig = ts => ts.map(t => [t.bucket, t.name, t.start, t.end, !!t.milestone, (t.deps || []).length].join('|')).sort();
  assert.deepEqual(sig(b.tasks), sig(r.tasks));
  assert.deepEqual(red(b.tasks), []);
});
