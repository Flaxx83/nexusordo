// Hjälpcentret (#68, tidigare How to #47): artiklarnas fält, unika id, bilder på båda språken (#78) och rundturer som finns.
// Kör: node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); assert.ok(m, `hittar inte ${re}`); return m[0]; };
const tr = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
const localFileName = () => 'NexusOrdo.html';
const ARTS = pick(/function helpArticles\(\)[\s\S]*?\n}\n/), TOURS = pick(/function tours\(\)[\s\S]*?\n}\n/);
const articles = new Function('tr', 'localFileName', `${ARTS}; return helpArticles();`)(tr, localFileName);
const cats = new Function('tr', `${pick(/const HELP_CATS = [\s\S]*?\]\];\n/)}; return HELP_CATS().map(c => c[0]);`)(tr);
const tourIds = [...TOURS.matchAll(/\{ id: '([^']+)', kind:/g)].map(m => m[1]);

test('hjälpcentret har artiklar i alla kategorier', () => {
  assert.ok(articles.length >= 25);
  assert.deepEqual(cats, ['start', 'plan', 'follow', 'port', 'kb']);
  for (const c of cats) assert.ok(articles.some(a => a.cat === c), `tom kategori: ${c}`);
});
test('varje artikel har id, kategori, titel, ingress och text', () => {
  for (const a of articles) {
    assert.match(a.id || '', /^[a-z0-9-]+$/, `ogiltigt id: ${a.id}`);
    assert.ok(cats.includes(a.cat), `okänd kategori: ${a.id}`);
    assert.ok(a.title && a.lead, `saknar titel eller ingress: ${a.id}`);
    assert.ok(Array.isArray(a.body) && a.body.length, `saknar text: ${a.id}`);
  }
});
test('artiklarnas id är unika', () => assert.equal(new Set(articles.map(a => a.id)).size, articles.length));
test('artiklarna ligger i kategoriordning', () => {
  const order = articles.map(a => cats.indexOf(a.cat));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});
test('artiklarna har bilder', () => assert.ok(articles.filter(a => a.img).length >= 10));
// Bilderna (#78) ligger i app/howto/<sv|en>/ – varje artikel med img, i webbversionen och i lokala filen
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j >= 0, `hittar inte ${a}`); return src.slice(i, j); };
const harness = t => new Function('tr', 'hasPlanTasks', '$', [ARTS, TOURS, blk('/* ---------- Hjälpcenter och rundturer', 'const shownArticles')].join('\n')
  + '\nreturn { helpFor, toursFor, tours };')(t, () => true, () => null);
const H = harness(tr);
const NEW_IMG = { farger: '15-colors', agila: '16-agile', skapamall: '17-save-template', versioner: '18-versions', checklista: '05-checklist' };
const arts = H.helpFor(articles), fileArts = H.helpFor(articles, true);
for (const lang of ['sv', 'en']) test(`alla artikelbilder finns (${lang})`, () => {
  for (const a of [...arts, ...fileArts].filter(x => x.img)) assert.ok(existsSync(new URL(`../app/howto/${lang}/${a.img}.png`, import.meta.url)), `saknas: howto/${lang}/${a.img}.png (${a.id})`);
});
test('alla bilder i howto/<sv|en> används av någon artikel', () => {
  const used = new Set([...arts, ...fileArts].map(a => a.img).filter(Boolean));
  for (const lang of ['sv', 'en']) for (const f of readdirSync(new URL(`../app/howto/${lang}/`, import.meta.url)).filter(f => f.endsWith('.png')))
    assert.ok(used.has(f.slice(0, -4)), `bilden används inte: ${lang}/${f}`);
});
test('de nya funktionerna har bilder', () => {
  for (const [id, img] of Object.entries(NEW_IMG)) assert.equal((arts.find(a => a.id === id) || {}).img, img, id);
});
// Lokala filen har en egen bild av programvyn (FILE_IMG); webbversionen visar originalet
const FILE_IMG = new Function(`return ${pick(/const FILE_IMG = (\{[^}]*\});/).match(/\{[^}]*\}/)[0]}`)();
test('lokala filen visar sina bildvarianter (FILE_IMG), webbversionen originalen', () => {
  assert.deepEqual(FILE_IMG, { '08-program': '08-program-fil' });
  assert.equal(arts.find(a => a.id === 'program').img, '08-program');
  assert.equal(fileArts.find(a => a.id === 'program').img, '08-program-fil');
  assert.ok(!fileArts.some(a => Object.keys(FILE_IMG).includes(a.img)));
});
test('källkoden läser bilderna i howto/<språk>/', () => assert.match(src, /const howtoImg = img => \(HOWTO_IMG\[LANG\] \|\| \{\}\)\[img\] \|\| `howto\/\$\{LANG\}\/\$\{img\}\.png`;/));
test('varje rundtur som en artikel pekar på finns i tours() eller gateTours()', () => {
  assert.ok(tourIds.length >= 10);
  const ids = H.toursFor(H.tours()).map(t => t.id);
  for (const a of articles.filter(x => x.tour)) assert.ok(ids.includes(a.tour), `okänd rundtur ${a.tour} i ${a.id}`);
});
test('inga koder i hjälptexterna', () => {
  const text = JSON.stringify(articles);
  assert.doesNotMatch(text, /[?&]plan=[A-Za-z0-9]/);
});

