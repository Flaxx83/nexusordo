// Tester för projektmallar (#32): PMI-mallen, veckor, gater som saknas och dubbletter.
// Funktionerna läses direkt ur app/script.js så att det är samma kod som i appen. Kör: node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const raw = readFileSync(new URL('../mallar/mallbibliotek.json', import.meta.url), 'utf8');
const lib = JSON.parse(raw);
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const code = [
  pick(/const uid = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/function parseWeek\([\s\S]*?\n}\n/),
  pick(/const normName = .*;/), pick(/const TPL_GATES = .*;/), pick(/const TPL_SEP = .*;/), pick(/const weekMon = .*;/), pick(/const gateCodeRe = .*;/),
  pick(/function repeatVals\([\s\S]*?\n}\n/), pick(/function repeatSlots\([\s\S]*?\n}\n/), pick(/function repeatSpan\([\s\S]*?\n}\n/), pick(/function templateTasks\([\s\S]*?\n}\n/),
].join('\n');
const { templateTasks, parseWeek, toDay } = new Function('TEMPLATE_LIB', code + '\nreturn { templateTasks, parseWeek, toDay };')(lib);
const wk = s => parseWeek(s, true);
const find = (r, name) => r.tasks.find(t => t.name === name);

test('inbäddat mallbibliotek är samma som mallar/mallbibliotek.json', () => {
  const m = src.match(/const TEMPLATE_LIB = (.*);\n\/\* MALLAR:END \*\//);
  assert.ok(m, 'kör node scripts/embed-mallar.mjs');
  assert.deepEqual(JSON.parse(m[1]), lib, 'kör node scripts/embed-mallar.mjs');
});

test('biblioteket: PMI-faserna med gaterna G1–G4, PMI-gruppen och de agila grupperna', () => {
  assert.deepEqual(lib.phases.map(p => [p.name, p.gate]), [['Initiating', 'G1'], ['Planning', 'G2'], ['Executing', 'G3'], ['Closing', 'G4']]);
  assert.ok(lib.phases.every(p => p.gateName), 'varje gate har ett namn');
  assert.deepEqual(lib.groups.map(g => g.id), ['pmi', 'scrum', 'pi', 'hybrid']);
  const pmi = lib.groups.find(g => g.id === 'pmi');
  assert.ok(!pmi.agile && !pmi.hidden);
  assert.equal(pmi.items.length, 30);
  for (const it of pmi.items) {
    const ph = lib.phases.find(p => p.name === it.phase);
    assert.ok(ph, `okänd fas: ${it.name}`);
    assert.equal(it.gate, ph.gate, it.name);
  }
  for (const id of ['scrum', 'pi', 'hybrid']) assert.ok(lib.groups.find(g => g.id === id).agile, id);
});

test('biblioteket: inga profiler, alla aktiviteter i PMI-faserna med gaterna G1–G4', () => {
  assert.ok(!/"profiles?"\s*:/.test(raw), 'inga profiles-fält');
  const phases = new Map(lib.phases.map(p => [p.name, p.gate]));
  for (const g of lib.groups) for (const it of g.items) {
    if (g.phases) { assert.ok(g.phases.some(p => p.name === it.phase), `${g.id}: ${it.name}`); continue; } // egna faser (Scrum, PI)
    assert.ok(phases.has(it.phase), `${g.id}: ${it.name} – okänd fas ${it.phase}`);
    if (it.gate) assert.equal(it.gate, phases.get(it.phase), `${g.id}: ${it.name}`);
  }
});

test('aktivitet slutar fredag i gate-veckan och börjar måndag durW-1 veckor tidigare', () => {
  const r = templateTasks(lib, { groups: ['pmi'], gates: { G1: wk('2705') } });
  const t = find(r, 'Develop project charter'); // 2 veckor, slutar vid G1
  assert.equal(t.end, '2027-02-05');            // fredag v5 2027
  assert.equal(t.start, '2027-01-25');          // måndag v4
  assert.equal(t.bucket, 'Initiating');
  const b = find(r, 'Business case and benefits'); // slutar 2 veckor före gaten
  assert.equal(b.end, '2027-01-22');
  const g = find(r, 'Gate G1 – Project charter approved');
  assert.ok(g.milestone && g.gate);
  assert.equal(g.end, '2027-02-05');
});

test('gater utan vecka hoppas över (projekt som startar vid G2)', () => {
  const r = templateTasks(lib, { groups: ['pmi'], gates: { G2: wk('2720'), G3: wk('2740') } });
  assert.ok(r.tasks.every(t => ['Planning', 'Executing'].includes(t.bucket)));
  assert.ok(r.skipped.length > 0);
  assert.ok(!r.tasks.some(t => /Gate G1/.test(t.name)));
});

test('dubbletter mot befintliga aktiviteter hoppas över, även befintliga gater', () => {
  const gates = { G1: wk('2705') };
  const first = templateTasks(lib, { groups: ['pmi'], gates });
  const again = templateTasks(lib, { groups: ['pmi'], gates }, first.tasks);
  assert.equal(again.tasks.length, 0);
  assert.equal(again.dupes.length, first.tasks.length - 1); // gaten räknas inte som dubblett, den hoppas bara över
});

test('långa aktiviteter börjar tidigast veckan efter föregående gate', () => {
  const r = templateTasks(lib, { groups: ['pmi'], gates: { G2: wk('2720'), G3: wk('2730') } });
  const fas = r.tasks.filter(t => !t.milestone && t.bucket === 'Executing');
  assert.ok(fas.length > 5);
  for (const t of fas) assert.ok(t.start >= '2027-05-24', `${t.name} börjar ${t.start}`); // måndag v21
  // utan G2 gäller veckorna från mallen
  const r2 = templateTasks(lib, { groups: ['pmi'], gates: { G3: wk('2730') } });
  assert.ok(r2.tasks.some(t => t.start < '2027-05-24'));
});

// Beroenden (#61): PMI-mallens kedjor
const ALL = { G1: wk('2705'), G2: wk('2715'), G3: wk('2740'), G4: wk('2746') };
const byId = r => new Map(r.tasks.map(t => [t.id, t]));

test('PMI: beroendena pekar på rätt aktiviteter och går framåt i tiden', () => {
  const r = templateTasks(lib, { groups: ['pmi'], gates: ALL });
  const m = byId(r);
  assert.ok(find(r, 'Develop project charter').deps.map(d => m.get(d).name).includes('Business case and benefits'));
  for (const t of r.tasks) {
    assert.ok(!t.deps.includes(t.id));
    for (const d of t.deps) {
      const p = m.get(d);
      assert.ok(p, `okänt beroende i ${t.name}`);
      if (p.gate) continue;
      assert.ok(toDay(t.start) > toDay(p.end) || (t.milestone && toDay(t.end) >= toDay(p.end)), `${p.name} (${p.end}) → ${t.name} (${t.start})`);
    }
  }
});
