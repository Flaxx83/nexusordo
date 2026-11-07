// Tester för huvudprojekt med delprojekt (#67): gruppering, huvudplan och ärvda gater (PMI-gater G1–G4).
// Bara påhittade planer. Kör: node --test "test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/), pick(/const dObj = .*;/),
  pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/), pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/),
  pick(/function parseWeek\([\s\S]*?\n}\n/), pick(/const normName = .*;/),
  pick(/const wkDiff = .*;/), pick(/const planProject = .*;/),
  pick(/const ST_RANK = .*;/), pick(/const worstOf = .*;/), pick(/const statusOverall = .*;/),
  pick(/const PMI_GATE_RE = .*;/), pick(/const isGateMs = .*;/),
  blk('const GEN_PRE = ', '// Bara giltiga punkter för gater som finns'),
  pick(/function planGates\([\s\S]*?\n}\n/), pick(/function taskGate\([\s\S]*?\n}\n/), pick(/function gateMsOf\([\s\S]*?\n}\n/),
  blk('const datedGates = ', '\n/* ====='), pick(/const pgKey = .*;/), pick(/const pgActOf = .*;/), pick(/function planGateMap\([\s\S]*?\n}\n/),
].join('\n');
const F = new Function(code + '\nreturn { projectGroups, mainPlanOf, subGates, groupSummary, toDay, parseWeek, fromDay };')();
const { projectGroups, mainPlanOf, subGates, groupSummary, toDay, parseWeek, fromDay } = F;

const fri = yyww => fromDay(parseWeek(yyww, true));
const ms = (id, name, yyww) => ({ id, name, milestone: true, gate: true, start: fri(yyww), end: fri(yyww) });
const P = (id, l1, l2, extra = {}, tasks = []) => ({ id, name: l2 || l1 || id, settings: { project: { program: 'Program X (fiktivt)', l1, l2, ...extra } }, tasks });
const MAIN = P('m', 'Projekt Alfa (fiktivt)', '', { role: 'main' }, [ms('g1', 'Gate G1', '2440'), ms('g2', 'Gate G2', '2626'), ms('g3', 'Gate G3', '2740'), ms('g4', 'Gate G4', '2830')]);
const PREP = P('a', 'Projekt Alfa (fiktivt)', 'Förberedelse (fiktiv)', {}, [{ id: 't', name: 'Rivning', start: '2026-03-02', end: '2026-04-10' }]);
const YARD = P('b', 'Projekt Alfa (fiktivt)', 'Materialgård (fiktiv)', {}, [ms('y1', 'Gate G1', '2440'), ms('y2', 'Gate G2', '2630'), ms('y3', 'Gate G3', '2740')]);
const IT = P('c', 'Projekt Alfa (fiktivt)', 'IT (fiktiv)', { gates: 'none' });
const LONE = P('d', '', '');
const BETA = P('h', 'Projekt Beta (fiktivt)', '');

test('projectGroups: grupp per nivå 1 med huvudplan, övriga planer står för sig', () => {
  const g = projectGroups([LONE, PREP, MAIN, YARD, IT, BETA]);
  assert.equal(g.length, 3);
  assert.equal(g[0].plan, LONE);
  assert.equal(g[1].main, MAIN); assert.deepEqual(g[1].subs.map(p => p.id), ['a', 'b', 'c']);
  assert.equal(g[1].l1, 'Projekt Alfa (fiktivt)');
  assert.equal(g[2].plan, BETA, 'ensam plan utan huvudplan är ingen grupp');
  const noMain = projectGroups([PREP, YARD]);
  assert.equal(noMain.length, 1); assert.equal(noMain[0].main, null); assert.equal(noMain[0].subs.length, 2);
  const onlyMain = projectGroups([{ ...BETA, settings: { project: { ...BETA.settings.project, role: 'main' } } }]);
  assert.equal(onlyMain[0].subs.length, 0); assert.ok(onlyMain[0].main, 'huvudplan utan delprojekt är en grupp');
  assert.equal(projectGroups([{ ...PREP, settings: { project: { l1: ' projekt  alfa (FIKTIVT) ' } } }, MAIN])[0].main, MAIN, 'nivå 1 matchas utan skiftläge och extra mellanslag');
});

test('mainPlanOf: samma nivå 1 och role main; huvudplanen själv har ingen', () => {
  const list = [MAIN, PREP, YARD, BETA];
  assert.equal(mainPlanOf(PREP, list), MAIN);
  assert.equal(mainPlanOf(MAIN, list), null);
  assert.equal(mainPlanOf(BETA, list), null);
  assert.equal(mainPlanOf(LONE, list), null);
});

test('subGates: ärvda utan egna gater, egna med avvikelse, stödprojekt utan gater', () => {
  const a = subGates(PREP, MAIN);
  assert.equal(a.mode, 'inherited');
  assert.deepEqual(a.gates.map(g => [g.code, g.week, g.src]), [['G1', '2440', 'inherited'], ['G2', '2626', 'inherited'], ['G3', '2740', 'inherited'], ['G4', '2830', 'inherited']]);
  const b = subGates(YARD, MAIN);
  assert.equal(b.mode, 'own');
  assert.deepEqual(b.gates.map(g => [g.code, g.src, g.diffW]), [['G1', 'own', 0], ['G2', 'own', 4], ['G3', 'own', 0]]);
  assert.deepEqual(b.deviating.map(g => g.code), ['G2']);
  assert.equal(b.gates[1].mainWeek, '2626');
  assert.equal(subGates(IT, MAIN).mode, 'none');
  assert.equal(subGates(IT, MAIN).gates.length, 0);
  assert.equal(subGates(PREP, null).mode, 'empty');
  const forced = { ...YARD, settings: { project: { ...YARD.settings.project, gates: 'inherit' } } };
  assert.equal(subGates(forced, MAIN).mode, 'inherited', 'gates: inherit följer huvudplanen även om planen har egna');
  // Gate utan datum räknas inte som egen gate
  const undated = P('u', 'Projekt Alfa (fiktivt)', 'Utan datum', {}, [{ id: 'x', name: 'Gate G1', milestone: true, gate: true, start: null, end: null }]);
  assert.equal(subGates(undated, MAIN).mode, 'inherited');
});

test('groupSummary: antal delprojekt, sämsta hälsa och nästa gemensamma gate', () => {
  const withStatus = (pl, overall) => ({ ...pl, settings: { ...pl.settings, status: [{ week: '2640', overall: 'G' }, { week: '2643', overall }] } });
  const g = projectGroups([MAIN, withStatus(PREP, 'Y'), withStatus(YARD, 'R'), IT])[0];
  const s = groupSummary(g, toDay('2026-01-05'));
  assert.equal(s.n, 3); assert.equal(s.health, 'R');
  assert.equal(s.next.code, 'G2'); assert.equal(s.next.week, '2626', 'G1 2440 har passerat');
  assert.deepEqual(s.follow.map(p => p.id), ['a']);
  assert.deepEqual(s.deviate.map(d => [d.plan.id, d.diffW]), [['b', 4]]);
  const later = groupSummary(g, toDay('2027-12-01'));
  assert.equal(later.next.code, 'G4');
  assert.equal(groupSummary(g, toDay('2029-01-01')).next, null);
  assert.equal(groupSummary(projectGroups([PREP, YARD])[0], toDay('2026-01-05')).next, null, 'utan huvudplan finns ingen gemensam gate');
});