// Delning, plankoder och Feedback finns inte längre – hjälpen och rundturerna nämner dem aldrig, varken i webbversionen eller lokala filen
const GONE = /Feedback|⋯ → Dela…|Öppna med plankod|Nytt program….*länk eller kod/;
const GONE_EN = /Feedback|⋯ → Share…|Open with plan code|New programme….*link or code/;
for (const file of [false, true]) test(`inga artiklar eller rundtursteg om Dela och Feedback (${file ? 'lokala filen' : 'webb'})`, () => {
  const as = H.helpFor(articles, file), ts = H.toursFor(H.tours(), file);
  assert.ok(!as.some(a => a.id === 'dela'), 'Dela en plan visas');
  const sprak = as.find(a => a.id === 'sprak');
  assert.equal(sprak.title, 'Språk och tema');
  assert.equal(sprak.img, undefined, 'Språk och tema: ingen Feedback-bild');
  for (const a of as) for (const s of [a.title, a.lead, ...a.body]) assert.doesNotMatch(s, GONE, `${a.id}: ${s}`);
  for (const t of ts) for (const s of t.steps.flatMap(x => [x.title, x.text])) assert.doesNotMatch(s, /[Ff]eedback|Dela…|mallar, delning/, `${t.id}: ${s}`);
});
test('lokala filen: delprojektens steg 2 och Lokal version säger hur man sparar lokalt (#102)', () => {
  assert.ok(fileArts.find(a => a.id === 'delprojekt').body.some(s => /^<b>2\..*välj huvudplanen i listan/.test(s)), 'Delprojekt steg 2 lokalt');
  assert.match(fileArts.find(a => a.id === 'lokal').lead, /bara i webbläsaren tills du sparar/);
  assert.equal(fileArts.length, arts.length);
});
// Samma kontroll på engelska: texterna är översatta innan lokala filen filtrerar dem, så mönstren måste fånga båda språken
const EN = (() => { const i = src.indexOf('const I18N_EN = {'), j = src.indexOf('\n};', i); return new Function(`return ${src.slice(i + 'const I18N_EN = '.length, j + 3)}`)(); })();
const trEn = (s, v = {}) => tr(EN[s] ?? s, v);
const articlesEn = new Function('tr', 'localFileName', `${ARTS}; return helpArticles();`)(trEn, localFileName);
const HEn = harness(trEn);
for (const file of [false, true]) test(`på engelska: inga borttagna funktioner (${file ? 'lokala filen' : 'webb'})`, () => {
  const as = HEn.helpFor(articlesEn, file), ts = HEn.toursFor(HEn.tours(), file);
  for (const a of as) for (const s of [a.title, a.lead, ...a.body]) assert.doesNotMatch(s, GONE_EN, `${a.id}: ${s}`);
  for (const t of ts) for (const s of t.steps.flatMap(x => [x.title, x.text])) assert.doesNotMatch(s, /[Ff]eedback|Share…|templates, sharing/, `${t.id}: ${s}`);
  assert.equal(as.find(a => a.id === 'sprak').title, 'Language and theme');
});
