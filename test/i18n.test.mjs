// Språkval (#46): varje text som går genom tr() ska ha en engelsk översättning i I18N_EN.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const start = src.indexOf('const I18N_EN = {');
const end = src.indexOf('\n};', start);
const EN = new Function(`return ${src.slice(start + 'const I18N_EN = '.length, end + 3)}`)();
const code = src.slice(0, start) + src.slice(end + 3);

// Alla stränglitteraler i första argumentet till tr(...), även i villkor som tr(n > 1 ? 'a' : 'b')
function trKeys(s) {
  const keys = new Set();
  const re = /\btr\(/g;
  let m;
  while ((m = re.exec(s))) {
    let i = m.index + 3, depth = 0, arg = '';
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === "'" || c === '`' || c === '"') { // hoppa över hela strängen
        let j = i + 1; while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
        arg += s.slice(i, j + 1); i = j; continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
      if (c === ',' && depth === 0) break;
      arg += c;
    }
    for (const q of arg.matchAll(/'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g)) {
      const k = (q[1] ?? q[2]).replace(/\\'/g, "'");
      if (!k.includes('${')) keys.add(k);
    }
  }
  return keys;
}

test('alla tr()-nycklar har engelsk översättning', () => {
  const missing = [...trKeys(code)].filter(k => EN[k] == null);
  assert.deepEqual(missing, []);
});

test('texter som översätts vid visning (status, beroenden, gate-kriterier) finns i ordlistan', () => {
  const tables = ['STATUS_TXT', 'DEP_TXT', 'DEP_TYPES'].flatMap(n => {
    const m = code.match(new RegExp(`const ${n} = (\\{[^}]*\\})`));
    return Object.values(new Function(`return ${m[1]}`)());
  });
  const gc = new Function(`return ${code.match(/const GATE_CRITERIA = (\[[^\]]*\])/)[1]}`)();
  const st = Object.values(new Function(`return ${code.match(/const CHK_ST = (\{[^\n]*\});/)[1]}`)()).map(x => x.label);
  const hol = [...code.match(/function seHolidays[\s\S]*?\n}/)[0].matchAll(/, '([^']+)'\]/g)].map(m => m[1]);
  assert.equal(hol.length, 16);
  const missing = [...tables, ...gc, ...st, ...hol].filter(k => EN[k] == null);
  assert.deepEqual(missing, []);
});

test('exempelplanen har engelska namn på alla aktiviteter, faser och styrgruppen', () => {
  const sampleEn = new Function(`return ${code.match(/const SAMPLE_EN = (\{[\s\S]*?\n\});/)[1]}`)();
  const body = code.match(/function samplePlan\(\) \{[\s\S]*?\n\}/)[0];
  const args = [...body.matchAll(/P\('([^']+)', '([^']+)', [-\d]+, [-\d]+, \d+, '([^']+)'/g)];
  assert.ok(args.length >= 20);
  const words = args.flatMap(m => [m[1], m[2], ...m[3].split('; ').filter(x => x === 'Styrgrupp')]);
  assert.deepEqual(words.filter(w => sampleEn[w] == null && w !== 'Go-live'), []);
});

test('index.html: alla data-i18n-nycklar har engelsk översättning', () => {
  const keys = [...html.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria)?="([^"]*)"/g)].map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  assert.ok(keys.length > 30);
  assert.deepEqual(keys.filter(k => EN[k] == null), []);
});

test('ingen översättning är tom och platshållarna stämmer', () => {
  for (const [k, v] of Object.entries(EN)) {
    assert.ok(String(v).trim(), `tom översättning: ${k}`);
    const ph = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
    assert.equal(ph(v), ph(k), `platshållare skiljer: ${k}`);
  }
});
