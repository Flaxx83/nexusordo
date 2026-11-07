// PMI-projektmallen: faserna Initiating, Planning, Executing och Closing med gaterna G1–G4.
// Funktionerna läses direkt ur app/script.js. Kör: node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const lib = JSON.parse(readFileSync(new URL('../mallar/mallbibliotek.json', import.meta.url), 'utf8'));
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  blk('const PMI_PHASES', 'function pmiColorOf'), pick(/const pmiPhaseOf = .*;/), pick(/const isGateMs = .*;/),
  pick(/const uid = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/function parseWeek\([\s\S]*?\n}\n/),
  pick(/const normName = .*;/), pick(/const TPL_GATES = .*;/), pick(/const TPL_SEP = .*;/), pick(/const weekMon = .*;/), pick(/const gateCodeRe = .*;/),
  pick(/function repeatVals\([\s\S]*?\n}\n/), pick(/function repeatSlots\([\s\S]*?\n}\n/), pick(/function repeatSpan\([\s\S]*?\n}\n/), pick(/function templateTasks\([\s\S]*?\n}\n/),
].join('\n');
const F = new Function('TEMPLATE_LIB', code + '\nreturn { PMI_PHASES, PMI_GATES, PMI_GATE_RE, pmiPhaseOf, isGateMs, templateTasks, parseWeek, toDay };')(lib);

test('PMI-faserna känns igen på engelska och svenska namn, i ordning', () => {
  const order = n => (F.pmiPhaseOf(n) || {}).order;
  assert.equal(order('Initiating'), 0);
  assert.equal(order('Planering'), 1);
  assert.equal(order('Planning'), 1);
  assert.equal(order('Executing'), 2);
  assert.equal(order('Monitoring & Controlling'), 2);
  assert.equal(order('Closing'), 3);
  assert.equal(order('Avslut'), 3);
  assert.equal(F.pmiPhaseOf('Övrigt'), undefined);
});

test('gate-koderna G1–G4 hör till var sin fas', () => {
  assert.deepEqual(F.PMI_GATES, ['G1', 'G2', 'G3', 'G4']);
  assert.deepEqual(F.PMI_PHASES.map(p => p.gates[0]), lib.phases.map(p => p.gate));
  for (const g of ['G1', 'G2', 'G3', 'G4']) assert.match(`Gate ${g} – x`, F.PMI_GATE_RE);
  for (const s of ['G5', 'G12', 'BG1', 'Gate']) assert.doesNotMatch(s, F.PMI_GATE_RE);
  assert.ok(F.isGateMs({ milestone: true, name: 'Gate G2 – Plan approved' }));
  assert.ok(F.isGateMs({ gate: true, name: 'Egen gate' }));
  assert.ok(!F.isGateMs({ milestone: false, name: 'G2-förberedelser' }));
});

test('PMI-mallen med alla fyra gater: 4 gate-milstolpar + 30 aktiviteter, inget hoppas över, inget slutar efter sin gate', () => {
  const wk = s => F.parseWeek(s, true);
  const gates = { G1: wk('2705'), G2: wk('2713'), G3: wk('2740'), G4: wk('2746') };
  const r = F.templateTasks(lib, { groups: ['pmi'], gates });
  assert.deepEqual(r.skipped, []);
  const gms = r.tasks.filter(t => t.gate);
  assert.deepEqual(gms.map(t => t.name), lib.phases.map(p => `Gate ${p.gate} – ${p.gateName}`));
  assert.ok(gms.every(t => t.milestone));
  const items = r.tasks.filter(t => !t.gate);
  assert.equal(items.length, 30);
  for (const t of items) {
    const g = lib.phases.find(p => p.name === t.bucket).gate;
    assert.ok(F.toDay(t.end) <= gates[g] + 4, `${t.name} slutar ${t.end}, efter ${g}`);
    assert.ok(t.start <= t.end, t.name);
  }
});
