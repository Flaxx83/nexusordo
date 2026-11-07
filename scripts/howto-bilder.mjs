// Tar bilderna till hjälpcentret (? → 📖 Hjälpcenter) på svenska och engelska: app/howto/<sv|en>/NN-namn.png.
// Använder BARA de påhittade testplanerna i exempel/bas/ (egna gater G1–G4) – aldrig riktiga planer.
// Programvyn tas också i lokala filens utseende (08-program-fil, FILE_IMG i app/script.js).
// Burndown (21-burndown) tas med en påhittad Scrum-plan från den agila mallen och påhittad historik i minnet.
// Kör: NODE_PATH=$(npm root -g) node scripts/howto-bilder.mjs [--bara 15-colors,16-agile]
//   --bara: spara bara de namngivna bilderna (stegen körs ändå)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const globalRoot = () => execSync('npm root -g').toString().trim();
const load = name => { try { return require(name); } catch { return require(path.join(globalRoot(), name)); } };
const { chromium } = load('playwright');
let sharp = null; try { sharp = load('sharp'); } catch { /* bilderna sparas okomprimerade */ }

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(REPO, 'app'), EX = path.join(REPO, 'exempel');
const BAS = ['Ny besöksreception (fiktiv).xlsx', 'Delprojekt IT – Besökssystem (fiktivt).xlsx', 'Delprojekt Utbildning (fiktivt).xlsx'].map(f => path.join(EX, 'bas', f));
// Visa produktnamnet även i hjälpbilderna (döljs av appens responsiva layout vid <= 1680 px).
const W = 1760, H = 1000;
const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const ONLY = opt('--bara') ? new Set(opt('--bara').split(',').map(x => x.trim())) : null;

// Sandlådad ram (utan allow-same-origin): localStorage blockeras, appen körs i minnesläge med bara påhittad data
const composed = () => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app/style.css"></head><body>`
  + fs.readFileSync(path.join(APP, 'index.html'), 'utf8').replace('src="vendor/', 'src="/app/vendor/') + '<script src="/app/script.js"></script></body></html>';
