// Menyerna (#100, #101): knappen 📊 Uppföljning har de fem uppföljningsverktygen, ⋯-menyn är grupperad under rubriker, toppraden (#101) har ny ordning,
// och ingen hjälptext, rundtur eller tooltip pekar på de gamla menyvägarna eller toppradens gamla knappar. Kör: node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8');
const pick = re => { const m = src.match(re); assert.ok(m, `hittar inte ${re}`); return m[0]; };
const blk = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j >= 0, `hittar inte ${a}`); return src.slice(i, j); };
const EN = (() => { const i = src.indexOf('const I18N_EN = {'), j = src.indexOf('\n};', i); return new Function(`return ${src.slice(i + 'const I18N_EN = '.length, j + 3)}`)(); })();
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
const trs = { sv: fill, en: (s, v) => fill(EN[s] ?? s, v) };
const helpSrc = [pick(/function helpArticles\(\)[\s\S]*?\n}\n/), pick(/function tours\(\)[\s\S]*?\n}\n/),
  blk('/* ---------- Hjälpcenter och rundturer', 'const shownArticles')].join('\n');
const load = tr => new Function('tr', 'hasPlanTasks', '$', 'localFileName', helpSrc + '\nreturn { articles: helpArticles(), helpFor, toursFor, tours };')(tr, () => true, () => null, () => 'NexusOrdo.html');

const menuHtml = id => { const i = html.indexOf(`id="${id}"`); assert.ok(i >= 0, id); const j = html.indexOf('\n      </div>\n', i); return html.slice(i, j); };
const acts = h => [...h.matchAll(/data-act="([^"]+)"/g)].map(m => m[1]);
const FU = ['checklist', 'risks', 'status', 'trend', 'burndown'];

