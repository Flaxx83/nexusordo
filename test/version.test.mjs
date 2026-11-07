// Versionen i bygget, exporten och mallfilerna (#78): rena funktioner cleanBuild/newerBuild, att filerna bär versionen,
// att äldre filer utan version fungerar, och att de lokala filerna byggs med samma version som build-info.mjs ger.
// Bara påhittad data. Kör: node --test "test/*.test.mjs"
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildInfo, embedBuild } from '../scripts/build-info.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('../app/vendor/xlsx.full.min.js');
const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const dObj = .*;/), pick(/const weekday = .*;/), pick(/const fromDay = .*;/),
  pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/), pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/const lc = .*;/), pick(/const weekMon = .*;/),
  pick(/const PALETTE_IDS = .*;/), pick(/const isHexColor = .*;/), pick(/function cleanPhaseColors\([\s\S]*?\n}\n/),
  blk('const TP_SHEET', 'async function openPlanExport('),
  blk('const TPL_FORMAT', '// Lagring: tp_templates'),
].join('\n');
const F = new Function('XLSX', code + '\nreturn { cleanBuild, newerBuild, sheetBuild, buildExport, exportWorkbook, readExport, templateWorkbook, readTemplateWb, cleanTemplate, TP_SHEET, TPL_SHEET, TP_BUILD };')(XLSX);
const { cleanBuild, newerBuild, sheetBuild } = F;

const A = { version: 'aaaa111', date: '2026-10-30', at: '2026-10-30T10:00:00+01:00' };
const B = { version: 'bbbb222', date: '2026-10-31', at: '2026-10-31T09:00:00+01:00' };
const B2 = { version: 'cccc333', date: '2026-10-31', at: '2026-10-31T15:30:00+01:00' };

test('källkoden har ingen version (TP_BUILD = null) – den skrivs in vid bygget', () => {
  assert.equal(F.TP_BUILD, null);
  assert.match(src, /\/\* BUILD:START \*\/\nconst TP_BUILD = null;\n\/\* BUILD:END \*\//);
});

test('cleanBuild: bara commit, datum och tid i rätt form', () => {
  assert.deepEqual(cleanBuild(A), A);
  assert.deepEqual(cleanBuild({ version: 'abcd123', date: '2026-10-30' }), { version: 'abcd123', date: '2026-10-30' });
  assert.deepEqual(cleanBuild({ ...A, extra: 'x', at: 'igår' }), { version: A.version, date: A.date });
  for (const bad of [null, undefined, 'abc', [], {}, { version: 'dev', date: '2026-10-30' }, { version: 'abcd123', date: '' }, { version: '<script>', date: '2026-10-30' }, { version: 'abcd123', date: '30/10/2026' }])
    assert.equal(cleanBuild(bad), null, JSON.stringify(bad));
});

test('newerBuild: nyare datum varnar, äldre och samma version gör det inte', () => {
  assert.equal(newerBuild(B, A), true, 'filen från en senare dag');
  assert.equal(newerBuild(A, B), false, 'filen från en tidigare dag');
  assert.equal(newerBuild(A, A), false, 'samma version');
  assert.equal(newerBuild({ ...A, at: '2030-01-01T00:00:00Z' }, A), false, 'samma commit är aldrig nyare');
  assert.equal(newerBuild({ ...A, version: 'AAAA111' }, A), false, 'commit utan hänsyn till skiftläge');
});

test('newerBuild: samma dag avgörs av commit-tiden, annars ingen varning', () => {
  assert.equal(newerBuild(B2, B), true);
  assert.equal(newerBuild(B, B2), false);
  assert.equal(newerBuild({ version: B2.version, date: B2.date }, B), false, 'utan tid går ordningen inte att avgöra');
});

test('newerBuild: filer och byggen utan version ger ingen varning', () => {
  assert.equal(newerBuild(null, A), false, 'äldre fil utan version');
  assert.equal(newerBuild(B, null), false, 'utvecklingsläge utan version');
  assert.equal(newerBuild({ version: 'x', date: '2099-01-01' }, A), false, 'ogiltig version');
});

const plan = { id: 'p1', name: 'Fiktivt projekt Delta', imported_at: null, settings: { viewCode: 'HEMLIGKOD123', owner: 'test@example.com' },
  tasks: [{ id: 't1', name: 'Förstudie', bucket: 'Start', start: '2026-11-02', end: '2026-11-27', deps: [] }, { id: 't2', name: 'G1 Beslut', bucket: 'Start', start: '2026-11-27', end: '2026-11-27', milestone: true, deps: ['t1'] }] };
const roundtrip = wb => XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });

