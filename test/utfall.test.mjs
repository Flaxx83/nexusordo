// Tester för gatens status från Planner (#66) och utfallsvecka (#55).
// Testdata är påhittad. Funktionerna läses direkt ur app/script.js.
// Kör: node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s; const fmtShortY = x => x || "–"; const fmtDayY = n => String(n);',
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/), pick(/const dObj = .*;/), pick(/const todayDay = .*;/),
  pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/), pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/),
  pick(/function parseWeek\([\s\S]*?\n}\n/), pick(/const normName = .*;/), pick(/const norm = .*;/), pick(/const PMI_GATE_RE = .*;/),
  pick(/function normGoalStatus\([\s\S]*?\nconst actualDayFromWeek = .*;/), pick(/function mergeImport\([\s\S]*?\n}\n/),
].join('\n');
const F = new Function(code + '\nreturn { normGoalStatus, proposeActual, isGateMs, mergeImport, parseWeek, fromDay, toDay };')();
const { normGoalStatus, proposeActual, isGateMs, mergeImport, parseWeek, fromDay, toDay } = F;

const fri = yyww => fromDay(parseWeek(yyww, true));
const ms = (id, name, yyww, extra = {}) => ({ id, plannerId: 'goal:' + id, name, milestone: true, gate: true, start: fri(yyww), end: fri(yyww), progress: 0, ...extra });

test('normGoalStatus: Planners status på engelska och svenska', () => {
  assert.equal(normGoalStatus('Not started'), 'notstarted');
  assert.equal(normGoalStatus('On track'), 'ontrack');
  assert.equal(normGoalStatus('At risk'), 'atrisk');
  assert.equal(normGoalStatus('Off track'), 'offtrack');
  for (const v of ['Closed', 'Done', 'Completed', 'Avslutad', 'Stängd']) assert.equal(normGoalStatus(v), 'done', v);
  assert.equal(normGoalStatus('Inte startat'), 'notstarted');
  assert.equal(normGoalStatus('I riskzonen'), 'atrisk');
  assert.equal(normGoalStatus('Inte i fas'), 'offtrack');
  assert.equal(normGoalStatus('I fas'), 'ontrack');
  assert.equal(normGoalStatus(''), null);
  assert.equal(normGoalStatus(null), null);
  assert.equal(normGoalStatus('Något annat'), null);
});

test('proposeActual: planerat datum om det passerat, annars importdagen', () => {
  const today = toDay('2026-10-28');
  assert.equal(proposeActual({ end: '2026-08-14' }, today), toDay('2026-08-14'));
  assert.equal(proposeActual({ end: '2026-12-18' }, today), today);
  assert.equal(proposeActual({}, today), today);
});

test('isGateMs: markerade gater och PMI-gater (G1–G4) i namnet', () => {
  assert.ok(isGateMs({ gate: true, name: 'Mål X' }));
  assert.ok(isGateMs({ milestone: true, name: 'G2 beslut' }));
  assert.ok(isGateMs({ milestone: true, name: 'Gate G4' }));
  assert.ok(!isGateMs({ milestone: true, name: 'Gate R' }));
  assert.ok(!isGateMs({ milestone: true, name: 'Leverans maskin' }));
  assert.ok(!isGateMs({ name: 'G1-underlag' }));
});

test('mergeImport: status från Planner följer med, ändringen listas och klar gate får förslag på utfall', () => {
  const p = { tasks: [ms('g1', 'Gate G1', '2622', { goalStatus: 'ontrack' }), ms('g2', 'Gate G2', '2651', { goalStatus: 'ontrack' }),
    ms('g3', 'Gate G3', '2721', { progress: 100, goalStatus: 'done', actual: { day: '2026-05-29', week: '2622', src: 'manual', at: 'x' } })] };
  const imp = { tasks: [ms('g1', 'Gate G1', '2622', { progress: 100, goalStatus: 'done' }), ms('g2', 'Gate G2', '2651', { goalStatus: 'atrisk' }),
    ms('g3', 'Gate G3', '2721', { progress: 100, goalStatus: 'done' })] };
  const res = mergeImport(p, imp);
  const by = id => res.tasks.find(t => t.id === id);
  assert.equal(by('g1').goalStatus, 'done');
  assert.equal(by('g2').goalStatus, 'atrisk');
  assert.deepEqual(by('g3').actual, p.tasks[2].actual, 'utfall satt i NexusOrdo behålls');
  const g2 = res.report.changed.find(c => c.name === 'Gate G2');
  assert.ok(g2.what.some(w => /^status I fas → I riskzonen$/.test(w)), g2.what.join(' | '));
  assert.equal(res.report.actualProposals.length, 1, 'bara G1 – G3 har redan utfall');
  const a = res.report.actualProposals[0];
  assert.equal(a.id, 'g1');
  assert.equal(a.day, toDay(fri('2622')), 'planerad dag har passerat → planerad dag');
  assert.equal(a.fresh, true);
});