test('📊 Uppföljning har de fem verktygen och ⋯-menyn har dem inte längre', () => {
  assert.deepEqual(acts(menuHtml('fuMenu')), FU);
  const pm = acts(menuHtml('planMenu'));
  for (const a of FU) assert.ok(!pm.includes(a), `${a} finns kvar i ⋯`);
  for (const a of ['import', 'new', 'tplnew', 'newprog', 'sample', 'rename', 'project', 'gates', 'colors', 'capacity', 'tpladd', 'export', 'tplsave', 'pgates', 'versions', 'trash', 'delete', 'fileopen', 'filesave', 'filesaveas'])
    assert.ok(pm.includes(a), `${a} saknas i ⋯`);
  for (const a of ['code', 'share']) assert.ok(!pm.includes(a), `${a} finns kvar i ⋯`);
  assert.equal(pm.at(-1), 'delete', 'Ta bort plan ligger sist');
  // Knappen och menyerna har aria för skärmläsare
  assert.match(html, /id="fuBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="planMenuBtn"[^>]*aria-haspopup="menu"/);
  assert.match(html, /id="fuMenu" role="menu"/);
  assert.match(html, /id="planMenu" role="menu"/);
});

test('⋯-menyns rubriker i ordning, inte klickbara och översatta', () => {
  const pm = menuHtml('planMenu');
  const heads = [...pm.matchAll(/<div class="menu-h" id="(\w+)" role="presentation"[^>]*>([\s\S]*?)<\/div>/g)];
  const keys = heads.map(h => [...(h[0].matchAll(/data-i18n="([^"]+)"/g))].map(m => m[1]).join('|'));
  assert.deepEqual(keys, ['Ny', 'Den här planen|Det här programmet', 'Exportera', 'Program', 'Historik']);
  for (const k of keys.flatMap(k => k.split('|'))) assert.ok(EN[k], `saknar engelska: ${k}`);
  // Varje rubrik namnger sin grupp; grupperna döljs av syncMenuGroups när ingen rad syns
  for (const h of heads) assert.match(pm, new RegExp(`role="group" aria-labelledby="${h[1]}"`));
  assert.match(pick(/function syncMenuGroups\([\s\S]*?\n}\n/), /g\.hidden = !vis/);
  assert.match(pick(/function toggleMenu\([\s\S]*?\n}\n/), /syncMenuGroups\(el\)/);
  // Programvyn: bara Burndown i Uppföljning, planens rader döljs i ⋯
  assert.match(css, /\.in-prog #fuMenu \.no-prog/);
  assert.doesNotMatch(menuHtml('fuMenu').match(/<button[^>]*data-act="burndown"[^>]*>/)[0], /no-prog/);
  for (const a of ['checklist', 'risks', 'status', 'trend']) assert.match(menuHtml('fuMenu'), new RegExp(`data-act="${a}" class="no-prog"`));
});

// De gamla menyvägarna – på svenska och engelska
const OLD = /⋯\s*(?:→|->)\s*(?:☑|⚠|🚦|📈|📉)?\s*(?:Gate-checklista|Risklista|Veckostatus|Milstolpetrend|Burndown|Gate checklist|Risk list|Weekly status|Milestone trend)|(?:Milstolpetrend|Milestone trend)<\/b> \((?:klicka på nästa milstolpe eller ⋯-menyn|click the next milestone or the ⋯ menu)\)/;
test('inga hjälptexter, rundturer eller tooltips pekar på de gamla menyvägarna', () => {
  for (const lang of ['sv', 'en']) {
    const H = load(trs[lang]);
    for (const file of [false, true]) {
      for (const a of H.helpFor(H.articles, file)) for (const s of [a.title, a.lead, ...a.body]) assert.doesNotMatch(s, OLD, `${lang} ${a.id}: ${s}`);
      for (const t of H.toursFor(H.tours(), file)) for (const s of t.steps.flatMap(x => [x.title, x.text])) assert.doesNotMatch(s, OLD, `${lang} ${t.id}: ${s}`);
    }
  }
  for (const [k, v] of Object.entries(EN)) { assert.doesNotMatch(k, OLD, k); assert.doesNotMatch(v, OLD, v); }
  for (const m of html.matchAll(/(?:title|data-i18n[\w-]*)="([^"]*)"/g)) assert.doesNotMatch(m[1], OLD, m[1]);
  assert.doesNotMatch(src, OLD, 'källkoden (även kommentarer)');
});

test('rundtursteg om uppföljningsverktygen pekar på den nya knappen', () => {
  const H = load(trs.sv);
  for (const t of [...H.toursFor(H.tours()), ...H.toursFor(H.tours(), true)])
    for (const s of t.steps) if (/📊 Uppföljning →/.test(s.title + s.text)) {
      assert.match(s.sel, /#fuBtn|#fuMenu/, `${t.id}: ${s.title}`);
      assert.doesNotMatch(s.sel, /#planMenuBtn/, `${t.id}: ${s.title}`);
    }
  const nf = H.tours().find(t => t.id === 'new-followup');
  assert.ok(nf, 'Nytt-rundturen new-followup saknas');
  assert.equal(nf.kind, 'new');
  assert.match(nf.since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(nf.steps.some(s => s.sel === '#fuBtn') && nf.steps.some(s => s.sel === '#planMenuBtn'));
});

test('språkbyte döljer ett synligt meddelande (toast) och stänger menyerna', () => {
  const setLang = pick(/function setLang\([\s\S]*?\n}\n/);
  assert.match(setLang, /hideToast\(\)/);
  assert.match(setLang, /closeMenus\(\)/);
  // hideToast stoppar också timern, så att ett nytt meddelande inte stängs för tidigt
  const hide = pick(/function hideToast\(\) \{[^\n]*\}/);
  assert.match(hide, /clearTimeout\(toastTimer\)/);
  assert.match(hide, /#toast'\)\.hidden = true/);
});

// Toppraden (#101): planväljare · ⋯ → flikar → planens verktyg → avdelare → ? · språk · tema.
// Import ligger i planväljaren och ⋯ → Ny, Feedback i ?-menyn, hjälpcentret bara via ? (ingen How to-flik).
const topbar = (() => { const i = html.indexOf('<header class="topbar">'), j = html.indexOf('</header>', i); return html.slice(i, j); })();
test('toppraden har den nya ordningen och inga borttagna knappar', () => {
  const order = ['id="planSelect"', 'id="planMenuBtn"', 'id="viewSeg"', 'id="fuBtn"', 'id="updBtn"', 'id="exportBtn"', 'id="undoBtn"', 'class="tb-div"', 'id="helpBtn"', 'id="langBtn"', 'id="themeBtn"'];
  const pos = order.map(k => { const i = topbar.indexOf(k); assert.ok(i >= 0, k); return i; });
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] > pos[i - 1], `${order[i]} ska ligga efter ${order[i - 1]}`);
  for (const old of ['id="importBtn"', 'id="feedbackBtn"', 'data-v="howto"', 'data-pg="howto"']) assert.ok(!html.includes(old), `${old} finns kvar`);
  // Import: ⋯ → Ny har en <label for="fileInput"> (filväljaren i sandlådan), tomvyn behåller sin knapp
  const ny = menuHtml('planMenu').slice(0, menuHtml('planMenu').indexOf('aria-labelledby="pmhPlan"'));
  assert.match(ny, /<label role="menuitem" tabindex="-1" for="fileInput"[^>]*data-act="import"/);
  assert.match(html, /<label class="btn" id="emptyImport" for="fileInput"/);
  // Planväljaren: sista raden + Ny plan / Importera… öppnar en dialog med etiketten för filväljaren
  assert.match(pick(/function renderPlanSelect\(\)[\s\S]*?\n}\n/), /<option value="\$\{NEW_OPT\}">\$\{tr\('\+ Ny plan \/ Importera…'\)\}<\/option>/);
  const np = pick(/function openNewPlan\(\)[\s\S]*?\n}\n/);
  assert.match(np, /<label class="btn" for="fileInput" id="npImport"/);
  assert.doesNotMatch(np, /\.click\(\)[^;]*fileInput|fileInput'\)\.click/, 'filväljaren öppnas inte med input.click()');
  assert.match(src, /if \(v === NEW_OPT\) \{ renderPlanSelect\(\); return openNewPlan\(\); \}/);
  for (const k of ['+ Ny plan / Importera…', '⇪ Importera från Excel…']) assert.ok(EN[k], `saknar engelska: ${k}`);
});

test('?-menyn har hjälpcentret (ingen Feedback); &help= och ui.view howto fungerar', () => {
  const hm = pick(/function renderHelpMenu\(\)[\s\S]*?\n}\n/);
  assert.match(hm, /data-help="">📖 \$\{tr\('Hjälpcenter'\)\}/);
  assert.match(hm, /Hjälp för den här sidan/);
  assert.doesNotMatch(hm, /data-fb|Feedback/);
  assert.match(css, /\.help-menu \{[^}]*max-height:[^}]*overflow-y: auto/);
  assert.doesNotMatch(src, /openFeedback/);
  assert.match(pick(/function openHelp\([\s\S]*?\n}\n/), /ui\.view = 'howto'/);
  assert.match(src, /if \(helpId && shownArticles\(\)\.some\(a => a\.id === helpId\)\) \{ ui\.view = 'howto'; ui\.helpId = helpId; \}/);
});

test('språkknappen visar aktuellt språk och har en meny med samma tangentbord som de andra', () => {
  assert.match(topbar, /id="langBtn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="langMenu"/);
  assert.match(topbar, /id="langMenu" role="menu"/);
  assert.deepEqual([...menuHtml('langMenu').matchAll(/data-lang="(\w+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2]]), [['sv', 'Svenska'], ['en', 'English']]);
  assert.match(src, /\['#langBtn', '#langMenu', '\.lang-picker'\]\]/, 'språkmenyn finns i MENUS (Esc, piltangenter, Tab)');
  assert.match(pick(/function applyStaticI18n\(\)[\s\S]*?\n}\n/), /lb\.textContent = `\$\{LANG\.toUpperCase\(\)\} ▾`/);
  assert.ok(EN['Språk'], 'saknar engelska: Språk');
});

// Gamla platser: ⇪ Importera ny plan-knappen, How to-fliken, 💬 Feedback i toppraden och EN/SV-knappen – på svenska och engelska
const OLD101 = /⇪ (?:Importera ny plan|Import new plan)|How to – |fliken How to|How to-fliken|How to is now|the How to tab|<b>EN\/SV<\/b>|<b>EN<\/b> \/ <b>SV<\/b>|(?<!\? → )<b>💬 Feedback<\/b>/;
const OLD_SEL = /#importBtn|#feedbackBtn|data-v="howto"|data-pg="howto"/;
test('inga hjälptexter, rundturer eller översättningar pekar på toppradens gamla platser', () => {
  for (const lang of ['sv', 'en']) {
    const H = load(trs[lang]);
    for (const file of [false, true]) {
      for (const a of H.helpFor(H.articles, file)) for (const s of [a.title, a.lead, ...a.body]) assert.doesNotMatch(s, OLD101, `${lang} ${a.id}: ${s}`);
      for (const t of H.toursFor(H.tours(), file)) for (const s of t.steps) {
        assert.doesNotMatch(s.title + ' ' + s.text, OLD101, `${lang} ${t.id}: ${s.title}`);
        assert.doesNotMatch(s.sel, OLD_SEL, `${t.id}: ${s.sel}`);
        if (/💬 Feedback/.test(s.text)) { assert.ok(!file, `${t.id}: Feedback i lokala filen`); assert.match(s.sel, /#helpBtn|#helpMenu/, `${t.id}: ${s.title}`); }
      }
    }
  }
  for (const [k, v] of Object.entries(EN)) { assert.doesNotMatch(k, OLD101, k); assert.doesNotMatch(v, OLD101, v); }
  for (const m of html.matchAll(/(?:title|data-i18n[\w-]*)="([^"]*)"/g)) assert.doesNotMatch(m[1], OLD101, m[1]);
  assert.doesNotMatch(src, OLD_SEL, 'källkoden väljer gamla knappar');
  assert.doesNotMatch(src, /\$\('#(?:feedbackBtn|importBtn)'\)/);
});

test('Nytt-rundturen new-topbar visar planväljaren, planens verktyg, ? och språket', () => {
  const H = load(trs.sv);
  const t = H.tours().find(x => x.id === 'new-topbar');
  assert.ok(t, 'new-topbar saknas');
  assert.equal(t.kind, 'new');
  assert.match(t.since, /^\d{4}-\d{2}-\d{2}$/);
  for (const sel of ['#planSelect', '#helpBtn', '#langBtn']) assert.ok(t.steps.some(s => s.sel === sel), sel);
  // Lokala filen: steget om ?-menyn nämner inte Feedback
  const f = H.toursFor(H.tours(), true).find(x => x.id === 'new-topbar');
  assert.ok(f.steps.every(s => !/Feedback/.test(s.text)));
});
