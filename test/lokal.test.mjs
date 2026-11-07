// Lokal version (#70): bygget ger en fristående HTML-fil utan externa resurser, koder eller nycklar.
// Kör: node --test "test/*.test.mjs"
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'tp-lokal-'));
const out = join(dir, 'TimePlan-lokal.html');
execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-lokal.mjs', import.meta.url)), out], { stdio: 'pipe' });
const html = readFileSync(out, 'utf8');
rmSync(dir, { recursive: true, force: true });
const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');

test('en fil: stil, SheetJS, version och appen inbäddade', () => {
  assert.match(html, /^<!doctype html>/);
  assert.equal((html.match(/<script>/g) || []).length, 3);
  assert.equal((html.match(/<\/script>/g) || []).length, 3, 'ingen </script> inne i den inbäddade koden');
  assert.ok(!/<!--[\s\S]*<script/.test(html.slice(html.indexOf('<script>'))), 'inget <!-- före <script i koden');
  assert.match(html, /window\.TP_LOCAL = \{"version":"[^"]+","date":"[^"]*"\}/);
  assert.ok(html.includes('SheetJS') && html.includes('XLSX'));
  assert.ok(html.includes('const TEMPLATE_LIB'), 'mallbiblioteket');
  assert.match(html, /const HOWTO_IMG = \{"sv":\{"01-start":"data:image\/(webp|png);base64,/);
});

test('inga externa resurser – fungerar utan nätverk', () => {
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link[^>]+href=/i.test(html));
  assert.ok(!html.includes('data-embed="sheetjs"'));
  assert.ok(!/cdn\.|jsdelivr|unpkg/i.test(html));
});

test('inga koder eller nycklar i filen', () => {
  assert.doesNotMatch(html, /[?&](plan|kod)=[A-Z0-9]{4}-?[A-Z0-9]{4}/);
  assert.doesNotMatch(html, /api[_-]?key|x-api-key|Bearer [A-Za-z0-9]/i);
});

// Delning, plankoder, inloggning och Feedback är borttagna – appen är lokal och för en användare
test('appens kod: filläget använder egna nycklar i localStorage, ingen delning eller inloggning', () => {
  assert.match(src, /const FILE_MODE = !!window\.TP_LOCAL;/);
  assert.match(src, /const pre = FILE_MODE \? `tpl:\$\{location\.pathname\}:` : '';/);
  assert.doesNotMatch(src, /whoAmI/, 'ingen inloggning');
  const index = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  for (const sel of ['data-act="share"', 'data-act="code"', 'data-fb']) assert.ok(!index.includes(sel) && !src.includes(sel), sel);
  // Nytt program finns i lokala filen sedan #102
  const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8');
  assert.ok(index.includes('data-act="newprog"'));
  assert.ok(!css.includes('.file-mode #planMenu [data-act="newprog"]'), 'Nytt program visas lokalt');
});

// #102: program i lokala versionen – sparas med alla planer i en fil, öppnas med Ersätt eller kopia, planerna väljs i en lista
test('lokala filen: program sparas och öppnas som fil (#102)', () => {
  assert.match(src, /buildExport\(pls, prog \? \[prog\] : \[\]/, '💾 Spara tar med programmets planer');
  assert.match(src, /if \(FILE_MODE && d\.programs\.length === 1\) return openProgramFile\(d, handle\);/);
  // #105: planerna väljs i en lista, utan fält för länk eller kod
  assert.match(src, /const addPlanToProgram = \(\) => pickPlansForProgram\(\);/);
  assert.doesNotMatch(src, /withCode/);
  assert.match(src, /function saveProgram\(\) \{\n  if \(!program\) return;\n  const p = program;\n  markDirty\(p\);/, 'programändringar markeras som ej sparade');
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="fileBanner"/);
  assert.match(src, /ts\.filter\(t => !t\.fileOnly\)/, 'rundturen om lokala program visas bara i lokala filen');
});