const host = () => `<!doctype html><html><body style="margin:0"><iframe id="f" src="/composed.html?tour=0" sandbox="allow-scripts allow-popups" style="width:${W}px;height:${H}px;border:0"></iframe></body></html>`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.xlsx': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  res.setHeader('Access-Control-Allow-Origin', '*');
  const hm = url.match(/^\/(host|composed)\.html$/);
  if (hm) { res.setHeader('Content-Type', TYPES['.html']); return res.end(hm[1] === 'host' ? host() : composed()); }
  const map = [['/app/', APP], ['/exempel/', EX], ['/howto/', path.join(APP, 'howto')]].find(([p]) => url.startsWith(p));
  const file = map && path.join(map[1], url.slice(map[0].length));
  if (!file || !file.startsWith(map[1]) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--no-sandbox'], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
const sizes = [];

// Öppnar sandlådan för ett språk; c = { page, f, frame, wait, shot, closeModal, menu, lang, sv }
async function open(lang) {
  const out = path.join(APP, 'howto', lang);
  fs.mkdirSync(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${BASE}/host.html`);
  await page.waitForTimeout(2000);
  const f = page.frameLocator('#f');
  const frame = page.frames().find(x => x.url().includes('composed.html'));
  const wait = ms => page.waitForTimeout(ms);
  const shot = async (name, el) => {
    if (ONLY && !ONLY.has(name)) return;
    await wait(350);
    let buf = await (el || page.locator('#f')).screenshot();
    if (sharp) buf = await sharp(buf).png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
    fs.writeFileSync(path.join(out, name + '.png'), buf);
    sizes.push(`${lang}/${name}.png ${Math.round(buf.length / 1024)} KB`);
  };
  const closeModal = async () => { await page.keyboard.press('Escape'); await wait(200); };
  // De fem uppföljningsverktygen ligger under 📊 Uppföljning (#100), resten i ⋯
  const FU = ['checklist', 'risks', 'status', 'trend', 'burndown'];
  const menu = async act => { const [b, m] = FU.includes(act) ? ['#fuBtn', '#fuMenu'] : ['#planMenuBtn', '#planMenu']; await f.locator(b).click(); await f.locator(`${m} button[data-act="${act}"]`).click(); await wait(500); };
  await frame.addStyleTag({ content: '.toast { display: none !important; }' }); // inga tillfälliga meddelanden i bilderna
  if (lang === 'en') { await f.locator('#langBtn').click(); await f.locator('#langMenu [data-lang="en"]').click(); await wait(300); } // språkmenyn (#101)
  return { page, f, frame, wait, shot, closeModal, menu, lang, sv: lang === 'sv', errors };
}

// Färger (#74), Skapa mall (#73) och Versioner (#76) med den öppna planen
async function newFeatures(c) {
  const { f, frame, wait, shot, closeModal, menu } = c;
  await menu('colors'); await f.locator('.modal').waitFor();
  await shot('15-colors');
  await closeModal();
  await menu('tplsave'); await f.locator('#stName').waitFor();
  await shot('17-save-template');
  await closeModal();
  // Versioner: två påhittade äldre versioner (en vecka senare datum och en aktivitet färre) och en sparad nu
  await frame.evaluate(async () => {
    const d = verRow('plan', plan), shift = (t, n) => { if (t.end) t.end = fromDay(toDay(t.end) - n); if (t.start) t.start = fromDay(toDay(t.start) - n); };
    const old = JSON.parse(JSON.stringify(d));
    old.tasks = old.tasks.slice(0, -1); old.tasks.filter(t => !t.milestone).slice(3, 6).forEach(t => shift(t, 14));
    await saveVersion('plan', plan, 'import', old);
    const mid = JSON.parse(JSON.stringify(d)); mid.tasks.filter(t => !t.milestone).slice(4, 5).forEach(t => shift(t, 7));
    await saveVersion('plan', plan, 'daily', mid);
    await saveVersion('plan', plan, 'manual');
  });
  await menu('versions'); await f.locator('.ver-tbl').waitFor();
  await f.locator('.ver-tbl [data-vact="diff"]').last().click(); await wait(300);
  await shot('18-versions');
  await closeModal();
}
// Insats och belastning (#94): påhittad insats på programmets påhittade planer, programmets belastning med en vald ruta
async function effort(c) {
  const { f, frame, wait, shot } = c;
  await frame.evaluate(() => {
    const ids = new Set(program.plans.map(r => r.planId));
    for (const p of allPlans.filter(x => ids.has(x.id))) p.tasks.filter(t => !t.milestone).forEach((t, i) => {
      const days = Math.max(1, Math.round((toDay(t.end) - toDay(t.start)) * 5 / 7));
      t.effort = { planned: Math.round(days * [2, 3, 4, 6][i % 4]), done: null, remaining: null, src: i % 3 ? 'planner' : 'tp' };
    });
    ui.ldWeeks = 13; ui.ldBasis = 'planned'; ui.ldPerson = null; ui.ldFrom = null; ui.pgView = 'load'; render(true);
  });
  await wait(500);
  const cell = f.locator('.ld-c.lv-over, .ld-c.lv-warn, .ld-c.lv-ok').first();
  if (await cell.count()) { await cell.click(); await wait(300); }
  await shot('19-effort');
}
// Programgater och gate-översikt (#21): påhittade programgater och huvudprojekt i minnet, fliken Gater med en vald ruta
async function gatesShot(c) {
  const { f, frame, wait, shot } = c;
  await frame.evaluate(() => {
    const ids = program.plans.map(r => r.planId), pls = allPlans.filter(x => ids.includes(x.id));
    const main = pls.find(x => /besöksreception/.test(x.name)), l1 = 'Besöksprojektet (fiktivt)';
    pls.forEach(x => { x.settings.project = x === main ? { l1, role: 'main' } : { l1, l2: x.name, ...(/Delprojekt (D|Utbildning)/.test(x.name) ? { gates: 'inherit' } : {}) }; });
    program.milestones = cleanProgramGates([{ code: 'G1', week: '2641', status: 'done' }, { code: 'G2', week: '2704', status: 'ontrack' }, { code: 'G3', week: '2714', status: 'atrisk' }, { code: 'G4', week: '2724' }]);
    ui.pgOnlyDev = false; gxSel = null; ui.pgView = 'gates'; render(true);
  });
  await wait(500);
  const cell = f.locator('td.gx-c.gs-late').first();
  if (await cell.count()) { await cell.click(); await wait(300); }
  await shot('20-gates');
  await frame.evaluate(() => { gxSel = null; ui.pgView = 'cards'; render(true); });
}
// Programvyn som i lokala filen (FILE_IMG): body.file-mode döljer Feedback. FILE_MODE går inte att slå på i efterhand, så texterna som
// lokala filen visar sätts här (#102): ingen ägare i rubriken och ＋ Lägg till plan väljer bland planerna i stället för länk eller kod
async function fileModeShot(c) {
  await c.frame.evaluate(() => {
    document.body.classList.add('file-mode'); render(true);
    $('#pgSub').textContent = tr('{n} projekt', { n: program.plans.length });
    const m = $('.pg-card.add .pg-meta'); if (m) m.textContent = tr('välj bland dina planer');
  });
  await c.wait(500);
  await c.shot('08-program-fil');
  await c.frame.evaluate(() => { document.body.classList.remove('file-mode'); render(true); });
  await c.wait(300);
}
// Agila mallar (#77): Scrum i mall-dialogen (som redan är öppen), startvecka om sex veckor
async function agile(c) {
  const { f, frame, shot } = c;
  await f.locator('input[name="tplSrc"][value="agile:scrum"]').check(); await c.wait(400);
  const wk = await frame.evaluate(() => fmtYYWW(todayDay() + 42));
  const start = f.locator('[data-gate="START"]');
  if (await start.count()) { await start.fill(wk); await start.press('Tab'); }
  await f.locator('#tplName').fill(c.sv ? 'Kundportal – Scrum (fiktiv)' : 'Customer portal – Scrum (fictive)').catch(() => {});
  await shot('16-agile');
}

// Burndown (#95): påhittad Scrum-plan från den agila mallen (start för fem veckor sedan) med påhittad progress, insats och historik i minnet
async function burndownShot(c) {
  const { f, frame, wait, shot, closeModal, menu, sv } = c;
  await menu('tplnew'); await f.locator('input[name="tplSrc"][value="agile:scrum"]').check(); await wait(300);
  const wk = await frame.evaluate(() => fmtYYWW(todayDay() - 35));
  await f.locator('[data-gate="START"]').fill(wk); await f.locator('[data-gate="START"]').press('Tab');
  await f.locator('#tplName').fill(sv ? 'Kundportal – Scrum (fiktiv)' : 'Customer portal – Scrum (fictive)');
  await f.locator('.m-foot button').last().click(); await wait(1200);
  await frame.evaluate(() => {
    const td = todayDay(), final = (t, i) => toDay(t.end) < td ? (i % 7 === 3 ? 70 : 100) : toDay(t.start) <= td ? 45 : 0;
    // läget en viss dag: aktiviteten går linjärt mot sitt slutliga värde mellan start och slut (+ två dagars eftersläpning)
    const at = d => plan.tasks.map((t, i) => { const s = toDay(t.start), e = toDay(t.end) + 2, p = final(t, i);
      return { ...t, progress: t.milestone ? (e <= d ? 100 : 0) : Math.round(p * clamp((d - s) / Math.max(1, Math.min(e, td) - s), 0, 1)) }; });
    plan.tasks.forEach((t, i) => { if (!t.milestone) t.effort = { planned: 8 * (2 + (i % 4)), done: null, remaining: null, src: 'tp' }; });
    const start = Math.min(...plan.tasks.map(t => toDay(t.start)));
    let burn = [];
    for (let d = start; d < td; d++) if (isWorkday(d, calendarOf(plan.settings))) burn = burnRecord(burn, at(d), fromDay(d));
    plan.tasks.forEach((t, i) => { t.progress = final(t, i); });
    plan.settings.burn = burn; render();
  });
  await menu('burndown'); await f.locator('#bdChart svg').waitFor(); await wait(400);
  await shot('21-burndown');
  await closeModal();
}
// Kritisk linje (#4): den påhittade huvudplanen, nästa gate får fasens aktiviteter som beroenden i minnet (sparas inte), målet = gaten, tooltip på en kritisk aktivitet
async function criticalShot(c, re) {
  const { f, frame, wait, shot, page } = c;
  await frame.evaluate(src => {
    const p = allPlans.find(x => new RegExp(src).test(x.name)); selectPlan(p.id, true);
    const m = planGateMargin(plan), g = m && plan.tasks.find(t => t.id === m.gate.id);
    if (g) g.deps = plan.tasks.filter(t => t !== g && !t.milestone && t.bucket === g.bucket && t.end).map(t => t.id);
    ui.view = 'gantt'; ui.crit = true; ui.critTarget = g ? g.id : 'end'; ui.hideDone = true; render(true);
  }, re.source);
  await wait(600);
  const bar = f.locator('#gBodySvg .bar.cp-crit').first();
  if (await bar.count()) { await bar.scrollIntoViewIfNeeded(); const b = await bar.boundingBox(); await page.mouse.move(b.x + Math.min(30, b.width / 2), b.y + b.height / 2); await wait(300); }
  await shot('22-critical');
  await page.mouse.move(5, 5);
  await frame.evaluate(() => { ui.crit = false; ui.critTarget = 'end'; ui.hideDone = false; render(true); });
}
// Baslinje (#5): en påhittad baslinje i minnet (sparas inte) där några aktiviteter låg 1–3 veckor tidigare och en slutade senare,
// så att bilden visar grå staplar, avvikelser och sammanfattningen; tooltip på en försenad aktivitet
async function baselineShot(c, re) {
  const { f, frame, wait, shot, page } = c;
  await frame.evaluate(src => {
    const p = allPlans.find(x => new RegExp(src).test(x.name)); selectPlan(p.id, true);
    const shift = (d, n) => d ? fromDay(toDay(d) - n) : d;
    const tasks = plan.tasks.filter(t => t.end).map((t, i) => {
      const n = t.milestone ? (i % 2 ? 14 : 0) : [0, 7, 21, 0, 14, -7][i % 6];
      return { ...t, start: shift(t.start, n), end: shift(t.end, n) };
    });
    const bl = makeBaseline(tasks, tr('Inför nästa gate'), new Date(Date.now() - 42 * 864e5).toISOString(), 'blShot');
    plan.settings.baselines = [bl]; ui.blSel = { ...(ui.blSel || {}), [plan.id]: bl.id };
    ui.view = 'gantt'; ui.hideDone = true; render(true);
  }, re.source);
  await wait(600);
  const bar = f.locator('#gBodySvg .bar').nth(3);
  if (await bar.count()) { await bar.scrollIntoViewIfNeeded(); const b = await bar.boundingBox(); await page.mouse.move(b.x + Math.min(30, b.width / 2), b.y + b.height / 2); await wait(300); }
  await shot('23-baseline');
  await page.mouse.move(5, 5);
  await frame.evaluate(() => { delete plan.settings.baselines; ui.blSel = {}; ui.hideDone = false; render(true); });
}
// ---------- Påhittade planer (exempel/bas), egna gater G1–G4 ----------
async function plans(c) {
  const { f, frame, wait, shot, closeModal, menu, sv } = c;
  // 1 Kom igång: tomvyn
  await shot('01-start');

  // 2 Gantt-vyn med den neutrala planen; gaterna G1–G4 får namn
  await f.locator('#fileInput').setInputFiles(BAS[0]); await wait(1800);
  await frame.evaluate(sv => {
    ensureGates(plan);
    const names = sv ? { G1: 'Start', G2: 'Plan klar', G3: 'Klart för test', G4: 'Överlämning' } : { G1: 'Start', G2: 'Plan ready', G3: 'Ready for test', G4: 'Handover' };
    for (const g of plan.settings.gates) if (names[g.code]) g.name = names[g.code];
    render();
  }, sv);
  await shot('02-gantt');

  // 3 Panelen för en aktivitet
  await f.locator('.g-row.task', { hasText: 'Ritning reception' }).click(); await wait(400);
  await shot('03-edit');
  await f.locator('#drawer [data-close]').first().click(); await wait(200);

  // 4 Uppdatera från Excel: samma fil med ändrade datum och % klart
  await frame.evaluate(async src => {
    const wb = XLSX.read(await (await fetch(src)).arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets['Project tasks'], rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const h = rows.findIndex(r => r.includes('Name') && r.includes('Finish'));
    const ci = n => rows[h].indexOf(n);
    const bump = (name, days, pct) => { const r = rows.find(x => x[ci('Name')] === name); if (!r) return; r[ci('Finish')] = new Date(+r[ci('Finish')] + days * 864e5); if (pct != null) r[ci('% complete')] = pct; };
    bump('Ritning reception rev A', 14, 0.9); bump('Val av besökssystem', 21, 0.5); bump('Upphandling möbler', 14);
    wb.Sheets['Project tasks'] = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    updateFromFile(new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'Ny besöksreception (fiktiv).xlsx'));
  }, '/exempel/bas/Ny besöksreception (fiktiv).xlsx');
  await f.locator('.modal').waitFor(); await wait(400);
  await shot('04-update');
  await closeModal();

  // 5 Gater och gate-checklista (#75): egna punkter för G2 med bedömningar
  await frame.evaluate(sv => {
    const g2 = planGates(plan).find(g => g.code === 'G2');
    const t = sv
      ? [['Ritning godkänd av fastighetsägaren', 'Underlag'], ['Besökssystem valt och offert mottagen', 'Underlag'], ['Möbler upphandlade', 'Inköp'], ['Budget för genomförande beslutad', 'Ekonomi'], ['Tidplan för ombyggnad klar', 'Plan'], ['Informationsplan till medarbetare', 'Plan'], ['Riskgenomgång gjord', 'Plan']]
      : [['Drawing approved by the property owner', 'Basis'], ['Visitor system chosen and quote received', 'Basis'], ['Furniture procured', 'Purchasing'], ['Budget for execution decided', 'Finance'], ['Schedule for the rebuild ready', 'Plan'], ['Information plan for employees', 'Plan'], ['Risk review done', 'Plan']];
    plan.settings.gateItems = { [g2.id]: t.map(([x, sec], i) => ({ id: 'p' + (i + 1), t: x, sec })) };
    const at = new Date().toISOString();
    plan.settings.gateChecks = { ['g:' + g2.id]: { p1: { s: 0, at }, p2: { s: 50, c: sv ? 'Offert väntas v.' + fmtYYWW(todayDay() + 14).slice(2) : 'Quote expected w.' + fmtYYWW(todayDay() + 14).slice(2), at }, p3: { s: 100, at }, p4: { s: 0, at }, p5: { s: 0, at } } };
    ui.chkCol = g2.id; render();
  }, sv);
  await menu('checklist'); await f.locator('#ckBody').waitFor(); await wait(300);
  await shot('05-checklist');
  await closeModal();

  // 13 Risklista och 14 veckostatus med påhittade, neutrala texter
  await frame.evaluate(() => {
    const w = n => fmtYYWW(todayDay() + n * 7), sv = LANG === 'sv', now = new Date().toISOString();
    const mk = (no, desc, area, p, c, prev, cons, ready, owner, status) => ({ id: 'risk' + no, no, desc, area, p, c, prev, cons, ready, owner, status, taskId: null, createdAt: now, updatedAt: now, closed: false });
    plan.settings.risks = [
      mk(1, sv ? 'Om besökssystemet inte kan kopplas till passersystemet så försenas driftsättningen' : 'If the visitor system cannot connect to the access system then go-live is delayed', 'Technical', 3, 5, sv ? 'Tidig test av integrationen' : 'Early integration test', sv ? 'Manuell besökslista som reserv' : 'Manual visitor list as fallback', w(2), 'Testperson D', 'R'),
      mk(2, sv ? 'Om möblerna levereras sent så kan receptionen inte öppna' : 'If the furniture is delivered late then the reception cannot open', 'Time', 3, 3, sv ? 'Beställ med marginal' : 'Order with margin', sv ? 'Tillfälliga möbler' : 'Temporary furniture', w(5), 'Testperson C', 'Y'),
      mk(3, sv ? 'Om ombyggnaden stör verksamheten så ökar klagomålen' : 'If the rebuild disturbs the business then complaints increase', 'External', 2, 3, sv ? 'Bygg kvällstid' : 'Build in the evenings', '', w(10), 'Testperson E', 'Y'),
      mk(4, sv ? 'Om receptionisterna inte hinner utbildas så blir starten rörig' : 'If the receptionists are not trained in time then the start is messy', 'Resources', 2, 4, sv ? 'Pilotutbildning tidigt' : 'Early pilot training', '', w(12), 'Testperson F', 'G'),
      mk(5, sv ? 'Om kostnaden för entrén ökar så räcker inte budgeten' : 'If the entrance cost increases then the budget is not enough', 'Finances', 2, 4, sv ? 'Fast pris i offerten' : 'Fixed price in the quote', '', w(6), 'Testperson A', 'Y'),
    ];
    const d = (goal, fin, hr, deliv, time, risk, tech, comm, ergo, safety, env) => ({ goal, fin, hr, deliv, time, risk, tech, comm, ergo, safety, env });
    plan.settings.status = [
      { week: w(-2), at: null, dims: d('G', 'G', 'G', 'G', 'G', 'Y', 'G', 'G', 'G', 'G', 'G'), overall: 'G', comment: '', actions: [], money: { request: 2.5, spent: 0.4, forecast: 2.5 } },
      { week: w(-1), at: null, dims: d('G', 'G', 'G', 'Y', 'Y', 'Y', 'G', 'G', 'G', 'G', 'G'), overall: 'Y', comment: '', actions: [], money: { request: 2.5, spent: 0.6, forecast: 2.6 } },
      { week: w(0), at: null, dims: d('G', 'Y', 'G', 'Y', 'Y', 'R', 'Y', 'G', 'G', 'G', null), overall: 'Y', comment: sv ? 'Valet av besökssystem dröjer – offert väntas om två veckor.' : 'The choice of visitor system is late – quote expected in two weeks.',
        actions: [{ text: sv ? 'Påminn leverantören om offerten' : 'Remind the supplier about the quote', state: 'ongoing', owner: 'Testperson D', due: w(1) }, { text: sv ? 'Testa integrationen tidigt' : 'Test the integration early', state: 'planned', owner: 'Testperson D', due: w(4) }],
        money: { request: 2.5, spent: 0.7, forecast: 2.6 } },
    ];
    render();
  });
  await menu('risks'); await f.locator('#rkTable').waitFor(); await wait(300);
  await shot('13-risks');
  await closeModal();
  await f.locator('#kpiStatus').click(); await f.locator('#stDims').waitFor(); await wait(300);
  await shot('14-status');
  await closeModal();
  await frame.evaluate(() => { plan.settings.risks = []; plan.settings.status = []; render(); });

  // 15 Färger, 17 Skapa mall, 18 Versioner
  await newFeatures(c);

  // 6 Ny plan från mall: en egen mall (sparad från planen) under Mina mallar; 16 agila mallar
  await frame.evaluate(async sv => {
    const tpl = planToTemplate(plan, { anchor: 'START', name: sv ? 'Receptionsprojekt (mall)' : 'Reception project (template)', description: sv ? 'Påhittad mall för hjälpbilderna' : 'Fictive template for the help images' });
    await saveTemplateRow(tpl, plan);
  }, sv);
  await menu('tplnew'); await f.locator('#tplSrc').waitFor();
  const own = f.locator('#tplSrc .tpl-own input[name="tplSrc"]').first();
  await own.check(); await wait(400);
  const st = f.locator('[data-gate="START"]');
  if (await st.count()) { await st.fill(await frame.evaluate(() => fmtYYWW(todayDay() + 28))); await st.press('Tab'); }
  await shot('06-template');
  await agile(c);
  await closeModal();

  // 9 Exportera bild
  await f.locator('#exportBtn').click(); await f.locator('.export-img').waitFor(); await wait(600);
  await shot('09-export');
  await closeModal();

  // 11 Roadmap-vyn
  await f.locator('#viewSeg button[data-v="roadmap"]').click(); await wait(600);
  await shot('11-roadmap');
  await f.locator('#viewSeg button[data-v="gantt"]').click(); await wait(300);

  // 8 Programvyn: de tre neutrala planerna med ett beroende mellan projekt
  for (const file of BAS.slice(1)) {
    await f.locator('#fileInput').setInputFiles(file); await wait(1200);
    if (await f.locator('.modal').count()) { await f.locator('.m-foot button').last().click(); await wait(800); }
  }
  await frame.evaluate(async sv => {
    if (!ProgStore) await loadPrograms();
    const pick = re => allPlans.find(x => re.test(x.name));
    const main = pick(/besöksreception/), it = pick(/Delprojekt IT/);
    const p = { name: sv ? 'Besöksprogrammet (test)' : 'Visitor programme (test)', plans: allPlans.filter(x => /besöksreception|Delprojekt (IT|Utbildning)/.test(x.name)).map(x => ({ planId: x.id, addedAt: new Date().toISOString() })),
      dependencies: [], milestones: [], requests: [], settings: {} };
    const np = rowToProgram(await ProgStore.insert(programRow(p)));
    np.settings = p.settings;
    const t = (pl, re) => pl.tasks.find(x => re.test(x.name));
    np.dependencies.push({ id: 'd1', from: taskRef(it, t(it, /Driftsatt besökssystem/)), to: taskRef(main, t(main, /Test av inpassering/)), type: 'FS', lag: 0, note: '' });
    allPrograms.push(np); programs.push(np);
    selectProgram(np.id);
  }, sv);
  await wait(800);
  await shot('08-program');
  await fileModeShot(c);
  await effort(c);
  await gatesShot(c);
  await burndownShot(c);
  await criticalShot(c, /besöksreception/);
  await baselineShot(c, /besöksreception/);
}

try {
  for (const lang of ['sv', 'en']) {
    const c = await open(lang);
    await plans(c);
    if (c.errors.length) console.warn(lang, 'sidfel:', c.errors);
    await c.page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(sizes.join('\n'));
