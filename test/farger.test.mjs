// Tester för färger per fas och paletter (#74): kontrast, fasens färg, PMI-paletten som standard,
// rensning vid import, export/import (#69) och mallar (#73). Bara påhittad data. Kör: node --test "test/*.test.mjs"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const XLSX = require('../app/vendor/xlsx.full.min.js');
const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('Hittar inte ' + a); return src.slice(i, j); };
const colorCode = [
  pick(/const PMI_PHASES = \[[\s\S]*?\n\];/), pick(/function pmiColorOf\([\s\S]*?\n}\n/),
  blk('const PALETTE_IDS', '// Har planen egna färger'),
].join('\n');
const C = new Function(colorCode + '\nreturn { PMI_PHASES, PALETTE_IDS, PAL_MJUK, PAL_KONTRAST, COLOR_PRESETS, isHexColor, paletteId, cleanPhaseColors, contrastRatio, lowContrast, phaseColor };')();

const code = [
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s;',
  pick(/const uid = .*;/), pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const fromDay = .*;/),
  pick(/const dObj = .*;/), pick(/const weekday = .*;/), pick(/const yearStart = .*;/), pick(/const isoWeek = .*;/),
  pick(/const isoWeekYear = .*;/), pick(/const fmtYYWW = .*;/), pick(/function parseWeek\([\s\S]*?\n}\n/), pick(/const lc = .*;/),
  pick(/const normName = .*;/), pick(/const TPL_GATES = .*;/), pick(/const TPL_SEP = .*;/), pick(/const weekMon = .*;/), pick(/const gateCodeRe = .*;/),
  pick(/function repeatVals\([\s\S]*?\n}\n/), pick(/function repeatSlots\([\s\S]*?\n}\n/), pick(/function repeatSpan\([\s\S]*?\n}\n/), pick(/function templateTasks\([\s\S]*?\n}\n/), pick(/const PMI_GATE_RE = .*;/), pick(/const isGateMs = .*;/),
  pick(/const PALETTE_IDS = .*;/), pick(/const isHexColor = .*;/), pick(/function cleanPhaseColors\([\s\S]*?\n}\n/),
  blk('const TP_SHEET', 'async function openPlanExport('),
  blk('const TPL_FORMAT', '// Lagring: tp_templates'),
].join('\n');
const F = new Function('XLSX', 'TEMPLATE_LIB', code + '\nreturn { buildExport, exportWorkbook, readExport, planToTemplate, cleanTemplate, templateLib, tplColorSettings, templateTasks, templateWorkbook, readTemplateWb };')(XLSX, JSON.parse(readFileSync(new URL('../mallar/mallbibliotek.json', import.meta.url), 'utf8')));

// Temats standardpalett (ljust tema, --s1…--s8) och övrigt
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER = '#9a9994', LIGHT_BG = '#fcfcfb', DARK_BG = '#1a1a19';

// Förväntad färg med PMI-paletten: PMI-färgen där fasen känns igen (gate-kod före namn), annars standardpaletten i fasordning
function oldColor(st, bucket) {
  const gate = String((st.phaseCodes || {})[bucket] || '').toUpperCase();
  const m = C.PMI_PHASES.find(ph => ph.gates.includes(gate)) || C.PMI_PHASES.find(ph => ph.re.test(bucket));
  if (m) return m.col;
  const i = (st.bucketOrder || []).indexOf(bucket);
  return i >= 0 && i < 8 ? SERIES[i] : OTHER;
}

// Påhittade planer
const pmiPlan = () => ({ bucketOrder: ['Initiating', 'Planning', 'Utförande', 'Closing', 'Inköp', 'IT', 'Uppföljning', 'Drift', 'Övrigt'],
  phaseCodes: { Utförande: 'G3', Uppföljning: 'G4' } });
const plainPlan = () => ({ bucketOrder: ['Planering', 'Bygg', 'Test', 'Drift', 'A', 'B', 'C', 'D', 'E'] });

