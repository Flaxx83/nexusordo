// Tester för dokumentlänkar på aktiviteter (#23). Funktionerna läses direkt ur app/script.js. Kör: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); if (!m) throw new Error('Hittar inte ' + re); return m[0]; };
const code = [
  pick(/const LINK_HOST_OK = .*;/), pick(/function normLink\([\s\S]*?\n}\n/), pick(/function linkType\([\s\S]*?\n}\n/),
  pick(/const DAY = .*;/), pick(/const utcDay = .*;/), pick(/const toDay = .*;/), pick(/const normName = .*;/),
  'const tr = (s, v) => v ? s.replace(/\\{(\\w+)\\}/g, (m, k) => v[k] ?? m) : s; const fmtShortY = x => x || "–";',
  pick(/const todayDay = .*;/), pick(/function normGoalStatus\([\s\S]*?\nconst actualDayFromWeek = .*;/),
  pick(/function mergeImport\([\s\S]*?\n}\n/),
  pick(/\/\* ---------- Checklista på aktiviteter \(#71\)[\s\S]*?slut checklista ---------- \*\//),
].join('\n');
const { normLink, linkType, mergeImport } = new Function(code + '\nreturn { normLink, linkType, mergeImport };')();

test('titel från filnamnet och SharePoint känns igen', () => {
  const l = normLink('https://contoso.sharepoint.com/sites/proj/Shared%20Documents/Risk%20Analysis.xlsm?web=1');
  assert.equal(l.title, 'Risk Analysis.xlsm');
  assert.equal(l.sharepoint, true);
  assert.equal(normLink(' https://x.example.net/a/b.pdf ', ' Min titel ').title, 'Min titel');
  assert.equal(normLink('https://example.com/').title, 'example.com');
  assert.equal(normLink('https://example.com/a.docx').sharepoint, false);
});

test('bara http(s) godkänns', () => {
  assert.equal(normLink('javascript:alert(1)'), null);
  assert.equal(normLink('file:///c:/x.docx'), null);
  assert.equal(normLink('inte en länk'), null);
  assert.equal(normLink(''), null);
});

test('korta SharePoint-länkar får sidans värdnamn som titel', () => {
  assert.equal(normLink('https://contoso.sharepoint.com/:x:/r/sites/p/EaBcDeFgHiJkLmNoPqRsTuVw').title, 'contoso.sharepoint.com');
});

test('dokumenttyp från SharePoint-markör eller filändelse', () => {
  assert.equal(linkType('https://contoso.sharepoint.com/:w:/r/sites/p/Doc.aspx'), 'word');
  assert.equal(linkType('https://contoso.sharepoint.com/:x:/s/p/abc'), 'excel');
  assert.equal(linkType('https://contoso.sharepoint.com/:p:/s/p/abc'), 'ppt');
  assert.equal(linkType('https://contoso.sharepoint.com/:b:/s/p/abc'), 'pdf');
  assert.equal(linkType('https://contoso.sharepoint.com/:f:/s/p/abc'), 'folder');
  assert.equal(linkType('https://x.com/Status%20Report.pptx'), 'ppt');
  assert.equal(linkType('https://x.com/sites/p/Shared%20Documents/Forms/AllItems.aspx'), 'folder');
  assert.equal(linkType('https://x.com/page'), 'link');
});

test('ny import från Planner behåller dokumentlänkarna', () => {
  const links = [{ id: 'l1', url: 'https://contoso.sharepoint.com/a.docx', title: 'A', addedAt: '2026-10-28' }];
  const plan = { tasks: [{ id: 't1', plannerId: 'P1', name: 'RFQ', bucket: 'Dev', start: '2026-01-05', end: '2026-01-09', deps: [], links }] };
  const imp = { tasks: [{ id: 'x', plannerId: 'P1', name: 'RFQ', bucket: 'Dev', start: '2026-01-12', end: '2026-01-16', deps: [] }] };
  const res = mergeImport(plan, imp);
  assert.deepEqual(res.tasks[0].links, links);
  assert.notEqual(res.tasks[0].links, links); // kopia, inte samma lista
});

test('borttagen aktivitet med dokument rapporteras', () => {
  const plan = { tasks: [{ id: 't1', plannerId: 'P1', name: 'RFQ', bucket: 'Dev', deps: [], links: [{ id: 'l', url: 'https://a.b/c', title: 'c' }] }] };
  const res = mergeImport(plan, { tasks: [] });
  assert.equal(res.report.lost.length, 1);
});