test('exporten (#69) bär versionen; utan version (källkod) saknas fältet', () => {
  const data = F.buildExport([plan], [], '2026-10-30T12:00:00Z', B);
  assert.deepEqual(data.build, B);
  const wb = roundtrip(F.exportWorkbook(data));
  assert.deepEqual(sheetBuild(wb, F.TP_SHEET), B);
  assert.equal(F.readExport(wb).plans[0].name, plan.name, 'filen läses som förut');
  const old = F.buildExport([plan], [], '2026-10-30T12:00:00Z');
  assert.ok(!('build' in old));
  assert.equal(sheetBuild(roundtrip(F.exportWorkbook(old)), F.TP_SHEET), null, 'äldre fil utan version');
  assert.ok(!('build' in F.buildExport([plan], [], undefined, { version: 'x', date: 'nej' })), 'ogiltig version skrivs inte');
  assert.doesNotMatch(JSON.stringify(data), /HEMLIGKOD123/);
});

test('mallfilen (#73) bär versionen; mallen läses som förut', () => {
  const tpl = F.cleanTemplate({ format: 'timeplan-template', version: 1, name: 'Fiktiv mall', units: 'weeks', own: true, anchor: { key: 'START', name: 'Start' },
    phases: [{ name: 'Start' }], groups: [{ id: 'own', anchor: 'START', items: [{ name: 'Förstudie', phase: 'Start', anchor: 'START', endW: -4, durW: 4 }] }] });
  const wb = roundtrip(F.templateWorkbook(tpl, A));
  assert.deepEqual(sheetBuild(wb, F.TPL_SHEET), A);
  assert.deepEqual(F.readTemplateWb(wb), tpl, 'build följer inte med in i mallen');
  assert.equal(sheetBuild(roundtrip(F.templateWorkbook(tpl)), F.TPL_SHEET), null);
  assert.equal(sheetBuild(wb, F.TP_SHEET), null, 'fliken saknas');
});

test('lokala versionen varnar via dialog() och öppnar filen ändå', () => {
  const warn = pick(/async function warnNewerFile\([\s\S]*?\n}\n/);
  assert.match(warn, /if \(!FILE_MODE \|\| !newerBuild\(build, mine\)\) return;/);
  assert.match(warn, /await dialog\(/);
  assert.doesNotMatch(warn, /\b(alert|confirm|prompt)\(/);
  for (const f of [/async function openPlanFile\([\s\S]*?\n}\n/, /async function handleFile\([\s\S]*?\n}\n/, /async function importTemplateFile\([\s\S]*?\n}\n/])
    assert.match(pick(f), /await warnNewerFile\(/, f.source);
});

// ---------- Bygget ----------
const run = (script, ...a) => execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/' + script, import.meta.url)), ...a], { encoding: 'utf8', stdio: 'pipe' });
const dir = mkdtempSync(join(tmpdir(), 'tp-version-'));
const stamp = s => JSON.parse(s.match(/\/\* BUILD:START \*\/\nconst TP_BUILD = (.*);\n\/\* BUILD:END \*\//)[1]);
const local = s => JSON.parse(s.match(/window\.TP_LOCAL = (\{.*\});/)[1]);
let builds, embedded;
try {
  builds = [[], ['--tema', 'glas']].map((a, i) => { const out = join(dir, `l${i}.html`); run('build-lokal.mjs', ...a, out); return readFileSync(out, 'utf8'); });
  copyFileSync(new URL('../app/script.js', import.meta.url), join(dir, 'script.js'));
  embedded = embedBuild(readFileSync(join(dir, 'script.js'), 'utf8'), buildInfo(fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')));
} finally { rmSync(dir, { recursive: true, force: true }); }

test('build-info: embedBuild skriver in versionen; de två lokala filerna får samma version (commit, datum, tid)', t => {
  const a = stamp(embedded);
  if (a.version === 'dev') return t.skip('inget git-repo – versionen kräver en commit');
  assert.ok(cleanBuild(a), 'giltig version');
  assert.ok(a.at, 'med commit-tid');
  assert.throws(() => embedBuild('const x = 1;', a), /BUILD:START/);
  for (const html of builds) {
    assert.deepEqual(stamp(html), a);
    assert.equal(local(html).version, a.version);
    assert.equal(local(html).date, a.date);
    assert.match(html, /<title>NexusOrdo<\/title>/);
  }
});

test('build-lokal: utfilen heter dist/NexusOrdo.html (med tema -glas), ingen profil', () => {
  const s = readFileSync(new URL('../scripts/build-lokal.mjs', import.meta.url), 'utf8');
  assert.ok(s.includes("`dist/NexusOrdo${theme ? '-' + theme : ''}.html`"));
  assert.doesNotMatch(s, /--profil/);
});