test('contrastRatio: WCAG-kvoten, symmetrisk, kort form och ogiltiga färger', () => {
  assert.equal(C.contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(C.contrastRatio('#000', '#fff'), 21);
  assert.equal(C.contrastRatio('#777777', '#777777'), 1);
  assert.equal(C.contrastRatio('#2a78d6', '#ffffff'), C.contrastRatio('#ffffff', '#2a78d6'));
  assert.ok(Math.abs(C.contrastRatio('#767676', '#ffffff') - 4.54) < 0.01);
  assert.equal(C.contrastRatio('röd', '#fff'), null);
  assert.equal(C.contrastRatio('#12345', '#fff'), null);
  assert.equal(C.contrastRatio(null, '#fff'), null);
});

test('lowContrast: under 3:1 varnar, 3:1 och mer gör det inte', () => {
  assert.equal(C.lowContrast('#ffe11a', LIGHT_BG), true); // gul
  assert.equal(C.lowContrast('#c4c4c4', LIGHT_BG), true);
  assert.equal(C.lowContrast('#0b4fa8', LIGHT_BG), false);
  assert.equal(C.lowContrast('#0b4fa8', DARK_BG), true);  // mörkblå syns dåligt i mörkt tema
  assert.equal(C.lowContrast('#ffe11a', DARK_BG), false);
  assert.equal(C.lowContrast('inte en färg', LIGHT_BG), false);
});

test('förvalda färger når 3:1 mot ljus bakgrund; Hög kontrast når 4,5:1 mot vitt', () => {
  for (const c of C.COLOR_PRESETS) assert.ok(C.contrastRatio(c, LIGHT_BG) >= 3, `${c}: ${C.contrastRatio(c, LIGHT_BG)}`);
  for (const c of C.PAL_KONTRAST) assert.ok(C.contrastRatio(c, '#ffffff') >= 4.5, `${c}: ${C.contrastRatio(c, '#ffffff')}`);
  assert.equal(new Set(C.COLOR_PRESETS).size, C.COLOR_PRESETS.length);
  for (const list of [C.PAL_MJUK, C.PAL_KONTRAST]) { assert.equal(list.length, 8); assert.equal(new Set(list).size, 8); assert.ok(list.every(C.isHexColor)); }
});

test('planer utan val får PMI-paletten (PMI där fasen känns igen, annars standard)', () => {
  for (const st of [pmiPlan(), plainPlan(), {}]) {
    for (const b of [...(st.bucketOrder || []), 'Okänd fas', 'Ej schemalagda']) assert.equal(C.phaseColor(st, b, SERIES, OTHER), oldColor(st, b), b);
  }
  const st = pmiPlan();
  assert.equal(C.phaseColor(st, 'Utförande', SERIES, OTHER), '#f5a623'); // gate-koden G3
  assert.equal(C.phaseColor(st, 'Uppföljning', SERIES, OTHER), '#2e9e5b'); // gate-koden G4
  assert.equal(C.phaseColor(st, 'Planning', SERIES, OTHER), '#7b61ff');
  assert.equal(C.phaseColor(st, 'Initiating', SERIES, OTHER), '#8c9bab');
  assert.equal(C.phaseColor(st, 'Inköp', SERIES, OTHER), SERIES[4]);
  assert.equal(C.phaseColor(st, 'Övrigt', SERIES, OTHER), OTHER); // nionde fasen
});

test('paletter: Standard struntar i PMI, Mjuk och Hög kontrast i fasordning', () => {
  const st = pmiPlan();
  assert.equal(C.phaseColor({ ...st, palette: 'standard' }, 'Initiating', SERIES, OTHER), SERIES[0]);
  assert.equal(C.phaseColor({ ...st, palette: 'standard' }, 'Utförande', SERIES, OTHER), SERIES[2]);
  assert.equal(C.phaseColor({ ...st, palette: 'mjuk' }, 'Planning', SERIES, OTHER), C.PAL_MJUK[1]);
  assert.equal(C.phaseColor({ ...st, palette: 'kontrast' }, 'Closing', SERIES, OTHER), C.PAL_KONTRAST[3]);
  assert.equal(C.phaseColor({ ...st, palette: 'kontrast' }, 'Övrigt', SERIES, OTHER), OTHER);
  assert.equal(C.phaseColor({ ...st, palette: 'pmi' }, 'Utförande', SERIES, OTHER), '#f5a623');
});

test('egen färg per fas går före paletten; ogiltig färg ignoreras', () => {
  const st = { ...pmiPlan(), palette: 'kontrast', phaseColors: { Utförande: '#123456', Inköp: 'red', IT: '#abc' } };
  assert.equal(C.phaseColor(st, 'Utförande', SERIES, OTHER), '#123456');
  assert.equal(C.phaseColor(st, 'Inköp', SERIES, OTHER), C.PAL_KONTRAST[4]);
  assert.equal(C.phaseColor(st, 'IT', SERIES, OTHER), C.PAL_KONTRAST[5]);
  assert.equal(C.phaseColor({ phaseColors: { X: '#00ff00' } }, 'X', SERIES, OTHER), '#00ff00'); // även utanför bucketOrder
});

test('paletteId: PMI som standard och för okänd palett', () => {
  assert.deepEqual(C.PALETTE_IDS, ['pmi', 'standard', 'mjuk', 'kontrast']);
  assert.equal(C.paletteId({}), 'pmi');
  assert.equal(C.paletteId(null), 'pmi');
  assert.equal(C.paletteId({ palette: 'regnbåge' }), 'pmi');
  assert.equal(C.paletteId({ palette: 'okänd' }), 'pmi');
  assert.equal(C.paletteId({ palette: 'mjuk' }), 'mjuk');
  assert.equal(C.paletteId({ palette: 'standard' }), 'standard');
});

test('cleanPhaseColors: bara #rrggbb med fasnamn, små bokstäver', () => {
  assert.deepEqual(C.cleanPhaseColors({ A: '#AABBCC', B: 'javascript:x', C: '#abc', D: '"><svg>', '': '#000000', E: 12 }), { A: '#aabbcc' });
  assert.deepEqual(C.cleanPhaseColors(null), {});
  assert.deepEqual(C.cleanPhaseColors(['#000000']), {});
});

test('export och import (#69): färger och palett följer med, ogiltiga tas bort', () => {
  const plan = { id: 'f1', name: 'Fiktiv färgplan', tasks: [{ id: 't1', name: 'Steg', bucket: 'Bygg', start: '2026-01-05', end: '2026-01-30', deps: [] }],
    settings: { bucketOrder: ['Bygg'], palette: 'mjuk', phaseColors: { Bygg: '#0B4FA8', Test: 'url(#x)' }, viewCode: 'FIKTIVKOD001' } };
  const wb = F.exportWorkbook(F.buildExport([plan], [], '2026-11-02T10:00:00.000Z'));
  const back = F.readExport(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' })).plans[0];
  assert.equal(back.settings.palette, 'mjuk');
  assert.deepEqual(back.settings.phaseColors, { Bygg: '#0b4fa8' });
  assert.equal(back.settings.viewCode, undefined);
  // Påhittad, ändrad fil med okänd palett
  const bad = F.buildExport([{ ...plan, settings: { palette: '<script>', phaseColors: 'x' } }], [], '2026-11-02T10:00:00.000Z');
  const b2 = F.readExport(XLSX.read(XLSX.write(F.exportWorkbook(bad), { type: 'array', bookType: 'xlsx' }), { type: 'array' })).plans[0];
  assert.equal(b2.settings.palette, undefined);
  assert.deepEqual(b2.settings.phaseColors, {});
});

test('mallar (#73): fasens färg och paletten följer med plan → mall → fil → plan', () => {
  const plan = { id: 'f2', name: 'Fiktiv mallplan', tasks: [
    { id: 'a', name: 'Förarbete', bucket: 'Förstudie', start: '2026-01-05', end: '2026-01-30', deps: [] },
    { id: 'g', name: 'G1', bucket: 'Förstudie', start: '2026-02-06', end: '2026-02-06', milestone: true, gate: true, deps: ['a'] },
    { id: 'b', name: 'Bygga', bucket: 'Utveckling', start: '2026-02-09', end: '2026-04-24', deps: ['g'] },
    { id: 'c', name: 'Övrigt arbete', bucket: 'Stöd', start: '2026-02-09', end: '2026-03-06', deps: [] },
  ], settings: { bucketOrder: ['Förstudie', 'Utveckling', 'Stöd'], phaseCodes: { Förstudie: 'G1' }, palette: 'kontrast',
    phaseColors: { Förstudie: '#A3195B', Utveckling: '#00704a', Borttagen: '#111111' } } };
  const tpl = F.planToTemplate(plan, { name: 'Fiktiv mall' });
  assert.equal(tpl.palette, 'kontrast');
  assert.deepEqual(tpl.phases, [{ name: 'Förstudie', gate: 'G1', color: '#a3195b' }, { name: 'Utveckling', color: '#00704a' }, { name: 'Stöd' }]);
  const file = F.readTemplateWb(XLSX.read(XLSX.write(F.templateWorkbook(tpl), { type: 'array', bookType: 'xlsx' }), { type: 'array' }));
  assert.deepEqual(file.phases, tpl.phases);
  assert.equal(file.palette, 'kontrast');
  const st = F.tplColorSettings(F.templateLib(file));
  assert.deepEqual(st, { phaseColors: { Förstudie: '#a3195b', Utveckling: '#00704a' }, palette: 'kontrast' });
  // Lägg till från mall: mallens fas hamnar i planens motsvarande fas
  assert.deepEqual(F.tplColorSettings(F.templateLib(file), n => n === 'Förstudie' ? 'Feasibility' : n).phaseColors, { Feasibility: '#a3195b', Utveckling: '#00704a' });
  // Mall utan färger ger inga inställningar; skadade färger rensas
  assert.deepEqual(F.tplColorSettings({ phases: [{ name: 'X' }] }), {});
  const dirty = F.cleanTemplate({ ...tpl, palette: 'neon', phases: [{ name: 'Förstudie', color: 'expression(x)' }] });
  assert.equal(dirty.palette, undefined);
  assert.deepEqual(dirty.phases[0], { name: 'Förstudie' });
});

test('versioner (#76): återställd version har versionens färger och palett', () => {
  const V = new Function(pick(/function restoreFrom\([\s\S]*?\n}\n/) + '\nreturn restoreFrom;')();
  const cur = { name: 'Fiktiv', tasks: [], settings: { palette: 'kontrast', phaseColors: { A: '#000000' } } };
  const r = V('plan', { name: 'Fiktiv', tasks: [], settings: { palette: 'mjuk', phaseColors: { A: '#0b4fa8' } } }, cur);
  assert.equal(r.settings.palette, 'mjuk');
  assert.deepEqual(r.settings.phaseColors, { A: '#0b4fa8' });
});
