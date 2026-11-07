'use strict';

/* =========================================================
   NexusOrdo – Gantt & roadmap from Microsoft Planner exports
   ========================================================= */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => 'l_' + Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Layout constants ---------- */
const ROW = 34, BAR = 18, HEAD = 52;
const COLS = 'minmax(0,1fr) 112px 58px 58px 42px';
const LEFT_W = 560;
// Kolumnen Timmar (#94) visas när ui.showHours är på
const COLS_H = COLS + ' 56px', leftW = () => LEFT_W + (ui.showHours ? 56 : 0);
const ZOOM_PPD = { week: 30, month: 6, quarter: 2.2 };
const FONT = 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

/* ---------- Dates (whole days, UTC based to avoid DST issues) ---------- */
const DAY = 864e5;
const MONTHS_SV = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG_SV = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
let MONTHS = MONTHS_SV, MONTHS_LONG = MONTHS_LONG_SV;
const utcDay = (y, m, d) => Math.round(Date.UTC(y, m, d) / DAY);
const toDay = iso => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); return utcDay(y, m - 1, d); };
const fromDay = n => new Date(n * DAY).toISOString().slice(0, 10);
const dObj = n => new Date(n * DAY);
const todayDay = () => { const d = new Date(); return utcDay(d.getFullYear(), d.getMonth(), d.getDate()); };
const weekday = n => (dObj(n).getUTCDay() + 6) % 7; // 0 = måndag
const monthStart = n => { const d = dObj(n); return utcDay(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const quarterStart = n => { const d = dObj(n); return utcDay(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1); };
const yearStart = n => utcDay(dObj(n).getUTCFullYear(), 0, 1);
const addMonths = (n, k) => { const d = dObj(n); return utcDay(d.getUTCFullYear(), d.getUTCMonth() + k, d.getUTCDate()); };
const isoWeek = n => { const th = n - weekday(n) + 3; return Math.floor((th - yearStart(th)) / 7) + 1; };
// Vecka som ÅÅVV (#39) – gater, risker och rapportveckor anges så, t.ex. 2645 = vecka 45 2026
const isoWeekYear = n => dObj(n - weekday(n) + 3).getUTCFullYear();
const fmtYYWW = n => n == null ? '' : String(isoWeekYear(n)).slice(2) + String(isoWeek(n)).padStart(2, '0');
// "2645", "26-45", "v45", "v45 2026", "W45-26" → måndag i veckan (fredag för slutdatum); null om det inte är en vecka
function parseWeek(str, end = false) {
  const s = String(str || '').trim().toUpperCase();
  let m = s.match(/^(\d{2})\s*[-/]?\s*(\d{2})$/), y, w;
  if (m) { y = 2000 + +m[1]; w = +m[2]; }
  else if ((m = s.match(/^[VW]\.?\s*(\d{1,2})(?:\s*[-,/ ]\s*(\d{2}|\d{4}))?$/))) {
    w = +m[1]; y = m[2] ? (m[2].length === 2 ? 2000 + +m[2] : +m[2]) : new Date().getFullYear();
  } else return null;
  if (w < 1 || w > 53) return null;
  const jan4 = utcDay(y, 0, 4), mon = jan4 - weekday(jan4) + (w - 1) * 7;
  if (isoWeek(mon) !== w || isoWeekYear(mon) !== y) return null;
  return mon + (end ? 4 : 0);
}
const fmtDay = n => n == null ? '–' : `${dObj(n).getUTCDate()} ${MONTHS[dObj(n).getUTCMonth()]}`;
const fmtDayY = n => n == null ? '–' : `${fmtDay(n)} ${dObj(n).getUTCFullYear()}`;
const fmtShort = n => { if (n == null) return '–'; const d = dObj(n); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

/* ---------- Safe browser storage ----------
   localStorage kan vara blockerat (t.ex. i en låst ram eller med strikta inställningar).
   Då används minnet i stället, så att appen ändå fungerar. */
// Lokal version (#70): bygget (scripts/build-lokal.mjs) sätter window.TP_LOCAL. Planerna sparas som filer; webbläsaren har bara en arbetskopia.
const FILE_MODE = !!window.TP_LOCAL;
const LS = (() => {
  const mem = {};
  // file:// delar localStorage mellan alla lokala filer – egen nyckel per fil
  const pre = FILE_MODE ? `tpl:${location.pathname}:` : '';
  let ok = false;
  try { localStorage.setItem('__tp', '1'); localStorage.removeItem('__tp'); ok = true; } catch { /* blockerat */ }
  return {
    ok,
    get: k => { if (ok) try { return localStorage.getItem(pre + k); } catch { /* blockerat */ } return mem[k] ?? null; },
    set: (k, v) => { mem[k] = v; if (ok) try { localStorage.setItem(pre + k, v); } catch { /* blockerat */ } },
  };
})();
const parseJSON = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };

/* ---------- Språk (#46): svenska är grundspråket, engelska via ordlistan ----------
   Nyckeln är den svenska texten; {n} i texten fylls i från andra argumentet. Saknas en översättning visas svenskan. */
let LANG = LS.get('timeplan.lang') === 'en' ? 'en' : 'sv';
const I18N_EN = {
  "Sök efter uppdateringar": "Check for updates",
  "En ny version finns: {v}": "A new version is available: {v}",
  "Hämta senaste versionen": "Download the latest version",
  "Du har den senaste versionen ({v}).": "You have the latest version ({v}).",
  "Det här bygget är nyare än senaste releasen ({v}).": "This build is newer than the latest release ({v}).",
  "Utvecklingsversion – senaste release är {v}.": "Development build – the latest release is {v}.",
  "Kunde inte kontrollera versionen. Kontrollera internetanslutningen eller öppna releaserna på GitHub.": "Could not check for updates. Check your internet connection or open the releases on GitHub.",
  "Spara dina planer till Excel innan du byter HTML-fil.": "Save your plans to Excel before replacing the HTML file.",
  // PMI-projektmallen
  'PMI: faser som känns igen får PMI-färgerna, övriga får Standard.': 'PMI: recognised phases get the PMI colours, the others get Standard.',
  'Huvudplanen har inga gater med datum ännu.': 'The main plan has no dated gates yet.',
  'PMI-gater + sprintar': 'PMI gates + sprints',
  'Lämna tomt för gater som inte gäller, t.ex. om projektet startar vid G2.': 'Leave gates that do not apply empty, e.g. if the project starts at G2.',
  'Sprintarna läggs mellan G2 och G3 (Executing).': 'The sprints are placed between G2 and G3 (Executing).',
  'Ta med aktiviteterna i PMI-projektmallen': 'Include the activities of the PMI project template',
  'PMI-projektmall': 'PMI project template',
  'Hybrid PMI + sprintar': 'Hybrid PMI + sprints',
  'PMI-faser och gater med N sprintar i Executing. Sprintarna börjar måndagen efter G2 och slutar före G3 – de som inte får plats hoppas över.': 'PMI phases and gates with N sprints in Executing. The sprints start the Monday after G2 and end before G3 – the ones that do not fit are skipped.',
  'Gater': 'Gates',
  'Gater i programmet': 'Gates in the programme',
  '<b>? → 📖 Hjälpcenter</b> öppnar hjälpcentret och <b>📖 Hjälp för den här sidan</b> artikeln om sidan du står på. Tillbaka till planen kommer du med flikarna Gantt, Roadmap eller Belastning.': '<b>? → 📖 Help centre</b> opens the help centre and <b>📖 Help for this page</b> the article about the page you are on. You get back to the plan with the Gantt, Roadmap or Workload tabs.',
  '<b>Markera gate passerad…</b> sparar veckan då gaten passerades (utfall). Utfallet kan också skrivas i panelen under <b>Utfall (vecka)</b>.': '<b>Mark gate passed…</b> saves the week the gate was passed (actual). The actual can also be entered in the panel under <b>Actual (week)</b>.',
  'Utfallet visas som fylld romb i Gantt.': 'The actual is shown as a filled diamond in the Gantt.',
  '<b>Huvudplan</b> – projektets plan som är källan för gater och status. Programmet läser den.': '<b>Main plan</b> – the project’s plan that is the source for gates and status. The programme reads it.',
  'I gate-checklistan: Markera gate passerad… sparar veckan. Utfallet visas som fylld romb i Gantt.': 'In the gate checklist: Mark gate passed… saves the week. The actual is shown as a filled diamond in the Gantt.',
  "Fyll i Nivå 1 (huvudprojekt) i Projektuppgifter först – huvudprojektet känns igen på den": "Fill in Level 1 (main project) in Project details first – the main project is recognised by it",
  "Värde = sannolikhet × konsekvens (1–25). Färgerna på värdet är NexusOrdos egna; status sätts av dig.": "Value = probability × consequence (1–25). The colours of the value are NexusOrdo’s own; you set the status.",
  "Nivå 1 (huvudprojekt)": "Level 1 (main project)",
  "Nivå 2 (delprojekt)": "Level 2 (subproject)",
  "Huvudplan – planen äger huvudprojektets gemensamma gater": "Main plan – the plan owns the main project’s common gates",
  "{name} är redan huvudplan för samma huvudprojekt.": "{name} is already the main plan for the same main project.",
  "Egna om planen har gater med datum, annars huvudplanens": "Own if the plan has dated gates, otherwise the main plan’s",
  // NexusOrdo bas (#75): hjälpcenter och rundturer
  "Faser, gater och milstolpar känns igen automatiskt. Färgerna väljer du med <b>⋯ → 🎨 Färger…</b>": "Phases, gates and milestones are recognised automatically. You choose the colours with <b>⋯ → 🎨 Colours…</b>",
  "En plan från NexusOrdo (<b>⬇ Exportera plan (Excel)</b>) öppnas på samma sätt.": "A plan from NexusOrdo (<b>⬇ Export plan (Excel)</b>) is opened the same way.",
  "<b>⋯ → Ny plan från mall</b> skapar en plan från en agil mall eller en egen mall.": "<b>⋯ → New plan from template</b> creates a plan from an agile template or your own template.",
  "Under <b>Agilt</b> finns Scrum och PI-planering (SAFe-inspirerad) – se <b>Agila mallar</b>.": "Under <b>Agile</b> you find Scrum and PI Planning (SAFe-inspired) – see <b>Agile templates</b>.",
  "Under <b>Mina mallar</b> finns mallar du sparat själv med <b>📐 Spara som mall…</b> eller importerat från fil.": "Under <b>My templates</b> you find templates you saved yourself with <b>📐 Save as template…</b> or imported from file.",
  "Skriv start- eller ankarveckan som ÅÅVV. Förhandsvisningen visar antal per fas. Aktiviteter som redan finns läggs inte till igen.": "Write the start or anchor week as YYWW. The preview shows the number per phase. Activities that already exist are not added again.",
  "Planfilen fungerar i alla versioner av NexusOrdo: dina gater, punkter och svar följer med.": "The plan file works in all versions of NexusOrdo: your gates, items and answers come along.",
  "Välj ankare: planens start eller en gate. Datumen sparas som veckor före eller efter ankaret.": "Choose the anchor: the plan’s start or a gate. The dates are saved as weeks before or after the anchor.",
  "<b>⋯ → Ny plan från mall…</b> visar mallen under <b>Mina mallar</b>. Välj den och skriv ankarets vecka (ÅÅVV).": "<b>⋯ → New plan from template…</b> shows the template under <b>My templates</b>. Choose it and write the anchor week (YYWW).",
  "<b>⇪ Importera mall från fil…</b> läser en mallfil (Excel) – så delar du mallar med kollegor.": "<b>⇪ Import template from file…</b> reads a template file (Excel) – that is how you share templates with colleagues.",
  "Mallen sparas också som en fil när du skapar den.": "The template is also saved as a file when you create it.",
  "<b>⋯ → Ny plan från mall…</b> → <b>Agilt</b>: Scrum och PI-planering (SAFe-inspirerad). Antal och längd väljer du när planen skapas.": "<b>⋯ → New plan from template…</b> → <b>Agile</b>: Scrum and PI Planning (SAFe-inspired). You choose the number and length when the plan is created.",
  "<b>Scrum:</b> Sprint 0 (uppstart) och N sprintar à 1–4 veckor (1–26 sprintar, förvalt 6 × 2 veckor). Varje sprint är en egen fas med <b>Sprint Planning</b>, <b>Sprint Backlog</b>, <b>Sprint Review</b> och <b>Sprint Retrospective</b>.": "<b>Scrum:</b> Sprint 0 (set-up) and N sprints of 1–4 weeks (1–26 sprints, default 6 × 2 weeks). Each sprint is its own phase with <b>Sprint Planning</b>, <b>Sprint Backlog</b>, <b>Sprint Review</b> and <b>Sprint Retrospective</b>.",
  "<b>Release var X:e sprint</b> (0 = ingen) och alltid efter sista sprinten, i fasen <b>Releases</b> tillsammans med <b>Product Goal</b> som gate.": "<b>Release every X sprints</b> (0 = none) and always after the last sprint, in the phase <b>Releases</b> together with the <b>Product Goal</b> as a gate.",
  "<b>PI-planering (SAFe-inspirerad):</b> 1–8 PI à 8–12 veckor med <b>PI Planning</b>, <b>Iteration 1–4</b>, <b>IP Iteration</b>, <b>System Demo</b> och <b>Inspect & Adapt</b>.": "<b>PI Planning (SAFe-inspired):</b> 1–8 PIs of 8–12 weeks with <b>PI Planning</b>, <b>Iteration 1–4</b>, <b>IP Iteration</b>, <b>System Demo</b> and <b>Inspect & Adapt</b>.",
  "Skriv startveckan (ÅÅVV). Förhandsvisningen visar antal per fas.": "Write the start week (YYWW). The preview shows the number per phase.",
  "Sprintarna hänger ihop med beroenden. Datum sätts en gång – ingen automatisk schemaläggning efteråt.": "The sprints are linked by dependencies. Dates are set once – no automatic scheduling afterwards.",
  "Paletter: <b>Standard</b> (förvald), <b>Mjuk</b> och <b>Hög kontrast</b>.": "Palettes: <b>Standard</b> (default), <b>Soft</b> and <b>High contrast</b>.",
  "Klicka på en förvald färg eller välj <b>Egen…</b> för en valfri färg. Den gäller före paletten. <b>Återställ</b> går tillbaka till palettens färg.": "Click a preset colour or choose <b>Custom…</b> for any colour. It applies before the palette. <b>Reset</b> goes back to the palette’s colour.",
  "Färgerna gäller i Gantt, Roadmap och den exporterade bilden, och följer med i export, versioner och mallar.": "The colours apply in Gantt, Roadmap and the exported image, and come along in export, versions and templates.",
  "Gater och gate-checklista": "Gates and gate checklist",
  "Egna gater med en egen checklista per gate: Klart, Påverkar eller Kritiskt.": "Your own gates with your own checklist per gate: Done, Affects or Critical.",
  "<b>⋯ → 🚩 Gater…</b>: lägg till gater med kod och namn (t.ex. <b>G1</b> Start), ordna dem och koppla varje gate till en milstolpe. I panelen kan en milstolpe också markeras som gate.": "<b>⋯ → 🚩 Gates…</b>: add gates with code and name (e.g. <b>G1</b> Start), order them and link each gate to a milestone. In the panel a milestone can also be marked as a gate.",
  "<b>📊 Uppföljning → ☑ Gate-checklista…</b>: skriv egna punkter per gate, gärna i avsnitt. Klicka på texten för att ändra, ↑↓ flyttar och 🗑 tar bort.": "<b>📊 Follow-up → ☑ Gate checklist…</b>: write your own items per gate, preferably in sections. Click the text to edit, ↑↓ moves and 🗑 deletes.",
  "<b>⇪ Importera punkter (Excel)…</b> läser en fil med kolumnerna <b>Gate</b>, <b>Punkt</b> och <b>Avsnitt</b>. Gater som saknas skapas.": "<b>⇪ Import items (Excel)…</b> reads a file with the columns <b>Gate</b>, <b>Item</b> and <b>Section</b>. Missing gates are created.",
  "Bedöm varje punkt: <b>Klart</b>, <b>Påverkar</b> (tid, pengar eller resurser) eller <b>Kritiskt</b>. ＋ ger en kommentar, ⊘ betyder att punkten inte gäller.": "Assess each item: <b>Done</b>, <b>Affects</b> (time, money or resources) or <b>Critical</b>. ＋ adds a comment, ⊘ means the item does not apply.",
  "Fyll i de fem gate-kriterierna och <b>Markera gate passerad…</b>. Gaten i Gantt-vyn visar beredskapen, t.ex. <b>☑ 42 % · 2 röda</b>.": "Fill in the five gate criteria and <b>Mark gate passed…</b>. The gate in the Gantt view shows the readiness, e.g. <b>☑ 42 % · 2 red</b>.",
  "Gaterna och punkterna följer med när planen sparas som mall och i <b>⬇ Exportera plan (Excel)</b>.": "The gates and items come along when the plan is saved as a template and in <b>⬇ Export plan (Excel)</b>.",
  "Risker med sannolikhet × konsekvens, åtgärder och topp 5.": "Risks with probability × consequence, actions and top 5.",
  "Matrisen och <b>Topp 5</b> visar de största riskerna. <b>Exportera Excel</b> ger listan som fil.": "The matrix and <b>Top 5</b> show the biggest risks. <b>Export Excel</b> gives the list as a file.",
  "Veckans status i elva dimensioner, med förslag från trend, risker och checklista.": "The week’s status in eleven dimensions, with suggestions from trend, risks and checklist.",
  "Sätt grön, gul eller röd för de elva dimensionerna. <b>Förslag</b> från milstolpetrenden, risklistan och gate-checklistan sätts med <b>Använd</b> – aldrig automatiskt.": "Set green, yellow or red for the eleven dimensions. <b>Suggestions</b> from the milestone trend, the risk list and the gate checklist are set with <b>Use</b> – never automatically.",
  "Ett program samlar flera projekts planer och visar fas, andel klart, försenade och nästa gate per projekt.": "A programme gathers several projects’ plans and shows phase, share complete, late and next gate per project.",
  "Hierarkin kommer från <b>🏷 Projektuppgifter</b>: program → nivå 1 (huvudprojekt) → nivå 2 (delprojekt).": "The hierarchy comes from <b>🏷 Project details</b>: programme → level 1 (main project) → level 2 (subproject).",
  "<b>Huvudplan</b>: kryssa i <i>Huvudplan</i> i Projektuppgifter. Huvudplanens gater är huvudprojektets gater; delprojekt utan egna gater visar dem som <b>ärvda</b>.": "<b>Main plan</b>: tick <i>Main plan</i> in Project details. The main plan’s gates are the main project’s gates; subprojects without their own gates show them as <b>inherited</b>.",
  "<b>Planner</b> är källan för planer som importerats från Planner. De hålls aktuella med <b>⟳ Uppdatera → Uppdatera från Excel</b>.": "<b>Planner</b> is the source for plans imported from Planner. They are kept up to date with <b>⟳ Update → Update from Excel</b>.",
  "<b>Var sparas mina planer?</b> I filerna du sparar med 💾. Webbläsaren har bara en arbetskopia.": "<b>Where are my plans saved?</b> In the files you save with 💾. The browser only has a working copy.",
  "<b>Kan jag ha samma gate-checklista i flera planer?</b> Ja – spara planen som mall eller läs in samma Excel-fil i varje plan.": "<b>Can I have the same gate checklist in several plans?</b> Yes – save the plan as a template or read the same Excel file into each plan.",
  "<b>Gate</b> – beslutspunkt i planen med egen kod och eget namn (<b>⋯ → 🚩 Gater…</b>). Visas som romb.": "<b>Gate</b> – decision point in the plan with your own code and name (<b>⋯ → 🚩 Gates…</b>). Shown as a diamond.",
  "<b>Gate-checklista</b> – dina punkter inför en gate, bedömda som Klart, Påverkar eller Kritiskt. <b>Beredskap</b> = andel klara.": "<b>Gate checklist</b> – your items before a gate, assessed as Done, Affects or Critical. <b>Readiness</b> = share done.",
  "Inbyggda agila mallar eller Mina mallar – dina egna. Här importerar du också en mall från fil.": "Built-in agile templates or My templates – your own. Here you can also import a template from file.",
  "Gantt visar alla projekt med sina faser.": "Gantt shows all projects with their phases.",
  "Skriv en punkt och ett avsnitt, eller läs in punkter från Excel (Gate, Punkt, Avsnitt).": "Write an item and a section, or read items from Excel (Gate, Item, Section).",
  "Under Agilt finns Scrum och PI-planering (SAFe-inspirerad).": "Under Agile you find Scrum and PI Planning (SAFe-inspired).",
  "Välj en agil mall: fälten för antal sprintar eller PI, veckor och release var X:e visas till höger. Skriv startveckan.": "Choose an agile template: the fields for number of sprints or PIs, weeks and release every X are shown on the right. Write the start week.",
  "Sprintar och PI blir egna faser med sina händelser.": "Sprints and PIs become their own phases with their events.",
  "⋯ → 🎨 Färger… väljer palett för hela planen (Standard, Mjuk, Hög kontrast) och färg för alla faser.": "⋯ → 🎨 Colours… chooses the palette for the whole plan (Standard, Soft, High contrast) and the colour of all phases.",
  "Klicka på 🚦 eller välj 📊 Uppföljning → 🚦 Veckostatus… för veckans status.": "Click 🚦 or choose 📊 Follow-up → 🚦 Weekly status… for the week’s status.",
  "📊 Uppföljning → ⚠ Risklista…: sannolikhet × konsekvens, åtgärder och ansvarig.": "📊 Follow-up → ⚠ Risk list…: probability × consequence, actions and owner.",
  "Nytt: egna gater": "New: your own gates",
  "Öppna en plan för att lägga till gater.": "Open a plan to add gates.",
  "⋯ → 🚩 Gater… lägger till gater med egen kod och eget namn och kopplar dem till milstolpar. En milstolpe kan också bli gate i panelen.": "⋯ → 🚩 Gates… adds gates with your own code and name and links them to milestones. A milestone can also become a gate in the panel.",
  "Egen gate-checklista": "Own gate checklist",
  "📊 Uppföljning → ☑ Gate-checklista… har dina punkter per gate: lägg till, ändra, flytta, ta bort eller läs in från Excel (Gate, Punkt, Avsnitt).": "📊 Follow-up → ☑ Gate checklist… has your items per gate: add, edit, move, delete or read from Excel (Gate, Item, Section).",
  "Bedöm punkterna som Klart, Påverkar eller Kritiskt. Beredskapen visas vid gaten i Gantt och i nyckeltalen.": "Assess the items as Done, Affects or Critical. The readiness is shown at the gate in Gantt and in the key figures.",
  "Med i mallen": "Included in the template",
  "📐 Spara som mall… tar med gaterna och punkterna, så att nästa projekt börjar med samma checklista.": "📐 Save as template… includes the gates and items, so the next project starts with the same checklist.",
  // NexusOrdo bas (#75): egna gater och generisk gate-checklista
  "Punkt": "Item",
  "Avsnitt": "Section",
  "Gater är beslutspunkter i planen. Namn och kod väljer du själv, t.ex. G1 Start eller Beslut 2. Koppla varje gate till en milstolpe – den visas som romb med beredskap från gate-checklistan.": "Gates are decision points in the plan. You choose the name and code yourself, e.g. G1 Start or Decision 2. Link each gate to a milestone – it is shown as a diamond with readiness from the gate checklist.",
  "Kod": "Code",
  "– ingen milstolpe –": "– no milestone –",
  "{n} punkter": "{n} items",
  "Flytta ned": "Move down",
  "Ta bort gate": "Delete gate",
  "Planen har inga gater ännu.": "The plan has no gates yet.",
  "+ Ny gate": "+ New gate",
  "Gater – {name}": "Gates – {name}",
  "Varje gate behöver en kod eller ett namn": "Each gate needs a code or a name",
  "Två gater har samma kod": "Two gates have the same code",
  "Ta bort gater?": "Delete gates?",
  "Gate-checklistan för {names} tas bort med sina punkter och svar. Ångra fungerar.": "The gate checklist for {names} is deleted with its items and answers. Undo works.",
  "Gaterna är sparade": "The gates are saved",
  "Hittar inte kolumnerna Gate och Punkt.": "Cannot find the columns Gate and Item.",
  "Filen har inga punkter.": "The file has no items.",
  "{n} punkter inlästa": "{n} items read",
  "nya gater: {g}": "new gates: {g}",
  "{n} fanns redan": "{n} already existed",
  "Ingen milstolpe är kopplad till gaten – koppla en i 🚩 Gater… eller i panelen.": "No milestone is linked to the gate – link one in 🚩 Gates… or in the panel.",
  "🚩 Gater…": "🚩 Gates…",
  "⇪ Importera punkter (Excel)…": "⇪ Import items (Excel)…",
  "Planen har inga gater ännu. Lägg till gater med <b>🚩 Gater…</b> eller markera en milstolpe som gate i panelen. Du kan också läsa in punkter från Excel med kolumnerna <b>Gate</b>, <b>Punkt</b> och <b>Avsnitt</b> – gaterna skapas då.": "The plan has no gates yet. Add gates with <b>🚩 Gates…</b> or mark a milestone as a gate in the panel. You can also read items from Excel with the columns <b>Gate</b>, <b>Item</b> and <b>Section</b> – the gates are then created.",
  "Klicka för att ändra": "Click to edit",
  "Ta bort punkten": "Delete the item",
  "Övriga punkter": "Other items",
  "<b>{ok} av {total}</b> klara · {warn} påverkar · {crit} kritiska · {open} ej bedömda": "<b>{ok} of {total}</b> done · {warn} affect · {crit} critical · {open} not assessed",
  "Inga punkter för {gate} ännu. Skriv en punkt nedan eller läs in från Excel.": "No items for {gate} yet. Write an item below or read from Excel.",
  "Avsnitt (valfritt)": "Section (optional)",
  "Egen checklista för planen. Skala: Klart, Påverkar tid, pengar eller resurser, Kritiskt. Följer med i exporten och när planen sparas som mall (📐 Spara som mall…). Excel för inläsning: kolumnerna Gate, Punkt och Avsnitt.": "The plan’s own checklist. Scale: Done, Affects time, money or resources, Critical. Included in the export and when the plan is saved as a template (📐 Save as template…). Excel for import: the columns Gate, Item and Section.",
  "– ingen gate –": "– no gate –",
  "＋ Ny gate med milstolpens namn": "＋ New gate with the milestone’s name",
  // Lokal version (#70)
  "📂 Öppna plan…": "📂 Open plan…",
  "💾 Spara": "💾 Save",
  "Spara som…": "Save as…",
  "● Ej sparad till fil": "● Not saved to file",
  "Sparad till fil ✓": "Saved to file ✓",
  "Öppna en plan först.": "Open a plan first.",
  "Sparad till {file}": "Saved to {file}",
  "Planen laddades ner som {file}": "The plan was downloaded as {file}",
  "Öppna ”{name}”": "Open “{name}”",
  "Det finns redan en arbetskopia av <b>{name}</b> i webbläsaren. Ersätt den med filens version, eller öppna filen som en kopia?": "There is already a working copy of <b>{name}</b> in the browser. Replace it with the file’s version, or open the file as a copy?",
  "Arbetskopian har ändringar som inte sparats till fil – de försvinner om du ersätter den.": "The working copy has changes that have not been saved to file – they are lost if you replace it.",
  "Öppna som kopia": "Open as copy",
  "Ersätt arbetskopian": "Replace working copy",
  "Öppnade ”{name}”": "Opened “{name}”",
  "Arbetskopian har ändringar som inte sparats till fil: {names}. Spara med ⋯ → 💾 Spara.": "The working copy has changes not saved to file: {names}. Save with ⋯ → 💾 Save.",
  "Lokal version": "Local version",
  "Spara <b>{file}</b> på din dator och öppna den därifrån, i Edge eller Chrome. Öppna alltid samma fil på samma plats – då har du samma arbetskopia varje gång.": "Save <b>{file}</b> on your computer and open it from there, in Edge or Chrome. Always open the same file in the same place – then you have the same working copy every time.",
  "Ingen installation behövs, och ingen nätverksanslutning när filen väl finns på datorn.": "No installation is needed, and no network connection once the file is on your computer.",
  "Spara dina planer i en egen mapp, skild från programfilen.": "Save your plans in a folder of their own, separate from the program file.",
  "<b>⋯ → 📂 Öppna plan…</b> öppnar en plan från disk. <b>💾 Spara</b> (Ctrl+S) skriver tillbaka till samma fil, <b>Spara som…</b> till en ny.": "<b>⋯ → 📂 Open plan…</b> opens a plan from disk. <b>💾 Save</b> (Ctrl+S) writes back to the same file, <b>Save as…</b> to a new one.",
  "Version {v} ({d}).": "Version {v} ({d}).",
  "Nytt: lokal version": "New: local version",
  "NexusOrdo finns som en fil för din egen dator. Planer flyttas mellan datorer med ⬇ Exportera plan (Excel) och + Ny plan / Importera… i planväljaren. Läs mer i hjälpcentret: Lokal version.": "NexusOrdo is available as a file for your own computer. Plans move between computers with ⬇ Export plan (Excel) and + New plan / Import… in the plan picker. Read more in the help centre: Local version.",
  "Öppna och spara": "Open and save",
  "I den lokala versionen finns 📂 Öppna plan…, 💾 Spara och Spara som… här i menyn ⋯.": "In the local version, 📂 Open plan…, 💾 Save and Save as… are here in the ⋯ menu.",
  // Export och import av planer (#69)
  "⬇ Exportera plan (Excel)…": "⬇ Export plan (Excel)…",
  "Det här är en NexusOrdo-export": "This is a NexusOrdo export",
  "Filen innehåller hela planer från NexusOrdo. Använd <b>+ Ny plan / Importera…</b> i planväljaren för att skapa dem – Uppdatera jämför bara med exporter från Planner.": "The file contains complete plans from NexusOrdo. Use <b>+ New plan / Import…</b> in the plan picker to create them – Update only compares with exports from Planner.",
  "Startvecka": "Start week",
  "Slutvecka": "End week",
  "% klart": "% complete",
  "Exporterad": "Exported",
  "Stängd": "Closed",
  "Risker": "Risks",
  "Åtgärder": "Actions",
  "TimePlan-data – ändra inte. Används när filen importeras i NexusOrdo.": "NexusOrdo data – do not edit. Used when the file is imported into NexusOrdo.",
  "Fliken TimePlan-data är skadad eller har ändrats. Exportera planen igen från NexusOrdo.": "The TimePlan-data sheet is damaged or has been changed. Export the plan again from NexusOrdo.",
  "Filen kommer från en nyare version av NexusOrdo och kan inte läsas här.": "The file comes from a newer version of NexusOrdo and cannot be read here.",
  "Filen innehåller inga planer.": "The file contains no plans.",
  "Filen innehåller för många planer.": "The file contains too many plans.",
  "Den öppna planen ”{name}”": "The open plan “{name}”",
  "Alla planer ({n})": "All plans ({n})",
  "Mina planer": "My plans",
  "Programmet ”{name}” med {n} planer": "The programme “{name}” with {n} plans",
  "Allt: {p} planer och {g} program (säkerhetskopia)": "Everything: {p} plans and {g} programmes (backup)",
  "NexusOrdo säkerhetskopia": "NexusOrdo backup",
  "Det finns inget du kan exportera.": "There is nothing you can export.",
  "Exportera plan (Excel)": "Export plan (Excel)",
  "Filen går att läsa i Excel och kan importeras i NexusOrdo med <b>+ Ny plan / Importera…</b> i planväljaren, t.ex. i en annan miljö.": "The file can be read in Excel and imported into NexusOrdo with <b>+ New plan / Import…</b> in the plan picker, e.g. in another environment.",
  "Exporterat: {n} planer": "Exported: {n} plans",
  " (importerad {d})": " (imported {d})",
  "– finns redan, skapas som ”{name}”": "– already exists, created as “{name}”",
  "{n} aktiviteter, {r} risker, {s} veckor med status": "{n} activities, {r} risks, {s} weeks with status",
  "Importera från NexusOrdo-export": "Import from NexusOrdo export",
  "Filen är en NexusOrdo-export från {d}. Följande skapas som nya planer – inget befintligt ändras.": "The file is a NexusOrdo export from {d}. The following are created as new plans – nothing existing is changed.",
  "{n} planer": "{n} plans",
  "Importera": "Import",
  "Kunde inte importera: ": "Could not import: ",
  " ({n} skapade)": " ({n} created)",
  "Importerat: {p} planer, {g} program": "Imported: {p} plans, {g} programmes",
  "Exportera och importera planer": "Export and import plans",
  "<b>⋯ → ⬇ Exportera plan (Excel)…</b> sparar planer i en Excel-fil som kan importeras i en annan miljö.": "<b>⋯ → ⬇ Export plan (Excel)…</b> saves plans in an Excel file that can be imported in another environment.",
  "Filen har läsbara flikar (aktiviteter med veckor, risker, veckostatus, projektuppgifter) och en dold flik <b>TimePlan-data</b> med hela planen.": "The file has readable sheets (activities with weeks, risks, weekly status, project details) and a hidden sheet <b>TimePlan-data</b> with the complete plan.",
  "Importera med <b>+ Ny plan / Importera…</b> i planväljaren. Du ser vad som skapas innan något sparas, och importen skapar alltid nya planer.": "Import with <b>+ New plan / Import…</b> in the plan picker. You see what will be created before anything is saved, and the import always creates new plans.",
  "Finns redan en plan med samma namn får den nya tillägget ”(importerad datum)”.": "If a plan with the same name already exists, the new one gets the suffix “(imported date)”.",
  "Export och import av planer": "Export and import of plans",
  "Nytt: exportera plan (Excel)": "New: export plan (Excel)",
  "⋯ → ⬇ Exportera plan (Excel)… sparar den öppna planen, dina planer eller programmet i en Excel-fil – läsbar i Excel och en egen säkerhetskopia.": "⋯ → ⬇ Export plan (Excel)… saves the open plan, your plans or the programme in an Excel file – readable in Excel and your own backup.",
  "Importera i en annan miljö": "Import in another environment",
  // Planer från en lista (#105)
  "Sök plan…": "Search plan…",
  "<b>2. Lägg huvudplanen i ett program.</b> Finns inget program: <b>⋯ → Nytt program…</b>. Välj programmet (▣) i planväljaren, klicka <b>＋ Lägg till plan</b> och kryssa i huvudplanen i listan.": "<b>2. Add the main plan to a programme.</b> If there is no programme: <b>⋯ → New programme…</b>. Choose the programme (▣) in the plan picker, click <b>＋ Add plan</b> and tick the main plan in the list.",
  "Lägg till planer från en lista": "Add plans from a list",
  "Nytt: planer från en lista": "New: plans from a list",
  "＋ Lägg till plan visar planerna du har tillgång till. Kryssa i en eller flera. En plan som någon annan delat lägger du till med länken eller koden under listan.": "＋ Add plan shows the plans you have access to. Tick one or more. A plan someone else has shared is added with the link or code below the list.",
  // Gate som glider förbi programgaten (#99)
  "Glider förbi programgaten": "Slips past the programme gate",
  "gater som hamnar minst en vecka efter programgaten med samma kod. Uppdateringen stoppas inte; programmet visar en varning tills den markeras som sedd.": "gates that end up at least one week after the programme gate with the same code. The update is not stopped; the programme shows a warning until it is marked as seen.",
  "ärver huvudplanens gater": "inherits the main plan's gates",
  "Före": "Before",
  "{n} gate har glidit förbi programgaten": "{n} gate has slipped past the programme gate",
  "{n} gater har glidit förbi programgaten": "{n} gates have slipped past the programme gate",
  "Visa i Gater": "Show in Gates",
  "glidit förbi programgaten vid uppdateringen": "slipped past the programme gate in the update",
  "Glidit förbi programgaten": "Slipped past the programme gate",
  "<b>Varning när en gate glider förbi:</b> när ett projekt uppdateras från Planner och en gate hamnar minst en vecka efter programgaten (eller ännu längre efter än förut) visar förhandsvisningen det, och programmet får en banner tills någon klickar <b>Markera som sett</b>. Rutan i Gater får ⚠ med veckan före och efter.": "<b>Warning when a gate slips past:</b> when a project is updated from Planner and a gate ends up at least one week after the programme gate (or even later than before), the preview shows it and the programme gets a banner until someone clicks <b>Mark as seen</b>. The cell in Gates gets ⚠ with the week before and after.",
  "Varning när en gate glider förbi": "Warning when a gate slips past",
  "Nytt: gate som glider förbi": "New: gate slipping past",
  "När ett projekt uppdateras och en gate hamnar minst en vecka efter programgaten visar programmet en varning här. Markera som sett tar bort den.": "When a project is updated and a gate ends up at least one week after the programme gate, the programme shows a warning here. Mark as seen removes it.",
  "I Gater får rutan ⚠ och detaljen visar veckan före och efter uppdateringen.": "In Gates the cell gets ⚠ and the detail shows the week before and after the update.",
  // Baslinjer (#5)
  "Baslinje {name}": "Baseline {name}",
  "Baslinje": "Baseline",
  "ny sedan baslinjen": "new since the baseline",
  "slut {d}": "finish {d}",
  "oförändrad": "unchanged",
  "Aktiviteten är ny sedan baslinjen.": "The task is new since the baseline.",
  "Aktiviteten saknar datum nu.": "The task has no dates now.",
  "jämfört med baslinjen": "compared with the baseline",
  "Baslinje: ingen": "Baseline: none",
  "Baslinje:": "Baseline:",
  "{n} senare": "{n} later",
  "{n} tidigare": "{n} earlier",
  "{n} nya": "{n} new",
  "{n} borttagna": "{n} removed",
  "Jämfört med baslinjen {name}, sparad {d}. Största förseningen: {m} dagar.": "Compared with the baseline {name}, saved {d}. Largest delay: {m} days.",
  "Baslinje {n} – {d}": "Baseline {n} – {d}",
  "Namn på baslinjen": "Baseline name",
  "📏 Spara baslinje": "📏 Save baseline",
  "Planen har {n} baslinjer, som är max. Ta bort en för att spara en ny.": "The plan has {n} baselines, which is the maximum. Delete one to save a new one.",
  "Sparar start och slut för alla aktiviteter och milstolpar som de ser ut nu. Ge gärna baslinjen ett namn, t.ex. Inför nästa gate.": "Saves the start and finish of all tasks and milestones as they are now. Give the baseline a name, e.g. Before the next gate.",
  "Sparad": "Saved",
  "Ingen baslinje i Gantt": "No baseline in the Gantt",
  "Spara om med planens datum i dag": "Save again with the plan's dates today",
  "Ta bort baslinjen": "Delete the baseline",
  "Inga baslinjer ännu.": "No baselines yet.",
  "Baslinjer – {name}": "Baselines – {name}",
  "Baslinjen ”{name}” är sparad": "The baseline “{name}” is saved",
  "Ta bort?": "Delete?",
  "Skriv över?": "Overwrite?",
  "📏 Baslinjer…": "📏 Baselines…",
  "Baslinje att jämföra planen med": "Baseline to compare the plan with",
  "Baslinjer": "Baselines",
  "Spara hur planen ser ut i dag och se senare vad som har flyttats – som baslinjen i MS Project.": "Save how the plan looks today and see later what has moved – like the baseline in MS Project.",
  "<b>⋯ → 📏 Baslinjer…</b> → <b>Spara baslinje</b> sparar start och slut för alla aktiviteter och milstolpar. Ge baslinjen ett namn, t.ex. <i>Inför nästa gate</i> – spara gärna en vid varje gate.": "<b>⋯ → 📏 Baselines…</b> → <b>Save baseline</b> saves the start and finish of all tasks and milestones. Give the baseline a name, e.g. <i>Before the next gate</i> – save one at each gate.",
  "Välj baslinje i raden med Vecka/Månad/Kvartal. Baslinjen visas som en tunn grå stapel under aktiviteten (ofylld romb för milstolpar), och avvikelsen i slutdatum står efter namnet: <b>+5 d</b> i rött = senare, <b>−3 d</b> i grönt = tidigare.": "Choose the baseline in the row with Week/Month/Quarter. The baseline is shown as a thin grey bar under the task (hollow diamond for milestones), and the finish variance follows the name: <b>+5 d</b> in red = later, <b>−3 d</b> in green = earlier.",
  "Bredvid valet står hur många aktiviteter som slutar senare och tidigare än baslinjen och hur många som är nya. Tooltipen och panelen visar baslinjens datum och avvikelsen.": "Next to the choice you see how many tasks finish later and earlier than the baseline and how many are new. The tooltip and the panel show the baseline dates and the variance.",
  "Upp till 11 baslinjer per plan. I listan byter du namn, sparar om med planens datum i dag (⟳) eller tar bort (🗑) – båda kräver ett andra klick.": "Up to 11 baselines per plan. In the list you rename, save again with the plan's dates today (⟳) or delete (🗑) – both need a second click.",
  "Vilken baslinje som visas väljer var och en – planen ändras inte av det. Uppdatera från Excel ändrar inte baslinjerna, och de följer med när planen exporteras, i versionerna och i den lokala versionens fil.": "Everyone chooses which baseline they see – it does not change the plan. Update from Excel does not change the baselines, and they come along when the plan is exported, in the versions and in the local version's file.",
  "Nytt: baslinjer": "New: baselines",
  "⋯ → 📏 Baslinjer… sparar hur planen ser ut nu, så att du senare ser vad som har flyttats. Upp till 11 per plan, t.ex. en vid varje gate.": "⋯ → 📏 Baselines… saves how the plan looks now, so that you can see later what has moved. Up to 11 per plan, e.g. one at each gate.",
  "Jämför med baslinjen": "Compare with the baseline",
  "Välj baslinje här. Grå staplar visar baslinjen och avvikelsen står efter namnet; bredvid står hur många som är senare och tidigare.": "Choose the baseline here. Grey bars show the baseline and the variance follows the name; next to it you see how many are later and earlier.",
  // Lokala versionen: program och spara till fil (#102)
  "Program i lokala versionen": "Programmes in the local version",
  "Nytt: program i lokala versionen": "New: programmes in the local version",
  "⋯ → Nytt program… skapar ett program. ＋ Lägg till plan i programmet visar dina planer i en lista.": "⋯ → New programme… creates a programme. ＋ Add plan in the programme shows your plans in a list.",
  "Spara till fil": "Save to file",
  "Med programmet öppet sparar 💾 Spara (Ctrl+S) programmet och alla dess planer i en fil. Den gula raden överst visas så länge något inte är sparat till fil.": "With the programme open, 💾 Save (Ctrl+S) saves the programme and all its plans in one file. The yellow bar at the top is shown as long as something is not saved to a file.",
  "NexusOrdo som en fil på din dator – utan installation. <b>Det du gör finns bara i webbläsaren tills du sparar det till fil med 💾 Spara (Ctrl+S).</b>": "NexusOrdo as a file on your computer – without installation. <b>What you do only exists in the browser until you save it to a file with 💾 Save (Ctrl+S).</b>",
  "<b>Spara alltid till fil.</b> Webbläsaren håller bara en arbetskopia, som försvinner om webbläsardata rensas eller om du byter dator. Så länge något inte är sparat visar en gul rad överst knappen <b>💾 Spara till fil</b>.": "<b>Always save to a file.</b> The browser only keeps a working copy, which disappears if browser data is cleared or if you change computer. As long as something is unsaved, a yellow bar at the top shows the button <b>💾 Save to file</b>.",
  "<b>Program:</b> <b>⋯ → Nytt program…</b>, lägg till planerna med <b>＋ Lägg till plan</b> (välj i listan) och spara med <b>💾 Spara</b> – filen innehåller programmet och alla dess planer. Öppnar du filen igen väljer du <b>Ersätt arbetskopian</b> eller <b>Öppna som kopia</b>.": "<b>Programmes:</b> <b>⋯ → New programme…</b>, add the plans with <b>＋ Add plan</b> (choose in the list) and save with <b>💾 Save</b> – the file contains the programme and all its plans. When you open the file again, choose <b>Replace the working copy</b> or <b>Open as a copy</b>.",
  "<b>2. Lägg huvudplanen i ett program.</b> Finns inget program: <b>⋯ → Nytt program…</b>. Klicka <b>＋ Lägg till plan</b> i programmet och välj huvudplanen i listan. Spara programmet med <b>💾 Spara</b>.": "<b>2. Add the main plan to a programme.</b> If there is no programme: <b>⋯ → New programme…</b>. Click <b>＋ Add plan</b> in the programme and choose the main plan in the list. Save the programme with <b>💾 Save</b>.",
  "I den lokala versionen: <b>⋯ → Nytt program…</b>, lägg till planerna med <b>＋ Lägg till plan</b> (välj i listan) och spara programmet med <b>💾 Spara</b> – filen innehåller programmet och alla dess planer.": "In the local version: <b>⋯ → New programme…</b>, add the plans with <b>＋ Add plan</b> (choose in the list) and save the programme with <b>💾 Save</b> – the file contains the programme and all its plans.",
  "💾 Spara till fil": "💾 Save to file",
  "<b>Programmet är inte sparat till fil.</b> Ändringarna finns bara i webbläsaren – spara programmet (med alla dess planer) till en fil i din egen mapp.": "<b>The programme is not saved to a file.</b> The changes only exist in the browser – save the programme (with all its plans) to a file in your own folder.",
  "<b>Planen är inte sparad till fil.</b> Ändringarna finns bara i webbläsaren – spara planen till en fil i din egen mapp.": "<b>The plan is not saved to a file.</b> The changes only exist in the browser – save the plan to a file in your own folder.",
  "Alla planer i arbetskopian finns redan i programmet. Öppna eller skapa fler planer först.": "All plans in the working copy are already in the programme. Open or create more plans first.",
  "Välj planerna som ska ingå. Programmet läser planerna men ändrar dem aldrig.": "Choose the plans to include. The programme reads the plans but never changes them.",
  "{n} planer tillagda i {prog}": "{n} plans added to {prog}",
  "välj bland dina planer": "choose from your plans",
  "Programmet och {n} planer sparade till {file}": "The programme and {n} plans saved to {file}",
  "Programmet laddades ner som {file}": "The programme was downloaded as {file}",
  "Det finns redan en arbetskopia av programmet eller dess planer i webbläsaren ({list}). Ersätt dem med filens version, eller öppna filen som en kopia?": "There is already a working copy of the programme or its plans in the browser ({list}). Replace them with the file’s version, or open the file as a copy?",
  "Kunde inte öppna: ": "Could not open: ",
  // Huvudprojekt och delprojekt (#67)
  "Stäng av alla filter i Planner innan du exporterar. Med ett filter aktivt tar exporten bara med en del av planen, och datum och aktiviteter saknas i NexusOrdo.": "Turn off all filters in Planner before you export. With a filter on, the export only contains part of the plan, and dates and tasks are missing in NexusOrdo.",
  "Ett huvudprojekt har en huvudplan med de gemensamma gaterna. Varje delprojekt har en egen plan som följer gaterna eller har egna. Så här lägger du till delprojekt i ett befintligt projekt:": "A main project has a main plan with the common gates. Each subproject has its own plan that follows the gates or has its own. This is how you add subprojects to an existing project:",
  "<b>1. Gör projektets plan till huvudplan.</b> Öppna planen och välj <b>⋯ → 🏷 Projektuppgifter…</b>. Fyll i <i>Program</i> och <i>{l1}</i> (huvudprojektets namn), kryssa i <i>Huvudplan</i> och klicka <b>Spara</b>.": "<b>1. Make the project’s plan the main plan.</b> Open the plan and choose <b>⋯ → 🏷 Project data…</b>. Fill in <i>Programme</i> and <i>{l1}</i> (the main project’s name), tick <i>Main plan</i> and click <b>Save</b>.",
  "<b>4. Fyll i dialogen.</b> Skriv delprojektets namn – det blir <i>{l2}</i>. Gate-veckorna är huvudplanens: låt dem stå, ändra dem om delprojektet har egna gater, eller töm dem så ärver delprojektet huvudplanens. Välj mallgrupper och klicka <b>Skapa plan</b>.": "<b>4. Fill in the dialog.</b> Type the subproject’s name – it becomes <i>{l2}</i>. The gate weeks are the main plan’s: leave them, change them if the subproject has its own gates, or clear them so the subproject inherits the main plan’s. Choose template groups and click <b>Create plan</b>.",
  "<b>5. Klart.</b> Delprojektet får huvudplanens projektuppgifter, läggs i programmet och visas under huvudprojektet. Upprepa för varje delprojekt.": "<b>5. Done.</b> The subproject gets the main plan’s project data, is added to the programme and is shown under the main project. Repeat for each subproject.",
  "<b>Finns delprojektets plan redan</b> (t.ex. importerad från Planner): öppna den, välj <b>⋯ → 🏷 Projektuppgifter…</b>, fyll i samma <i>Program</i> och <i>{l1}</i> som huvudplanen och delprojektets namn i <i>{l2}</i>. Lägg sedan till planen i programmet med <b>＋ Lägg till plan</b>.": "<b>If the subproject’s plan already exists</b> (e.g. imported from Planner): open it, choose <b>⋯ → 🏷 Project data…</b>, fill in the same <i>Programme</i> and <i>{l1}</i> as the main plan and the subproject’s name in <i>{l2}</i>. Then add the plan to the programme with <b>＋ Add plan</b>.",
  "Huvudprojekt och delprojekt": "Main projects and subprojects",
  "Planer med samma nivå 1 samlas under huvudprojektet: antal delprojekt, sämsta hälsa och nästa gemensamma gate. Delprojekt utan egna gater visar huvudplanens (ärvd).": "Plans with the same Level 1 are gathered under the main project: number of subprojects, worst health and next common gate. Subprojects without their own gates show the main plan's (inherited).",
  "Gantt visar alla projekt med sina faser. Ett huvudprojekt fälls ut till delprojekt, faser och aktiviteter.": "Gantt shows all projects with their phases. A main project expands to subprojects, phases and activities.",
  "ärvd från huvudplanen {name}": "inherited from the main plan {name}",
  "avviker från huvudplanen ({w}): {d} v": "differs from the main plan ({w}): {d} wk",
  "{n} delprojekt": "{n} subprojects",
  "Huvudplan": "Main plan",
  "ärvda gater": "inherited gates",
  "stödprojekt": "support project",
  "{n} gater avviker": "{n} gates differ",
  "ärvd": "inherited",
  "Inga gater (stödprojekt)": "No gates (support project)",
  "Kan bli huvudplan för {l1} – delprojekten ärver då dess gater.": "Can become the main plan for {l1} – the subprojects then inherit its gates.",
  "Gör till huvudplan": "Make main plan",
  "Stödprojekt – visas utan gater": "Support project – shown without gates",
  "Gater ärvda från huvudplanen": "Gates inherited from the main plan",
  "Egna gater": "Own gates",
  "avviker från huvudplanen:": "differ from the main plan:",
  "samma som huvudplanen": "same as the main plan",
  "Inga gater – ingen huvudplan att ärva från": "No gates – no main plan to inherit from",
  "{n} följer": "{n} follow",
  "{n} avviker": "{n} differ",
  "Huvudprojekt": "Main project",
  "delprojekt": "subprojects",
  "sämsta hälsa": "worst health",
  "nästa gemensamma gate": "next common gate",
  "Nästa gemensamma gate:": "Next common gate:",
  "Huvudplanens gater": "The main plan's gates",
  "Ingen huvudplan – välj vilken plan som äger de gemensamma gaterna.": "No main plan – choose which plan owns the common gates.",
  "Gör {name} till huvudplan": "Make {name} the main plan",
  "＋ Nytt delprojekt": "＋ New subproject",
  "Öppna huvudplan": "Open main plan",
  "Gör till huvudplan?": "Make main plan?",
  "Inte längre huvudplan?": "No longer main plan?",
  "Ta bort markeringen": "Remove the marking",
  "{name} blir huvudplan för {l1}. Huvudplanens gater är huvudprojektets gater – delprojekt utan egna gater visar dem som ärvda.": "{name} becomes the main plan for {l1}. The main plan's gates are the main project's gates – subprojects without their own gates show them as inherited.",
  "{name} är huvudplan i dag och blir delprojekt.": "{name} is the main plan today and becomes a subproject.",
  "{name} blir ett vanligt delprojekt i {l1}.": "{name} becomes an ordinary subproject in {l1}.",
  "{name} är huvudplan för {l1}": "{name} is the main plan for {l1}",
  "{name} är inte längre huvudplan": "{name} is no longer the main plan",
  "{name} är tillagd i programmet {prog}": "{name} has been added to the programme {prog}",
  "Delprojektets namn": "Name of the subproject",
  "Nytt delprojekt i {l1}. Gate-veckorna är huvudplanens – ändra dem om delprojektet har egna gater, eller töm dem så ärver delprojektet huvudplanens.": "New subproject in {l1}. The gate weeks are the main plan's – change them if the subproject has its own gates, or clear them so the subproject inherits the main plan's.",
  "Huvudplan för {l1} – delprojekten ärver dess gater": "Main plan for {l1} – the subprojects inherit its gates",
  "Skriv ett namn på planen": "Enter a name for the plan",
  "Tom plan skapad": "Empty plan created",
  "Alltid huvudplanens (ärvda)": "Always the main plan's (inherited)",
  "Inga gater (stödprojekt, t.ex. IT eller Facility)": "No gates (support project, e.g. IT or Facility)",
  "<b>📈 Milstolpetrend</b> (klicka på nästa milstolpe eller <b>📊 Uppföljning</b>) visar hur gaterna har flyttats mellan uppdateringarna från Planner.": "<b>📈 Milestone trend</b> (click the next milestone or <b>📊 Follow-up</b>) shows how the gates have moved between updates from Planner.",
  "Flyttar": "Moves",
  "Förskjutning per milstolpe": "Shift per milestone",
  "Förskjutning": "Shift",
  "Första": "First",
  "Hur milstolparnas prognos har flyttats mellan uppdateringarna. En linje uppåt betyder att milstolpen har skjutits fram. Ögonblicksbilder sparas vid import, vid uppdatering från Excel och med knappen nedan ({n} sparade).": "How the milestones' forecasts have moved between updates. A line going up means the milestone has slipped. Snapshots are saved on import, on update from Excel and with the button below ({n} saved).",
  "Klicka på nästa milstolpe eller välj 📊 Uppföljning → 📈 Milstolpetrend… för att se hur gaterna har flyttats.": "Click the next milestone or choose 📊 Follow-up → 📈 Milestone trend… to see how the gates have moved.",
  "Milstolpetrend – {name}": "Milestone trend – {name}",
  "Milstolpetrend": "Milestone trend",
  "Milstolpetrenden finns per plan – öppna planen": "The milestone trend is per plan – open the plan",
  "Nytt: milstolpetrend": "New: milestone trend",
  "Planen har inga milstolpar med datum": "The plan has no milestones with dates",
  "Prognos för milstolpen": "Milestone forecast",
  "Prognos nu": "Forecast now",
  "Rapport": "Report",
  "Rapportdatum (ögonblicksbild)": "Report date (snapshot)",
  "Rapportdatum åt höger, prognos uppåt. En stigande linje betyder att milstolpen har skjutits fram.": "Report date to the right, forecast upwards. A rising line means the milestone has slipped.",
  "Senast flyttad": "Last moved",
  "Spara ögonblicksbild": "Save snapshot",
  "Total förskjutning, antal flyttar och senaste flytt. Röd = minst fyra veckor.": "Total shift, number of moves and last move. Red = at least four weeks.",
  "Trenddiagram": "Trend chart",
  "Trenden syns efter nästa uppdatering från Excel – eller spara en ögonblicksbild nu.": "The trend appears after the next update from Excel – or save a snapshot now.",
  "Välj milstolpar till höger.": "Choose milestones on the right.",
  "före senaste importen": "before the last import",
  "nådd": "reached",
  "Ögonblicksbild sparad ({d})": "Snapshot saved ({d})",
  "Övriga milstolpar": "Other milestones",
  "📈 Milstolpetrend": "📈 Milestone trend",
  "📈 Milstolpetrend…": "📈 Milestone trend…",
  '{n} dokument': '{n} documents',
  'Dokument': 'Documents',
  'Kunde inte öppna länken': 'Could not open the link',
  'Webbläsaren stoppade fönstret. Kopiera länken och öppna den i en ny flik:': 'The browser blocked the window. Copy the link and open it in a new tab:',
  'Dokument i fasen': 'Documents in the phase',
  'Inga aktiviteter i fasen har dokument ännu.': 'No activities in the phase have documents yet.',
  '+ Lägg till dokument': '+ Add document',
  'Klistra in en länk från SharePoint (Kopiera länk). Bara länken sparas – dokumentet ligger kvar på SharePoint.': 'Paste a link from SharePoint (Copy link). Only the link is saved – the document stays on SharePoint.',
  'Titel (valfri)': 'Title (optional)',
  'Spara länk': 'Save link',
  'Ändra': 'Edit',
  'Inga dokument': 'No documents',
  'Ange en länk som börjar med https://': 'Enter a link starting with https://',
  'Länken pekar inte på SharePoint – kontrollera att mottagaren har behörighet': 'The link does not point to SharePoint – check that recipients have access',
  '<b>Dokument</b> i panelen: klistra in en länk från SharePoint. Aktiviteten får 📎 i Gantt-vyn och länken finns kvar vid ny import.': '<b>Documents</b> in the panel: paste a link from SharePoint. The activity gets 📎 in the Gantt view and the link is kept on re-import.',
  'Dokument på aktiviteter': 'Documents on activities',
  'Nytt: dokument': 'New: documents',
  'Öppna en plan och klicka på en aktivitet för att länka dokument från SharePoint.': 'Open a plan and click an activity to link documents from SharePoint.',
  'Under Dokument i panelen länkar du till dokument på SharePoint. Bara länken sparas.': 'Under Documents in the panel you link to documents on SharePoint. Only the link is saved.',
  'Klistra in länken (Kopiera länk i SharePoint), ge den en titel och spara aktiviteten.': 'Paste the link (Copy link in SharePoint), give it a title and save the activity.',
  '📎 i Gantt-vyn': '📎 in the Gantt view',
  'Aktiviteter med dokument får 📎 med antal. Länkarna finns kvar när planen uppdateras från Planner.': 'Activities with documents get 📎 with a count. The links are kept when the plan is updated from Planner.',
  'Uppdatera från Excel': 'Update from Excel',
  'Kom igång': 'Getting started',
  'Exportera planen i Planner: <b>⋯ → Exportera plan till Excel</b>. Planner Premium: exportera projektet till Excel på samma sätt.': 'Export the plan in Planner: <b>⋯ → Export plan to Excel</b>. Planner Premium: export the project to Excel the same way.',
  "Välj <b>+ Ny plan / Importera…</b> sist i planväljaren (eller <b>⋯ → ⇪ Importera från Excel…</b>) och välj filen, eller dra in filen i fönstret.": "Choose <b>+ New plan / Import…</b> at the bottom of the plan picker (or <b>⋯ → ⇪ Import from Excel…</b>) and pick the file, or drag the file into the window.",
  'Varje fas är en färgad rubrikrad med en fasstapel. Klicka på raden för att fälla ihop eller ut fasen.': 'Each phase is a coloured header row with a phase bar. Click the row to collapse or expand the phase.',
  '◆ är milstolpar och gater. Pilar visar beroenden – en röd pil betyder att ordningen inte går ihop.': '◆ are milestones and gates. Arrows show dependencies – a red arrow means the order does not add up.',
  'Flaggor: <b>! Sen</b> = försenad, <b>⇄ +7 d</b> = flyttad sedan förra importen, <b>? Kontrollera</b> = osäker matchning vid import.': 'Flags: <b>! Late</b> = overdue, <b>⇄ +7 d</b> = moved since the last import, <b>? Check</b> = uncertain match on import.',
  'Nyckeltalen högst upp visar antal, andel klart, försenade, gate-beredskap och nästa milstolpe.': 'The figures at the top show the number of activities, share done, late, gate readiness and the next milestone.',
  'Byt skala med <b>Vecka</b>, <b>Månad</b> eller <b>Kvartal</b>. <b>Dölj klara</b> och sökrutan filtrerar listan.': 'Change scale with <b>Week</b>, <b>Month</b> or <b>Quarter</b>. <b>Hide done</b> and the search box filter the list.',
  'Ändra i planen': 'Changing the plan',
  'Dra en stapel för att flytta den, eller dra i kanten för att ändra start eller slut.': 'Drag a bar to move it, or drag its edge to change the start or end.',
  'Klicka på en aktivitet för att öppna panelen: namn, fas, datum, klart, ansvarig, beroenden och anteckningar.': 'Click an activity to open the panel: name, phase, dates, done, assigned to, dependencies and notes.',
  'Datum kan skrivas som vecka (ÅÅVV) i fältet bredvid datumet, t.ex. <b>2645</b> = vecka 45 2026. Start blir måndag och slut fredag.': 'Dates can be entered as a week (YYWW) in the field next to the date, e.g. <b>2645</b> = week 45 2026. Start becomes Monday and end Friday.',
  '<b>+ Aktivitet</b> lägger till en ny aktivitet. <b>↶ Ångra</b> (Ctrl+Z) tar tillbaka den senaste ändringen.': '<b>+ Activity</b> adds a new activity. <b>↶ Undo</b> (Ctrl+Z) reverts the latest change.',
  'Ändringar sparas automatiskt.': 'Changes are saved automatically.',
  'Exportera planen från Planner igen och välj <b>⟳ Uppdatera ▾ → Uppdatera från Excel…</b>': 'Export the plan from Planner again and choose <b>⟳ Update ▾ → Update from Excel…</b>',
  'NexusOrdo jämför filen med den öppna planen och visar först vad som är ändrat, nytt, borttaget och flyttat. Ingen ny plan skapas.': 'NexusOrdo compares the file with the open plan and first shows what is changed, new, removed and moved. No new plan is created.',
  'Beroenden, anteckningar och gate-checklistans svar som du lagt till i NexusOrdo finns kvar.': 'Dependencies, notes and gate checklist answers you added in NexusOrdo are kept.',
  'Får du en varning om att filen gäller en annan plan – kontrollera att du valt rätt fil.': 'If you get a warning that the file belongs to another plan, check that you chose the right file.',
  'Gate-checklistan': 'The gate checklist',
  'Ny plan från mall': 'New plan from template',
  '<b>⋯ → Ny plan från mall…</b> skapar en plan med standardaktiviteter. <b>Lägg till från mall…</b> lägger till dem i en befintlig plan.': '<b>⋯ → New plan from template…</b> creates a plan with standard activities. <b>Add from template…</b> adds them to an existing plan.',
  'Programvyn': 'The programme view',
  'Beroenden mellan projekt visas som pilar i statusfärg: grön OK, gul risk, röd blockerad.': 'Dependencies between projects are shown as arrows in status colours: green OK, yellow risk, red blocked.',
  'Programmet läser planerna men ändrar dem aldrig.': 'The programme reads the plans but never changes them.',
  '<b>Exportera bild</b> gör en bild av Gantt- eller roadmapvyn som passar i PowerPoint och e-post.': '<b>Export image</b> makes a picture of the Gantt or roadmap view that fits PowerPoint and e-mail.',
  'Välj <b>Kopiera</b> och klistra in, eller <b>Ladda ner PNG</b>.': 'Choose <b>Copy</b> and paste, or <b>Download PNG</b>.',
  'Om nedladdningen blockeras öppnas bilden i en ny flik – högerklicka och välj <b>Spara bild som</b>.': 'If the download is blocked, the image opens in a new tab – right-click and choose <b>Save image as</b>.',
  'Språk och tema': 'Language and theme',
  "ändrad": "changed",
  "marginal {a} → {b}": "margin {a} → {b}",
  "{n} ändrade beroenden": "{n} changed dependencies",
  "{n} ändrat beroende": "{n} changed dependency",
  "Påverkar andra projekt": "Affects other projects",
  "beroenden i programmet som blir risk eller blockerade. Uppdateringen stoppas inte; programmet visar en varning tills någon markerat den som sedd.": "dependencies in the programme that become at risk or blocked. The update is not stopped; the programme shows a warning until someone marks it as seen.",
  "Annat projekt – aktivitet": "Other project – activity",
  "Marginal före": "Margin before",
  "väntar på {name}": "waits for {name}",
  "{name} väntar på den": "{name} waits for it",
  "ändring": "change",
  "{plan} uppdaterad {when}": "{plan} updated {when}",
  "{n} beroende påverkat sedan senaste uppdateringen": "{n} dependency affected since the last update",
  "{n} beroenden påverkade sedan senaste uppdateringen": "{n} dependencies affected since the last update",
  "Visa beroendena": "Show the dependencies",
  "Visa i Gantt": "Show in Gantt",
  "Markera som sett": "Mark as seen",
  "Markerat som sett": "Marked as seen",
  "✓ Markera som sett ({n} ändrade)": "✓ Mark as seen ({n} changed)",
  "<b>Påverkar andra projekt:</b> när en plan i programmet uppdateras visar förhandsvisningen beroenden som blir risk eller blockerade i program du har tillgång till, med marginalen före och efter i dagar och veckor. Programmet visar sedan en banner, och pilarna och aktiviteterna märks <b>ändrad</b> i Gantt tills någon klickar <b>Markera som sett</b>.": "<b>Affects other projects:</b> when a plan in the programme is updated, the preview shows dependencies that become at risk or blocked in programmes you have access to, with the margin before and after in days and weeks. The programme then shows a banner, and the arrows and activities are tagged <b>changed</b> in the Gantt until someone clicks <b>Mark as seen</b>.",
  "Påverkade beroenden": "Affected dependencies",
  "Har en uppdatering gjort ett beroende till risk eller blockerat visas en banner här. Visa beroendena, se dem i Gantt eller klicka Markera som sett.": "If an update has made a dependency at risk or blocked, a banner is shown here. Show the dependencies, see them in the Gantt or click Mark as seen.",
  "Nytt: påverkan på andra projekt": "New: impact on other projects",
  "Ingår planen i ett program visar förhandsvisningen vid Uppdatera vilka beroenden till andra projekt som blir risk eller blockerade – med marginalen före och efter i dagar och veckor. Uppdateringen stoppas inte.": "If the plan is part of a programme, the Update preview shows which dependencies to other projects become at risk or blocked – with the margin before and after in days and weeks. The update is not stopped.",
  "Varning i programmet": "Warning in the programme",
  "Programmets översikt visar hur många beroenden som påverkats sedan senaste uppdateringen, med länk till listan.": "The programme overview shows how many dependencies have been affected since the last update, with a link to the list.",
  "Öppna programmet: översikten visar en banner med antalet påverkade beroenden, och i Gantt märks pilarna och aktiviteterna ändrad tills någon klickar Markera som sett.": "Open the programme: the overview shows a banner with the number of affected dependencies, and in the Gantt the arrows and activities are tagged changed until someone clicks Mark as seen.",
  "<b>SV ▾</b> väljer språk och <b>◐</b> byter tema.": "<b>EN ▾</b> picks the language and <b>◐</b> switches theme.",
  'Välj plan här. Menyn ⋯ bredvid har ny plan, mallar, Öppna och Spara till fil, export och versioner.': 'Choose a plan here. The ⋯ menu next to it has new plan, templates, Open and Save to file, export and versions.',
  "Språkknappen uppe till höger (<b>SV ▾</b>) visar språket – välj <b>Svenska</b> eller <b>English</b>. Valet sparas i din webbläsare.": "The language button at the top right (<b>EN ▾</b>) shows the language – choose <b>Svenska</b> or <b>English</b>. The choice is saved in your browser.",
  '<b>◐</b> växlar mellan ljust och mörkt tema.': '<b>◐</b> switches between light and dark theme.',
  'Från MS Project till NexusOrdo': 'From MS Project to NexusOrdo',
  'Sammanfattningsaktivitet → <b>fas</b> (bucket i Planner). Milstolpe → <b>milstolpe</b> eller <b>gate</b>.': 'Summary task → <b>phase</b> (bucket in Planner). Milestone → <b>milestone</b> or <b>gate</b>.',
  'Föregående aktiviteter → <b>beroenden</b> (slut till start). % färdigt → <b>Klart</b>.': 'Predecessors → <b>dependencies</b> (finish to start). % complete → <b>Done</b>.',
  'Ingen automatisk schemaläggning: datum sätts av dig, beroenden varnar när ordningen inte går ihop.': 'No automatic scheduling: you set the dates; dependencies warn when the order does not add up.',
  'Veckonummer (ÅÅVV) fungerar som i MS Project-tidplaner. <b>Roadmap</b>-vyn ger en översikt per fas.': 'Week numbers (YYWW) work as in MS Project schedules. The <b>Roadmap</b> view gives an overview per phase.',
  'Vanliga frågor': 'Frequently asked questions',
  '<b>Går mina ändringar tillbaka till Planner?</b> Nej. Planner äger uppgifterna; ändringar i NexusOrdo stannar i NexusOrdo.': '<b>Do my changes go back to Planner?</b> No. Planner owns the tasks; changes in NexusOrdo stay in NexusOrdo.',
  '<b>Försvinner mina beroenden när jag uppdaterar från Excel?</b> Nej, beroenden och anteckningar finns kvar.': '<b>Are my dependencies lost when I update from Excel?</b> No, dependencies and notes are kept.',
  '<b>Varför står det ”? Kontrollera”?</b> I Planner Premium är Task number en radplats som kan ändras. När en aktivitet inte kan matchas säkert markeras den.': '<b>Why does it say “? Check”?</b> In Planner Premium the Task number is a row position that can change. When an activity cannot be matched safely, it is flagged.',
  'Klicka för större bild': 'Click for a larger image',
  'Ny plan från mall…': 'New plan from template…',
  'Lägg till från mall…': 'Add from template…',
  'Öppna en plan först': 'Open a plan first',
  'Namn på planen': 'Plan name',
  'Ny plan från mall': 'New plan from template',
  'Grupper': 'Groups',
  'Gate-veckor (ÅÅVV)': 'Gate weeks (YYWW)',
  'slut på {phase}': 'end of {phase}',
  'Lägg till från mall – {name}': 'Add from template – {name}',
  'Skapa plan': 'Create plan',
  'Inga aktiviteter att lägga till – ange minst en gate-vecka': 'Nothing to add – enter at least one gate week',
  'Förhandsvisning': 'Preview',
  '{n} aktiviteter och gater': '{n} activities and gates',
  '{n} hoppas över eftersom deras gate saknar vecka': '{n} skipped because their gate has no week',
  '{n} finns redan i planen och läggs inte till igen': '{n} already exist in the plan and are not added again',
  '{n} aktiviteter och gater från mallen': '{n} activities and gates from the template',
  '{n} dubbletter hoppades över': '{n} duplicates skipped',
  'Flytta upp': 'Move up',
  'Flytta ner': 'Move down',
  'Försenad': 'Late',
  '! Sen': '! Late',
  'Klar': 'Done',
  'Flyttad {d} dagar sedan förra importen': 'Moved {d} days since the last import',
  '? Kontrollera': '? Check',
  'v': 'W',
  'Kryssa i Kritisk linje för att se vilka aktiviteter som styr planens slut eller en vald gate. Beräknas från beroendena – inga datum ändras.': 'Tick Critical path to see which tasks drive the plan end or a chosen gate. Calculated from the dependencies – no dates are changed.',
  'Kritisk linje och marginal': 'Critical path and margin',
  'Nytt: kritisk linje': 'New: critical path',
  'Öppna en plan med beroenden för att se vilka aktiviteter som styr slutdatumet och hur mycket marginal det finns till nästa gate.': 'Open a plan with dependencies to see which tasks drive the end date and how much margin there is to the next gate.',
  'Kryssa i Kritisk linje. Röd ram = kritisk (ingen slack), streckad orange = mindre än en veckas marginal; övriga tonas ned. Inga datum ändras.': 'Tick Critical path. Red outline = critical (no slack), dashed orange = less than a week of margin; the rest is dimmed. No dates are changed.',
  'Välj mål': 'Choose target',
  'Räkna mot planens slut eller mot en gate. Slacken visas i tooltipen och i panelen, i arbetsdagar enligt planens kalender.': 'Calculate to the plan end or to a gate. The slack is shown in the tooltip and the panel, in working days according to the plan’s calendar.',
  'Hur säker är linjen?': 'How reliable is the path?',
  'Raden visar antal kritiska och hur stor del av aktiviteterna som har beroenden. Under 30 % kan den kritiska linjen vara ofullständig.': 'The row shows the number of critical tasks and the share of tasks with dependencies. Below 30 % the critical path may be incomplete.',
  'Marginal till nästa gate': 'Margin to the next gate',
  '⏳ visar marginalen till nästa gate. Klicka för att visa den kritiska linjen mot gaten – kedjan som styr står i tooltipen.': '⏳ shows the margin to the next gate. Click to show the critical path to the gate – the driving chain is in the tooltip.',
  'Vilka aktiviteter styr slutdatumet, och hur mycket marginal finns det till nästa gate? Beräknas från beroendena – inga datum ändras.': 'Which tasks drive the end date, and how much margin is there to the next gate? Calculated from the dependencies – no dates are changed.',
  'Kryssa i <b>Kritisk linje</b> i raden med Vecka/Månad/Kvartal. <b>Röd ram</b> = kritisk (slack 0 eller mindre), <b>streckad orange</b> = nära kritisk (högst en veckas slack). Övriga aktiviteter tonas ned och pilarna i kedjan markeras.': 'Tick <b>Critical path</b> in the row with Week/Month/Quarter. <b>Red outline</b> = critical (slack 0 or less), <b>dashed orange</b> = near-critical (at most one week of slack). Other tasks are dimmed and the arrows in the chain are highlighted.',
  '<b>Mål:</b> planens slut eller en gate. Mot en gate räknas bara aktiviteterna som leder fram till gaten via beroenden. Har gaten inga beroenden räknas fasens aktiviteter som föregångare.': '<b>Target:</b> the plan end or a gate. For a gate, only the tasks that lead to the gate through dependencies count. If the gate has no dependencies, the tasks in its phase count as predecessors.',
  '<b>Slack</b> = hur många arbetsdagar aktiviteten kan försenas innan målet flyttas. Den visas i tooltipen och i panelen (med tidigaste och senaste start och slut). Helger och svenska helgdagar räknas inte (<b>⏱ Kapacitet…</b>). Negativ slack betyder att planen redan går ut över målet – ofta en röd pil.': '<b>Slack</b> = how many working days the task can slip before the target moves. It is shown in the tooltip and the panel (with earliest and latest start and finish). Weekends and Swedish public holidays do not count (<b>⏱ Capacity…</b>). Negative slack means the plan already overruns the target – often a red arrow.',
  'Raden under verktygen visar antal kritiska, andel aktiviteter med beroenden och varningar. Har färre än 30 % av aktiviteterna beroenden kan den kritiska linjen vara ofullständig – lägg till beroenden i panelen (<b>Beroenden – startar efter att dessa är klara</b>).': 'The row below the tools shows the number of critical tasks, the share of tasks with dependencies and warnings. If fewer than 30 % of the tasks have dependencies, the critical path may be incomplete – add dependencies in the panel (<b>Dependencies – starts after these are done</b>).',
  'Nyckeltalet <b>⏳ 3 v till DG</b> visar marginalen till nästa gate som inte är passerad. Klicka för att visa den kritiska linjen mot gaten; tooltipen visar kedjan som styr. Utan beroenden räknas marginalen från fasens sista aktivitet.': 'The key figure <b>⏳ 3 W to DG</b> shows the margin to the next gate that has not been passed. Click to show the critical path to the gate; the tooltip shows the driving chain. Without dependencies the margin is counted from the last task in the phase.',
  'I programvyn räknas varje plan mot sitt eget slut, och programmets beroenden mellan projekten kopplar ihop planerna. Projektkorten i översikten visar marginalen till nästa gate per plan.': 'In the programme view each plan is calculated to its own end, and the programme’s dependencies between projects link the plans. The project cards in the overview show the margin to the next gate per plan.',
  'NexusOrdo flyttar aldrig några datum (ingen automatisk schemaläggning) – den kritiska linjen är ett underlag för dig.': 'NexusOrdo never moves any dates (no automatic scheduling) – the critical path is input for you.',
  '<b>Kritisk linje</b> markerar aktiviteterna som styr planens slut eller en gate – se <b>Kritisk linje och marginal</b>.': '<b>Critical path</b> highlights the tasks that drive the plan end or a gate – see <b>Critical path and margin</b>.',
  'Gaten har inga beroenden – fasens aktiviteter räknas som föregångare': 'The gate has no dependencies – the tasks in its phase count as predecessors',
  'Kedjan som styr: {chain}': 'Driving chain: {chain}',
  'Inga beroenden till gaten – räknat från fasens sista aktivitet: {name}': 'No dependencies to the gate – counted from the last task in the phase: {name}',
  'Inga beroenden till gaten och inga aktiviteter i dess fas – lägg till beroenden': 'No dependencies to the gate and no tasks in its phase – add dependencies',
  'marginal enligt beroenden': 'margin from dependencies',
  'marginal i fasen': 'margin in the phase',
  'saknar beroenden': 'no dependencies',
  'klicka för att visa den kritiska linjen mot gaten': 'click to show the critical path to the gate',
  'till {gate}': 'to {gate}',
  // Kritisk linje (#4)
  'Kritisk linje': 'Critical path',
  'Markera aktiviteterna som styr planens slut eller en vald gate – beräknas från beroenden, inga datum ändras': 'Highlight the tasks that drive the plan end or a chosen gate – calculated from dependencies, no dates are changed',
  'Mål för den kritiska linjen': 'Target of the critical path',
  'slack': 'slack',
  'Slack': 'Slack',
  'respektive plans slut': 'each plan’s end',
  'planens slut': 'the plan end',
  'mot {target}': 'to {target}',
  'kritisk': 'critical',
  'nära kritisk': 'near-critical',
  'Ingår inte i kedjan mot {target}': 'Not part of the chain to {target}',
  '{n} arbetsdagar': '{n} working days',
  'Tidigast': 'Earliest',
  'Senast': 'Latest',
  'Beräknas från beroenden och datum – inga datum ändras.': 'Calculated from dependencies and dates – no dates are changed.',
  'Mål: respektive plans slut': 'Target: each plan’s end',
  'Mål: planens slut': 'Target: plan end',
  'Mål:': 'Target:',
  'Bara {n} % av aktiviteterna har beroenden – den kritiska linjen kan vara ofullständig': 'Only {n} % of the tasks have dependencies – the critical path may be incomplete',
  '{n} aktiviteter ligger i en cirkel av beroenden och räknas inte': '{n} tasks are in a dependency loop and are not counted',
  'Gaten har inga föregångare – lägg till beroenden eller välj planens slut': 'The gate has no predecessors – add dependencies or choose the plan end',
  '{n} kritiska': '{n} critical',
  '{n} nära kritiska (slack ≤ 1 vecka)': '{n} near-critical (slack ≤ 1 week)',
  '{p} % med beroenden': '{p} % with dependencies',
  'Idag': 'Today',
  '{n} blockerade': '{n} blocked',
  '{n} blockerad': '{n} blocked',
  'väntar på': 'waiting for',
  'Datum': 'Date',
  'Period': 'Period',
  'FAS': 'PHASE',
  'Milstolpar': 'Milestones',
  '{n} st · {d} nådda': '{n} · {d} reached',
  'försenad': 'late',
  '✓ nådd': '✓ reached',
  '{n} aktiviteter · {p}% klart': '{n} activities · {p}% done',
  '{n} försenade': '{n} late',
  'Inga schemalagda aktiviteter att visa': 'No scheduled activities to show',
  'Projekt': 'Project',
  'Fas': 'Phase',
  'Mål': 'Goal',
  'Längd': 'Duration',
  '{n} dagar': '{n} days',
  'Klart': 'Done',
  'Flyttad': 'Moved',
  '{d} dagar sedan förra importen (slut var {end})': '{d} days since the last import (end was {end})',
  'Kontrollera': 'Check',
  'Väntar på': 'Waiting for',
  'slut': 'end',
  'Ansvarig': 'Assigned to',
  '{n} röda': '{n} red',
  'Ny aktivitet': 'New activity',
  'Redigera aktivitet': 'Edit activity',
  'Namn': 'Name',
  'Fas / bucket': 'Phase / bucket',
  'Milstolpe': 'Milestone',
  'Start': 'Start',
  'Slut': 'End',
  'Namn; Namn': 'Name; Name',
  'Beroenden – startar efter att dessa är klara': 'Dependencies – starts after these are done',
  'Filtrera…': 'Filter…',
  'Inga andra aktiviteter': 'No other activities',
  'Anteckningar': 'Notes',
  'Gate-checklista': 'Gate checklist',
  '{p} % klart': '{p} % done',
  '☑ Öppna gate-checklistan': '☑ Open the gate checklist',
  'Öppna gate-checklistan': 'Open the gate checklist',
  'Behöver kontrolleras': 'Needs checking',
  'Markera som kontrollerad': 'Mark as checked',
  'Flyttad <b>{d} dagar</b> sedan förra importen (var {from} – {to}).': 'Moved <b>{d} days</b> since the last import (was {from} – {to}).',
  'Från Planner': 'From Planner',
  'Prioritet': 'Priority',
  'Etiketter': 'Labels',
  'Checklista': 'Checklist',
  'Anteckningar i Planner': 'Notes in Planner',
  'Ta bort': 'Delete',
  'Avbryt': 'Cancel',
  'Spara': 'Save',
  'Markerad som kontrollerad': 'Marked as checked',
  'Ta bort aktivitet?': 'Delete activity?',
  '”{name}” tas bort från tidplanen.': '“{name}” will be removed from the schedule.',
  'Den kommer tillbaka om du importerar från Planner igen och den finns kvar där.': 'It will come back if you import from Planner again and it still exists there.',
  'Ange ett namn': 'Enter a name',
  'Excel-läsaren kunde inte laddas (kontrollera nätverket).': 'The Excel reader could not be loaded (check the network).',
  'Hittade inga kolumner som liknar en Planner-export (t.ex. ”Task Name”/”Aktivitetsnamn” och ”Due date”/”Förfallodatum”).': 'Found no columns that look like a Planner export (e.g. “Task Name” and “Due date”).',
  'Filen innehöll inga aktiviteter.': 'The file contained no activities.',
  'Flera aktiviteter heter ”{name}” i {bucket} – kontrollera att anteckningar och beroenden sitter rätt': 'Several activities are called “{name}” in {bucket} – check that notes and dependencies are on the right one',
  'Flera aktiviteter heter ”{name}” – kontrollera att anteckningar och beroenden sitter rätt': 'Several activities are called “{name}” – check that notes and dependencies are on the right one',
  'Nr {nr} hette tidigare ”{name}”; dess anteckningar och beroenden flyttades inte hit': 'No. {nr} was previously called “{name}”; its notes and dependencies were not moved here',
  'Efter': 'After',
  'från Planner': 'from Planner',
  'Beroendetyp': 'Dependency type',
  'Fördröjning i arbetsdagar': 'Lag in working days',
  'Fördröjning i arbetsdagar (negativt = överlapp)': 'Lag in working days (negative = overlap)',
  'Beroendetyp (FS, SS, FF, SF) och fördröjning i arbetsdagar räknas – från Planner Premium, från panelen och mellan projekt i ett program. Utan typ är beroendet slut → start.': 'Dependency type (FS, SS, FF, SF) and lag in working days are taken into account – from Planner Premium, from the panel and between projects in a programme. Without a type the dependency is finish → start.',
  '<b>Typ och fördröjning:</b> Planner Premium-exportens <b>AS, SS, AA, SA</b> (svenska) och <b>FS, SS, FF, SF</b> (engelska) med fördröjning, t.ex. <b>+2 dagar</b>, läses in. Pilen går från föregångarens start eller slut till efterföljarens start eller slut, och tooltipen visar t.ex. <b>SS +2 d</b>. Pilen blir röd först när typen bryts. Egna beroenden får typ och fördröjning (arbetsdagar) i panelen; de från Planner skrivs över vid uppdatering.': '<b>Type and lag:</b> the Planner Premium export’s <b>AS, SS, AA, SA</b> (Swedish) and <b>FS, SS, FF, SF</b> (English) with lag, e.g. <b>+2 days</b>, are read. The arrow runs from the predecessor’s start or finish to the successor’s start or finish, and the tooltip shows e.g. <b>SS +2 d</b>. The arrow turns red only when the type is broken. Your own dependencies get a type and lag (working days) in the panel; those from Planner are overwritten on update.',
  'Beroendetyper och fördröjning': 'Dependency types and lag',
  'Nytt: beroendetyper': 'New: dependency types',
  'Beroenden från Planner Premium läses nu in med typ – AS/FS (slut → start), SS (start → start), AA/FF (slut → slut), SA/SF (start → slut) – och fördröjning, t.ex. SS +2 d. Pilen går från rätt ände och blir röd först när typen bryts.': 'Dependencies from Planner Premium are now read with their type – AS/FS (finish → start), SS (start → start), AA/FF (finish → finish), SA/SF (start → finish) – and lag, e.g. SS +2 d. The arrow starts and ends at the right end and turns red only when the type is broken.',
  'Typ och fördröjning i panelen': 'Type and lag in the panel',
  'Klicka på en aktivitet: under Beroenden visas typ och fördröjning för varje föregångare. Egna beroenden kan ändras (arbetsdagar, negativt = överlapp); de från Planner skrivs över vid uppdatering.': 'Click a task: under Dependencies, the type and lag of each predecessor are shown. Your own dependencies can be changed (working days, negative = overlap); those from Planner are overwritten on update.',
  'Den kritiska linjen och marginalen till nästa gate räknar med typ och fördröjning. Ändrade typer syns i förhandsvisningen när planen uppdateras från Excel.': 'The critical path and the margin to the next gate take type and lag into account. Changed types show in the preview when the plan is updated from Excel.',
  'bryter mot beroendet': 'breaks the dependency',
  'beroende ”{name}” {a} → {b}': 'dependency “{name}” {a} → {b}',
  'd': 'd',
  'nytt namn (var ”{name}”)': 'new name (was “{name}”)',
  'klart {a} → {b} %': 'done {a} → {b} %',
  'ansvarig': 'assignee',
  'datum {d} d': 'dates {d} d',
  '… och {n} till': '… and {n} more',
  'Kontrollera uppdateringen': 'Check the update',
  '<b>{u}</b> uppdaterade, <b>{a}</b> nya, <b>{r}</b> borttagna, <b>{m}</b> med flyttade datum.': '<b>{u}</b> updated, <b>{a}</b> new, <b>{r}</b> removed, <b>{m}</b> with moved dates.',
  'Ändrat i NexusOrdo – skrivs över av Planner': 'Changed in NexusOrdo – overwritten by Planner',
  'markeras i planen': 'flagged in the plan',
  'Borttagna i Planner, med anteckningar eller beroenden här': 'Removed in Planner, with notes or dependencies here',
  'Uppdatera': 'Update',
  'Uppdatera ”{name}”': 'Update “{name}”',
  'ändrade': 'changed',
  'nya': 'new',
  'borttagna i Planner': 'removed in Planner',
  'med flyttade datum': 'with moved dates',
  'att kontrollera': 'to check',
  'ändringar här skrivs över': 'changes here overwritten',
  'Inget har ändrats i Planner sedan förra uppdateringen.': 'Nothing has changed in Planner since the last update.',
  'Ändrade': 'Changed',
  'Nya': 'New',
  'Borttagna i Planner': 'Removed in Planner',
  'har anteckningar eller beroenden här': 'has notes or dependencies here',
  'Behöver kontrolleras – markeras i planen': 'Needs checking – flagged in the plan',
  'Uppdatera ändå': 'Update anyway',
  'Saknar datum i filen – befintliga datum behålls': 'No date in the file – existing dates are kept',
  '{n} gater saknar datum i filen – deras befintliga datum behålls. Kontrollera att målen har datum i Planner.': '{n} gates have no date in the file – their existing dates are kept. Check that the goals have dates in Planner.',
  'Planners export på svenska och engelska fungerar. Saknar filen start- eller slutdatum, eller skulle många aktiviteter bli endagsaktiviteter eller tappa beroenden och gater, varnar NexusOrdo innan något sparas – välj <b>Avbryt</b> och exportera igen.': 'Planner exports in Swedish and English both work. If the file lacks start or end dates, or many activities would become one-day activities or lose dependencies and gates, NexusOrdo warns before anything is saved – choose <b>Cancel</b> and export again.',
  'Filen ser inte ut som planens tidigare export. Kontrollera innan du uppdaterar:': 'The file does not look like the plan\'s earlier export. Check before you update:',
  'Filen saknar kolumn för startdatum – aktiviteterna får samma start som slut.': 'The file has no start date column – activities get the same start as end.',
  'Filen saknar kolumn för slutdatum.': 'The file has no end date column.',
  '{n} av {m} aktiviteter blir endagsaktiviteter (start = slut).': '{n} of {m} activities become one-day activities (start = end).',
  '{n} av {m} aktiviteter känns inte igen och tas bort (anteckningar, dokument och utfall på dem försvinner).': '{n} of {m} activities are not recognised and are removed (their notes, documents and actuals are lost).',
  'Beroenden: {a} före, {b} efter.': 'Dependencies: {a} before, {b} after.',
  'Gaterna från Planner ({n}) försvinner.': 'The gates from Planner ({n}) disappear.',
  'Uppdatera planen': 'Update the plan',
  'Läser in {file}…': 'Reading {file}…',
  'Kunde inte läsa filen': 'Could not read the file',
  'OK': 'OK',
  '<b>Filen verkar gälla en annan plan</b> (”{name}”, annat plan-ID i Planner). Kontrollera att du valt rätt fil.': '<b>The file seems to belong to another plan</b> (“{name}”, different plan ID in Planner). Check that you chose the right file.',
  'Filens plannamn (”{name}”) skiljer sig från planens. Kontrollera att du valt rätt fil.': 'The plan name in the file (“{name}”) differs from this plan. Check that you chose the right file.',
  'Ingen ändring gjord': 'No changes made',
  'Uppdaterad: {c} ändrade, {a} nya, {m} flyttade': 'Updated: {c} changed, {a} new, {m} moved',
  ', {n} borttagna': ', {n} removed',
  ', {n} att kontrollera': ', {n} to check',
  '<b>{n}</b> aktiviteter i <b>{p}</b> faser': '<b>{n}</b> activities in <b>{p}</b> phases',
  ', <b>{n}</b> milstolpar': ', <b>{n}</b> milestones',
  ', <b>{n}</b> gater från Goals': ', <b>{n}</b> gates from Goals',
  '{n} saknar datum och visas under ”Ej schemalagda”.': '{n} have no dates and are shown under “Unscheduled”.',
  'Vid uppdatering behålls beroenden och anteckningar som lagts till här.': 'When updating, dependencies and notes added here are kept.',
  'Planen finns redan': 'The plan already exists',
  'Det finns redan en plan för <b>{name}</b>. Uppdatera den med den nya exporten?': 'There is already a plan for <b>{name}</b>. Update it with the new export?',
  'Skapa en kopia ändå': 'Create a copy anyway',
  'Det finns redan en plan för <b>{name}</b>, men den är inte delad med dig. Be den som äger planen om länken, så kan du uppdatera den i stället för att skapa en kopia.': 'There is already a plan for <b>{name}</b>, but it is not shared with you. Ask the plan owner for the link so you can update it instead of creating a copy.',
  'Skapa ny plan ändå': 'Create new plan anyway',
  'Importera ”{name}”': 'Import “{name}”',
  'Ingen befintlig plan har samma namn. Skapa en ny plan, eller uppdatera den öppna planen <b>{name}</b>?': 'No existing plan has the same name. Create a new plan, or update the open plan <b>{name}</b>?',
  'Uppdatera öppna planen': 'Update the open plan',
  'Skapa ny plan': 'Create new plan',
  'Uppdaterad: {a} nya, {u} uppdaterade, {m} flyttade': 'Updated: {a} new, {u} updated, {m} moved',
  'Plan skapad med {n} aktiviteter': 'Plan created with {n} activities',
  ' och {n} gater': ' and {n} gates',
  'Kopiera': 'Copy',
  'Kunde inte skapa plan: ': 'Could not create plan: ',
  'Övrigt': 'Other',
  'Ej schemalagda': 'Unscheduled',
  'Sparar…': 'Saving…',
  'Sparat lokalt ✓': 'Saved locally ✓',
  'Sparas inte': 'Not saved',
  'Kunde inte spara: ': 'Could not save: ',
  'Kunde inte spara programmet: ': 'Could not save the programme: ',
  'Program': 'Programme',
  'Planer': 'Plans',
  'Ingen plan': 'No plan',
  'Ny plan': 'New plan',
  'Namn på planen:': 'Plan name:',
  'Ny tidplan': 'New schedule',
  'Skapa': 'Create',
  'Byt namn': 'Rename',
  'Nytt namn:': 'New name:',
  'Ta bort plan?': 'Delete plan?',
  'Kunde inte ta bort: ': 'Could not delete: ',
  'Öppnade ”{name}”': 'Opened “{name}”',
  'Lägg till': 'Add',
  'Projektledare': 'Project manager',
  'Nytt program': 'New programme',
  'Namn på programmet, t.ex. Nytt kontor:': 'Programme name, e.g. New office:',
  'Kunde inte skapa programmet: ': 'Could not create the programme: ',
  'Byt namn på programmet': 'Rename the programme',
  'Ta bort programmet?': 'Delete the programme?',
  'Lägg till plan i programmet': 'Add plan to the programme',
  '”{name}” är tillagd i {prog}': '“{name}” has been added to {prog}',
  'Ta bort ur programmet?': 'Remove from the programme?',
  '<b>{name}</b> tas bort ur programmet. Själva planen påverkas inte.': '<b>{name}</b> will be removed from the programme. The plan itself is not affected.',
  'Planen': 'The plan',
  'till': 'to',
  'Programmet behöver minst två planer': 'The programme needs at least two plans',
  'Nytt beroende mellan projekt': 'New dependency between projects',
  'Föregångare – måste bli klar först': 'Predecessor – must be done first',
  'T.ex. Bygg: Lokalen klar': 'E.g. Construction: Premises ready',
  'Efterföljare – väntar på föregångaren': 'Successor – waits for the predecessor',
  'T.ex. Inflyttning: Möbler levererade': 'E.g. Move-in: Furniture delivered',
  'Typ': 'Type',
  'Fördröjning (dagar)': 'Lag (days)',
  'Motivering': 'Reason',
  'Vad behövs, och varför?': 'What is needed, and why?',
  'Skapa beroende': 'Create dependency',
  'Välj aktiviteter i två olika projekt – beroenden inom ett projekt hör hemma i projektets plan': 'Choose activities in two different projects – dependencies within a project belong in the project plan',
  'Välj en aktivitet på båda sidor': 'Choose an activity on both sides',
  'Beroende skapat': 'Dependency created',
  'Ta bort beroendet?': 'Delete the dependency?',
  'Beroendet tas bort ur programmet. Planerna påverkas inte.': 'The dependency will be removed from the programme. The plans are not affected.',
  'Aktiviteten finns inte längre': 'The activity no longer exists',
  'Beroenden mellan projekten': 'Dependencies between the projects',
  '+ Beroende': '+ Dependency',
  'Status': 'Status',
  'Föregångare': 'Predecessor',
  'Efterföljare': 'Successor',
  'Marginal': 'Margin',
  'start': 'start',
  'Inga beroenden ännu.': 'No dependencies yet.',
  'Skapa ett med <b>+ Beroende</b>, t.ex. att Inflyttning väntar på att Bygg blir klart.': 'Create one with <b>+ Dependency</b>, e.g. that Move-in waits for Construction to be finished. furnaces go.',
  'Planen finns inte längre': 'The plan no longer exists',
  'Den kan ha tagits bort eller importerats som ny plan.': 'It may have been deleted or imported as a new plan.',
  'Ta bort ur programmet': 'Remove from the programme',
  'aktiviteter': 'activities',
  'klart': 'done',
  'försenade': 'late',
  'försenade – visar bara dem': 'late – showing only these',
  'Visa bara försenade aktiviteter': 'Show only late activities',
  'Visa alla aktiviteter': 'Show all activities',
  'Klart i procent': 'Done in percent',
  'Klicka på nyckeltalet <b>försenade</b> för att bara visa försenade aktiviteter – klicka igen för att visa alla. <b>Klart</b> i panelen kan dras eller skrivas in som siffra.': 'Click the <b>late</b> key figure to show only late activities – click again to show all. <b>Done</b> in the panel can be dragged or typed as a number.',
  'Nytt: bara försenade': 'New: only late activities',
  'Klicka på nyckeltalet för att bara visa försenade aktiviteter. Klicka igen för att visa alla.': 'Click the key figure to show only late activities. Click again to show all.',
  'Nytt: skriv in % klart': 'New: type % done',
  'I panelen kan du nu skriva in hur klar en aktivitet är som en siffra, eller dra i reglaget som förut.': 'In the panel you can now type how done an activity is as a number, or drag the slider as before.',
  'Nästa gate:': 'Next gate:',
  'passerad': 'passed',
  'Inga kommande gater': 'No upcoming gates',
  'Senast importerad': 'Last imported',
  'Öppna plan': 'Open plan',
  '＋ Lägg till plan': '＋ Add plan',
  'Pågår': 'In progress',
  'Ej påbörjad': 'Not started',
  'Risk': 'Risk',
  'Blockerad': 'Blocked',
  'Saknas': 'Missing',
  'Slut → start': 'Finish → start',
  'Start → start': 'Start → start',
  'Slut → slut': 'Finish → finish',
  'Start → slut': 'Start → finish',
  'AKTIVITET': 'ACTIVITY',
  'START': 'START',
  'SLUT': 'END',
  'Roadmap': 'Roadmap',
  'Tidplan': 'Schedule',
  'uppdaterad': 'updated',
  'Kunde inte rendera bilden': 'Could not render the image',
  'tidplan': 'schedule',
  'Exportera bild': 'Export image',
  'Bilden passar för PowerPoint och e-post. Om nedladdningen inte startar: högerklicka på bilden och välj <b>Spara bild som</b> eller <b>Kopiera bild</b>.': 'The image works for PowerPoint and email. If the download does not start: right-click the image and choose <b>Save image as</b> or <b>Copy image</b>.',
  'Stäng': 'Close',
  'Ladda ner PNG': 'Download PNG',
  'Bilden öppnades i en ny flik. Högerklicka och välj Spara bild som': 'The image opened in a new tab. Right-click and choose Save image as',
  'Nedladdning blockeras här. Högerklicka på bilden och välj Spara bild som': 'Downloads are blocked here. Right-click the image and choose Save image as',
  'Bilden är kopierad – klistra in i PowerPoint': 'The image is copied – paste it into PowerPoint',
  'Kopiering blockerades – högerklicka på bilden och välj Kopiera bild': 'Copying was blocked – right-click the image and choose Copy image',
  'Kunde inte läsa checklistan': 'Could not read the checklist',
  'Gate-checklistan finns per plan – öppna en plan': 'The gate checklist is per plan – open a plan',
  '{a}/{b} klara': '{a}/{b} done',
  'Gäller inte projektet': 'Not applicable to the project',
  'Kommentar': 'Comment',
  'Gäller projektet': 'Applies to the project',
  'Gate-kriterier inför {gate}': 'Gate criteria for {gate}',
  'Ej OK': 'Not OK',
  'Alla': 'All',
  'Ej bedömda': 'Not assessed',
  'Gula och röda': 'Yellow and red',
  'Visa punkter som inte gäller': 'Show items that do not apply',
  'Inga punkter matchar filtret.': 'No items match the filter.',
  'Påverkar': 'Impact',
  'Kritiskt': 'Critical',
  'Leverabler för nästa fas kända och accepterade': 'Deliverables for the next phase known and accepted',
  'Resurser för nästa fas säkrade': 'Resources for the next phase secured',
  'Risker under kontroll': 'Risks under control',
  'Budget under kontroll': 'Budget under control',
  'Projektspecifika frågor lösta': 'Project-specific issues solved',
  'klara ({n} st)': 'done ({n})',
  '{gate}-beredskap': '{gate} readiness',
  'Nästa milstolpe': 'Next milestone',
  'Visa': 'Show',
  'fått datum {date}': 'got a date {date}',
  '{n} beroenden': '{n} dependencies',
  'Öppna risklistan': 'Open the risk list',
  'risker': 'risks',
  '{n} höga': '{n} high',
  '{n} försenade åtgärder': '{n} overdue actions',
  'Risklistan finns per plan – öppna en plan': 'The risk list is per plan – open a plan',
  'Risklista – {name}': 'Risk list – {name}',
  'Exportera Excel': 'Export Excel',
  'Topp 5 risker': 'Top 5 risks',
  '(utan beskrivning)': '(no description)',
  'Inga öppna risker ännu.': 'No open risks yet.',
  '{n} åtgärder försenade': '{n} actions overdue',
  '{n} ska vara klara inom två veckor': '{n} due within two weeks',
  'Klicka på en ruta för att filtrera': 'Click a cell to filter',
  'Sannolikhet': 'Probability',
  'Sannolikhet {p} × konsekvens {c} = {v}': 'Probability {p} × consequence {c} = {v}',
  'Konsekvens': 'Consequence',
  'Alla områden': 'All areas',
  'Alla statusar': 'All statuses',
  'Alla ansvariga': 'All responsible',
  'Visa stängda': 'Show closed',
  'Ruta {p}×{c} ✕': 'Cell {p}×{c} ✕',
  '{n} av {m} risker': '{n} of {m} risks',
  '+ Ny risk': '+ New risk',
  'Nr': 'No.',
  'Risk (Om … så …)': 'Risk (If … then …)',
  'Område': 'Area',
  'Värde': 'Value',
  'Förebyggande åtgärder': 'Preventive actions',
  'Konsekvensåtgärder': 'Consequence actions',
  'Klar senast': 'Ready (latest)',
  'Kopplad till': 'Linked to',
  'Om … så …': 'If … then …',
  'Vecka som ÅÅVV, t.ex. 2645 – eller 2645/2650 för förebyggande/konsekvens': 'Week as YYWW, e.g. 2645 – or 2645/2650 for preventive/consequence',
  'Öppna igen': 'Reopen',
  'Stäng risken': 'Close the risk',
  'Inga risker matchar filtret.': 'No risks match the filter.',
  'Inga risker ännu. Klicka + Ny risk.': 'No risks yet. Click + New risk.',
  'Risklistan är exporterad': 'The risk list has been exported',
  'Exporten öppnades i en ny flik': 'The export opened in a new tab',
  'Webbläsaren blockerade exporten': 'The browser blocked the export',
  'Risklista': 'Risk list',
  '<b>📊 Uppföljning → ⚠ Risklista…</b> eller nyckeltalet <b>⚠</b> öppnar risklistan.': '<b>📊 Follow-up → ⚠ Risk list…</b> or the <b>⚠</b> KPI opens the risk list.',
  'Beskriv risken som <b>Om … så …</b> och välj sannolikhet och konsekvens 1–5 – värdet räknas ut.': 'Describe the risk as <b>If … then …</b> and choose probability and consequence 1–5 – the value is calculated.',
  'Skriv förebyggande åtgärder och konsekvensåtgärder, ansvarig och <b>klar senast</b> som vecka (2645).': 'Enter preventive and consequence actions, responsible and <b>ready (latest)</b> as a week (2645).',
  'Nytt: risklista': 'New: risk list',
  '📊 Uppföljning → ⚠ Risklista… bygger på en vanlig riskanalys: sannolikhet × konsekvens, åtgärder och ansvarig.': '📊 Follow-up → ⚠ Risk list… is based on a standard risk analysis: probability × consequence, actions and responsible.',
  'Risker i nyckeltalen': 'Risks in the KPIs',
  '⚠ visar öppna risker, höga risker och försenade åtgärder. Klicka för att öppna listan.': '⚠ shows open risks, high risks and overdue actions. Click to open the list.',
  'Värde och status': 'Value and status',
  'Värdet är sannolikhet × konsekvens. Status (grön, gul, röd) sätter du själv.': 'The value is probability × consequence. You set the status (green, yellow, red) yourself.',
  'Riskmatris och topp 5': 'Risk matrix and top 5',
  'Klicka på en ruta i matrisen för att filtrera. Topp 5 går till statusrapporten.': 'Click a cell in the matrix to filter. The top 5 go to the status report.',
  '⚠ Risklista…': '⚠ Risk list…',
  'Mycket liten': 'Very small',
  'Liten': 'Small',
  'Medel': 'Medium',
  'Hög': 'High',
  'Mycket hög': 'Very high',
  'Stor': 'Big',
  'Mycket stor': 'Very big',
  'Grön – OK': 'Green – OK',
  'Gul – pågår': 'Yellow – in progress',
  'Röd – inte OK': 'Red – not OK',
  'klar': 'done',
  'Grön': 'Green',
  'Gul': 'Yellow',
  'Röd': 'Red',
  'Ja': 'Yes',
  'Plan': 'Plan',
  'Styrgrupp': 'Steering committee',
  'Total hälsa': 'Total health',
  'Utfall': 'Actual',
  'plan': 'plan',
  'utfall': 'actual',
  '{n} projekt': '{n} projects',
  "🏷 Projektuppgifter": "🏷 Project data",
  "Projektuppgifter": "Project data",
  "Projektuppgifter finns per plan – öppna en plan": "Project data is per plan – open a plan",
  "Projektuppgifter – {name}": "Project data – {name}",
  "Projektuppgifterna är sparade": "Project data saved",
  "Gate": "Gate",
  "🏷 Projektuppgifter…": "🏷 Project data…",
  'Veckor': 'Weeks',
  'ÅÅVV': 'YYWW',
  'Vecka som ÅÅVV, t.ex. 2645': 'Week as YYWW, e.g. 2645',
  'Okänd vecka: {v}. Skriv ÅÅVV, t.ex. 2645': 'Unknown week: {v}. Enter YYWW, e.g. 2645',
  '{n} dagar sen': '{n} days ago',
  'idag': 'today',
  'om {n} dagar': 'in {n} days',
  '+ Aktivitet': '+ Activity',
  '＋ Ny fas…': '＋ New phase…',
  'Namn på ny fas': 'Name of new phase',
  'Kunde inte läsa planerna ({msg}).': 'Could not read the plans ({msg}).',
  'Något gick fel: ': 'Something went wrong: ',
  'okänt fel': 'unknown error',
  'Kunde inte starta: ': 'Could not start: ',
  'Välj plan': 'Choose plan',
  'Hantera plan': 'Manage plan',
  'Ny tom plan': 'New empty plan',
  '☑ Gate-checklista…': '☑ Gate checklist…',
  'Skapa exempelplan': 'Create sample plan',
  'Nytt program…': 'New programme…',
  'Ta bort plan': 'Delete plan',
  'Översikt': 'Overview',
  'Ångra (Ctrl+Z)': 'Undo (Ctrl+Z)',
  'Uppdatera den öppna planen': 'Update the open plan',
  '⟳ Uppdatera ▾': '⟳ Update ▾',
  'Uppdatera från Excel…': 'Update from Excel…',
  'Jämför med planen och visar ändringarna – skapar ingen ny plan': 'Compares with the plan and shows the changes – does not create a new plan',
  'Byt tema': 'Change theme',
  'Sök aktivitet eller person…': 'Search activity or person…',
  'Dölj klara': 'Hide done',
  'Bara blockerade': 'Only blocked',
  'Vecka': 'Week',
  'Månad': 'Month',
  'Kvartal': 'Quarter',
  'Aktiviteter': 'Activities',
  'Aktivitet': 'Activity',
  'Skapa en tidplan från Planner': 'Create a schedule from Planner',
  'Exportera planen i Planner (<b>⋯ → Exportera plan till Excel</b>) och dra in filen här, eller välj den med knappen.': 'Export the plan in Planner (<b>⋯ → Export plan to Excel</b>) and drop the file here, or choose it with the button.',
  'Välj Excel-fil': 'Choose Excel file',
  'Visa exempelplan': 'Show sample plan',
  'Släpp Planner-exporten här': 'Drop the Planner export here',
  "Exportera planen till Excel i Planner och läs in den med <b>+ Ny plan / Importera…</b> i planväljaren.": "Export the plan to Excel in Planner and load it with <b>+ New plan / Import…</b> in the plan picker.",
  "Faser är färgade rader, ◆ är gater och milstolpar, pilar är beroenden.": "Phases are coloured rows, ◆ are gates and milestones, arrows are dependencies.",
  "Dra staplar eller klicka på en aktivitet för att ändra – datum kan skrivas som vecka (2645).": "Drag bars or click an activity to edit – dates can be entered as a week (2645).",
  "<b>⟳ Uppdatera → Uppdatera från Excel</b> visar vad som ändrats i Planner innan något sparas.": "<b>⟳ Update → Update from Excel</b> shows what changed in Planner before anything is saved.",
  "Ett program samlar flera projekts planer och visar beroenden mellan dem.": "A programme brings several projects' plans together and shows dependencies between them.",
  "<b>Exportera bild</b> ger en bild för PowerPoint och e-post.": "<b>Export image</b> gives a picture for PowerPoint and e-mail.",
  "Faser, milstolpar och beroenden som i MS Project – men utan automatisk schemaläggning.": "Phases, milestones and dependencies as in MS Project – but without automatic scheduling.",
  "Svar på det som oftast undras.": "Answers to the most common questions.",
  "Dina planer": "Your plans",
  "Importera från Planner": "Import from Planner",
  "Exportera planen till Excel i Planner och välj + Ny plan / Importera… sist i planväljaren. Faser och gater känns igen automatiskt.": "Export the plan to Excel in Planner and choose + New plan / Import… at the bottom of the plan picker. Phases and gates are recognised automatically.",
  "Har planen ändrats i Planner? Läs in en ny export – du ser vad som ändrats innan något sparas.": "Has the plan changed in Planner? Load a new export – you see what changed before anything is saved.",
  "Vyer": "Views",
  "Nyckeltal": "Key figures",
  "Andel klart, försenade, beredskap inför nästa gate och nästa milstolpe – klicka på ☑ för gate-checklistan.": "Share done, late, readiness for the next gate and next milestone – click ☑ for the gate checklist.",
  "Hjälp när du vill": "Help when you need it",
  "Här kör du rundturer igen, ser vad som är nytt och öppnar hjälpcentret.": "Run tours again, see what's new and open the help centre here.",
  "Gantt-vyn": "Gantt view",
  "Faser": "Phases",
  "Varje fas är en färgad rad. Klicka för att fälla ihop eller ut.": "Each phase is a coloured row. Click to collapse or expand.",
  "Flytta och ändra": "Move and resize",
  "Klicka på en aktivitet. Datum kan skrivas som vecka, t.ex. 2645.": "Click an activity. Dates can be entered as a week, e.g. 2645.",
  "Skala": "Scale",
  "Byt mellan vecka, månad och kvartal. Idag visar dagens datum.": "Switch between week, month and quarter. Today shows today's date.",
  "Välj gate": "Choose gate",
  "En flik per gate med andel klart och antal röda.": "One tab per gate with share done and number of reds.",
  "Bedöm punkten": "Assess the item",
  "Klart, Påverkar (tid, pengar eller resurser) eller Kritiskt. ＋ ger en kommentar, ⊘ betyder att punkten inte gäller.": "Done, Impact (time, money or resources) or Critical. ＋ adds a comment, ⊘ means the item does not apply.",
  "Underlag till styrgruppen": "Input for the steering committee",
  "Gula och röda visar det som behöver tas upp vid gaten.": "Yellow and red shows what needs to be raised at the gate.",
  "Välj grupper": "Choose groups",
  "Kryssa i PMI-projektmallen.": "Tick the PMI project template.",
  "Gate-veckor": "Gate weeks",
  "Antal aktiviteter per fas. Inget skapas förrän du klickar på knappen.": "Number of activities per phase. Nothing is created until you click the button.",
  "Projekten": "The projects",
  "Fas, andel klart, försenade och nästa gate per projekt.": "Phase, share done, late and next gate per project.",
  "Översikt och Gantt": "Overview and Gantt",
  "Beroenden": "Dependencies",
  "Beroenden mellan projekten med status: OK, risk eller blockerad.": "Dependencies between projects with status: OK, risk or blocked.",
  "Beredskap": "Readiness",
  "Veckor ÅÅVV": "Weeks YYWW",
  "Nytt: veckor": "New: weeks",
  "Datum visas och kan skrivas som vecka, t.ex. 2645 = vecka 45 2026.": "Dates are shown and can be entered as a week, e.g. 2645 = week 45 2026.",
  "Nyckeltalet visar veckan för nästa milstolpe.": "The key figure shows the week of the next milestone.",
  "Hoppa över": "Skip",
  "Tillbaka": "Back",
  "Nästa": "Next",
  "Ny i NexusOrdo?": "New to NexusOrdo?",
  "Ta rundturen (1 min)": "Take the tour (1 min)",
  "Visa rundtur för {page}?": "Show a tour of {page}?",
  "Visa": "Show",
  "Nej tack": "No thanks",
  "Rundtur för den här sidan": "Tour of this page",
  "Nytt": "New",
  "Hjälp och rundturer": "Help and tours",
  'Öppna veckostatus': 'Open weekly status',
  'Status v{w}': 'Status W{w}',
  'Senast v{w} – ej rapporterad denna vecka': 'Last W{w} – not reported this week',
  'Veckostatus ej rapporterad': 'Weekly status not reported',
  'Veckostatus v{w}': 'Weekly status W{w}',
  'Veckostatus finns per plan – öppna en plan': 'Weekly status is per plan – open a plan',
  'Veckostatus – {name}': 'Weekly status – {name}',
  'Kopiera som text': 'Copy as text',
  'Kopiera från förra veckan': 'Copy from last week',
  'Nästa gate: {g}': 'Next gate: {g}',
  'Förslag: {v}': 'Suggestion: {v}',
  'Använd': 'Use',
  'Ekonomi (MSEK)': 'Finance (MSEK)',
  'Grön inom anslag, gul 0,1–5 % över, röd mer än 5 % över': 'Green within request, yellow 0.1–5% over, red more than 5% over',
  'Anslag': 'Request',
  'Prognos': 'Forecast',
  'Total projekthälsa': 'Overall project health',
  'Projektledarens förslag – fastställs av styrgruppen': 'Project manager’s proposal – set by the steering committee',
  'sämsta dimensionen': 'worst dimension',
  'Åtgärder för att säkra projektets hälsa': 'Actions to secure project health',
  'Lägg till åtgärder för gula och röda dimensioner: {d}': 'Add actions for yellow and red dimensions: {d}',
  'Pågående': 'Ongoing',
  'Planerad': 'Planned',
  'Åtgärd': 'Action',
  '+ Åtgärd': '+ Action',
  'Sammanfattning för veckan': 'Summary for the week',
  'Inga risker ännu.': 'No risks yet.',
  'Gate-kriterier inför {g}': 'Gate criteria for {g}',
  'Gate-kriterier': 'Gate criteria',
  'Ingen kommande gate i planen.': 'No upcoming gate in the plan.',
  'Historik': 'History',
  'Totalt': 'Overall',
  'Historiken byggs upp vecka för vecka.': 'The history builds up week by week.',
  'Ingen tidigare vecka att kopiera': 'No earlier week to copy',
  'Kopierade v{w}': 'Copied W{w}',
  'Veckostatus': 'Weekly status',
  'vecka': 'week',
  'Pågående åtgärder': 'Ongoing actions',
  'Planerade åtgärder': 'Planned actions',
  'Statusen är kopierad – klistra in i Teams eller e-post': 'Status copied – paste into Teams or e-mail',
  'Kopiera statusen': 'Copy the status',
  'Markera texten och kopiera (Ctrl+C).': 'Select the text and copy (Ctrl+C).',
  'Statusen är exporterad': 'Status exported',
  '<b>📊 Uppföljning → 🚦 Veckostatus…</b> eller nyckeltalet <b>🚦</b> öppnar veckans status.': '<b>📊 Follow-up → 🚦 Weekly status…</b> or the <b>🚦</b> key figure opens this week’s status.',
  'Lägg till åtgärder för gula och röda dimensioner. Total projekthälsa är ditt förslag – styrgruppen fastställer den.': 'Add actions for yellow and red dimensions. Overall project health is your proposal – the steering committee sets it.',
  '<b>Kopiera från förra veckan</b> sparar tid. Historiken visar de senaste tolv veckorna. <b>Kopiera som text</b> passar Teams och e-post.': '<b>Copy from last week</b> saves time. The history shows the last twelve weeks. <b>Copy as text</b> suits Teams and e-mail.',
  'Nytt: veckostatus': 'New: weekly status',
  'Klicka på 🚦 eller välj 📊 Uppföljning → 🚦 Veckostatus… för veckans status.': 'Click 🚦 or choose 📊 Follow-up → 🚦 Weekly status… for this week’s status.',
  'Dimensioner och förslag': 'Dimensions and suggestions',
  'Grön, gul eller röd per dimension. Förslagen kommer från milstolpetrenden, risklistan och gate-checklistan – klicka Använd om du håller med.': 'Green, yellow or red per dimension. Suggestions come from the milestone trend, risk list and gate checklist – click Use if you agree.',
  'De senaste tolv veckorna per dimension. Klicka på en vecka för att se eller ändra den.': 'The last twelve weeks per dimension. Click a week to view or change it.',
  '🚦 Veckostatus…': '🚦 Weekly status…',
  'Målstyrning': 'Goal Management',
  'Personal och resurser': 'Human Resources',
  'Fasleverabler': 'Phase Deliverables',
  'Riskhantering': 'Risk Management',
  'Teknisk framdrift': 'Technical Progress',
  'Miljö': 'Environment',
  'Är målen och effektmålen tydliga och fortfarande giltiga?': 'Are the goals and end effects clear and still valid?',
  'Håller prognosen sig inom anslaget?': 'Is the forecast within the request?',
  'Har vi rätt personer och tid för fasen?': 'Do we have the right people and time for the phase?',
  'Blir leverablerna inför nästa gate klara?': 'Will the deliverables for the next gate be ready?',
  'Följer vi tidplanen? Finns kritisk linje?': 'Are we following the time plan? Is there a critical path?',
  'Är risklistan uppdaterad och åtgärderna i tid?': 'Is the risk list up to date and are actions on time?',
  'Når lösningen förväntad teknisk kvalitet?': 'Does the solution reach the expected technical quality?',
  'Är intressenter och linjen informerade?': 'Are stakeholders and the line organisation informed?',
  'Är ergonomin bedömd och hanterad?': 'Is ergonomics assessed and handled?',
  'Är säkerhetsriskerna kända och hanterade?': 'Are safety risks known and handled?',
  'Är miljöpåverkan screenad och godkänd?': 'Is the environmental impact screened and approved?',
  'Gater flyttade ≥ 4 v: {n}': 'Gates moved ≥ 4 w: {n}',
  'Gater flyttade 1–3 v: {n}': 'Gates moved 1–3 w: {n}',
  'Försenade aktiviteter: {n}': 'Late activities: {n}',
  'Inga gater flyttade och inga försenade aktiviteter': 'No gates moved and no late activities',
  'Ingen risklista': 'No risk list',
  'Höga risker: {n}': 'High risks: {n}',
  'Försenade riskåtgärder: {n}': 'Overdue risk actions: {n}',
  'Inga höga risker eller försenade åtgärder': 'No high risks or overdue actions',
  'Kritiska punkter i gate-checklistan: {n}': 'Critical items in the gate checklist: {n}',
  'Punkter som påverkar i gate-checklistan: {n}': 'Items with impact in the gate checklist: {n}',
  'Inga gula eller röda punkter i gate-checklistan': 'No yellow or red items in the gate checklist',
  'Prognos mot anslag': 'Forecast against request',
  'Ekonomi': 'Finance',
  'Kommunikation': 'Communication',
  'Ergonomi': 'Ergonomics',
  'Säkerhet': 'Safety',
  // #66 gatens status från Planner, #55 utfall, #57 export av portföljen
  'Inte påbörjad': 'Not started',
  'I fas': 'On track',
  'I riskzonen': 'At risk',
  'Ur fas': 'Off track',
  'Gater ur fas i Planner: {n}': 'Gates off track in Planner: {n}',
  'Gater i riskzonen i Planner: {n}': 'Gates at risk in Planner: {n}',
  'Status i Planner': 'Status in Planner',
  'Status i Planner: {s}': 'Status in Planner: {s}',
  'status {a} → {b}': 'status {a} → {b}',
  'Utfall (vecka)': 'Actual (week)',
  'Veckan då gaten passerades, t.ex. 2645': 'The week the gate was passed, e.g. 2645',
  'Rensa': 'Clear',
  'från Planner (klar)': 'from Planner (done)',
  'satt i NexusOrdo': 'set in NexusOrdo',
  'Gaten är inte passerad': 'The gate has not been passed',
  'Utfall föreslås': 'Suggested actuals',
  'gater som är klara i Planner men saknar utfallsvecka i NexusOrdo': 'gates that are done in Planner but have no actual week in NexusOrdo',
  'Utfall (ÅÅVV)': 'Actual (YYWW)',
  'Sätt utfall för {name}': 'Set actual for {name}',
  'Ange veckan som ÅÅVV, t.ex. {w}': 'Enter the week as YYWW, e.g. {w}',
  '{gate} passerad vecka {w}': '{gate} passed week {w}',
  'Rensa utfall': 'Clear actual',
  'Markera gate passerad…': 'Mark gate passed…',
  '{gate} markerad som passerad vecka {w}': '{gate} marked as passed week {w}',
  'planen': 'plan',
  'Ny': 'New',
  'Exportera': 'Export',
  'Gater som blivit klara i Planner utan utfall i NexusOrdo visas under <b>Utfall föreslås</b>: kontrollera veckan (ÅÅVV) och kryssa i de gater som ska få utfall. Gatens status i Planner (I fas, I riskzonen, Ur fas, Klar) följer med: gul kant = i riskzonen, röd kant = ur fas, fylld = klar.': 'Gates that became done in Planner without an actual in NexusOrdo are listed under <b>Suggested actuals</b>: check the week (YYWW) and tick the gates that should get an actual. The gate status in Planner (On track, At risk, Off track, Done) is imported: yellow edge = at risk, red edge = off track, filled = done.',
  'Gatens status från Planner': 'Gate status from Planner',
  'Nytt: gatens status': 'New: gate status',
  'Status på gaterna i Planner (Goals) följer med vid import: gul kant = i riskzonen, röd kant = ur fas, fylld romb = klar. Håll musen över gaten för status.': 'The status of the gates in Planner (Goals) is imported: yellow edge = at risk, red edge = off track, filled diamond = done. Hover over the gate for the status.',
  'Förslag i veckostatus': 'Suggestions in weekly status',
  'Gater ur fas ger förslaget röd tidplan i veckostatus, gater i riskzonen gul.': 'Gates off track suggest a red time plan in the weekly status, gates at risk yellow.',
  'Gate passerad – utfall': 'Gate passed – actual',
  'Nytt: utfall föreslås': 'New: suggested actuals',
  'När en gate blivit klar i Planner föreslår uppdateringen en utfallsvecka – kontrollera veckan och kryssa i.': 'When a gate is done in Planner, the update suggests an actual week – check the week and tick it.',
  'Markera gate passerad': 'Mark gate passed',
  // Hjälpcenter (#68)
  "Planera": "Plan",
  "Följa upp": "Follow up",
  "Kunskapsbank": "Knowledge base",
  "Rundturer och hjälp": "Tours and help",
  "<b>?</b> uppe till höger startar rundturer, visar vad som är nytt och öppnar hjälpcentret.": "<b>?</b> at the top right starts tours, shows what is new and opens the help centre.",
  "<b>▶ Kom igång</b> är en kort rundtur genom de viktigaste knapparna. <b>Rundtur för den här sidan</b> visar sidan du står på.": "<b>▶ Getting started</b> is a short tour of the most important buttons. <b>Tour of this page</b> shows the page you are on.",
  "Under <b>Nytt</b> finns en rundtur för varje ny funktion. En prick på ?-knappen betyder att något är nytt de senaste två veckorna.": "Under <b>New</b> there is a tour for every new feature. A dot on the ? button means something is new in the last two weeks.",
  "I hjälpcentret söker du i alla artiklar. Artiklar med <b>▶ Visa rundtur</b> visar funktionen på riktigt.": "In the help centre you search all articles. Articles with <b>▶ Show tour</b> show the feature for real.",
  "Länka direkt till en artikel med <b>&help=</b> och artikelns namn i länken, t.ex. <b>&help=risklista</b>.": "Link directly to an article with <b>&help=</b> and the article name in the link, e.g. <b>&help=risklista</b>.",
  "<b>Roadmap</b> visar en översikt per fas – bra i presentationer.": "<b>Roadmap</b> shows an overview per phase – good for presentations.",
  "Datum kan skrivas och visas som vecka: <b>2645</b> = vecka 45 2026.": "Dates can be entered and shown as a week: <b>2645</b> = week 45 2026.",
  "Det går också att skriva 26-45, v45 eller v45 2026.": "You can also type 26-45, v45 or v45 2026.",
  "Veckan visas i tooltip, panelen, nyckeltalet nästa milstolpe, programöversikten och gate-checklistan.": "The week is shown in the tooltip, the panel, the next milestone KPI, the programme overview and the gate checklist.",
  "Pilar visar vad som måste vara klart först – NexusOrdo varnar men flyttar aldrig datum.": "Arrows show what must be done first – NexusOrdo warns but never moves dates.",
  "Klicka på en aktivitet och välj under <b>Beroenden</b> vilka aktiviteter som måste vara klara först.": "Click an activity and choose under <b>Dependencies</b> which activities must be done first.",
  "En röd pil betyder att ordningen inte går ihop: aktiviteten börjar innan den föregående är klar.": "A red arrow means the order does not add up: the activity starts before the previous one is done.",
  "Beroenden från Planner följer med vid import och finns kvar när planen uppdateras.": "Dependencies from Planner come along on import and are kept when the plan is updated.",
  "Beroenden mellan projekt visas i programvyn.": "Dependencies between projects are shown in the programme view.",
  "Länka dokument från SharePoint till en aktivitet – bara länken sparas.": "Link documents from SharePoint to an activity – only the link is saved.",
  "Gate-milstolpens panel visar alla dokument i fasen.": "The gate milestone panel shows all documents in the phase.",
  "Utfall är veckan då en gate faktiskt passerades – plan och utfall visas sida vid sida.": "The actual is the week a gate was actually passed – plan and actual are shown side by side.",
  "Status på gaterna i Planner följer med vid import och syns på gatens romb.": "The status of the gates in Planner comes along on import and is shown on the gate diamond.",
  "Hur gaterna har flyttats mellan uppdateringarna – en stigande linje betyder att milstolpen skjutits fram.": "How the gates have moved between updates – a rising line means the milestone has been pushed back.",
  "En ögonblicksbild sparas vid import och vid varje uppdatering från Excel. <b>Spara ögonblicksbild</b> sparar en direkt.": "A snapshot is saved on import and on every update from Excel. <b>Save snapshot</b> saves one right away.",
  "Var kommer planen ifrån?": "Where does the plan come from?",
  "Varje plan har en källa som äger datumen – NexusOrdo visar och analyserar.": "Every plan has a source that owns the dates – NexusOrdo shows and analyses.",
  "<b>NexusOrdo</b> är källan för planer som skapats här, till exempel från en mall eller som tom plan. Där ändrar du direkt i Gantt-vyn.": "<b>NexusOrdo</b> is the source for plans created here, for example from a template or as an empty plan. You change them directly in the Gantt view.",
  "Ändringar i NexusOrdo går inte tillbaka till Planner. Ändra datum i Planner för Planner-planer – annars skrivs de över vid nästa uppdatering.": "Changes in NexusOrdo do not go back to Planner. Change dates in Planner for Planner plans – otherwise they are overwritten at the next update.",
  "Ordlista": "Glossary",
  "Ord och tecken som används i NexusOrdo.": "Words and symbols used in NexusOrdo.",
  "<b>ÅÅVV</b> – år och vecka, t.ex. 2645 = vecka 45 2026. Start är måndag, slut fredag.": "<b>YYWW</b> – year and week, e.g. 2645 = week 45 2026. Start is Monday, end is Friday.",
  "<b>Utfall</b> – veckan då gaten faktiskt passerades. Plan = ofylld romb ◇, utfall = fylld ◆.": "<b>Actual</b> – the week the gate was actually passed. Plan = hollow diamond ◇, actual = filled ◆.",
  "<b>? Kontrollera</b> – aktiviteten kunde inte matchas säkert vid import.": "<b>? Check</b> – the activity could not be matched reliably on import.",
  "Hjälpcenter": "Help centre",
  "Sök i hjälpen…": "Search help…",
  "Inga träffar för ”{q}”. Prova ett annat ord, t.ex. gate, risk eller vecka.": "No matches for “{q}”. Try another word, e.g. gate, risk or week.",
  "Visa rundtur": "Show tour",
  "Hjälp för den här sidan": "Help for this page",
  "Nytt: hjälpcenter": "New: help centre",
  "Sök": "Search",
  "Hjälpcentret öppnas från ? → 📖 Hjälpcenter: välj ämne i menyn till vänster och läs en artikel i taget.": "The help centre opens from ? → 📖 Help centre: pick a topic in the menu on the left and read one article at a time.",
  "Skriv ett ord, t.ex. risk eller vecka. Enter öppnar första träffen.": "Type a word, e.g. risk or week. Enter opens the first match.",
  "Många artiklar har ▶ Visa rundtur som visar funktionen på riktigt. ? → Hjälp för den här sidan öppnar rätt artikel direkt.": "Many articles have ▶ Show tour, which shows the feature for real. ? → Help for this page opens the right article directly.",  // Checklista på aktiviteter (#71)
  'checklista +{a} −{r}': 'checklist +{a} −{r}',
  'Deluppgifter klara': 'Subtasks done',
  'alla punkter klara': 'all items done',
  'Alla punkter i checklistan är klara – markera aktiviteten som klar?': 'All checklist items are done – mark the activity as done?',
  '{d} av {n} punkter klara': '{d} of {n} items done',
  'Planner: {d} av {n} klara': 'Planner: {d} of {n} done',
  'uppdatera planen från Excel för att få punkterna': 'update the plan from Excel to get the items',
  'Ny punkt…': 'New item…',
  '+ Lägg till': '+ Add',
  'Bockar du av här förs det inte över till Planner – gör det där också om planen uppdateras från Planner.': 'Ticks here are not copied to Planner – tick there too if the plan is updated from Planner.',
  'Namn, datum och status skrivs över vid nästa import från Planner. Beroenden, anteckningar, dokument och bockar i checklistan behålls.': 'Name, dates and status are overwritten at the next import from Planner. Dependencies, notes, documents and checklist ticks are kept.',
  'Klar: {text}': 'Done: {text}',
  'Tillagd i NexusOrdo': 'Added in NexusOrdo',
  'Inga punkter': 'No items',
  'Punkten finns redan': 'The item already exists',
  'Bara aktiviteter där alla punkter i checklistan är klara men aktiviteten inte är det': 'Only activities where all checklist items are done but the activity is not',
  '☑ Checklista klar': '☑ Checklist done',
  'behålls: {text}': 'kept: {text}',
  'Checklista på aktiviteter': 'Checklist on activities',
  'Deluppgifter på en aktivitet – från Planner eller egna – som du bockar av i NexusOrdo.': 'Subtasks on an activity – from Planner or your own – that you tick off in NexusOrdo.',
  'Planners checklista följer med när planen importeras eller uppdateras från Excel. Har planen importerats tidigare: <b>⟳ Uppdatera → Uppdatera från Excel…</b> en gång så kommer punkterna.': 'The Planner checklist comes along when the plan is imported or updated from Excel. If the plan was imported earlier: <b>⟳ Update → Update from Excel…</b> once and the items appear.',
  '<b>Checklista</b> i panelen: bocka av, lägg till, ändra text (klicka på texten), ta bort och flytta upp eller ner. Ändringarna sparas med <b>Spara</b> och går att ångra.': '<b>Checklist</b> in the panel: tick off, add, edit text (click the text), delete and move up or down. Changes are saved with <b>Save</b> and can be undone.',
  'Aktiviteten får <b>☑ 2/3</b> i Gantt-vyn, listan och tooltip. Grön betyder att alla punkter är klara men att aktiviteten inte är markerad klar – filtret <b>☑ Checklista klar</b> visar bara dem.': 'The activity gets <b>☑ 2/3</b> in the Gantt view, the list and the tooltip. Green means all items are done but the activity is not marked done – the <b>☑ Checklist done</b> filter shows only those.',
  'Planners export säger bara hur många punkter som är klara, inte vilka. Därför är punkterna obockade första gången och räknaren visas som <b>Planner: 2 av 3 klara</b>.': 'The Planner export only says how many items are done, not which. So the items are unticked the first time and the counter is shown as <b>Planner: 2 of 3 done</b>.',
  'Vid uppdatering behålls dina bockar och punkter du lagt till. Nya punkter i Planner läggs till. En punkt som tagits bort i Planner tas bort bara om den inte är bockad eller ändrad här – annars behålls den och visas i förhandsvisningen.': 'On update your ticks and the items you added are kept. New items in Planner are added. An item removed in Planner is only removed if it is not ticked or edited here – otherwise it is kept and shown in the preview.',
  'NexusOrdo skriver inte till Planner – bockar du av här, gör det i Planner också om planen fortsätter att uppdateras därifrån.': 'NexusOrdo does not write to Planner – if you tick here, do it in Planner too if the plan keeps being updated from there.',
  'Punkterna följer med i <b>Exportera plan (Excel)</b> och i den lokala versionen.': 'The items come along in <b>Export plan (Excel)</b> and in the local version.',
  'Nytt: checklista': 'New: checklist',
  'Öppna en plan och klicka på en aktivitet för att se och bocka av dess checklista.': 'Open a plan and click an activity to see and tick off its checklist.',
  'Planners checklista visas i panelen. Bocka av, lägg till egna punkter och spara – bockarna finns kvar när planen uppdateras från Planner.': 'The Planner checklist is shown in the panel. Tick off, add your own items and save – the ticks stay when the plan is updated from Planner.',
  'Egna punkter': 'Your own items',
  'Skriv en ny punkt och tryck Enter. Klicka på en text för att ändra den.': 'Type a new item and press Enter. Click a text to edit it.',
  '☑ i Gantt-vyn': '☑ in the Gantt view',
  'Aktiviteter med checklista får ☑ 2/3. Grön = alla punkter klara men aktiviteten inte markerad klar.': 'Activities with a checklist get ☑ 2/3. Green = all items done but the activity not marked done.',
  'Få punkterna från Planner': 'Get the items from Planner',
  'Planer som importerats tidigare får punkterna med ⟳ Uppdatera → Uppdatera från Excel… en gång.': 'Plans imported earlier get the items with ⟳ Update → Update from Excel… once.',
  'Ändrade checklistor': 'Changed checklists',
  '”Behålls” = punkten finns inte längre i Planner men är bockad eller ändrad i NexusOrdo. Ta bort den i panelen om den inte behövs.': '“Kept” = the item is no longer in Planner but is ticked or edited in NexusOrdo. Delete it in the panel if it is not needed.',
  'Beroenden, anteckningar och bockar i checklistan som lagts till i NexusOrdo behålls. Ångra går att använda efteråt.': 'Dependencies, notes and checklist ticks added in NexusOrdo are kept. Undo can be used afterwards.',
  // Versioner och papperskorg (#76)
  "Planen ligger i papperskorgen": "The plan is in the recycle bin",
  "<b>{name}</b> togs bort {d} och ligger i papperskorgen.": "<b>{name}</b> was deleted {d} and is in the recycle bin.",
  "Återställ och uppdatera": "Restore and update",
  "Planen <b>{name}</b> flyttas till papperskorgen. Du kan återställa den i {n} dagar (⋯ → 🗑 Papperskorg…). Uppgifterna i Planner påverkas inte.": "The plan <b>{name}</b> is moved to the recycle bin. You can restore it for {n} days (⋯ → 🗑 Recycle bin…). The tasks in Planner are not affected.",
  "”{name}” ligger i papperskorgen": "“{name}” is in the recycle bin",
  "Programmet <b>{name}</b> flyttas till papperskorgen. Du kan återställa det i {n} dagar (⋯ → 🗑 Papperskorg…). Projektens planer påverkas inte.": "The programme <b>{name}</b> is moved to the recycle bin. You can restore it for {n} days (⋯ → 🗑 Recycle bin…). The projects' plans are not affected.",
  "Kunde inte spara versionen: ": "Could not save the version: ",
  "beroenden": "dependencies",
  "veckor med status": "weeks with status",
  "svar i gate-checklistan": "gate checklist answers",
  "planer": "plans",
  "programgater": "programme gates",
  "Versionen från {d} jämfört med nu": "The version from {d} compared with now",
  "Versionen": "Version",
  "Nu": "Now",
  "Namn: ”{a}” → nu ”{b}”": "Name: “{a}” → now “{b}”",
  "Finns bara i versionen – kommer tillbaka": "Only in the version – comes back",
  "Finns bara nu – försvinner vid återställning": "Only now – removed on restore",
  "Ändrade (namn, datum, fas eller % klart)": "Changed (name, dates, phase or % complete)",
  "Ingen skillnad i aktiviteter och antal.": "No difference in tasks and counts.",
  "Kunde inte läsa versionerna: ": "Could not read the versions: ",
  "{p} planer · {d} beroenden": "{p} plans · {d} dependencies",
  "{t} akt. · {r} risker · {d} ber.": "{t} tasks · {r} risks · {d} deps",
  "okänd (länk)": "unknown (link)",
  "Jämför": "Compare",
  "Återställ": "Restore",
  "Versioner av ”{name}”": "Versions of “{name}”",
  "En version sparas automatiskt före varje uppdatering från Excel, import ovanpå, borttagning och återställning, och en gång per dag när den ändras.": "A version is saved automatically before every update from Excel, import on top, deletion and restore, and once a day when it changes.",
  "Versionerna finns bara i den här webbläsarens arbetskopia (högst {n} per plan). Spara till fil med ⋯ → 💾 Spara för en säker kopia.": "The versions exist only in this browser's working copy (at most {n} per plan). Save to file with ⋯ → 💾 Save for a safe copy.",
  "Orsak": "Reason",
  "Vem": "Who",
  "Innehåll": "Content",
  "Inga versioner ännu.": "No versions yet.",
  "Spara version nu": "Save version now",
  "Versionen är sparad": "The version is saved",
  "Återställ versionen?": "Restore the version?",
  "<b>{name}</b> återställs till versionen från {d} ({why}).": "<b>{name}</b> is restored to the version from {d} ({why}).",
  "Återställningen avbröts – nuvarande läge kunde inte sparas som version.": "The restore was cancelled – the current state could not be saved as a version.",
  "Versionen från {d} är återställd. Ångra med 🕘 Versioner → ”Före återställning”.": "The version from {d} is restored. Undo with 🕘 Versions → “Before restore”.",
  "version": "version",
  "Versionen är exporterad": "The version is exported",
  "Kunde inte återställa: ": "Could not restore: ",
  "{n} dag kvar": "{n} day left",
  "{n} dagar kvar": "{n} days left",
  "äldre än {n} dagar": "older than {n} days",
  "{p} planer": "{p} plans",
  "{t} akt. · {r} risker": "{t} tasks · {r} risks",
  "🗑 Papperskorg": "🗑 Recycle bin",
  "Borttagen": "Deleted",
  "Av": "By",
  "Papperskorgen är tom.": "The recycle bin is empty.",
  "Ta bort permanent ({n} äldre än {d} dagar)": "Delete permanently ({n} older than {d} days)",
  "Ta bort permanent?": "Delete permanently?",
  "{n} planer och program som legat i papperskorgen längre än {d} dagar tas bort för gott, med sina versioner. Det går inte att ångra (men den dagliga säkerhetskopian finns kvar i 30 dagar).": "{n} plans and programmes that have been in the recycle bin for more than {d} days are deleted for good, with their versions. This cannot be undone (but the daily backup is kept for 30 days).",
  "Ta bort permanent": "Delete permanently",
  "{n} borttagna permanent": "{n} deleted permanently",
  "Versioner och papperskorg": "Versions and recycle bin",
  "<b>⋯ → 🕘 Versioner…</b> återställer en tidigare version av planen. Borttagna planer ligger i <b>🗑 Papperskorg</b> i 30 dagar.": "<b>⋯ → 🕘 Versions…</b> restores an earlier version of the plan. Deleted plans stay in the <b>🗑 Recycle bin</b> for 30 days.",
  "En version sparas automatiskt före varje <b>Uppdatera från Excel</b>, import ovanpå planen, <b>Ta bort</b> och återställning – och en gång per dag när planen ändras.": "A version is saved automatically before every <b>Update from Excel</b>, import on top of the plan, <b>Delete</b> and restore – and once a day when the plan changes.",
  "<b>⋯ → 🕘 Versioner…</b> listar versionerna med datum, orsak, vem och antal aktiviteter, risker och beroenden. <b>Jämför</b> visar skillnaden mot nu.": "<b>⋯ → 🕘 Versions…</b> lists the versions with date, reason, who and the number of tasks, risks and dependencies. <b>Compare</b> shows the difference from now.",
  "<b>Exportera</b> sparar versionen som Excel i samma format som <b>⬇ Exportera plan (Excel)</b>.": "<b>Export</b> saves the version as Excel in the same format as <b>⬇ Export plan (Excel)</b>.",
  "Upp till 30 versioner per plan sparas, och minst en per vecka i 8 veckor. I programvyn gäller samma sak för programmet.": "Up to 30 versions per plan are kept, and at least one per week for 8 weeks. In the programme view the same applies to the programme.",
  "I den lokala versionen sparas upp till 10 versioner per plan i webbläsarens arbetskopia. Spara till fil med 💾 för en säker kopia.": "In the local version up to 10 versions per plan are kept in the browser's working copy. Save to file with 💾 for a safe copy.",
  "Nytt: versioner": "New: versions",
  "⋯ → 🕘 Versioner… visar sparade versioner av planen – före varje uppdatering, import och borttagning, och en per dag. Jämför med nu, återställ eller exportera.": "⋯ → 🕘 Versions… shows saved versions of the plan – before every update, import and deletion, and one per day. Compare with now, restore or export.",
  "Återställ går att ångra": "Restore can be undone",
  "Nytt: papperskorg": "New: recycle bin",
  "Importera inte på nytt": "Don't import again",
  "Finns planen redan föreslås Uppdatera. En ny kopia tappar risker, veckostatus, checklistans svar och kopplingar.": "If the plan already exists, Update is suggested. A new copy loses risks, weekly status, checklist answers and links.",
  "Före uppdatering från Excel": "Before update from Excel",
  "Före import ovanpå planen": "Before import on top of the plan",
  "Före borttagning": "Before deletion",
  "Före återställning": "Before restore",
  "Daglig kopia": "Daily copy",
  "Sparad för hand": "Saved by hand",
  "🕘 Versioner…": "🕘 Versions…",
  "🗑 Papperskorg…": "🗑 Recycle bin…",
  // Skapa mall (#73)
  "Det här är en NexusOrdo-mall": "This is a NexusOrdo template",
  "Filen är en mall, inte en plan. Använd ⋯ → Ny plan från mall… → Importera mall från fil.": "The file is a template, not a plan. Use ⋯ → New plan from template… → Import template from file.",
  "Kunde inte läsa mallarna: ": "Could not read the templates: ",
  "{n} aktiviteter · {m} milstolpar · {d} beroenden · {c} checklistpunkter": "{n} activities · {m} milestones · {d} dependencies · {c} checklist items",
  "Inbyggda mallar": "Built-in templates",
  "NexusOrdo-biblioteket": "NexusOrdo library",
  "Mina mallar": "My templates",
  "Exportera mall (Excel)": "Export template (Excel)",
  "Ta bort mall": "Delete template",
  "Inga egna mallar ännu. Skapa en från en plan med ⋯ → 📐 Spara som mall…": "No templates of your own yet. Create one from a plan with ⋯ → 📐 Save as template…",
  "⇪ Importera mall från fil…": "⇪ Import template from file…",
  "Välj en mall.": "Choose a template.",
  "veckan då planen börjar": "the week the plan starts",
  "veckan för {name}": "the week of {name}",
  "Datumen räknas i veckor från ankaret, som i planen mallen gjordes från.": "Dates are counted in weeks from the anchor, as in the plan the template was made from.",
  "Inga aktiviteter att lägga till – ange ankarets vecka": "No activities to add – enter the anchor week",
  "Ange ankarets vecka.": "Enter the anchor week.",
  "Mallen är skadad eller har ändrats. Exportera den igen från NexusOrdo.": "The template is damaged or has been changed. Export it again from NexusOrdo.",
  "Mallen kommer från en nyare version av NexusOrdo och kan inte läsas här.": "The template comes from a newer version of NexusOrdo and cannot be read here.",
  "Mall": "Template",
  "Beskrivning": "Description",
  "Ankare": "Anchor",
  "Planens start": "Plan start",
  "Slutvecka (veckor från ankaret)": "End week (weeks from the anchor)",
  "Längd (veckor)": "Duration (weeks)",
  "Efter": "After",
  "TimePlan-mall – ändra inte. Används när mallen importeras i NexusOrdo.": "NexusOrdo template – do not change. Used when the template is imported into NexusOrdo.",
  "mall": "template",
  "Mallen är sparad till {file}": "The template is saved to {file}",
  "Mallen är exporterad": "The template is exported",
  "Importera mall": "Import template",
  "Filen är en NexusOrdo-mall: <b>{name}</b> med {n} aktiviteter, {m} milstolpar och {d} beroenden.": "The file is a NexusOrdo template: <b>{name}</b> with {n} activities, {m} milestones and {d} dependencies.",
  "Den läggs i <b>Mina mallar</b>. Skapa sedan en plan med ⋯ → Ny plan från mall….": "It is added to <b>My templates</b>. Then create a plan with ⋯ → New plan from template….",
  "Mallen ”{name}” finns nu i Mina mallar": "The template “{name}” is now in My templates",
  "Kunde inte spara mallen: ": "Could not save the template: ",
  "Filen är ingen NexusOrdo-mall (fliken TimePlan-mall saknas).": "The file is not a NexusOrdo template (the TimePlan-mall sheet is missing).",
  "Byt namn på mallen": "Rename the template",
  "Mallen heter nu ”{name}”": "The template is now called “{name}”",
  "Ta bort mall?": "Delete template?",
  "Mallen <b>{name}</b> tas bort. Planer som skapats från den påverkas inte.": "The template <b>{name}</b> is deleted. Plans created from it are not affected.",
  "Mallen ”{name}” är borttagen": "The template “{name}” is deleted",
  "Planen har inga aktiviteter med datum.": "The plan has no activities with dates.",
  "saknar datum": "no dates",
  "Spara som mall – {name}": "Save as template – {name}",
  "Mallens namn": "Template name",
  "Vad mallen passar för, t.ex. typ av projekt": "What the template is for, e.g. type of project",
  "Planens start (v {w})": "Plan start (w {w})",
  "Datumen sparas som veckor före eller efter ankaret. När en plan skapas från mallen anger du ankarets vecka.": "Dates are saved as weeks before or after the anchor. When a plan is created from the template you enter the anchor week.",
  "Faser och aktiviteter": "Phases and activities",
  "Inga": "None",
  "Spara mall": "Save template",
  "Skriv ett namn på mallen": "Enter a name for the template",
  "Välj minst en aktivitet med datum": "Choose at least one activity with dates",
  "Mallen får": "The template gets",
  "{p} faser, {w} veckor från första till sista aktiviteten": "{p} phases, {w} weeks from the first to the last activity",
  "{n} beroenden till aktiviteter som inte är valda följer inte med": "{n} dependencies on activities that are not chosen are not included",
  "Mallen finns redan": "The template already exists",
  "Du har redan en mall som heter <b>{name}</b>. Ersätta den, eller spara som en ny mall?": "You already have a template called <b>{name}</b>. Replace it, or save as a new template?",
  "Spara som ny": "Save as new",
  "Ersätt": "Replace",
  "Mallen ”{name}” är uppdaterad": "The template “{name}” is updated",
  "Mallen ”{name}” är sparad – använd den med ⋯ → Ny plan från mall…": "The template “{name}” is saved – use it with ⋯ → New plan from template…",
  "Skapa mall": "Create template",
  "<b>⋯ → 📐 Spara som mall…</b> gör en mall av planen, så att nästa projekt kan börja från den.": "<b>⋯ → 📐 Save as template…</b> makes a template of the plan, so the next project can start from it.",
  "Välj faser och aktiviteter i trädet – alla är valda från början. Ge mallen ett namn och en beskrivning.": "Choose phases and activities in the tree – all are chosen from the start. Give the template a name and a description.",
  "Välj mall": "Choose template",
  "Skriv veckorna som ÅÅVV. Lämna tomt för gater som inte gäller. En egen mall har en vecka: ankaret.": "Enter the weeks as YYWW. Leave gates that do not apply empty. Your own template has one week: the anchor.",
  "Nytt: Spara som mall": "New: Save as template",
  "⋯ → 📐 Spara som mall… gör en mall av den öppna planen: välj faser och aktiviteter, ankare (start eller gate), namn och beskrivning.": "⋯ → 📐 Save as template… makes a template of the open plan: choose phases and activities, anchor (start or gate), name and description.",
  "⋯ → Ny plan från mall… visar Inbyggda mallar och Mina mallar. Faser, veckor, beroenden och checklistor följer med.": "⋯ → New plan from template… shows Built-in templates and My templates. Phases, weeks, dependencies and checklists are included.",
  "Mallar som fil": "Templates as files",
  "Exportera en mall (⬇) och importera den på en annan dator med ⇪ Importera mall från fil….": "Export a template (⬇) and import it on another computer with ⇪ Import template from file….",
  "📐 Spara som mall…": "📐 Save as template…",
  "Välj färg för fasen": "Choose colour for the phase",
  "Färger väljs i varje plan – öppna planen först.": "Colours are chosen in each plan – open the plan first.",
  "Planen har inga faser än.": "The plan has no phases yet.",
  "Egen färg": "Custom colour",
  "Egen…": "Custom…",
  "Tillbaka till palettens färg": "Back to the palette's colour",
  "Låg kontrast mot bakgrunden ({r}:1, minst 3:1). Kanten mörkas automatiskt, men en mörkare färg syns bättre.": "Low contrast against the background ({r}:1, at least 3:1). The edge is darkened automatically, but a darker colour is easier to see.",
  "Paletten gäller alla faser utan egen färg.": "The palette applies to all phases without their own colour.",
  "Färg för {name}": "Colour for {name}",
  "🎨 Färger": "🎨 Colours",
  "🎨 Färger…": "🎨 Colours…",
  "Alla faser och palett…": "All phases and palette…",
  "Återställ alla": "Reset all",
  "Standard": "Standard",
  "Mjuk": "Soft",
  "Hög kontrast": "High contrast",
  "Byt färg på en fas med 🎨 på fasraden eller <b>⋯ → 🎨 Färger…</b> – se artikeln <b>Färger</b>.": "Change the colour of a phase with 🎨 on the phase row or <b>⋯ → 🎨 Colours…</b> – see the article <b>Colours</b>.",
  "Färger": "Colours",
  "Välj färg per fas och en palett för planen med <b>⋯ → 🎨 Färger…</b> eller 🎨 på fasraden.": "Choose a colour per phase and a palette for the plan with <b>⋯ → 🎨 Colours…</b> or 🎨 on the phase row.",
  "Texten på fasraden blir mörk eller vit efter färgen och kanten mörkas så att den syns. Ger en egen färg lägre kontrast än 3:1 mot bakgrunden visas en varning.": "The text on the phase row becomes dark or white depending on the colour, and the edge is darkened so that it is visible. If a custom colour gives less than 3:1 contrast against the background, a warning is shown.",
  "Fasens färg": "The phase's colour",
  "Håll musen över fasraden: 🎨 byter färg, ↑ ↓ flyttar fasen. ⋯ → 🎨 Färger… väljer palett.": "Hover over the phase row: 🎨 changes the colour, ↑ ↓ moves the phase. ⋯ → 🎨 Colours… chooses the palette.",
  "Nytt: färger": "New: colours",
  "Öppna en plan för att välja färger på faserna.": "Open a plan to choose colours for the phases.",
  "Nytt: färg per fas": "New: colour per phase",
  "Håll musen över fasraden och klicka på 🎨 för att välja fasens färg – förvald eller egen.": "Hover over the phase row and click 🎨 to choose the phase's colour – preset or custom.",
  "Paletter": "Palettes",
  "⋯ → 🎨 Färger… väljer palett för hela planen (PMI, Standard, Mjuk, Hög kontrast) och färg för alla faser.": "⋯ → 🎨 Colours… chooses the palette for the whole plan (PMI, Standard, Soft, High contrast) and the colour of every phase.",
  "Upprepas": "Repeats",
  "{name} × {n} à {w} veckor: {tasks}": "{name} × {n} of {w} weeks: {tasks}",
  "Agilt": "Agile",
  "0 = ingen release. Sista sprinten får alltid en release.": "0 = no release. The last sprint always gets a release.",
  "({n} totalt)": "({n} in total)",
  "ingen": "none",
  "{n} hoppas över eftersom de inte får plats före gaten eller saknar gate-vecka: {names}": "{n} are skipped because they do not fit before the gate or the gate has no week: {names}",
  "Scrum": "Scrum",
  "PI-planering (SAFe-inspirerad)": "PI Planning (SAFe-inspired)",
  "Sprint 0 (uppstart) och N sprintar med Sprint Planning, Sprint Review och Sprint Retrospective. Release var X:e sprint och Product Goal som gate. Daily Scrum visas inte i tidslinjen; sprintens innehåll kan ligga som checklista på Sprint Backlog.": "Sprint 0 (set-up) and N sprints with Sprint Planning, Sprint Review and Sprint Retrospective. A release every X sprints and the Product Goal as a gate. The Daily Scrum is not shown in the timeline; the sprint content can be kept as a checklist on Sprint Backlog.",
  "N Program Increments (PI) à 8–12 veckor: PI Planning, Iteration 1–4 och IP Iteration, System Demo och Inspect & Adapt. En plan per team – teamen samlas i programvyn.": "N Program Increments (PI) of 8–12 weeks: PI Planning, Iterations 1–4 and IP Iteration, System Demo and Inspect & Adapt. One plan per team – the teams come together in the program view.",
  "Antal sprintar": "Number of sprints",
  "Veckor per sprint": "Weeks per sprint",
  "Release var X:e sprint": "Release every X sprints",
  "Sprintar per fas": "Sprints per phase",
  "Antal PI": "Number of PIs",
  "Veckor per PI": "Weeks per PI",
  "Antal upprepningar": "Number of repetitions",
  "Veckor per upprepning": "Weeks per repetition",
  "Release var X:e": "Release every X",
  "Agila mallar": "Agile templates",
  "<b>Sprint / PI</b> – agila tidsrutor: en sprint är 1–4 veckor (Scrum), en PI (Program Increment) 8–12 veckor med 4 iterationer + IP Iteration (SAFe-inspirerad). Se <b>Agila mallar</b>.": "<b>Sprint / PI</b> – agile timeboxes: a sprint is 1–4 weeks (Scrum), a PI (Program Increment) 8–12 weeks with 4 iterations + IP Iteration (SAFe-inspired). See <b>Agile templates</b>.",
  "Antal och längd": "Number and length",
  "Agila mallar: välj antal sprintar eller PI, veckor per sprint eller PI och release var X:e sprint.": "Agile templates: choose the number of sprints or PIs, weeks per sprint or PI and a release every X sprints.",
  "Nytt: agila mallar": "New: agile templates",
  "Under Agilt finns Scrum, PI-planering (SAFe-inspirerad) och hybrid PMI + sprintar.": "Under Agile you find Scrum, PI Planning (SAFe-inspired) and hybrid PMI + sprints.",
  "Välj en agil mall: fälten för antal sprintar eller PI, veckor och release var X:e visas till höger. Skriv startveckan, eller gate-veckorna för hybriden.": "Choose an agile template: the fields for the number of sprints or PIs, weeks and release every X are shown to the right. Enter the start week, or the gate weeks for the hybrid.",
  "Sprintar och PI blir egna faser med sina händelser. Hybridens sprintar läggs i Development och Final Development.": "Sprints and PIs become their own phases with their events. The hybrid's sprints are placed in Development and Final Development.",
  "Filen kommer från en nyare NexusOrdo": "The file comes from a newer NexusOrdo",
  "Filen kommer från en nyare NexusOrdo ({v}, {d}) än den här ({mv}, {md}). Den öppnas ändå, men det som är nytt i filen kan saknas här.": "The file comes from a newer NexusOrdo ({v}, {d}) than this one ({mv}, {md}). It opens anyway, but what is new in the file may be missing here.",
  "Hämta den senaste versionen av <b>{file}</b>, spara dina planer till fil, stäng fliken och öppna den nya filen – se <b>Lokal version</b> i hjälpcentret.": "Get the latest version of <b>{file}</b>, save your plans to file, close the tab and open the new file – see <b>Local version</b> in the help centre.",
  "Öppna ändå": "Open anyway",
  "<b>Ny version:</b> 1) Spara alla planer till fil med <b>💾 Spara</b>, 2) stäng fliken, 3) ersätt filen med den nya versionen på samma plats och med samma namn – då finns arbetskopian kvar – och öppna den. Öppna vid behov dina planfiler med <b>📂 Öppna plan…</b>": "<b>New version:</b> 1) Save all plans to file with <b>💾 Save</b>, 2) close the tab, 3) replace the file with the new version in the same place and with the same name – then the working copy is kept – and open it. If needed, open your plan files with <b>📂 Open plan…</b>",
  "Öppnar du en plan- eller mallfil från en nyare NexusOrdo visas en varning. Filen öppnas ändå – använd den senaste versionen av NexusOrdo så att allt i filen följer med.": "If you open a plan or template file from a newer NexusOrdo, a warning is shown. The file opens anyway – use the latest version of NexusOrdo so that everything in the file comes along.",
  "kvar": "remaining",
  "insats": "effort",
  "insats {a} → {b}": "effort {a} → {b}",
  "(ändrad i NexusOrdo – skrivs över)": "(changed in NexusOrdo – overwritten)",
  "Insats (timmar)": "Effort (hours)",
  "Insats läses in för {n} aktiviteter": "Effort is read for {n} activities",
  "{n} med Planners standardinsats (varaktighet × 8 h per person)": "{n} with Planner's default effort (duration × 8 h per person)",
  "{n} aktiviteter behåller insatsen från NexusOrdo (Planners värde är oförändrat)": "{n} activities keep the effort from NexusOrdo (Planner's value is unchanged)",
  "{n} persondagar": "{n} person-days",
  "Planerat": "Planned",
  "Utfört": "Done",
  "Kvar": "Remaining",
  "räknas ut": "calculated",
  "räknat": "calculated",
  "{h} per person ({n} personer)": "{h} per person ({n} people)",
  "Från Planner": "From Planner",
  "Planners standardinsats (varaktighet × 8 h per person). Justera om det inte stämmer.": "Planner's default effort (duration × 8 h per person). Adjust it if it is not right.",
  "Satt i NexusOrdo": "Set in NexusOrdo",
  "Timmar, eller t.ex. 2 d eller 1 v. Kvar räknas ut från planerat och utfört (eller % klart) om fältet är tomt.": "Hours, or e.g. 2 d or 1 w. Remaining is calculated from planned and done (or % complete) if the field is empty.",
  "Ange insatsen i timmar, t.ex. 16 eller 2 d": "Enter the effort in hours, e.g. 16 or 2 d",
  "Planerat {p} · kvar {l}": "Planned {p} · remaining {l}",
  "Insats": "Effort",
  "Planners standard": "Planner default",
  "Öppna en plan för att se belastningen.": "Open a plan to see the workload.",
  "Ej tilldelad": "Not assigned",
  "av {c}": "of {c}",
  "Belastning i programmet": "Programme workload",
  "Belastning": "Workload",
  "Insats per person och vecka – fördelad jämnt över aktivitetens arbetsdagar och delad mellan de tilldelade.": "Effort per person and week – spread evenly over the activity's working days and shared between the people assigned.",
  "Föregående veckor": "Previous weeks",
  "Första vecka (ÅÅVV)": "First week (YYWW)",
  "Nästa veckor": "Next weeks",
  "Denna vecka": "This week",
  "{n} v": "{n} w",
  "Kvar: återstående insats från idag. Planerat: hela insatsen över aktivitetens period.": "Remaining: effort left from today. Planned: the whole effort over the activity's period.",
  "Person": "Person",
  "Alla personer ({n})": "All people ({n})",
  "Räkna inte måndag–fredag som är helgdagar eller midsommar-, jul- och nyårsafton": "Do not count Monday–Friday public holidays or Midsummer, Christmas and New Year's Eve",
  "Svenska helgdagar": "Swedish public holidays",
  "Planners standardinsats ({n})": "Planner's default effort ({n})",
  "⏱ Kapacitet…": "⏱ Capacity…",
  "{n} aktiviteter med insats i perioden": "{n} activities with effort in the period",
  "{n} aktiviteter med ansvarig saknar insats": "{n} activities with an assignee have no effort",
  "{n} med Planners standardinsats (heltid)": "{n} with Planner's default effort (full time)",
  "≤ 80 %": "≤ 80 %",
  "80–100 %": "80–100 %",
  "> 100 %": "> 100 %",
  "h/vecka": "h/week",
  "Summa": "Total",
  "Ingen insats i perioden. Ange insats i aktivitetens panel (Planerat, Utfört, Kvar) eller uppdatera planen från en Planner Premium-export med kolumnen Arbete.": "No effort in the period. Enter effort in the activity panel (Planned, Done, Remaining) or update the plan from a Planner Premium export with the Work column.",
  "Du har inte tillgång till den planen.": "You do not have access to that plan.",
  "Klicka på en ruta för att se vilka aktiviteter som ger belastningen. Klicka på ett namn för att bara visa den personen.": "Click a cell to see which activities make up the workload. Click a name to show only that person.",
  "Timmar": "Hours",
  "Ingen insats den här veckan.": "No effort this week.",
  "⏱ Kapacitet – {name}": "⏱ Capacity – {name}",
  "Timmar per vecka som varje person kan lägga på {what}. Tom ruta = standard. Veckor med helgdagar får lägre kapacitet.": "Hours per week each person can spend on {what}. Empty = default. Weeks with public holidays get less capacity.",
  "programmets planer": "the programme's plans",
  "planen": "the plan",
  "Standard (h/vecka)": "Default (h/week)",
  "Svenska helgdagar är lediga": "Swedish public holidays are days off",
  "Nyårsdagen": "New Year's Day",
  "Trettondedag jul": "Epiphany",
  "Långfredagen": "Good Friday",
  "Påskdagen": "Easter Sunday",
  "Annandag påsk": "Easter Monday",
  "Första maj": "May Day",
  "Kristi himmelsfärdsdag": "Ascension Day",
  "Pingstdagen": "Whit Sunday",
  "Sveriges nationaldag": "National Day of Sweden",
  "Midsommarafton": "Midsummer Eve",
  "Midsommardagen": "Midsummer Day",
  "Alla helgons dag": "All Saints' Day",
  "Julafton": "Christmas Eve",
  "Juldagen": "Christmas Day",
  "Annandag jul": "Boxing Day",
  "Nyårsafton": "New Year's Eve",
  "(från planen)": "(from the plan)",
  "standard": "default",
  "Inga personer är tilldelade aktiviteter ännu.": "No people are assigned to activities yet.",
  "Ange standard som timmar per vecka (1–168).": "Enter the default as hours per week (1–168).",
  "Ange timmar per vecka (0–168).": "Enter hours per week (0–168).",
  "Kapaciteten är sparad": "The capacity is saved",
  "Insats per person och vecka": "Effort per person and week",
  "Insats per person och vecka i alla programmets planer": "Effort per person and week in all the programme's plans",
  "Visa planerad insats i timmar i listan": "Show planned effort in hours in the list",
  "Planerat (h)": "Planned (h)",
  "Kvar (h)": "Remaining (h)",
  "Kryssrutan <b>Timmar</b> visar planerad insats i listan när planen har insats – se <b>Insats och belastning</b>.": "The <b>Hours</b> checkbox shows planned effort in the list when the plan has effort – see <b>Effort and workload</b>.",
  "Insats och belastning": "Effort and workload",
  "Arbetstid är inte kalendertid: ange insatsen i timmar och se belastningen per person och vecka i fliken <b>Belastning</b>.": "Working time is not calendar time: enter the effort in hours and see the workload per person and week in the <b>Workload</b> tab.",
  "Klicka på en aktivitet och fyll i <b>Insats (timmar)</b>: <b>Planerat</b>, <b>Utfört</b> och <b>Kvar</b>. Skriv timmar eller t.ex. <b>2 d</b> (8 h per dag) eller <b>1 v</b> (40 h). Panelen visar också persondagar.": "Click an activity and fill in <b>Effort (hours)</b>: <b>Planned</b>, <b>Done</b> and <b>Remaining</b>. Enter hours or e.g. <b>2 d</b> (8 h per day) or <b>1 w</b> (40 h). The panel also shows person-days.",
  "Lämnas <b>Kvar</b> tomt räknas det ut: planerat − utfört, annars planerat × (1 − % klart). Klara aktiviteter har inget kvar.": "If <b>Remaining</b> is left empty it is calculated: planned − done, otherwise planned × (1 − % complete). Completed activities have nothing remaining.",
  "Planner Premium: kolumnerna <b>Arbete</b>, <b>Slutfört arbete</b> och <b>Återstående arbete</b> (Work, Completed work, Remaining work) läses vid import och <b>Uppdatera från Excel</b>. Insats som du ändrat i NexusOrdo behålls tills värdet ändras i Planner – förhandsvisningen visar det.": "Planner Premium: the columns <b>Work</b>, <b>Completed work</b> and <b>Remaining work</b> (Arbete, Slutfört arbete, Återstående arbete) are read on import and <b>Update from Excel</b>. Effort you changed in NexusOrdo is kept until the value changes in Planner – the preview shows it.",
  "<b>Belastning</b> visar personer × veckor: insatsen fördelas jämnt över aktivitetens arbetsdagar (måndag–fredag, utan svenska helgdagar) och delas lika mellan de tilldelade. Grön ≤ 80 %, gul 80–100 %, röd över 100 % av kapaciteten.": "<b>Workload</b> shows people × weeks: the effort is spread evenly over the activity's working days (Monday–Friday, without Swedish public holidays) and shared equally between the assignees. Green ≤ 80 %, yellow 80–100 %, red over 100 % of capacity.",
  "<b>Kvar</b> visar återstående insats från idag (kvar på försenade aktiviteter läggs på idag), <b>Planerat</b> hela insatsen över aktivitetens period. Välj 8, 13 eller 26 veckor och bläddra med ◀ ▶.": "<b>Remaining</b> shows the effort left from today (what is left on late activities is put on today), <b>Planned</b> the whole effort over the activity's period. Choose 8, 13 or 26 weeks and browse with ◀ ▶.",
  "Klicka på en ruta för att se vilka aktiviteter som ger belastningen, och på en aktivitet för att öppna den. Välj en person i listan eller klicka på namnet för att bara visa den personen.": "Click a cell to see which activities make up the workload, and an activity to open it. Choose a person in the list or click the name to show only that person.",
  "<b>⋯ → ⏱ Kapacitet…</b> anger timmar per vecka som standard (40) och per person, och om svenska helgdagar är lediga. Veckor med helgdagar får lägre kapacitet.": "<b>⋯ → ⏱ Capacity…</b> sets hours per week as default (40) and per person, and whether Swedish public holidays are days off. Weeks with public holidays get less capacity.",
  "I Gantt-vyn visar kryssrutan <b>Timmar</b> planerad insats i listan, och tooltipen visar insatsen. Insatsen följer med i export, versioner och mallar (mallar: bara planerade timmar).": "In the Gantt view the <b>Hours</b> checkbox shows planned effort in the list, and the tooltip shows the effort. The effort comes along in export, versions and templates (templates: planned hours only).",
  "Gantt för detaljer, Roadmap för översikt, Belastning för timmar per person. Hjälpcentret öppnas från ? → 📖 Hjälpcenter.": "Gantt for details, Roadmap for an overview, Workload for hours per person. The help centre opens from ? → 📖 Help centre.",
  "Personer × veckor": "People × weeks",
  "Timmar per person och vecka och andel av kapaciteten: grön ≤ 80 %, gul 80–100 %, röd över 100 %. Klicka på en ruta för aktiviteterna bakom.": "Hours per person and week and share of capacity: green ≤ 80 %, yellow 80–100 %, red over 100 %. Click a cell for the activities behind it.",
  "Kvar eller planerat": "Remaining or planned",
  "Kvar = återstående insats från idag. Planerat = hela insatsen över aktivitetens period.": "Remaining = effort left from today. Planned = the whole effort over the activity's period.",
  "Filtrera på person": "Filter by person",
  "Visa en person i taget – eller klicka på namnet i tabellen.": "Show one person at a time – or click the name in the table.",
  "Kapacitet": "Capacity",
  "Timmar per vecka som standard och per person, och om svenska helgdagar är lediga.": "Hours per week as default and per person, and whether Swedish public holidays are days off.",
  "Nytt: insats i timmar": "New: effort in hours",
  "Öppna en plan och klicka på en aktivitet för att ange insatsen i timmar.": "Open a plan and click an activity to enter the effort in hours.",
  "Planerat, utfört och kvar i timmar – eller t.ex. 2 d eller 1 v. Kvar räknas ut om det är tomt. Planner Premiums Arbete läses vid import.": "Planned, done and remaining in hours – or e.g. 2 d or 1 w. Remaining is calculated if empty. Planner Premium's Work is read on import.",
  "Nytt: Belastning": "New: Workload",
  "Fliken Belastning visar timmar per person och vecka mot kapaciteten – grön, gul eller röd. I programvyn för alla programmets planer.": "The Workload tab shows hours per person and week against capacity – green, yellow or red. In the programme view for all the programme's plans.",
  "⋯ → ⏱ Kapacitet… anger timmar per vecka per person och om svenska helgdagar är lediga.": "⋯ → ⏱ Capacity… sets hours per week per person and whether Swedish public holidays are days off.",
  "Ångra": "Undo",
  "Planner Premium sätter insatsen till varaktighet × 8 h per person (heltid) när ingen annan insats angetts. Den räknas inte med förrän du kryssar i rutan.": "Planner Premium sets the effort to duration × 8 h per person (full time) when no other effort has been entered. It is not counted until you tick the box.",
  "{n} med Planners standardinsats räknas inte": "{n} with Planner's default effort are not counted",
  "Obs: Premium sätter insatsen till varaktighet × 8 h per tilldelad (heltid) om projektledaren inte angett något. Sådana aktiviteter märks <b>Planners standard</b> och räknas inte i Belastning förrän du kryssar i <b>Planners standardinsats</b>.": "Note: Premium sets the effort to duration × 8 h per assignee (full time) if the project manager has not entered anything. Such activities are marked <b>Planner default</b> and are not counted in Workload until you tick <b>Planner's default effort</b>.",
  // Programgater och gate-översikt (#21)
  "Gater": "Gates",
  "Programgate": "Programme gate",
  "avvikelse (v)": "deviation (w)",
  "läge": "state",
  "ärvda från {name}": "inherited from {name}",
  "huvudplan": "main plan",
  "Efter programgaten": "After the programme gate",
  "Nära eller i riskzonen": "Close or at risk",
  "I tid": "On time",
  "Ingen programgate": "No programme gate",
  "Visa gate-översikten": "Show the gate overview",
  "Programgater": "Programme gates",
  "utan datum": "no date",
  "Programmet har inga programgater än.": "The programme has no programme gates yet.",
  "🚩 Programgater…": "🚩 Programme gates…",
  "Ändra programgaterna": "Edit the programme gates",
  "{code}: gaten saknar datum i planen": "{code}: the gate has no date in the plan",
  "{code}: planen har ingen sådan gate": "{code}: the plan has no such gate",
  "ärvd från {name}": "inherited from {name}",
  "utfall {w}": "actual {w}",
  "programgate {w}": "programme gate {w}",
  "avvikelse": "deviation",
  "{n} påverkade beroenden": "{n} affected dependencies",
  "saknas": "missing",
  "Klicka på en ruta för detaljer. Klicka på projektets namn för att öppna planen.": "Click a cell for details. Click the project name to open the plan.",
  "Gate i planen": "Gate in the plan",
  "Gaten saknar datum i planen": "The gate has no date in the plan",
  "Planen har ingen sådan gate": "The plan has no such gate",
  "Ingen programgate med koden {code}": "No programme gate with the code {code}",
  "Avvikelse": "Deviation",
  "utfallet jämförs": "the actual is compared",
  "ingen programgate": "no programme gate",
  "{n} gate efter programgaten": "{n} gate after the programme gate",
  "{n} gater efter programgaten": "{n} gates after the programme gate",
  "inga gater": "no gates",
  "Gate-översikt": "Gate overview",
  "Projektens gater jämförda med programgaten med samma kod. Avvikelsen är i hela veckor – plus betyder att projektet ligger senare.": "The projects' gates compared with the programme gate with the same code. The deviation is in whole weeks – plus means the project is later.",
  "Bara avvikelser": "Deviations only",
  "⬇ Exportera (Excel)": "⬇ Export (Excel)",
  "{late} efter · {near} nära · {ok} i tid eller klara · {missing} saknas": "{late} late · {near} close · {ok} on time or done · {missing} missing",
  "≥ 1 v efter eller ur fas": "≥ 1 w late or off track",
  "inom 1 v, i riskzonen eller passerad": "within 1 w, at risk or passed",
  "i tid eller klar": "on time or done",
  "Varken programmet eller projekten har gater med kod ännu.": "Neither the programme nor the projects have gates with a code yet.",
  "Inga avvikelser – alla projektens gater ligger i tid mot programgaterna.": "No deviations – all the projects' gates are on time against the programme gates.",
  "Programmet har inga planer ännu.": "The programme has no plans yet.",
  "{n} planer i programmet finns inte längre.": "{n} plans in the programme no longer exist.",
  "Anteckning": "Note",
  "Gate-översikten är exporterad": "The gate overview has been exported",
  "Öppna ett program först": "Open a programme first",
  "Programmets egna gater med fri kod, t.ex. G1–G4. Gate-översikten jämför projektens gater med programgaten med samma kod. Projektens planer ändras inte.": "The programme's own gates with free codes, e.g. G1–G4. The gate overview compares the projects' gates with the programme gate with the same code. The projects' plans are not changed.",
  "Vecka (ÅÅVV)": "Week (YYWW)",
  "Ta bort programgate": "Remove programme gate",
  "+ Ny programgate": "+ New programme gate",
  "Programgater – {name}": "Programme gates – {name}",
  "Varje programgate behöver en kod": "Each programme gate needs a code",
  "Två programgater har samma kod": "Two programme gates have the same code",
  "Programgaterna är sparade": "The programme gates are saved",
  "Projektens gater mot programgaterna": "The projects' gates against the programme gates",
  "Programmets egna gater jämförs med projektens gater i fliken <b>Gater</b>.": "The programme's own gates are compared with the projects' gates on the <b>Gates</b> tab.",
  "Programgaterna visas som chips överst i <b>Översikt</b> och som romber på raden <b>Programgater</b> överst i <b>Gantt</b>, med en streckad linje genom diagrammet.": "The programme gates are shown as chips at the top of <b>Overview</b> and as diamonds on the <b>Programme gates</b> row at the top of <b>Gantt</b>, with a dashed line through the chart.",
  "<b>Gater</b> visar projekten (huvudprojekt → huvudplan och delprojekt) × gate-koderna. Varje ruta har planens vecka, utfall, status och avvikelsen i hela veckor mot programgaten – plus betyder att projektet ligger senare. Ärvda gater har streckad ram.": "<b>Gates</b> shows the projects (main project → main plan and subprojects) × the gate codes. Each cell has the plan's week, actual, status and the deviation in whole weeks against the programme gate – plus means the project is later. Inherited gates have a dashed border.",
  "Färger: <b>röd</b> minst en vecka efter programgaten eller Ur fas, <b>orange</b> senare inom samma vecka, I riskzonen eller passerad utan utfall, <b>grön</b> i tid eller klar, <b>grå</b> saknas. <b>Bara avvikelser</b> visar bara röda och orange.": "Colours: <b>red</b> at least one week after the programme gate or Off track, <b>orange</b> later within the same week, At risk or passed without an actual, <b>green</b> on time or done, <b>grey</b> missing. <b>Deviations only</b> shows only red and orange.",
  "⚠ markerar gaten efter en aktivitet vars beroende har påverkats av en uppdatering (som bannern i Översikt). Klicka på en ruta för detaljer och <b>Öppna plan</b>; <b>⬇ Exportera (Excel)</b> sparar tabellen med veckor som tal.": "⚠ marks the gate after an activity whose dependency has been affected by an update (like the banner in Overview). Click a cell for details and <b>Open plan</b>; <b>⬇ Export (Excel)</b> saves the table with weeks as numbers.",
  "Programmet ändrar aldrig projektens planer – projekten äger sina gater, programmet äger samordningen.": "The programme never changes the projects' plans – the projects own their gates, the programme owns the coordination.",
  "Programgater och gate-översikt": "Programme gates and gate overview",
  "<b>Gater</b> jämför projektens gater med programgaterna – se <b>Programgater och gate-översikt</b>.": "<b>Gates</b> compares the projects' gates with the programme gates – see <b>Programme gates and gate overview</b>.",
  "Projekt × gater": "Projects × gates",
  "En rad per projekt, grupperat under huvudprojektet, och en kolumn per gate-kod. Rutan visar planens vecka, avvikelsen mot programgaten och status. Streckad ram = ärvd från huvudplanen.": "One row per project, grouped under the main project, and one column per gate code. The cell shows the plan's week, the deviation from the programme gate and the status. Dashed border = inherited from the main plan.",
  "Färgerna": "The colours",
  "Röd: minst en vecka efter programgaten eller Ur fas. Orange: senare inom veckan, I riskzonen eller passerad. Grön: i tid eller klar. Grå: saknas.": "Red: at least one week after the programme gate or Off track. Orange: later within the week, At risk or passed. Green: on time or done. Grey: missing.",
  "Bara de projekt som har en röd eller orange gate.": "Only the projects that have a red or orange gate.",
  "Tabellen som Excel, med veckor som tal.": "The table as Excel, with weeks as numbers.",
  "Nytt: programgater": "New: programme gates",
  "Öppna ett program i listan för att se programgaterna och gate-översikten.": "Open a programme in the list to see the programme gates and the gate overview.",
  "⋯ → 🚩 Programgater… lägger till programmets egna gater: kod, vecka, status och anteckning. De visas som chips i Översikt och som romber överst i Gantt.": "⋯ → 🚩 Programme gates… adds the programme's own gates: code, week, status and note. They are shown as chips in Overview and as diamonds at the top of Gantt.",
  "Nytt: gate-översikten": "New: the gate overview",
  "Fliken Gater visar alla projektens gater mot programgaterna med avvikelsen i veckor – röd, orange, grön eller grå. Bara avvikelser filtrerar.": "The Gates tab shows all the projects' gates against the programme gates with the deviation in weeks – red, orange, green or grey. Deviations only filters.",
  "Exportera": "Export",
  // Burndown (#95)
  "Burndown för fasen": "Burndown for the phase",
  "timmar": "hours",
  "punkter": "items",
  "poäng": "points",
  "Hela planen": "Whole plan",
  "Hela programmet": "Whole programme",
  "Kvar ({unit})": "Remaining ({unit})",
  "Omfånget ökade {a} → {b} ({d})": "Scope increased {a} → {b} ({d})",
  "sparat värde": "saved value",
  "från en version": "from a version",
  "uppskattat": "estimated",
  "nu": "now",
  "av": "of",
  "Ideal (arbetsdagar)": "Ideal (working days)",
  "Totalt (omfång)": "Total (scope)",
  "Uppskattat": "Estimated",
  "Ökat omfång": "Scope increase",
  "pågår": "in progress",
  "inte startad": "not started",
  "medel {v}": "average {v}",
  "i fas med idealet": "on the ideal line",
  "{v} efter idealet": "{v} behind the ideal",
  "{v} före idealet": "{v} ahead of the ideal",
  "kvar av {t}": "remaining of {t}",
  "ideal idag: {v}": "ideal today: {v}",
  "ökat omfång": "scope increase",
  "Planen har inga aktiviteter ännu.": "The plan has no activities yet.",
  "Burndown": "Burndown",
  "📉 Burndown – {name}": "📉 Burndown – {name}",
  "⬇ Exportera bild (PNG)": "⬇ Export image (PNG)",
  "Velocity per sprint": "Velocity per sprint",
  "Omfång": "Scope",
  "Sprintar": "Sprints",
  "Förvalt mått för omfånget": "Default measure for the scope",
  "Inga värden i det här omfånget": "No values in this scope",
  "förval": "default",
  "{n} aktiviteter saknar värde i måttet och räknas inte.": "{n} activities have no value in the measure and are not counted.",
  "{n} aktiviteter med Planners standardinsats räknas inte.": "{n} activities with Planner's default effort are not counted.",
  "Klart per sprint vid sprintens slut (pågående: hittills). Medel för avslutade sprintar: {v}. Klicka på en stapel för sprintens burndown.": "Completed per sprint at the end of the sprint (ongoing: so far). Average for finished sprints: {v}. Click a bar for the sprint burndown.",
  "Ett värde sparas när planen sparas (högst ett per dag) och vid uppdatering från Excel. Bakåt i tiden används versionerna och, uppskattat från klara aktiviteters slutdatum, ögonblicksbilderna (ofyllda punkter).": "A value is saved when the plan is saved (at most one per day) and on update from Excel. Further back, the versions are used and – estimated from the end dates of completed activities – the snapshots (hollow points).",
  "Mått: kvarvarande timmar (insats) – kvar enligt panelen, annars planerat − utfört eller planerat × (1 − % klart).": "Measure: remaining hours (effort) – remaining as in the panel, otherwise planned − done or planned × (1 − % complete).",
  "Mått: obockade checklistpunkter. En klar aktivitet räknas som helt avbockad.": "Measure: unchecked checklist items. A completed activity counts as fully checked.",
  "Mått: aktivitetspoäng – varje aktivitet väger 1 och kvar = 1 − % klart. Milstolpar räknas inte.": "Measure: activity points – each activity weighs 1 and remaining = 1 − % complete. Milestones are not counted.",
  "Finns inte i alla planer – visas per plan": "Not in all plans – shown per plan",
  "Summan av {n} planer i samma mått. {m}": "The sum of {n} plans in the same measure. {m}",
  "Måttet finns inte i alla planer, så programmet kan inte summeras – varje plan visas för sig i sitt eget mått. Välj Aktivitetspoäng för en summa.": "The measure is not in all plans, so the programme cannot be summed – each plan is shown on its own in its own measure. Choose Activity points for a sum.",
  "Programmet ändrar aldrig planerna. Varje plan sparar sina egna värden när den sparas.": "The programme never changes the plans. Each plan saves its own values when it is saved.",
  "📉 Burndown…": "📉 Burndown…",
  "Checklistpunkter": "Checklist items",
  "Aktivitetspoäng": "Activity points",
  "Kvarvarande arbete över tid mot en idealkurva – för hela planen, en fas eller en sprint.": "Remaining work over time against an ideal line – for the whole plan, a phase or a sprint.",
  "<b>📊 Uppföljning → 📉 Burndown…</b> visar hela planen. 📉 på fasraden (håll musen över raden) visar fasen eller sprinten direkt.": "<b>📊 Follow-up → 📉 Burndown…</b> shows the whole plan. 📉 on the phase row (hover over the row) shows the phase or sprint directly.",
  "<b>Omfång:</b> hela planen, en sprint eller en fas. Faser som heter <b>Sprint N</b>, <b>Iteration N</b> eller <b>PI N</b> räknas som sprintar – som i de agila mallarna.": "<b>Scope:</b> the whole plan, a sprint or a phase. Phases named <b>Sprint N</b>, <b>Iteration N</b> or <b>PI N</b> count as sprints – as in the agile templates.",
  "<b>Mått:</b> <b>Timmar</b> (kvarvarande insats) när minst hälften av aktiviteterna har insats, annars <b>Checklistpunkter</b> när minst hälften har en checklista, annars <b>Aktivitetspoäng</b> (varje aktivitet väger 1, kvar = 1 − % klart). Förvalet är märkt – byt mått med knapparna. Planners standardinsats räknas inte.": "<b>Measure:</b> <b>Hours</b> (remaining effort) when at least half of the activities have effort, otherwise <b>Checklist items</b> when at least half have a checklist, otherwise <b>Activity points</b> (each activity weighs 1, remaining = 1 − % complete). The default is marked – switch measure with the buttons. Planner's default effort is not counted.",
  "Den heldragna linjen är kvarvarande arbete, den streckade idealkurvan går från totalen vid start till noll på slutdagen och sjunker bara på arbetsdagar (helger och svenska helgdagar enligt <b>⏱ Kapacitet…</b>). ▲ markerar dagar då omfånget ökade.": "The solid line is remaining work; the dashed ideal line goes from the total at the start to zero on the last day and only falls on working days (weekends and Swedish public holidays as set in <b>⏱ Capacity…</b>). ▲ marks days when the scope increased.",
  "Nyckeltalen visar kvar, andel klart och om du ligger före eller efter idealet idag.": "The key figures show what remains, the share complete and whether you are ahead of or behind the ideal today.",
  "<b>Velocity per sprint</b> (när planen har sprintar): klart per sprint och medel för avslutade sprintar. Klicka på en stapel för sprintens burndown.": "<b>Velocity per sprint</b> (when the plan has sprints): completed per sprint and the average for finished sprints. Click a bar for the sprint burndown.",
  "Historiken: ett värde sparas när planen sparas (högst ett per dag) och vid uppdatering från Excel. Bakåt i tiden används planens versioner och – uppskattat från klara aktiviteters slutdatum – milstolpetrendens ögonblicksbilder (ofyllda punkter).": "History: a value is saved when the plan is saved (at most one per day) and on update from Excel. Further back, the plan's versions are used and – estimated from the end dates of completed activities – the milestone trend snapshots (hollow points).",
  "I programvyn summeras planerna när måttet finns i alla planer, annars visas varje plan för sig. <b>⬇ Exportera bild (PNG)</b> sparar diagrammet för PowerPoint.": "In the programme view the plans are summed when the measure exists in all plans, otherwise each plan is shown on its own. <b>⬇ Export image (PNG)</b> saves the chart for PowerPoint.",
  "📉 på fasraden visar burndown för fasen eller sprinten – se <b>Burndown</b>.": "📉 on the phase row shows the burndown for the phase or sprint – see <b>Burndown</b>.",
  "Burndown och velocity per sprint: <b>📊 Uppföljning → 📉 Burndown…</b> eller 📉 på sprintens fasrad – se <b>Burndown</b>.": "Burndown and velocity per sprint: <b>📊 Follow-up → 📉 Burndown…</b> or 📉 on the sprint's phase row – see <b>Burndown</b>.",
  "Nytt: burndown": "New: burndown",
  "Öppna en plan för att se burndown – till exempel en plan från den agila Scrum-mallen.": "Open a plan to see the burndown – for example a plan from the agile Scrum template.",
  "Nytt: 📉 på fasraden": "New: 📉 on the phase row",
  "Håll musen över en fas- eller sprintrad och klicka på 📉 för fasens burndown.": "Hover over a phase or sprint row and click 📉 for the burndown of the phase.",
  "Nytt: 📊 Uppföljning → 📉 Burndown…": "New: 📊 Follow-up → 📉 Burndown…",
  "Kvarvarande arbete mot idealkurvan för planen, en fas eller en sprint – i timmar, checklistpunkter eller aktivitetspoäng. Velocity per sprint och export som bild. I programvyn för alla planer.": "Remaining work against the ideal line for the plan, a phase or a sprint – in hours, checklist items or activity points. Velocity per sprint and export as an image. In the programme view for all plans.",
  "Den här planen": "This plan",
  "Det här programmet": "This programme",
  "Uppföljning": "Follow-up",
  "Följ upp planen: gate-checklista, risker, veckostatus, milstolpetrend och burndown": "Follow up the plan: gate checklist, risks, weekly status, milestone trend and burndown",
  "📊 Uppföljning har gate-checklistan, risklistan, veckostatus, milstolpetrenden och burndown.": "📊 Follow-up has the gate checklist, the risk list, weekly status, the milestone trend and burndown.",
  "Uppföljning och ⋯-menyn": "Follow-up and the ⋯ menu",
  "Nytt: 📊 Uppföljning": "New: 📊 Follow-up",
  "Öppna en plan för att se knappen 📊 Uppföljning.": "Open a plan to see the 📊 Follow-up button.",
  "Gate-checklista, risklista, veckostatus, milstolpetrend och burndown nås nu med ett klick här, i stället för via ⋯.": "Gate checklist, risk list, weekly status, milestone trend and burndown are now one click away here, instead of via ⋯.",
  "Fem verktyg": "Five tools",
  "☑ Gate-checklista, ⚠ Risklista, 🚦 Veckostatus, 📈 Milstolpetrend och 📉 Burndown. I programvyn finns Burndown för alla planer.": "☑ Gate checklist, ⚠ Risk list, 🚦 Weekly status, 📈 Milestone trend and 📉 Burndown. In the programme view, Burndown covers all plans.",
  "⋯ under rubriker": "⋯ under headings",
  "Menyn ⋯ är ordnad under rubriker: Ny, Den här planen, Dela och exportera, Program och Historik. Ta bort plan ligger sist.": "The ⋯ menu is grouped under headings: New, This plan, Share and export, Programme and History. Delete plan is last.",
  "<b>📊 Uppföljning ▾</b> i toppmenyn har gate-checklistan, risklistan, veckostatus, milstolpetrenden och burndown. <b>⋯</b> bredvid planlistan har resten under rubriker: Ny, Den här planen, Dela och exportera, Program och Historik.": "<b>📊 Follow-up ▾</b> in the top bar has the gate checklist, the risk list, weekly status, the milestone trend and burndown. <b>⋯</b> next to the plan list has the rest under headings: New, This plan, Share and export, Programme and History.",
  "+ Ny plan / Importera…": "+ New plan / Import…",
  "⇪ Importera från Excel…": "⇪ Import from Excel…",
  "Läs in en Excel-export från Planner, MS Project eller NexusOrdo – eller börja från en tom plan, en mall eller exemplet.": "Load an Excel export from Planner, MS Project or NexusOrdo – or start from an empty plan, a template or the example.",
  "Språk": "Language",
  "Ny topprad": "New top bar",
  "Nytt: + Ny plan / Importera…": "New: + New plan / Import…",
  "Ny plan och import finns sist i planväljaren: + Ny plan / Importera…. Samma val finns under ⋯ → Ny.": "New plans and import are at the bottom of the plan picker: + New plan / Import…. The same choices are under ⋯ → New.",
  "Planens verktyg": "The plan's tools",
  "Till höger ligger det som gäller den öppna planen: 📊 Uppföljning, ⟳ Uppdatera, Exportera bild och ↶ Ångra.": "On the right is what applies to the open plan: 📊 Follow-up, ⟳ Update, Export image and ↶ Undo.",
  "Hjälp i ?-menyn": "Help in the ? menu",
  "? har rundturerna, 📖 Hjälpcenter och hjälp för sidan du står på.": "? has the tours, 📖 Help centre and help for the page you are on.",
  "Språkknappen visar språket du använder. Klicka och välj Svenska eller English.": "The language button shows the language you are using. Click it and choose Svenska or English.",
  "<b>En ny kopia får inget av det som finns i NexusOrdo:</b> risker, veckostatus, gate-checklistans svar, programmets koppling, beroenden och anteckningar som lagts till här. Ta inte bort planen för att importera på nytt.": "<b>A new copy gets none of what exists in NexusOrdo:</b> risks, weekly status, gate checklist answers, the programme link, dependencies and notes added here. Do not delete the plan to import it again.",
  "Återställ den och uppdatera med den nya exporten – då finns allt från NexusOrdo kvar.": "Restore it and update it with the new export – then everything from NexusOrdo is kept.",
  "Den kan inte längre återställas från papperskorgen.": "It can no longer be restored from the recycle bin.",
  "Risker, status och bockar följer inte med. Checklistornas punkter följer med utan bockar.": "Risks, status and ticks are not included. Checklist items are included without ticks.",
  "Nuvarande läge sparas först som en version, så att du kan ångra återställningen under 🕘 Versioner.": "The current state is saved as a version first, so you can undo the restore under 🕘 Versions.",
  "”{name}” är återställd": "“{name}” has been restored",
  "Borttagna planer och program ligger här i {n} dagar. Återställ ger tillbaka dem som de var.": "Deleted plans and programmes stay here for {n} days. Restore brings them back as they were.",
  "Välj den öppna planen, alla planer eller – i programvyn – programmet med dess planer. Allt kan också exporteras som säkerhetskopia.": "Choose the open plan, all plans or – in the programme view – the programme with its plans. Everything can also be exported as a backup.",
  "Faser, längder i veckor, milstolpar, gater, beroenden, checklistornas punkter och <b>gate-checklistan</b> (dina punkter per gate) följer med. Bockar, svar, risker och status följer inte med.": "Phases, lengths in weeks, milestones, gates, dependencies, checklist items and the <b>gate checklist</b> (your items per gate) are included. Ticks, answers, risks and status are not included.",
  "<b>Återställ</b>: nuvarande läge sparas först som en version, så att återställningen kan ångras.": "<b>Restore</b>: the current state is first saved as a version, so the restore can be undone.",
  "<b>Ta bort plan</b> flyttar planen till papperskorgen. Du återställer den med <b>⋯ → 🗑 Papperskorg…</b> inom 30 dagar.": "<b>Delete plan</b> moves the plan to the recycle bin. You restore it with <b>⋯ → 🗑 Recycle bin…</b> within 30 days.",
  "Importerar du en plan som redan finns föreslås <b>Uppdatera</b>. En ny kopia får inte risker, veckostatus, checklistans svar eller kopplingar – ta aldrig bort planen för att importera den på nytt.": "If you import a plan that already exists, <b>Update</b> is suggested. A new copy does not get risks, weekly status, checklist answers or links to programmes – never delete the plan to import it again.",
  "I programvyn visar <b>Belastning</b> alla programmets planer tillsammans – samma person kan finnas i flera planer. Kapaciteten ändras där för hela programmet.": "In the programme view, <b>Workload</b> shows all the programme's plans together – the same person can be in several plans. The capacity is changed there for the whole programme.",
  "<b>3. Klicka ＋ Nytt delprojekt</b> på huvudprojektets kort i programmets <b>Översikt</b>. Knappen syns när huvudprojektet har en huvudplan.": "<b>3. Click ＋ New subproject</b> on the main project’s card in the programme’s <b>Overview</b>. The button is shown when the main project has a main plan.",
  "<b>⋯ → 🚩 Programgater…</b>: kod, namn, vecka (ÅÅVV) eller datum, status och anteckning. Koden är fri, t.ex. G1–G4, och jämförs med projektens gater med samma kod.": "<b>⋯ → 🚩 Programme gates…</b>: code, name, week (YYWW) or date, status and note. The code is free, e.g. G1–G4, and is compared with the projects' gates with the same code.",
  "Välj plan här. Menyn ⋯ bredvid har ny plan, mallar, export och versioner.": "Choose a plan here. The ⋯ menu next to it has new plan, templates, export and versions.",
  "Inbyggda mallar eller Mina mallar – dina egna mallar. Här importerar du också en mall från fil.": "Built-in templates or My templates – your own templates. You can also import a template from a file here.",
  "Lägg till och ändra programgaterna här eller via ⋯ → 🚩 Programgater….": "Add and change the programme gates here or via ⋯ → 🚩 Programme gates….",
  "Öppna ett program i listan. ＋ Lägg till plan visar nu dina planer – kryssa i dem.": "Open a programme in the list. ＋ Add plan now shows your plans – tick them.",
  "Innan en version återställs sparas nuvarande läge som en ny version.": "Before a version is restored, the current state is saved as a new version.",
  "Ta bort plan flyttar planen till papperskorgen i 30 dagar. ⋯ → 🗑 Papperskorg… återställer den.": "Delete plan moves the plan to the recycle bin for 30 days. ⋯ → 🗑 Recycle bin… restores it.",
  "+ Ny plan / Importera… i planväljaren känner igen filen och skapar planerna med allt innehåll.": "+ New plan / Import… in the plan picker recognises the file and creates the plans with all content.",
};
const tr = (s, v) => { let o = LANG === 'en' && I18N_EN[s] != null ? I18N_EN[s] : s; if (v) o = o.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m); return o; };
// Övrigt och Ej schemalagda är också nycklar i data (bucket, hopfällda faser) – översätts bara när de visas
const bName = b => (b === 'Övrigt' || b === 'Ej schemalagda') ? tr(b) : b;
function setMonths() { MONTHS = LANG === 'en' ? MONTHS_EN : MONTHS_SV; MONTHS_LONG = LANG === 'en' ? MONTHS_LONG_EN : MONTHS_LONG_SV; }
setMonths();
// Texter i index.html: data-i18n (text), data-i18n-html (med markup), data-i18n-title, data-i18n-placeholder – värdet är den svenska nyckeln
function applyStaticI18n() {
  document.documentElement.lang = LANG;
  $$('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n); });
  $$('[data-i18n-html]').forEach(el => { el.innerHTML = tr(el.dataset.i18nHtml); });
  $$('[data-i18n-title]').forEach(el => { el.title = tr(el.dataset.i18nTitle); });
  $$('[data-i18n-placeholder]').forEach(el => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
  $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', tr(el.dataset.i18nAria)); });
  const lb = $('#langBtn');
  // Språkknappen (#101) visar aktuellt språk; menyn har Svenska / English
  if (lb) lb.textContent = `${LANG.toUpperCase()} ▾`;
  $$('#langMenu [data-lang]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.lang === LANG)));
}
function setLang(l) {
  LANG = l === 'en' ? 'en' : 'sv';
  LS.set('timeplan.lang', LANG);
  setMonths(); applyStaticI18n(); closeDrawer(); hideTip(); hideToast(); closeMenus(); setSaveState('');
  render(true);
}

/* ---------- State ---------- */
let Store;
let plans = [];
let allPlans = [];
// Program (#16): samlar planer; projekten äger planerna, programmet äger samordningen
let ProgStore = null, allPrograms = [], programs = [], program = null; // alla rader; plans/programs = de som inte ligger i papperskorgen
let plan = null;
const ui = Object.assign({ view: 'gantt', zoom: 'month', hideDone: false, detail: 'tasks', theme: null, planId: null },
  parseJSON(LS.get('timeplan.ui'), {}));
let search = '';
let undoStack = [];
let saveTimer = null;
let ganttCtx = null;

const saveUi = () => LS.set('timeplan.ui', JSON.stringify(ui));

/* ---------- Storage: webbläsarens lagring (LS), annars bara i minnet ---------- */
function makeStore(table = 'plans') {
  const K = 'timeplan.' + table;
  const read = () => parseJSON(LS.get(K), []);
  const write = a => LS.set(K, JSON.stringify(a));
  return {
    mode: LS.ok ? 'local' : 'memory',
    list: async () => read(),
    insert: async r => { const a = read(); const row = { ...r, id: 'loc' + Date.now() }; a.push(row); write(a); return row; },
    update: async (id, r) => { const a = read(); const i = a.findIndex(x => x.id === id); a[i] = { ...a[i], ...r }; write(a); return a[i]; },
    remove: async id => write(read().filter(x => x.id !== id)),
  };
}

function rowToPlan(r) {
  const parse = v => typeof v === 'string' ? JSON.parse(v) : v;
  return { id: r.id, name: r.name || 'Namnlös plan', tasks: parse(r.tasks) || [], settings: parse(r.settings) || {}, imported_at: r.imported_at };
}
const planRow = p => ({ name: p.name, tasks: p.tasks, settings: p.settings, imported_at: p.imported_at || null });

function setSaveState(txt) { $('#saveState').textContent = txt; if (FILE_MODE) updateFileBanner(); }

function scheduleSave() {
  if (!plan || plan.synthetic) return;
  setSaveState(tr('Sparar…'));
  clearTimeout(saveTimer);
  const p = plan;
  markDirty(p);
  saveTimer = setTimeout(async () => {
    dailyVersion('plan', p); // högst en kopia per dag (#76)
    recordBurn(p); // burndown (#95): dagens värde
    try { await Store.update(p.id, planRow(p)); setSaveState(FILE_MODE ? tr('● Ej sparad till fil') : tr({ local: 'Sparat lokalt ✓', memory: 'Sparas inte' }[Store.mode])); }
    catch (e) { setSaveState(''); toast(tr('Kunde inte spara: ') + e.message); }
  }, 600);
}

function pushUndo() {
  if (!plan || plan.synthetic) return;
  undoStack.push(JSON.stringify({ tasks: plan.tasks, settings: plan.settings }));
  if (undoStack.length > 40) undoStack.shift();
  $('#undoBtn').disabled = false;
}
function undo() {
  const s = undoStack.pop();
  if (!s || !plan) return;
  Object.assign(plan, JSON.parse(s));
  $('#undoBtn').disabled = !undoStack.length;
  scheduleSave(); render();
}

/* ---------- Derived data ---------- */
function statusOf(t) {
  const td = todayDay();
  if (t.progress >= 100) return 'done';
  const e = toDay(t.end);
  if (e != null && e < td) return 'late';
  const s = toDay(t.start);
  if (t.progress > 0 || (s != null && s <= td)) return 'active';
  return 'planned';
}
const STATUS_TXT = { done: 'Klar', late: 'Försenad', active: 'Pågår', planned: 'Ej påbörjad' };

function bucketList() {
  const present = [...new Set(plan.tasks.map(t => t.bucket || 'Övrigt'))];
  const order = (plan.settings.bucketOrder || []).filter(b => present.includes(b));
  const rest = present.filter(b => !order.includes(b));
  const firstStart = b => Math.min(...plan.tasks.filter(t => (t.bucket || 'Övrigt') === b).map(t => toDay(t.start || t.end) ?? 1e9));
  // Faser efter första startdatum, PMI-ordningen vid lika
  const pmiOrder = b => { const m = PMI_PHASES.find(ph => ph.re.test(b)); return m ? m.order : 99; };
  rest.sort((a, b) => firstStart(a) - firstStart(b) || pmiOrder(a) - pmiOrder(b));
  const all = [...order, ...rest];
  if (rest.length) plan.settings.bucketOrder = all;
  return all;
}

let PAL = null;
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const g = v => cs.getPropertyValue(v).trim();
  PAL = {
    panel: g('--panel'), panel2: g('--panel-2'), surface: g('--surface'), border: g('--border'),
    grid: g('--grid'), gridStrong: g('--grid-strong'), text: g('--text-primary'), text2: g('--text-secondary'),
    muted: g('--text-muted'), hover: g('--hover'), today: g('--today'), critical: g('--critical'), good: g('--good'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map(i => g('--s' + i)), other: g('--other'),
  };
}
// PMI-projektmallens faser (processgrupperna; övervakning och styrning löper under Executing) med gaten som avslutar fasen.
// Känns igen på namn (engelska eller svenska) eller på gate-koden.
const PMI_PHASES = [
  { re: /initiat|initier|uppstart|förstudie/i, order: 0, gates: ['G1'], col: '#8c9bab' },
  { re: /planning|planering/i, order: 1, gates: ['G2'], col: '#7b61ff' },
  { re: /execut|genomför|monitor|controll|styrning/i, order: 2, gates: ['G3'], col: '#f5a623' },
  { re: /clos|avslut|överlämning/i, order: 3, gates: ['G4'], col: '#2e9e5b' },
];
const PMI_GATES = PMI_PHASES.flatMap(ph => ph.gates);
const PMI_GATE_RE = /\bG[1-4]\b/;
function pmiColorOf(st, bucket) {
  const gate = String(((st && st.phaseCodes) || {})[bucket] || '').toUpperCase();
  const m = PMI_PHASES.find(ph => ph.gates.includes(gate)) || PMI_PHASES.find(ph => ph.re.test(bucket));
  return m ? m.col : null;
}
const rgbOf = hex => /^#[0-9a-f]{6}$/i.test(hex) ? [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16)) : null;
function isLight(col) {
  const c = rgbOf(col);
  if (!c) return false;
  const [r, g, b] = c.map(v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b > .4;
}
// Text ovanpå fasfärg: mörk på ljusa färger (gul, grön), annars vit
const inkOn = col => isLight(col) ? '#1d1d1b' : '#fff';
// Kantfärg: ljusa färger mörkas så att staplar och milstolpar syns mot ljus bakgrund
const luminance = hex => { const [r, g, b] = rgbOf(hex).map(v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
// Kantfärg för staplar, faser och milstolpar: grafiska markeringar ska nå 3:1 mot bakgrunden (WCAG).
// Fyllnadsfärgen (t.ex. PMI-färgen) behålls; kanten får samma kulör, mörkare i ljust tema och ljusare i mörkt.
// Milstolpens romb (#55, #66): fylld när gaten är klar eller har utfall; kant gul vid "I riskzonen", röd vid "Ur fas" eller försenad
const GS_YELLOW = '#FFD50C';
const msFill = (t, st, col) => st === 'done' || t.goalStatus === 'done' || t.actual ? col : PAL.surface;
const msEdge = (t, st, col) => t.goalStatus === 'offtrack' ? PAL.critical : t.goalStatus === 'atrisk' ? edgeOf(GS_YELLOW)
  : st === 'late' && !t.actual && t.goalStatus !== 'done' ? PAL.critical : edgeOf(col);
function edgeOf(col) {
  const bg = PAL && rgbOf(PAL.surface) ? PAL.surface : '#ffffff';
  if (!rgbOf(col) || contrast(col, bg) >= 3) return col;
  const [r, g, b] = rgbOf(col).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; const L0 = (mx + mn) / 2, S = d ? d / (1 - Math.abs(2 * L0 - 1)) : 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const toHex = L => { const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs((h % 2 + 2) % 2 - 1)), m = L - c / 2;
    const [R, G, B] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return '#' + [R, G, B].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join(''); };
  const darkBg = luminance(bg) < .2;
  for (let i = 1; i <= 100; i++) { const c = toHex(Math.max(0, Math.min(1, L0 + (darkBg ? i : -i) / 100))); if (contrast(c, bg) >= 3) return c; }
  return darkBg ? '#ffffff' : '#000000';
}
/* ---------- Färger för faser (#74) ----------
   settings.palette: 'pmi' (PMI-färger där fasen känns igen, annars Standard – förvalt) | 'standard' | 'mjuk' | 'kontrast'.
   settings.phaseColors {fas: '#rrggbb'} = användarens val per fas och går före paletten. */
const PALETTE_IDS = ['pmi', 'standard', 'mjuk', 'kontrast'];
const PAL_MJUK = ['#8db3e2', '#f2a98c', '#8fd1b0', '#f0cf7a', '#e7a9c6', '#b5d48c', '#b3a7e8', '#ee9f9f'];
const PAL_KONTRAST = ['#0b4fa8', '#b23c00', '#00704a', '#7a5200', '#a3195b', '#2f6b00', '#4b2ea8', '#b00020'];
// Förvalda färger i färgväljaren: alla når minst 3:1 mot ljus bakgrund (#34)
const COLOR_PRESETS = ['#2a78d6', '#0b4fa8', '#6250d6', '#8a3ffc', '#a3195b', '#e34948', '#b23c00', '#c65d00', '#7a5200', '#008300', '#00704a', '#007a87', '#5f6b7a', '#3d3d3a'];
const isHexColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
// Planens palett: okänd eller saknad → PMI
function paletteId(st) {
  const v = st && st.palette;
  return PALETTE_IDS.includes(v) ? v : 'pmi';
}
// Bara giltiga färger (#rrggbb) och fasnamn som text – används vid import, export och mallar
function cleanPhaseColors(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {};
  for (const [k, v] of Object.entries(o)) if (typeof k === 'string' && k.trim() && k.length <= 200 && isHexColor(v)) out[k] = v.toLowerCase();
  return out;
}
// Kontrastkvot enligt WCAG (1–21) mellan två färger (#rgb eller #rrggbb), null om någon inte är en färg
function contrastRatio(a, b) {
  const rgb = c => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1]; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const lum = c => { const [r, g, bl] = c.map(v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * bl; };
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return null;
  const [hi, lo] = [lum(x), lum(y)].sort((m, n) => n - m);
  return Math.round((hi + .05) / (lo + .05) * 100) / 100;
}
// Grafiska markeringar ska nå 3:1 mot bakgrunden (#34)
const lowContrast = (col, bg) => { const r = contrastRatio(col, bg); return r != null && r < 3; };
// Ren funktion: fasens färg utifrån planens inställningar. series = standardpaletten (temats --s1…--s8), other = övrigt.
function phaseColor(st, bucket, series, other) {
  st = st || {};
  const own = (st.phaseColors || {})[bucket];
  if (isHexColor(own)) return own;
  const pal = paletteId(st);
  if (pal === 'pmi') { const c = pmiColorOf(st, bucket); if (c) return c; }
  const list = pal === 'mjuk' ? PAL_MJUK : pal === 'kontrast' ? PAL_KONTRAST : series;
  const i = (st.bucketOrder || []).indexOf(bucket);
  return i >= 0 && i < 8 ? list[i] : other; // fasta färger i ordning, aldrig upprepade
}
const clampPct = v => Math.max(0, Math.min(100, Math.round(+v || 0)));
const colorOf = bucket => phaseColor(plan.settings, bucket, PAL.series, PAL.other);
// Har planen egna färger eller en vald palett? (programvyn ritar då planens egna färger)
const hasOwnColors = p => !!(p && p.settings && (p.settings.palette || Object.keys(p.settings.phaseColors || {}).length));
function colorIn(p, bucket) { const prev = plan; plan = p; try { return colorOf(bucket); } finally { plan = prev; } }

function visibleTasks() {
  const q = search.trim().toLowerCase();
  return plan.tasks.filter(t => {
    if (ui.hideDone && t.progress >= 100) return false;
    if (ui.onlyChkDone && !plan.synthetic && !checksAllDone(t)) return false;
    if (ui.onlyLate && statusOf(t) !== 'late') return false;
    if (q && !(`${t.name} ${t.assignees || ''} ${t.labels || ''} ${t.goals || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

/* ---------- Text measuring ---------- */
const measureCtx = document.createElement('canvas').getContext('2d');
function textW(s, size = 12, weight = 400) { measureCtx.font = `${weight} ${size}px ${FONT}`; return measureCtx.measureText(s).width; }

/* ---------- Time scales & ticks ---------- */
function planRange(tasks) {
  let s = Infinity, e = -Infinity;
  for (const t of tasks) {
    const a = toDay(t.start || t.end), b = toDay(t.end || t.start);
    if (a == null) continue;
    s = Math.min(s, a); e = Math.max(e, b);
  }
  const td = todayDay();
  if (!isFinite(s)) { s = td - 14; e = td + 120; }
  return { s: Math.min(s, td), e: Math.max(e, td) };
}

function makeScale(start, end, ppd) {
  return { start, end, ppd, width: Math.round((end - start + 1) * ppd), x: d => (d - start) * ppd };
}

function ganttScale(tasks, zoom) {
  let { s, e } = planRange(tasks);
  s -= 7; e += 21;
  if (zoom === 'week') { s -= weekday(s); e += 6 - weekday(e); }
  else if (zoom === 'month') { s = monthStart(s); e = addMonths(monthStart(e), 1) - 1; }
  else { s = quarterStart(s); e = addMonths(quarterStart(e), 3) - 1; }
  return makeScale(s, e, ZOOM_PPD[zoom]);
}

function ticks(unit, s, e) {
  const out = [];
  let a = unit === 'day' ? s : unit === 'week' ? s - weekday(s) : unit === 'month' ? monthStart(s) : unit === 'quarter' ? quarterStart(s) : yearStart(s);
  while (a <= e) {
    const b = unit === 'day' ? a + 1 : unit === 'week' ? a + 7 : unit === 'month' ? addMonths(a, 1) : unit === 'quarter' ? addMonths(a, 3) : addMonths(a, 12);
    out.push({ a, b }); a = b;
  }
  return out;
}

const TIER = {
  day: { unit: 'day', label: t => String(dObj(t.a).getUTCDate()) },
  week: { unit: 'week', label: t => tr('v') + isoWeek(t.a) },
  weekLong: { unit: 'week', label: t => `${tr('v')}${isoWeek(t.a)} · ${fmtDay(t.a)}` },
  month: { unit: 'month', label: t => MONTHS[dObj(t.a).getUTCMonth()] },
  monthLong: { unit: 'month', label: t => `${MONTHS_LONG[dObj(t.a).getUTCMonth()]} ${dObj(t.a).getUTCFullYear()}` },
  quarter: { unit: 'quarter', label: t => `Q${Math.floor(dObj(t.a).getUTCMonth() / 3) + 1}` },
  quarterLong: { unit: 'quarter', label: t => `Q${Math.floor(dObj(t.a).getUTCMonth() / 3) + 1} ${dObj(t.a).getUTCFullYear()}` },
  year: { unit: 'year', label: t => String(dObj(t.a).getUTCFullYear()) },
};
const GANTT_TIERS = { week: [TIER.weekLong, TIER.day], month: [TIER.monthLong, TIER.week], quarter: [TIER.quarterLong, TIER.month] };

function headerSVG(sc, tiers, x0 = 0) {
  const P = PAL, W = sc.width;
  let h = `<rect x="${x0}" width="${W}" height="${HEAD}" fill="${P.panel}"/>`;
  tiers.forEach((tier, i) => {
    const y = i * 26;
    for (const tk of ticks(tier.unit, sc.start, sc.end)) {
      const xa = sc.x(tk.a), xb = sc.x(tk.b);
      const l = Math.max(0, xa), r = Math.min(W, xb);
      if (r - l <= 0) continue;
      if (tier.unit === 'day' && weekday(tk.a) >= 5) h += `<rect x="${x0 + l}" y="${y}" width="${r - l}" height="26" fill="${P.hover}"/>`;
      if (xa > 0) h += `<line x1="${x0 + xa}" x2="${x0 + xa}" y1="${y}" y2="${y + 26}" stroke="${P.grid}"/>`;
      const lab = tier.label(tk);
      const tw = textW(lab, 11, i ? 400 : 600);
      if (i === 0) { if (tw + 12 <= r - l) h += `<text x="${x0 + l + 8}" y="${y + 17}" font-size="11" font-weight="600" fill="${P.text}">${esc(lab)}</text>`; }
      else if (tw + 4 <= r - l) h += `<text x="${x0 + (l + r) / 2}" y="${y + 17}" font-size="11" text-anchor="middle" fill="${P.muted}">${esc(lab)}</text>`;
    }
    h += `<line x1="${x0}" x2="${x0 + W}" y1="${y + 26}" y2="${y + 26}" stroke="${i ? P.gridStrong : P.grid}"/>`;
  });
  const td = todayDay();
  if (td >= sc.start && td <= sc.end) {
    const x = x0 + sc.x(td) + sc.ppd / 2;
    h += `<rect x="${x - 19}" y="${HEAD - 18}" width="38" height="16" rx="8" fill="${P.today}"/><text x="${x}" y="${HEAD - 6.5}" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">${tr('Idag')}</text>`;
  }
  return h;
}

/* =========================================================
   GANTT
   ========================================================= */
function buildRows() {
  const vis = visibleTasks();
  const rows = [];
  const unscheduled = [];
  for (const b of bucketList()) {
    const ts = vis.filter(t => (t.bucket || 'Övrigt') === b);
    if (!ts.length) continue;
    const sched = ts.filter(t => t.start || t.end).sort((x, y) => (toDay(x.start || x.end) - toDay(y.start || y.end)) || (toDay(x.end) - toDay(y.end)));
    unscheduled.push(...ts.filter(t => !t.start && !t.end));
    if (!sched.length) continue;
    const s = Math.min(...sched.map(t => toDay(t.start || t.end))), e = Math.max(...sched.map(t => toDay(t.end || t.start)));
    const prog = Math.round(sched.reduce((a, t) => a + (t.progress || 0), 0) / sched.length);
    const collapsed = !!(plan.settings.collapsed || {})[b];
    rows.push({ type: 'group', bucket: b, tasks: sched, s, e, prog, collapsed });
    if (!collapsed) sched.forEach(t => rows.push({ type: 'task', t }));
  }
  if (unscheduled.length) {
    rows.push({ type: 'group', bucket: 'Ej schemalagda', tasks: unscheduled, s: null, e: null, prog: 0, unsched: true, collapsed: !!(plan.settings.collapsed || {})['Ej schemalagda'] });
    if (!(plan.settings.collapsed || {})['Ej schemalagda']) unscheduled.forEach(t => rows.push({ type: 'task', t }));
  }
  return rows;
}

function leftRowsHTML(rows) {
  const q = search.trim();
  return rows.map(r => {
    if (r.pgates) {
      return `<div class="g-row proj pgates" data-key="${esc(r.key)}" style="height:${ROW}px" title="${tr('Visa gate-översikten')}">
        <div class="c-name"><span class="pg-flag">🚩</span><span class="nm">${esc(r.name)}</span><span class="cnt">${r.n}</span></div>
        <div class="c-ass"></div><div class="c-d">${fmtShort(r.s)}</div><div class="c-d">${fmtShort(r.e)}</div><div class="c-p"></div><div class="c-h"></div></div>`;
    }
    if (r.type === 'project') {
      return `<div class="g-row proj ${r.collapsed ? '' : 'open'} ${r.group ? 'pgroup' : ''} ${r.lvl ? 'lvl' + r.lvl : ''}" data-key="${esc(r.key)}" style="height:${ROW}px">
        <div class="c-name"><button class="chev">▼</button><span class="nm" title="${esc(r.name)}">${esc(r.name)}</span>${r.tag ? `<span class="ptag">${esc(r.tag)}</span>` : ''}<span class="cnt">${r.n}</span></div>
        <div class="c-ass"></div><div class="c-d">${r.s == null ? '' : fmtShort(r.s)}</div><div class="c-d">${r.e == null ? '' : fmtShort(r.e)}</div><div class="c-p">${r.prog}%</div><div class="c-h"></div></div>`;
    }
    if (r.type === 'group') {
      const col = r.unsched ? PAL.other : colorOf(r.bucket);
      return `<div class="g-row grp ${r.unsched ? '' : 'strong'} ${r.sub ? 'sub' : ''} ${r.collapsed ? 'collapsed' : ''}" data-bucket="${esc(r.bucket)}" style="height:${ROW}px;--ph:${col};--ph-ink:${inkOn(col)}">
        <div class="c-name"><button class="chev">▼</button><span class="swatch" style="background:${col}"></span><span class="nm">${esc(r.label || bName(r.bucket))}</span><span class="cnt">${r.tasks.length}</span>
        ${r.unsched || r.sub ? '' : `<span class="ord">${plan.synthetic ? '' : `<button data-burn title="${tr('Burndown för fasen')}">📉</button>`}<button data-color title="${tr('Välj färg för fasen')}">🎨</button><button data-mv="-1" title="${tr('Flytta upp')}">↑</button><button data-mv="1" title="${tr('Flytta ner')}">↓</button></span>`}</div>
        <div class="c-ass"></div><div class="c-d">${r.unsched ? '' : fmtShort(r.s)}</div><div class="c-d">${r.unsched ? '' : fmtShort(r.e)}</div><div class="c-p">${r.unsched ? '' : r.prog + '%'}</div>${hoursCell(r.tasks)}</div>`;
    }
    const t = r.t, st = statusOf(t), col = colorOf(t.bucket || 'Övrigt');
    const icon = t.milestone ? `<span class="ico-ms" style="background:${col}"></span>` : `<span class="ico-bar" style="background:${col}"></span>`;
    const flag = (st === 'late' ? `<span class="flag late" title="${tr('Försenad')}">${tr('! Sen')}</span>` : st === 'done' ? `<span class="flag done" title="${tr('Klar')}">✓</span>` : '')
      + (t.moved ? `<span class="flag moved" title="${tr('Flyttad {d} dagar sedan förra importen', { d: (t.moved.days > 0 ? '+' : '') + t.moved.days })}">⇄ ${t.moved.days > 0 ? '+' : ''}${t.moved.days} d</span>` : '')
      + (t.check ? `<span class="flag chk" title="${esc(t.check)}">${tr('? Kontrollera')}</span>` : '')
      + (docCount(t) ? `<span class="flag doc" title="${tr('{n} dokument', { n: docCount(t) })}">📎 ${docCount(t)}</span>` : '')
      + chkFlag(t);
    return `<div class="g-row task ${st} ${q ? 'match' : ''} ${r.sub ? 'sub' : ''}${checkStat(t) ? ' has-checks' : ''}" data-id="${esc(t.id)}" style="height:${ROW}px;--ph:${!t.start && !t.end ? PAL.other : col}">
      <div class="c-name">${icon}<span class="nm" title="${esc(t.name)}">${esc(t.name)}</span>${flag}</div>
      <div class="c-ass" title="${esc(t.assignees)}">${esc(shortNames(t.assignees))}</div>
      <div class="c-d">${t.milestone ? '' : fmtShort(toDay(t.start))}</div><div class="c-d">${fmtShort(toDay(t.end))}</div><div class="c-p">${t.progress || 0}%</div>${hoursCell([t])}</div>`;
  }).join('');
}

// Timmar i listan (#94): planerad insats; fasraden summerar sina aktiviteter. Titeln visar kvar.
function hoursCell(ts) {
  if (!ui.showHours) return '';
  const w = ts.filter(t => t.effort), p = w.reduce((a, t) => a + (effortPlanned(t.effort) || 0), 0), l = w.reduce((a, t) => a + (effortLeft(t) || 0), 0);
  return `<div class="c-h" ${w.length ? `title="${esc(tr('Planerat {p} · kvar {l}', { p: fmtH(p), l: fmtH(l) }))}"` : ''}>${w.length ? numFmt(p) : ''}</div>`;
}
function shortNames(s) {
  if (!s) return '';
  const names = s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
  const first = names[0].split(/\s+/);
  const short = first.length > 1 ? `${first[0]} ${first[first.length - 1][0]}.` : first[0];
  return names.length > 1 ? `${short} +${names.length - 1}` : short;
}

function barGeom(t, sc) {
  const s = toDay(t.start || t.end), e = toDay(t.end || t.start);
  return { x: sc.x(s), w: Math.max(sc.ppd, (e - s + 1) * sc.ppd), s, e };
}

// "ändrad"-etikett i program-Gantt (#22) på aktiviteter vars beroende påverkats av en uppdatering
const chgBadge = t => t._chg ? `<tspan fill="#b45309" font-weight="700"> · ${tr('ändrad')} ${t._chg.deltaDays != null ? fmtDW(t._chg.deltaDays) : ''}</tspan>` : '';
function ganttBodySVG(rows, sc) {
  const P = PAL, W = sc.width, H = Math.max(rows.length * ROW, 1);
  const td = todayDay();
  let bg = '', grid = '', deps = '', bars = '', xdeps = '';
  const rowIdx = new Map();
  rows.forEach((r, i) => {
    if (r.type === 'project') bg += `<rect y="${i * ROW}" width="${W}" height="${ROW}" fill="${P.panel}"/>`;
    else if (r.type === 'group') bg += r.unsched ? `<rect y="${i * ROW}" width="${W}" height="${ROW}" fill="${P.panel2}"/>`
      : `<rect y="${i * ROW}" width="${W}" height="${ROW}" fill="${colorOf(r.bucket)}" fill-opacity=".14"/>`;
    else rowIdx.set(r.t.id, i);
    bg += `<line x1="0" x2="${W}" y1="${(i + 1) * ROW - .5}" y2="${(i + 1) * ROW - .5}" stroke="${P.grid}"/>`;
  });
  if (ui.zoom === 'week') for (const tk of ticks('day', sc.start, sc.end)) if (weekday(tk.a) >= 5) bg += `<rect x="${sc.x(tk.a)}" width="${sc.ppd}" height="${H}" fill="${P.hover}" opacity=".6"/>`;
  const [top, bottom] = GANTT_TIERS[ui.zoom];
  for (const tk of ticks(bottom.unit, sc.start, sc.end)) grid += `<line x1="${sc.x(tk.a)}" x2="${sc.x(tk.a)}" y2="${H}" stroke="${P.grid}"/>`;
  for (const tk of ticks(top.unit, sc.start, sc.end)) grid += `<line x1="${sc.x(tk.a)}" x2="${sc.x(tk.a)}" y2="${H}" stroke="${P.gridStrong}"/>`;

  // Kritisk linje (#4): kritiska (slack ≤ 0) och nära kritiska (≤ 1 vecka) markeras, övriga tonas ned
  const cp = critOn() ? critFor() : null, ci = id => (cp && cp.byId.get(id)) || {};
  const cpCls = id => { if (!cp) return ''; const r = ci(id); return r.critical ? 'cp-crit' : r.near ? 'cp-near' : 'cp-dim'; };
  // Hopfällt projekt i programmet: antal kritiska i projektets planer
  const cpProj = r => { if (!cp || r.pgates) return ''; const ids = r.members || [r.key]; const n = cp.critical.filter(id => ids.includes((byIdAll.get(id) || {})._plan)).length; return n ? `<tspan fill="${P.critical}" font-weight="600"> · ${tr('{n} kritiska', { n })}</tspan>` : ''; };
  const byIdAll = cp ? new Map(plan.tasks.map(t => [t.id, t])) : new Map();
  // Baslinje (#5): tunn grå stapel under aktiviteten, ofylld romb under milstolpen
  const bl = blShown();
  const blMark = (t, yc) => {
    const b = bl && bl.tasks[t.id];
    if (!b) return '';
    const bs = toDay(b.s), be = toDay(b.e), tip = `<title>${esc(tr('Baslinje {name}', { name: bl.name }))}: ${t.milestone ? fmtDayY(be) : `${fmtDay(bs)} – ${fmtDayY(be)}`}</title>`;
    if (t.milestone) { const cx = sc.x(be) + sc.ppd / 2, cy = yc + 12, k = 4; return `<polygon class="bl-mark" points="${cx},${cy - k} ${cx + k},${cy} ${cx},${cy + k} ${cx - k},${cy}" fill="${P.surface}" stroke="${P.muted}" stroke-width="1.5">${tip}</polygon>`; }
    return `<rect class="bl-mark" x="${sc.x(bs)}" y="${yc + BAR / 2 + 2}" width="${Math.max((be - bs + 1) * sc.ppd, 2)}" height="4" rx="2" fill="${P.muted}" opacity=".8">${tip}</rect>`;
  };
  const cpSlack = t => { const r = ci(t.id); return cp && (r.critical || r.near) ? `<tspan fill="${r.critical ? P.critical : NEAR_COL}" font-weight="600"> · ${tr('slack')} ${fmtSlack(r.slack, cp.wpw)}</tspan>` : ''; };
  // Beroenden (#83: typ och fördröjning ur t.depInfo – pilen går från föregångarens start eller slut till efterföljarens start eller slut)
  const byId = new Map(plan.tasks.map(t => [t.id, t])), depCal = critCal();
  rows.forEach((r, i) => {
    if (r.type !== 'task' || !(r.t.deps || []).length || !(r.t.start || r.t.end)) return;
    const g2 = barGeom(r.t, sc);
    const y2 = i * ROW + ROW / 2;
    for (const did of r.t.deps) {
      const p = byId.get(did); const j = rowIdx.get(did);
      if (!p || j == null || !(p.end || p.start)) continue;
      const g1 = barGeom(p, sc), inf = depInfoOf(r.t, did), fromS = inf.type[0] === 'S', toF = inf.type[1] === 'F';
      // Föregångarens start (vänster kant) eller slut (höger kant); efterföljarens start (in från vänster) eller slut (in från höger)
      const x1 = p.milestone ? g1.x + sc.ppd / 2 + (fromS ? -8 : 8) : fromS ? g1.x : g1.x + g1.w;
      const y1 = j * ROW + ROW / 2;
      const x2 = r.t.milestone ? g2.x + sc.ppd / 2 + (toF ? 8 : -8) : toF ? g2.x + g2.w : g2.x;
      const chk = taskDepCheck(p, r.t, inf, depCal), bad = !!(chk && chk.bad);
      const a = ci(did), b = ci(r.t.id), crit = !!cp && a.critical && b.critical, near = !!cp && !crit && (a.critical || a.near) && (b.critical || b.near);
      const col = bad || crit ? P.critical : near ? NEAR_COL : P.muted;
      const dir = y2 > y1 ? 1 : -1, xa = x1 + (fromS ? -8 : 8), xin = toF ? 1 : -1; // xin: sidan pilen kommer in från
      let d;
      if (toF ? xa - x2 >= 8 : x2 - xa >= 8) d = `M${x1},${y1} H${xa} V${y2} H${x2 + xin * 2}`;
      else { const ym = y2 - dir * ROW / 2; d = `M${x1},${y1} H${xa} V${ym} H${x2 + xin * 10} V${y2} H${x2 + xin * 2}`; }
      const lbl = fmtDepType(inf.type, inf.lag), tip = `${esc(p.name)} → ${esc(r.t.name)} · ${esc(lbl)} (${esc(tr(DEP_TYPES[inf.type]))})${bad ? ' · ' + esc(tr('bryter mot beroendet')) : ''}`;
      deps += `<g class="dep-arr" data-dep="${esc(did)}"><title>${tip}</title><path d="${d}" fill="none" stroke="transparent" stroke-width="8"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${crit ? 2.5 : near ? 1.75 : 1.25}" marker-end="url(#arr${bad || crit ? 'Bad' : near ? 'Near' : ''})" opacity="${cp && !crit && !near && !bad ? .45 : .9}" ${crit ? 'class="cp-arrow"' : ''} ${inf.type !== 'FS' ? 'stroke-dasharray="6 2"' : ''}/></g>`;
    }
  });

  // Beroenden mellan projekt (programvyn): pil i statusfärg; hopfällt projekt → pilen fäster i projektraden (streckad)
  if (plan.synthetic && plan.xdeps.length) {
    const projIdx = new Map(); rows.forEach((r, i) => { if (r.type === 'project') { projIdx.set(r.key, i); (r.members || []).forEach(id => projIdx.set(id, i)); } });
    for (const x of plan.xdeps) {
      const p = byId.get(x.from), s = byId.get(x.to);
      const i1 = rowIdx.get(x.from) ?? projIdx.get(x.fromPlan), i2 = rowIdx.get(x.to) ?? projIdx.get(x.toPlan);
      if (!p || !s || i1 == null || i2 == null || !(p.end || p.start) || !(s.start || s.end)) continue;
      const g1 = barGeom(p, sc), g2 = barGeom(s, sc), col = depColor(x.status);
      const x1 = g1.x + g1.w, y1 = i1 * ROW + ROW / 2, x2 = g2.x, y2 = i2 * ROW + ROW / 2;
      const dash = rowIdx.has(x.from) && rowIdx.has(x.to) ? '' : 'stroke-dasharray="5 3"';
      const d = x2 - x1 >= 16 ? `M${x1},${y1} H${x1 + 8} V${y2} H${x2 - 2}` : `M${x1},${y1} H${x1 + 8} V${y2 - Math.sign(y2 - y1 || 1) * ROW / 2} H${x2 - 10} V${y2} H${x2 - 2}`;
      const chg = x.changed ? ` · ${tr('ändrad')}: ${tr('marginal {a} → {b}', { a: fmtDW(x.changed.before.margin), b: fmtDW(x.changed.after.margin) })}` : '';
      if (cp && ci(x.from).critical && ci(x.to).critical) xdeps += `<path class="cp-arrow" d="${d}" fill="none" stroke="${P.critical}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".3"/>`;
      if (x.changed) xdeps += `<path class="xdep-chg" d="${d}" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
      xdeps += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.25" ${dash} marker-end="url(#arrX${x.status})" opacity=".95"><title>${esc(x.label)} → ${tr(DEP_TXT[x.status])} ${fmtMargin(x.margin)}${esc(chg)}</title></path>`;
      if (dash) [[x1, y1], [x2, y2]].forEach(([cx, cy]) => xdeps += `<circle cx="${cx}" cy="${cy}" r="4" fill="${col}" stroke="${P.surface}" stroke-width="1.5"/>`);
    }
  }

  rows.forEach((r, i) => {
    const yc = i * ROW + ROW / 2;
    if (r.type === 'project') {
      // Projektet som sammanfattning: faserna som färgade segment och gaterna som romber
      if (r.s == null) return;
      r.segments.forEach(g => {
        const x = sc.x(g.s), w = (g.e - g.s + 1) * sc.ppd, col = g.col || colorOf(g.key);
        bars += `<rect x="${x}" y="${yc - 7}" width="${Math.max(w, 2)}" height="14" rx="3" fill="${col}" fill-opacity="${g.faint ? .45 : .9}" ${edgeOf(col) !== col ? `stroke="${edgeOf(col)}" stroke-width="1"` : ''}><title>${esc(g.label)}: ${fmtDayY(g.s)} – ${fmtDayY(g.e)}</title></rect>`;
      });
      r.gates.forEach(t => {
        const cx = sc.x(toDay(t.end)) + sc.ppd / 2, s = 7;
        if (t._pg) {
          // Programgate (#21): romb i gatens färg, kant efter status, koden bredvid och en streckad linje genom hela diagrammet
          const col = t._col, st = t._pg.status, edge = st === 'offtrack' ? P.critical : st === 'atrisk' ? edgeOf(GS_YELLOW) : edgeOf(col);
          bg += `<line x1="${cx}" x2="${cx}" y1="${yc + s}" y2="${H}" stroke="${edgeOf(col)}" stroke-dasharray="4 4" opacity=".55"/>`;
          bars += `<polygon points="${cx},${yc - s - 1} ${cx + s + 1},${yc} ${cx},${yc + s + 1} ${cx - s - 1},${yc}" fill="${st === 'done' ? col : P.surface}" stroke="${edge}" stroke-width="2.5"><title>${esc(pgGateTip(t._pg))}</title></polygon>
            <text x="${cx + 11}" y="${yc + 4}" font-size="11" font-weight="700" fill="${P.text}">${esc(t.code)}</text>`;
          return;
        }
        const col = colorOf(t.bucket);
        // Ärvd gate (#67) streckad och blek; egen gate som avviker från huvudplanen får orange kant
        const extra = t._inh ? ` – ${tr('ärvd från huvudplanen {name}', { name: t._inh })}` : t._dev ? ` – ${tr('avviker från huvudplanen ({w}): {d} v', { w: t._dev.mainWeek, d: (t._dev.diffW > 0 ? '+' : '') + t._dev.diffW })}` : '';
        bars += `<polygon points="${cx},${yc - s} ${cx + s},${yc} ${cx},${yc + s} ${cx - s},${yc}" fill="${t.progress >= 100 ? col : P.surface}" stroke="${t._dev ? '#d97706' : edgeOf(col)}" stroke-width="${t._dev ? 2.5 : 2}" ${t._inh ? 'stroke-dasharray="3 2" opacity=".6"' : ''}><title>${esc(t.name)} ${fmtDayY(toDay(t.end))}${esc(extra)}</title></polygon>`;
      });
      bars += `<text x="${sc.x(r.e) + sc.ppd + (r.pgates ? 50 : 10)}" y="${yc + 4}" font-size="12" font-weight="700" fill="${P.text}">${esc(r.name)} <tspan font-weight="400" fill="${P.muted}">${r.prog == null ? '' : r.prog + '%'}</tspan>${r.blocked ? `<tspan fill="${P.critical}"> ⛔ ${tr(r.blocked > 1 ? '{n} blockerade' : '{n} blockerad', { n: r.blocked })}</tspan>` : ''}${r.changed ? `<tspan fill="#b45309"> ⚠ ${tr(r.changed > 1 ? '{n} ändrade beroenden' : '{n} ändrat beroende', { n: r.changed })}</tspan>` : ''}${cpProj(r)}</text>`;
      return;
    }
    if (r.type === 'group') {
      if (r.s == null) return;
      const x = sc.x(r.s), w = (r.e - r.s + 1) * sc.ppd, col = colorOf(r.bucket);
      bars += `<g class="grpbar"><rect x="${x}" y="${yc - 11}" width="${w}" height="22" rx="6" fill="${col}" fill-opacity=".55" ${edgeOf(col) !== col ? `stroke="${edgeOf(col)}" stroke-width="1.25"` : ''}/>
        <rect x="${x}" y="${yc - 11}" width="${w * r.prog / 100}" height="22" rx="6" fill="${col}"/>
        ${w > 60 ? `<text x="${x + 8}" y="${yc + 4}" font-size="12" font-weight="700" fill="${inkOn(col)}">${esc(truncate(r.label || bName(r.bucket), 12, 700, w - 16))}</text>` : ''}
        <text x="${x + w + 8}" y="${yc + 4}" font-size="12" font-weight="600" fill="${P.text2}">${r.prog}%</text></g>`;
      return;
    }
    const t = r.t;
    if (!(t.start || t.end)) return;
    const col = colorOf(t.bucket || 'Övrigt'), st = statusOf(t), g = barGeom(t, sc);
    const id = esc(t.id);
    if (t.milestone) {
      const cx = sc.x(toDay(t.end || t.start)) + sc.ppd / 2, s = 8;
      const mr = ci(t.id), ring = cp && (mr.critical || mr.near) ? `<circle cx="${cx}" cy="${yc}" r="12" fill="none" stroke="${mr.critical ? P.critical : NEAR_COL}" stroke-width="${mr.critical ? 2.5 : 1.5}" ${mr.critical ? '' : 'stroke-dasharray="3 2"'}/>` : '';
      bars += `${blMark(t, yc)}<g class="bar ${cpCls(t.id)}" data-id="${id}"><rect x="${cx - 12}" y="${yc - 12}" width="24" height="24" fill="transparent"/>${ring}${t._chg ? `<circle class="chg-ring" cx="${cx}" cy="${yc}" r="13" fill="none" stroke="#d97706" stroke-width="2"/>` : ''}
        <polygon points="${cx},${yc - s} ${cx + s},${yc} ${cx},${yc + s} ${cx - s},${yc}" fill="${msFill(t, st, col)}" stroke="${msEdge(t, st, col)}" stroke-width="2.5" stroke-linejoin="round"/>
        <text x="${cx + 14}" y="${yc + 4}" font-size="12" font-weight="600" fill="${P.text}">${esc(t.name)}${gateBadge(t)}${docBadge(t)}${chkBadge(t)}${chgBadge(t)}${cpSlack(t)}${blBadge(t, bl)}</text></g>`;
      return;
    }
    const y = yc - BAR / 2, pw = g.w * clamp(t.progress || 0, 0, 100) / 100;
    const blk = (t.xdeps || []).filter(x => x.status === 'blockerad').sort((a, b) => a.margin - b.margin)[0];
    const br = ci(t.id), cpRing = cp && (br.critical || br.near) ? `<rect x="${g.x - 3}" y="${y - 3}" width="${g.w + 6}" height="${BAR + 6}" rx="6" fill="none" stroke="${br.critical ? P.critical : NEAR_COL}" stroke-width="${br.critical ? 2.5 : 1.5}" ${br.critical ? '' : 'stroke-dasharray="4 3"'}/>` : '';
    bars += `${blMark(t, yc)}<g class="bar ${cpCls(t.id)}" data-id="${id}">${cpRing}${t._chg ? `<rect class="chg-ring" x="${g.x - 4}" y="${y - 4}" width="${g.w + 8}" height="${BAR + 8}" rx="7" fill="none" stroke="#d97706" stroke-width="2"/>` : ''}
      <rect class="trk" x="${g.x}" y="${y}" width="${g.w}" height="${BAR}" rx="4" fill="${col}" fill-opacity=".28" ${blk ? `stroke="${P.critical}" stroke-width="2.5"` : st === 'late' ? `stroke="${P.critical}" stroke-width="1.5"` : edgeOf(col) !== col ? `stroke="${edgeOf(col)}" stroke-width="1.25"` : ''}/>
      ${pw > 0 ? `<rect x="${g.x}" y="${y}" width="${pw}" height="${BAR}" rx="4" fill="${col}"/>` : ''}
      <rect data-h="l" x="${g.x - 3}" y="${y}" width="8" height="${BAR}" fill="transparent"/>
      <rect data-h="r" x="${g.x + g.w - 5}" y="${y}" width="8" height="${BAR}" fill="transparent"/>
      <text x="${g.x + g.w + 8}" y="${yc + 4}" font-size="12" fill="${blk ? P.critical : st === 'done' ? P.muted : P.text2}" ${blk ? 'font-weight="600"' : ''}>${blk ? `⛔ ${esc(t.name)} – ${tr('väntar på')} ${esc(blk.label)} (${fmtShort(toDay(blk.fromEnd))}) · ${fmtMargin(blk.margin)}` : esc(t.name)}${docBadge(t)}${chkBadge(t)}${chgBadge(t)}${cpSlack(t)}${blBadge(t, bl)}</text></g>`;
  });

  let today = '';
  if (td >= sc.start && td <= sc.end) { const x = sc.x(td) + sc.ppd / 2; today = `<line x1="${x}" x2="${x}" y2="${H}" stroke="${P.today}" stroke-width="2"/>`; }

  const defs = `<defs>
    <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${P.muted}"/></marker>
    <marker id="arrBad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${P.critical}"/></marker>
    <marker id="arrNear" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${NEAR_COL}"/></marker>
    ${plan.synthetic ? Object.keys(DEP_TXT).map(k => `<marker id="arrX${k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${depColor(k)}"/></marker>`).join('') : ''}</defs>`;
  return { svg: defs + bg + grid + today + deps + bars + xdeps, H };
}

function renderGantt(keepScroll = true) {
  const rows = plan.synthetic ? buildProgramRows() : buildRows();
  // Vald baslinje (#5) räknas in i skalan, så att grå staplar före eller efter planen syns
  const blx = blShown(), blExtra = blx ? Object.values(blx.tasks).map(b => ({ start: b.s, end: b.e })) : [];
  const sc = ganttScale((plan.pgTasks ? plan.tasks.concat(plan.pgTasks) : plan.tasks).concat(blExtra), ui.zoom);
  ganttCtx = { rows, sc };
  const app = $('#app');
  app.style.setProperty('--left-w', leftW() + 'px');
  app.style.setProperty('--cols', ui.showHours ? COLS_H : COLS);
  app.classList.toggle('show-h', !!ui.showHours);
  $('#gLeft').innerHTML = leftRowsHTML(rows);
  const head = $('#gHeadSvg');
  head.setAttribute('width', sc.width); head.setAttribute('height', HEAD);
  head.setAttribute('font-family', FONT);
  head.innerHTML = headerSVG(sc, GANTT_TIERS[ui.zoom]);
  drawGanttBody();
  if (!keepScroll) scrollToToday();
}

function drawGanttBody() {
  const { rows, sc } = ganttCtx;
  critDirty = true; // datum kan ha ändrats (dra, spara, ångra) – kritiska linjen räknas om
  const body = $('#gBodySvg');
  const { svg, H } = ganttBodySVG(rows, sc);
  body.setAttribute('width', sc.width); body.setAttribute('height', H);
  body.setAttribute('font-family', FONT);
  body.innerHTML = svg;
}

function scrollToToday() {
  if (ui.view === 'gantt' && ganttCtx) {
    const el = $('#gScroll');
    el.scrollLeft = Math.max(0, ganttCtx.sc.x(todayDay()) - (el.clientWidth - leftW()) * 0.3);
  }
}

/* Drag to move / resize bars */
let drag = null;
function setupGanttInteraction() {
  const body = $('#gBodySvg');
  body.addEventListener('pointerdown', e => {
    if (plan.synthetic) return; // programmet visar planerna, men ändrar dem aldrig
    const g = e.target.closest('.bar'); if (!g) return;
    const t = plan.tasks.find(x => x.id === g.dataset.id); if (!t) return;
    drag = { t, mode: e.target.dataset.h || 'move', x0: e.clientX, s0: toDay(t.start || t.end), e0: toDay(t.end || t.start), moved: false, snap: JSON.stringify({ tasks: plan.tasks, settings: plan.settings }) };
    if (t.milestone) drag.mode = 'move';
    body.setPointerCapture(e.pointerId);
    hideTip();
  });
  body.addEventListener('pointermove', e => {
    if (!drag) { tipFromEvent(e); return; }
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true;
    const dd = Math.round(dx / ganttCtx.sc.ppd);
    let s = drag.s0, en = drag.e0;
    if (drag.mode === 'move') { s += dd; en += dd; }
    else if (drag.mode === 'l') s = Math.min(drag.s0 + dd, en);
    else en = Math.max(drag.e0 + dd, s);
    if (drag.t.milestone) { drag.t.end = fromDay(en); drag.t.start = fromDay(en); }
    else { drag.t.start = fromDay(s); drag.t.end = fromDay(en); }
    drawGanttBody();
    showTip(e.clientX, e.clientY, `<div class="tt-title">${esc(drag.t.name)}</div><div class="tt-row"><span>${drag.t.milestone ? tr('Datum') : tr('Period')}</span><b>${drag.t.milestone ? fmtDayY(en) : fmtDay(s) + ' – ' + fmtDayY(en)}</b></div>`);
  });
  const end = e => {
    if (!drag) return;
    const d = drag; drag = null; hideTip();
    if (d.moved) {
      undoStack.push(d.snap); $('#undoBtn').disabled = false;
      d.t.dateEdited = true;
      scheduleSave(); render();
    } else openDrawer(d.t.id);
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
  body.addEventListener('pointerleave', () => { if (!drag) hideTip(); });

  $('#gLeft').addEventListener('click', e => {
    const pr = e.target.closest('.proj');
    if (pr && pr.classList.contains('pgates')) { ui.pgView = 'gates'; saveUi(); render(true); return; }
    if (pr) { ui.pgOpen = { ...(ui.pgOpen || {}), [pr.dataset.key]: !(ui.pgOpen || {})[pr.dataset.key] }; saveUi(); renderGantt(); return; }
    const mv = e.target.closest('[data-mv]');
    const grp = e.target.closest('.grp');
    if (mv && grp) { moveBucket(grp.dataset.bucket, +mv.dataset.mv); return; }
    if (e.target.closest('[data-color]') && grp) { openColors(grp.dataset.bucket); return; }
    if (e.target.closest('[data-burn]') && grp) { openBurndown(burnScopeKey(grp.dataset.bucket)); return; }
    if (grp) {
      plan.settings.collapsed = plan.settings.collapsed || {};
      plan.settings.collapsed[grp.dataset.bucket] = !plan.settings.collapsed[grp.dataset.bucket];
      scheduleSave(); renderGantt(); return;
    }
    const row = e.target.closest('.task'); if (row && !plan.synthetic) openDrawer(row.dataset.id);
  });
}

/* ---------- Färger för faser (#74): ⋯ → 🎨 Färger… eller 🎨 på fasraden ----------
   Palett för hela planen och färg per fas (förvalda färger med god kontrast eller egen). Ändringarna är en arbetskopia
   som sparas med Spara (Ångra fungerar). only = en fas (från fasraden). */
const PALETTE_NAMES = { pmi: 'PMI', standard: 'Standard', mjuk: 'Mjuk', kontrast: 'Hög kontrast' };
async function openColors(only, carry) {
  if (ui.mode === 'program' || !plan || plan.synthetic) return toast(tr('Färger väljs i varje plan – öppna planen först.'));
  const p = plan, buckets = bucketList();
  if (!buckets.length) return toast(tr('Planen har inga faser än.'));
  const work = carry || { palette: p.settings.palette || null, phaseColors: { ...cleanPhaseColors(p.settings.phaseColors) } };
  const bg = PAL && isHexColor(PAL.surface) ? PAL.surface : '#ffffff';
  const show = only ? [only] : buckets;
  const ids = PALETTE_IDS;
  const palSw = id => (id === 'pmi' ? PMI_PHASES.map(x => x.col) : id === 'mjuk' ? PAL_MJUK : id === 'kontrast' ? PAL_KONTRAST : PAL.series)
    .map(c => `<i style="background:${c}"></i>`).join('');
  const cur = b => phaseColor({ ...p.settings, palette: work.palette, phaseColors: work.phaseColors }, b, PAL.series, PAL.other);
  const rowHTML = (b, i) => {
    const col = cur(b), own = !!work.phaseColors[b], r = contrastRatio(col, bg);
    return `<div class="col-row" data-b="${i}">
      <span class="col-chip" style="background:${col};color:${inkOn(col)};border-color:${edgeOf(col)}">${esc(bName(b))}</span>
      <span class="col-pre">${COLOR_PRESETS.map(c => `<button class="col-sw ${own && work.phaseColors[b] === c ? 'on' : ''}" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('')}</span>
      <label class="col-own" title="${tr('Egen färg')}">${tr('Egen…')}<input type="color" data-own value="${col}"></label>
      <button class="btn ghost small" data-reset ${own ? '' : 'disabled'} title="${tr('Tillbaka till palettens färg')}">${tr('Återställ')}</button>
      ${own && r != null && r < 3 ? `<div class="col-warn">⚠ ${tr('Låg kontrast mot bakgrunden ({r}:1, minst 3:1). Kanten mörkas automatiskt, men en mörkare färg syns bättre.', { r: LANG === 'en' ? r.toFixed(1) : r.toFixed(1).replace('.', ',') })}</div>` : ''}
    </div>`;
  };
  const draw = () => {
    const m = $('#colBody'); if (!m) return;
    const pal = paletteId({ palette: work.palette });
    m.innerHTML = `${only ? '' : `<div class="col-pals">${ids.map(id => `<button class="col-pal ${pal === id ? 'on' : ''}" data-pal="${id}"><b>${tr(PALETTE_NAMES[id])}</b><span class="col-psw">${palSw(id)}</span></button>`).join('')}</div>
      <p class="col-help">${pal === 'pmi' ? tr('PMI: faser som känns igen får PMI-färgerna, övriga får Standard.') : tr('Paletten gäller alla faser utan egen färg.')}</p>`}
      <div class="col-list">${show.map(b => rowHTML(b, buckets.indexOf(b))).join('')}</div>`;
  };
  const done = dialog({ title: only ? tr('Färg för {name}', { name: esc(bName(only)) }) : tr('🎨 Färger'), wide: !only,
    body: `<div id="colBody" class="col-body"></div>`,
    buttons: [...(only ? [{ label: tr('Alla faser och palett…'), value: 'all', ghost: true }] : [{ label: tr('Återställ alla'), value: 'resetall', ghost: true, keep: true }]),
      { label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara'), value: 'save' }],
    onButton: v => { if (v === 'resetall') { work.palette = null; work.phaseColors = {}; draw(); } },
    onBody: e => {
      const pb = e.target.closest('[data-pal]'); if (pb) { work.palette = pb.dataset.pal; draw(); return; }
      const row = e.target.closest('.col-row'); if (!row) return;
      const b = buckets[+row.dataset.b];
      const sw = e.target.closest('[data-c]'); if (sw) { work.phaseColors[b] = sw.dataset.c; draw(); return; }
      if (e.target.closest('[data-reset]')) { delete work.phaseColors[b]; draw(); }
    } });
  draw();
  const onInput = e => { const inp = e.target.closest('[data-own]'); if (!inp) return; const row = inp.closest('.col-row');
    if (isHexColor(inp.value)) { work.phaseColors[buckets[+row.dataset.b]] = inp.value.toLowerCase(); if (e.type === 'change') draw(); } };
  $('#modal').addEventListener('change', onInput);
  const v = await done;
  $('#modal').removeEventListener('change', onInput);
  if (v === 'all') return openColors(null, work);
  if (v !== 'save' || plan !== p) return;
  pushUndo();
  if (work.palette) p.settings.palette = work.palette; else delete p.settings.palette;
  const pc = cleanPhaseColors(work.phaseColors);
  if (Object.keys(pc).length) p.settings.phaseColors = pc; else delete p.settings.phaseColors;
  scheduleSave(); render();
}

function moveBucket(b, dir) {
  const order = bucketList();
  const i = order.indexOf(b), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  pushUndo();
  [order[i], order[j]] = [order[j], order[i]];
  plan.settings.bucketOrder = order;
  scheduleSave(); render();
}

/* =========================================================
   ROADMAP
   ========================================================= */
function renderRoadmap() {
  const wrap = $('#rmScroll');
  const W = Math.max(960, wrap.clientWidth);
  const { svg, H } = roadmapSVG(W);
  const el = $('#rmSvg');
  el.setAttribute('width', W); el.setAttribute('height', H);
  el.setAttribute('font-family', FONT);
  el.innerHTML = svg;
}

function packLanes(items) {
  const lanes = [];
  for (const it of items) {
    let k = lanes.findIndex(end => end + 6 <= it.x0);
    if (k < 0) { k = lanes.length; lanes.push(0); }
    lanes[k] = it.x1; it.lane = k;
  }
  return lanes.length;
}

function roadmapSVG(W) {
  const P = PAL, LABEL_W = 200, PAD_R = 24;
  const vis = visibleTasks().filter(t => t.start || t.end);
  let { s, e } = planRange(vis.length ? vis : plan.tasks);
  s = monthStart(s - 3); e = addMonths(monthStart(e + 3), 1) - 1;
  const tlW = W - LABEL_W - PAD_R;
  const sc0 = makeScale(s, e, tlW / (e - s + 1));
  const sc = { ...sc0, width: tlW, x: d => LABEL_W + (d - s) * sc0.ppd };
  const tiers = sc0.ppd * 30 >= 26 ? [TIER.quarterLong, TIER.month] : [TIER.year, TIER.quarter];

  let out = '';
  // Header (re-use with offset)
  const hsc = makeScale(s, e, sc0.ppd); hsc.width = tlW;
  out += `<rect width="${W}" height="${HEAD}" fill="${P.panel}"/>` + headerSVG(hsc, tiers, LABEL_W);
  out += `<text x="16" y="32" font-size="11" font-weight="600" fill="${P.muted}" letter-spacing=".5">${tr('FAS')}</text>`;
  let y = HEAD;
  const body = [];
  const td = todayDay();

  // Milestone lane
  const ms = vis.filter(t => t.milestone).sort((a, b) => toDay(a.end) - toDay(b.end));
  if (ms.length) {
    const items = ms.map(t => { const cx = sc.x(toDay(t.end || t.start)) + sc.ppd / 2; const lab = t.name; const lw = textW(lab, 11.5, 600); return { t, cx, x0: cx - 8, x1: cx + 14 + lw, lab, sub: fmtDay(toDay(t.end)) }; });
    const n = packLanes(items);
    const LH = 34, h = n * LH + 14;
    body.push(`<rect x="0" y="${y}" width="${W}" height="${h}" fill="${P.panel2}"/>
      <text x="16" y="${y + 22}" font-size="13" font-weight="650" fill="${P.text}">${tr('Milstolpar')}</text>
      <text x="16" y="${y + 38}" font-size="11" fill="${P.muted}">${tr('{n} st · {d} nådda', { n: ms.length, d: ms.filter(t => t.progress >= 100).length })}</text>`);
    for (const it of items) {
      const cy = y + 7 + it.lane * LH + 12, col = colorOf(it.t.bucket || 'Övrigt'), st = statusOf(it.t);
      body.push(`<g class="item" data-id="${esc(it.t.id)}">
        <rect x="${it.x0 - 4}" y="${cy - 12}" width="${it.x1 - it.x0 + 8}" height="30" fill="transparent"/>
        <polygon points="${it.cx},${cy - 8} ${it.cx + 8},${cy} ${it.cx},${cy + 8} ${it.cx - 8},${cy}" fill="${msFill(it.t, st, col)}" stroke="${msEdge(it.t, st, col)}" stroke-width="2.5" stroke-linejoin="round"/>
        <text x="${it.cx + 14}" y="${cy + 1}" font-size="11.5" font-weight="600" fill="${P.text}">${esc(it.lab)}</text>
        <text x="${it.cx + 14}" y="${cy + 14}" font-size="10.5" fill="${st === 'late' ? P.critical : P.muted}">${esc(it.sub)}${st === 'late' ? ' · ' + tr('försenad') : st === 'done' ? ' · ' + tr('✓ nådd') : ''}</text></g>`);
    }
    y += h;
    body.push(`<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${P.gridStrong}"/>`);
  }

  // Swimlanes per bucket
  for (const b of bucketList()) {
    const ts = vis.filter(t => (t.bucket || 'Övrigt') === b && !t.milestone)
      .sort((p, q) => toDay(p.start || p.end) - toDay(q.start || q.end));
    const msB = vis.filter(t => (t.bucket || 'Övrigt') === b && t.milestone);
    if (!ts.length && !msB.length) continue;
    const col = colorOf(b);
    const all = [...ts, ...msB];
    const prog = Math.round(all.reduce((a, t) => a + (t.progress || 0), 0) / all.length);
    const late = all.filter(t => statusOf(t) === 'late').length;
    let h, inner = '';
    if (ui.detail === 'summary') {
      h = 56;
      if (ts.length) {
        const s1 = Math.min(...ts.map(t => toDay(t.start || t.end))), e1 = Math.max(...ts.map(t => toDay(t.end || t.start)));
        const x = sc.x(s1), w = Math.max(6, (e1 - s1 + 1) * sc.ppd), yc = y + h / 2;
        const lab = `${fmtDay(s1)} – ${fmtDay(e1)}`;
        inner += `<rect x="${x}" y="${yc - 13}" width="${w}" height="26" rx="6" fill="${col}" fill-opacity=".22" ${edgeOf(col) !== col ? `stroke="${edgeOf(col)}" stroke-width="1"` : ''}/>
          <rect x="${x}" y="${yc - 13}" width="${w * prog / 100}" height="26" rx="6" fill="${col}" fill-opacity=".55"/>
          <rect x="${x}" y="${yc - 13}" width="4" height="26" rx="2" fill="${col}"/>`;
        const lw = textW(lab, 11.5, 600);
        inner += lw + 20 <= w ? `<text x="${x + 12}" y="${yc + 4}" font-size="11.5" font-weight="600" fill="${P.text}">${lab}</text>`
          : `<text x="${x + w + 8}" y="${yc + 4}" font-size="11.5" font-weight="600" fill="${P.text}">${lab}</text>`;
      }
      for (const t of msB) {
        const cx = sc.x(toDay(t.end || t.start)) + sc.ppd / 2, cy = y + h / 2, st = statusOf(t);
        inner += `<g class="item" data-id="${esc(t.id)}"><polygon points="${cx},${cy - 9} ${cx + 9},${cy} ${cx},${cy + 9} ${cx - 9},${cy}" fill="${msFill(t, st, col)}" stroke="${msEdge(t, st, col)}" stroke-width="2.5" stroke-linejoin="round"/></g>`;
      }
    } else {
      const items = ts.map(t => {
        const g = barGeom(t, sc);
        const lw = textW(t.name, 11.5, 500);
        const inside = lw + 22 <= g.w;
        return { t, g, inside, lw, x0: g.x, x1: inside ? g.x + g.w : g.x + g.w + 8 + lw };
      });
      const n = Math.max(1, packLanes(items));
      const LH = 32;
      h = Math.max(56, n * LH + 16);
      for (const it of items) {
        const t = it.t, g = it.g, yt = y + 8 + it.lane * LH + 2, st = statusOf(t);
        const pw = g.w * clamp(t.progress || 0, 0, 100) / 100;
        const tx = it.inside ? g.x + 12 : g.x + g.w + 8;
        inner += `<g class="item" data-id="${esc(t.id)}">
          <rect class="bg" x="${g.x}" y="${yt}" width="${g.w}" height="26" rx="6" fill="${col}" fill-opacity=".2" ${st === 'late' ? `stroke="${P.critical}" stroke-width="1.5"` : edgeOf(col) !== col ? `stroke="${edgeOf(col)}" stroke-width="1"` : ''}/>
          ${pw > 0 ? `<rect x="${g.x}" y="${yt + 22}" width="${pw}" height="4" rx="2" fill="${col}"/>` : ''}
          <rect x="${g.x}" y="${yt}" width="${Math.min(4, g.w)}" height="26" rx="2" fill="${col}"/>
          <text x="${tx}" y="${yt + 17}" font-size="11.5" font-weight="500" fill="${st === 'done' ? P.muted : P.text}">${esc(t.name)}${st === 'done' ? ' ✓' : ''}</text>
          ${st === 'late' ? `<circle cx="${g.x + g.w}" cy="${yt}" r="6" fill="${P.critical}"/><text x="${g.x + g.w}" y="${yt + 3.5}" font-size="9" font-weight="800" fill="#fff" text-anchor="middle">!</text>` : ''}</g>`;
      }
    }
    body.push(`<rect x="0" y="${y}" width="${W}" height="${h}" fill="${P.surface}"/>
      <rect x="0" y="${y + 6}" width="4" height="${h - 12}" rx="2" fill="${col}"/>
      <text x="16" y="${y + 24}" font-size="13" font-weight="650" fill="${P.text}">${esc(truncate(bName(b), 13, 650, LABEL_W - 28))}</text>
      <text x="16" y="${y + 40}" font-size="11" fill="${P.muted}">${tr('{n} aktiviteter · {p}% klart', { n: all.length, p: prog })}</text>
      ${late ? `<text x="16" y="${y + 54}" font-size="11" font-weight="600" fill="${P.critical}">! ${tr('{n} försenade', { n: late })}</text>` : ''}
      ${inner}<line x1="0" x2="${W}" y1="${y + h}" y2="${y + h}" stroke="${P.grid}"/>`);
    y += h;
  }
  if (!body.length) body.push(`<text x="${W / 2}" y="${HEAD + 60}" text-anchor="middle" font-size="13" fill="${P.muted}">${tr('Inga schemalagda aktiviteter att visa')}</text>`);
  y += 8;

  // Grid lines behind
  let grid = '';
  for (const tk of ticks(tiers[1].unit, s, e)) grid += `<line x1="${sc.x(tk.a)}" x2="${sc.x(tk.a)}" y1="${HEAD}" y2="${y}" stroke="${P.grid}"/>`;
  for (const tk of ticks(tiers[0].unit, s, e)) grid += `<line x1="${sc.x(tk.a)}" x2="${sc.x(tk.a)}" y1="${HEAD}" y2="${y}" stroke="${P.gridStrong}"/>`;
  grid += `<line x1="${LABEL_W}" x2="${LABEL_W}" y1="0" y2="${y}" stroke="${P.gridStrong}"/>`;
  let today = '';
  if (td >= s && td <= e) { const x = sc.x(td) + sc.ppd / 2; today = `<line x1="${x}" x2="${x}" y1="${HEAD}" y2="${y}" stroke="${P.today}" stroke-width="2"/>`; }

  // Lane backgrounds first, then grid lines, then lane contents
  const bgs = body.map(b => (b.match(/^\s*<rect [^>]*\/>/) || [''])[0]).join('');
  const rest = body.map(b => b.replace(/^\s*<rect [^>]*\/>/, '')).join('');
  return { svg: `<rect width="${W}" height="${y}" fill="${P.surface}"/>${bgs}${grid}${today}${out}${rest}`, H: y };
}

function truncate(s, size, weight, max) {
  if (textW(s, size, weight) <= max) return s;
  let t = s;
  while (t.length > 1 && textW(t + '…', size, weight) > max) t = t.slice(0, -1);
  return t + '…';
}

function setupRoadmapInteraction() {
  const el = $('#rmSvg');
  el.addEventListener('pointermove', tipFromEvent);
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('click', e => { const g = e.target.closest('.item'); if (g) openDrawer(g.dataset.id); });
}

/* ---------- Kritisk linje i Gantt (#4) ----------
   ui.crit (av/på) och ui.critTarget ('end' eller gate-milstolpens id). critFor() räknar om när planen ritats om (critDirty) eller bytts –
   alltså när datum eller beroenden ändrats. Programmet: planerna sammanslagna, programmets beroenden som länkar och varje plans slut för sig. */
let critRes = null, critDirty = true;
const NEAR_COL = '#d97706';
function critCal() {
  if (!plan.synthetic) return calendarOf(plan.settings);
  const ps = (program && program.settings) || {}, first = program && program.plans.map(r => allPlans.find(p => p.id === r.planId)).find(Boolean);
  return calendarOf(ps.calendar ? ps : (first && first.settings) || {});
}
// Gaterna som kan väljas som mål: gate-milstolpar med datum (bas: även egna gater), i datumordning
function critIsGate(t) { return isGateMs(t) || (!plan.synthetic && !!taskGate(t, planGates(plan))); }
function critGates() {
  return plan.tasks.filter(t => t.milestone && toDay(t.end || t.start) != null && critIsGate(t)).sort((a, b) => toDay(a.end || a.start) - toDay(b.end || b.start));
}
function critCode(t) {
  const g = !plan.synthetic ? taskGate(t, planGates(plan)) : null;
  const c = g ? g.code : gateCodeOfName(t.name);
  return t._plan ? `${(allPlans.find(p => p.id === t._plan) || {}).name || ''}: ${c}` : c;
}
const critTargetId = () => ui.critTarget && ui.critTarget !== 'end' && plan.tasks.some(t => t.id === ui.critTarget && t.milestone) ? ui.critTarget : 'end';
function critTargetName(cp = critRes) {
  const id = cp ? cp.target : critTargetId(), t = id !== 'end' && plan.tasks.find(x => x.id === id);
  return t ? critCode(t) : plan.synthetic ? tr('respektive plans slut') : tr('planens slut');
}
function critFor() {
  if (!plan) return null;
  if (critRes && !critDirty && critRes.pid === plan.id) return critRes;
  const opts = { calendar: critCal(), target: critTargetId() };
  let covTasks = plan.tasks;
  if (plan.synthetic) {
    opts.group = t => t._plan;
    // Programmets fördröjning är kalenderdagar (#19) → arbetsdagar
    opts.links = (plan.xdeps || []).map(x => ({ from: x.from, to: x.to, type: x.type, lag: Math.round((+x.lag || 0) * 5 / 7) }));
    covTasks = plan.tasks.map(t => ({ ...t, deps: [...(t.deps || []), ...(plan.xdeps || []).filter(x => x.to === t.id).map(x => x.from)] }));
  }
  // Gate utan föregångare: fasens aktiviteter räknas som föregångare (samma grund som nyckeltalet ⏳, basis 'phase')
  const g = opts.target !== 'end' && plan.tasks.find(t => t.id === opts.target);
  const implicit = g && !(g.deps || []).length && !(opts.links || []).some(l => l.to === g.id) && g.bucket
    ? plan.tasks.filter(t => t !== g && !t.milestone && t.bucket === g.bucket && (t.end || t.start)).map(t => ({ from: t.id, to: g.id })) : [];
  if (implicit.length) opts.links = (opts.links || []).concat(implicit);
  critRes = criticalPath(plan.tasks, opts);
  critRes.pid = plan.id; critRes.cov = depCoverage(covTasks); critRes.implicit = implicit.length; critDirty = false;
  return critRes;
}
const ganttShown = () => !!plan && (plan.synthetic || ui.view === 'gantt');
const critOn = () => !!ui.crit && ganttShown();
// Rad i tooltipen och i panelen
function critTipRow(t) {
  const cp = critFor(), r = cp && cp.byId.get(t.id);
  if (!r || r.slack == null || r.done || r.isTarget) return '';
  const col = r.critical ? 'var(--critical)' : r.near ? NEAR_COL : 'var(--text-primary)';
  return `<div class="tt-row"><span>${tr('Slack')}</span><b style="color:${col}">${fmtSlack(r.slack, cp.wpw)} ${tr('mot {target}', { target: esc(critTargetName(cp)) })}${r.critical ? ' · ' + tr('kritisk') : r.near ? ' · ' + tr('nära kritisk') : ''}</b></div>`;
}
function critPanelHTML(t) {
  const cp = critFor(), r = cp && cp.byId.get(t.id);
  if (!r) return '';
  const span = (a, b) => a && b ? (a === b ? fmtDayY(toDay(a)) : `${fmtDay(toDay(a))} – ${fmtDayY(toDay(b))}`) : '–';
  const head = r.slack == null ? tr('Ingår inte i kedjan mot {target}', { target: esc(critTargetName(cp)) })
    : `${tr('Slack')} <b style="color:${r.critical ? 'var(--critical)' : r.near ? NEAR_COL : 'inherit'}">${fmtSlack(r.slack, cp.wpw)}</b> (${tr('{n} arbetsdagar', { n: r.slack })}) ${tr('mot {target}', { target: esc(critTargetName(cp)) })}${r.done ? '' : r.critical ? ' · ' + tr('kritisk') : r.near ? ' · ' + tr('nära kritisk') : ''}`;
  return `<div class="meta crit-meta" id="critMeta"><b>${tr('Kritisk linje')}</b><br>${head}
    <br><small>${tr('Tidigast')}: ${span(r.es, r.ef)}${r.ls ? ` · ${tr('Senast')}: ${span(r.ls, r.lf)}` : ''}</small>
    <br><small>${tr('Beräknas från beroenden och datum – inga datum ändras.')}</small></div>`;
}
// Gatefunktioner för en plan (bas: egna gater via taskGate) och marginalen till nästa gate – används av nyckeltalet och programkorten
function gateFns(p) {
  const gl = planGates(p);
  return { isGate: t => isGateMs(t) || (!!gl && !!taskGate(t, gl)), code: t => { const g = gl && taskGate(t, gl); return g ? g.code : gateCodeOfName(t.name); } };
}
const planGateMargin = p => p && !p.synthetic ? nextGateMargin(p, todayDay(), { calendar: calendarOf(p.settings), ...gateFns(p) }) : null;
// "⏳ 3 v till DG": text, förklaring och färgklass
function marginTxt(m) {
  const wpw = calendarOf({}).workdays.length;
  const val = m.days == null ? '–' : fmtSlack(m.days, wpw);
  const why = m.basis === 'deps' ? tr('Kedjan som styr: {chain}', { chain: m.chain.map(x => x.name).join(' → ') })
    : m.basis === 'phase' ? tr('Inga beroenden till gaten – räknat från fasens sista aktivitet: {name}', { name: m.chain[0].name })
    : tr('Inga beroenden till gaten och inga aktiviteter i dess fas – lägg till beroenden');
  const cls = m.days == null ? '' : m.days <= 0 ? 'alert' : m.days <= wpw ? 'near' : '';
  return { val, why, cls, sub: m.basis === 'deps' ? tr('marginal enligt beroenden') : m.basis === 'phase' ? tr('marginal i fasen') : tr('saknar beroenden') };
}
function critKpiHTML() {
  const m = planGateMargin(plan);
  if (!m) return '';
  const x = marginTxt(m);
  return `<button class="kpi kpi-btn kpi-crit ${x.cls}" id="kpiCrit" title="${esc(x.why)} – ${tr('klicka för att visa den kritiska linjen mot gaten')}"><b>⏳ ${x.val} ${tr('till {gate}', { gate: esc(m.gate.code) })}</b><span>${x.sub}</span></button>`;
}
function showCritical(gateId) {
  ui.crit = true; ui.critTarget = gateId || 'end'; if (ui.view !== 'gantt') ui.view = 'gantt'; saveUi(); render();
}
// Raden under verktygsfältet: antal kritiska och varningar (låg täckning, cirklar, gate utan föregångare)
function renderCritBar() {
  const on = critOn() && plan.tasks.length > 0, sel = $('#critTarget'), w = $('#critWarn');
  $('#critLbl').hidden = !(ganttShown() && plan.tasks.length); $('#critOn').checked = !!ui.crit;
  sel.hidden = !on; w.hidden = !on;
  if (!on) return;
  const tid = critTargetId();
  sel.innerHTML = `<option value="end">${plan.synthetic ? tr('Mål: respektive plans slut') : tr('Mål: planens slut')}</option>`
    + critGates().map(t => `<option value="${esc(t.id)}" ${t.id === tid ? 'selected' : ''}>${tr('Mål:')} ${esc(critCode(t))} · ${fmtYYWW(toDay(t.end || t.start))}</option>`).join('');
  sel.value = tid;
  const cp = critFor(), warn = [];
  if (cp.cov.pct < CRIT_COVERAGE) warn.push(tr('Bara {n} % av aktiviteterna har beroenden – den kritiska linjen kan vara ofullständig', { n: cp.cov.pct }));
  if (cp.cycles.length) warn.push(tr('{n} aktiviteter ligger i en cirkel av beroenden och räknas inte', { n: cp.cycles.length }));
  const info = cp.implicit ? `<span class="crit-i">ⓘ ${tr('Gaten har inga beroenden – fasens aktiviteter räknas som föregångare')}</span>` : '';
  if (tid !== 'end' && ![...cp.byId].some(([id, r]) => r.inScope && id !== tid)) warn.push(tr('Gaten har inga föregångare – lägg till beroenden eller välj planens slut'));
  w.classList.toggle('warn', warn.length > 0);
  w.innerHTML = `<span class="crit-sum"><i class="crit-key c"></i>${tr('{n} kritiska', { n: cp.critical.length })} <i class="crit-key n"></i>${tr('{n} nära kritiska (slack ≤ 1 vecka)', { n: cp.near.length })} · ${tr('mot {target}', { target: esc(critTargetName(cp)) })} · ${tr('{p} % med beroenden', { p: cp.cov.pct })}</span>${info}${warn.map(x => `<span class="crit-w">⚠ ${x}</span>`).join('')}`;
}

/* ---------- Baslinjer i gränssnittet (#5) ---------- */
const blShown = () => !plan || plan.synthetic ? null : baselinesOf(plan.settings).find(b => b.id === (ui.blSel || {})[plan.id]) || null;
const fmtBlVar = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} d`;
// Avvikelsen i slutdatum efter namnet i Gantt – bara när den inte är noll
function blBadge(t, bl) { const v = bl && baselineVar(t, bl); return v && v.de ? `<tspan fill="${v.de > 0 ? PAL.critical : PAL.good}" font-weight="600"> · ${fmtBlVar(v.de)}</tspan>` : ''; }
function blTipRow(t) {
  const bl = blShown();
  if (!bl || !(t.start || t.end)) return '';
  if (!bl.tasks[t.id]) return `<div class="tt-row"><span>${tr('Baslinje')}</span><b>${tr('ny sedan baslinjen')}</b></div>`;
  const v = baselineVar(t, bl), per = t.milestone ? fmtDayY(toDay(v.e)) : `${fmtDay(toDay(v.s))} – ${fmtDayY(toDay(v.e))}`;
  return `<div class="tt-row"><span>${tr('Baslinje')}</span><b>${per} · ${v.de ? `<span style="color:${v.de > 0 ? 'var(--critical)' : 'var(--good)'}">${tr('slut {d}', { d: fmtBlVar(v.de) })}</span>` : tr('oförändrad')}</b></div>`;
}
function blPanelHTML(t) {
  const bl = blShown();
  if (!bl) return '';
  const v = baselineVar(t, bl);
  const body = !bl.tasks[t.id] ? tr('Aktiviteten är ny sedan baslinjen.') : !v ? tr('Aktiviteten saknar datum nu.')
    : `${t.milestone ? fmtDayY(toDay(v.e)) : `${fmtDay(toDay(v.s))} – ${fmtDayY(toDay(v.e))}`}<br><small>${t.milestone ? '' : `${tr('Start')} ${fmtBlVar(v.ds)} · `}${tr('Slut')} <b style="color:${v.de > 0 ? 'var(--critical)' : v.de < 0 ? 'var(--good)' : 'inherit'}">${fmtBlVar(v.de)}</b> ${tr('jämfört med baslinjen')}</small>`;
  return `<div class="meta" id="blMeta"><b>${tr('Baslinje {name}', { name: esc(bl.name) })}</b><br>${body}</div>`;
}
// Valet i verktygsraden och sammanfattningen bredvid
function renderBaseBar() {
  const sel = $('#blSel'), sum = $('#blSum'), bls = plan && !plan.synthetic ? baselinesOf(plan.settings) : [];
  const on = !!plan && ganttShown() && !plan.synthetic && bls.length > 0, bl = on ? blShown() : null;
  sel.hidden = !on; sum.hidden = !bl;
  if (!on) return;
  sel.innerHTML = `<option value="">${tr('Baslinje: ingen')}</option>` + bls.map(b => `<option value="${esc(b.id)}">${tr('Baslinje:')} ${esc(b.name)}</option>`).join('');
  sel.value = bl ? bl.id : '';
  if (!bl) return;
  const r = baselineSummary(plan.tasks, bl);
  sum.innerHTML = `<b class="bl-late">▲ ${tr('{n} senare', { n: r.later })}</b> · <b class="bl-early">▼ ${tr('{n} tidigare', { n: r.earlier })}</b>${r.added ? ' · ' + tr('{n} nya', { n: r.added }) : ''}${r.removed ? ' · ' + tr('{n} borttagna', { n: r.removed }) : ''}`;
  sum.title = tr('Jämfört med baslinjen {name}, sparad {d}. Största förseningen: {m} dagar.', { name: bl.name, d: fmtDayY(toDay(bl.at.slice(0, 10))), m: r.maxLate });
}
function setBlSel(id) { ui.blSel = { ...(ui.blSel || {}), [plan.id]: id || '' }; saveUi(); }
// ⋯ → 📏 Baslinjer…: spara, välj, byt namn, spara om och ta bort (bekräftas med ett andra klick i stället för en ny dialog)
function openBaselines() {
  if (!plan || plan.synthetic) return toast(tr('Öppna en plan först.'));
  const p = plan;
  const draw = () => {
    const bls = baselinesOf(p.settings), shown = (ui.blSel || {})[p.id] || '', full = bls.length >= BL_MAX;
    $('#blBody').innerHTML = `<div class="bl-new"><input type="text" id="blName" value="${esc(tr('Baslinje {n} – {d}', { n: bls.length + 1, d: fmtDayY(todayDay()) }))}" maxlength="80" ${full ? 'disabled' : ''} aria-label="${tr('Namn på baslinjen')}">
        <button class="btn" data-bl="save" ${full ? 'disabled' : ''}>${tr('📏 Spara baslinje')}</button></div>
      <small class="bl-hint">${full ? tr('Planen har {n} baslinjer, som är max. Ta bort en för att spara en ny.', { n: BL_MAX }) : tr('Sparar start och slut för alla aktiviteter och milstolpar som de ser ut nu. Ge gärna baslinjen ett namn, t.ex. Inför nästa gate.')}</small>
      ${bls.length ? `<table class="bl-tab"><tr><th>${tr('Visa')}</th><th>${tr('Namn')}</th><th>${tr('Sparad')}</th><th>${tr('Aktiviteter')}</th><th></th></tr>
        <tr><td><input type="radio" name="blShow" value="" ${!shown ? 'checked' : ''} aria-label="${tr('Ingen baslinje i Gantt')}"></td><td colspan="4"><i>${tr('Ingen baslinje i Gantt')}</i></td></tr>
        ${bls.map(b => `<tr data-id="${esc(b.id)}"><td><input type="radio" name="blShow" value="${esc(b.id)}" ${b.id === shown ? 'checked' : ''} aria-label="${tr('Visa')} ${esc(b.name)}"></td>
          <td><input type="text" class="bl-name" value="${esc(b.name)}" maxlength="80" aria-label="${tr('Namn på baslinjen')}"></td><td>${b.at ? fmtDayY(toDay(b.at.slice(0, 10))) : '–'}</td><td>${Object.keys(b.tasks).length}</td>
          <td class="bl-acts"><button class="btn ghost small" data-bl="redo" title="${tr('Spara om med planens datum i dag')}">⟳</button><button class="btn ghost small" data-bl="del" title="${tr('Ta bort baslinjen')}">🗑</button></td></tr>`).join('')}</table>`
      : `<p class="bl-hint">${tr('Inga baslinjer ännu.')}</p>`}`;
  };
  const save = () => { scheduleSave(); render(); draw(); };
  dialog({ title: tr('Baslinjer – {name}', { name: esc(p.name) }), body: '<div id="blBody"></div>', wide: true, buttons: [{ label: tr('Stäng'), value: true }],
    onBody: e => {
      const btn = e.target.closest('[data-bl]');
      if (!btn) return;
      const row = btn.closest('tr'), id = row && row.dataset.id, bls = baselinesOf(p.settings);
      if (btn.dataset.bl === 'save') {
        if (bls.length >= BL_MAX) return;
        const bl = makeBaseline(p.tasks, $('#blName').value || tr('Baslinje'));
        pushUndo(); p.settings.baselines = [...bls, bl]; setBlSel(bl.id); save();
        return toast(tr('Baslinjen ”{name}” är sparad', { name: bl.name }));
      }
      // Spara om och ta bort kräver ett andra klick
      if (!btn.dataset.sure) { btn.dataset.sure = '1'; btn.textContent = btn.dataset.bl === 'del' ? tr('Ta bort?') : tr('Skriv över?'); btn.classList.add('danger'); return; }
      pushUndo();
      if (btn.dataset.bl === 'del') { p.settings.baselines = bls.filter(b => b.id !== id); if ((ui.blSel || {})[p.id] === id) setBlSel(''); }
      else { const old = bls.find(b => b.id === id); p.settings.baselines = bls.map(b => b.id === id ? makeBaseline(p.tasks, old.name, new Date().toISOString(), old.id) : b); }
      save();
    } });
  draw();
  $('#blBody').addEventListener('change', e => {
    if (e.target.name === 'blShow') { setBlSel(e.target.value); render(); return; }
    if (e.target.classList.contains('bl-name')) {
      const b = baselinesOf(p.settings).find(x => x.id === e.target.closest('tr').dataset.id), v = e.target.value.trim().slice(0, 80);
      if (b && v && v !== b.name) { pushUndo(); b.name = v; scheduleSave(); render(); }
    }
  });
}

/* ---------- Tooltip ---------- */
// Föregångarna i tooltipen med typ och fördröjning (#83), röd när beroendet bryts; högst fyra
function depTipRows(t) {
  const ds = (t.deps || []).map(d => [d, plan.tasks.find(x => x.id === d)]).filter(([, p]) => p);
  if (!ds.length) return '';
  const cal = critCal();
  return ds.slice(0, 4).map(([d, p]) => { const inf = depInfoOf(t, d), c = taskDepCheck(p, t, inf, cal);
    return `<div class="tt-row"><span>${tr('Efter')}</span><b${c && c.bad ? ' style="color:var(--critical)"' : ''}>${esc(p.name.length > 30 ? p.name.slice(0, 29) + "…" : p.name)} · ${esc(fmtDepType(inf.type, inf.lag))}</b></div>`; }).join('')
    + (ds.length > 4 ? `<div class="tt-row"><span></span><b>${tr('… och {n} till', { n: ds.length - 4 })}</b></div>` : '');
}
function tipHTML(t) {
  const st = statusOf(t), s = toDay(t.start), e = toDay(t.end);
  const dur = s != null && e != null ? e - s + 1 : null;
  const stCol = { done: 'var(--good)', late: 'var(--critical)', active: 'var(--text-primary)', planned: 'var(--text-secondary)' }[st];
  const stIcon = { done: '✓', late: '!', active: '▸', planned: '○' }[st];
  return `<div class="tt-title"><span class="${t.milestone ? 'ico-ms' : 'ico-bar'}" style="background:${colorOf(t.bucket || 'Övrigt')}"></span>${esc(t.name)}</div>
    ${t._plan ? `<div class="tt-row"><span>${tr('Projekt')}</span><b>${esc((allPlans.find(p => p.id === t._plan) || {}).name || '')}</b></div>` : ''}
    <div class="tt-row"><span>${tr('Fas')}</span><b>${esc(bName((t.bucket || 'Övrigt').split(PG_SEP).pop()))}</b></div>${t.goals ? `
    <div class="tt-row"><span>${tr('Mål')}</span><b>${esc(t.goals)}</b></div>` : ''}
    ${t.milestone ? `<div class="tt-row"><span>${tr('Datum')}</span><b>${fmtDayY(e)} · ${tr('v')}${isoWeek(e)} (${fmtYYWW(e)})</b></div>` :
      `<div class="tt-row"><span>${tr('Period')}</span><b>${fmtDay(s)} – ${fmtDayY(e)}</b></div><div class="tt-row"><span>${tr('Veckor')}</span><b>${fmtYYWW(s)} – ${fmtYYWW(e)}</b></div>${dur ? `<div class="tt-row"><span>${tr('Längd')}</span><b>${tr('{n} dagar', { n: dur })}</b></div>` : ''}`}
    <div class="tt-row"><span>${tr('Klart')}</span><b>${t.progress || 0}%</b></div>
    ${t.goalStatus ? `<div class="tt-row"><span>${tr('Status i Planner')}</span><b>${esc(goalStatusTxt(t.goalStatus))}</b></div>` : ''}
    ${t.actual ? `<div class="tt-row"><span>${tr('Utfall')}</span><b>${esc(t.actual.week)} · ${fmtDayY(toDay(t.actual.day))}</b></div>` : ''}
    ${t.moved ? `<div class="tt-row"><span>${tr('Flyttad')}</span><b>${tr('{d} dagar sedan förra importen (slut var {end})', { d: (t.moved.days > 0 ? '+' : '') + t.moved.days, end: fmtShortY(t.moved.fromEnd) })}</b></div>` : ''}
    ${t.check ? `<div class="tt-row"><span>${tr('Kontrollera')}</span><b>${esc(t.check)}</b></div>` : ''}
    ${critTipRow(t)}
    ${blTipRow(t)}
    ${depTipRows(t)}
    ${(t.xdeps || []).map(x => `<div class="tt-row"><span>${tr('Väntar på')}</span><b style="color:${depColor(x.status)}">${esc(x.label)} (${tr('slut')} ${fmtShortY(x.fromEnd)}) · ${tr(DEP_TXT[x.status])} ${fmtMargin(x.margin)}</b></div>`).join('')}
    ${t.assignees ? `<div class="tt-row"><span>${tr('Ansvarig')}</span><b>${esc(t.assignees)}</b></div>` : ''}
    ${t.effort ? `<div class="tt-row"><span>${tr('Insats')}</span><b>${esc(fmtH(effortPlanned(t.effort)))} · ${esc(tr('kvar'))} ${esc(fmtH(effortLeft(t)))} (${esc(fmtPD(effortLeft(t) || 0))})${t.effort.dflt ? ' · ' + esc(tr('Planners standard')) : ''}</b></div>` : ''}
    ${docCount(t) ? `<div class="tt-row"><span>${tr('Dokument')}</span><b>📎 ${docCount(t)}</b></div>` : ''}
    ${checkStat(t) ? `<div class="tt-row"><span>${tr('Checklista')}</span><b${checksAllDone(t) ? ' style="color:var(--good)"' : ''}>☑ ${checkStat(t).done}/${checkStat(t).total}${checksAllDone(t) ? ' · ' + tr('alla punkter klara') : ''}</b></div>` : ''}
    <div class="tt-status" style="color:${stCol}">${stIcon} ${tr(STATUS_TXT[st])}</div>`;
}
function tipFromEvent(e) {
  const g = e.target.closest('[data-id]');
  if (!g) return hideTip();
  const t = plan.tasks.find(x => x.id === g.dataset.id);
  if (!t) return hideTip();
  showTip(e.clientX, e.clientY, tipHTML(t));
}
function showTip(x, y, html) {
  const tip = $('#tip');
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 14, innerWidth - r.width - 8) + 'px';
  tip.style.top = (y + 16 + r.height > innerHeight ? y - r.height - 10 : y + 16) + 'px';
}
function hideTip() { $('#tip').hidden = true; }

/* =========================================================
   Drawer: edit task
   ========================================================= */
// Beredskap enligt gate-checklistan efter gate-milstolpens namn, t.ex. "G2 · 42 % · 2 röda"
function gateBadge(t) {
  if (!plan || plan.synthetic) return '';
  const g = taskGate(t, planGates(plan));
  const m = g && genSummary(plan.settings, g.id);
  if (!m || !m.total || (!m.ok && !m.warn && !m.crit)) return '';
  return `<tspan font-weight="500" fill="${PAL.muted}"> · ☑ ${m.pct} %</tspan>${m.crit ? `<tspan fill="${PAL.critical}"> · ${tr('{n} röda', { n: m.crit })}</tspan>` : ''}`;
}

/* ---------- Dokumentlänkar (#23) ----------
   Bara länk och titel lagras (task.links); dokumenten ligger kvar på SharePoint och SharePoints behörighet gäller vid öppning. */
const LINK_HOST_OK = /(^|\.)sharepoint\.com$/i;
function normLink(url, title) {
  let p;
  try { p = new URL(String(url || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(p.protocol)) return null;
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t) {
    const seg = p.pathname.split('/').filter(Boolean).pop() || '';
    try { t = decodeURIComponent(seg); } catch { t = seg; }
    if (/^:[a-z]:$/i.test(t) || /^[a-z0-9_-]{20,}$/i.test(t)) t = ''; // korta SharePoint-länkar saknar filnamn
    t = t || p.hostname;
  }
  return { url: p.href, title: t, sharepoint: LINK_HOST_OK.test(p.hostname) };
}
// Typ av dokument: SharePoints delningslänkar (/:w:/ osv.) eller filändelsen
function linkType(url) {
  const u = String(url || '').toLowerCase();
  const m = u.match(/\/:([wxpbfo]):\//);
  if (m) return { w: 'word', x: 'excel', p: 'ppt', b: 'pdf', f: 'folder', o: 'link' }[m[1]];
  let path = u; try { path = decodeURIComponent(new URL(url).pathname.toLowerCase()); } catch { /* ogiltig */ }
  if (/\.(docx?|docm|dotx)$/.test(path)) return 'word';
  if (/\.(xlsx?|xlsm|xltm|csv)$/.test(path)) return 'excel';
  if (/\.(pptx?|pptm|potx)$/.test(path)) return 'ppt';
  if (/\.pdf$/.test(path)) return 'pdf';
  if (/\/$/.test(path) || /forms\/allitems\.aspx/.test(path)) return 'folder';
  return 'link';
}
const LINK_ICON = { word: 'W', excel: 'X', ppt: 'P', pdf: 'PDF', folder: '📁', link: '🔗' };
const linkIcon = url => { const k = linkType(url); return `<span class="doc-ic doc-${k}">${LINK_ICON[k]}</span>`; };
const linkHost = url => { try { return new URL(url).hostname; } catch { return ''; } };
// Öppna i ny flik; om ramen blockerar fönstret visas länken så att den kan kopieras
function openLink(url) {
  const w = window.open(url, '_blank');
  if (w) { try { w.opener = null; } catch { /* annan ursprung */ } return; }
  dialog({ title: tr('Kunde inte öppna länken'), body: tr('Webbläsaren stoppade fönstret. Kopiera länken och öppna den i en ny flik:'), input: url, buttons: [{ label: tr('Stäng'), value: null }] });
}
const docCount = t => (t.links || []).length;
const docBadge = t => docCount(t) ? `<tspan fill="${PAL.muted}" font-weight="500"> 📎 ${docCount(t)}</tspan>` : '';
// Checklista (#71): "☑ 2/3" – grön när alla punkter är klara men aktiviteten inte är det
const chkBadge = t => { const s = checkStat(t); return s ? `<tspan fill="${checksAllDone(t) ? PAL.good : PAL.muted}" font-weight="${checksAllDone(t) ? 700 : 500}"> ☑ ${s.done}/${s.total}</tspan>` : ''; };
const chkFlag = t => { const s = checkStat(t); return s ? `<span class="flag cl ${checksAllDone(t) ? 'all' : ''}" title="${checksAllDone(t) ? tr('Alla punkter i checklistan är klara – markera aktiviteten som klar?') : tr('{d} av {n} punkter klara', { d: s.done, n: s.total })}">☑ ${s.done}/${s.total}</span>` : ''; };

// Gate-milstolpe: alla dokument som aktiviteterna i samma fas länkar till (bara läsning)
function phaseDocsHTML(g) {
  const ts = plan.tasks.filter(x => x.id !== g.id && (x.bucket || '') === (g.bucket || '') && docCount(x));
  if (!ts.length) return `<div class="meta"><b>${tr('Dokument i fasen')}</b><br><span style="color:var(--text-muted)">${tr('Inga aktiviteter i fasen har dokument ännu.')}</span></div>`;
  return `<div class="meta phase-docs" id="phaseDocs"><b>${tr('Dokument i fasen')}</b> · ${esc(bName(g.bucket || 'Övrigt'))}
    ${ts.map(x => `<div class="pd-task">${esc(x.name)}</div>${x.links.map(l => `<a href="${esc(l.url)}" class="pd-link" data-url="${esc(l.url)}">${linkIcon(l.url)} ${esc(l.title)}</a>`).join('')}`).join('')}</div>`;
}

function openDrawer(id, isNew = false) {
  const t = isNew ? id : plan.tasks.find(x => x.id === id);
  if (!t) return;
  hideTip();
  const others = plan.tasks.filter(x => x.id !== t.id).sort((a, b) => (toDay(a.end) ?? 1e9) - (toDay(b.end) ?? 1e9));
  const buckets = bucketList();
  const dr = $('#drawer');
  dr.innerHTML = `
    <div class="dr-head"><h3>${isNew ? tr('Ny aktivitet') : tr('Redigera aktivitet')}</h3><button class="icon-btn" data-close>✕</button></div>
    <div class="dr-body">
      <div class="field"><label>${tr('Namn')}</label><input type="text" id="fName" value="${esc(t.name)}"></div>
      <div class="field"><label for="fBucketSel">${tr('Fas / bucket')}</label>
        <select id="fBucketSel">${[...new Set([...buckets, ...(t.bucket && !buckets.includes(t.bucket) ? [t.bucket] : [])])].map(b => `<option value="${esc(b)}" ${b === t.bucket ? 'selected' : ''}>${esc(bName(b))}</option>`).join('')}
          <option value="__new" ${buckets.length ? '' : 'selected'}>${tr('＋ Ny fas…')}</option></select>
        <input type="text" id="fBucket" placeholder="${tr('Namn på ny fas')}" ${buckets.length ? 'hidden' : ''}></div>
      <label class="chk"><input type="checkbox" id="fMs" ${t.milestone ? 'checked' : ''}> ${tr('Milstolpe')}</label>
      ${(() => { const gl = planGates(plan), cg = taskGate(t, gl); return `<div class="field" id="gateField" ${t.milestone ? '' : 'hidden'}><label for="fGate">${tr('Gate')}</label>
        <select id="fGate"><option value="">${tr('– ingen gate –')}</option>${gl.map(g => `<option value="${esc(g.id)}" ${cg === g ? 'selected' : ''}>${esc(g.code)}${g.name && g.name !== g.code ? ' – ' + esc(g.name) : ''}</option>`).join('')}
          <option value="__new">${tr('＋ Ny gate med milstolpens namn')}</option></select></div>`; })()}
      <div class="row2">
        <div class="field" id="startField"><label>${tr('Start')}</label><div class="date-wk"><input type="date" id="fStart" value="${t.start || ''}"><input type="text" class="wk" id="fStartW" value="${fmtYYWW(toDay(t.start))}" placeholder="${tr('ÅÅVV')}" title="${tr('Vecka som ÅÅVV, t.ex. 2645')}"></div></div>
        <div class="field"><label id="endLbl">${tr('Slut')}</label><div class="date-wk"><input type="date" id="fEnd" value="${t.end || ''}"><input type="text" class="wk" id="fEndW" value="${fmtYYWW(toDay(t.end))}" placeholder="${tr('ÅÅVV')}" title="${tr('Vecka som ÅÅVV, t.ex. 2645')}"></div></div>
      </div>
      <div class="field"><label>${tr('Klart')}</label><div class="range-row"><input type="range" id="fProg" min="0" max="100" step="1" value="${t.progress || 0}" aria-label="${tr('Klart')}"><span class="prog-num"><input type="number" id="fProgN" min="0" max="100" step="1" inputmode="numeric" value="${t.progress || 0}" aria-label="${tr('Klart i procent')}">%</span></div></div>
      ${!isNew && isGateMs(t) ? `<div class="field"><label for="fAct">${tr('Utfall (vecka)')}</label><div class="act-row"><input type="text" class="wk" id="fAct" value="${esc((t.actual && t.actual.week) || '')}" placeholder="${tr('ÅÅVV')}" title="${tr('Veckan då gaten passerades, t.ex. 2645')}" inputmode="numeric" maxlength="6">
        <button class="btn ghost small" type="button" id="fActClr">${tr('Rensa')}</button><small>${t.actual ? esc(t.actual.src === 'planner' ? tr('från Planner (klar)') : tr('satt i NexusOrdo')) : tr('Gaten är inte passerad')}</small></div>
        ${t.goalStatus ? `<small class="act-gs">${tr('Status i Planner: {s}', { s: `<b>${esc(goalStatusTxt(t.goalStatus))}</b>` })}</small>` : ''}</div>` : ''}
      <div class="field"><label>${tr('Ansvarig')}</label><input type="text" id="fAss" value="${esc(t.assignees || '')}" placeholder="${tr('Namn; Namn')}"></div>
      ${effortFieldsHTML(t)}
      <div class="field chk-sec" id="chkSec"><span class="lbl">${tr('Checklista')} <b id="chkStat"></b></span>
        ${plannerChecksOf(t) ? `<small class="chk-planner" id="chkPlanner">${tr('Planner: {d} av {n} klara', { d: plannerChecksOf(t).done, n: plannerChecksOf(t).total })}${!(t.checks || []).length && t.plannerId ? ' · ' + tr('uppdatera planen från Excel för att få punkterna') : ''}</small>` : ''}
        <div class="chk-list" id="chkList"></div>
        <div class="chk-add"><input type="text" id="chkNew" placeholder="${tr('Ny punkt…')}" maxlength="500"><button class="btn ghost small" id="chkAddBtn" type="button">${tr('+ Lägg till')}</button></div>
        ${t.plannerId ? `<small class="doc-hint">${tr('Bockar du av här förs det inte över till Planner – gör det där också om planen uppdateras från Planner.')}</small>` : ''}</div>
      <div class="field"><span class="lbl">${tr('Beroenden – startar efter att dessa är klara')}</span>
        <input type="text" class="dep-filter" id="depFilter" placeholder="${tr('Filtrera…')}" style="border:1px solid var(--border);background:var(--panel-2);border-radius:8px;padding:6px 10px;outline:none">
        <div class="deps" id="depList">${others.map(o => `<label data-n="${esc(o.name.toLowerCase())}"><input type="checkbox" value="${esc(o.id)}" ${(t.deps || []).includes(o.id) ? 'checked' : ''}>
          <span class="${o.milestone ? 'ico-ms' : 'ico-bar'}" style="background:${colorOf(o.bucket || 'Övrigt')}"></span>${esc(o.name)}<small>${fmtShort(toDay(o.end))}</small></label>`).join('') || `<div style="padding:6px;color:var(--text-muted)">${tr('Inga andra aktiviteter')}</div>`}</div>
        <div class="dep-sel" id="depSel"></div></div>
      ${!isNew && !plan.synthetic ? critPanelHTML(t) : ''}
      ${!isNew && !plan.synthetic ? blPanelHTML(t) : ''}
      <div class="field"><label>${tr('Anteckningar')}</label><textarea id="fNotes">${esc(t.notes || '')}</textarea></div>
      <div class="field doc-sec" id="docSec"><span class="lbl">${tr('Dokument')}</span>
        <div class="doc-list" id="docList"></div><div id="docForm"></div>
        <button class="btn ghost small" id="docAdd" type="button">${tr('+ Lägg till dokument')}</button>
        <small class="doc-hint">${tr('Klistra in en länk från SharePoint (Kopiera länk). Bara länken sparas – dokumentet ligger kvar på SharePoint.')}</small></div>
      ${!isNew && (t.gate || (t.milestone && taskGate(t, planGates(plan)))) ? phaseDocsHTML(t) : ''}
      ${!isNew && t.milestone && t.end && !plan.synthetic ? `<div class="meta"><button class="btn ghost small" id="fTrend">${tr('📈 Milstolpetrend')}</button></div>` : ''}
      ${!isNew ? (() => { const g = taskGate(t, planGates(plan)); return g ? `<div class="meta"><b>${tr('Gate-checklista')} ${esc(g.code)}</b> · ${tr('{p} % klart', { p: genSummary(plan.settings, g.id).pct })}<br><button class="btn ghost small" id="fGateChk" style="margin-top:6px">${tr('☑ Öppna gate-checklistan')}</button></div>` : ''; })() : ''}
      ${t.check ? `<div class="meta" style="border-left:3px solid var(--warn, #d97706)"><b>${tr('Behöver kontrolleras')}</b><br>${esc(t.check)}<br><button class="btn ghost small" id="fChecked" style="margin-top:6px">${tr('Markera som kontrollerad')}</button></div>` : ''}
      ${t.moved ? `<div class="meta">${tr('Flyttad <b>{d} dagar</b> sedan förra importen (var {from} – {to}).', { d: (t.moved.days > 0 ? '+' : '') + t.moved.days, from: fmtShortY(t.moved.fromStart), to: fmtShortY(t.moved.fromEnd) })}</div>` : ''}
      ${t.plannerId ? `<div class="meta"><b>${tr('Från Planner')}</b><br>
        ${t.priority ? `${tr('Prioritet')}: ${esc(t.priority)}<br>` : ''}
        ${t.labels ? `${tr('Etiketter')}: ${t.labels.split(/[;,]/).filter(Boolean).map(l => `<span class="pill">${esc(l.trim())}</span>`).join('')}<br>` : ''}
        ${t.goals ? `Goal: <b>${esc(t.goals)}</b><br>` : ''}
        ${t.description ? `<div style="margin-top:6px"><b>${tr('Anteckningar i Planner')}</b></div><div style="white-space:pre-wrap">${esc(t.description.slice(0, 1200))}</div>` : ''}
        <div style="margin-top:6px;color:var(--text-muted)">${tr('Namn, datum och status skrivs över vid nästa import från Planner. Beroenden, anteckningar, dokument och bockar i checklistan behålls.')}</div></div>` : ''}
    </div>
    <div class="dr-foot">
      ${isNew ? '' : `<button class="btn ghost" data-del style="color:var(--critical)">${tr('Ta bort')}</button>`}
      <div class="spacer"></div>
      <button class="btn ghost" data-close>${tr('Avbryt')}</button>
      <button class="btn" data-save>${tr('Spara')}</button>
    </div>`;
  dr.hidden = false;
  const syncMs = () => { const m = $('#fMs').checked; $('#startField').style.visibility = m ? 'hidden' : ''; $('#endLbl').textContent = m ? tr('Datum') : tr('Slut'); if ($('#gateField')) $('#gateField').hidden = !m; };
  syncMs();
  $('#fMs').onchange = syncMs;
  $('#fBucketSel').onchange = e => { const nb = e.target.value === '__new'; $('#fBucket').hidden = !nb; if (nb) $('#fBucket').focus(); };
  // % klart: slidern och sifferfältet följer varandra (heltal 0–100)
  $('#fProg').oninput = e => { $('#fProgN').value = e.target.value; };
  $('#fProgN').oninput = e => { const v = e.target.value.trim(); if (v === '' || isNaN(+v)) return; $('#fProg').value = clampPct(v); $('#fProg').dispatchEvent(new Event('input')); };
  $('#fProgN').onchange = e => { e.target.value = clampPct(e.target.value); $('#fProg').value = e.target.value; };
  // Vecka (ÅÅVV) ↔ datum: start = måndag, slut och milstolpe = fredag
  [['fStart', false], ['fEnd', true]].forEach(([id, isEnd]) => {
    const d = $('#' + id), w = $('#' + id + 'W');
    d.addEventListener('change', () => { w.value = fmtYYWW(toDay(d.value)); w.classList.remove('bad'); });
    w.addEventListener('change', () => {
      if (!w.value.trim()) return;
      const n = parseWeek(w.value, isEnd || (id === 'fEnd'));
      if (n == null) { w.classList.add('bad'); return toast(tr('Okänd vecka: {v}. Skriv ÅÅVV, t.ex. 2645', { v: w.value })); }
      w.classList.remove('bad'); d.value = fromDay(n); w.value = fmtYYWW(n);
    });
  });
  // Dokumentlänkar: arbetskopia som sparas tillsammans med övriga fält (Spara), Avbryt kastar ändringarna
  let links = (t.links || []).map(l => ({ ...l }));
  const linkForm = (l = {}) => `<div class="doc-form"><input type="text" class="doc-url" placeholder="https://…sharepoint.com/…" value="${esc(l.url || '')}">
    <input type="text" class="doc-title" placeholder="${tr('Titel (valfri)')}" value="${esc(l.title || '')}">
    <div class="doc-form-btns"><button class="btn ghost small" type="button" data-doc-cancel>${tr('Avbryt')}</button><button class="btn small" type="button" data-doc-ok>${l.id ? tr('Spara länk') : tr('Lägg till')}</button></div></div>`;
  const drawDocs = () => {
    $('#docList').innerHTML = links.map(l => `<div class="doc" data-lid="${esc(l.id)}">${linkIcon(l.url)}
      <a href="${esc(l.url)}" target="_blank" rel="noopener" data-open title="${esc(l.url)}">${esc(l.title)}</a><small>${esc(linkHost(l.url))}</small>
      <button class="icon-btn" type="button" data-doc-edit title="${tr('Ändra')}">✎</button><button class="icon-btn" type="button" data-doc-rm title="${tr('Ta bort')}">✕</button></div>`).join('')
      || `<div class="doc-none">${tr('Inga dokument')}</div>`;
  };
  const wireForm = (box, l, done) => {
    const u = $('.doc-url', box), ti = $('.doc-title', box);
    u.addEventListener('paste', () => setTimeout(() => { if (!ti.value.trim()) { const n = normLink(u.value); if (n) ti.value = n.title; } }, 0));
    u.focus();
    $('[data-doc-cancel]', box).onclick = () => done(null);
    $('[data-doc-ok]', box).onclick = () => {
      const n = normLink(u.value, ti.value);
      if (!n) { u.classList.add('bad'); return toast(tr('Ange en länk som börjar med https://')); }
      if (!n.sharepoint) toast(tr('Länken pekar inte på SharePoint – kontrollera att mottagaren har behörighet'));
      done({ id: l.id || uid(), url: n.url, title: n.title, addedAt: l.addedAt || new Date().toISOString().slice(0, 10) });
    };
    [u, ti].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-doc-ok]', box).click(); } }));
  };
  drawDocs();
  $('#docAdd').onclick = () => {
    const box = $('#docForm'); box.innerHTML = linkForm(); $('#docAdd').hidden = true;
    wireForm(box, {}, l => { box.innerHTML = ''; $('#docAdd').hidden = false; if (l) { links.push(l); drawDocs(); } });
  };
  $('#docList').onclick = e => {
    const row = e.target.closest('.doc'); if (!row) return;
    const l = links.find(x => x.id === row.dataset.lid);
    if (e.target.closest('[data-open]')) { e.preventDefault(); return openLink(l.url); }
    if (e.target.closest('[data-doc-rm]')) { links = links.filter(x => x !== l); return drawDocs(); }
    if (e.target.closest('[data-doc-edit]')) {
      row.outerHTML = `<div class="doc editing" data-lid="${esc(l.id)}">${linkForm(l)}</div>`;
      const box = $(`.doc.editing[data-lid="${CSS.escape(l.id)}"]`);
      wireForm(box, l, n => { if (n) Object.assign(l, n); drawDocs(); });
    }
  };
  // Checklista (#71): arbetskopia som sparas med Spara, precis som dokumentlänkarna
  let checks = (t.checks || []).map(c => ({ ...c }));
  const now = () => new Date().toISOString();
  const drawChecks = (focusId) => {
    const n = checks.filter(c => c.done).length;
    $('#chkStat').textContent = checks.length ? `☑ ${n}/${checks.length}` : '';
    $('#chkList').innerHTML = checks.map((c, i) => `<div class="chk-item ${c.done ? 'done' : ''}" data-cid="${esc(c.id)}">
      <input type="checkbox" ${c.done ? 'checked' : ''} aria-label="${tr('Klar: {text}', { text: esc(c.text) })}">
      <span class="chk-txt" title="${c.src === 'planner' ? tr('Från Planner') : tr('Tillagd i NexusOrdo')}">${esc(c.text)}</span>${c.src === 'tp' ? `<small class="chk-tp">TP</small>` : ''}
      <span class="chk-btns"><button class="icon-btn" type="button" data-ck-up title="${tr('Flytta upp')}" ${i ? '' : 'disabled'}>↑</button><button class="icon-btn" type="button" data-ck-down title="${tr('Flytta ner')}" ${i < checks.length - 1 ? '' : 'disabled'}>↓</button>
      <button class="icon-btn" type="button" data-ck-edit title="${tr('Ändra')}">✎</button><button class="icon-btn" type="button" data-ck-rm title="${tr('Ta bort')}">✕</button></span></div>`).join('')
      || `<div class="doc-none">${tr('Inga punkter')}</div>`;
    if (focusId) { const r = $(`#chkList [data-cid="${CSS.escape(focusId)}"] input`); if (r) r.focus(); }
  };
  const addCheck = () => {
    const inp = $('#chkNew'), text = inp.value.replace(/\s+/g, ' ').trim();
    if (!text) return inp.focus();
    if (checks.some(c => normCheck(c.text) === normCheck(text))) return toast(tr('Punkten finns redan'));
    checks.push({ id: 'c_' + uid().slice(2), text: text.slice(0, 500), done: false, src: 'tp', at: now() });
    inp.value = ''; drawChecks(); inp.focus();
  };
  drawChecks();
  $('#chkAddBtn').onclick = addCheck;
  $('#chkNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCheck(); } });
  $('#chkList').onclick = e => {
    const row = e.target.closest('.chk-item'); if (!row) return;
    const i = checks.findIndex(x => x.id === row.dataset.cid), c = checks[i];
    if (!c || row.classList.contains('editing')) return;
    if (e.target.matches('input[type=checkbox]')) { c.done = e.target.checked; c.at = now(); return drawChecks(c.id); }
    if (e.target.closest('[data-ck-rm]')) { checks.splice(i, 1); return drawChecks(); }
    const mv = e.target.closest('[data-ck-up]') ? -1 : e.target.closest('[data-ck-down]') ? 1 : 0;
    if (mv) { const j = i + mv; if (j < 0 || j >= checks.length) return; [checks[i], checks[j]] = [checks[j], checks[i]]; return drawChecks(); }
    if (e.target.closest('[data-ck-edit]') || e.target.closest('.chk-txt')) {
      row.classList.add('editing');
      $('.chk-txt', row).outerHTML = `<input type="text" class="chk-edit" value="${esc(c.text)}" maxlength="500">`;
      const ed = $('.chk-edit', row); ed.focus(); ed.select();
      let doneEd = false;
      const finish = ok => {
        if (doneEd) return; doneEd = true;
        const v = ed.value.replace(/\s+/g, ' ').trim();
        if (ok && v && v !== c.text) { if (c.src === 'planner' && !c.ptext) c.ptext = c.text; c.text = v; c.at = now(); }
        drawChecks();
      };
      ed.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } });
      ed.addEventListener('blur', () => finish(true));
    }
  };
  wireEffortFields(t);
  const phaseDocs = $('#phaseDocs');
  if (phaseDocs) phaseDocs.onclick = e => { const a = e.target.closest('[data-url]'); if (a) { e.preventDefault(); openLink(a.dataset.url); } };
  // Valda beroenden med typ och fördröjning (#83): NexusOrdos egna kan ändras, Planners visas (skrivs över vid uppdatering)
  const depEdit = {};
  for (const d of t.deps || []) depEdit[d] = { ...depInfoOf(t, d) };
  const drawDepSel = () => {
    const sel = $$('#depList input:checked').map(i => i.value), box = $('#depSel');
    if (!box) return;
    box.innerHTML = sel.map(d => {
      const o = plan.tasks.find(x => x.id === d), e = depEdit[d] || (depEdit[d] = { type: 'FS', lag: 0, src: '' });
      const name = `<span class="dep-n">${esc(o ? o.name : d)}</span>`;
      if (e.src === 'planner') return `<div class="dep-row" data-dep="${esc(d)}">${name}<b class="dep-ty" title="${esc(tr(DEP_TYPES[e.type]))}">${esc(fmtDepType(e.type, e.lag))}</b><small>${tr('från Planner')}</small></div>`;
      return `<div class="dep-row" data-dep="${esc(d)}">${name}<select class="dep-type" aria-label="${tr('Beroendetyp')}">${Object.keys(DEP_TYPES).map(k => `<option value="${k}" ${k === e.type ? 'selected' : ''}>${k} – ${esc(tr(DEP_TYPES[k]))}</option>`).join('')}</select>
        <input type="number" class="dep-lag" step="1" min="-365" max="365" value="${e.lag || 0}" aria-label="${tr('Fördröjning i arbetsdagar')}" title="${tr('Fördröjning i arbetsdagar (negativt = överlapp)')}"><small>${tr('d')}</small></div>`;
    }).join('');
    box.hidden = !sel.length;
  };
  $('#depList').addEventListener('change', drawDepSel);
  $('#depSel').addEventListener('change', e => {
    const row = e.target.closest('[data-dep]'); if (!row) return;
    const ed = depEdit[row.dataset.dep];
    if (e.target.classList.contains('dep-type')) ed.type = cpType(e.target.value);
    if (e.target.classList.contains('dep-lag')) ed.lag = cpLag(e.target.value);
  });
  drawDepSel();
  $('#depFilter').oninput = e => { const q = e.target.value.toLowerCase(); $$('#depList label').forEach(l => l.style.display = l.dataset.n.includes(q) ? '' : 'none'); };
  $$('[data-close]', dr).forEach(b => b.onclick = closeDrawer);
  const ftr = $('#fTrend');
  if (ftr) ftr.onclick = () => { closeDrawer(); openTrend(t.id); };
  const gch = $('#fGateChk');
  if (gch) gch.onclick = () => { closeDrawer(); openChecklist((taskGate(t, planGates(plan)) || {}).id); };
  const actClr = $('#fActClr');
  if (actClr) actClr.onclick = () => { $('#fAct').value = ''; $('#fAct').classList.remove('bad'); };
  const chk = $('#fChecked');
  if (chk) chk.onclick = () => { pushUndo(); delete t.check; closeDrawer(); scheduleSave(); render(); toast(tr('Markerad som kontrollerad')); };
  setTimeout(() => $('#fName').focus(), 30);
  const del = $('[data-del]', dr);
  if (del) del.onclick = async () => {
    const ok = await dialog({ title: tr('Ta bort aktivitet?'), body: tr('”{name}” tas bort från tidplanen.', { name: esc(t.name) }) + (t.plannerId ? '<br><br>' + tr('Den kommer tillbaka om du importerar från Planner igen och den finns kvar där.') : ''), buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Ta bort'), value: true, danger: true }] });
    if (!ok) return;
    pushUndo();
    plan.tasks = plan.tasks.filter(x => x.id !== t.id);
    plan.tasks.forEach(x => { x.deps = (x.deps || []).filter(d => d !== t.id); pruneDepInfo(x); });
    closeDrawer(); scheduleSave(); render();
  };
  $('[data-save]', dr).onclick = () => {
    const name = $('#fName').value.trim();
    if (!name) { $('#fName').focus(); return toast(tr('Ange ett namn')); }
    const ms = $('#fMs').checked;
    let s = $('#fStart').value || null, e = $('#fEnd').value || null;
    if (ms) { s = e = e || s; }
    if (s && e && s > e) [s, e] = [e, s];
    const fAct = $('#fAct'), actStr = fAct ? fAct.value.trim() : null;
    const actDay = actStr ? actualDayFromWeek(actStr, t.actual ? toDay(t.actual.day) : null) : null;
    if (actStr && actDay == null) { fAct.classList.add('bad'); fAct.focus(); return toast(tr('Okänd vecka: {v}. Skriv ÅÅVV, t.ex. 2645', { v: actStr })); }
    const eff = readEffortFields(t);
    if (eff === null && $('#effSec .bad')) return toast(tr('Ange insatsen i timmar, t.ex. 16 eller 2 d'));
    pushUndo();
    if (fAct) { if (!actStr) delete t.actual; else if (!t.actual || fmtYYWW(toDay(t.actual.day)) !== fmtYYWW(actDay)) t.actual = mkActual(actDay, 'manual'); }
    if (t.start !== s || t.end !== e) t.dateEdited = true;
    if (!!t.milestone !== ms) t.milestoneManual = true;
    Object.assign(t, {
      name, bucket: ($('#fBucketSel').value === '__new' ? $('#fBucket').value.trim() : $('#fBucketSel').value) || 'Övrigt', milestone: ms, start: s, end: e,
      progress: +$('#fProg').value, assignees: $('#fAss').value.trim(), notes: $('#fNotes').value,
      deps: $$('#depList input:checked').map(i => i.value),
    });
    // Typ och fördröjning (#83): bara det som avviker från slut–start utan fördröjning, eller som kommer från Planner, sparas
    const di = {};
    for (const d of t.deps) { const e = depEdit[d]; if (e && (e.src === 'planner' || e.type !== 'FS' || e.lag)) di[d] = e.src === 'planner' ? { type: e.type, lag: e.lag, src: 'planner' } : { type: e.type, lag: e.lag }; }
    if (Object.keys(di).length) t.depInfo = di; else delete t.depInfo;
    if (links.length) t.links = links; else delete t.links;
    if (checks.length) t.checks = checks; else delete t.checks;
    if (eff === false) delete t.effort; else if (eff) t.effort = eff; // insats (#94): undefined = oförändrad
    // NexusOrdo bas (#75): milstolpen markeras som gate (egen gate, kopplad med gateId)
    const fg = $('#fGate');
    if (fg) {
      const gl = planGates(plan), was = taskGate(t, gl), v = ms ? fg.value : '';
      if (v === '__new') {
        const code = gateCodeOfName(name), list = ensureGates(plan);
        let g = list.find(x => lc(x.code) === lc(code));
        if (!g) { g = { id: uid(), code, name }; list.push(g); }
        t.gateId = g.id; t.gate = true;
      } else if (v) { ensureGates(plan); t.gateId = v; t.gate = true; }
      else if (was || t.gateId) { ensureGates(plan); delete t.gateId; if (!t.goalStatus && !t.goals) delete t.gate;
        if (was && (taskGate(t, planGates(plan)) || {}).id === was.id) t.gateId = 'none'; } // koden i namnet ska inte längre koppla milstolpen
    }
    if (isNew) plan.tasks.push(t);
    closeDrawer(); scheduleSave(); render();
  };
}
function closeDrawer() { $('#drawer').hidden = true; }

/* ---------- Insats i panelen (#94): planerat, utfört och kvar i timmar; kvar räknas ut när fältet är tomt ---------- */
const effVal = v => v == null ? '' : String(v).replace('.', LANG === 'en' ? '.' : ',');
const fmtPD = h => tr('{n} persondagar', { n: numFmt(h / HOURS_PER_DAY) });
function effortFieldsHTML(t) {
  const e = t.effort || {};
  const inp = (id, lbl, v, ph) => `<label class="eff-f"><span>${lbl}</span><input type="text" id="${id}" value="${esc(effVal(v))}" inputmode="decimal" placeholder="${ph || ''}" autocomplete="off"></label>`;
  return `<div class="field eff-sec" id="effSec"><span class="lbl">${tr('Insats (timmar)')}</span>
    <div class="eff-row">${inp('fEffP', tr('Planerat'), e.planned)}${inp('fEffD', tr('Utfört'), e.done)}${inp('fEffR', tr('Kvar'), e.remaining, tr('räknas ut'))}</div>
    <small class="eff-hint" id="effHint"></small></div>`;
}
// Fälten → insats. undefined = oförändrat, null = ogiltigt värde (markerat), false = tomt (ingen insats), annars ny insats (src 'tp')
function readEffortFields(t) {
  const ids = ['fEffP', 'fEffD', 'fEffR'];
  if (!$('#' + ids[0])) return undefined;
  let bad = false;
  const vals = ids.map(id => { const el = $('#' + id), raw = el.value.trim(); el.classList.remove('bad'); if (!raw) return null; const v = parseWork(raw); if (v == null) { el.classList.add('bad'); bad = true; } return v; });
  if (bad) return null;
  const e = effortFrom(vals[0], vals[1], vals[2], 'tp');
  if (effortKey(e) === effortKey(t.effort)) return undefined;
  return e || false;
}
function wireEffortFields(t) {
  const sec = $('#effSec'); if (!sec) return;
  const draw = () => {
    const raw = ['fEffP', 'fEffD', 'fEffR'].map(id => { const v = $('#' + id).value.trim(); return v ? parseWork(v) : null; });
    const e = effortFrom(raw[0], raw[1], raw[2], 'tp');
    const prog = +($('#fProg') ? $('#fProg').value : t.progress || 0);
    const parts = [];
    if (e) {
      const p = effortPlanned(e), left = effortLeft({ effort: e, progress: prog });
      if (p != null) parts.push(`${fmtH(p)} = ${fmtPD(p)}`);
      if (left != null) parts.push(`${tr('kvar')} ${fmtH(left)} = ${fmtPD(left)}${e.remaining == null ? ' (' + tr('räknat') + ')' : ''}`);
      const n = peopleOf($('#fAss') ? $('#fAss').value : t.assignees).length;
      if (n > 1 && p != null) parts.push(tr('{h} per person ({n} personer)', { h: fmtH(p / n), n }));
    }
    const same = effortKey(e) === effortKey(t.effort) && t.effort;
    const srcTxt = same ? (t.effort.src === 'planner' ? tr('Från Planner') + (t.effort.dflt ? ' – ' + tr('Planners standardinsats (varaktighet × 8 h per person). Justera om det inte stämmer.') : '') : tr('Satt i NexusOrdo')) : '';
    $('#effHint').innerHTML = [parts.map(esc).join(' · '), srcTxt && `<span class="eff-src">${esc(srcTxt)}</span>`].filter(Boolean).join('<br>') || esc(tr('Timmar, eller t.ex. 2 d eller 1 v. Kvar räknas ut från planerat och utfört (eller % klart) om fältet är tomt.'));
  };
  ['fEffP', 'fEffD', 'fEffR', 'fAss', 'fProg'].forEach(id => { const el = $('#' + id); if (el) el.addEventListener('input', draw); });
  draw();
}

/* =========================================================
   Planner import
   ========================================================= */
const COLMAP = {
  id: ['task id', 'task number', 'uppgiftsnummer', 'aktivitets-id', 'aktivitets id', 'aktivitetsnummer', 'uppgifts-id', 'uppgifts id', 'id'],
  name: ['task name', 'aktivitetsnamn', 'uppgiftsnamn', 'namn på aktivitet', 'aktivitet', 'uppgift', 'name', 'namn', 'title', 'titel'],
  bucket: ['bucket name', 'bucketnamn', 'bucket-namn', 'namn på bucket', 'bucket', 'bucketar'],
  progress: ['progress', '% complete', 'percent complete', '% klart', 'procent klart', '% färdigt', '% slutfört', 'förlopp', 'förloppsstatus', 'status'],
  priority: ['priority', 'prioritet'],
  assignees: ['assigned to', 'tilldelat till', 'tilldelad till', 'tilldelade till', 'tilldelad', 'resource names', 'resursnamn', 'resurser', 'ansvarig'],
  created: ['created date', 'skapad den', 'skapat datum', 'skapandedatum', 'datum skapat'],
  start: ['start date', 'startdatum', 'start'],
  end: ['due date', 'förfallodatum', 'avslutas', 'förfallodag', 'slutdatum', 'end date', 'deadline', 'slut'],
  finish: ['finish date', 'finish', 'slutförs'],
  duration: ['duration', 'varaktighet'],
  depends: ['depends on', 'predecessors', 'beroende av', 'föregående aktiviteter', 'föregående'],
  outline: ['outline level', 'dispositionsnivå', 'dispositionsnummer', 'disposition', 'nivå', 'level'],
  goals: ['goals', 'goal', 'mål', 'kopplade mål'],
  completed: ['completed date', 'slutförandedatum', 'slutfört', 'slutförd den', 'datum slutfört', 'slutfört datum'],
  labels: ['labels', 'etiketter', 'etikett'],
  description: ['description', 'beskrivning', 'notes', 'anteckningar'],
  checkDone: ['completed checklist items', 'slutförda checklistobjekt', 'slutförda checklisteobjekt'],
  checklist: ['checklist items', 'checklistobjekt', 'checklisteobjekt', 'checklista'],
  // Insats (#94): Premiums Arbete / Slutfört arbete / Återstående arbete
  work: ['work', 'arbete', 'planned work', 'planerat arbete'],
  workDone: ['completed work', 'slutfört arbete', 'actual work', 'faktiskt arbete'],
  workLeft: ['remaining work', 'återstående arbete'],
};
// Datumkolumner matchas aldrig på arbetstid ("Slutfört arbete", "Completed work")
const DATE_COLS = new Set(['start', 'end', 'finish', 'completed', 'created']), NOT_DATE_RE = /arbete|work|timmar|hours/;
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function mapHeader(row) {
  const cells = row.map(norm);
  const map = {};
  const used = new Set();
  // exakt matchning först, sedan "börjar med"
  for (const pass of ['exact', 'prefix']) {
    for (const [key, aliases] of Object.entries(COLMAP)) {
      if (map[key] != null) continue;
      for (const a of aliases) {
        const i = cells.findIndex((c, idx) => !used.has(idx) && (pass === 'exact' ? c === a : c.startsWith(a) && !(DATE_COLS.has(key) && NOT_DATE_RE.test(c))));
        if (i >= 0) { map[key] = i; used.add(i); break; }
      }
    }
  }
  return map;
}

function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return fromDay(utcDay(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number') { // Excel-serienummer
    if (v < 20000 || v > 80000) return null;
    return fromDay(Math.floor(v) - 25569);
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return fromDay(utcDay(+m[1], +m[2] - 1, +m[3]));
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))) return fromDay(utcDay(+m[3], +m[2] - 1, +m[1]));
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    // Planner (engelska) exporterar M/D/ÅÅÅÅ; om första talet > 12 är det D/M
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return fromDay(utcDay(y, mo - 1, d));
  }
  // Text utan årtal är inget datum: Premiums kolumn "Slutfört" är checklistans "3/3", som Date annars läser som 3 mars 2001
  if (!/\d{4}/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d) ? null : fromDay(utcDay(d.getFullYear(), d.getMonth(), d.getDate()));
}

function parseProgress(v, checkDone) {
  if (typeof v === 'number') return clamp(Math.round(v <= 1 ? v * 100 : v), 0, 100);
  const s = norm(v);
  if (/^\d+\s*%?$/.test(s)) return clamp(parseInt(s), 0, 100);
  if (/(complete|slutf|klar|done|avslut|closed|stängd)/.test(s)) return 100;
  if (/(progress|pågå|påbörjad|started|igång)/.test(s) && !/(not|inte|ej)/.test(s)) {
    const m = String(checkDone || '').match(/(\d+)\s*\/\s*(\d+)/);
    if (m && +m[2] > 0) return clamp(Math.round(+m[1] / +m[2] * 100), 5, 95);
    return 50;
  }
  return 0;
}

// Gatens status i Planner (#66): Goals-flikens och Premiums "Project goals" Status-kolumn → notstarted/ontrack/atrisk/offtrack/done
function normGoalStatus(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v >= 100 || v === 1 ? 'done' : null;
  const s = norm(v);
  if (!s) return null;
  if (/(not started|inte start|inte påbörj|ej start|ej påbörj|ej påbörjad|ej inledd)/.test(s)) return 'notstarted';
  if (/(off.?track|inte i fas|ej i fas|ur fas|behind|försenad)/.test(s)) return 'offtrack';
  if (/(closed|done|complete|avslut|slutf|stängd|stängt|klar|^100\s*%?$)/.test(s)) return 'done';
  if (/(at.?risk|risk)/.test(s)) return 'atrisk';
  if (/(on.?track|i fas|på spår|på rätt spår|rätt spår|in progress|pågå)/.test(s)) return 'ontrack';
  return null;
}
const GOAL_STATUS_TXT = { notstarted: 'Inte påbörjad', ontrack: 'I fas', atrisk: 'I riskzonen', offtrack: 'Ur fas', done: 'Klar' };
const goalStatusTxt = v => v ? tr(GOAL_STATUS_TXT[v] || v) : '–';
// Gate-milstolpe: gate från Planner Goals eller PMI-gate (G1–G4) i namnet
const isGateMs = t => !!t && (!!t.gate || (!!t.milestone && PMI_GATE_RE.test(t.name || '')));
// Föreslaget utfall när en gate blivit klar (#55): planerat datum om det passerat, annars dagens datum (importdagen)
function proposeActual(task, today) {
  const d = toDay(task && (task.end || task.start));
  return d != null && d <= today ? d : today;
}
const gateDone = t => (t.progress || 0) >= 100 || t.goalStatus === 'done';
const mkActual = (day, src) => ({ day: fromDay(day), week: fmtYYWW(day), src, at: new Date().toISOString() });
// Vecka i fältet → dag: samma vecka som förslaget behåller förslagets dag, annars veckans fredag (som planens gater)
const actualDayFromWeek = (str, proposed) => { const d = parseWeek(str, true); return d == null ? null : proposed != null && fmtYYWW(proposed) === fmtYYWW(d) ? proposed : d; };

const MS_RE = /milstolpe|milestone|\bgate\b|\bMS\d*\b|beslutspunkt/i;
// I namn räknas bara "Gate" följt av en gate-kod (Gate R, Gate DG) – inte t.ex. "Project Gate Plan"
const MS_NAME_RE = /\bmilstolpe\b|\bmilestone\b|\b[Gg]ate\s+[A-ZÅÄÖ]{1,4}\b|\bMS\d*\b|beslutspunkt/;

/* ---------- Checklista på aktiviteter (#71) ----------
   task.checks [{id, text, done, src: 'planner'|'tp', at, ptext?}] – NexusOrdo äger bockarna (synk till Planner är manuell).
   ptext = Planners text när punkten bytt text i NexusOrdo (används för matchning vid nästa import).
   task.plannerChecks {done, total} = Planners räknare "Completed Checklist Items"; äldre planer har bara texten i task.checklist. */
const normCheck = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[\s.;:,]+$/, '');
const nextCheckId = list => 'c' + (list.reduce((m, c) => Math.max(m, +(/^c(\d+)$/.exec(c.id) || [])[1] || 0), 0) + 1);
// "Punkt A;Punkt B" (Planner och Premium) → obockade punkter. Tomma och dubbletter hoppas över.
function parseChecks(v, at = null) {
  const out = [], seen = new Set();
  for (const raw of String(v ?? '').split(/[;\n]/)) {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, 500), k = normCheck(text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ id: nextCheckId(out), text, done: false, src: 'planner', at });
  }
  return out;
}
// "2/3" → {done: 2, total: 3}
function parseCheckCount(v) {
  const m = String(v ?? '').match(/(\d+)\s*\/\s*(\d+)/);
  return m && +m[2] > 0 ? { done: Math.min(+m[1], +m[2]), total: +m[2] } : null;
}
const plannerChecksOf = t => (t && (t.plannerChecks || parseCheckCount(t.checklist))) || null;
const checkStat = t => { const c = (t && t.checks) || []; return c.length ? { done: c.filter(x => x.done).length, total: c.length } : null; };
// Alla punkter bockade men aktiviteten är inte klar
const checksAllDone = t => { const s = checkStat(t); return !!s && s.done === s.total && (t.progress || 0) < 100; };
// Uppdatera från Excel: punkterna matchas på normaliserad text. NexusOrdos bockar och egna punkter behålls, nya Planner-punkter
// läggs till sist. En Planner-punkt som saknas i filen tas bort bara om den inte är bockad eller ändrad i NexusOrdo – annars behålls den (kept).
function mergeChecks(old, fresh) {
  const out = [], added = [], removed = [], kept = [], matched = new Set();
  const byKey = new Map();
  for (const f of fresh || []) if (!byKey.has(normCheck(f.text))) byKey.set(normCheck(f.text), f);
  for (const c of Array.isArray(old) ? old : []) {
    const f = byKey.get(normCheck(c.ptext || c.text));
    if (f && !matched.has(f)) { matched.add(f); out.push({ ...c }); continue; }
    if (c.src !== 'planner') { out.push({ ...c }); continue; }
    if (c.done || (c.ptext && normCheck(c.ptext) !== normCheck(c.text))) { out.push({ ...c }); kept.push(c.text); } else removed.push(c.text);
  }
  for (const f of fresh || []) if (!matched.has(f)) { out.push({ ...f, id: nextCheckId(out) }); added.push(f.text); }
  return { checks: out, added, removed, kept };
}
// Punkter från en fil (export #69) – bara giltiga fält följer med
const cleanChecks = v => Array.isArray(v) ? v.filter(c => c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim()).slice(0, 500)
  .map((c, i) => ({ id: typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : 'c' + (i + 1), text: c.text.trim().slice(0, 500), done: c.done === true,
    src: c.src === 'planner' ? 'planner' : 'tp', at: typeof c.at === 'string' ? c.at.slice(0, 40) : null, ...(typeof c.ptext === 'string' ? { ptext: c.ptext.slice(0, 500) } : {}) })) : [];
/* ---------- slut checklista ---------- */

/* ---------- Insats och belastning (#94) ----------
   Arbetstid ≠ kalendertid. task.effort = { planned, done, remaining (timmar eller null), src: 'planner'|'tp', dflt? }
   – Planner Premiums Arbete / Slutfört arbete / Återstående arbete (Work / Completed work / Remaining work). dflt = Planners
   standardinsats (varaktighet × 8 h per tilldelad, dvs. heltid), som Premium sätter när projektledaren inte angett något.
   t.imp.effort = Planners värden vid senaste importen (för att se om Planner ändrat insatsen, mergeEffort).
   settings.capacity = { defaultHoursPerWeek: 40, people: { namn: h/vecka } }, settings.calendar = { workdays: [0..4] (0 = måndag), holidays: 'se'|'none' }.
   Rena funktioner med tester i test/insats.test.mjs. */
const HOURS_PER_DAY = 8, HOURS_PER_WEEK = 40, EFFORT_MAX = 1e6;
const round2 = n => Math.round(n * 100) / 100;
// "8 timmar", "8 hrs", "1 214,4 timmar", "2 dagar" (8 h), "1 vecka" (40 h), "90 min", 8 (tal = timmar) → timmar; tomt eller okänt → null
function parseWork(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? round2(v) : null;
  const s = String(v).toLowerCase().replace(/[\u00a0\u202f]/g, ' ').trim();
  const m = s.match(/^(\d[\d\s.,]*?)\s*([a-zåäö]*)\.?\??$/);
  if (!m) return null;
  let x = m[1].replace(/\s/g, '');
  x = x.includes(',') && x.includes('.') ? x.replace(/,/g, '') : x.replace(',', '.');
  const n = Number(x);
  if (!isFinite(n) || n < 0) return null;
  const u = m[2];
  const f = !u || /^(h|hr|hrs|hour|hours|t|tim|timme|timmar|timmars)$/.test(u) ? 1
    : /^(d|dy|dys|day|days|dag|dagar|dgr)$/.test(u) ? HOURS_PER_DAY
    : /^(w|wk|wks|week|weeks|v|vecka|veckor|veckan)$/.test(u) ? HOURS_PER_WEEK
    : /^(m|min|mins|minute|minutes|minut|minuter)$/.test(u) ? 1 / 60 : null;
  return f == null ? null : round2(n * f);
}
// Insats av tre värden; null när alla saknas. Negativa och orimliga värden kapas.
function effortFrom(planned, done, remaining, src = 'tp') {
  const ok = v => v == null || v === '' || !isFinite(+v) ? null : clamp(round2(+v), 0, EFFORT_MAX);
  const e = { planned: ok(planned), done: ok(done), remaining: ok(remaining), src: src === 'planner' ? 'planner' : 'tp' };
  return e.planned == null && e.done == null && e.remaining == null ? null : e;
}
// Planerat: angivet, annars utfört + kvar
const effortPlanned = e => !e ? null : e.planned != null ? e.planned : e.done != null || e.remaining != null ? round2((e.done || 0) + (e.remaining || 0)) : null;
// Kvar: 0 för klara aktiviteter; angivet värde; annars planerat − utfört; annars planerat × (1 − % klart)
function effortLeft(t) {
  const e = t && t.effort;
  if (!e) return null;
  if ((t.progress || 0) >= 100) return 0;
  if (e.remaining != null) return e.remaining;
  const p = effortPlanned(e);
  if (p == null) return null;
  if (e.done != null) return round2(Math.max(0, p - e.done));
  return round2(p * (1 - clamp(t.progress || 0, 0, 100) / 100));
}
// Tilldelade personer: "A, B; C" → ['A', 'B', 'C'] (Planner skiljer med komma, NexusOrdo med semikolon)
const peopleOf = s => [...new Set(String(s || '').split(/[;,\n]/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean))];
// Planners standardinsats: varaktigheten i timmar × antal tilldelade (heltid)
const isDefaultEffort = (planned, duration, n) => { const d = parseWork(duration); return planned != null && d != null && d > 0 && Math.abs(planned - d * Math.max(1, n)) < .01; };
const effortKey = e => e ? [e.planned, e.done, e.remaining].map(v => v ?? '').join('|') : '';
// Uppdatera från Excel: Planners värden skriver över, men insats som satts i NexusOrdo (src 'tp') behålls så länge Planners värde är
// oförändrat sedan förra importen (oldImp; undefined = okänt → behålls). fresh = filens värden (null = tomt i filen).
// → { effort, change: null | { kind: 'new'|'changed'|'overwritten'|'kept', was, now } }
function mergeEffort(old, oldImp, fresh) {
  const copy = e => e ? { ...e } : null;
  if (old && old.src === 'tp') {
    const plannerChanged = oldImp !== undefined && effortKey(oldImp) !== effortKey(fresh);
    if (!plannerChanged) return { effort: copy(old), change: effortKey(old) !== effortKey(fresh) && fresh ? { kind: 'kept', was: copy(old), now: copy(fresh) } : null };
    return { effort: copy(fresh), change: { kind: 'overwritten', was: copy(old), now: copy(fresh) } };
  }
  if (effortKey(old) === effortKey(fresh)) return { effort: copy(fresh), change: null };
  return { effort: copy(fresh), change: { kind: old ? 'changed' : 'new', was: copy(old), now: copy(fresh) } };
}
const numFmt = n => { const s = String(Math.round(n * 10) / 10); return typeof LANG !== 'undefined' && LANG === 'en' ? s : s.replace('.', ','); };
const fmtH = h => h == null ? '–' : numFmt(h) + ' h';
// "16 h · kvar 8 h"
const fmtEffort = e => !e ? '–' : fmtH(effortPlanned(e)) + (e.remaining != null ? ` · ${tr('kvar')} ${fmtH(e.remaining)}` : '');

// Påskdagen (gregoriansk kalender, anonym algoritm) → dagnummer
function easterDay(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return utcDay(y, Math.floor(n / 31) - 1, (n % 31) + 1);
}
// Svenska helgdagar (röda dagar) och midsommar-, jul- och nyårsafton, som de flesta har lediga → [{ day, date, name }] i datumordning
function seHolidays(y) {
  const e = easterDay(y), d = (m, dd) => utcDay(y, m - 1, dd);
  const sat = (m, from) => { let x = d(m, from); while (weekday(x) !== 5) x++; return x; }; // första lördagen från datumet
  const mids = sat(6, 20);
  return [[d(1, 1), 'Nyårsdagen'], [d(1, 6), 'Trettondedag jul'], [e - 2, 'Långfredagen'], [e, 'Påskdagen'], [e + 1, 'Annandag påsk'], [d(5, 1), 'Första maj'],
    [e + 39, 'Kristi himmelsfärdsdag'], [e + 49, 'Pingstdagen'], [d(6, 6), 'Sveriges nationaldag'], [mids - 1, 'Midsommarafton'], [mids, 'Midsommardagen'],
    [sat(10, 31), 'Alla helgons dag'], [d(12, 24), 'Julafton'], [d(12, 25), 'Juldagen'], [d(12, 26), 'Annandag jul'], [d(12, 31), 'Nyårsafton']]
    .map(([day, name]) => ({ day, date: fromDay(day), name })).sort((a, b) => a.day - b.day);
}
const HOLIDAY_CACHE = new Map();
const seHolidaySet = y => { if (!HOLIDAY_CACHE.has(y)) HOLIDAY_CACHE.set(y, new Set(seHolidays(y).map(h => h.day))); return HOLIDAY_CACHE.get(y); };
// Planens arbetskalender: måndag–fredag och svenska helgdagar om inget annat valts
function calendarOf(st) {
  const c = (st && st.calendar) || {};
  const wd = Array.isArray(c.workdays) ? [...new Set(c.workdays.filter(x => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : [];
  return { workdays: wd.length ? wd : [0, 1, 2, 3, 4], holidays: c.holidays === 'none' ? 'none' : 'se' };
}
const isWorkday = (day, cal) => cal.workdays.includes(weekday(day)) && !(cal.holidays === 'se' && seHolidaySet(dObj(day).getUTCFullYear()).has(day));
// Kapacitet: standard h/vecka och per person (namn utan skiftlägeskänslighet)
function capacityOf(st) {
  const c = (st && st.capacity) || {};
  const def = +c.defaultHoursPerWeek > 0 && +c.defaultHoursPerWeek <= 168 ? +c.defaultHoursPerWeek : HOURS_PER_WEEK;
  const people = {};
  if (c.people && typeof c.people === 'object' && !Array.isArray(c.people))
    for (const [k, v] of Object.entries(c.people)) if (String(k).trim() && isFinite(+v) && +v >= 0 && +v <= 168) people[String(k).replace(/\s+/g, ' ').trim().slice(0, 120)] = round2(+v);
  return { defaultHoursPerWeek: def, people };
}
const capHours = (cap, name) => { const k = Object.keys(cap.people).find(x => x.toLowerCase() === String(name).toLowerCase()); return k != null ? cap.people[k] : cap.defaultHoursPerWeek; };
// Programmet (flera planer): programmets värden först, sedan första planen som anger personen; standard från programmet
function mergeCapacity(primary, others = []) {
  const p = capacityOf({ capacity: primary }), people = { ...p.people };
  for (const o of others) for (const [k, v] of Object.entries(capacityOf({ capacity: o }).people))
    if (!Object.keys(people).some(x => x.toLowerCase() === k.toLowerCase())) people[k] = v;
  return { defaultHoursPerWeek: p.defaultHoursPerWeek, people };
}
// Andel → nivå: ≤ 80 % grön, 80–100 % gul, > 100 % röd
const loadLevel = pct => pct == null ? null : pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok';
// Belastning: varje aktivitets insats fördelas jämnt över dess arbetsdagar och delas lika mellan de tilldelade.
// input = plan eller [plan] (programmet), fromWeek = dag i första veckan (dagnummer eller ISO-datum), weeks = antal veckor.
// opts.basis 'remaining' (förval: kvar från idag – kvar på försenade aktiviteter läggs på idag) eller 'planned' (planerat över hela perioden);
// opts.today (dagnummer), opts.dflt = false hoppar över Planners standardinsats.
// → { weeks: [måndag], people: [{ name, hpw, cells: [{ week, hours, capacity, pct, level, tasks: [{ planId, id, name, hours }] }], hours, capacity, pct }],
//     missing (aktiviteter med ansvarig men utan insats), dflt (med Planners standardinsats), tasks (med insats i perioden) }
function workload(input, fromWeek, weeks, calendar, capacity, opts = {}) {
  const plans = (Array.isArray(input) ? input : [input]).filter(Boolean);
  const cal = calendar && Array.isArray(calendar.workdays) ? calendar : calendarOf({ calendar });
  const cap = capacity && capacity.people && capacity.defaultHoursPerWeek ? capacity : capacityOf({ capacity });
  const basis = opts.basis === 'planned' ? 'planned' : 'remaining';
  const f = typeof fromWeek === 'string' ? toDay(fromWeek) : fromWeek;
  const w0 = f - weekday(f), nW = Math.max(1, Math.min(104, weeks | 0 || 1)), end = w0 + nW * 7 - 1;
  const today = opts.today != null ? opts.today : todayDay();
  const weekList = Array.from({ length: nW }, (_, i) => w0 + i * 7);
  const perWeekDays = cal.workdays.length || 5;
  const wdInWeek = weekList.map(w => { let n = 0; for (let d = w; d < w + 7; d++) if (isWorkday(d, cal)) n++; return n; });
  const rows = new Map();
  const row = name => {
    const k = name.toLowerCase();
    if (!rows.has(k)) rows.set(k, { name, cells: weekList.map(() => ({ hours: 0, tasks: [] })) });
    return rows.get(k);
  };
  let missing = 0, dflt = 0, used = 0;
  for (const p of plans) for (const t of p.tasks || []) {
    const e = t.effort, who = peopleOf(t.assignees);
    if (!e) { if (who.length && !t.milestone && (t.progress || 0) < 100) missing++; continue; }
    if (e.dflt) { dflt++; if (opts.dflt === false) continue; }
    const H = basis === 'planned' ? effortPlanned(e) : effortLeft(t);
    let s = toDay(t.start || t.end), en = toDay(t.end || t.start);
    if (!H || H <= 0 || s == null) continue;
    if (basis === 'remaining') { if (en < today) s = en = today; else s = Math.max(s, today); }
    if (en < w0 || s > end) continue;
    let days = [];
    for (let d = s; d <= en; d++) if (isWorkday(d, cal)) days.push(d);
    if (!days.length) days = [en]; // bara helgdagar: insatsen hamnar på slutdagen
    const perDay = H / days.length, names = who.length ? who : [''], share = perDay / names.length;
    let hit = false;
    for (const d of days) {
      if (d < w0 || d > end) continue;
      const wi = Math.floor((d - w0) / 7);
      for (const n of names) {
        const c = row(n).cells[wi];
        c.hours += share;
        const tk = c.tasks.find(x => x.id === t.id && x.planId === p.id);
        if (tk) tk.hours += share; else c.tasks.push({ planId: p.id, id: t.id, name: t.name, hours: share });
      }
      hit = true;
    }
    if (hit) used++;
  }
  for (const n of Object.keys(cap.people)) row(n);
  const people = [...rows.values()].map(r => {
    const unassigned = r.name === '', hpw = unassigned ? null : capHours(cap, r.name);
    const cells = r.cells.map((c, i) => {
      const capacity = hpw == null ? null : round2(hpw * wdInWeek[i] / perWeekDays), hours = round2(c.hours);
      // Ingen kapacitet (t.ex. helgvecka eller 0 h/vecka) men timmar → 999 % (röd)
      const pct = capacity ? Math.round(hours / capacity * 100) : capacity === 0 && hours > 0 ? 999 : null;
      return { week: weekList[i], hours, capacity, pct, level: loadLevel(pct),
        tasks: c.tasks.map(x => ({ ...x, hours: round2(x.hours) })).sort((a, b) => b.hours - a.hours) };
    });
    const hours = round2(cells.reduce((a, c) => a + c.hours, 0)), capacity = hpw == null ? null : round2(cells.reduce((a, c) => a + c.capacity, 0));
    return { name: r.name, hpw, cells, hours, capacity, pct: capacity ? Math.round(hours / capacity * 100) : null };
  }).sort((a, b) => (a.name === '') - (b.name === '') || a.name.localeCompare(b.name, 'sv'));
  return { weeks: weekList, people, missing, dflt, tasks: used };
}
/* ---------- slut insats ---------- */

/* ---------- Burndown (#95) ----------
   Kvarvarande arbete över tid mot en idealkurva, för hela planen, en fas eller en sprint (#77: faser som heter "Sprint N", "PI N" eller "Iteration N").
   Mått i prioritetsordning (burnAuto): timmar (#94, utan Planners standardinsats) om minst hälften av aktiviteterna har insats, annars checklistpunkter (#71)
   om minst hälften har en checklista, annars aktivitetspoäng (varje aktivitet väger 1, kvar = 1 − % klart; milstolpar räknas inte).
   Historik: settings.burn [{ day 'YYYY-MM-DD', scope 'plan' | 'ph:<fas>', measure 'hours'|'checks'|'points', remaining, total }] – ett värde per dag och serie
   (senaste sparningen samma dag ersätter), oförändrade dagar sparas inte (värdet gäller tills det ändras; planen ändras bara genom en sparning), tak BURN_CAP.
   backfill() fyller på bakåt från versionerna (#76, exakt) och milstolpetrendens ögonblicksbilder (#41, uppskattat från klara aktiviteters slutdatum) – bara i minnet.
   Rena funktioner med tester i test/burndown.test.mjs. */
const BURN_CAP = 400, BURN_MEASURES = ['hours', 'checks', 'points'], BURN_SHARE = 0.5;
const burnScopeKey = bucket => bucket == null ? 'plan' : 'ph:' + bucket;
const burnTasks = (tasks, scope) => (tasks || []).filter(t => !scope || scope === 'plan' || 'ph:' + (t.bucket || 'Övrigt') === scope);
// En aktivitets kvar och totalt i måttet, eller null om den inte räknas i måttet
function burnTaskValue(t, measure) {
  const done = (t.progress || 0) >= 100;
  if (measure === 'hours') {
    const e = t.effort;
    if (!e || (e.dflt && e.src !== 'tp')) return null; // Planners standardinsats (varaktighet × 8 h) räknas inte (#94)
    const p = effortPlanned(e), rem = effortLeft(t);
    if (p == null && rem == null) return null;
    return { rem: rem || 0, tot: round2(Math.max(p || 0, (e.done || 0) + (rem || 0))) };
  }
  if (measure === 'checks') {
    const c = Array.isArray(t.checks) ? t.checks : [];
    if (!c.length) return null;
    return { rem: done ? 0 : c.filter(x => !x.done).length, tot: c.length };
  }
  if (t.milestone) return null;
  return { rem: done ? 0 : round2(1 - clamp(t.progress || 0, 0, 100) / 100), tot: 1 };
}
// Summan för aktiviteterna: { remaining, total, n (antal som räknas) }
function burnValue(tasks, measure) {
  let remaining = 0, total = 0, n = 0;
  for (const t of tasks || []) { const v = burnTaskValue(t, measure); if (!v) continue; remaining += v.rem; total += v.tot; n++; }
  return { remaining: round2(remaining), total: round2(total), n };
}
// Måtten som finns för aktiviteterna, med täckning (andel av aktiviteterna som har värde i måttet)
function burnMeasures(tasks) {
  const ts = tasks || [], acts = ts.filter(t => !t.milestone);
  return BURN_MEASURES.map(m => ({ measure: m, n: ts.filter(t => burnTaskValue(t, m)).length,
    share: acts.length ? acts.filter(t => burnTaskValue(t, m)).length / acts.length : 0 })).filter(x => x.n > 0);
}
// Förvalt mått: timmar, annars checklistpunkter (minst hälften av aktiviteterna), annars aktivitetspoäng
function burnAuto(tasks) {
  const ms = burnMeasures(tasks);
  for (const m of ['hours', 'checks']) { const x = ms.find(y => y.measure === m); if (x && x.share >= BURN_SHARE) return m; }
  return 'points';
}
// Lägg till ett värde: samma dag och serie ersätter, oförändrat värde sparas inte, äldre dag än den senaste ignoreras. Taket tar bort de äldsta.
function recordSample(list, s, cap = BURN_CAP) {
  const out = Array.isArray(list) ? [...list] : [];
  if (!s || !s.day || !s.scope || !s.measure) return out;
  let li = -1;
  for (let i = out.length - 1; i >= 0; i--) if (out[i].scope === s.scope && out[i].measure === s.measure) { li = i; break; }
  const last = li >= 0 ? out[li] : null, row = { day: s.day, scope: s.scope, measure: s.measure, remaining: round2(+s.remaining || 0), total: round2(+s.total || 0) };
  if (last && last.day > row.day) return out;
  if (last && last.day === row.day) {
    let pi = -1;
    for (let i = li - 1; i >= 0; i--) if (out[i].scope === s.scope && out[i].measure === s.measure) { pi = i; break; }
    // tillbaka till förra dagens värde samma dag → dagens värde behövs inte
    if (pi >= 0 && out[pi].remaining === row.remaining && out[pi].total === row.total) out.splice(li, 1); else out[li] = row;
    return out;
  }
  if (last && last.remaining === row.remaining && last.total === row.total) return out;
  out.push(row);
  if (out.length > cap) out.splice(0, out.length - cap);
  return out;
}
// Alla serier för en plan en viss dag: hela planen och varje fas, i de mått som finns
function planSamples(tasks, day) {
  const out = [], scopes = ['plan', ...[...new Set((tasks || []).map(t => t.bucket || 'Övrigt'))].map(burnScopeKey)];
  for (const scope of scopes) {
    const ts = burnTasks(tasks, scope);
    for (const m of burnMeasures(ts)) { const v = burnValue(ts, m.measure); out.push({ day, scope, measure: m.measure, remaining: v.remaining, total: v.total }); }
  }
  return out;
}
// Spara dagens värden i settings.burn (anropas vid sparning och uppdatering från Excel)
function burnRecord(burn, tasks, day, cap = BURN_CAP) {
  let out = Array.isArray(burn) ? burn : [];
  for (const s of planSamples(tasks, day)) out = recordSample(out, s, cap);
  return out;
}
// Uppskattning en tidigare dag utifrån aktiviteterna nu: klar och slutdatum (= Planners Completed Date) senast den dagen → 0 kvar; klar senare → allt kvar;
// inte klar → kvar som nu (en undre gräns)
function estimateAt(tasks, day, measure) {
  let remaining = 0, total = 0, n = 0;
  for (const t of tasks || []) {
    const v = burnTaskValue(t, measure); if (!v) continue;
    n++; total += v.tot;
    if ((t.progress || 0) >= 100) { const e = toDay(t.end || t.start); remaining += e != null && e <= day ? 0 : v.tot; } else remaining += v.rem;
  }
  return { remaining: round2(remaining), total: round2(total), n };
}
// Historik bakåt: versionerna (#76, hela planen – exakt, den senaste per dag) och ögonblicksbilderna (#41, bara datum – uppskattat).
// versions = [{ at ISO, data: { tasks } }], snapshots = [{ at 'YYYY-MM-DD' }], tasks = planens aktiviteter nu. Dagar från idag och framåt tas inte med.
// → [{ day, scope, measure, remaining, total, src: 'ver' | 'est' }] i dagordning
function backfill({ versions = [], snapshots = [], tasks = [], today } = {}) {
  const td = today != null ? today : todayDay(), byDay = new Map();
  for (const v of [...(versions || [])].filter(v => v && v.at && v.data && Array.isArray(v.data.tasks)).sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const day = String(v.at).slice(0, 10); if (toDay(day) == null || toDay(day) >= td) continue;
    byDay.set(day, planSamples(v.data.tasks, day).map(s => ({ ...s, src: 'ver' })));
  }
  for (const s of snapshots || []) {
    const day = String((s && s.at) || '').slice(0, 10), d = toDay(day);
    if (d == null || d >= td || byDay.has(day)) continue;
    const out = [], scopes = ['plan', ...[...new Set(tasks.map(t => t.bucket || 'Övrigt'))].map(burnScopeKey)];
    for (const scope of scopes) { const ts = burnTasks(tasks, scope); for (const m of burnMeasures(ts)) { const v = estimateAt(ts, d, m.measure); out.push({ day, scope, measure: m.measure, remaining: v.remaining, total: v.total, src: 'est' }); } }
    byDay.set(day, out);
  }
  return [...byDay.keys()].sort().flatMap(k => byDay.get(k));
}
// Arbetsdagar i [a, b]
const workdaysIn = (a, b, cal) => { let n = 0; for (let d = a; d <= b; d++) if (isWorkday(d, cal)) n++; return n; };
// Idealkurvan: från total vid start till 0 på slutdagen, nedåt bara på arbetsdagar (#94-kalendern) → [{ d, v }] en punkt per dag
function idealLine(start, end, total, calendar) {
  const s = typeof start === 'string' ? toDay(start) : start, e = typeof end === 'string' ? toDay(end) : end;
  if (s == null || e == null || e < s || !(total > 0)) return [];
  const cal = calendar && Array.isArray(calendar.workdays) ? calendar : calendarOf({ calendar });
  const steps = workdaysIn(s + 1, e, cal), out = [];
  if (!steps) return [{ d: s, v: round2(total) }, { d: e, v: 0 }];
  let k = 0;
  for (let d = s; d <= e; d++) { if (d > s && isWorkday(d, cal)) k++; out.push({ d, v: round2(total * (1 - k / steps)) }); }
  return out;
}
// Sprintar (#77): faser som heter Sprint N, Iteration N eller PI N → [{ bucket, n, start, end }] i startordning
const SPRINT_RE = /^(sprint|iteration|pi)\s*[-–:]?\s*(\d+)\b/i;
function detectSprints(p) {
  const tasks = (p && p.tasks) || [], out = [];
  for (const b of [...new Set(tasks.map(t => t.bucket || 'Övrigt'))]) {
    const m = String(b).trim().match(SPRINT_RE); if (!m) continue;
    const ds = tasks.filter(t => (t.bucket || 'Övrigt') === b).flatMap(t => [toDay(t.start || t.end), toDay(t.end || t.start)]).filter(x => x != null);
    out.push({ bucket: b, n: +m[2], start: ds.length ? Math.min(...ds) : null, end: ds.length ? Math.max(...ds) : null });
  }
  return out.sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9) || a.n - b.n);
}
// Planens tidsspann för aktiviteterna i omfånget (dagnummer)
function burnSpan(tasks) {
  const ds = (tasks || []).flatMap(t => [toDay(t.start || t.end), toDay(t.end || t.start)]).filter(x => x != null);
  return ds.length ? { start: Math.min(...ds), end: Math.max(...ds) } : { start: null, end: null };
}
// Värdet en viss dag (stegfunktion: senaste punkten den dagen eller före; före första punkten → första)
const burnAt = (points, d) => { let v = null; for (const p of points || []) { if (p.d <= d) v = p; else break; } return v || (points && points[0]) || null; };
// Serien för ett omfång och ett mått: sparade värden (+ extra från backfill, sparade vinner samma dag), uppskattning vid start om historik saknas, värdet nu idag.
// → { scope, measure, start, end, remaining, total, n, points [{ d, remaining, total, src: 'rec'|'ver'|'est'|'now' }], ideal, changes [{ d, from, to }] }
function burnSeries(p, scope, measure, calendar, opts = {}) {
  const today = opts.today != null ? opts.today : todayDay();
  const tasks = burnTasks((p && p.tasks) || [], scope || 'plan'), cur = burnValue(tasks, measure), span = burnSpan(tasks);
  const key = s => s.scope === (scope || 'plan') && s.measure === measure;
  const byDay = new Map();
  for (const s of (opts.extra || []).filter(key)) byDay.set(s.day, { d: toDay(s.day), remaining: s.remaining, total: s.total, src: s.src || 'est' });
  for (const s of (((p && p.settings) || {}).burn || []).filter(key)) byDay.set(s.day, { d: toDay(s.day), remaining: s.remaining, total: s.total, src: 'rec' });
  let points = [...byDay.values()].filter(x => x.d != null && x.d < today).sort((a, b) => a.d - b.d);
  // före omfångets start: bara värdet vid start (det senaste före), så att kurvan börjar vid start
  if (span.start != null && points.length && points[0].d < span.start) {
    const before = points.filter(x => x.d < span.start), rest = points.filter(x => x.d >= span.start);
    points = rest.length && rest[0].d === span.start ? rest : [{ ...before[before.length - 1], d: span.start }, ...rest];
  }
  if (span.start != null && span.start < today && !(points.length && points[0].d <= span.start)) {
    const e = estimateAt(tasks, span.start, measure);
    points.unshift({ d: span.start, remaining: e.remaining, total: e.total, src: 'est' });
  }
  // avslutat omfång utan värde från slutdagen: uppskattning på slutdagen (velocity och kurvans slut)
  if (span.end != null && span.end < today && !points.some(x => x.d >= span.end)) {
    const e = estimateAt(tasks, span.end, measure);
    points.push({ d: span.end, remaining: e.remaining, total: e.total, src: 'est' });
  }
  points.push({ d: today, remaining: cur.remaining, total: cur.total, src: 'now' });
  const changes = [];
  for (let i = 1; i < points.length; i++) if (points[i].total > points[i - 1].total + 1e-9 && points[i].src !== 'est' && points[i - 1].src !== 'est') changes.push({ d: points[i].d, from: points[i - 1].total, to: points[i].total });
  const at0 = span.start != null ? burnAt(points, span.start) : null;
  const idealTotal = at0 && span.start < today ? at0.total : cur.total;
  return { scope: scope || 'plan', measure, start: span.start, end: span.end, remaining: cur.remaining, total: cur.total, n: cur.n,
    points, ideal: idealLine(span.start, span.end, idealTotal, calendar), changes };
}
// Velocity: klart per sprint = totalt − kvar vid sprintens slut (eller idag för pågående) → [{ bucket, n, start, end, done, total, state }] + medel för avslutade
function velocity(p, measure, calendar, opts = {}) {
  const today = opts.today != null ? opts.today : todayDay();
  const rows = detectSprints(p).map(s => {
    const ser = burnSeries(p, burnScopeKey(s.bucket), measure, calendar, { ...opts, today });
    const at = burnAt(ser.points, s.end != null ? Math.min(s.end, today) : today) || { remaining: ser.remaining, total: ser.total };
    const state = s.start != null && s.start > today ? 'future' : s.end != null && s.end < today ? 'done' : 'active';
    return { ...s, done: state === 'future' ? 0 : round2(Math.max(0, at.total - at.remaining)), total: at.total, state };
  });
  const fin = rows.filter(r => r.state === 'done');
  return { rows, avg: fin.length ? round2(fin.reduce((a, r) => a + r.done, 0) / fin.length) : null };
}
// Programmet (#95): summan av planernas serier när måttet finns i alla planer, annars en serie per plan i planens eget mått.
// plans = [plan], measure = valt mått eller null (gemensamt förval). → { mode: 'sum'|'per', measure, series: [{ plan, s }], sum? }
function programBurn(plans, measure, calendar, opts = {}) {
  const today = opts.today != null ? opts.today : todayDay(), extra = opts.extra || {};
  const pls = (plans || []).filter(pl => pl && (pl.tasks || []).length);
  const has = (pl, m) => burnMeasures(pl.tasks).some(x => x.measure === m);
  const common = BURN_MEASURES.filter(m => pls.length && pls.every(pl => has(pl, m)));
  const autoCommon = common.find(m => m !== 'points' && pls.every(pl => burnAuto(pl.tasks) === m)) || (common.includes('points') ? 'points' : common[0]);
  const m = measure || autoCommon;
  if (!m || !common.includes(m)) {
    return { mode: 'per', measure: m || null, common, series: pls.map(pl => { const pm = measure && has(pl, measure) ? measure : burnAuto(pl.tasks); return { plan: pl, s: burnSeries(pl, 'plan', pm, calendar, { today, extra: extra[pl.id] }) }; }) };
  }
  const series = pls.map(pl => ({ plan: pl, s: burnSeries(pl, 'plan', m, calendar, { today, extra: extra[pl.id] }) }));
  const days = [...new Set(series.flatMap(x => x.s.points.map(q => q.d)))].sort((a, b) => a - b);
  const points = days.map(d => {
    const vs = series.map(x => burnAt(x.s.points, d));
    return { d, remaining: round2(vs.reduce((a, v) => a + (v ? v.remaining : 0), 0)), total: round2(vs.reduce((a, v) => a + (v ? v.total : 0), 0)),
      src: d === today ? 'now' : series.every(x => { const v = burnAt(x.s.points, d); return v && v.src !== 'est'; }) ? 'rec' : 'est' };
  });
  const starts = series.map(x => x.s.start).filter(x => x != null), ends = series.map(x => x.s.end).filter(x => x != null);
  const start = starts.length ? Math.min(...starts) : null, end = ends.length ? Math.max(...ends) : null;
  const changes = [];
  for (let i = 1; i < points.length; i++) if (points[i].total > points[i - 1].total + 1e-9 && points[i].src !== 'est' && points[i - 1].src !== 'est') changes.push({ d: points[i].d, from: points[i - 1].total, to: points[i].total });
  const at0 = start != null ? burnAt(points, start) : null, last = points[points.length - 1];
  const idealTotal = at0 && start < today ? at0.total : last.total;
  return { mode: 'sum', measure: m, common, series,
    sum: { scope: 'program', measure: m, start, end, remaining: last.remaining, total: last.total, points, ideal: idealLine(start, end, idealTotal, calendar), changes } };
}
// Planens burn från en fil (#69): bara giltiga rader följer med
const cleanBurn = v => Array.isArray(v) ? v.filter(s => s && typeof s === 'object' && typeof s.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.day)
  && typeof s.scope === 'string' && (s.scope === 'plan' || s.scope.startsWith('ph:')) && BURN_MEASURES.includes(s.measure) && isFinite(+s.remaining) && isFinite(+s.total))
  .slice(-BURN_CAP).map(s => ({ day: s.day, scope: s.scope.slice(0, 210), measure: s.measure, remaining: round2(Math.max(0, +s.remaining)), total: round2(Math.max(0, +s.total)) })) : [];
/* ---------- slut burndown ---------- */

/* ---------- Baslinjer (#5) ----------
   settings.baselines = [{ id, name, at (ISO), tasks: { <taskId>: { s, e } } }], högst BL_MAX (som MS Project). Nycklarna är aktiviteternas
   bestående id, så baslinjen överlever Uppdatera från Excel. Vilken baslinje som visas är ett val per användare (ui.blSel), inte en ändring i planen.
   Avvikelse i kalenderdagar, som "flyttad ±N d". */
const BL_MAX = 11, BL_DAY = /^\d{4}-\d{2}-\d{2}$/;
function makeBaseline(tasks, name, at = new Date().toISOString(), id = 'bl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) {
  const out = {};
  for (const t of tasks || []) { const a = t.start || t.end, b = t.end || t.start; if (t.id && a && b) out[t.id] = { s: a, e: b }; }
  return { id, name: String(name || '').trim().slice(0, 80) || 'Baslinje', at, tasks: out };
}
const baselinesOf = st => (st && Array.isArray(st.baselines) ? st.baselines : []);
// Avvikelse mot baslinjen: ds/de = dagar (positivt = senare); null när aktiviteten saknas i baslinjen eller saknar datum nu
function baselineVar(t, bl) {
  const b = bl && bl.tasks[t.id];
  if (!b) return null;
  const a = toDay(t.start || t.end), e = toDay(t.end || t.start);
  if (a == null || e == null) return null;
  return { s: b.s, e: b.e, ds: a - toDay(b.s), de: e - toDay(b.e) };
}
// Senare, tidigare och oförändrade (på slutdatum), nya sedan baslinjen och borttagna
function baselineSummary(tasks, bl) {
  const r = { later: 0, earlier: 0, same: 0, added: 0, removed: 0, maxLate: 0 };
  if (!bl) return r;
  const ids = new Set();
  for (const t of tasks || []) {
    ids.add(t.id);
    if (!(t.start || t.end)) continue;
    if (!bl.tasks[t.id]) { r.added++; continue; }
    const v = baselineVar(t, bl);
    if (v.de > 0) { r.later++; r.maxLate = Math.max(r.maxLate, v.de); } else if (v.de < 0) r.earlier++; else r.same++;
  }
  r.removed = Object.keys(bl.tasks).filter(id => !ids.has(id)).length;
  return r;
}
// Fil (#69): bara giltiga baslinjer följer med – id och namn som text, datum som ÅÅÅÅ-MM-DD, högst BL_MAX
function cleanBaselines(v) {
  if (!Array.isArray(v)) return [];
  const out = [], seen = new Set();
  for (const b of v) {
    if (out.length >= BL_MAX || !b || typeof b !== 'object' || Array.isArray(b) || typeof b.id !== 'string' || !b.id || b.id.length > 40 || seen.has(b.id)) continue;
    if (!b.tasks || typeof b.tasks !== 'object' || Array.isArray(b.tasks)) continue;
    const tasks = {};
    for (const [k, x] of Object.entries(b.tasks)) if (k.length <= 120 && x && BL_DAY.test(x.s) && BL_DAY.test(x.e)) tasks[k] = { s: x.s, e: x.e };
    seen.add(b.id);
    out.push({ id: b.id, name: String(b.name || '').trim().slice(0, 80) || 'Baslinje', at: typeof b.at === 'string' ? b.at.slice(0, 40) : '', tasks });
  }
  return out;
}
/* ---------- slut baslinjer ---------- */

/* ---------- Beroendetyper och fördröjning (#83) ----------
   Planner Premium (och MS Project) skriver beroenden som "26AS, 23AS" (svenska) eller "27FS, 24SS+2 days" (engelska).
   Svenska koder: AS = avslut–start (FS), SS = start–start, AA = avslut–avslut (FF), SA = start–avslut (SF). Koderna krockar inte mellan språken,
   så båda godtas oavsett lang (lang är bara en ledtråd). Fördröjning i arbetsdagar: timmar ÷ 8, veckor × 5, månader × 20, kalenderdagar (ed) × 5/7;
   procent av föregångarens varaktighet löses upp efteråt (depLagFromPct). Lagras per aktivitet som t.depInfo = { <föregångarens id>: { type, lag, src? } }
   med t.deps kvar som listan med id. src 'planner' = beroendet kommer från filen (skrivs över vid uppdatering); utan src = NexusOrdos eget (kan ändras i panelen). */
const DEP_CODES = { FS: 'FS', SS: 'SS', FF: 'FF', SF: 'SF', AS: 'FS', AA: 'FF', SA: 'SF' };
const DEP_UNITS = [
  [/^(d|dy|dys|day|days|dag|dagar|dgr)$/, 1], [/^(ed|eday|edays|kd|kalenderdag|kalenderdagar)$/, 5 / 7], [/^(h|hr|hrs|hour|hours|t|tim|timme|timmar)$/, 1 / 8],
  [/^(w|wk|wks|week|weeks|v|vk|vecka|veckor)$/, 5], [/^(mo|mon|mons|month|months|mån|månad|månader)$/, 20], [/^(m|min|mins|minute|minutes|minut|minuter)$/, 1 / 480],
];
// "26AS" / "24SS+2 days" / "3 FF -1 d" / "5SF+10%" → { num, type, lagDays, lagPct } (lagPct när fördröjningen är i procent, annars null). Okänt → null.
function parseDepRef(str, lang) {
  const s = String(str ?? '').replace(/[−–—]/g, '-').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d+)\s*([A-Za-zÅÄÖåäö]{2})?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*([A-Za-zÅÄÖåäö%]*)\.?)?$/);
  if (!m) return null;
  const type = m[2] ? DEP_CODES[m[2].toUpperCase()] : 'FS';
  if (!type) return null;
  const out = { num: m[1], type, lagDays: 0, lagPct: null };
  if (m[3]) {
    const n = (m[3] === '-' ? -1 : 1) * parseFloat(m[4].replace(',', '.')), u = m[5].toLowerCase();
    if (u === '%') { out.lagPct = n; out.lagDays = null; }
    else if (!u) out.lagDays = n;
    else {
      const hit = DEP_UNITS.find(([re]) => re.test(u));
      if (!hit) return null;
      out.lagDays = n * hit[1];
    }
    if (out.lagDays != null) out.lagDays = Math.round(out.lagDays * 100) / 100 || 0;
  }
  return out;
}
// Procentuell fördröjning → arbetsdagar (mån–fre) av föregångarens varaktighet
function depLagFromPct(pct, pred) {
  const a = pred && toDay(pred.start || pred.end), b = pred && toDay(pred.end || pred.start);
  if (a == null || b == null) return 0;
  let n = 0; for (let d = Math.min(a, b); d <= Math.max(a, b); d++) if (weekday(d) < 5) n++;
  return Math.round(pct / 100 * n * 100) / 100 || 0;
}
// Beroendefältet i en import → { deps: ['p_26', …], info: { p_26: { type, lag, src: 'planner' }, … }, pct: { p_26: 10 } }
function parseDepCell(cell, lang) {
  const deps = [], info = {}, pct = {};
  for (const part of String(cell ?? '').split(/[,;]/)) {
    if (!part.trim()) continue;
    const r = parseDepRef(part, lang), m = part.trim().match(/^(\d+)/);
    const id = r ? 'p_' + r.num : m ? 'p_' + m[1] : null; // okänd typ eller enhet: som förut, slut–start utan fördröjning
    if (!id || deps.includes(id)) continue;
    deps.push(id);
    info[id] = { type: r ? r.type : 'FS', lag: r && r.lagDays != null ? r.lagDays : 0, src: 'planner' };
    if (r && r.lagPct != null) pct[id] = r.lagPct;
  }
  return { deps, info, pct };
}
// depInfo från en fil (#69, versioner): bara id i deps, känd typ, tal som fördröjning (±3650 arbetsdagar), src bara 'planner' → objekt eller null
function cleanDepInfo(di, deps) {
  if (!di || typeof di !== 'object' || Array.isArray(di)) return null;
  const out = {};
  for (const d of Array.isArray(deps) ? deps : []) {
    const x = Object.prototype.hasOwnProperty.call(di, d) ? di[d] : null;
    if (!x || typeof x !== 'object') continue;
    const type = /^[SF][SF]$/.test(String(x.type)) ? String(x.type) : 'FS', lag = isFinite(+x.lag) ? Math.max(-3650, Math.min(3650, Math.round(+x.lag * 100) / 100)) : 0;
    out[d] = x.src === 'planner' ? { type, lag, src: 'planner' } : { type, lag };
  }
  return Object.keys(out).length ? out : null;
}
// t.depInfo bara för id som finns i t.deps; tomt → fältet tas bort (ändrar t)
function pruneDepInfo(t) {
  if (!t || !t.depInfo) return t;
  const keep = (t.deps || []).filter(d => t.depInfo[d]);
  if (!keep.length) delete t.depInfo;
  else if (keep.length !== Object.keys(t.depInfo).length) t.depInfo = Object.fromEntries(keep.map(d => [d, t.depInfo[d]]));
  return t;
}
const depInfoOf = (t, id) => { const x = t && t.depInfo && t.depInfo[id]; return { type: cpType(x && x.type), lag: x && isFinite(+x.lag) ? +x.lag : 0, src: x && x.src === 'planner' ? 'planner' : '' }; };
// "SS +2 d" (tom sträng för vanligt slut–start utan fördröjning om plain)
const fmtDepLag = lag => lag ? `${lag > 0 ? '+' : '−'}${String(Math.abs(lag)).replace('.', typeof LANG === 'string' && LANG === 'en' ? '.' : ',')} ${tr('d')}` : '';
const fmtDepType = (type, lag, plain) => (plain && type === 'FS' && !lag) ? '' : [type, fmtDepLag(lag)].filter(Boolean).join(' ');
// n arbetsdagar från dag d (negativt = bakåt); 0 = samma dag
function addWorkdays(d, n, cal) {
  let k = 0, x = d, guard = 0; const step = n < 0 ? -1 : 1, want = Math.abs(n);
  while (k < want && guard++ < 5000) { x += step; if (isWorkday(x, cal)) k++; }
  return x;
}
// Röd pil i plan-Gantt: bryter efterföljaren mot beroendet? (#83, ren funktion)
// FS: efterföljaren startar först dagen efter föregångarens slut + fördröjning (en milstolpe får ligga samma dag);
// SS: start ≥ föregångarens start + fördröjning; FF: slut ≥ föregångarens slut + fördröjning; SF: slut ≥ föregångarens start + fördröjning.
// Fördröjning i arbetsdagar (avrundad), planens kalender. → { type, lag, bad, need (dag som gränsen gäller) } eller null utan datum.
function taskDepCheck(pred, succ, info, cal) {
  if (!pred || !succ) return null;
  const type = cpType(info && info.type), lag = cpLag(info && info.lag);
  const a = toDay(type[0] === 'S' ? (pred.start || pred.end) : (pred.end || pred.start));
  const b = toDay(type[1] === 'S' ? (succ.start || succ.end) : (succ.end || succ.start));
  if (a == null || b == null) return null;
  const need = lag ? addWorkdays(a, lag, cal) : a, strict = type === 'FS' && !succ.milestone;
  return { type, lag, bad: strict ? b <= need : b < need, need };
}
/* ---------- slut beroendetyper ---------- */

async function parseWorkbook(file) {
  if (!window.XLSX) throw new Error(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  // NexusOrdos egen export (#69) känns igen före Planner-formaten, så att den aldrig tolkas som en Planner-export
  if (wb.SheetNames.some(n => n.trim().toLowerCase() === TP_SHEET.toLowerCase())) return { timeplan: readExport(wb), build: sheetBuild(wb, TP_SHEET) };
  // Mallfil (#73)
  if (wb.SheetNames.some(n => n.trim().toLowerCase() === TPL_SHEET.toLowerCase())) return { template: readTemplateWb(wb), build: sheetBuild(wb, TPL_SHEET) };
  let best = null;
  const sheets = [...wb.SheetNames].sort((a, b) => /consolidated|sammanställ|konsoliderad/i.test(b) - /consolidated|sammanställ|konsoliderad/i.test(a));
  const sheetRows = sn => XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
  for (const sn of sheets) {
    const rows = sheetRows(sn);
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const map = mapHeader(rows[i]);
      if (map.name != null && (map.end != null || map.start != null || map.bucket != null)) { best = { rows, i, map, sn }; break; }
    }
    if (best) break;
  }
  if (!best) throw new Error(tr('Hittade inga kolumner som liknar en Planner-export (t.ex. ”Task Name”/”Aktivitetsnamn” och ”Due date”/”Förfallodatum”).'));
  const { rows, i: hi, map } = best;
  // Plannamn står i rubrikraderna ovanför tabellen
  let planName = null, planId = null;
  for (let r = 0; r < hi; r++) {
    const k = norm(rows[r][0]);
    if (/^(plan name|plannamn|namn på plan|planens namn|plan|project name|projektnamn)$/.test(k) && rows[r][1]) planName = String(rows[r][1]).trim();
  }
  const planSheet = wb.SheetNames.find(sn => /^plan$/i.test(sn.trim()));
  if (planSheet) {
    const [head = [], val = []] = sheetRows(planSheet);
    const col = re => head.findIndex(h => re.test(norm(h)));
    const n = col(/^(plan name|plannamn|namn på plan|planens namn)$/), id = col(/^(plan id|plan-id)$/);
    if (n >= 0 && val[n]) planName = String(val[n]).trim();
    if (id >= 0 && val[id]) planId = String(val[id]).trim();
  }
  const get = (row, k) => map[k] != null ? row[map[k]] : '';
  const depLang = map.depends != null && /beroende|föregående/.test(norm(rows[hi][map.depends])) ? 'sv' : 'en';
  // Utan bucket-kolumn (MS Project/Planner Premium) är faserna egna rader: antingen nivå 1 i
  // dispositionen, eller rader med textkod som ID (t.ex. gate-koder G1, G2) bland numrerade aktiviteter.
  const body = rows.slice(hi + 1).filter(row => String(get(row, 'name') ?? '').trim());
  const level = row => parseInt(get(row, 'outline')) || 0;
  const numId = row => /^\d+([.,]\d+)*$/.test(String(get(row, 'id')).trim());
  let isPhase = () => false;
  if (map.bucket == null) {
    if (map.outline != null && body.some(r => level(r) > 1)) isPhase = (row, i) => level(row) === 1 && level(body[i + 1] || []) > 1;
    else if (map.id != null && body.some(numId)) isPhase = row => String(get(row, 'id')).trim() !== '' && !numId(row);
  }
  const tasks = [], phases = [], phaseCodes = {}, importedAt = new Date().toISOString();
  const hasWork = map.work != null || map.workDone != null || map.workLeft != null;
  let phase = null;
  for (const [i, row] of body.entries()) {
    const name = String(get(row, 'name') ?? '').trim();
    if (isPhase(row, i)) { phase = name; if (!phases.includes(name)) phases.push(name); phaseCodes[name] = String(get(row, 'id')).trim(); continue; }
    const bucket = String(get(row, 'bucket') || '').trim() || phase || 'Övrigt';
    const progress = parseProgress(get(row, 'progress'), get(row, 'checkDone'));
    const doneDate = progress >= 100 ? parseDate(get(row, 'completed')) : null;
    let start = parseDate(get(row, 'start')), end = doneDate || parseDate(get(row, 'end')) || parseDate(get(row, 'finish'));
    if (!start && end) start = end;
    if (start && !end) end = start;
    if (start && end && start > end) [start, end] = [end, start];
    const labels = String(get(row, 'labels') || '').trim();
    const pid = String(get(row, 'id') || '').trim() || `n:${bucket}|${name}`;
    // Premiums "Task number" och MS Project-liknande ID är radplats och numreras om (#28) – matchas på namn + fas
    const positional = numId(row);
    // Insats (#94): bara när filen har någon av arbetskolumnerna; tomt i filen = null
    let effort;
    if (hasWork) {
      effort = effortFrom(parseWork(get(row, 'work')), parseWork(get(row, 'workDone')), parseWork(get(row, 'workLeft')), 'planner');
      if (effort && isDefaultEffort(effort.planned, get(row, 'duration'), peopleOf(get(row, 'assignees')).length)) effort.dflt = true;
    }
    tasks.push({
      id: 'p_' + pid, plannerId: pid, positional, name: name.replace(/\s+/g, ' '), bucket, start, end,
      progress,
      priority: String(get(row, 'priority') || '').trim(),
      assignees: String(get(row, 'assignees') || '').trim(),
      labels, description: String(get(row, 'description') || '').trim(),
      // Checklista (#71): punkterna och Planners räknare; punkter utan kolumn i filen rörs inte vid uppdatering
      ...(map.checklist != null ? { checks: parseChecks(get(row, 'checklist'), importedAt) } : {}),
      ...(map.checkDone != null ? { plannerChecks: parseCheckCount(get(row, 'checkDone')) } : {}),
      goals: String(get(row, 'goals') || '').trim(),
      ...(hasWork ? { effort: effort || null } : {}),
      // "27FS, 24SS+2 days" / "26AS, 23AA" → aktivitet 27 och 24 med typ och fördröjning (#83)
      ...(() => { const d = parseDepCell(get(row, 'depends'), depLang); return { deps: d.deps, ...(d.deps.length ? { depInfo: d.info } : {}), ...(Object.keys(d.pct).length ? { _depPct: d.pct } : {}) }; })(),
      milestone: MS_RE.test(labels) || MS_NAME_RE.test(name) || /^0([.,]0+)?\s*[a-zåäö]*\??$/i.test(String(get(row, 'duration')).trim()),
      notes: '',
    });
  }
  const ids = new Set(tasks.map(t => t.id)), byPid = new Map(tasks.map(t => [t.id, t]));
  tasks.forEach(t => {
    t.deps = t.deps.filter(d => d !== t.id && ids.has(d));
    if (t.depInfo) {
      // Fördröjning i procent av föregångarens varaktighet → arbetsdagar; info bara för kvarvarande beroenden
      for (const [d, pc] of Object.entries(t._depPct || {})) if (t.depInfo[d]) t.depInfo[d].lag = depLagFromPct(pc, byPid.get(d));
      t.depInfo = Object.fromEntries(t.deps.map(d => [d, t.depInfo[d]]));
      if (!t.deps.length) delete t.depInfo;
    }
    delete t._depPct;
  });
  if (!tasks.length) throw new Error(tr('Filen innehöll inga aktiviteter.'));
  const userSheet = wb.SheetNames.find(sn => /^(users|användare)$/i.test(sn.trim()));
  let people = [];
  if (userSheet) {
    const [head = [], ...body] = sheetRows(userSheet);
    const n = head.findIndex(h => /^(user name|name|namn)$/.test(norm(h))), e = head.findIndex(h => /^(email|e-post|e-mail)$/.test(norm(h)));
    if (e >= 0) people = body.filter(r => String(r[e] || '').includes('@')).map(r => ({ name: n >= 0 ? String(r[n] || '').trim() : '', email: String(r[e]).trim().toLowerCase() }));
  }
  const goalSheet = wb.SheetNames.find(sn => /^(project |projekt)?(goals|mål)$/i.test(sn.trim()));
  if (goalSheet) tasks.push(...goalMilestones(sheetRows(goalSheet), tasks));
  return { planName: planName || file.name.replace(/\.(xlsx|xls|csv)$/i, ''), planId, tasks, phases, phaseCodes, people, cols: Object.keys(map) };
}

// Planners Goals används som gater (G1, G2 …). Milstolpen hamnar i fasen som gaten avslutar enligt
// PMI-faserna, annars i den fas där flest av goalets aktiviteter ligger.
function goalMilestones(rows, tasks) {
  const [head = [], ...body] = rows;
  const col = re => head.findIndex(h => re.test(norm(h)));
  const c = { id: col(/^(goal id|mål-id)$/), name: col(/^(goal name|goal|målnamn|mål|name|namn)$/), status: col(/^status$/),
    end: col(/^(finish date|due date|end date|target date|slutdatum|avslutsdatum|förfallodatum|måldatum)$/), conn: col(/^(connected tasks|kopplade aktiviteter|kopplade uppgifter|anslutna uppgifter)$/) };
  if (c.name < 0) return [];
  return body.filter(r => String(r[c.name] ?? '').trim()).map(r => {
    const name = String(r[c.name]).trim(), date = c.end >= 0 ? parseDate(r[c.end]) : null;
    // Premium anger kopplade aktiviteter som "nummer-namn"; koppla dem till goalet
    const nums = c.conn >= 0 ? [...String(r[c.conn] ?? '').matchAll(/(?:^|,)\s*(\d+)-/g)].map(m => 'p_' + m[1]) : [];
    tasks.filter(t => nums.includes(t.id) && !t.goals).forEach(t => t.goals = name);
    const counts = {};
    tasks.filter(t => t.goals === name).forEach(t => counts[t.bucket] = (counts[t.bucket] || 0) + 1);
    const pmi = PMI_PHASES.find(ph => ph.gates.includes(name.toUpperCase()));
    const bucket = (pmi && tasks.map(t => t.bucket).find(b => pmi.re.test(b) && !PMI_PHASES.some(o => o !== pmi && o.order > pmi.order && o.re.test(b))))
      || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'Övrigt';
    const pid = 'goal:' + (c.id >= 0 && r[c.id] ? String(r[c.id]).trim() : name);
    return {
      id: 'p_' + pid, plannerId: pid, name: /^[A-ZÅÄÖ][A-ZÅÄÖ0-9]{0,4}$/.test(name) ? `Gate ${name}` : name, bucket,
      start: date, end: date, progress: c.status >= 0 ? parseProgress(r[c.status]) : 0,
      goalStatus: c.status >= 0 ? normGoalStatus(r[c.status]) : null,
      priority: '', assignees: '', labels: '', description: '', goals: name,
      milestone: true, gate: true, deps: [], notes: '',
    };
  });
}

// Matchar en ny import mot planen (#28). Vanliga Planner-ID är stabila och matchas exakt. Premiums radnummer
// är det inte: där matchas namn + fas, med numret som avgörande när namnet är tvetydigt. Osäkra fall gissas aldrig –
// de blir nya aktiviteter med t.check. Varje aktivitet bär med sig värdena från senaste importen (t.imp), så att
// flyttade datum (t.moved) och ändringar gjorda i NexusOrdo som skrivs över kan visas. Rör inte planen.
const normName = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
function mergeImport(p, imp) {
  const olds = p.tasks.filter(t => t.plannerId), used = new Set();
  const byPid = new Map(olds.map(t => [t.plannerId, t]));
  const hasData = t => !!(t.notes || (t.deps || []).length || t.milestoneManual || (t.links || []).length || (t.checks || []).some(c => c.done || c.src !== 'planner'));
  const report = { moved: [], uncertain: [], overwritten: [], lost: [], changed: [], actualProposals: [], checks: [], effort: [], keptDates: [] };
  const impPids = new Set(imp.tasks.map(t => t.plannerId));
  const today = todayDay();
  // Gate som är klar i Planner men saknar utfall i NexusOrdo → föreslå utfallsvecka (#55)
  const propose = (t, wasDone) => { if (isGateMs(t) && !t.actual && gateDone(t)) report.actualProposals.push({ id: t.id, name: t.name, day: proposeActual(t, today), planned: toDay(t.end || t.start), fresh: !wasDone }); };
  const pick = it => {
    if (!it.positional) {
      const ex = byPid.get(it.plannerId);
      if (ex && !used.has(ex)) return { ex };
      // Annat exportformat (t.ex. utan ID-kolumn) ger andra ID – unik träff på namn + fas räknas som samma aktivitet
      const c = olds.filter(o => !used.has(o) && !impPids.has(o.plannerId) && normName(o.name) === normName(it.name) && normName(o.bucket) === normName(it.bucket));
      return c.length === 1 ? { ex: c[0] } : {};
    }
    const free = olds.filter(o => !used.has(o));
    let c = free.filter(o => normName(o.name) === normName(it.name) && normName(o.bucket) === normName(it.bucket));
    if (c.length === 1) return { ex: c[0] };
    if (c.length > 1) {
      const same = c.find(o => o.plannerId === it.plannerId);
      return same ? { ex: same } : { why: tr('Flera aktiviteter heter ”{name}” i {bucket} – kontrollera att anteckningar och beroenden sitter rätt', { name: it.name, bucket: it.bucket }) };
    }
    c = free.filter(o => normName(o.name) === normName(it.name));
    if (c.length === 1) return { ex: c[0] };
    if (c.length > 1) return { why: tr('Flera aktiviteter heter ”{name}” – kontrollera att anteckningar och beroenden sitter rätt', { name: it.name }) };
    const sameNum = byPid.get(it.plannerId);
    if (sameNum && !used.has(sameNum) && hasData(sameNum)) return { why: tr('Nr {nr} hette tidigare ”{name}”; dess anteckningar och beroenden flyttades inte hit', { nr: it.plannerId, name: sameNum.name }) };
    return {};
  };
  const pidToId = new Map();
  let added = 0, updated = 0;
  const out = imp.tasks.map(it => {
    const imported = { start: it.start || null, end: it.end || null, name: it.name, progress: it.progress || 0, ...('effort' in it ? { effort: it.effort ? { ...it.effort } : null } : {}) };
    const { ex, why } = pick(it);
    if (!ex) {
      added++;
      const t = { ...it, deps: [], imp: imported };
      delete t.depInfo; // sätts nedan med översatta id
      if (why) { t.check = why; report.uncertain.push({ name: it.name, why }); }
      propose(t, false);
      pidToId.set(it.id, t.id);
      return t;
    }
    used.add(ex); updated++;
    const t = { ...it, id: ex.id, deps: [...(ex.deps || [])], notes: ex.notes || '', imp: imported };
    // Filen saknar datum men aktiviteten har datum (t.ex. gater när exportens datumkolumn inte känns igen): behåll dem
    if (!it.start && !it.end && (ex.start || ex.end)) { t.start = ex.start || ex.end; t.end = ex.end || ex.start; report.keptDates.push({ name: it.name, end: t.end }); }
    // Beroendetyper (#83): NexusOrdos egna behålls, filens skriver över nedan
    if (ex.depInfo) t.depInfo = Object.fromEntries(Object.entries(ex.depInfo).map(([k, v]) => [k, { ...v }])); else delete t.depInfo;
    if (ex.milestoneManual) Object.assign(t, { milestone: ex.milestone, milestoneManual: true });
    if (ex.check) t.check = ex.check; // ligger kvar tills någon markerat den som kontrollerad
    if ((ex.links || []).length) t.links = ex.links.map(l => ({ ...l })); // dokumentlänkar (#23) finns bara i NexusOrdo
    if (ex.actual) t.actual = { ...ex.actual }; // utfallsvecka (#55) finns bara i NexusOrdo
    // Checklista (#71): NexusOrdos bockar och egna punkter behålls. Utan checklistkolumn i filen rörs punkterna inte.
    let ck = null;
    if (Array.isArray(it.checks)) {
      ck = mergeChecks(ex.checks, it.checks);
      if (ck.checks.length) t.checks = ck.checks; else delete t.checks;
      if (ck.added.length || ck.removed.length || ck.kept.length) report.checks.push({ name: it.name, added: ck.added, removed: ck.removed, kept: ck.kept });
    } else if ((ex.checks || []).length) t.checks = ex.checks.map(c => ({ ...c }));
    if (!('plannerChecks' in it) && ex.plannerChecks) t.plannerChecks = { ...ex.plannerChecks };
    // Insats (#94): Planners värden skriver över; insats satt i NexusOrdo behålls tills Planners värde ändras. Utan arbetskolumner rörs den inte.
    let ef = null;
    if ('effort' in it) {
      ef = mergeEffort(ex.effort, ex.imp ? ex.imp.effort : undefined, it.effort);
      if (ef.effort) t.effort = ef.effort; else delete t.effort;
      if (ef.change) report.effort.push({ name: it.name, ...ef.change });
      if (ef.change && ef.change.kind === 'overwritten') report.overwritten.push({ name: it.name, was: `${tr('insats')} ${fmtEffort(ef.change.was)}`, now: fmtEffort(ef.change.now) });
    } else {
      if (ex.effort) t.effort = { ...ex.effort }; else delete t.effort;
      if (ex.imp && 'effort' in ex.imp) imported.effort = ex.imp.effort;
    }
    const edited = ex.imp ? (ex.start !== ex.imp.start || ex.end !== ex.imp.end) : !!ex.dateEdited;
    if (edited && (ex.start !== it.start || ex.end !== it.end))
      report.overwritten.push({ name: it.name, was: `${fmtShortY(ex.start)}–${fmtShortY(ex.end)}`, now: `${fmtShortY(it.start)}–${fmtShortY(it.end)}` });
    const prev = ex.imp || ex, dEnd = prev.end && it.end ? toDay(it.end) - toDay(prev.end) : 0;
    const days = dEnd || (prev.start && it.start ? toDay(it.start) - toDay(prev.start) : 0);
    if (days) { t.moved = { days, fromStart: prev.start, fromEnd: prev.end }; report.moved.push({ name: it.name, days }); }
    const what = [];
    if (normName(ex.name) !== normName(it.name)) what.push(tr('nytt namn (var ”{name}”)', { name: ex.name }));
    const wasPct = (ex.imp && ex.imp.progress != null ? ex.imp.progress : ex.progress) || 0;
    if (wasPct !== (it.progress || 0)) what.push(tr('klart {a} → {b} %', { a: wasPct, b: it.progress || 0 }));
    if ((ex.assignees || '') !== (it.assignees || '')) what.push(tr('ansvarig'));
    if ((ex.goalStatus || null) !== (it.goalStatus || null) && (ex.gate || it.gate)) what.push(tr('status {a} → {b}', { a: goalStatusTxt(ex.goalStatus), b: goalStatusTxt(it.goalStatus) }));
    if (ck && (ck.added.length || ck.removed.length)) what.push(tr('checklista +{a} −{r}', { a: ck.added.length, r: ck.removed.length }));
    if (ef && ef.change && (ef.change.kind === 'changed' || ef.change.kind === 'overwritten')) what.push(tr('insats {a} → {b}', { a: fmtEffort(ef.change.was), b: fmtEffort(ef.change.now) }));
    if (days) what.push(tr('datum {d} d', { d: (days > 0 ? '+' : '') + days }));
    else if (!(prev.end || prev.start) && (it.end || it.start)) what.push(tr('fått datum {date}', { date: fmtDayY(toDay(it.end || it.start)) + ' · ' + fmtYYWW(toDay(it.end || it.start)) }));
    if (what.length) report.changed.push({ id: t.id, name: it.name, what, status: (ex.goalStatus || null) !== (it.goalStatus || null) && (ex.gate || it.gate) ? it.goalStatus : undefined });
    propose(t, gateDone(ex));
    pidToId.set(it.id, t.id);
    return t;
  });
  // Beroenden från Planner pekar på numren i den nya filen – översätt till aktiviteternas bestående id.
  // Typ och fördröjning (#83) följer med; ändrad typ/fördröjning på ett befintligt beroende visas i förhandsvisningen.
  const outById = new Map(out.map(t => [t.id, t]));
  out.forEach((t, i) => {
    const it = imp.tasks[i], fromFile = [];
    for (const d of it.deps || []) {
      const id = pidToId.get(d);
      if (!id) continue;
      fromFile.push(id);
      const inf = (it.depInfo || {})[d];
      if (!inf) continue;
      const had = t.deps.includes(id), was = (t.depInfo || {})[id] || { type: 'FS', lag: 0 }, now = { type: inf.type || 'FS', lag: +inf.lag || 0 };
      if (had && ((was.type || 'FS') !== now.type || (+was.lag || 0) !== now.lag)) {
        const txt = tr('beroende ”{name}” {a} → {b}', { name: (outById.get(id) || {}).name || '', a: fmtDepType(was.type || 'FS', +was.lag || 0), b: fmtDepType(now.type, now.lag) });
        const ch = report.changed.find(c => c.id === t.id);
        if (ch) ch.what.push(txt); else report.changed.push({ id: t.id, name: t.name, what: [txt] });
      }
      t.depInfo = { ...(t.depInfo || {}), [id]: { ...now, src: 'planner' } };
    }
    t.deps = [...new Set([...t.deps, ...fromFile])];
  });
  const gone = olds.filter(o => !used.has(o));
  gone.filter(hasData).forEach(o => report.lost.push({ name: o.name }));
  out.push(...p.tasks.filter(t => !t.plannerId));
  const ids = new Set(out.map(t => t.id));
  out.forEach(t => {
    t.deps = (t.deps || []).filter(d => ids.has(d) && d !== t.id);
    if (t.depInfo) { const keep = t.deps.filter(d => t.depInfo[d]); if (keep.length) t.depInfo = Object.fromEntries(keep.map(d => [d, t.depInfo[d]])); else delete t.depInfo; }
  });
  return { tasks: out, added, updated, removed: gone.length, report };
}
const fmtShortY = iso => iso ? fmtDayY(toDay(iso)) : '–';

// Sammanfattning före uppdatering när något behöver ses över (#28)
async function confirmMerge(res) {
  const r = res.report, li = (arr, f) => arr.slice(0, 8).map(f).join('') + (arr.length > 8 ? `<li>${tr('… och {n} till', { n: arr.length - 8 })}</li>` : '');
  if (!r.uncertain.length && !r.overwritten.length && !r.lost.length) return true;
  return dialog({
    title: tr('Kontrollera uppdateringen'), wide: true,
    body: `${tr('<b>{u}</b> uppdaterade, <b>{a}</b> nya, <b>{r}</b> borttagna, <b>{m}</b> med flyttade datum.', { u: res.updated, a: res.added, r: res.removed, m: r.moved.length })}
      ${r.overwritten.length ? `<p><b>${tr('Ändrat i NexusOrdo – skrivs över av Planner')} (${r.overwritten.length})</b></p><ul>${li(r.overwritten, o => `<li>${esc(o.name)}: ${o.was} → ${o.now}</li>`)}</ul>` : ''}
      ${r.uncertain.length ? `<p><b>${tr('Behöver kontrolleras')} (${r.uncertain.length})</b> – ${tr('markeras i planen')}</p><ul>${li(r.uncertain, o => `<li>${esc(o.why)}</li>`)}</ul>` : ''}
      ${r.lost.length ? `<p><b>${tr('Borttagna i Planner, med anteckningar eller beroenden här')} (${r.lost.length})</b></p><ul>${li(r.lost, o => `<li>${esc(o.name)}</li>`)}</ul>` : ''}`,
    buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Uppdatera'), value: true }],
  });
}

/* ---------- Uppdatera den öppna planen från Excel (#35) ----------
   Jämför alltid mot den öppna planen och skapar aldrig en ny plan. Förhandsvisning innan något sparas. */
function applyMerge(res, imp, reason = 'update') {
  saveVersion('plan', plan, reason); // versionshistorik (#76): kopian tas före ändringen och finns kvar efter omladdning
  pushUndo();
  ensureSnapshots(plan); // milstolpetrend (#41): historiken före uppdateringen
  plan.tasks = res.tasks; plan.imported_at = new Date().toISOString();
  for (const a of res.acceptActual || []) { const t = plan.tasks.find(x => x.id === a.id); if (t && !t.actual) t.actual = mkActual(a.day, 'planner'); }
  if (imp.planId) plan.settings.plannerPlanId = imp.planId;
  if (imp.people.length) plan.settings.people = imp.people;
  if (imp.phases.length) plan.settings.phaseCodes = { ...plan.settings.phaseCodes, ...imp.phaseCodes };
  if (imp.phases.length) plan.settings.bucketOrder = [...imp.phases, ...(plan.settings.bucketOrder || []).filter(b => !imp.phases.includes(b))];
  recordSnapshot(plan, 'update');
  recordBurn(plan); // burndown (#95): värdet efter uppdateringen
  scheduleSave(); render();
}

// Skydd mot fel exportformat (2026-10-29: svensk Premium-export gav endagsaktiviteter och tappade beroenden och gater)
function mergeWarnings(oldTasks, res, imp) {
  const w = [], cols = imp.cols, olds = oldTasks.filter(t => t.plannerId);
  if (cols && !cols.includes('start')) w.push(tr('Filen saknar kolumn för startdatum – aktiviteterna får samma start som slut.'));
  if (cols && !cols.includes('end') && !cols.includes('finish')) w.push(tr('Filen saknar kolumn för slutdatum.'));
  const kept = (res.report && res.report.keptDates) || [], keptGates = kept.filter(k => /^gate\b/i.test(k.name) || PMI_GATE_RE.test(k.name));
  if (keptGates.length) w.push(tr('{n} gater saknar datum i filen – deras befintliga datum behålls. Kontrollera att målen har datum i Planner.', { n: keptGates.length }));
  const byId = new Map(olds.map(t => [t.id, t]));
  let had = 0, shortened = 0;
  for (const t of res.tasks) {
    const o = byId.get(t.id) || null;
    if (!o || !o.start || !o.end || o.start >= o.end) continue;
    had++; if (t.start && t.start === t.end) shortened++;
  }
  if (shortened >= 5 && shortened >= had / 2) w.push(tr('{n} av {m} aktiviteter blir endagsaktiviteter (start = slut).', { n: shortened, m: had }));
  if (olds.length >= 10 && res.removed >= olds.length / 2) w.push(tr('{n} av {m} aktiviteter känns inte igen och tas bort (anteckningar, dokument och utfall på dem försvinner).', { n: res.removed, m: olds.length }));
  const deps = ts => ts.reduce((n, t) => n + (t.deps || []).length, 0), before = deps(oldTasks), after = deps(res.tasks);
  if (before >= 5 && after < before / 2) w.push(tr('Beroenden: {a} före, {b} efter.', { a: before, b: after }));
  const gates = olds.filter(t => t.gate).length;
  if (gates && !res.tasks.some(t => t.gate)) w.push(tr('Gaterna från Planner ({n}) försvinner.', { n: gates }));
  return w;
}

// Förhandsvisningen (#94): insats som läses in för första gången (antal), ändrad i Planner, skriven över och behållen
function effortPreviewHTML(list) {
  if (!list.length) return '';
  const by = k => list.filter(x => x.kind === k), fresh = by('new'), ch = [...by('changed'), ...by('overwritten')], kept = by('kept');
  const li = arr => arr.slice(0, 8).map(x => `<li>${esc(x.name)}: ${esc(fmtEffort(x.was))} → <b>${esc(fmtEffort(x.now))}</b>${x.kind === 'overwritten' ? ` <span class="ck-rm">${tr('(ändrad i NexusOrdo – skrivs över)')}</span>` : ''}</li>`).join('')
    + (arr.length > 8 ? `<li>${tr('… och {n} till', { n: arr.length - 8 })}</li>` : '');
  const dflt = fresh.filter(x => x.now && x.now.dflt).length;
  return `<p><b>${tr('Insats (timmar)')}</b></p><ul class="upd-list">
    ${fresh.length ? `<li>${tr('Insats läses in för {n} aktiviteter', { n: fresh.length })}${dflt ? ` – ${tr('{n} med Planners standardinsats (varaktighet × 8 h per person)', { n: dflt })}` : ''}</li>` : ''}
    ${li(ch)}
    ${kept.length ? `<li>${tr('{n} aktiviteter behåller insatsen från NexusOrdo (Planners värde är oförändrat)', { n: kept.length })}</li>` : ''}</ul>`;
}

const mergeWarnHTML = risks => `<b>${tr('Filen ser inte ut som planens tidigare export. Kontrollera innan du uppdaterar:')}</b><ul>${risks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;

function previewMerge(res, imp, warn, risky, impact = [], gImpact = []) {
  const r = res.report, more = (arr, n = 8) => arr.length > n ? `<li>${tr('… och {n} till', { n: arr.length - n })}</li>` : '';
  const list = (title, arr, f) => arr.length ? `<p><b>${title} (${arr.length})</b></p><ul class="upd-list">${arr.slice(0, 8).map(f).join('')}${more(arr)}</ul>` : '';
  const newOnes = res.tasks.filter(t => t.plannerId && !plan.tasks.some(o => o.id === t.id));
  const gone = plan.tasks.filter(o => o.plannerId && !res.tasks.some(t => t.id === o.id));
  const nothing = !r.changed.length && !newOnes.length && !gone.length && !r.uncertain.length && !r.actualProposals.length && !(r.checks || []).length && !(r.effort || []).length;
  // Checklistor (#71): nya och borttagna punkter, samt punkter som tagits bort i Planner men behålls (bockade eller ändrade här)
  const ckLine = c => [...c.added.map(x => `<span class="ck-add">+ ${esc(x)}</span>`), ...c.removed.map(x => `<span class="ck-rm">− ${esc(x)}</span>`),
    ...c.kept.map(x => `<span class="ck-kept">${tr('behålls: {text}', { text: esc(x) })}</span>`)].join(' · ');
  const props = r.actualProposals;
  // Utfall föreslås (#55): en rad per gate med redigerbar vecka och kryssruta; läses när användaren uppdaterar
  const propHTML = props.length ? `<p><b>${tr('Utfall föreslås')} (${props.length})</b> – ${tr('gater som är klara i Planner men saknar utfallsvecka i NexusOrdo')}</p>
    <table class="upd-act"><tr><th></th><th>${tr('Gate')}</th><th>${tr('Planerad')}</th><th>${tr('Utfall (ÅÅVV)')}</th></tr>
    ${props.map((a, i) => `<tr><td><input type="checkbox" class="ua-on" data-i="${i}" ${a.fresh ? 'checked' : ''} aria-label="${tr('Sätt utfall för {name}', { name: esc(a.name) })}"></td><td>${esc(a.name)}</td>
      <td>${a.planned != null ? esc(fmtYYWW(a.planned)) : '–'}</td><td><input type="text" class="ua-wk" data-i="${i}" value="${esc(fmtYYWW(a.day))}" inputmode="numeric" maxlength="6" size="6"></td></tr>`).join('')}</table>
    <p class="ua-err" id="uaErr"></p>` : '';
  const done = dialog({
    title: tr('Uppdatera ”{name}”', { name: esc(plan.name) }), wide: true,
    body: `${warn ? `<div class="upd-warn">${warn}</div>` : ''}
      ${impactHTML(impact)}
      ${gateImpactHTML(gImpact)}
      <div class="upd-sum"><div><b>${r.changed.length}</b><span>${tr('ändrade')}</span></div><div><b>${newOnes.length}</b><span>${tr('nya')}</span></div><div><b>${gone.length}</b><span>${tr('borttagna i Planner')}</span></div>
        <div><b>${r.moved.length}</b><span>${tr('med flyttade datum')}</span></div><div><b>${r.uncertain.length}</b><span>${tr('att kontrollera')}</span></div><div><b>${r.overwritten.length}</b><span>${tr('ändringar här skrivs över')}</span></div></div>
      ${nothing ? `<p>${tr('Inget har ändrats i Planner sedan förra uppdateringen.')}</p>` : ''}
      ${list(tr('Ändrade'), r.changed, c => `<li>${esc(c.name)} – ${esc(c.what.join(', '))}</li>`)}
      ${list(tr('Nya'), newOnes, t => `<li>${esc(t.name)}</li>`)}
      ${list(tr('Ändrade checklistor'), r.checks || [], c => `<li>${esc(c.name)}: ${ckLine(c)}</li>`)}
      ${effortPreviewHTML(r.effort || [])}
      ${(r.checks || []).some(c => c.kept.length) ? `<p style="font-size:12px;color:var(--text-muted)">${tr('”Behålls” = punkten finns inte längre i Planner men är bockad eller ändrad i NexusOrdo. Ta bort den i panelen om den inte behövs.')}</p>` : ''}
      ${list(tr('Borttagna i Planner'), gone, t => `<li>${esc(t.name)}${t.notes || (t.deps || []).length ? ` – <b>${tr('har anteckningar eller beroenden här')}</b>` : ''}</li>`)}
      ${list(tr('Ändrat i NexusOrdo – skrivs över av Planner'), r.overwritten, o => `<li>${esc(o.name)}: ${o.was} → ${o.now}</li>`)}
      ${list(tr('Behöver kontrolleras – markeras i planen'), r.uncertain, o => `<li>${esc(o.why)}</li>`)}
      ${list(tr('Saknar datum i filen – befintliga datum behålls'), r.keptDates || [], o => `<li>${esc(o.name)} – ${esc(fmtShortY(o.end))}</li>`)}
      ${propHTML}
      <p style="font-size:12px;color:var(--text-muted)">${tr('Beroenden, anteckningar och bockar i checklistan som lagts till i NexusOrdo behålls. Ångra går att använda efteråt.')}</p>`,
    buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: nothing || risky ? tr('Uppdatera ändå') : tr('Uppdatera planen'), value: true, keep: true }],
    onButton: (v, close) => {
      const acc = [];
      for (const cb of $$('#modal .ua-on')) {
        if (!cb.checked) continue;
        const a = props[+cb.dataset.i], inp = $(`#modal .ua-wk[data-i="${cb.dataset.i}"]`), d = actualDayFromWeek(inp.value, a.day);
        if (d == null) { $('#uaErr').textContent = tr('Ange veckan som ÅÅVV, t.ex. {w}', { w: fmtYYWW(a.day) }); inp.focus(); return; }
        acc.push({ id: a.id, day: d });
      }
      res.acceptActual = acc;
      close(v);
    },
  });
  $$('#modal .ua-wk').forEach(i => i.addEventListener('input', () => { $('#uaErr').textContent = ''; }));
  return done;
}

async function updateFromFile(file) {
  if (!file || !plan || plan.synthetic) return;
  toast(tr('Läser in {file}…', { file: file.name }));
  let imp;
  try { imp = await parseWorkbook(file); }
  catch (e) { return dialog({ title: tr('Kunde inte läsa filen'), body: esc(e.message), buttons: [{ label: tr('OK'), value: true }] }); }
  if (imp.template) return dialog({ title: tr('Det här är en NexusOrdo-mall'), body: tr('Filen är en mall, inte en plan. Använd ⋯ → Ny plan från mall… → Importera mall från fil.'), buttons: [{ label: tr('OK'), value: true }] });
  if (imp.timeplan) return dialog({ title: tr('Det här är en NexusOrdo-export'), body: tr('Filen innehåller hela planer från NexusOrdo. Använd <b>+ Ny plan / Importera…</b> i planväljaren för att skapa dem – Uppdatera jämför bara med exporter från Planner.'), buttons: [{ label: tr('OK'), value: true }] });
  // Gäller filen den öppna planen?
  const baseName = n => lc(n).replace(/\s*\(\d+\)\s*$/, '');
  let warn = '';
  if (plan.settings.plannerPlanId && imp.planId && plan.settings.plannerPlanId !== imp.planId)
    warn = tr('<b>Filen verkar gälla en annan plan</b> (”{name}”, annat plan-ID i Planner). Kontrollera att du valt rätt fil.', { name: esc(imp.planName) });
  else if (!imp.planId && baseName(imp.planName) !== baseName(plan.name) && !file.name.toLowerCase().includes(baseName(plan.name).slice(0, 8)))
    warn = tr('Filens plannamn (”{name}”) skiljer sig från planens. Kontrollera att du valt rätt fil.', { name: esc(imp.planName) });
  const res = mergeImport(plan, imp);
  const risks = mergeWarnings(plan.tasks, res, imp);
  const impact = planDepImpact(plan, res.tasks); // beroenden till andra projekt (#22)
  const gImpact = planGateImpact(plan, res.tasks); // gater som glider förbi programgaten (#99)
  if (risks.length) warn = mergeWarnHTML(risks) + (warn ? `<p>${warn}</p>` : '');
  if (!(await previewMerge(res, imp, warn, risks.length > 0, impact, gImpact))) return toast(tr('Ingen ändring gjord'));
  const pl = plan;
  applyMerge(res, imp);
  saveDepAlerts(impact, pl); saveDepAlerts(gImpact, pl, 'gateAlerts');
  toast(tr('Uppdaterad: {c} ändrade, {a} nya, {m} flyttade', { c: res.report.changed.length, a: res.added, m: res.report.moved.length }) + (res.removed ? tr(', {n} borttagna', { n: res.removed }) : '') + (res.report.uncertain.length ? tr(', {n} att kontrollera', { n: res.report.uncertain.length }) : ''));
}

async function handleFile(file) {
  if (!file) return;
  if (plan && plan.synthetic) plan = plans.find(p => p.id === ui.planId) || null;
  toast(tr('Läser in {file}…', { file: file.name }));
  let imp;
  try { imp = await parseWorkbook(file); }
  catch (e) { return dialog({ title: tr('Kunde inte läsa filen'), body: esc(e.message), buttons: [{ label: tr('OK'), value: true }] }); }
  if (imp.timeplan || imp.template) await warnNewerFile(imp.build);
  if (imp.timeplan) return importTimePlan(imp.timeplan);
  if (imp.template) { const row = await importTemplate(imp.template, true); if (row) openTemplateDialog('new', null, { src: row.id }); return; }
  const unsched = imp.tasks.filter(t => !t.start).length;
  const ms = imp.tasks.filter(t => t.milestone && !t.gate).length, gates = imp.tasks.filter(t => t.gate).length;
  const summary = tr('<b>{n}</b> aktiviteter i <b>{p}</b> faser', { n: imp.tasks.length - gates, p: new Set(imp.tasks.map(t => t.bucket)).size }) + (ms ? tr(', <b>{n}</b> milstolpar', { n: ms }) : '') + (gates ? tr(', <b>{n}</b> gater från Goals', { n: gates }) : '') + '.' + (unsched ? '<br>' + tr('{n} saknar datum och visas under ”Ej schemalagda”.', { n: unsched }) : '');
  // Samma plan importerad igen (samma Planner-plan-ID eller samma namn, utan "(2)" från filnamnet) ska uppdateras, inte dupliceras
  const baseName = n => lc(n).replace(/\s*\(\d+\)\s*$/, '');
  imp.planName = imp.planName.replace(/\s*\(\d+\)\s*$/, '');
  const sameAs = p => (imp.planId && p.settings.plannerPlanId === imp.planId) || baseName(p.name) === baseName(imp.planName);
  const match = plans.find(sameAs), hidden = !match && allPlans.some(sameAs), trashed = !match && !hidden && trashPlans.find(sameAs);
  const keepNote = `<br><span style="font-size:12px;color:var(--text-muted)">${tr('Vid uppdatering behålls beroenden och anteckningar som lagts till här.')}</span>`;
  // #76: en ny kopia tappar allt som bara finns i NexusOrdo – Uppdatera är alltid förstahandsvalet
  const copyWarn = `<div class="upd-warn" style="margin-top:10px">${tr('<b>En ny kopia får inget av det som finns i NexusOrdo:</b> risker, veckostatus, gate-checklistans svar, programmets koppling, beroenden och anteckningar som lagts till här. Ta inte bort planen för att importera på nytt.')}</div>`;
  let choice = 'new';
  if (match) {
    choice = await dialog({
      title: tr('Planen finns redan'),
      body: `${summary}<br><br>${tr('Det finns redan en plan för <b>{name}</b>. Uppdatera den med den nya exporten?', { name: esc(match.name) })}${keepNote}${copyWarn}`,
      buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Skapa en kopia ändå'), value: 'new', ghost: true }, { label: tr('Uppdatera planen'), value: 'update' }],
    });
    if (!choice) return;
    if (choice === 'update' && plan !== match) selectPlan(match.id);
  } else if (hidden) {
    choice = await dialog({
      title: tr('Planen finns redan'),
      body: `${summary}<br><br>${tr('Det finns redan en plan för <b>{name}</b>, men den är inte delad med dig. Be den som äger planen om länken, så kan du uppdatera den i stället för att skapa en kopia.', { name: esc(imp.planName) })}${copyWarn}`,
      buttons: [{ label: tr('Skapa ny plan ändå'), value: 'new', ghost: true }, { label: tr('Avbryt'), value: null }],
    });
    if (!choice) return;
  } else if (trashed) {
    const can = canRestoreTrash(trashed);
    choice = await dialog({
      title: tr('Planen ligger i papperskorgen'),
      body: `${summary}<br><br>${tr('<b>{name}</b> togs bort {d} och ligger i papperskorgen.', { name: esc(trashed.name), d: esc(fmtWhen(trashed.settings.deleted_at)) })}
        ${can ? tr('Återställ den och uppdatera med den nya exporten – då finns allt från NexusOrdo kvar.') : tr('Den kan inte längre återställas från papperskorgen.')}${copyWarn}`,
      buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Skapa ny plan ändå'), value: 'new', ghost: true }, ...(can ? [{ label: tr('Återställ och uppdatera'), value: 'restore' }] : [])],
    });
    if (!choice) return;
    if (choice === 'restore') { if (!(await restoreTrash('plan', trashed))) return; choice = 'update'; }
  } else if (plan) {
    choice = await dialog({
      title: tr('Importera ”{name}”', { name: esc(imp.planName) }),
      body: `${summary}<br><br>${tr('Ingen befintlig plan har samma namn. Skapa en ny plan, eller uppdatera den öppna planen <b>{name}</b>?', { name: esc(plan.name) })}${keepNote}`,
      buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Uppdatera öppna planen'), value: 'update', ghost: true }, { label: tr('Skapa ny plan'), value: 'new' }],
    });
    if (!choice) return;
  }
  const now = new Date().toISOString();
  if (choice === 'update') {
    const res = mergeImport(plan, imp);
    const risks = mergeWarnings(plan.tasks, res, imp);
    const warn = risks.length ? mergeWarnHTML(risks) : '';
    const impact = planDepImpact(plan, res.tasks); // beroenden till andra projekt (#22)
    const gImpact = planGateImpact(plan, res.tasks); // gater som glider förbi programgaten (#99)
    // utfall föreslås (#55), varningar för fel exportformat och påverkan på andra projekt visas bara i förhandsvisningen
    if (!(await (res.report.actualProposals.length || risks.length || res.report.checks.length || impact.length || gImpact.length ? previewMerge(res, imp, warn, risks.length > 0, impact, gImpact) : confirmMerge(res)))) return;
    const pl = plan;
    applyMerge(res, imp, 'import');
    saveDepAlerts(impact, pl); saveDepAlerts(gImpact, pl, 'gateAlerts');
    toast(tr('Uppdaterad: {a} nya, {u} uppdaterade, {m} flyttade', { a: res.added, u: res.updated, m: res.report.moved.length }) + (res.removed ? tr(', {n} borttagna', { n: res.removed }) : '') + (res.report.uncertain.length ? tr(', {n} att kontrollera', { n: res.report.uncertain.length }) : ''));
  } else {
    imp.tasks.forEach(t => t.imp = { start: t.start || null, end: t.end || null, name: t.name, progress: t.progress || 0 });
    await createPlan(imp.planName, imp.tasks, now, { ...(imp.phases.length ? { bucketOrder: imp.phases, phaseCodes: imp.phaseCodes } : {}), ...(imp.planId ? { plannerPlanId: imp.planId } : {}), ...(imp.people.length ? { people: imp.people } : {}) });
    toast(tr('Plan skapad med {n} aktiviteter', { n: imp.tasks.length - gates }) + (gates ? tr(' och {n} gater', { n: gates }) : ''));
  }
}

/* =========================================================
   Plans
   ========================================================= */
async function createPlan(name, tasks = [], imported_at = null, settings = {}) {
  const p = { name, tasks, settings: { ...settings }, imported_at };
  recordSnapshot(p, 'import'); // milstolpetrend (#41)
  recordBurn(p); // burndown (#95): startvärdet
  try {
    const row = await Store.insert(planRow(p));
    const np = rowToPlan(row);
    np.tasks = tasks; np.settings = p.settings; // säkerställ lokalt
    rememberBase('plan', [np]); // dagens första kopia (#76) visar läget som skapades
    plans.push(np); allPlans.push(np); markDirty(np);
    selectPlan(np.id, true);
    return np;
  } catch (e) { toast(tr('Kunde inte skapa plan: ') + e.message); return null; }
}

function selectPlan(id, fresh = false) {
  ui.mode = 'plan';
  plan = plans.find(p => p.id === id) || null;
  ui.planId = plan ? plan.id : null; saveUi();
  undoStack = []; $('#undoBtn').disabled = true;
  setSaveState(FILE_MODE && plan && fileDirty.has(plan.id) ? tr('● Ej sparad till fil') : '');
  closeDrawer();
  render(fresh);
}

function renderPlanSelect() {
  const inProg = ui.mode === 'program' && program;
  const opts = plans.map(p => `<option value="${esc(p.id)}" ${!inProg && plan && p.id === plan.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const progs = programs.length ? `<optgroup label="${tr('Program')}">${programs.map(pr => `<option value="prog:${esc(pr.id)}" ${inProg && pr.id === program.id ? 'selected' : ''}>▣ ${esc(pr.name)}</option>`).join('')}</optgroup>` : '';
  $('#planSelect').innerHTML = ((plans.length || programs.length) ? (plans.length ? `<optgroup label="${tr('Planer')}">${opts}</optgroup>` : '') + progs : `<option>${tr('Ingen plan')}</option>`)
    + `<option value="${NEW_OPT}">${tr('+ Ny plan / Importera…')}</option>`;
}
// + Ny plan / Importera… (#101): sista raden i planväljaren. En <select> kan inte öppna filväljaren, så raden öppnar en dialog
// där importen är en <label for="fileInput"> (fungerar i sandlådan) och de andra sätten att skapa en plan är knappar – samma som ⋯ → Ny
const NEW_OPT = 'new:';
function openNewPlan() {
  closeMenus();
  const b = (act, txt) => `<button class="btn ghost np-btn" data-np="${act}">${tr(txt)}</button>`;
  dialog({ title: tr('Ny plan'),
    body: `<p>${tr('Läs in en Excel-export från Planner, MS Project eller NexusOrdo – eller börja från en tom plan, en mall eller exemplet.')}</p>
      <div class="np-acts"><label class="btn" for="fileInput" id="npImport" tabindex="0">${tr('⇪ Importera från Excel…')}</label>
      ${b('new', 'Ny tom plan')}${b('tplnew', 'Ny plan från mall…')}${b('sample', 'Skapa exempelplan')}</div>`,
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }],
    onBody: (e, close) => {
      if (e.target.closest('#npImport')) return setTimeout(() => close(null)); // filväljaren öppnas av etiketten, sedan stängs dialogen
      const n = e.target.closest('[data-np]'); if (n) { close(null); planAction(n.dataset.np); }
    } });
  const imp = $('#npImport');
  if (imp) { imp.focus(); imp.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imp.click(); } }; }
}

async function planAction(act) {
  closeMenus();
  if (act === 'newprog') return createProgram();
  if (act === 'pgates') return openProgramGates();
  if (ui.mode === 'program' && program && ['rename', 'delete'].includes(act)) return programAction(act);
  if (act === 'new') {
    const name = await dialog({ title: tr('Ny plan'), body: tr('Namn på planen:'), input: tr('Ny tidplan'), buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Skapa'), value: true }] });
    if (name) createPlan(name);
  } else if (act === 'sample') {
    createPlan(sampleName(), samplePlan(), null, sampleSettings());
  } else if (act === 'rename' && plan) {
    const name = await dialog({ title: tr('Byt namn'), body: tr('Nytt namn:'), input: plan.name, buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara'), value: true }] });
    if (name) { plan.name = name; scheduleSave(); render(); }
  } else if (act === 'tplnew') {
    openTemplateDialog('new');
  } else if (act === 'tpladd') {
    openTemplateDialog('add');
  } else if (act === 'tplsave') {
    openSaveTemplate();
  } else if (act === 'project') {
    openProjectInfo();
  } else if (act === 'colors') {
    openColors();
  } else if (act === 'capacity') {
    openCapacity();
  } else if (act === 'risks') {
    openRisks();
  } else if (act === 'status') {
    openStatus();
  } else if (act === 'trend') {
    openTrend();
  } else if (act === 'burndown') {
    openBurndown();
  } else if (act === 'export') {
    openPlanExport();
  } else if (act === 'fileopen') {
    openFromFile();
  } else if (act === 'filesave' || act === 'filesaveas') {
    saveToFile(act === 'filesaveas');
  } else if (act === 'checklist') {
    openChecklist();
  } else if (act === 'gates') {
    openGates();
  } else if (act === 'delete' && plan) {
    const ok = await dialog({ title: tr('Ta bort plan?'), body: tr('Planen <b>{name}</b> flyttas till papperskorgen. Du kan återställa den i {n} dagar (⋯ → 🗑 Papperskorg…). Uppgifterna i Planner påverkas inte.', { name: esc(plan.name), n: TRASH_DAYS }), buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Ta bort'), value: true, danger: true }] });
    if (!ok) return;
    const name = plan.name;
    if (!(await trashItem('plan', plan))) return;
    selectPlan(plans[0] ? plans[0].id : null, true);
    toast(tr('”{name}” ligger i papperskorgen', { name }));
  } else if (act === 'baselines') {
    openBaselines();
  } else if (act === 'versions') {
    openVersions();
  } else if (act === 'trash') {
    openTrash();
  }
}

const lc = s => String(s || '').trim().toLowerCase();

/* =========================================================
   Program (#16)
   Ett program refererar till befintliga planer och ändrar dem aldrig.
   Beroenden mellan projekt, programgater och begäranden sparas i programmet och pekar på planens id och
   aktiviteternas Planner-ID, så att de överlever ny import (#19–#22).
   ========================================================= */
function rowToProgram(r) {
  const parse = v => typeof v === 'string' ? JSON.parse(v) : v;
  return { id: r.id, name: r.name || 'Namnlöst program', plans: parse(r.plans) || [], dependencies: parse(r.dependencies) || [],
    milestones: parse(r.milestones) || [], requests: parse(r.requests) || [], settings: parse(r.settings) || {} };
}
const programRow = p => ({ name: p.name, plans: p.plans, dependencies: p.dependencies, milestones: p.milestones, requests: p.requests, settings: p.settings });

async function loadPrograms() {
  ProgStore = makeStore('programs');
  try { ({ live: allPrograms, trash: trashPrograms } = splitTrash((await ProgStore.list()).map(rowToProgram))); rememberBase('program', allPrograms); }
  catch (e) { console.warn('[NexusOrdo] program', e.message); allPrograms = []; }
  programs = [...allPrograms];
}

let progSaveTimer;
function saveProgram() {
  if (!program) return;
  const p = program;
  markDirty(p); // lokala versionen (#102): programmet sparas till fil som en plan
  setSaveState(tr('Sparar…'));
  clearTimeout(progSaveTimer);
  progSaveTimer = setTimeout(async () => {
    dailyVersion('program', p);
    try { await ProgStore.update(p.id, programRow(p)); setSaveState(FILE_MODE ? tr('● Ej sparad till fil') : tr({ local: 'Sparat lokalt ✓', memory: 'Sparas inte' }[ProgStore.mode])); }
    catch (e) { setSaveState(''); toast(tr('Kunde inte spara programmet: ') + e.message); }
  }, 400);
}

function selectProgram(id) {
  program = programs.find(p => p.id === id) || null;
  if (!program) return;
  ui.mode = 'program'; ui.programId = program.id; saveUi();
  closeDrawer(); setSaveState(FILE_MODE && fileDirty.has(program.id) ? tr('● Ej sparad till fil') : '');
  render(true);
  offerPageTourSoon();
}

async function createProgram() {
  const name = await dialog({ title: tr('Nytt program'), body: tr('Namn på programmet, t.ex. Nytt kontor:'), input: '', buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Skapa'), value: true }] });
  if (!name) return;
  if (!ProgStore) await loadPrograms();
  const p = { name, plans: [], dependencies: [], milestones: [], requests: [], settings: {} };
  try {
    const np = rowToProgram(await ProgStore.insert(programRow(p)));
    np.settings = p.settings;
    rememberBase('program', [np]);
    allPrograms.push(np); programs.push(np); markDirty(np);
    selectProgram(np.id);
  } catch (e) { toast(tr('Kunde inte skapa programmet: ') + e.message); }
}

async function programAction(act) {
  const p = program;
  if (act === 'rename') {
    const name = await dialog({ title: tr('Byt namn på programmet'), body: tr('Nytt namn:'), input: p.name, buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara'), value: true }] });
    if (name) { p.name = name; saveProgram(); render(); }
  } else if (act === 'delete') {
    const ok = await dialog({ title: tr('Ta bort programmet?'), body: tr('Programmet <b>{name}</b> flyttas till papperskorgen. Du kan återställa det i {n} dagar (⋯ → 🗑 Papperskorg…). Projektens planer påverkas inte.', { name: esc(p.name), n: TRASH_DAYS }), buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Ta bort'), value: true, danger: true }] });
    if (!ok) return;
    if (!(await trashItem('program', p))) return;
    program = null; selectPlan(plan ? plan.id : (plans[0] || {}).id, true);
    toast(tr('”{name}” ligger i papperskorgen', { name: p.name }));
  }
}

// ＋ Lägg till plan (#105): välj bland planerna i arbetskopian
const addPlanToProgram = () => pickPlansForProgram();
async function pickPlansForProgram() {
  const cand = plans.filter(p => !p.synthetic && !program.plans.some(x => x.planId === p.id)).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  if (!cand.length) return toast(tr('Alla planer i arbetskopian finns redan i programmet. Öppna eller skapa fler planer först.'));
  const ids = await dialog({ title: tr('Lägg till plan i programmet'),
    body: `<p>${tr('Välj planerna som ska ingå. Programmet läser planerna men ändrar dem aldrig.')}</p>
      ${cand.length > 8 ? `<input type="search" class="pick-q" id="pickQ" placeholder="${tr('Sök plan…')}" aria-label="${tr('Sök plan…')}">` : ''}
      <div class="pick-list">${cand.map(p => `<label class="chk" data-n="${esc(lc(p.name))}"><input type="checkbox" value="${esc(p.id)}"> ${esc(p.name)}</label>`).join('')}</div>`,
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Lägg till'), value: 'ok', keep: true }],
    onButton: (v, close) => {
      const ids = $$('#modal .pick-list input:checked').map(i => i.value);
      close(ids.length ? ids : null);
    } });
  if (!ids) return;
  const now = new Date().toISOString();
  ids.forEach(id => program.plans.push({ planId: id, addedAt: now }));
  saveProgram(); render();
  const names = ids.map(id => (allPlans.find(p => p.id === id) || {}).name).filter(Boolean);
  toast(names.length === 1 ? tr('”{name}” är tillagd i {prog}', { name: names[0], prog: program.name }) : tr('{n} planer tillagda i {prog}', { n: names.length, prog: program.name }));
}
// Sökfältet i listan
document.addEventListener('input', e => {
  if (e.target.id !== 'pickQ') return;
  const q = lc(e.target.value.trim());
  $$('#modal .pick-list label').forEach(l => { l.hidden = !!q && !l.dataset.n.includes(q); });
});

async function removePlanFromProgram(planId) {
  const p = allPlans.find(x => x.id === planId);
  const ok = await dialog({ title: tr('Ta bort ur programmet?'), body: tr('<b>{name}</b> tas bort ur programmet. Själva planen påverkas inte.', { name: esc(p ? p.name : tr('Planen')) }), buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Ta bort'), value: true, danger: true }] });
  if (!ok) return;
  program.plans = program.plans.filter(x => x.planId !== planId);
  saveProgram(); render();
}

// Projektets faser enligt PMI: varje fas pågår fram till gaten som avslutar den (Initiating → G1, Planning → G2 …).
// Ger null om planen saknar PMI-gater; då visas faserna utifrån aktiviteterna i stället.
function gateSegments(gates, ps, pe) {
  const at = {};
  gates.forEach(t => { const m = PMI_PHASES.find(ph => ph.gates.includes(String(t.goals || t.name.replace(/^Gate\s+/i, '')).toUpperCase())); if (m) at[m.order] = toDay(t.end); });
  const orders = Object.keys(at).map(Number).sort((a, b) => a - b);
  if (!orders.length || ps == null) return null;
  const byOrder = o => PMI_PHASES.find(ph => ph.order === o);
  const label = o => ({ 0: 'Investigation', 1: 'Feasibility', 2: 'Development', 3: 'Final Development', 4: 'Industrialisation', 5: 'Trimming-in', 6: 'Follow-up' })[o];
  const out = []; let from = ps;
  for (const o of orders) {
    if (at[o] >= from) out.push({ order: o, col: byOrder(o).col, label: `${label(o)} (${tr('till')} ${byOrder(o).gates[0]})`, s: from, e: at[o] });
    from = Math.max(from, at[o] + 1);
  }
  const next = byOrder(orders[orders.length - 1] + 1);
  if (next && pe > from) out.push({ order: next.order, col: next.col, label: label(next.order), s: from, e: pe });
  return out;
}

/* ---------- Beroenden mellan projekt (#19) ----------
   Beroenden sparas i programmet och pekar på aktivitetens bestående id i planen (överlever ny import, #28),
   med Planner-ID, namn och fas som reserv. Bara visning och varning – ingen schemaläggning, inget skrivs till Planner. */
const DEP_TYPES = { FS: 'Slut → start', SS: 'Start → start', FF: 'Slut → slut', SF: 'Start → slut' };
const DEP_ORDER = { blockerad: 0, risk: 1, saknas: 2, ok: 3, klar: 4 };
const depColor = st => ({ klar: PAL.muted, ok: PAL.good || '#1a9e5a', risk: '#d97706', blockerad: PAL.critical, saknas: PAL.muted })[st];
const DEP_TXT = { klar: 'Klar', ok: 'OK', risk: 'Risk', blockerad: 'Blockerad', saknas: 'Saknas' };

// Status för ett beroende (ren funktion, testas i test/beroenden.test.mjs). Marginal i dagar: negativ = blockerad.
// Risk = under en veckas marginal eller föregångaren är försenad.
function depStatus(pred, succ, dep, today) {
  if (!pred || !succ) return { status: 'saknas', margin: null };
  if ((pred.progress || 0) >= 100) return { status: 'klar', margin: null };
  const type = dep.type || 'FS', lag = +dep.lag || 0;
  const a = toDay(type[0] === 'S' ? (pred.start || pred.end) : (pred.end || pred.start));
  const b = toDay(type[1] === 'S' ? (succ.start || succ.end) : (succ.end || succ.start));
  if (a == null || b == null) return { status: 'saknas', margin: null };
  const margin = b - a - lag - (type[0] === 'F' && type[1] === 'S' ? 1 : 0);
  if (margin < 0) return { status: 'blockerad', margin };
  if (margin < 7 || (pred.end && toDay(pred.end) < today)) return { status: 'risk', margin };
  return { status: 'ok', margin };
}

// Aktiviteten som ett taskRef pekar på i en plan: id → Planner-ID → namn + fas (ren funktion)
function refTask(pl, ref) {
  if (!pl || !ref) return null;
  return pl.tasks.find(x => x.id === ref.taskId)
    || (ref.plannerId && !ref.positional && pl.tasks.find(x => x.plannerId === ref.plannerId))
    || pl.tasks.find(x => normName(x.name) === normName(ref.name) && normName(x.bucket) === normName(ref.bucket)) || null;
}
function resolveRef(ref) {
  const pl = allPlans.find(p => p.id === ref.planId);
  return { plan: pl || null, task: refTask(pl, ref) };
}

/* ---------- Kritisk linje, slack och marginal till nästa gate (#4) ----------
   Bara beräkning och visning – inga datum ändras (beslut 2026-10-20: ingen automatisk schemaläggning). Rena funktioner, test/kritisk.test.mjs.
   Arbetsdagsaxel (#94-kalendern): cum(d) = antal arbetsdagar till och med dag d. En aktivitet ligger på (S, F] med S = cum(start − 1) och F = cum(slut),
   längd F − S arbetsdagar; en milstolpe har S = F = cum(datum). Fredag → måndag ger alltså marginal 0.
   Beroenden: t.deps = föregångarnas id, slut → start (FS). Typ och fördröjning läses ur t.depInfo[id] = { type: 'FS'|'SS'|'FF'|'SF', lag: arbetsdagar }
   om fältet finns (förberett för #83); programmets beroenden (#19) skickas som opts.links [{ from, to, type, lag }].
   Tidigaste start/slut (es/ef) = framåtpass från planerad start för aktiviteter utan föregångare (klara aktiviteter står på sina datum).
   Senaste start/slut (ls/lf) = bakåtpass från målet: planens slut (opts.target 'end'; med opts.group per grupp, t.ex. plan i programmet) eller en
   gate-milstolpe (id) – då räknas bara gatens föregångare i kedjan. Slack = lf − planerat slut i arbetsdagar: ≤ 0 kritisk, ≤ en arbetsvecka nära kritisk.
   Cirklar och aktiviteter utan datum rapporteras och hoppas över (aldrig oändliga loopar). */
const CRIT_COVERAGE = 30; // % – under det visas varningen att den kritiska linjen kan vara ofullständig
const cpType = x => { const s = String(x || '').toUpperCase(); return /^[SF][SF]$/.test(s) ? s : 'FS'; };
const cpLag = x => { const n = Math.round(+x || 0); return isFinite(n) ? clamp(n, -3650, 3650) : 0; };
// Arbetsdagsaxel för [lo, hi]: cum(d) och dagen för den n:te arbetsdagen (utanför intervallet: gränsen)
function workAxis(lo, hi, cal) {
  const c = new Int32Array(hi - lo + 1); let n = 0;
  for (let d = lo; d <= hi; d++) { if (isWorkday(d, cal)) n++; c[d - lo] = n; }
  const cum = d => d < lo ? 0 : d > hi ? n : c[d - lo];
  const dayOf = k => { if (k <= c[0]) return lo; if (k > n) return hi; let a = 0, b = c.length - 1; while (a < b) { const m = (a + b) >> 1; if (c[m] >= k) b = m; else a = m + 1; } return lo + a; };
  return { cum, dayOf };
}
// Föregångarna för en aktivitet: [{ from, type, lag }] ur t.deps (+ t.depInfo) och extra länkar (programmet)
function depLinksOf(t, extra) {
  const info = t.depInfo && typeof t.depInfo === 'object' ? t.depInfo : {};
  const own = (Array.isArray(t.deps) ? t.deps : []).filter(d => typeof d === 'string').map(d => ({ from: d, type: cpType((info[d] || {}).type), lag: cpLag((info[d] || {}).lag) }));
  return extra && extra.has(t.id) ? own.concat(extra.get(t.id)) : own;
}
function criticalPath(tasks, opts = {}) {
  const cal = opts.calendar || calendarOf({}), target = opts.target || 'end', wpw = cal.workdays.length || 5;
  const res = { target, byId: new Map(), nodes: new Map(), order: [], cycles: [], afterCycle: [], missing: [], broken: [], critical: [], near: [], end: null, targetOk: target === 'end', wpw };
  const all = new Set(), nodes = res.nodes;
  for (const t of tasks || []) {
    if (!t || t.id == null) continue;
    all.add(t.id);
    const a = toDay(t.start || t.end), b = toDay(t.end || t.start);
    if (a == null || b == null) { res.missing.push(t.id); continue; }
    const e = Math.max(a, b);
    nodes.set(t.id, { t, s: t.milestone ? e : Math.min(a, b), e, ms: !!t.milestone, done: (t.progress || 0) >= 100, preds: [], succs: [] });
  }
  if (!nodes.size) { res.targetOk = false; return res; }
  let lo = Infinity, hi = -Infinity;
  for (const v of nodes.values()) { lo = Math.min(lo, v.s); hi = Math.max(hi, v.e); }
  const pad = hi - lo + 120, ax = workAxis(lo - pad, hi + pad, cal);
  for (const v of nodes.values()) { v.F = ax.cum(v.e); v.S = v.ms ? v.F : ax.cum(v.s - 1); v.dur = v.F - v.S; }
  const extra = new Map();
  for (const l of opts.links || []) { if (!l || l.from == null || l.to == null) continue; if (!extra.has(l.to)) extra.set(l.to, []); extra.get(l.to).push({ from: l.from, type: cpType(l.type), lag: cpLag(l.lag) }); }
  for (const [id, v] of nodes) for (const l of depLinksOf(v.t, extra)) {
    if (l.from === id) continue;
    const p = nodes.get(l.from);
    if (!p) { if (all.has(l.from)) res.broken.push({ from: l.from, to: id }); continue; }
    v.preds.push({ ...l, p }); p.succs.push({ ...l, s: v });
  }
  // Topologisk ordning (Kahn). Det som blir kvar ligger i en cirkel eller efter en
  const indeg = new Map(), order = [];
  for (const [id, v] of nodes) { indeg.set(id, v.preds.length); if (!v.preds.length) order.push(id); }
  for (let i = 0; i < order.length; i++) for (const l of nodes.get(order[i]).succs) { const k = l.s.t.id; indeg.set(k, indeg.get(k) - 1); if (!indeg.get(k)) order.push(k); }
  if (order.length < nodes.size) {
    const ordered = new Set(order), rest = new Set([...nodes.keys()].filter(id => !ordered.has(id)));
    // Skala bort de som bara ligger efter en cirkel (inga efterföljare kvar i resten) – kvar blir cirkelns aktiviteter
    const ring = new Set(rest); let changed = true;
    while (changed) { changed = false; for (const id of ring) if (!nodes.get(id).succs.some(l => ring.has(l.s.t.id))) { ring.delete(id); changed = true; } }
    res.cycles = [...ring]; res.afterCycle = [...rest].filter(id => !ring.has(id));
  }
  res.order = order;
  // Framåt: tidigaste start/slut
  const reqS = (l, dur) => ({ FS: l.p.EF + l.lag, SS: l.p.ES + l.lag, FF: l.p.EF + l.lag - dur, SF: l.p.ES + l.lag - dur })[l.type];
  for (const id of order) {
    const v = nodes.get(id);
    v.ES = v.done || !v.preds.length ? v.S : Math.max(...v.preds.map(l => reqS(l, v.dur)));
    v.EF = v.ES + v.dur;
  }
  // Målet och vilka aktiviteter som räknas mot det
  const inOrder = new Set(order), scope = new Set();
  let gate = null, T = -Infinity;
  if (target === 'end') {
    order.forEach(id => scope.add(id));
    const grp = opts.group, ends = new Map();
    for (const v of nodes.values()) { const k = grp ? grp(v.t) : ''; ends.set(k, Math.max(ends.get(k) ?? -Infinity, v.F)); T = Math.max(T, v.F); } // slutet räknas på alla med datum, även i en cirkel
    for (const id of order) { const v = nodes.get(id); v.T = ends.get(grp ? grp(v.t) : ''); }
  } else {
    gate = nodes.get(target);
    if (!gate || !inOrder.has(target)) { res.targetOk = false; return finish(); }
    res.targetOk = true; T = gate.F;
    const st = [gate]; scope.add(target);
    while (st.length) for (const l of st.pop().preds) if (!scope.has(l.p.t.id) && inOrder.has(l.p.t.id)) { scope.add(l.p.t.id); st.push(l.p); }
  }
  res.end = fromDay(ax.dayOf(T));
  // Bakåt: senaste start/slut och slack
  const reqF = (l, dur) => ({ FS: l.s.LS - l.lag, SS: l.s.LS - l.lag + dur, FF: l.s.LF - l.lag, SF: l.s.LF - l.lag + dur })[l.type];
  for (let i = order.length - 1; i >= 0; i--) {
    const v = nodes.get(order[i]);
    if (!scope.has(order[i])) continue;
    let lf = target === 'end' ? v.T : v === gate ? gate.F : Infinity;
    for (const l of v.succs) if (scope.has(l.s.t.id)) lf = Math.min(lf, reqF(l, v.dur));
    v.LF = lf; v.LS = lf - v.dur; v.slack = lf - v.F;
  }
  return finish();
  function finish() {
    const near = cal.workdays.length || 5;
    for (const [id, v] of nodes) {
      const ok = v.ES != null, inS = scope.has(id) && v.slack != null;
      const date = (k, start) => k == null ? null : fromDay(start && !v.ms ? ax.dayOf(k + 1) : ax.dayOf(k));
      const r = { es: ok ? date(v.ES, true) : null, ef: ok ? date(v.EF) : null, ls: inS ? date(v.LS, true) : null, lf: inS ? date(v.LF) : null,
        slack: inS ? v.slack : null, done: v.done, inScope: inS, isTarget: id === target, critical: inS && !v.done && id !== target && v.slack <= 0, near: inS && !v.done && id !== target && v.slack > 0 && v.slack <= near };
      res.byId.set(id, r);
      if (r.critical) res.critical.push(id); else if (r.near) res.near.push(id);
    }
    return res;
  }
}
// Kedjan som driver målet: från målet bakåt via föregångaren med minst slack (lika: senast slut) → id i tidsordning
function cpChain(cp, id) {
  const out = [], seen = new Set();
  let v = cp.nodes.get(id);
  while (v && !seen.has(v.t.id)) {
    seen.add(v.t.id); out.unshift(v.t.id);
    const ps = v.preds.map(l => l.p).filter(p => (cp.byId.get(p.t.id) || {}).inScope);
    v = ps.sort((a, b) => (a.slack - b.slack) || (b.F - a.F))[0];
  }
  return out;
}
// Andel av aktiviteterna (milstolpar räknas inte) som har ett beroende åt något håll → { n, total, pct }
function depCoverage(tasks) {
  const ts = (tasks || []).filter(t => t && !t.milestone), ids = new Set((tasks || []).map(t => t && t.id));
  const linked = new Set();
  for (const t of tasks || []) for (const d of (t && Array.isArray(t.deps) ? t.deps : [])) if (ids.has(d) && d !== t.id) { linked.add(d); linked.add(t.id); }
  const n = ts.filter(t => linked.has(t.id)).length;
  return { n, total: ts.length, pct: ts.length ? Math.round(n / ts.length * 100) : 0 };
}
// Marginal till nästa gate: tidigaste ej klara gate utan utfall från och med idag. Slack i arbetsdagar för gatens föregångare (basis 'deps');
// utan beroenden: gatens datum mot sista slut bland fasens ej klara aktiviteter (basis 'phase'); annars 'none'.
// opts: calendar, isGate (förval isGateMs), code (gatens kod; förval namnet) → { gate {id, name, code, date}, days, weeks, basis, chain [{id, name, end, slack}], cp }
function nextGateMargin(p, today = todayDay(), opts = {}) {
  const tasks = (p && p.tasks) || [], cal = opts.calendar || calendarOf(p && p.settings), wpw = cal.workdays.length || 5;
  const isG = opts.isGate || isGateMs, code = opts.code || (t => t.name);
  const g = tasks.filter(t => isG(t) && (t.progress || 0) < 100 && !t.actual && toDay(t.end || t.start) != null && toDay(t.end || t.start) >= today)
    .sort((a, b) => toDay(a.end || a.start) - toDay(b.end || b.start))[0];
  if (!g) return null;
  const gate = { id: g.id, name: g.name, code: code(g), date: g.end || g.start };
  const cp = criticalPath(tasks, { calendar: cal, target: g.id });
  const byName = id => (tasks.find(t => t.id === id) || {}).name;
  const anc = [...cp.byId].filter(([id, r]) => r.inScope && !r.done && id !== g.id);
  if (anc.length) {
    const days = Math.min(...anc.map(([, r]) => r.slack));
    const chain = cpChain(cp, g.id).filter(id => id === g.id || !cp.byId.get(id).done).map(id => ({ id, name: byName(id), end: (tasks.find(t => t.id === id) || {}).end, slack: cp.byId.get(id).slack }));
    return { gate, days, weeks: days / wpw, basis: 'deps', chain, cp };
  }
  const ax = workAxis(toDay(gate.date) - 3650, toDay(gate.date) + 3650, cal);
  const ph = g.bucket && tasks.filter(t => t !== g && !t.milestone && (t.progress || 0) < 100 && t.bucket === g.bucket && toDay(t.end) != null)
    .sort((a, b) => toDay(b.end) - toDay(a.end))[0];
  if (ph) {
    const days = ax.cum(toDay(gate.date)) - ax.cum(toDay(ph.end));
    return { gate, days, weeks: days / wpw, basis: 'phase', chain: [{ id: ph.id, name: ph.name, end: ph.end, slack: days }, { id: g.id, name: g.name, end: gate.date, slack: 0 }], cp };
  }
  return { gate, days: null, weeks: null, basis: 'none', chain: [], cp };
}
// Slack som text: "−3 d", "4 d", "2 v" (hela arbetsveckor nedåt från en vecka)
function fmtSlack(d, wpw = 5) {
  if (d == null) return '–';
  const sg = d < 0 ? '−' : '', a = Math.abs(d);
  return a < wpw ? `${sg}${a} ${tr('d')}` : `${sg}${Math.floor(a / wpw)} ${tr('v')}`;
}
/* ---------- slut kritisk linje ---------- */

/* ---------- Varning när en uppdatering bryter beroenden mellan projekt (#22) ----------
   depImpact (ren funktion, test/depimpact.test.mjs) jämför programmens beroenden som rör planen före och efter en
   uppdatering (newTasks = mergeImport-resultatet). Med kommer beroenden som blir risk, blockerad eller saknas, eller
   som redan var det och får mindre marginal. Uppdateringen stoppas aldrig – det är information. */
const DEP_BAD = new Set(['blockerad', 'risk', 'saknas']);
function depImpact(programs, plansById, planId, newTasks, today = todayDay()) {
  const get = id => plansById instanceof Map ? plansById.get(id) : plansById[id];
  const old = get(planId); if (!old) return [];
  const neu = { ...old, tasks: newTasks }, out = [];
  const side = (pl, ref, t) => ({ planId: ref.planId, plan: pl ? pl.name : '', taskId: t ? t.id : ref.taskId, task: t ? t.name : ref.name, bucket: t ? t.bucket : ref.bucket });
  for (const pg of programs || []) {
    if (!pg || (pg.settings || {}).deleted_at) continue;
    for (const d of pg.dependencies || []) {
      const fIn = d.from.planId === planId, tIn = d.to.planId === planId;
      if (!fIn && !tIn) continue;
      const fp = get(d.from.planId), tp = get(d.to.planId);
      const b = depStatus(refTask(fp, d.from), refTask(tp, d.to), d, today);
      const fa = refTask(fIn ? neu : fp, d.from), ta = refTask(tIn ? neu : tp, d.to);
      const a = depStatus(fa, ta, d, today);
      if (!DEP_BAD.has(a.status)) continue;
      const worse = DEP_ORDER[a.status] < DEP_ORDER[b.status] || (a.status === b.status && a.margin != null && b.margin != null && a.margin < b.margin);
      if (!worse) continue;
      out.push({ programId: pg.id, program: pg.name, depId: d.id, type: d.type || 'FS', lag: +d.lag || 0, mine: fIn ? 'from' : 'to',
        from: side(fIn ? neu : fp, d.from, fa), to: side(tIn ? neu : tp, d.to, ta),
        before: { status: b.status, margin: b.margin }, after: { status: a.status, margin: a.margin },
        deltaDays: a.margin != null && b.margin != null ? a.margin - b.margin : null });
    }
  }
  return out.sort((x, y) => (DEP_ORDER[x.after.status] - DEP_ORDER[y.after.status]) || ((x.deltaDays ?? 0) - (y.deltaDays ?? 0)));
}
// Marginal i dagar och veckor, t.ex. "−12 d (−1,7 v)"
function fmtDW(m) {
  if (m == null) return '–';
  const sg = m > 0 ? '+' : m < 0 ? '−' : '', w = Math.round(Math.abs(m) / 0.7) / 10;
  return `${sg}${Math.abs(m)} d (${sg}${LANG === 'en' ? w : String(w).replace('.', ',')} ${tr('v')})`;
}
const DEP_ALERT_MAX = 50;
// Notis i programmet efter sparad uppdatering: {at, planId, planName, items, seenBy: []}, högst 50 per program
function addDepAlerts(progs, impact, pl, at = new Date().toISOString(), key = 'depAlerts') {
  const touched = [];
  for (const pg of progs) {
    const items = impact.filter(x => x.programId === pg.id).map(({ programId, program, ...x }) => x);
    if (!items.length) continue;
    pg.settings = pg.settings || {};
    pg.settings[key] = [...(pg.settings[key] || []), { at, planId: pl.id, planName: pl.name, items, seenBy: [] }].slice(-DEP_ALERT_MAX);
    touched.push(pg);
  }
  return touched;
}
// Osedda notiser för en läsare och de påverkade beroendena (senaste notisen vinner per beroende)
// key: 'depAlerts' (beroenden, #22) eller 'gateAlerts' (gater som glidit förbi programgaten, #99)
function unseenAlerts(pg, who, key = 'depAlerts') { return ((pg.settings || {})[key] || []).filter(a => !(a.seenBy || []).includes(who)); }
function changedDeps(pg, who) {
  const m = new Map();
  for (const a of unseenAlerts(pg, who)) for (const it of a.items || []) m.set(it.depId, { ...it, at: a.at, planName: a.planName });
  return m;
}
function markAlertsSeen(pg, who) {
  let n = 0;
  for (const key of ['depAlerts', 'gateAlerts']) for (const a of unseenAlerts(pg, who, key)) { a.seenBy = [...(a.seenBy || []), who].slice(-200); n++; }
  return n;
}
// Osedda gater som glidit förbi programgaten, per plan och gate (senaste notisen vinner)
function changedGates(pg, who) {
  const m = new Map();
  for (const a of unseenAlerts(pg, who, 'gateAlerts')) for (const it of a.items || []) m.set(it.planId + '|' + it.key, { ...it, at: a.at, planName: a.planName });
  return m;
}
// Vem som har sett notisen: ett id per webbläsare (LS; utan lagring gäller det besöket)
function seenKey() {
  let v = LS.get('timeplan.viewer'); if (!v) { v = uid(); LS.set('timeplan.viewer', v); }
  return 'b:' + v;
}
const planDepImpact = (pl, tasks) => depImpact(allPrograms, new Map(allPlans.map(p => [p.id, p])), pl.id, tasks);
const planGateImpact = (pl, tasks) => gateImpact(allPrograms, new Map(allPlans.map(p => [p.id, p])), pl.id, tasks);
// Efter sparad uppdatering: notisen läggs i varje berört program och sparas direkt (planen ändras inte)
function saveDepAlerts(impact, pl, key = 'depAlerts') {
  if (!impact.length || !ProgStore) return;
  for (const pg of addDepAlerts(allPrograms.filter(p => impact.some(x => x.programId === p.id)), impact, pl, undefined, key)) {
    dailyVersion('program', pg);
    ProgStore.update(pg.id, programRow(pg)).catch(e => toast(tr('Kunde inte spara programmet: ') + e.message));
  }
}
// Förhandsvisningens avsnitt "Glider förbi programgaten" (#99)
function gateImpactHTML(shown) {
  if (!shown.length) return '';
  return `<div class="upd-impact bad" id="updGateImpact"><p><b>⚠ ${tr('Glider förbi programgaten')} (${shown.length})</b> – ${tr('gater som hamnar minst en vecka efter programgaten med samma kod. Uppdateringen stoppas inte; programmet visar en varning tills den markeras som sedd.')}</p>
    <table class="upd-act dep-impact"><tr><th>${tr('Program')}</th><th>${tr('Projekt')}</th><th>${tr('Gate')}</th><th>${tr('Programgate')}</th><th>${tr('Före')}</th><th>${tr('Efter')}</th></tr>
    ${shown.slice(0, 12).map(x => `<tr><td>${esc(x.program)}</td><td>${esc(x.plan)}${x.inherited ? `<small>${tr('ärver huvudplanens gater')}</small>` : ''}</td><td><b>${esc(x.code)}</b></td><td>${esc(x.pgWeek)}</td>
      <td>${x.before ? `${esc(x.before.week)}<small>${fmtDevW(x.before.devW)}</small>` : '–'}</td><td><b style="color:var(--critical)">${esc(x.after.week)}</b><small>${fmtDevW(x.after.devW)}</small></td></tr>`).join('')}
    </table>${shown.length > 12 ? `<p>${tr('… och {n} till', { n: shown.length - 12 })}</p>` : ''}</div>`;
}
// Förhandsvisningens avsnitt "Påverkar andra projekt" (#22)
function impactHTML(impact) {
  if (!impact.length) return '';
  const bad = impact.some(x => x.after.status === 'blockerad');
  const chip = st => `<span class="dep-chip" style="background:${depColor(st)}">${tr(DEP_TXT[st])}</span>`;
  return `<div class="upd-impact${bad ? ' bad' : ''}" id="updImpact"><p><b>⚠ ${tr('Påverkar andra projekt')} (${impact.length})</b> – ${tr('beroenden i programmet som blir risk eller blockerade. Uppdateringen stoppas inte; programmet visar en varning tills någon markerat den som sedd.')}</p>
    <table class="upd-act dep-impact"><tr><th>${tr('Program')}</th><th>${tr('Annat projekt – aktivitet')}</th><th>${tr('Typ')}</th><th>${tr('Marginal före')}</th><th>${tr('Efter')}</th></tr>
    ${impact.slice(0, 12).map(x => {
      const o = x.mine === 'from' ? x.to : x.from, m = x.mine === 'from' ? x.from : x.to;
      return `<tr><td>${esc(x.program)}</td><td><b>${esc(o.plan)}</b><br>${esc(o.task)}<small>${x.mine === 'from' ? tr('väntar på {name}', { name: esc(m.task) }) : tr('{name} väntar på den', { name: esc(m.task) })}</small></td>
        <td>${tr(DEP_TYPES[x.type] || DEP_TYPES.FS)}<small>${x.type}${x.lag ? ` + ${x.lag} d` : ''}</small></td>
        <td>${chip(x.before.status)}<small>${fmtDW(x.before.margin)}</small></td>
        <td>${chip(x.after.status)}<small>${fmtDW(x.after.margin)}${x.deltaDays != null ? ` · ${tr('ändring')} ${fmtDW(x.deltaDays)}` : ''}</small></td></tr>`;
    }).join('')}</table>${impact.length > 12 ? `<p>${tr('… och {n} till', { n: impact.length - 12 })}</p>` : ''}</div>`;
}
const taskRef = (pl, t) => ({ planId: pl.id, taskId: t.id, plannerId: t.plannerId || null, positional: !!t.positional, name: t.name, bucket: t.bucket });

function programDeps(p = program) {
  const td = todayDay();
  return (p.dependencies || []).map(d => {
    const f = resolveRef(d.from), t = resolveRef(d.to);
    return { ...d, fromPlan: f.plan, fromTask: f.task, toPlan: t.plan, toTask: t.task, ...depStatus(f.task, t.task, d, td) };
  }).sort((a, b) => (DEP_ORDER[a.status] - DEP_ORDER[b.status]) || ((a.margin ?? 1e9) - (b.margin ?? 1e9)));
}
const fmtMargin = m => m == null ? '' : `${m > 0 ? '+' : ''}${m} d`;

async function addDependency() {
  const pls = program.plans.map(r => allPlans.find(p => p.id === r.planId)).filter(Boolean);
  if (pls.length < 2) return toast(tr('Programmet behöver minst två planer'));
  const projOpts = pls.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  const side = (k, title, hint) => `<fieldset><legend>${title}</legend><select id="${k}Plan">${projOpts}</select><select id="${k}Task"></select><small style="color:var(--text-muted)">${hint}</small></fieldset>`;
  const done = dialog({
    title: tr('Nytt beroende mellan projekt'), wide: true,
    body: `<div class="dep-form">
      ${side('dpF', tr('Föregångare – måste bli klar först'), tr('T.ex. Bygg: Lokalen klar'))}
      ${side('dpT', tr('Efterföljare – väntar på föregångaren'), tr('T.ex. Inflyttning: Möbler levererade'))}
      <div class="row2"><label>${tr('Typ')}<select id="dpType">${Object.entries(DEP_TYPES).map(([k, v]) => `<option value="${k}">${tr(v)}</option>`).join('')}</select></label>
      <label>${tr('Fördröjning (dagar)')}<input type="number" id="dpLag" value="0"></label></div>
      <label>${tr('Motivering')}<input type="text" id="dpNote" placeholder="${tr('Vad behövs, och varför?')}"></label></div>`,
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Skapa beroende'), value: 'save' }],
  });
  const fill = k => {
    const pl = pls.find(p => p.id === $(`#${k}Plan`).value), prev = plan; plan = pl; const order = bucketList(); plan = prev;
    const ts = pl.tasks.filter(t => t.start || t.end).sort((a, b) => (order.indexOf(a.bucket) - order.indexOf(b.bucket)) || (toDay(a.start || a.end) - toDay(b.start || b.end)));
    $(`#${k}Task`).innerHTML = order.map(b => { const g = ts.filter(t => t.bucket === b); return g.length ? `<optgroup label="${esc(b)}">${g.map(t => `<option value="${esc(t.id)}">${esc(t.name)} · ${fmtShort(toDay(t.start || t.end))}–${fmtShort(toDay(t.end || t.start))}</option>`).join('')}</optgroup>` : ''; }).join('');
  };
  $('#dpTPlan').value = pls[0].id; $('#dpFPlan').value = pls[1].id;
  fill('dpF'); fill('dpT');
  $('#dpFPlan').onchange = () => fill('dpF'); $('#dpTPlan').onchange = () => fill('dpT');
  // Dialogens värden läses innan den stängs
  let vals = null;
  $('#modal .m-foot').addEventListener('click', () => { vals = { fp: $('#dpFPlan').value, ft: $('#dpFTask').value, tp: $('#dpTPlan').value, tt: $('#dpTTask').value, type: $('#dpType').value, lag: +$('#dpLag').value || 0, note: $('#dpNote').value.trim() }; }, true);
  if (await done !== 'save' || !vals) return;
  if (vals.fp === vals.tp) return toast(tr('Välj aktiviteter i två olika projekt – beroenden inom ett projekt hör hemma i projektets plan'));
  const fpl = pls.find(p => p.id === vals.fp), tpl = pls.find(p => p.id === vals.tp);
  const ft = fpl.tasks.find(t => t.id === vals.ft), tt = tpl.tasks.find(t => t.id === vals.tt);
  if (!ft || !tt) return toast(tr('Välj en aktivitet på båda sidor'));
  program.dependencies.push({ id: uid(), from: taskRef(fpl, ft), to: taskRef(tpl, tt), type: vals.type, lag: vals.lag, note: vals.note,
    createdAt: new Date().toISOString() });
  saveProgram(); render();
  const st = programDeps().find(d => d.fromTask === ft && d.toTask === tt);
  toast(tr('Beroende skapat') + (st ? ` – ${tr(DEP_TXT[st.status]).toLowerCase()}${st.margin != null ? ` (${fmtMargin(st.margin)})` : ''}` : ''));
}

async function removeDependency(id) {
  const ok = await dialog({ title: tr('Ta bort beroendet?'), body: tr('Beroendet tas bort ur programmet. Planerna påverkas inte.'), buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Ta bort'), value: true, danger: true }] });
  if (!ok) return;
  program.dependencies = program.dependencies.filter(d => d.id !== id);
  saveProgram(); render();
}

function renderProgramDeps() {
  const deps = programDeps(), ch = changedDeps(program, seenKey());
  const cell = (pl, t, date) => pl && t ? `<b>${esc(pl.name)}</b><br>${esc(t.name)}<small>${date}</small>` : `<i>${tr('Aktiviteten finns inte längre')}</i>`;
  $('#pgDeps').innerHTML = `<div class="pg-deps-head"><h3>${tr('Beroenden mellan projekten')} (${deps.length})</h3>
      <button class="btn ghost small" data-adddep>${tr('+ Beroende')}</button></div>
    ${deps.length ? `<table class="dep-table"><tr><th>${tr('Status')}</th><th>${tr('Föregångare')}</th><th>${tr('Efterföljare')}</th><th>${tr('Marginal')}</th><th>${tr('Motivering')}</th><th></th></tr>
      ${deps.map(d => { const c = ch.get(d.id); return `<tr${c ? ' class="dep-changed"' : ''}><td><span class="dep-chip" style="background:${depColor(d.status)}">${tr(DEP_TXT[d.status])}</span>${c ? `<span class="chg-tag" title="${esc(tr('{plan} uppdaterad {when}', { plan: c.planName, when: fmtWhen(c.at) }))}">${tr('ändrad')}</span><small>${tr('marginal {a} → {b}', { a: fmtDW(c.before.margin), b: fmtDW(c.after.margin) })}</small>` : ''}</td>
        <td>${cell(d.fromPlan, d.fromTask, d.fromTask ? tr('slut') + ' ' + fmtShortY(d.fromTask.end || d.fromTask.start) : '')}</td>
        <td>${cell(d.toPlan, d.toTask, d.toTask ? tr('start') + ' ' + fmtShortY(d.toTask.start || d.toTask.end) : '')}</td>
        <td>${fmtMargin(d.margin)}<small>${tr(DEP_TYPES[d.type] || DEP_TYPES.FS)}${d.lag ? ` + ${d.lag} d` : ''}</small></td>
        <td>${esc(d.note || '')}</td><td><button class="icon-btn" data-rmdep="${esc(d.id)}" title="${tr('Ta bort')}">✕</button></td></tr>`; }).join('')}</table>`
      : `<div class="dep-empty">${tr('Inga beroenden ännu.')} ${tr('Skapa ett med <b>+ Beroende</b>, t.ex. att Inflyttning väntar på att Bygg blir klart.')}</div>`}`;
  $('#pgDeps').onclick = e => {
    if (e.target.closest('[data-adddep]')) addDependency();
    const r = e.target.closest('[data-rmdep]'); if (r) removeDependency(r.dataset.rmdep);
  };
}

// Översiktens banner (#22): beroenden som påverkats av uppdateringar sedan läsaren senast markerade dem som sedda
function renderProgramAlert() {
  const el = $('#pgAlert'), ch = changedDeps(program, seenKey()), gs = changedGates(program, seenKey());
  el.hidden = !ch.size && !gs.size;
  if (el.hidden) return (el.innerHTML = '');
  const items = [...ch.values()], bad = items.some(x => x.after.status === 'blockerad') || gs.size > 0;
  const seen = new Set(), latest = unseenAlerts(program, seenKey()).slice().reverse().filter(a => !seen.has(a.planId) && seen.add(a.planId)).slice(0, 3);
  el.className = 'pg-alert' + (bad ? ' bad' : '');
  // Gater som glidit förbi programgaten (#99)
  const gl = [...gs.values()].sort((a, b) => b.after.devW - a.after.devW);
  const gateHTML = gs.size ? `<div class="pg-alert-main"><b>⚠ ${tr(gs.size === 1 ? '{n} gate har glidit förbi programgaten' : '{n} gater har glidit förbi programgaten', { n: gs.size })}</b>
      <small>${gl.slice(0, 4).map(x => esc(`${x.plan} ${x.code} ${x.after.week} (${fmtDevW(x.after.devW)})`)).join(' · ')}${gl.length > 4 ? ' · ' + esc(tr('… och {n} till', { n: gl.length - 4 })) : ''}</small></div>
    <button class="btn ghost small" data-gogates>${tr('Visa i Gater')}</button>` : '';
  if (!ch.size) {
    el.innerHTML = `${gateHTML}<button class="btn small" data-seen>${tr('Markera som sett')}</button>`;
    el.onclick = e => { if (e.target.closest('[data-gogates]')) { ui.pgView = 'gates'; saveUi(); render(true); } else if (e.target.closest('[data-seen]')) markProgramSeen(); };
    return;
  }
  el.innerHTML = `<div class="pg-alert-main"><b>⚠ ${tr(ch.size === 1 ? '{n} beroende påverkat sedan senaste uppdateringen' : '{n} beroenden påverkade sedan senaste uppdateringen', { n: ch.size })}</b>
      <small>${latest.map(a => esc(tr('{plan} uppdaterad {when}', { plan: a.planName, when: fmtWhen(a.at) }))).join(' · ')}${bad ? ' · ' + ((n => tr(n > 1 ? '{n} blockerade' : '{n} blockerad', { n }))(items.filter(x => x.after.status === 'blockerad').length)) : ''}</small></div>
    <a href="#pgDeps" class="btn ghost small" data-golist>${tr('Visa beroendena')}</a>
    <button class="btn ghost small" data-gogantt>${tr('Visa i Gantt')}</button>
    ${gateHTML ? '<span class="pg-alert-break"></span>' + gateHTML : ''}<button class="btn small" data-seen>${tr('Markera som sett')}</button>`;
  el.onclick = e => {
    if (e.target.closest('[data-gogates]')) { ui.pgView = 'gates'; saveUi(); render(true); return; }
    if (e.target.closest('[data-golist]')) { e.preventDefault(); const t = $('#pgDeps .dep-changed') || $('#pgDeps'); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else if (e.target.closest('[data-gogantt]')) { ui.pgView = 'gantt'; saveUi(); render(true); }
    else if (e.target.closest('[data-seen]')) markProgramSeen();
  };
}
function markProgramSeen() {
  if (!program) return;
  const n = markAlertsSeen(program, seenKey());
  if (!n) return;
  saveProgram(); render();
  toast(tr('Markerat som sett'));
}

/* ---------- Program-Gantt (#18) ----------
   Planerna i programmet slås ihop till en skrivskyddad plan (plan.synthetic) så att plan-Gantt kan rita den:
   aktiviteternas id och faser får planens id som prefix, så att de inte krockar mellan planer. */
const PG_SEP = '›';
function programPlan() {
  const tasks = [], order = [], codes = {}, colors = {};
  for (const ref of program.plans) {
    const pl = allPlans.find(x => x.id === ref.planId); if (!pl) continue;
    const prev = plan; plan = pl; const bo = bucketList(); plan = prev;
    bo.forEach(b => { order.push(pl.id + PG_SEP + b); if ((pl.settings.phaseCodes || {})[b]) codes[pl.id + PG_SEP + b] = pl.settings.phaseCodes[b]; });
    // Planens egna färger och palett (#74); planer utan eget val ritas som förut
    if (hasOwnColors(pl)) bo.forEach(b => { colors[pl.id + PG_SEP + b] = colorIn(pl, b); });
    pl.tasks.forEach(t => tasks.push({ ...t, id: pl.id + PG_SEP + t.id, deps: (t.deps || []).map(d => pl.id + PG_SEP + d),
      ...(t.depInfo ? { depInfo: Object.fromEntries(Object.entries(t.depInfo).map(([k, v]) => [pl.id + PG_SEP + k, v])) } : {}),
      bucket: pl.id + PG_SEP + (t.bucket || 'Övrigt'), _plan: pl.id }));
  }
  ui.pgCollapsed = ui.pgCollapsed || {};
  const byId = new Map(tasks.map(t => [t.id, t])), xdeps = [], ch = changedDeps(program, seenKey());
  for (const d of programDeps()) {
    if (!d.fromTask || !d.toTask) continue;
    const from = d.fromPlan.id + PG_SEP + d.fromTask.id, to = d.toPlan.id + PG_SEP + d.toTask.id;
    const x = { from, to, fromPlan: d.fromPlan.id, toPlan: d.toPlan.id, status: d.status, margin: d.margin, type: d.type || 'FS', lag: +d.lag || 0,
      label: `${d.fromPlan.name}: ${d.fromTask.name}`, fromEnd: d.fromTask.end || d.fromTask.start, changed: ch.get(d.id) || null };
    xdeps.push(x);
    const t = byId.get(to); if (t) (t.xdeps = t.xdeps || []).push(x);
    // Påverkat av en uppdatering (#22): båda aktiviteterna markeras tills någon klickat Markera som sett
    if (x.changed) [byId.get(from), t].forEach(a => { if (a) a._chg = x.changed; });
  }
  // Programgaterna (#21) med datum – ritas på översta raden och tas med i tidsskalan, men är inga aktiviteter
  const pgTasks = cleanProgramGates(program.milestones).filter(g => g.date).map(g => ({ id: 'pg' + PG_SEP + g.id, name: `${g.code}${g.name ? ' – ' + g.name : ''}`, code: g.code,
    start: g.date, end: g.date, milestone: true, progress: g.status === 'done' ? 100 : 0, goalStatus: g.status, _pg: g, _col: pgGateColor(g.code) }));
  return { id: 'prog:' + program.id, name: program.name, synthetic: true, tasks, xdeps, pgTasks,
    settings: { bucketOrder: order, phaseCodes: codes, phaseColors: colors, collapsed: ui.pgCollapsed } };
}

// Projektradens PMI-faser i planens egna färger (#74): fasen i planen som hör till samma PMI-fas
function ownSegCols(pl, segs) {
  if (!segs || !hasOwnColors(pl)) return segs;
  const bo = pl.settings.bucketOrder || [], codes = pl.settings.phaseCodes || {};
  const orderOf = b => { const g = String(codes[b] || '').toUpperCase(); const m = PMI_PHASES.find(ph => ph.gates.includes(g)) || PMI_PHASES.find(ph => ph.re.test(b)); return m ? m.order : null; };
  return segs.map(g => { const b = bo.find(x => orderOf(x) === g.order); return b ? { ...g, col: colorIn(pl, b) } : g; });
}

function buildProgramRows() {
  const vis = visibleTasks(), rows = [], open = ui.pgOpen || {};
  // Programgaterna (#21) som romber på översta raden; klick på raden öppnar gate-översikten
  if (plan.pgTasks && plan.pgTasks.length) {
    const ds = plan.pgTasks.map(t => toDay(t.end));
    rows.push({ type: 'project', key: 'pg' + PG_SEP + 'gates', pgates: true, name: tr('Programgater'), n: plan.pgTasks.length, collapsed: true, lvl: 0,
      s: Math.min(...ds), e: Math.max(...ds), segments: [], gates: plan.pgTasks, prog: null, blocked: 0, changed: 0 });
  }
  const blockedPlans = new Set(plan.xdeps.filter(x => x.status === 'blockerad').flatMap(x => [x.fromPlan, x.toPlan]));
  const dated = pl => vis.filter(t => t._plan === pl.id && (t.start || t.end));
  // Projektrad för en plan; gates = romberna på raden (ärvda från huvudplanen för delprojekt utan egna, #67)
  const projectRow = (pl, lvl, gates, tag) => {
    const mine = vis.filter(t => t._plan === pl.id), d = mine.filter(t => t.start || t.end), work = mine.filter(t => !t.gate);
    const phases = plan.settings.bucketOrder.filter(k => k.startsWith(pl.id + PG_SEP));
    const segments = phases.map(k => {
      const ts = d.filter(t => t.bucket === k && !t.gate); if (!ts.length) return null;
      return { key: k, label: k.slice(k.indexOf(PG_SEP) + 1), s: Math.min(...ts.map(t => toDay(t.start || t.end))), e: Math.max(...ts.map(t => toDay(t.end || t.start))) };
    }).filter(Boolean);
    const all = [...segments.flatMap(g => [g.s, g.e]), ...gates.map(t => toDay(t.end))];
    const ps = all.length ? Math.min(...all) : null, pe = all.length ? Math.max(...all) : null;
    rows.push({ type: 'project', key: pl.id, name: pl.name, n: work.length, collapsed: !open[pl.id], lvl, tag,
      s: ps, e: pe, segments: ownSegCols(pl, gateSegments(gates, ps, pe)) || segments.map(g => ({ ...g, faint: true })),
      blocked: plan.xdeps.filter(x => x.toPlan === pl.id && x.status === 'blockerad').length,
      changed: plan.xdeps.filter(x => x.changed && (x.toPlan === pl.id || x.fromPlan === pl.id)).length,
      gates, prog: work.length ? Math.round(work.reduce((a, t) => a + (t.progress || 0), 0) / work.length) : 0 });
    if (!open[pl.id]) return;
    for (const k of phases) {
      const ts = d.filter(t => t.bucket === k).sort((x, y) => (toDay(x.start || x.end) - toDay(y.start || y.end)) || (toDay(x.end) - toDay(y.end)));
      if (!ts.length) continue;
      const s = Math.min(...ts.map(t => toDay(t.start || t.end))), e = Math.max(...ts.map(t => toDay(t.end || t.start)));
      const prog = Math.round(ts.reduce((a, t) => a + (t.progress || 0), 0) / ts.length);
      const collapsed = !!plan.settings.collapsed[k];
      rows.push({ type: 'group', bucket: k, label: bName(k.slice(k.indexOf(PG_SEP) + 1)), tasks: ts, s, e, prog, collapsed, sub: true });
      if (!collapsed) ts.forEach(t => rows.push({ type: 'task', t, sub: true }));
    }
  };
  const list = program.plans.map(ref => allPlans.find(x => x.id === ref.planId)).filter(Boolean);
  for (const g of projectGroups(list)) {
    if (g.plan) {
      if (ui.pgOnlyBlocked && !blockedPlans.has(g.plan.id)) continue;
      projectRow(g.plan, 0, dated(g.plan).filter(t => t.gate));
      continue;
    }
    // Huvudprojekt: rad med huvudplanens gater som fälls ut till huvudplanen och delprojekten (#67)
    if (ui.pgOnlyBlocked && !g.plans.some(x => blockedPlans.has(x.id))) continue;
    const key = 'grp' + PG_SEP + g.key, mainGates = g.main ? dated(g.main).filter(t => t.gate) : [];
    const members = g.plans.map(x => x.id), mt = vis.filter(t => members.includes(t._plan) && (t.start || t.end));
    const work = vis.filter(t => members.includes(t._plan) && !t.gate);
    const days = mt.flatMap(t => [toDay(t.start || t.end), toDay(t.end || t.start)]);
    const ps = days.length ? Math.min(...days) : null, pe = days.length ? Math.max(...days) : null;
    rows.push({ type: 'project', key, name: g.l1, n: work.length, collapsed: !open[key], group: true, members,
      tag: tr('{n} delprojekt', { n: g.subs.length }), s: ps, e: pe,
      segments: (g.main ? ownSegCols(g.main, gateSegments(mainGates, ps, pe)) : gateSegments(mainGates, ps, pe)) || [], gates: mainGates,
      blocked: plan.xdeps.filter(x => members.includes(x.toPlan) && x.status === 'blockerad').length,
      changed: plan.xdeps.filter(x => x.changed && (members.includes(x.toPlan) || members.includes(x.fromPlan))).length,
      prog: work.length ? Math.round(work.reduce((a, t) => a + (t.progress || 0), 0) / work.length) : 0 });
    if (!open[key]) continue;
    if (g.main) projectRow(g.main, 1, mainGates, tr('Huvudplan'));
    for (const sp of g.subs) {
      const sg = subGates(sp, g.main);
      const own = dated(sp).filter(t => t.gate);
      const devs = new Map(sg.deviating.map(x => [x.taskId, x]));
      const inhIds = new Set(sg.gates.map(x => g.main && g.main.id + PG_SEP + x.taskId));
      const gates = sg.mode === 'inherited' ? dated(g.main).filter(t => inhIds.has(t.id)).map(t => ({ ...t, _inh: g.main.name }))
        : sg.mode === 'none' ? [] : own.map(t => { const x = devs.get(t.id.slice(t.id.indexOf(PG_SEP) + 1)); return x ? { ...t, _dev: x } : t; });
      projectRow(sp, 1, gates, sg.mode === 'inherited' ? tr('ärvda gater') : sg.mode === 'none' ? tr('stödprojekt') : sg.deviating.length ? tr('{n} gater avviker', { n: sg.deviating.length }) : '');
    }
  }
  return rows;
}

// Nyckeltal för en plan i programmet (läser bara)
function planSummary(p) {
  const prev = plan; plan = p; // colorOf och bucketList läser den aktuella planen
  try {
    const td = todayDay(), work = p.tasks.filter(t => !t.gate);
    const prog = work.length ? Math.round(work.reduce((a, t) => a + (t.progress || 0), 0) / work.length) : 0;
    const late = work.filter(t => statusOf(t) === 'late').length;
    const active = work.filter(t => t.start && toDay(t.start) <= td && toDay(t.end) >= td && (t.progress || 0) < 100);
    const order = bucketList();
    const phase = active.length ? order.find(b => active.some(t => t.bucket === b)) : [...order].reverse().find(b => work.some(t => t.bucket === b && t.start && toDay(t.start) <= td)) || order[0];
    const gates = p.tasks.filter(t => t.gate && t.end).sort((a, b) => toDay(a.end) - toDay(b.end));
    const next = gates.find(g => (g.progress || 0) < 100);
    return { prog, late, n: work.length, phase, phaseCol: phase ? colorOf(phase) : PAL.other,
      next, nextCol: next ? colorOf(next.bucket) : null, nextLate: next && toDay(next.end) < td };
  } finally { plan = prev; }
}

function renderProgram() {
  const p = program;
  $('#pgName').textContent = p.name;
  $('#pgSub').textContent = tr('{n} projekt', { n: p.plans.length });
  // Huvudprojekt med delprojekt (#67): planerna grupperas per nivå 1; saknade planer visas sist
  const list = p.plans.map(ref => allPlans.find(x => x.id === ref.planId)).filter(Boolean);
  const missing = p.plans.filter(ref => !allPlans.some(x => x.id === ref.planId));
  const cards = projectGroups(list).map(g => g.plan ? pgCardHTML(g.plan, { suggestMain: !!planProject(g.plan).l1 && !planProject(g.plan).l2 }) : pgGroupHTML(g));
  missing.forEach(ref => cards.push(`<div class="pg-card missing"><h3>${tr('Planen finns inte längre')}</h3><div class="pg-meta">${tr('Den kan ha tagits bort eller importerats som ny plan.')}</div>
      <div class="pg-actions"><button class="btn ghost small" data-rm="${esc(ref.planId)}">${tr('Ta bort ur programmet')}</button></div></div>`));
  cards.push(`<div class="pg-card add" data-add>${tr('＋ Lägg till plan')}<div class="pg-meta">${tr('välj bland dina planer')}</div></div>`);
  $('#pgGrid').innerHTML = cards.join('');
  $('#pgGates').innerHTML = pgGateChipsHTML(p);
  renderProgramAlert();
  renderProgramDeps();
  $('#pgGrid').onclick = e => {
    const o = e.target.closest('[data-open]'), r = e.target.closest('[data-rm]'), a = e.target.closest('[data-add]');
    const mk = e.target.closest('[data-mkmain]'), ns = e.target.closest('[data-newsub]'), cr = e.target.closest('[data-crit]');
    if (cr) { const pl = allPlans.find(x => x.id === cr.dataset.crit), m = planGateMargin(pl); ui.crit = true; ui.critTarget = m ? m.gate.id : 'end'; ui.view = 'gantt'; selectPlan(cr.dataset.crit, true); }
    else if (o) selectPlan(o.dataset.open, true);
    else if (r) removePlanFromProgram(r.dataset.rm);
    else if (a) addPlanToProgram();
    else if (mk) setMainPlan(allPlans.find(x => x.id === mk.dataset.mkmain), mk.dataset.on !== '0');
    else if (ns) newSubproject(projectGroups(list).find(g => g.key === ns.dataset.newsub));
  };
}

// Ett projektkort i programöversikten. ctx.main = huvudplanen för ett delprojekt, ctx.isMain = kortet är huvudplanen,
// ctx.suggestMain = ensam plan med nivå 1 men utan nivå 2 (kan bli huvudplan innan delprojekten finns)
function pgCardHTML(pl, ctx = {}) {
  const s = planSummary(pl), td = todayDay();
  const sg = ctx.sub ? subGates(pl, ctx.main) : null;
  // Ärvd nästa gate när delprojektet saknar egna gater
  const inhNext = sg && sg.mode === 'inherited' ? sg.gates.find(g => !g.act && g.gs !== 'done' && g.day >= td) : null;
  const gateLine = sg && sg.mode === 'none' ? tr('Inga gater (stödprojekt)')
    : s.next && !(sg && sg.mode === 'inherited')
    ? `<i style="background:${s.nextCol}"></i>${tr('Nästa gate:')} <b>${esc(s.next.name)}</b> ${fmtDayY(toDay(s.next.end))} · ${fmtYYWW(toDay(s.next.end))}${s.nextLate ? ` · <span style="color:var(--critical)">${tr('passerad')}</span>` : ''}`
    : inhNext ? `<i style="background:${pgGateColor(inhNext.code)}"></i>${tr('Nästa gate:')} <b>${esc(inhNext.code)}</b> <span class="pg-inh-tag">${tr('ärvd')}</span> ${fmtDayY(inhNext.day)} · ${inhNext.week}`
    : tr('Inga kommande gater');
  const pr = planProject(pl);
  return `<div class="pg-card ${ctx.isMain ? 'pg-main' : ''} ${ctx.sub ? 'pg-subcard' : ''}" data-plan="${esc(pl.id)}">
      ${ctx.isMain ? `<span class="pg-tag">${tr('Huvudplan')}</span>` : ''}
      <h3>${esc(pl.name)}</h3>
      ${s.phase ? `<span class="pg-phase" style="background:${s.phaseCol};color:${inkOn(s.phaseCol)}">${esc(bName(s.phase))}</span>` : ''}
      <div class="pg-stats"><div><b>${s.n}</b><span>${tr('aktiviteter')}</span></div><div><b>${s.prog}%</b><span>${tr('klart')}</span></div><div class="${s.late ? 'late' : ''}"><b>${s.late}</b><span>${tr('försenade')}</span></div></div>
      <div class="pg-gate">${gateLine}</div>
      ${(() => { const m = planGateMargin(pl); if (!m) return ''; const x = marginTxt(m); return `<button class="pg-crit ${x.cls}" data-crit="${esc(pl.id)}" title="${esc(x.why)}">⏳ <b>${x.val}</b> ${tr('till {gate}', { gate: esc(m.gate.code) })} · <span>${x.sub}</span></button>`; })()}
      ${sg && sg.mode !== 'none' ? pgGateModeHTML(sg) : ''}
      ${statusDotsHTML(pl)}
      ${(() => { const t = [pr.pcode, pr.sc].filter(Boolean); return t.length ? `<div class="pg-meta pg-proj">🏷 ${esc(t.join(' · '))}</div>` : ''; })()}
      <div class="pg-meta">${tr('Senast importerad')} ${pl.imported_at ? fmtDayY(toDay(pl.imported_at.slice(0, 10))) : '–'}</div>
      ${ctx.suggestMain ? `<div class="pg-suggest">☆ ${tr('Kan bli huvudplan för {l1} – delprojekten ärver då dess gater.', { l1: esc(pr.l1) })} <button class="btn ghost small" data-mkmain="${esc(pl.id)}">${tr('Gör till huvudplan')}</button></div>` : ''}
      <div class="pg-actions"><button class="btn ghost small" data-open="${esc(pl.id)}">${tr('Öppna plan')}</button><button class="btn ghost small" data-rm="${esc(pl.id)}">${tr('Ta bort ur programmet')}</button></div>
    </div>`;
}
// Delprojektets gater: ärvda, egna (med avvikelser mot huvudplanen) eller inga
function pgGateModeHTML(sg) {
  if (sg.mode === 'none') return `<div class="pg-inh none">${tr('Stödprojekt – visas utan gater')}</div>`;
  if (sg.mode === 'inherited') return `<div class="pg-inh">◇ ${tr('Gater ärvda från huvudplanen')}</div>`;
  if (sg.mode === 'own') {
    const cmp = sg.gates.some(g => g.mainWeek);
    return `<div class="pg-inh own">${tr('Egna gater')}${!cmp ? '' : sg.deviating.length
      ? ` · <span class="dev">${tr('avviker från huvudplanen:')} ${sg.deviating.map(g => `${esc(g.code)} ${g.diffW > 0 ? '+' : '−'}${Math.abs(g.diffW)} ${tr('v')}`).join(', ')}</span>`
      : ' · ' + tr('samma som huvudplanen')}</div>`;
  }
  return `<div class="pg-inh none">${tr('Inga gater – ingen huvudplan att ärva från')}</div>`;
}
// Huvudprojektet: sammanfattningskort (antal delprojekt, sämsta hälsa, nästa gemensamma gate, huvudplanens gater) och delprojektens kort
function pgGroupHTML(g) {
  const s = groupSummary(g, todayDay());
  const chips = (g.main ? datedGates(planGateMap(g.main)) : []).map(x => `<span class="pg-gchip ${x.act || x.gs === 'done' ? 'done' : ''}" style="--ph:${pgGateColor(x.code)};--ph-ink:${inkOn(pgGateColor(x.code))}" title="${esc(x.name)} · ${fmtDayY(x.day)}"><b>${esc(x.code)}</b> ${x.week}</span>`).join('');
  const hcol = s.health ? ST_COL[s.health] : null;
  const next = s.next ? `<b>${esc(s.next.code)}</b> ${fmtDayY(s.next.day)} · ${s.next.week}` : '–';
  const follow = s.next ? [s.follow.length ? tr('{n} följer', { n: s.follow.length }) : '', s.deviate.length ? `<span class="dev" title="${s.deviate.map(d => `${esc(d.plan.name)} ${d.diffW > 0 ? '+' : '−'}${Math.abs(d.diffW)} ${tr('v')}`).join(', ')}">${tr('{n} avviker', { n: s.deviate.length })}: ${s.deviate.map(d => `${d.diffW > 0 ? '+' : '−'}${Math.abs(d.diffW)} ${tr('v')}`).join(', ')}</span>` : ''].filter(Boolean).join(' · ') : '';
  const cand = g.main ? [] : g.plans;
  const sum = `<div class="pg-card pg-sum">
      <div class="pg-kicker">${tr('Huvudprojekt')}</div>
      <h3>${esc(g.l1)}</h3>
      <div class="pg-stats"><div><b>${s.n}</b><span>${tr('delprojekt')}</span></div>
        <div><b>${hcol ? `<i class="pg-hdot" style="background:${hcol}"></i>${tr(ST_TXT[s.health])}` : '–'}</b><span>${tr('sämsta hälsa')}</span></div>
        <div><b>${s.next ? esc(s.next.code) : '–'}</b><span>${tr('nästa gemensamma gate')}</span></div></div>
      ${g.main ? `<div class="pg-next">${tr('Nästa gemensamma gate:')} ${next}${follow ? `<br>${follow}` : ''}</div>
        ${chips ? `<div class="pg-gchips" title="${tr('Huvudplanens gater')}">${chips}</div>` : `<div class="pg-meta">${tr('Huvudplanen har inga gater med datum ännu.')}</div>`}`
        : `<div class="pg-suggest">${tr('Ingen huvudplan – välj vilken plan som äger de gemensamma gaterna.')} ${cand.map(x => `<button class="btn ghost small" data-mkmain="${esc(x.id)}">${tr('Gör {name} till huvudplan', { name: esc(x.name) })}</button>`).join(' ')}</div>`}
      <div class="pg-actions">${g.main ? `<button class="btn small" data-newsub="${esc(g.key)}">${tr('＋ Nytt delprojekt')}</button><button class="btn ghost small" data-open="${esc(g.main.id)}">${tr('Öppna huvudplan')}</button>` : ''}</div>
    </div>`;
  const subs = [g.main ? pgCardHTML(g.main, { isMain: true }) : '', ...g.subs.map(x => pgCardHTML(x, { sub: true, main: g.main }))].join('');
  return `<section class="pg-group" data-grp="${esc(g.key)}">${sum}<div class="pg-subgrid">${subs}</div></section>`;
}

// Markera planen som huvudplan för sitt huvudprojekt (nivå 1). En annan huvudplan i samma huvudprojekt blir delprojekt.
async function setMainPlan(pl, on = true) {
  if (!pl) return;
  const pr = { ...planProject(pl) };
  if (on && !pr.l1) return toast(tr('Fyll i Nivå 1 (huvudprojekt) i Projektuppgifter först – huvudprojektet känns igen på den'));
  const others = on ? allPlans.filter(x => x !== pl && isMainPlan(x) && l1Key(x) === l1Key(pl)) : [];
  const ok = await dialog({ title: on ? tr('Gör till huvudplan?') : tr('Inte längre huvudplan?'), buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: on ? tr('Gör till huvudplan') : tr('Ta bort markeringen'), value: true }],
    body: on ? `<p>${tr('{name} blir huvudplan för {l1}. Huvudplanens gater är huvudprojektets gater – delprojekt utan egna gater visar dem som ärvda.', { name: `<b>${esc(pl.name)}</b>`, l1: `<b>${esc(pr.l1)}</b>` })}</p>
      ${others.length ? `<p class="upd-warn">${tr('{name} är huvudplan i dag och blir delprojekt.', { name: others.map(x => esc(x.name)).join(', ') })}</p>` : ''}`
      : `<p>${tr('{name} blir ett vanligt delprojekt i {l1}.', { name: `<b>${esc(pl.name)}</b>`, l1: `<b>${esc(pr.l1)}</b>` })}</p>` });
  if (!ok) return;
  for (const o of others) { const q = { ...planProject(o) }; delete q.role; o.settings.project = q; await savePlanNow(o); }
  if (on) pr.role = 'main'; else delete pr.role;
  pl.settings.project = pr;
  await savePlanNow(pl);
  render();
  toast(on ? tr('{name} är huvudplan för {l1}', { name: pl.name, l1: pr.l1 }) : tr('{name} är inte längre huvudplan', { name: pl.name }));
}

// Lägg en ny plan i programmet (utan dialog – planen skapades av användaren själv)
async function addPlanToProgramNow(pr, pl) {
  if (!pr || !pl || pr.plans.some(x => x.planId === pl.id)) return false;
  pr.plans.push({ planId: pl.id, addedAt: new Date().toISOString() });
  dailyVersion('program', pr);
  try { await ProgStore.update(pr.id, programRow(pr)); return true; } catch (e) { toast(tr('Kunde inte spara programmet: ') + e.message); return false; }
}
// Program där huvudprojektet (samma nivå 1) redan finns
function programsOfL1(pl) {
  const k = l1Key(pl);
  return k ? programs.filter(pr => pr.plans.some(r => { const x = allPlans.find(p => p.id === r.planId); return x && x !== pl && l1Key(x) === k; })) : [];
}
// Ny plan skapad som delprojekt: lägg den i programmet där huvudprojektet finns
async function afterSubPlanCreated(np, pr) {
  const target = pr || programsOfL1(np)[0];
  if (target && await addPlanToProgramNow(target, np)) toast(tr('{name} är tillagd i programmet {prog}', { name: np.name, prog: target.name }));
}

// ＋ Nytt delprojekt: Ny plan från mall med huvudplanens gate-veckor och projektuppgifter
function newSubproject(g) {
  if (!g || !g.main) return;
  const gates = {};
  datedGates(planGateMap(g.main)).forEach(x => { gates[x.code] = x.week; });
  const project = { ...planProject(g.main) };
  delete project.role; delete project.gates; delete project.l2; delete project.pm;
  const pr = program;
  openTemplateDialog('new', { name: '', placeholder: tr('Delprojektets namn'), gates, project, l2FromName: true, allowEmpty: true,
    note: tr('Nytt delprojekt i {l1}. Gate-veckorna är huvudplanens – ändra dem om delprojektet har egna gater, eller töm dem så ärver delprojektet huvudplanens.', { l1: esc(g.l1) }),
    after: np => afterSubPlanCreated(np, pr) });
}

/* =========================================================
   Huvudprojekt och delprojekt (#67)
   Hierarkin kommer från Projektuppgifter (settings.project): program → nivå 1 (huvudprojekt) → nivå 2 (delprojekt).
   En plan per huvudprojekt är huvudplan (settings.project.role = 'main') och äger de gemensamma gaterna.
   Delprojekt utan egna gater visar huvudplanens, märkta "ärvd". settings.project.gates: '' = egna om planen har
   gater med datum, annars huvudplanens · 'inherit' = alltid huvudplanens · 'none' = stödprojekt utan gater (IT, Facility).
   Rena funktioner nedan testas i test/delprojekt.test.mjs.
   ========================================================= */
// Gaterna med datum ur planGateMap, i datumordning
const datedGates = m => Object.values(m || {}).filter(g => !g.undated && g.day != null).sort((a, b) => a.day - b.day);
const l1Key = pl => normName(planProject(pl).l1 || '');
const isMainPlan = pl => planProject(pl).role === 'main';
// Planerna grupperade per huvudprojekt (nivå 1), i listans ordning. En grupp har en huvudplan eller minst två planer
// med samma nivå 1; övriga planer står för sig ({ plan }).
function projectGroups(list) {
  const by = new Map(), out = [];
  for (const pl of list || []) {
    if (!pl) continue;
    const k = l1Key(pl);
    if (!k) { out.push({ plan: pl }); continue; }
    if (!by.has(k)) { const g = { key: k, l1: planProject(pl).l1, plans: [] }; by.set(k, g); out.push(g); }
    by.get(k).plans.push(pl);
  }
  return out.map(g => {
    if (g.plan) return g;
    const main = g.plans.find(isMainPlan) || null;
    if (!main && g.plans.length < 2) return { plan: g.plans[0] };
    return { key: g.key, l1: g.l1, main, subs: g.plans.filter(p => p !== main), plans: g.plans };
  });
}
// Huvudplanen för planens huvudprojekt (samma nivå 1, role 'main'), eller null. En huvudplan har ingen huvudplan.
function mainPlanOf(pl, list) {
  const k = l1Key(pl);
  if (!k || isMainPlan(pl)) return null;
  return (list || []).find(x => x && x !== pl && isMainPlan(x) && l1Key(x) === k) || null;
}
// Delprojektets gater: egna, ärvda från huvudplanen eller inga (stödprojekt). diffW = egen vecka − huvudplanens (hela veckor).
// mode: 'own' | 'inherited' | 'none' (stödprojekt) | 'empty' (inga egna och ingen huvudplan med gater)
function subGates(pl, main) {
  const setting = planProject(pl).gates || '';
  if (setting === 'none') return { mode: 'none', gates: [], deviating: [] };
  const own = datedGates(planGateMap(pl)), mg = main && main !== pl ? planGateMap(main) : {};
  const mk = (g, src) => ({ code: g.code, day: g.day, week: g.week, src, act: g.act || null, gs: g.gs || null, taskId: g.taskId, name: g.name });
  if (setting === 'inherit' || !own.length) {
    const gates = datedGates(mg).map(g => mk(g, 'inherited'));
    return { mode: gates.length ? 'inherited' : 'empty', gates, deviating: [] };
  }
  const gates = own.map(g => {
    const x = mg[pgKey(g.code)], m = x && !x.undated && x.day != null ? x : null;
    return { ...mk(g, 'own'), mainWeek: m ? m.week : null, diffW: m ? wkDiff(g.day, m.day) : null };
  });
  return { mode: 'own', gates, deviating: gates.filter(g => g.diffW) };
}
// Senaste veckostatusens totala hälsa för en plan (G/Y/R eller null)
const planHealth = pl => {
  const st = ((pl && pl.settings && pl.settings.status) || []).slice().sort((a, b) => String(a.week).localeCompare(String(b.week)));
  return statusOverall(st[st.length - 1] || null);
};
// Sammanfattning för huvudprojektet: antal delprojekt, sämsta hälsa och nästa gemensamma gate (huvudplanens nästa gate
// som inte passerats) med hur många delprojekt som följer den och vilka som avviker.
function groupSummary(g, today) {
  const all = [g.main, ...g.subs].filter(Boolean);
  const health = worstOf(all.map(planHealth));
  let next = null;
  if (g.main) {
    const x = datedGates(planGateMap(g.main)).find(y => !y.act && y.gs !== 'done' && y.day >= today);
    if (x) next = { code: x.code, day: x.day, week: x.week };
  }
  const follow = [], deviate = [], own = [];
  if (next) for (const s of g.subs) {
    const sg = subGates(s, g.main);
    if (sg.mode === 'inherited') follow.push(s);
    else if (sg.mode === 'own') {
      const x = sg.gates.find(y => pgKey(y.code) === pgKey(next.code));
      if (!x) own.push(s); else if (x.diffW) deviate.push({ plan: s, diffW: x.diffW, week: x.week }); else follow.push(s);
    }
  }
  return { n: g.subs.length, health, next, follow, deviate, own };
}

/* =========================================================
   Programgater och gate-översikt (#21)
   program.milestones = [{ id, code, name, date (ISO; fredag när veckan anges), week (ÅÅVV), status, note }] – programmets egna gater.
   Programmet äger samordningen och ändrar aldrig planerna (#16). Gate-översikten jämför varje projekts gate med programgaten
   med samma kod: planens egna gater (planGates, #75). Delprojekt utan egna gater
   visar huvudplanens (ärvda, #67). Rena funktioner, tester i test/programgater.test.mjs.
   ========================================================= */
const PG_STATUS = ['notstarted', 'ontrack', 'atrisk', 'offtrack', 'done'];
const PG_GATES_MAX = 40;
const pgKey = c => String(c || '').replace(/\s+/g, ' ').trim().toUpperCase();
// Bara giltiga programgater: kod krävs och är unik (utan skiftläge), datum från date (ISO) eller week (ÅÅVV → fredag),
// status i PG_STATUS (annars notstarted). Sorterade på datum; gater utan datum sist.
function cleanProgramGates(list) {
  if (!Array.isArray(list)) return [];
  const out = [], keys = new Set(), ids = new Set();
  for (const g of list.slice(0, PG_GATES_MAX)) {
    if (!g || typeof g !== 'object') continue;
    const code = gTxt(g.code, 24), k = pgKey(code);
    if (!code || keys.has(k)) continue;
    let day = typeof g.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.date) && fromDay(toDay(g.date)) === g.date ? toDay(g.date) : null;
    if (day == null && g.week != null && String(g.week).trim()) day = parseWeek(String(g.week), true);
    let id = gId(g.id); if (!id || ids.has(id)) id = 'pg' + gateSlug(code).slice(1);
    while (ids.has(id)) id += 'x';
    keys.add(k); ids.add(id);
    out.push({ id, code, name: gTxt(g.name, 120), date: day == null ? null : fromDay(day), week: day == null ? null : fmtYYWW(day),
      status: PG_STATUS.includes(g.status) ? g.status : 'notstarted', note: gTxt(g.note, 500) });
  }
  const at = g => g.date ? toDay(g.date) : 1e9;
  return out.map((g, i) => [g, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(x => x[0]);
}
const pgActOf = t => t && t.actual ? { day: toDay(t.actual.day), week: t.actual.week, src: t.actual.src } : null;
// Planens gater per kod (pgKey): planens egna eller härledda gater med sin milstolpe
function planGateMap(pl) {
  const out = {};
  const gates = planGates(pl), tasks = (pl && pl.tasks) || [];
  for (const g of gates) {
    const k = pgKey(g.code); if (!k || out[k]) continue;
    const t = gateMsOf(tasks, gates, g), d = t ? toDay(t.end || t.start) : null;
    out[k] = { code: g.code, day: d, week: d == null ? null : fmtYYWW(d), undated: d == null, gate: !!(t && t.gate), taskId: t ? t.id : null,
      name: t ? t.name : g.name, act: pgActOf(t), gs: (t && t.goalStatus) || null };
  }
  return out;
}
const pgHasDated = m => Object.values(m).some(g => !g.undated && g.day != null);
// Var projektets gater kommer ifrån (som subGates, #67): 'none' stödprojekt · 'inherited' huvudplanens · 'own' · 'empty'
function gateSource(pl, main) {
  const setting = planProject(pl).gates || '';
  if (setting === 'none') return { mode: 'none', map: {} };
  const own = planGateMap(pl);
  if (main && main !== pl && (setting === 'inherit' || !pgHasDated(own))) {
    const mm = planGateMap(main);
    if (pgHasDated(mm)) return { mode: 'inherited', map: mm, from: main };
  }
  return { mode: Object.keys(own).length ? 'own' : 'empty', map: own };
}
// Cellens läge: missing (grå: gaten saknas eller saknar datum) · done (grön: klar eller utfall) · late (röd: minst en vecka efter
// programgaten eller Ur fas) · near (orange: senare än programgaten inom samma vecka, I riskzonen eller passerad utan utfall) ·
// ok (grön: i tid) · nopg (ingen programgate med samma kod – ingen avvikelse)
function gateCellState(c) {
  if (!c || c.undated || c.day == null) return 'missing';
  if (c.done) return 'done';
  if (c.gs === 'offtrack' || (c.devW != null && c.devW >= 1)) return 'late';
  if ((c.devD != null && c.devD > 0) || c.gs === 'atrisk' || c.overdue) return 'near';
  return c.devW == null ? 'nopg' : 'ok';
}
const PG_DEV_STATES = new Set(['late', 'near']);
const GATE_STATE_TXT = { late: 'Efter programgaten', near: 'Nära eller i riskzonen', ok: 'I tid', done: 'Klar', missing: 'Saknas', nopg: 'Ingen programgate' };
// Gate-översikten: rader = projekten (huvudprojekt → huvudplan och delprojekt, #67), kolumner = gate-koder (programgaterna och
// projektens), celler med vecka, utfall, status och avvikelse mot programgaten i hela veckor (devW, + = projektet ligger senare).
// opts.today (dag), opts.changed (changedDeps, #22): cellen för gaten som följer efter den påverkade aktiviteten får alerts.
function gateMatrix(program, plansById, opts = {}) {
  const get = id => plansById instanceof Map ? plansById.get(id) : (plansById || {})[id];
  const today = opts.today != null ? opts.today : todayDay();
  const refs = (program && program.plans) || [];
  const gates = cleanProgramGates(program && program.milestones), pgBy = new Map(gates.map(g => [pgKey(g.code), g]));
  const list = refs.map(r => get(r.planId)).filter(Boolean);
  const rows = [], srcs = [];
  const add = (pl, main, type, level) => {
    const s = gateSource(pl, main);
    const r = { type, planId: pl.id, name: pl.name, level, mode: s.mode, from: s.from ? s.from.name : null, fromId: s.from ? s.from.id : null, cells: {}, alerts: [] };
    rows.push(r); srcs.push([r, s]);
  };
  for (const g of projectGroups(list)) {
    if (g.plan) { add(g.plan, null, 'plan', 0); continue; }
    rows.push({ type: 'group', key: g.key, name: g.l1, n: g.subs.length, mainId: g.main ? g.main.id : null, level: 0, cells: {}, alerts: [] });
    if (g.main) add(g.main, null, 'main', 1);
    for (const s of g.subs) add(s, g.main, 'sub', 1);
  }
  // Kolumner: koderna efter tidigaste datum (programgaten eller något projekt)
  const codes = new Map(), first = new Map();
  const note = (k, code, day) => { if (!codes.has(k)) codes.set(k, code); if (day != null && (!first.has(k) || day < first.get(k))) first.set(k, day); };
  gates.forEach(g => note(pgKey(g.code), g.code, g.date ? toDay(g.date) : null));
  srcs.forEach(([, s]) => Object.entries(s.map).forEach(([k, e]) => note(k, e.code || k, e.day)));
  const cols = [...codes.keys()].sort((a, b) => (first.get(a) ?? 1e9) - (first.get(b) ?? 1e9))
    .map(k => ({ key: k, code: codes.get(k), pg: pgBy.get(k) || null }));
  for (const [r, s] of srcs) {
    for (const col of cols) {
      const e = s.map[col.key], pgDay = col.pg && col.pg.date ? toDay(col.pg.date) : null;
      const base = { key: col.key, code: col.code, pgWeek: col.pg ? col.pg.week : null, pgStatus: col.pg ? col.pg.status : null, alerts: [] };
      if (!e) { r.cells[col.key] = { ...base, state: col.pg && s.mode !== 'none' ? 'missing' : 'none', inherited: s.mode === 'inherited' }; continue; }
      const done = !!e.act || e.gs === 'done', cmp = e.act && e.act.day != null ? e.act.day : e.day;
      const c = { ...base, day: e.day, week: e.week, undated: !!e.undated || e.day == null, inherited: s.mode === 'inherited', from: r.from,
        act: e.act || null, gs: e.gs || null, done, taskId: e.taskId || null, name: e.name || '',
        devW: cmp != null && pgDay != null ? wkDiff(cmp, pgDay) : null, devD: cmp != null && pgDay != null ? cmp - pgDay : null,
        overdue: !done && e.day != null && e.day < today };
      c.state = gateCellState(c);
      r.cells[col.key] = c;
    }
  }
  // Beroenden som påverkats av en uppdatering (#22): raden och gaten efter aktiviteten (eller aktiviteten själv om den är gaten)
  const changed = opts.changed ? [...(typeof opts.changed.values === 'function' ? opts.changed.values() : opts.changed)] : [];
  for (const it of changed) for (const side of [it.from, it.to]) {
    if (!side) continue;
    const r = rows.find(x => x.planId === side.planId); if (!r) continue;
    const pl = get(side.planId), t = pl && (pl.tasks || []).find(x => x.id === side.taskId);
    const a = { depId: it.depId, status: it.after ? it.after.status : null, deltaDays: it.deltaDays ?? null, task: side.task || (t ? t.name : ''), planName: it.planName || '', at: it.at || null };
    if (!r.alerts.some(x => x.depId === a.depId)) r.alerts.push(a);
    const end = t ? toDay(t.end || t.start) : null;
    const dated = cols.map(c => r.cells[c.key]).filter(c => c && c.day != null).sort((x, y) => x.day - y.day);
    const cell = dated.find(c => c.taskId === side.taskId) || (end != null ? dated.find(c => c.day >= end) : null);
    if (cell && !cell.alerts.some(x => x.depId === a.depId)) cell.alerts.push(a);
  }
  // Gater som glidit förbi programgaten vid en uppdatering (#99): rutan får slip
  if (opts.slips) for (const r of rows) if (r.type !== 'group') for (const c of Object.values(r.cells)) {
    const sl = opts.slips.get(r.planId + '|' + c.key); if (sl) c.slip = sl;
  }
  const summary = { late: 0, near: 0, ok: 0, done: 0, missing: 0, nopg: 0 };
  for (const r of rows) {
    if (r.type === 'group') continue;
    const cs = Object.values(r.cells);
    r.dev = cs.filter(c => PG_DEV_STATES.has(c.state)).length;
    r.late = cs.filter(c => c.state === 'late').length;
    cs.forEach(c => { if (summary[c.state] != null) summary[c.state]++; });
  }
  rows.forEach((r, i) => {
    if (r.type !== 'group') return;
    const kids = [];
    for (let j = i + 1; j < rows.length && rows[j].type !== 'group' && rows[j].level === 1; j++) kids.push(rows[j]);
    r.kids = kids.map(k => k.planId); r.dev = kids.reduce((a, k) => a + k.dev, 0); r.late = kids.reduce((a, k) => a + k.late, 0);
    r.alerts = kids.flatMap(k => k.alerts);
  });
  return { cols, rows, gates, missing: refs.length - list.length, summary };
}
/* ---------- Varning när en projektgate glider förbi programgaten (#99) ----------
   Samma regel som gate-översikten: gaten ligger efter uppdateringen minst en vecka efter programgaten med samma kod och låg tidigare i tid
   eller ligger nu ännu längre efter. gateMatrix före och efter, så att delprojekt som ärver huvudplanens gater också kommer med. */
function gateImpact(programs, plansById, planId, newTasks, today = todayDay()) {
  const before = plansById instanceof Map ? plansById : new Map(Object.entries(plansById || {}));
  const old = before.get(planId); if (!old) return [];
  const after = new Map(before); after.set(planId, { ...old, tasks: newTasks });
  const out = [];
  for (const pg of programs || []) {
    if (!pg || (pg.settings || {}).deleted_at || !(pg.plans || []).some(r => r.planId === planId) || !cleanProgramGates(pg.milestones).length) continue;
    const mb = gateMatrix(pg, before, { today }), ma = gateMatrix(pg, after, { today });
    for (const r of ma.rows) {
      if (r.type === 'group' || (r.planId !== planId && r.fromId !== planId)) continue;
      const rb = mb.rows.find(x => x.planId === r.planId);
      for (const [k, c] of Object.entries(r.cells)) {
        if (c.devW == null || c.devW < 1 || c.done) continue;
        const b = rb && rb.cells[k];
        if (b && b.devW != null && b.devW >= c.devW) continue;
        out.push({ programId: pg.id, program: pg.name, planId: r.planId, plan: r.name, key: k, code: c.code, pgWeek: c.pgWeek, inherited: !!c.inherited,
          before: b && b.week ? { week: b.week, devW: b.devW } : null, after: { week: c.week, devW: c.devW } });
      }
    }
  }
  return out.sort((x, y) => y.after.devW - x.after.devW);
}
// Filtret Bara avvikelser: projekt med någon röd eller orange cell; huvudprojektets rad följer med när något av dess projekt visas
function gateRowsShown(rows, onlyDev) {
  if (!onlyDev) return rows;
  const out = []; let grp = null;
  for (const r of rows) {
    if (r.type === 'group') { grp = r; continue; }
    if (r.level === 0) grp = null;
    if (!r.dev) continue;
    if (grp) { out.push(grp); grp = null; }
    out.push(r);
  }
  return out;
}
// Avvikelse som text: "+2 v", "−1 v", "±0 v"
const fmtDevW = w => w == null ? '' : w === 0 ? `±0 ${tr('v')}` : `${w > 0 ? '+' : '−'}${Math.abs(w)} ${tr('v')}`;
// Gate-översikten som tabell för Excel (som #57: veckor som tal ÅÅVV, avvikelse i hela veckor)
function gateMatrixAoa(m, programName, today) {
  const num = w => w && /^\d{4}$/.test(String(w)) ? +w : '';
  const head = [tr('Projekt'), tr('Huvudprojekt'), tr('Gater')], pgRow = [tr('Programgate'), '', ''];
  for (const c of m.cols) {
    head.push(`${c.code} ${tr('plan')}`, `${c.code} ${tr('utfall')}`, `${c.code} ${tr('avvikelse (v)')}`, `${c.code} ${tr('läge')}`);
    pgRow.push(c.pg ? num(c.pg.week) : '', '', '', c.pg ? tr(GOAL_STATUS_TXT[c.pg.status]) : '');
  }
  const body = []; let grp = '';
  for (const r of m.rows) {
    if (r.type === 'group') { grp = r.name; continue; }
    if (r.level === 0) grp = '';
    const src = r.mode === 'inherited' ? tr('ärvda från {name}', { name: r.from }) : r.mode === 'none' ? tr('stödprojekt') : r.type === 'main' ? tr('huvudplan') : '';
    const line = [r.name, grp, src];
    for (const c of m.cols) { const x = r.cells[c.key] || {}; line.push(num(x.week), num(x.act && x.act.week), x.devW ?? '', x.state && x.state !== 'none' ? tr(GATE_STATE_TXT[x.state]) : ''); }
    body.push(line);
  }
  return [[tr('Program'), programName], [tr('Exporterad'), fromDay(today)], [], head, pgRow, ...body];
}

/* ---------- Programgater och gate-översikt (#21): visning ----------
   Översikten och Gantt visar programgaterna, fliken Gater (ui.pgView = 'gates', #gatesView) tabellen projekt × gater.
   ⋯ → 🚩 Programgater… (openProgramGates) ändrar program.milestones. */
let gxSel = null; // vald cell { plan, key }
const pgGateColor = () => '#5a6e8c';
const PG_ST_COL = { notstarted: '#8a8a8a', ontrack: '#1a9e5a', atrisk: '#d97706', offtrack: '#d03b3b', done: '#1a9e5a' };
function pgGateTip(g) {
  return [`${g.code}${g.name ? ' – ' + g.name : ''}`, g.date ? `${fmtDayY(toDay(g.date))} (${g.week})` : tr('utan datum'), tr(GOAL_STATUS_TXT[g.status]), g.note || ''].filter(Boolean).join(' · ');
}
// Programgaterna som chips (översikten och fliken Gater)
function pgGateChipsHTML(p, inGates = false) {
  const gs = cleanProgramGates(p.milestones), edit = !inGates; // i fliken Gater finns knappen i verktygsraden
  if (!gs.length) return edit ? `<div class="pg-gates pg-gates-none"><span class="pg-gates-h">🚩 ${tr('Programgater')}</span><span>${tr('Programmet har inga programgater än.')}</span><button class="btn ghost small" data-pgates>${tr('🚩 Programgater…')}</button></div>` : inGates ? `<div class="pg-gates pg-gates-none"><span class="pg-gates-h">🚩 ${tr('Programgater')}</span><span>${tr('Programmet har inga programgater än.')}</span></div>` : '';
  return `<div class="pg-gates"><span class="pg-gates-h">🚩 ${tr('Programgater')}</span>${gs.map(g => `<button class="pg-gchip pgc st-${g.status}" data-gogates style="--ph:${pgGateColor(g.code)}" title="${esc(pgGateTip(g))}"><i class="pgc-dot" style="background:${PG_ST_COL[g.status]}"></i><b>${esc(g.code)}</b> ${g.week || tr('utan datum')}</button>`).join('')}
    ${edit ? `<button class="btn ghost small" data-pgates title="${tr('Ändra programgaterna')}">✎</button>` : ''}</div>`;
}
function wirePgGateChips(el) {
  el.addEventListener('click', e => {
    if (e.target.closest('[data-pgates]')) openProgramGates();
    else if (e.target.closest('[data-gogates]')) { ui.pgView = 'gates'; saveUi(); render(true); }
  });
}
const gxMatrix = () => gateMatrix(program, new Map(allPlans.map(x => [x.id, x])), { today: todayDay(), changed: changedDeps(program, seenKey()), slips: changedGates(program, seenKey()) });
// Cellens tooltip och detaljer
function gxCellTip(r, c) {
  if (c.state === 'missing') return c.undated ? tr('{code}: gaten saknar datum i planen', { code: c.code }) : tr('{code}: planen har ingen sådan gate', { code: c.code });
  return [`${c.code} ${c.week}${c.inherited ? ' – ' + tr('ärvd från {name}', { name: c.from }) : ''}`, c.act ? tr('utfall {w}', { w: c.act.week }) : '', c.gs ? tr('Status i Planner') + ': ' + goalStatusTxt(c.gs) : '',
    c.pgWeek ? tr('programgate {w}', { w: c.pgWeek }) + ` · ${tr('avvikelse')} ${fmtDevW(c.devW)}` : tr('Ingen programgate'), tr(GATE_STATE_TXT[c.state]),
    c.alerts.length ? '⚠ ' + tr('{n} påverkade beroenden', { n: c.alerts.length }) : '',
    c.slip ? '⚠ ' + tr('glidit förbi programgaten vid uppdateringen') : ''].filter(Boolean).join(' · ');
}
function gxCellHTML(r, c) {
  if (!c || c.state === 'none') return `<td class="gx-c gx-none">${r.mode === 'none' ? '–' : ''}</td>`;
  const sel = gxSel && gxSel.plan === r.planId && gxSel.key === c.key ? ' sel' : '', at = `data-plan="${esc(r.planId)}" data-key="${esc(c.key)}" title="${esc(gxCellTip(r, c))}"`;
  if (c.state === 'missing') return `<td class="gx-c gs-missing${sel}" ${at}><small>${c.undated ? tr('utan datum') : tr('saknas')}</small></td>`;
  const sub = [c.act ? tr('utfall {w}', { w: c.act.week }) : '', c.gs ? goalStatusTxt(c.gs) : ''].filter(Boolean).join(' · ');
  const warn = c.alerts.length || c.slip;
  return `<td class="gx-c gs-${c.state}${c.inherited ? ' inh' : ''}${warn ? ' alert' : ''}${sel}" ${at}>
    <span class="gx-wk">${c.week}</span>${warn ? '<span class="gx-alert">⚠</span>' : ''}${c.devW != null ? `<span class="gx-dev">${fmtDevW(c.devW)}</span>` : ''}${sub ? `<small>${esc(sub)}</small>` : ''}</td>`;
}
function gxDetailHTML(m) {
  if (!gxSel) return `<div class="ld-hint">${tr('Klicka på en ruta för detaljer. Klicka på projektets namn för att öppna planen.')}</div>`;
  const r = m.rows.find(x => x.planId === gxSel.plan), c = r && r.cells[gxSel.key], col = m.cols.find(x => x.key === gxSel.key);
  if (!c || c.state === 'none') { gxSel = null; return gxDetailHTML(m); }
  const pg = col && col.pg, row = (k, v) => v ? `<tr><th>${k}</th><td>${v}</td></tr>` : '';
  return `<h3>${esc(r.name)} · ${esc(c.code)} <span class="gx-tag gs-${c.state}">${tr(GATE_STATE_TXT[c.state])}</span></h3>
    <table class="ld-tasks gx-det">
      ${row(tr('Gate i planen'), c.state === 'missing' ? (c.undated ? tr('Gaten saknar datum i planen') : tr('Planen har ingen sådan gate')) : `${esc(c.name)} · ${fmtDayY(c.day)} (${c.week})${c.inherited ? ` · <span class="pg-inh-tag">${tr('ärvd från {name}', { name: esc(c.from) })}</span>` : ''}`)}
      ${row(tr('Utfall'), c.act ? `${c.act.day != null ? fmtDayY(c.act.day) + ' ' : ''}(${c.act.week})` : c.state !== 'missing' ? '–' : '')}
      ${row(tr('Status i Planner'), c.gs ? goalStatusTxt(c.gs) : '')}
      ${row(tr('Programgate'), pg ? `${esc(pg.code)}${pg.name ? ' – ' + esc(pg.name) : ''} · ${pg.date ? `${fmtDayY(toDay(pg.date))} (${pg.week})` : tr('utan datum')} · ${tr(GOAL_STATUS_TXT[pg.status])}${pg.note ? `<br><small>${esc(pg.note)}</small>` : ''}` : tr('Ingen programgate med koden {code}', { code: esc(c.code) }))}
      ${row(tr('Avvikelse'), c.devW != null ? `<b>${fmtDevW(c.devW)}</b> (${c.devD > 0 ? '+' : c.devD < 0 ? '−' : '±'}${Math.abs(c.devD)} d)${c.act ? ' – ' + tr('utfallet jämförs') : ''}` : '')}
      ${c.slip ? row(tr('Glidit förbi programgaten'), `⚠ ${c.slip.before ? `${esc(c.slip.before.week)} (${fmtDevW(c.slip.before.devW)})` : '–'} → <b>${esc(c.slip.after.week)} (${fmtDevW(c.slip.after.devW)})</b> · ${esc(tr('{plan} uppdaterad {when}', { plan: c.slip.planName, when: fmtWhen(c.slip.at) }))}`) : ''}
      ${c.alerts.length ? row(tr('Påverkade beroenden'), c.alerts.map(a => `⚠ ${esc(a.task)} – ${a.status ? tr(DEP_TXT[a.status] || a.status) : ''}${a.deltaDays != null ? ` (${tr('ändring')} ${fmtDW(a.deltaDays)})` : ''}${a.planName ? ` · ${esc(tr('{plan} uppdaterad {when}', { plan: a.planName, when: a.at ? fmtWhen(a.at) : '' }))}` : ''}`).join('<br>')) : ''}
    </table>
    <div class="gx-det-act">${plans.some(p => p.id === r.planId) ? `<button class="btn small" data-openplan="${esc(r.planId)}">${tr('Öppna plan')}</button>` : ''}${c.inherited && c.from && plans.some(p => p.id === r.fromId) ? `<button class="btn ghost small" data-openplan="${esc(r.fromId)}">${tr('Öppna huvudplan')}</button>` : ''}</div>`;
}
function renderGates() {
  const el = $('#gatesView'), p = program;
  if (!p) { el.innerHTML = ''; return; }
  const m = gxMatrix(), rows = gateRowsShown(m.rows, !!ui.pgOnlyDev), nDev = m.rows.filter(r => r.type !== 'group' && r.dev).length;
  const head = m.cols.map(c => `<th class="gx-h" style="--ph:${pgGateColor(c.code)}" title="${esc(c.pg ? pgGateTip(c.pg) : tr('Ingen programgate med koden {code}', { code: c.code }))}"><b>${esc(c.code)}</b>${c.pg ? `<small><i class="pgc-dot" style="background:${PG_ST_COL[c.pg.status]}"></i>${c.pg.week || tr('utan datum')}</small>` : `<small class="gx-nopg">${tr('ingen programgate')}</small>`}</th>`).join('');
  const rowHTML = r => {
    if (r.type === 'group') return `<tr class="gx-grp"><th class="gx-p"><span class="pg-kicker">${tr('Huvudprojekt')}</span> ${esc(r.name)} <small>${tr('{n} delprojekt', { n: r.n })}</small></th><td colspan="${m.cols.length}">${r.late ? `<span class="gx-sum late">${tr(r.late === 1 ? '{n} gate efter programgaten' : '{n} gater efter programgaten', { n: r.late })}</span>` : ''}</td></tr>`;
    const tag = r.type === 'main' ? tr('Huvudplan') : r.mode === 'inherited' ? tr('ärvda gater') : r.mode === 'none' ? tr('stödprojekt') : r.mode === 'empty' ? tr('inga gater') : '';
    return `<tr class="gx-row lvl${r.level}"><th class="gx-p"><a href="#" data-openplan="${esc(r.planId)}" title="${tr('Öppna plan')}">${esc(r.name)}</a>${tag ? ` <span class="ptag">${esc(tag)}</span>` : ''}${r.alerts.length ? ` <span class="gx-alert" title="${esc(tr('{n} påverkade beroenden', { n: r.alerts.length }))}">⚠ ${r.alerts.length}</span>` : ''}</th>
      ${m.cols.map(c => gxCellHTML(r, r.cells[c.key])).join('')}</tr>`;
  };
  el.innerHTML = `<div class="ld-wrap gx-wrap">
    <div class="ld-head"><div><div class="pg-kicker">${tr('Gate-översikt')}</div><h2>${esc(p.name)}</h2></div>
      <div class="ld-sub">${tr('Projektens gater jämförda med programgaten med samma kod. Avvikelsen är i hela veckor – plus betyder att projektet ligger senare.')}</div></div>
    <div id="gxGates">${pgGateChipsHTML(p, true)}</div>
    <div class="ld-ctrl">
      <label class="chk" id="gxOnlyDevLbl"><input type="checkbox" id="gxOnlyDev" ${ui.pgOnlyDev ? 'checked' : ''}> ${tr('Bara avvikelser')} (${nDev})</label>
      <span class="spacer"></span>
      <button class="btn ghost small" id="gxEdit">${tr('🚩 Programgater…')}</button>
      <button class="btn ghost small" id="gxExport" ${m.cols.length ? '' : 'disabled'}>${tr('⬇ Exportera (Excel)')}</button>
    </div>
    <div class="ld-info gx-legend">${tr('{late} efter · {near} nära · {ok} i tid eller klara · {missing} saknas', { late: m.summary.late, near: m.summary.near, ok: m.summary.ok + m.summary.done, missing: m.summary.missing })}
      <span class="ld-legend"><i class="gs-late"></i>${tr('≥ 1 v efter eller ur fas')}<i class="gs-near"></i>${tr('inom 1 v, i riskzonen eller passerad')}<i class="gs-ok"></i>${tr('i tid eller klar')}<i class="gs-missing"></i>${tr('saknas')}<i class="gx-inh-ico"></i>${tr('ärvd')}</span></div>
    ${!m.cols.length ? `<div class="ld-empty">${tr('Varken programmet eller projekten har gater med kod ännu.')}</div>`
    : rows.length ? `<div class="ld-scroll" id="gxScroll"><table class="ld-tbl gx-tbl" id="gxTbl"><thead><tr><th class="ld-p">${tr('Projekt')}</th>${head}</tr></thead><tbody>${rows.map(rowHTML).join('')}</tbody></table></div>`
    : `<div class="ld-empty">${ui.pgOnlyDev ? tr('Inga avvikelser – alla projektens gater ligger i tid mot programgaterna.') : tr('Programmet har inga planer ännu.')}</div>`}
    ${m.missing ? `<div class="ld-info">${tr('{n} planer i programmet finns inte längre.', { n: m.missing })}</div>` : ''}
    <div class="ld-detail" id="gxDetail">${gxDetailHTML(m)}</div>
  </div>`;
  $('#gxOnlyDev').onchange = e => { ui.pgOnlyDev = e.target.checked; saveUi(); renderGates(); };
  $('#gxEdit').onclick = () => openProgramGates();
  $('#gxExport').onclick = () => exportGateMatrix(m);
  wirePgGateChips($('#gxGates'));
  el.onclick = e => {
    const o = e.target.closest('[data-openplan]');
    if (o) { e.preventDefault(); if (!plans.some(x => x.id === o.dataset.openplan)) return toast(tr('Du har inte tillgång till den planen.')); selectPlan(o.dataset.openplan, true); return; }
    const td = e.target.closest('td.gx-c[data-key]');
    if (td) { const k = { plan: td.dataset.plan, key: td.dataset.key }; gxSel = gxSel && gxSel.plan === k.plan && gxSel.key === k.key ? null : k; renderGates(); }
  };
}
function exportGateMatrix(m) {
  if (!window.XLSX) return toast(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
  const aoa = gateMatrixAoa(m, program.name, todayDay());
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [34, 22, 22, ...m.cols.flatMap(() => [9, 9, 12, 20])].map(w => ({ wch: w }));
  const gs = XLSX.utils.aoa_to_sheet([[tr('Kod'), tr('Namn'), tr('Datum'), tr('Vecka'), tr('Status'), tr('Anteckning')],
    ...m.gates.map(g => [g.code, g.name, g.date || '', g.week ? +g.week : '', tr(GOAL_STATUS_TXT[g.status]), g.note])]);
  gs['!cols'] = [10, 30, 12, 8, 14, 40].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tr('Gate-översikt').slice(0, 31)); XLSX.utils.book_append_sheet(wb, gs, tr('Programgater').slice(0, 31));
  const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), fname = `${tr('Gate-översikt')} – ${program.name} ${fromDay(todayDay())}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  if (canDownload()) { const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); toast(tr('Gate-översikten är exporterad')); }
  else if (window.open(url, '_blank')) toast(tr('Exporten öppnades i en ny flik'));
  else toast(tr('Webbläsaren blockerade exporten'));
}
// ⋯ → 🚩 Programgater…: kod, namn, vecka eller datum, status och anteckning per programgate
function openProgramGates() {
  if (ui.mode !== 'program' || !program) return toast(tr('Öppna ett program först'));
  const p = program;
  const work = cleanProgramGates(p.milestones).map(g => ({ ...g }));
  const draw = () => {
    const box = $('#pgtBody'); if (!box) return;
    box.innerHTML = `<p class="tpl-hint">${tr('Programmets egna gater med fri kod, t.ex. G1–G4. Gate-översikten jämför projektens gater med programgaten med samma kod. Projektens planer ändras inte.')}</p>
      ${work.length ? `<div class="pgt-list"><div class="pgt-row pgt-head"><span>${tr('Kod')}</span><span>${tr('Namn')}</span><span>${tr('Vecka')}</span><span>${tr('Datum')}</span><span>${tr('Status')}</span><span>${tr('Anteckning')}</span><span></span></div>
      ${work.map((g, i) => `<div class="pgt-row" data-i="${i}">
        <input type="text" class="pgt-code" data-f="code" value="${esc(g.code)}" maxlength="24" placeholder="${tr('Kod')}" aria-label="${tr('Kod')}">
        <input type="text" data-f="name" value="${esc(g.name)}" maxlength="120" placeholder="${tr('Namn')}" aria-label="${tr('Namn')}">
        <input type="text" class="pgt-week" data-f="week" value="${esc(g.week || '')}" maxlength="10" placeholder="2645" aria-label="${tr('Vecka (ÅÅVV)')}">
        <input type="date" data-f="date" value="${esc(g.date || '')}" aria-label="${tr('Datum')}">
        <select data-f="status" aria-label="${tr('Status')}">${PG_STATUS.map(s => `<option value="${s}" ${g.status === s ? 'selected' : ''}>${tr(GOAL_STATUS_TXT[s])}</option>`).join('')}</select>
        <input type="text" data-f="note" value="${esc(g.note || '')}" maxlength="500" placeholder="${tr('Anteckning')}" aria-label="${tr('Anteckning')}">
        <button class="icon-btn" data-rm title="${tr('Ta bort programgate')}">🗑</button></div>`).join('')}</div>`
      : `<p><i>${tr('Programmet har inga programgater än.')}</i></p>`}
      <div class="pgt-add"><button class="btn ghost small" id="pgtAdd">${tr('+ Ny programgate')}</button></div>
      <div class="cap-err" id="pgtErr"></div>`;
  };
  const read = () => $$('#pgtBody .pgt-row[data-i]').forEach(r => { const g = work[+r.dataset.i]; $$('[data-f]', r).forEach(inp => { g[inp.dataset.f] = inp.value.trim(); }); });
  const done = dialog({ title: tr('Programgater – {name}', { name: esc(p.name) }), wide: true, body: '<div id="pgtBody" class="pgt"></div>',
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara'), value: 'ok', keep: true }],
    onButton: (v, close) => {
      read();
      const err = m => { $('#pgtErr').textContent = m; };
      const rows = work.filter(g => g.code || g.name || g.week || g.date || g.note);
      if (rows.some(g => !g.code)) return err(tr('Varje programgate behöver en kod'));
      const keys = rows.map(g => pgKey(g.code));
      if (keys.some((k, i) => keys.indexOf(k) !== i)) return err(tr('Två programgater har samma kod'));
      const bad = rows.find(g => !g.date && g.week && parseWeek(g.week, true) == null);
      if (bad) return err(tr('Okänd vecka: {v}. Skriv ÅÅVV, t.ex. 2645', { v: bad.week }));
      work.splice(0, work.length, ...rows);
      close(v);
    },
    onBody: e => {
      const b = e.target.closest('button'); if (!b) return;
      read();
      if (b.id === 'pgtAdd') { work.push({ id: '', code: '', name: '', week: '', date: '', status: 'notstarted', note: '' }); draw(); const r = $$('#pgtBody .pgt-row[data-i]').pop(); if (r) $('.pgt-code', r).focus(); return; }
      if (b.dataset.rm != null) { work.splice(+b.closest('.pgt-row').dataset.i, 1); draw(); }
    } });
  draw();
  // Vecka och datum följer varandra: veckan ger fredagen, datumet ger veckan
  $('#pgtBody').addEventListener('change', e => {
    const f = e.target.dataset.f, r = e.target.closest('.pgt-row'); if (!r) return;
    if (f === 'week') { const d = parseWeek(e.target.value, true); e.target.classList.toggle('bad', !!e.target.value.trim() && d == null); if (d != null) $('[data-f="date"]', r).value = fromDay(d); else if (!e.target.value.trim()) $('[data-f="date"]', r).value = ''; }
    if (f === 'date') { const v = e.target.value; $('[data-f="week"]', r).value = v ? fmtYYWW(toDay(v)) : ''; }
  });
  done.then(v => {
    if (v !== 'ok') return;
    // Datumet går före veckan; har veckan ändrats utan att datumet följt med (t.ex. inklistrad) vinner veckan
    p.milestones = cleanProgramGates(work.map(g => { const wd = g.week ? parseWeek(g.week, true) : null; return { ...g, date: wd != null && (!g.date || fmtYYWW(toDay(g.date)) !== fmtYYWW(wd)) ? fromDay(wd) : g.date || null }; }));
    saveProgram(); render();
    toast(tr('Programgaterna är sparade'));
  });
}

/* ---------- Sample plan (relative to today) ---------- */
// Exempelplanen skapas på det valda språket; därefter är texterna planens egna data
const SAMPLE_EN = {
  'Exempel: Införande nytt planeringsstöd': 'Example: Introducing a new planning tool',
  'Förstudie': 'Pre-study', 'Kravställning': 'Requirements', 'Utveckling': 'Development', 'Test & verifiering': 'Test & verification', 'Utrullning': 'Rollout',
  'Projektdirektiv & mål': 'Project directive & goals', 'Nulägesanalys': 'Current state analysis', 'Intervjuer med projektledare': 'Interviews with project managers',
  'Beslut: Gå vidare (G1)': 'Decision: Go ahead (G1)', 'Kravworkshops': 'Requirements workshops', 'Kravspecifikation': 'Requirements specification',
  'Granskning av krav': 'Requirements review', 'Krav fastställda (G2)': 'Requirements approved (G2)', 'Arkitektur & design': 'Architecture & design',
  'Import från Planner': 'Import from Planner', 'Gantt- och roadmapvyer': 'Gantt and roadmap views', 'Behörighet & delning': 'Permissions & sharing',
  'Systemtest': 'System test', 'Användartest med pilotgrupp': 'User test with pilot group', 'Godkänd för driftsättning (G3)': 'Approved for deployment (G3)',
  'Utbildningsmaterial': 'Training material', 'Kommunikationsplan': 'Communication plan', 'Driftsättning': 'Deployment',
  'Uppföljning & överlämning': 'Follow-up & handover', 'Styrgrupp': 'Steering committee',
};
const sampleTxt = s => LANG === 'en' ? SAMPLE_EN[s] || s : s;
const sampleName = () => sampleTxt('Exempel: Införande nytt planeringsstöd');
const sampleSettings = () => ({ bucketOrder: ['Förstudie', 'Kravställning', 'Utveckling', 'Test & verifiering', 'Utrullning'].map(sampleTxt) });
function samplePlan() {
  const T = todayDay();
  const d = n => fromDay(T + n);
  const P = (n, b, s, e, prog, ass, extra = {}) => ({ id: uid(), name: sampleTxt(n), bucket: sampleTxt(b), start: d(s), end: d(e), progress: prog,
    assignees: ass.split('; ').map(sampleTxt).join('; '), deps: [], notes: '', ...extra });
  const t = [
    P('Projektdirektiv & mål', 'Förstudie', -70, -56, 100, 'Anna Berg'),
    P('Nulägesanalys', 'Förstudie', -60, -40, 100, 'Erik Lund'),
    P('Intervjuer med projektledare', 'Förstudie', -55, -38, 100, 'Sara Holm'),
    P('Beslut: Gå vidare (G1)', 'Förstudie', -35, -35, 100, 'Styrgrupp', { milestone: true }),
    P('Kravworkshops', 'Kravställning', -34, -14, 100, 'Sara Holm'),
    P('Kravspecifikation', 'Kravställning', -20, 2, 80, 'Anna Berg'),
    P('Granskning av krav', 'Kravställning', 3, 12, 0, 'Erik Lund; Anna Berg'),
    P('Krav fastställda (G2)', 'Kravställning', 14, 14, 0, 'Styrgrupp', { milestone: true }),
    P('Arkitektur & design', 'Utveckling', -5, 20, 40, 'Johan Ek'),
    P('Import från Planner', 'Utveckling', 15, 40, 0, 'Johan Ek'),
    P('Gantt- och roadmapvyer', 'Utveckling', 22, 55, 0, 'Lisa Wik'),
    P('Behörighet & delning', 'Utveckling', 40, 62, 0, 'Johan Ek'),
    P('Systemtest', 'Test & verifiering', 58, 76, 0, 'Maria Nord'),
    P('Användartest med pilotgrupp', 'Test & verifiering', 70, 90, 0, 'Sara Holm'),
    P('Godkänd för driftsättning (G3)', 'Test & verifiering', 93, 93, 0, 'Styrgrupp', { milestone: true }),
    P('Utbildningsmaterial', 'Utrullning', 60, 95, 0, 'Lisa Wik'),
    P('Kommunikationsplan', 'Utrullning', -10, -2, 60, 'Anna Berg'),
    P('Driftsättning', 'Utrullning', 96, 103, 0, 'Johan Ek'),
    P('Go-live', 'Utrullning', 105, 105, 0, 'Styrgrupp', { milestone: true }),
    P('Uppföljning & överlämning', 'Utrullning', 106, 135, 0, 'Anna Berg'),
  ];
  const by = n => t.find(x => x.name === sampleTxt(n)).id;
  const dep = (a, b) => t.find(x => x.name === sampleTxt(a)).deps.push(by(b));
  dep('Kravworkshops', 'Beslut: Gå vidare (G1)');
  dep('Granskning av krav', 'Kravspecifikation');
  dep('Krav fastställda (G2)', 'Granskning av krav');
  dep('Import från Planner', 'Krav fastställda (G2)');
  dep('Gantt- och roadmapvyer', 'Import från Planner');
  dep('Systemtest', 'Behörighet & delning');
  dep('Användartest med pilotgrupp', 'Systemtest');
  dep('Godkänd för driftsättning (G3)', 'Användartest med pilotgrupp');
  dep('Driftsättning', 'Godkänd för driftsättning (G3)');
  dep('Go-live', 'Driftsättning');
  return t;
}

/* =========================================================
   Export to PNG
   ========================================================= */
function exportSVG() {
  const P = PAL;
  const TITLE_H = 64;
  let W, H, inner;
  if (ui.view === 'roadmap') {
    W = Math.max(1200, $('#rmScroll').clientWidth);
    const r = roadmapSVG(W);
    H = r.H; inner = r.svg;
  } else {
    const { rows, sc } = ganttCtx;
    const LW = 380;
    const body = ganttBodySVG(rows, sc);
    W = LW + sc.width; H = HEAD + body.H;
    let left = `<rect width="${LW}" height="${H}" fill="${P.surface}"/><rect width="${LW}" height="${HEAD}" fill="${P.panel}"/>
      <text x="14" y="${HEAD - 10}" font-size="10.5" font-weight="600" fill="${P.muted}" letter-spacing=".5">${tr('AKTIVITET')}</text>
      <text x="${LW - 110}" y="${HEAD - 10}" font-size="10.5" font-weight="600" fill="${P.muted}">${tr('START')}</text>
      <text x="${LW - 60}" y="${HEAD - 10}" font-size="10.5" font-weight="600" fill="${P.muted}">${tr('SLUT')}</text>
      <line x1="0" x2="${LW}" y1="${HEAD}" y2="${HEAD}" stroke="${P.gridStrong}"/>`;
    rows.forEach((r, i) => {
      const y = HEAD + i * ROW, yc = y + ROW / 2 + 4;
      if (r.type === 'project') {
        left += `<rect y="${y}" width="${LW}" height="${ROW}" fill="${P.panel}"/><text x="14" y="${yc}" font-size="12.5" font-weight="700" fill="${P.text}">${esc(truncate(r.name, 12.5, 700, LW - 150))}</text>`;
        if (r.s != null) left += `<text x="${LW - 110}" y="${yc}" font-size="11" fill="${P.text2}">${fmtShort(r.s)}</text><text x="${LW - 60}" y="${yc}" font-size="11" fill="${P.text2}">${fmtShort(r.e)}</text>`;
      } else if (r.type === 'group') {
        const fg = r.unsched ? P.text : inkOn(colorOf(r.bucket));
        left += `<rect y="${y}" width="${LW}" height="${ROW}" fill="${r.unsched ? P.panel2 : colorOf(r.bucket)}"/>
          <text x="${r.sub ? 26 : 14}" y="${yc}" font-size="12" font-weight="700" fill="${fg}">${esc(truncate(r.label || bName(r.bucket), 12, 700, LW - 150))}</text>`;
        if (!r.unsched) left += `<text x="${LW - 110}" y="${yc}" font-size="11" font-weight="600" fill="${fg}">${fmtShort(r.s)}</text><text x="${LW - 60}" y="${yc}" font-size="11" font-weight="600" fill="${fg}">${fmtShort(r.e)}</text>`;
      } else {
        const t = r.t;
        left += `<text x="32" y="${yc}" font-size="12" fill="${statusOf(t) === 'done' ? P.muted : P.text}">${esc(truncate(t.name, 12, 400, LW - 160))}</text>
          <text x="${LW - 110}" y="${yc}" font-size="11" fill="${P.text2}">${t.milestone ? '' : fmtShort(toDay(t.start))}</text><text x="${LW - 60}" y="${yc}" font-size="11" fill="${P.text2}">${fmtShort(toDay(t.end))}</text>`;
      }
      left += `<line x1="0" x2="${LW}" y1="${y + ROW - .5}" y2="${y + ROW - .5}" stroke="${P.grid}"/>`;
      if (r.type !== 'project') {
        const ph = r.type === 'group' ? (r.unsched ? P.other : colorOf(r.bucket)) : (r.t.start || r.t.end ? colorOf(r.t.bucket || 'Övrigt') : P.other);
        left += `<rect y="${y}" width="${r.type === 'group' ? 4 : 3}" height="${ROW}" fill="${ph}"/>`;
      }
    });
    left += `<line x1="${LW - .5}" x2="${LW - .5}" y2="${H}" stroke="${P.gridStrong}"/>`;
    // Vänsterkolumnen ritas sist så att stödlinjer före planens start inte syns genom den
    inner = `<g transform="translate(${LW},0)">${headerSVG(sc, GANTT_TIERS[ui.zoom])}</g><g transform="translate(${LW},${HEAD})">${body.svg}</g>${left}`;
  }
  const title = `<rect width="${W}" height="${TITLE_H}" fill="${P.surface}"/>
    <text x="16" y="30" font-size="18" font-weight="700" fill="${P.text}">${esc(plan.name)}</text>
    <text x="16" y="50" font-size="12" fill="${P.muted}">${ui.view === 'roadmap' ? tr('Roadmap') : tr('Tidplan')} · ${tr('uppdaterad')} ${fmtDayY(todayDay())}</text>`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + TITLE_H}" font-family='${FONT}'><rect width="${W}" height="${H + TITLE_H}" fill="${P.surface}"/>${title}<g transform="translate(0,${TITLE_H})">${inner}</g></svg>`, W, H: H + TITLE_H };
}

// Nedladdning via länk fungerar inte i en sandboxad ram utan allow-downloads.
// Kan ramen inte läsas (annat ursprung) antas att det inte går.
function canDownload() {
  if (window.top === window.self) return true;
  try { const fe = window.frameElement; return !!fe && (!fe.sandbox.length || fe.sandbox.contains('allow-downloads')); }
  catch { return false; }
}

async function doExport() {
  if (!plan) return;
  // Exporten görs alltid i ljust tema (passar PowerPoint och utskrift)
  const root = document.documentElement, prev = root.dataset.theme;
  root.dataset.theme = 'light'; readPalette();
  let res;
  try { res = exportSVG(); } finally { root.dataset.theme = prev; readPalette(); }
  const { svg, W, H } = res;
  const { blob, png } = await svgToPng(svg, W, H);
  const fname = `${plan.name.replace(/[^\wåäöÅÄÖ\- ]+/g, '').trim() || tr('tidplan')} - ${ui.view === 'roadmap' ? 'roadmap' : 'gantt'}.png`;
  dialog({
    title: tr('Exportera bild'), wide: true,
    body: `${tr('Bilden passar för PowerPoint och e-post. Om nedladdningen inte startar: högerklicka på bilden och välj <b>Spara bild som</b> eller <b>Kopiera bild</b>.')}<img class="export-img" src="${png}" alt="Export">`,
    buttons: [{ label: tr('Stäng'), value: null, ghost: true }, { label: tr('Kopiera'), value: 'copy', ghost: true, keep: true }, { label: tr('Ladda ner PNG'), value: 'dl', keep: true }],
    onButton: async v => {
      if (v === 'dl') savePng(png, fname);
      if (v === 'copy') {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast(tr('Bilden är kopierad – klistra in i PowerPoint')); }
        catch { toast(tr('Kopiering blockerades – högerklicka på bilden och välj Kopiera bild')); }
      }
    },
  });
}

/* =========================================================
   Projektmallar (#32): ny plan från mall och lägg till från mall
   Mallbiblioteket: källa mallar/mallbibliotek.json, bäddas in av scripts/embed-mallar.mjs.
   Allt räknas i veckor: en aktivitet slutar endW veckor före veckan för sin gate (negativt = efter) och pågår durW veckor – start måndag, slut fredag. Milstolpar ligger på fredagen.
   "at" = [fas, andel 0–1 av fasen mellan dess startgate och slutgate].
   ========================================================= */
/* MALLAR:START */
const TEMPLATE_LIB = {"version":"2026-11-07 (PMI project template, Scrum, PI Planning (SAFe-inspired), hybrid PMI + sprints)","units":"weeks","source":{"PMI":"PMBOK® Guide process groups and knowledge areas (Project Management Institute) – terms only, no text","Agile":"Scrum Guide 2020 (Schwaber & Sutherland, CC BY-SA 4.0) and SAFe-inspired PI terms – terms only, no text"},"positioning":"Items end endW weeks before the week of their gate (negative = after) and last durW weeks: start Monday, end Friday, never before the Monday after the previous gate. Milestones (durW 0) fall on Friday. \"at\" = [phase, share 0–1 of the phase between its start gate and closing gate].","phases":[{"name":"Initiating","gate":"G1","gateName":"Project charter approved"},{"name":"Planning","gate":"G2","gateName":"Project management plan approved"},{"name":"Executing","gate":"G3","gateName":"Deliverables accepted"},{"name":"Closing","gate":"G4","gateName":"Project closed"}],"groups":[{"id":"pmi","name":"PMI project template","description":"A phase-gate project following the PMI process groups: Initiating, Planning, Executing (with Monitoring & Controlling running alongside) and Closing, with a gate after each phase.","source":"PMBOK® Guide process groups and knowledge areas (Project Management Institute) – terms only, no text","items":[{"name":"Business case and benefits","phase":"Initiating","gate":"G1","endW":2,"durW":2,"order":1},{"name":"Identify stakeholders","phase":"Initiating","gate":"G1","endW":1,"durW":2,"order":2},{"name":"Develop project charter","phase":"Initiating","gate":"G1","endW":0,"durW":2,"order":3,"after":["Business case and benefits"]},{"name":"Collect requirements","phase":"Planning","gate":"G2","endW":5,"durW":2,"order":4},{"name":"Define scope","phase":"Planning","gate":"G2","endW":4,"durW":1,"order":5,"after":["Collect requirements"]},{"name":"Create WBS","phase":"Planning","gate":"G2","endW":3,"durW":1,"order":6,"after":["Define scope"]},{"name":"Develop schedule","phase":"Planning","gate":"G2","endW":1,"durW":2,"order":7,"after":["Create WBS"]},{"name":"Estimate costs and determine budget","phase":"Planning","gate":"G2","endW":1,"durW":2,"order":8,"after":["Create WBS"]},{"name":"Plan quality management","phase":"Planning","gate":"G2","endW":1,"durW":1,"order":9},{"name":"Plan resource management","phase":"Planning","gate":"G2","endW":1,"durW":1,"order":10},{"name":"Plan communications management","phase":"Planning","gate":"G2","endW":1,"durW":1,"order":11},{"name":"Identify risks and plan responses","phase":"Planning","gate":"G2","endW":1,"durW":2,"order":12},{"name":"Plan procurement management","phase":"Planning","gate":"G2","endW":1,"durW":1,"order":13},{"name":"Plan stakeholder engagement","phase":"Planning","gate":"G2","endW":1,"durW":1,"order":14},{"name":"Develop project management plan","phase":"Planning","gate":"G2","endW":0,"durW":1,"order":15,"after":["Develop schedule","Estimate costs and determine budget","Identify risks and plan responses"]},{"name":"Acquire and develop team","phase":"Executing","gate":"G3","endW":0,"durW":4,"order":16,"at":["Executing",0.2]},{"name":"Conduct procurements","phase":"Executing","gate":"G3","endW":0,"durW":4,"order":17,"at":["Executing",0.3]},{"name":"Direct and manage project work","phase":"Executing","gate":"G3","endW":1,"durW":26,"order":18},{"name":"Manage quality","phase":"Executing","gate":"G3","endW":1,"durW":26,"order":19},{"name":"Manage communications and stakeholder engagement","phase":"Executing","gate":"G3","endW":1,"durW":26,"order":20},{"name":"Monitor and control project work (status reports)","phase":"Executing","gate":"G3","endW":1,"durW":26,"order":21},{"name":"Perform integrated change control","phase":"Executing","gate":"G3","endW":1,"durW":26,"order":22},{"name":"Control scope, schedule and costs","phase":"Executing","gate":"G3","endW":1,"durW":26,"order":23},{"name":"Monitor risks","phase":"Executing","gate":"G3","endW":1,"durW":26,"order":24},{"name":"Validate scope (deliverables accepted)","phase":"Executing","gate":"G3","endW":0,"durW":2,"order":25,"after":["Direct and manage project work"]},{"name":"Hand over deliverables","phase":"Closing","gate":"G4","endW":2,"durW":2,"order":26},{"name":"Close procurements","phase":"Closing","gate":"G4","endW":1,"durW":2,"order":27},{"name":"Lessons learned","phase":"Closing","gate":"G4","endW":1,"durW":1,"order":28},{"name":"Release resources","phase":"Closing","gate":"G4","endW":0,"durW":1,"order":29},{"name":"Final report and archive","phase":"Closing","gate":"G4","endW":0,"durW":1,"order":30,"after":["Lessons learned"]}]},{"id":"scrum","name":"Scrum","agile":true,"anchor":"START","description":"Sprint 0 (set-up), then N sprints with Sprint Planning, Sprint Review and Sprint Retrospective (the Daily Scrum is not shown in the timeline). A release every X sprints and the Product Goal as a gate. The sprint content can be kept as a checklist on Sprint Backlog.","source":"Scrum Guide 2020 (Schwaber & Sutherland, CC BY-SA 4.0) – terms only, no text","phases":[{"name":"Sprint 0"},{"name":"Sprint {n}","repeat":true},{"name":"Releases"}],"items":[{"name":"Product Backlog","phase":"Sprint 0","anchor":"START","endW":0,"durW":1,"order":1},{"name":"Definition of Done","phase":"Sprint 0","anchor":"START","endW":0,"durW":0,"milestone":true,"order":2,"after":["Product Backlog"]},{"name":"Product Goal","phase":"Releases","anchor":"END","endW":0,"durW":0,"milestone":true,"gateMs":true,"order":3,"after":["last:Sprint Review"]}],"repeat":{"name":"Sprint {n}","unit":"sprint","count":6,"countMin":1,"countMax":26,"lenW":2,"lenMin":1,"lenMax":4,"startW":1,"startAfter":["Definition of Done"],"tasks":[{"name":"Sprint Planning","milestone":true,"at":"start","after":["prev:Sprint Retrospective"]},{"name":"Sprint Backlog","after":["prev:Sprint Retrospective"]},{"name":"Sprint Review","milestone":true,"after":["Sprint Backlog"]},{"name":"Sprint Retrospective","milestone":true,"after":["Sprint Review"]}],"release":{"every":3,"name":"Release {r}","phase":"Releases","last":true,"after":"Sprint Review"}}},{"id":"pi","name":"PI Planning (SAFe-inspired)","agile":true,"anchor":"START","description":"N Program Increments (PI) of 8–12 weeks: PI Planning, Iterations 1–4 and an IP Iteration (Innovation and Planning), System Demo and Inspect & Adapt. One plan per team; the teams meet in the program view.","source":"SAFe-inspired: PI terms only, no text – not an official template from Scaled Agile, Inc.","phases":[{"name":"PI {n}","repeat":true}],"items":[],"repeat":{"name":"PI {n}","unit":"PI","count":4,"countMin":1,"countMax":8,"lenW":10,"lenMin":8,"lenMax":12,"startW":0,"tasks":[{"name":"PI Planning","milestone":true,"at":"start","after":["prev:Inspect & Adapt"]},{"name":"Iteration 1","part":[1,5],"after":["prev:Inspect & Adapt"]},{"name":"Iteration 2","part":[2,5],"after":["Iteration 1"]},{"name":"Iteration 3","part":[3,5],"after":["Iteration 2"]},{"name":"Iteration 4","part":[4,5],"after":["Iteration 3"]},{"name":"System Demo","milestone":true,"part":[4,5],"after":["Iteration 4"]},{"name":"IP Iteration","part":[5,5],"after":["Iteration 4"]},{"name":"Inspect & Adapt","milestone":true,"part":[5,5],"after":["IP Iteration"]}]}},{"id":"hybrid","name":"Hybrid PMI + sprints","agile":true,"description":"PMI phases and gates with N sprints in Executing. Each sprint starts the Monday after the gate that starts the phase, follows the previous sprint and ends before the closing gate (sprints that do not fit are left out).","source":"Scrum Guide 2020 (Schwaber & Sutherland, CC BY-SA 4.0) – terms only, no text; PMI gates as in the PMI project template","items":[{"name":"Product Backlog","phase":"Planning","gate":"G2","endW":0,"durW":3,"order":1},{"name":"Definition of Done","phase":"Planning","gate":"G2","endW":0,"durW":0,"order":2,"milestone":true,"after":["Product Backlog"]}],"repeat":{"name":"Sprint {n}","unit":"sprint","within":["Executing"],"count":6,"countMin":1,"countMax":26,"lenW":3,"lenMin":1,"lenMax":4,"startW":0,"tasks":[{"name":"Sprint {n}","after":["prev:Sprint {n} Review"]},{"name":"Sprint {n} Review","milestone":true,"after":["Sprint {n}"]}]}}],"repeat":"Agile templates: \"repeat\" = a block repeated N times (count, lenW in weeks, chosen when the plan is created within countMin–countMax and lenMin–lenMax). Each repetition is its own phase (\"Sprint {n}\"), or with \"within\" N sprints inside each listed phase. Tasks: part [k, n] = k-th of n equal parts (whole weeks), milestones at the end (Friday) or at:\"start\" (Monday); after: name in the same repetition or prev:name. Anchor END = Friday of the last repetition."};
/* MALLAR:END */
const TPL_GATES = TEMPLATE_LIB.phases.map(p => p.gate);
const TPL_SEP = ' › ';
const TPL_GROUP_TXT = { pmi: 'PMI-projektmall' };
const TPL_CAT = { pmi: 'PMI' };
const TPL_AGILE_TXT = {
  scrum: { name: 'Scrum', desc: 'Sprint 0 (uppstart) och N sprintar med Sprint Planning, Sprint Review och Sprint Retrospective. Release var X:e sprint och Product Goal som gate. Daily Scrum visas inte i tidslinjen; sprintens innehåll kan ligga som checklista på Sprint Backlog.' },
  pi: { name: 'PI-planering (SAFe-inspirerad)', desc: 'N Program Increments (PI) à 8–12 veckor: PI Planning, Iteration 1–4 och IP Iteration, System Demo och Inspect & Adapt. En plan per team – teamen samlas i programvyn.' },
  hybrid: { name: 'Hybrid PMI + sprintar', desc: 'PMI-faser och gater med N sprintar i Executing. Sprintarna börjar måndagen efter G2 och slutar före G3 – de som inte får plats hoppas över.' },
};
const TPL_REP_TXT = {
  sprint: { count: 'Antal sprintar', len: 'Veckor per sprint', every: 'Release var X:e sprint', per: 'Sprintar per fas' },
  PI: { count: 'Antal PI', len: 'Veckor per PI' },
  other: { count: 'Antal upprepningar', len: 'Veckor per upprepning', every: 'Release var X:e' },
};
const agileGroups = lib => ((lib && lib.groups) || []).filter(g => g.agile && g.repeat && !g.hidden);
// Agil mall som bibliotek för templateTasks: Scrum och PI har egna faser och datum från startveckan; hybrid använder PMI-faserna och gaterna
const agileLib = (lib, g) => g.repeat.within ? lib : { own: true, phases: g.phases || [], groups: [g] };
const weekMon = n => n - weekday(n);
const gateCodeRe = g => new RegExp('\\b' + g + '\\b', 'i');

// Upprepningsblock (#77): `repeat: { name: 'Sprint {n}', count, lenW, countMin/countMax, lenMin/lenMax, startW, gapW, within?, startAfter?,
// tasks: [{ name, milestone?, at: 'start'|'end', part: [k, n] | startW/durW, after: [namn | 'prev:namn'] }], release?: { every, name: 'Release {r}', phase, last, after } }`.
// Antal, längd och release var X:e väljs när planen skapas (inom mallens gränser); saknas ett värde gäller mallens standard.
function repeatVals(rep, o = {}) {
  const lim = (v, lo, hi, d) => { const n = v === '' || v == null ? NaN : Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const cMin = rep.countMin || 1, cMax = rep.countMax || 26, lMin = rep.lenMin || 1, lMax = rep.lenMax || 12;
  const count = lim(o.count, cMin, cMax, lim(rep.count, cMin, cMax, cMin));
  const lenW = lim(o.lenW, lMin, lMax, lim(rep.lenW, lMin, lMax, lMin));
  const every = rep.release ? lim(o.every, 0, cMax, lim(rep.release.every, 0, cMax, 0)) : 0;
  return { count, lenW, every };
}
// Ren funktion: upprepningarna som tidsluckor. Egna faser (standard): en fas per upprepning ('Sprint {n}'), första börjar måndagen
// startW veckor efter ankarets vecka, sedan i följd med gapW veckors mellanrum. `within` (hybrid): count upprepningar i varje angiven
// fas, från måndagen efter fasens startgate; det som inte får plats före fasens slutgate hoppas över (noFit).
// Svar: { slots: [{ n, s (måndag), e (fredag), phase, seg, first }], noFit: [namn] }
function repeatSlots(rep, vals, { gates = {}, phases = [], anchor = 'START' } = {}) {
  const { count, lenW } = vals, gap = Math.max(0, rep.gapW || 0), step = (lenW + gap) * 7;
  const nm = n => String(rep.name || '{n}').replace(/\{n\}/g, n);
  const slots = [], noFit = [];
  if (Array.isArray(rep.within) && rep.within.length) {
    let n = 0;
    rep.within.forEach((ph, seg) => {
      const pi = phases.findIndex(p => p.name === ph);
      const sg = pi > 0 ? gates[phases[pi - 1].gate] : null, eg = pi >= 0 ? gates[phases[pi].gate] : null;
      for (let k = 0; k < count; k++) {
        n++;
        if (sg == null) { noFit.push(nm(n)); continue; }
        const s = weekMon(sg) + 7 + (rep.startW || 0) * 7 + k * step, e = s + (lenW - 1) * 7 + 4;
        if (eg != null && e > weekMon(eg) + 4) { noFit.push(nm(n)); continue; }
        slots.push({ n, s, e, phase: ph, seg, first: k === 0, startGate: phases[pi - 1].gate });
      }
    });
    return { slots, noFit };
  }
  const a = gates[rep.anchor || anchor];
  if (a == null) return { slots, noFit: Array.from({ length: count }, (_, k) => nm(k + 1)) };
  for (let k = 0; k < count; k++) {
    const s = weekMon(a) + (rep.startW || 0) * 7 + k * step;
    slots.push({ n: k + 1, s, e: s + (lenW - 1) * 7 + 4, phase: nm(k + 1), seg: 0, first: k === 0 });
  }
  return { slots, noFit };
}
// En aktivitet i en upprepning: part [k, n] = k:te av n lika delar (hela veckor), annars startW/durW veckor in (standard hela).
// Milstolpar ligger på fredagen i slutet, eller måndagen i början med at: 'start'.
function repeatSpan(it, slot, lenW) {
  let i0 = 0, i1 = lenW;
  if (Array.isArray(it.part)) { const [k, n] = it.part; i0 = Math.round(lenW * (k - 1) / n); i1 = Math.max(i0 + 1, Math.round(lenW * k / n)); }
  else if (it.startW != null || it.durW) { i0 = Math.min(lenW - 1, Math.max(0, it.startW || 0)); i1 = it.durW ? Math.min(lenW, i0 + it.durW) : lenW; }
  i0 = Math.min(i0, lenW - 1); i1 = Math.max(i0 + 1, Math.min(i1, lenW));
  const s = slot.s + i0 * 7, e = slot.s + (i1 - 1) * 7 + 4;
  if (it.milestone) return it.at === 'start' ? [s, s] : [e, e];
  return [s, e];
}

// Ren funktion: mallens aktiviteter för valda grupper och gate-veckor. existing = planens aktiviteter (dubbletter hoppas över).
// Beroenden (#61): `after: [namn | 'PMI:namn']` på mallens aktiviteter. Namn utan prefix = samma grupp; 'PMI:' = PMI-projektmallen.
// Saknas föregångaren kopplas aktiviteten till gaten som startar fasen (föregående fas gate). Nya aktiviteter med efterföljare
// placeras baklänges från gaten (så sent som möjligt) så att kedjan går ihop – en gång, ingen automatisk schemaläggning efteråt.
// Upprepningsblock (#77, `grp.repeat`): opts.repeat = { count, lenW, every } (se repeatVals). Mallens övriga aktiviteter kan ha ankaret
// 'END' (fredagen i sista upprepningen) och `after: ['last:namn']` (aktiviteten i sista upprepningen). Svaret har även order (fasordning
// med de upprepade faserna) och noFit (upprepningar som inte fick plats).
// Egna mallar (#73, lib.own): datumen återges som i planen – inga PMI-gater skapas, ingen gräns vid fasstart och ingen baklänges
// placering. Gater följer med som mallens milstolpar (gateMs), checklistan som text (checks) och beroenden kan ha formen 'Fas › namn'.
function templateTasks(lib, opts, existing = []) {
  const { groups = [], optional = false, gates = {}, bucketOf = p => p } = opts;
  const own = !!lib.own, today = new Date().toISOString().slice(0, 10);
  const key = (name, bucket) => normName(name) + '|' + normName(bucket);
  const have = new Set(existing.map(t => key(t.name, t.bucket || '')));
  const tasks = [], skipped = [], dupes = [], made = [];
  const mk = (name, bucket, s, e, extra) => ({ id: uid(), name, bucket, start: fromDay(s), end: fromDay(e), progress: 0, deps: [], notes: '', assignees: '', ...extra });
  const gateTask = {};
  // Gaterna som milstolpar i fasen de avslutar (om planen inte redan har dem)
  for (const g of own ? [] : TPL_GATES) {
    const ex = existing.find(t => t.milestone && gateCodeRe(g).test(t.name || ''));
    if (ex) { gateTask[g] = ex; continue; }
    if (gates[g] == null) continue;
    const ph = lib.phases.find(p => p.gate === g);
    const fri = weekMon(gates[g]) + 4;
    tasks.push(gateTask[g] = mk('Gate ' + g + (ph.gateName ? ' – ' + ph.gateName : ''), bucketOf(ph.name), fri, fri, { milestone: true, gate: true }));
  }
  // Upprepningarnas tidsluckor först, så att END finns för mallens övriga aktiviteter
  const A = { ...gates }, reps = [];
  for (const grp of lib.groups) {
    if (!groups.includes(grp.id) || !grp.repeat || typeof grp.repeat !== 'object') continue;
    const rep = grp.repeat, vals = repeatVals(rep, opts.repeat || {});
    const { slots, noFit } = repeatSlots(rep, vals, { gates, phases: lib.phases || [], anchor: grp.anchor || 'START' });
    reps.push({ grp, rep, vals, slots, noFit, by: new Map() });
    if (slots.length && !rep.within) A.END = weekMon(slots[slots.length - 1].e);
  }
  const phaseStart = phase => { const pi = lib.phases.findIndex(p => p.name === phase), prev = pi > 0 ? gates[lib.phases[pi - 1].gate] : null; return prev != null ? weekMon(prev) + 7 : null; };
  for (const grp of lib.groups) {
    if (!groups.includes(grp.id)) continue;
    for (const it of grp.items) {
      if (it.mandatory === false && !optional) continue;
      let end;
      if (it.at) {
        const i = lib.phases.findIndex(p => p.name === it.at[0]);
        const s0 = i > 0 ? gates[lib.phases[i - 1].gate] : null, e0 = gates[lib.phases[i].gate];
        if (s0 == null || e0 == null) { skipped.push(it.name); continue; }
        const a = weekMon(s0) + 7, b = weekMon(e0);
        end = a + Math.round((b - a) / 7 * it.at[1]) * 7 + 4;
      } else {
        const anchor = A[it.anchor || it.gate];
        if (anchor == null) { skipped.push(it.name); continue; }
        // Milstolpar på fredagen, eller på veckodagen `day` (0 = måndag) när mallen har den (#77: t.ex. Sprint Planning på måndagen)
        end = weekMon(anchor) - (it.endW || 0) * 7 + (it.milestone && Number.isInteger(it.day) && it.day >= 0 && it.day <= 6 ? it.day : 4);
      }
      const durW = it.milestone ? 0 : Math.max(1, it.durW || 1);
      let start = it.milestone ? end : end - 4 - (durW - 1) * 7;
      // Långa aktiviteter börjar inte före fasen: tidigast måndagen efter föregående gate (om den är angiven)
      const ps = own ? null : phaseStart(it.phase);
      if (!it.milestone && ps != null) start = Math.min(Math.max(start, ps), end - 4);
      const bucket = bucketOf(it.phase);
      if (have.has(key(it.name, bucket))) { dupes.push(it.name); continue; }
      have.add(key(it.name, bucket));
      const t = mk(it.name, bucket, start, end, { milestone: !!it.milestone, notes: `From template: ${grp.name}${it.role ? ' · Role: ' + it.role : ''}${it.note ? ' – ' + it.note : ''}`, template: grp.id });
      if (it.gateMs) t.gate = true;
      if (it.gateMs && own && it.gate) t.gateCode = it.gate; // egen gate (#75) – kopplas till planens gater av tplGateSettings
      if (Array.isArray(it.checks) && it.checks.length) t.checks = it.checks.map((text, i) => ({ id: 'c' + (i + 1), text, done: false, src: 'tp', at: today }));
      if (it.effortH > 0) t.effort = { planned: it.effortH, done: null, remaining: null, src: 'tp' }; // planerad insats (#94)
      tasks.push(t); made.push({ t, it, grp: grp.id, end, durW });
    }
  }
  // Upprepningarnas aktiviteter (och release var X:e upprepning)
  const repMade = [];
  for (const R of reps) {
    let r = 0;
    const rel = R.rep.release && typeof R.rep.release === 'object' ? R.rep.release : null;
    R.slots.forEach((sl, i) => {
      const m = new Map(); R.by.set(sl.n, m);
      const sub = v => String(v).replace(/\{n\}/g, sl.n).replace(/\{r\}/g, r);
      const its = [...(R.rep.tasks || [])];
      if (rel && R.vals.every && (sl.n % R.vals.every === 0 || (rel.last && i === R.slots.length - 1))) {
        r++; its.push({ name: rel.name || 'Release {r}', milestone: true, release: true, phase: rel.phase, after: rel.after ? [rel.after] : [] });
      }
      for (const it of its) {
        const name = sub(it.name), bucket = bucketOf(it.release && it.phase ? it.phase : sl.phase);
        if (have.has(key(name, bucket))) { dupes.push(name); continue; }
        have.add(key(name, bucket));
        const [s, e] = repeatSpan(it, sl, R.vals.lenW);
        const t = mk(name, bucket, s, e, { milestone: !!it.milestone, notes: `From template: ${R.grp.name} · ${sub(R.rep.name || '{n}')}`, template: R.grp.id });
        if (it.gateMs) t.gate = true;
        tasks.push(t); m.set(it.release ? '' : it.name, t); repMade.push({ t, it, sl, i, R });
      }
    });
  }
  // Beroenden: samma grupp (nytt eller befintligt med samma namn), PMI-projektmallen, annars gaten som startar fasen
  const byName = (list, n) => list.find(x => normName(x.name) === normName(n));
  const PMI_GROUPS = ['pmi'];
  let deps = 0;
  for (const m of made) {
    const ids = [];
    for (const ref of m.it.after || []) {
      // 'last:namn' (#77): aktiviteten i gruppens sista upprepning
      if (ref.startsWith('last:')) {
        const R = reps.find(x => x.grp.id === m.grp), sl = R && R.slots[R.slots.length - 1];
        const p = sl && R.by.get(sl.n).get(ref.slice(5));
        if (p && !ids.includes(p.id)) ids.push(p.id);
        continue;
      }
      const pmi = ref.startsWith('PMI:'), n = pmi ? ref.slice(4) : ref;
      // 'Fas › namn' (#73): aktiviteten i den fasen, när samma namn finns i flera faser
      const q = !pmi && n.includes(TPL_SEP) ? { ph: n.slice(0, n.indexOf(TPL_SEP)), n: n.slice(n.indexOf(TPL_SEP) + TPL_SEP.length) } : null;
      let p = pmi ? (made.find(x => PMI_GROUPS.includes(x.grp) && normName(x.t.name) === normName(n)) || {}).t
        : q ? (made.find(x => x.grp === m.grp && normName(x.it.phase) === normName(q.ph) && normName(x.t.name) === normName(q.n)) || {}).t
        : (made.find(x => x.grp === m.grp && normName(x.t.name) === normName(n)) || {}).t;
      if (!p && q) p = existing.find(x => normName(x.name) === normName(q.n) && normName(x.bucket) === normName(bucketOf(q.ph))) || byName(existing, q.n);
      if (!p) p = byName(existing, n);
      if (!p && own) continue;
      if (!p) { const pi = lib.phases.findIndex(x => x.name === m.it.phase); p = pi > 0 ? gateTask[lib.phases[pi - 1].gate] : null; }
      if (p && p.id !== m.t.id && !ids.includes(p.id)) {
        ids.push(p.id);
        const ai = m.it.afterInfo && Object.prototype.hasOwnProperty.call(m.it.afterInfo, ref) && m.it.afterInfo[ref]; // #83
        if (ai) m.t.depInfo = { ...(m.t.depInfo || {}), [p.id]: { type: ai.type, lag: ai.lag } };
      }
    }
    m.t.deps = ids; deps += ids.length;
  }
  // Upprepningarnas beroenden: namn = samma upprepning, 'prev:namn' = föregående upprepning i samma följd. Den första hänger på
  // fasens startgate (within) eller på startAfter (mallens aktiviteter före blocket, t.ex. Sprint 0).
  for (const x of repMade) {
    const ids = [], R = x.R, add = p => { if (p && p.id !== x.t.id && !ids.includes(p.id)) ids.push(p.id); };
    for (const ref of x.it.after || []) {
      if (!ref.startsWith('prev:')) { add(R.by.get(x.sl.n).get(ref)); continue; }
      const prev = R.slots[x.i - 1];
      if (prev && !x.sl.first && prev.seg === x.sl.seg) add(R.by.get(prev.n).get(ref.slice(5)));
      else if (R.rep.within) add(gateTask[x.sl.startGate]);
      else for (const n of R.rep.startAfter || []) add((made.find(y => y.grp === R.grp.id && normName(y.t.name) === normName(n)) || {}).t || byName(existing, n));
    }
    x.t.deps = ids; deps += ids.length;
  }
  // Baklänges placering för aktiviteter som skapas nu och har efterföljare: slut senast fredagen före efterföljarnas start.
  // Befintliga aktiviteter flyttas aldrig.
  const prevFri = d => d - ((weekday(d) + 3) % 7);
  const succ = new Map(made.map(m => [m.t.id, []]));
  made.forEach(m => m.t.deps.forEach(d => { if (succ.has(d)) succ.get(d).push(m); }));
  const done = new Set();
  const place = (m, stack = new Set()) => {
    if (done.has(m.t.id) || stack.has(m.t.id)) return; stack.add(m.t.id);
    const ss = succ.get(m.t.id);
    if (ss.length) {
      ss.forEach(x => place(x, stack));
      const latest = Math.min(...ss.map(x => toDay(x.t.start))) - 3;
      let end = Math.min(m.end, prevFri(latest));
      let start = m.it.milestone ? end : end - 4 - (m.durW - 1) * 7;
      const ps = phaseStart(m.it.phase);
      if (!m.it.milestone && ps != null && start < ps) start = Math.min(ps, weekMon(end));
      m.t.start = fromDay(start); m.t.end = fromDay(end);
    }
    done.add(m.t.id);
  };
  if (!own) made.forEach(m => place(m));
  // Fasordning: mallens faser med de upprepade faserna där mallen har platshållaren { repeat: true }
  const order = [];
  for (const p of lib.phases || []) {
    if (p.repeat) reps.filter(R => !R.rep.within).forEach(R => R.slots.forEach(sl => order.push(bucketOf(sl.phase))));
    else order.push(bucketOf(p.name));
  }
  reps.filter(R => !R.rep.within).forEach(R => R.slots.forEach(sl => { const b = bucketOf(sl.phase); if (!order.includes(b)) order.push(b); }));
  return { tasks, skipped, dupes, deps, order: [...new Set(order)], noFit: reps.flatMap(R => R.noFit) };
}

// PMI-fasen ett namn hör till (se PMI_PHASES)
const pmiPhaseOf = name => PMI_PHASES.find(p => p.re.test(name || ''));

// from (#67, valfritt): förifyllning när planen skapas som delprojekt –
// { name, placeholder, gates {kod: 'ÅÅVV'}, project, link, note, mainOption, mainChecked, l2FromName, allowEmpty, after(np) }
async function openTemplateDialog(mode = 'new', from = null, keep = null) {
  const lib = TEMPLATE_LIB;
  const libG = lib && Array.isArray(lib.groups) ? lib.groups.filter(g => !g.agile) : [];
  const vis = libG.filter(g => !g.hidden);
  const agile = agileGroups(lib);
  const hasLib = vis.length > 0;
  const add = mode === 'add';
  if (add && (!plan || plan.synthetic)) return toast(tr('Öppna en plan först'));
  let own = [];
  try { own = await loadTemplates(); } catch (e) { toast(tr('Kunde inte läsa mallarna: ') + e.message); }
  const agileOf = s => typeof s === 'string' && s.startsWith('agile:') ? agile.find(g => 'agile:' + g.id === s) || null : null;
  const okSrc = s => s === 'lib' ? hasLib : agileOf(s) ? true : own.some(r => r.id === s);
  let src = keep && okSrc(keep.src) ? keep.src : hasLib ? 'lib' : agile[0] ? 'agile:' + agile[0].id : own[0] ? own[0].id : null;
  const ownRow = () => own.find(r => r.id === src) || null;
  const curLib = () => src === 'lib' ? lib : agileOf(src) ? agileLib(lib, agileOf(src)) : ownRow() ? templateLib(ownRow().template) : { phases: [], groups: [] };
  // Upprepningsblocket (#77) i vald mall och de valda värdena (antal, längd, release var X:e) per mall
  const curRep = () => { const g = agileOf(src); if (g) return g.repeat; const r = ownRow(); return r && r.template.groups[0] && r.template.groups[0].repeat || null; };
  const repv = keep && keep.repv ? { ...keep.repv } : {};
  let withPmi = !!(keep && keep.withPmi);
  const existing = add ? plan.tasks : [];
  // Lägg till: mallens faser hamnar i planens motsvarande faser (t.ex. "Feasability Study" från Planner)
  const buckets = add ? bucketList() : [];
  const bucketOf = ph => {
    if (!add) return ph;
    const L = curLib(), p = pmiPhaseOf(ph), gate = (L.phases.find(x => x.name === ph) || {}).gate;
    return buckets.find(b => normName(b) === normName(ph)) || (gate && buckets.find(b => (plan.settings.phaseCodes || {})[b] === gate))
      || buckets.find(b => p && pmiPhaseOf(b) === p) || ph;
  };
  const pre = {};
  if (add) {
    TPL_GATES.forEach(g => { const t = plan.tasks.find(x => x.milestone && x.end && gateCodeRe(g).test(x.name || '')); if (t) pre[g] = fmtYYWW(toDay(t.end)); });
    plan.tasks.filter(x => x.milestone && x.end && isGateMs(x)).forEach(t => { const k = tplAnchorKey(t); if (!pre[k]) pre[k] = fmtYYWW(toDay(t.end)); });
    const s0 = Math.min(...plan.tasks.map(t => toDay(t.start || t.end) ?? 1e9));
    if (s0 < 1e9) pre.START = fmtYYWW(s0);
  }
  if (from && from.gates) Object.assign(pre, from.gates);
  if (!pre.START) pre.START = fmtYYWW(todayDay());
  if (keep && keep.pre) Object.assign(pre, keep.pre);
  let asMain = !!(from && from.mainChecked);
  const state = { groups: ['pmi'], optional: false };
  let result = null, planName = '';
  const tplInfo = t => { const c = tplCounts(t); return tr('{n} aktiviteter · {m} milstolpar · {d} beroenden · {c} checklistpunkter', { n: c.items, m: c.ms, d: c.deps, c: c.checks }); };
  const srcHTML = () => `
    ${hasLib || agile.length ? `<b>${tr('Inbyggda mallar')}</b>` : ''}
    ${hasLib ? `<div class="tpl-lib"><label class="chk"><input type="radio" name="tplSrc" value="lib" ${src === 'lib' ? 'checked' : ''}> ${tr('NexusOrdo-biblioteket')}</label><small>${esc([...new Set(vis.map(g => TPL_CAT[g.id] || tr(TPL_GROUP_TXT[g.id] || g.name).split(' – ')[0]))].join(' · '))}</small></div>` : ''}
    ${agile.length ? `<span class="tpl-cat">${tr('Agilt')}</span>${agile.map(g => `<div class="tpl-lib"><label class="chk"><input type="radio" name="tplSrc" value="agile:${esc(g.id)}" ${src === 'agile:' + g.id ? 'checked' : ''}> ${esc(tr((TPL_AGILE_TXT[g.id] || {}).name || g.name))}</label>${g.repeat.within ? `<small>${tr('PMI-gater + sprintar')}</small>` : ''}</div>`).join('')}` : ''}
    <b>${tr('Mina mallar')}</b>
    ${own.length ? own.map(r => `<div class="tpl-own"><label class="chk"><input type="radio" name="tplSrc" value="${esc(r.id)}" ${src === r.id ? 'checked' : ''}> ${esc(r.name)}</label>
        <span class="tpl-act"><button class="btn ghost small" data-tpact="rename" data-id="${esc(r.id)}" title="${tr('Byt namn')}">✎</button><button class="btn ghost small" data-tpact="export" data-id="${esc(r.id)}" title="${tr('Exportera mall (Excel)')}">⬇</button><button class="btn ghost small" data-tpact="delete" data-id="${esc(r.id)}" title="${tr('Ta bort mall')}">🗑</button></span></div>`).join('')
      : `<p class="tpl-hint">${tr('Inga egna mallar ännu. Skapa en från en plan med ⋯ → 📐 Spara som mall…')}</p>`}
    <label for="tplFile" class="btn ghost small tpl-imp">${tr('⇪ Importera mall från fil…')}</label><input type="file" id="tplFile" class="visually-hidden" accept=".xlsx">`;
  const libPane = () => `<div class="tpl-cols">
      <div><b>${tr('Grupper')}</b>
        ${vis.map((g, i) => `${TPL_CAT[g.id] && TPL_CAT[g.id] !== TPL_CAT[(vis[i - 1] || {}).id] ? `<span class="tpl-cat">${esc(TPL_CAT[g.id])}</span>` : ''}<label class="chk"><input type="checkbox" data-g="${g.id}" ${state.groups.includes(g.id) ? 'checked' : ''}> ${tr(TPL_GROUP_TXT[g.id] || g.name)} <small>(${g.items.length})</small></label>`).join('')}
      </div>
      <div><b>${tr('Gate-veckor (ÅÅVV)')}</b><p class="tpl-hint">${tr('Lämna tomt för gater som inte gäller, t.ex. om projektet startar vid G2.')}</p>
        ${gatesHTML()}
      </div>
    </div>`;
  // Upprepningens fält (#77): antal och längd inom mallens gränser, release var X:e (0 = ingen)
  const repFields = rep => {
    const T = TPL_REP_TXT[rep.unit] || TPL_REP_TXT.other, v = repeatVals(rep, repv[src] || {}), cMax = rep.countMax || 26;
    const fld = (id, label, val, lo, hi) => `<label><span>${tr(label)}</span><input type="number" class="wk" id="${id}" min="${lo}" max="${hi}" step="1" value="${val}"><small>${lo}–${hi}</small></label>`;
    return `<div class="tpl-rep" id="tplRep">
      ${fld('tplCount', rep.within ? T.per || T.count : T.count, v.count, rep.countMin || 1, cMax)}
      ${fld('tplLen', T.len, v.lenW, rep.lenMin || 1, rep.lenMax || 12)}
      ${rep.release ? fld('tplEvery', T.every || TPL_REP_TXT.other.every, v.every, 0, cMax) : ''}</div>
      ${rep.release ? `<p class="tpl-hint">${tr('0 = ingen release. Sista sprinten får alltid en release.')}</p>` : ''}`;
  };
  const startHTML = (k, label, hint) => `<div class="tpl-gates"><label><b>${label}</b><small>${hint}</small>
        <input type="text" class="wk" data-gate="${esc(k)}" value="${esc(pre[k] || '')}" placeholder="${tr('ÅÅVV')}"><span class="tpl-d" data-d="${esc(k)}"></span></label></div>`;
  const agilePane = g => `<div class="tpl-ownpane">
      <p>${esc(TPL_AGILE_TXT[g.id] ? tr(TPL_AGILE_TXT[g.id].desc) : g.description || '')}</p>
      ${repFields(g.repeat)}
      ${g.repeat.within ? `<b>${tr('Gate-veckor (ÅÅVV)')}</b><p class="tpl-hint">${tr('Sprintarna läggs mellan G2 och G3 (Executing).')}</p>${gatesHTML()}
        <label class="chk"><input type="checkbox" id="tplPmi" ${withPmi ? 'checked' : ''}> ${tr('Ta med aktiviteterna i PMI-projektmallen')}</label>`
        : startHTML('START', tr('Start'), tr('veckan då planen börjar'))}
    </div>`;
  function gatesHTML() {
    return `<div class="tpl-gates">${TPL_GATES.map(g => { const ph = lib.phases.find(p => p.gate === g); return `<label title="${esc(ph.gateName || '')}"><b>${g}</b><small>${tr('slut på {phase}', { phase: ph.name })}</small><input type="text" class="wk" data-gate="${g}" value="${esc(pre[g] || '')}" placeholder="${tr('ÅÅVV')}"><span class="tpl-d" data-d="${g}"></span></label>`; }).join('')}</div>`;
  }
  const ownPane = () => {
    const r = ownRow();
    if (!r) return `<p class="tpl-hint">${tr('Välj en mall.')}</p>`;
    const t = r.template, k = t.anchor.key;
    return `<div class="tpl-ownpane">
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      <p class="tpl-hint">${esc(tplInfo(t))}</p>
      ${curRep() ? repFields(curRep()) : ''}
      <div class="tpl-gates"><label><b>${k === 'START' ? tr('Start') : esc(k)}</b><small>${k === 'START' ? tr('veckan då planen börjar') : tr('veckan för {name}', { name: esc(t.anchor.name) })}</small>
        <input type="text" class="wk" data-gate="${esc(k)}" value="${esc(pre[k] || '')}" placeholder="${tr('ÅÅVV')}"><span class="tpl-d" data-d="${esc(k)}"></span></label></div>
      <p class="tpl-hint">${tr('Datumen räknas i veckor från ankaret, som i planen mallen gjordes från.')}</p></div>`;
  };
  const paneHTML = () => src === 'lib' ? libPane() : agileOf(src) ? agilePane(agileOf(src)) : ownPane();
  const body = `
    ${from && from.note ? `<p class="tpl-from">${from.note}</p>` : ''}
    ${add ? '' : `<div class="field"><label>${tr('Namn på planen')}</label><input type="text" id="tplName" value="${esc(keep && keep.name != null ? keep.name : from ? from.name || '' : tr('Ny plan från mall'))}" placeholder="${esc(from && from.placeholder || '')}"></div>`}
    ${from && from.mainOption ? `<label class="chk"><input type="checkbox" id="tplMain" ${asMain ? 'checked' : ''}> ${tr('Huvudplan för {l1} – delprojekten ärver dess gater', { l1: esc((from.project || {}).l1 || '') })}</label>` : ''}
    <div class="tpl-wrap"><div class="tpl-src" id="tplSrc">${srcHTML()}</div><div id="tplPane">${paneHTML()}</div></div>
    <div class="tpl-prev" id="tplPrev"></div>`;
  const keepState = () => ({ src, pre: { ...pre }, repv: { ...repv }, withPmi, name: $('#tplName') ? $('#tplName').value : undefined });
  const done = dialog({ title: add ? tr('Lägg till från mall – {name}', { name: esc(plan.name) }) : tr('Ny plan från mall'), wide: true, body,
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: add ? tr('Lägg till') : tr('Skapa plan'), value: 'ok', keep: true }],
    onButton: (v, close) => {
      if (!src) return toast(tr('Välj en mall.'));
      if ((!result || !result.tasks.length) && !(from && from.allowEmpty)) return toast(src === 'lib' || (agileOf(src) && agileOf(src).repeat.within) ? tr('Inga aktiviteter att lägga till – ange minst en gate-vecka') : tr('Inga aktiviteter att lägga till – ange ankarets vecka'));
      planName = ($('#tplName') && $('#tplName').value.trim()) || '';
      if (from && !planName) return toast(tr('Skriv ett namn på planen'));
      if ($('#tplMain')) asMain = $('#tplMain').checked;
      close(v);
    },
    onBody: (e, close) => { const b = e.target.closest('[data-tpact]'); if (b) { const st = keepState(); close({ act: b.dataset.tpact, id: b.dataset.id, st }); } } });
  const read = () => {
    if (!$('#tplPrev')) return; // dialogen är stängd
    const r = $('#modal input[name="tplSrc"]:checked');
    if (r && r.value !== src) {
      $$('.tpl-gates input').forEach(inp => { pre[inp.dataset.gate] = inp.value.trim(); });
      src = r.value; $('#tplPane').innerHTML = paneHTML();
    }
    const gates = {};
    $$('.tpl-gates input').forEach(inp => {
      const g = inp.dataset.gate, v = inp.value.trim(), n = v ? parseWeek(v, true) : null;
      pre[g] = v;
      inp.classList.toggle('bad', !!v && n == null);
      const d = $$('.tpl-d').find(x => x.dataset.d === g); if (d) d.textContent = n != null ? fmtDayY(n) : '';
      if (n != null) gates[g] = n;
    });
    const rep = curRep(), ag = agileOf(src);
    if (rep && $('#tplCount')) {
      const num = id => $(id) ? $(id).value : '';
      repv[src] = { count: num('#tplCount'), lenW: num('#tplLen'), every: num('#tplEvery') };
    }
    const rv = rep ? repeatVals(rep, repv[src] || {}) : null;
    if ($('#tplPmi')) withPmi = $('#tplPmi').checked;
    if (src === 'lib') {
      state.groups = $$('[data-g]').filter(c => c.checked).map(c => c.dataset.g);
      result = templateTasks(lib, { groups: state.groups, gates, bucketOf }, existing);
    } else if (ag) {
      state.groups = ag.repeat.within ? [...(withPmi ? ['pmi'] : []), ag.id] : [ag.id];
      result = templateTasks(curLib(), { groups: state.groups, gates, bucketOf, repeat: rv }, existing);
    } else result = ownRow() ? templateTasks(curLib(), { groups: ['own'], gates, bucketOf, repeat: rv || {} }, existing) : null;
    if (!result) { $('#tplPrev').innerHTML = ''; return; }
    result.gates = gates; result.rv = rv;
    const per = {};
    result.tasks.forEach(t => { per[t.bucket] = (per[t.bucket] || 0) + 1; });
    const order = [...new Set([...(result.order || curLib().phases.map(p => bucketOf(p.name))), ...Object.keys(per)])];
    $('#tplPrev').innerHTML = `<b>${tr('Förhandsvisning')}</b>: ${tr('{n} aktiviteter och gater', { n: result.tasks.length })}${result.deps ? ' · ' + tr('{n} beroenden', { n: result.deps }) : ''}
      ${Object.keys(per).length ? `<div class="tpl-per">${order.filter(b => per[b]).map(b => `<span style="--ph:${(pmiPhaseOf(b) || {}).col || PAL.other}"><i></i>${esc(bName(b))} <b>${per[b]}</b></span>`).join('')}</div>` : ''}
      ${rv ? (T => `<div class="tpl-note">${tr(rep.within ? T.per || T.count : T.count)}: <b>${rv.count}</b>${rep.within ? ' ' + tr('({n} totalt)', { n: rv.count * rep.within.length }) : ''} · ${tr(T.len)}: <b>${rv.lenW}</b>${rep.release ? ' · ' + tr(T.every || TPL_REP_TXT.other.every) + ': <b>' + (rv.every || tr('ingen')) + '</b>' : ''}</div>`)(TPL_REP_TXT[rep.unit] || TPL_REP_TXT.other) : ''}
      ${(result.noFit || []).length ? `<div class="tpl-note">${tr('{n} hoppas över eftersom de inte får plats före gaten eller saknar gate-vecka: {names}', { n: result.noFit.length, names: esc(result.noFit.slice(0, 6).join(', ') + (result.noFit.length > 6 ? ' …' : '')) })}</div>` : ''}
      ${result.skipped.length ? `<div class="tpl-note">${src === 'lib' ? tr('{n} hoppas över eftersom deras gate saknar vecka', { n: result.skipped.length }) : tr('Ange ankarets vecka.')}</div>` : ''}
      ${result.dupes.length ? `<div class="tpl-note">${tr('{n} finns redan i planen och läggs inte till igen', { n: result.dupes.length })}</div>` : ''}`;
  };
  $('#modal').addEventListener('input', read);
  $('#modal').addEventListener('change', read);
  // Importera mall från fil: läggs i Mina mallar och väljs direkt (dialogen ligger kvar)
  $('#tplFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const row = await importTemplateFile(f);
      if (!row || !$('#tplSrc')) return;
      own = await loadTemplates(); src = row.id;
      $('#tplSrc').innerHTML = srcHTML(); $('#tplPane').innerHTML = paneHTML(); read();
    } catch (err) { toast(err.message); }
  });
  read();
  offerPageTourSoon('template');
  const ok = await done;
  $('#modal').removeEventListener('input', read); $('#modal').removeEventListener('change', read);
  if (ok && ok.act) { await templateAction(ok.act, own.find(r => r.id === ok.id)); return openTemplateDialog(mode, from, ok.st); }
  if (ok !== 'ok' || !result) return;
  const L = curLib();
  const tplName = src === 'lib' || agileOf(src) ? null : ownRow().name;
  const fromTpl = { groups: src === 'lib' || agileOf(src) ? state.groups : [], optional: state.optional, at: new Date().toISOString().slice(0, 10), ...(tplName ? { own: tplName } : {}), ...(result.rv ? { repeat: result.rv } : {}) };
  if (from) return createPlanFrom(from, planName, result, fromTpl, L, asMain);
  const phaseCodes = Object.fromEntries(L.phases.filter(p => p.gate).map(p => [bucketOf(p.name), p.gate]));
  const n = result.tasks.length;
  if (add) {
    pushUndo();
    // Mallens egna gater och gate-checklista (#75) slås ihop med planens
    const gs = tplGateSettings(L.gates, result.tasks, plan.settings, uid, plan.tasks);
    if (gs) Object.assign(plan.settings, gs);
    plan.tasks.push(...result.tasks);
    plan.settings.phaseCodes = { ...phaseCodes, ...(plan.settings.phaseCodes || {}) };
    // Mallens färger (#74) bara för faser som inte redan har en egen färg; planens palett ändras inte
    const tc = tplColorSettings(L, bucketOf).phaseColors;
    if (tc) plan.settings.phaseColors = { ...tc, ...(plan.settings.phaseColors || {}) };
    const order = plan.settings.bucketOrder || [];
    [...(result.order || L.phases.map(p => bucketOf(p.name))), ...result.tasks.map(t => t.bucket)].forEach(b => { if (!order.includes(b) && result.tasks.some(t => t.bucket === b)) order.push(b); });
    plan.settings.bucketOrder = order;
    scheduleSave(); render();
  } else {
    const name = planName || tr('Ny plan från mall');
    await createPlan(name, result.tasks, null, { bucketOrder: result.order || L.phases.map(p => p.name), phaseCodes, fromTemplate: fromTpl, ...tplColorSettings(L), ...(tplGateSettings(L.gates, result.tasks, {}, uid) || {}) });
  }
  toast(tr('{n} aktiviteter och gater från mallen', { n }) + (result.dupes.length ? ' · ' + tr('{n} dubbletter hoppades över', { n: result.dupes.length }) : ''));
}

// Skapar planen från en förifylld mall (#67): projektuppgifter och huvudplan följer med
async function createPlanFrom(from, name, result, fromTemplate, lib, asMain) {
  const project = { ...(from.project || {}) };
  if (from.l2FromName) project.l2 = name;
  if (asMain) project.role = 'main';
  const settings = { bucketOrder: result.order || lib.phases.map(p => p.name), phaseCodes: Object.fromEntries(lib.phases.filter(p => p.gate).map(p => [p.name, p.gate])),
    fromTemplate, project, ...tplColorSettings(lib), ...(tplGateSettings(lib.gates, result.tasks, {}, uid) || {}) };
  if (asMain) for (const o of allPlans.filter(x => isMainPlan(x) && normName(planProject(x).l1) === normName(project.l1))) {
    const q = { ...planProject(o) }; delete q.role; o.settings.project = q; await savePlanNow(o);
  }
  const np = await createPlan(name, result.tasks, null, settings);
  if (!np) return;
  toast(result.tasks.length ? tr('{n} aktiviteter och gater från mallen', { n: result.tasks.length }) : tr('Tom plan skapad'));
  if (from.after) await from.after(np);
}

/* =========================================================
   Skapa mall (#73): spara en plan som mall i alla varianter
   Mallen har samma form som mallar/mallbibliotek.json (veckor relativt ett ankare: endW, durW, after) och skapas med
   templateTasks. Ankaret är planens start ('START') eller en gate-milstolpe (gate-koden, t.ex. 'DG').
   Lagring: arbetskopia i LS (tp_templates: name, template json) + fil.
   Filen är #69:s Excel-format med den dolda fliken TimePlan-mall – inga koder, ägare eller plan-id.
   ========================================================= */
const TPL_FORMAT = 'timeplan-template', TPL_VERSION = 1, TPL_SHEET = 'TimePlan-mall';
// Ankarets nyckel: PMI-gatens kod eller MS för en annan milstolpe
function tplAnchorKey(t) {
  const n = (t && t.name) || '';
  return TPL_GATES.find(x => gateCodeRe(x).test(n)) || 'MS';
}
/* ---------- Generiska gater (#75, NexusOrdo bas) – rena funktioner ----------
   settings.gates = [{ id, code, name }]: planens egna gater, fria namn och koder. En milstolpe kopplas med t.gateId (och t.gate = true),
   annars känns den igen på gatens kod som helt ord i namnet. Saknas settings.gates härleds gaterna från planens gate-milstolpar (isGateMs),
   settings.gateItems = { [gateId]: [{ id, t, sec? }] }: egna punkter per gate. Svaren i settings.gateChecks['g:' + gateId][punktens id]
   = { s: 0|50|100, c, at, na? } och kriterierna i settings.gateCriteria['g:' + gateId].
   Mallar (#73) har `gates: [{ code, name, items: [{ t, sec? }] }]` och milstolparnas `gate` (koden). */
const GEN_PRE = 'g:';
const genKey = id => GEN_PRE + id;
const gTxt = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
const gId = v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null;
const gLow = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const gEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const gCodeRe = code => new RegExp('(^|[^0-9A-Za-zÅÄÖåäö_])' + gEsc(code) + '(?![0-9A-Za-zÅÄÖåäö_])', 'i');
// Gatens kod ur milstolpens namn: PMI-kod (G1–G4) eller (annars) namnet
function gateCodeOfName(name) {
  const n = gTxt(String(name || ''), 200);
  const m = n.match(/\b(G[1-4])\b/i);
  if (m) return m[1].toUpperCase();
  return n.slice(0, 24) || 'Gate';
}
const gateSlug = code => 'd-' + (gLow(code).replace(/[^a-z0-9åäö]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'gate');
// Bara giltiga gater: id, kod (≤ 24 tecken) och namn; högst 50. null = planen har inga egna gater (de härleds)
function cleanGates(list) {
  if (!Array.isArray(list)) return null;
  const out = [], ids = new Set();
  for (const g of list.slice(0, 50)) {
    if (!g || typeof g !== 'object') continue;
    const id = gId(g.id), code = gTxt(g.code, 24), name = gTxt(g.name, 120);
    if (!id || ids.has(id) || !(code || name)) continue;
    ids.add(id); out.push({ id, code: code || name.slice(0, 24), name: name || code });
  }
  return out;
}
// Bara giltiga punkter för gater som finns: id, text (≤ 500) och avsnitt (≤ 120); högst 500 per gate
function cleanGateItems(obj, gates) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const g of gates || []) {
    const ids = new Set(), items = [];
    for (const i of (Array.isArray(obj[g.id]) ? obj[g.id] : []).slice(0, 500)) {
      if (!i || typeof i !== 'object') continue;
      const id = gId(i.id), t = gTxt(i.t, 500), sec = gTxt(i.sec, 120);
      if (!id || !t || ids.has(id)) continue;
      ids.add(id); items.push({ id, t, ...(sec ? { sec } : {}) });
    }
    if (items.length) out[g.id] = items;
  }
  return out;
}
// Planens gater: egna (settings.gates) eller härledda från gate-milstolparna i datumordning
function planGates(p) {
  const st = (p && p.settings) || {};
  const own = cleanGates(st.gates);
  if (own) return own;
  const out = [];
  ((p && p.tasks) || []).filter(t => t && t.milestone && isGateMs(t)).sort((a, b) => (toDay(a.end) ?? 1e9) - (toDay(b.end) ?? 1e9)).forEach(t => {
    const code = gateCodeOfName(t.name), id = gateSlug(code);
    if (!out.some(g => g.id === id)) out.push({ id, code, name: t.name });
  });
  return out;
}
// Gaten en aktivitet hör till: kopplad med gateId, annars en milstolpe med gatens kod som helt ord i namnet
function taskGate(t, gates) {
  if (!t || t.gateId === 'none') return null; // 'none' = inte gate trots koden i namnet (valt i panelen)
  if (t.gateId) { const g = (gates || []).find(x => x.id === t.gateId); if (g) return g; }
  if (!t.milestone) return null;
  return (gates || []).find(g => g.code && gCodeRe(g.code).test(t.name || '')) || null;
}
// Gatens milstolpe: kopplad (gateId) före markerad gate (t.gate) före tidigaste med koden i namnet
function gateMsOf(tasks, gates, g) {
  const ms = (tasks || []).filter(t => t.milestone && (taskGate(t, gates) || {}).id === g.id);
  return ms.find(t => t.gateId === g.id) || ms.find(t => t.gate) || ms.sort((a, b) => (toDay(a.end) ?? 1e9) - (toDay(b.end) ?? 1e9))[0] || null;
}
const genItems = (st, gid) => ((st && st.gateItems) || {})[gid] || [];
// Sammanfattning som chkSummary: punkter som inte gäller räknas inte
function genSummary(st, gid) {
  const ans = ((st && st.gateChecks) || {})[genKey(gid)] || {};
  const its = genItems(st, gid).filter(i => !(ans[i.id] || {}).na);
  const n = { total: its.length, ok: 0, warn: 0, crit: 0 };
  its.forEach(i => { const s = (ans[i.id] || {}).s; if (s === 0) n.ok++; else if (s === 50) n.warn++; else if (s === 100) n.crit++; });
  n.open = n.total - n.ok - n.warn - n.crit;
  n.pct = n.total ? Math.round(n.ok / n.total * 100) : 0;
  return n;
}
// Nästa gate: tidigaste ej klara gate-milstolpe med datum, annars första gaten med punkter
function nextGenGate(p) {
  const gates = planGates(p);
  const cand = gates.map(g => ({ g, t: gateMsOf(p.tasks, gates, g) })).filter(x => x.t && x.t.end && (x.t.progress || 0) < 100 && !x.t.actual)
    .sort((a, b) => toDay(a.t.end) - toDay(b.t.end));
  if (cand.length) return cand[0].g;
  return gates.find(g => genItems(p.settings, g.id).length) || null;
}
// Excel med kolumnerna Gate, Punkt och (valfritt) Avsnitt – svenska eller engelska rubriker, i de första tio raderna
function parseGateChecklist(aoa) {
  const rows = Array.isArray(aoa) ? aoa : [];
  const H = { gate: /^(gate|grind)$/i, t: /^(punkt|kontrollpunkt|checkpunkt|item|check ?point|checklist item|text)$/i, sec: /^(avsnitt|område|section|area)$/i };
  let hi = -1, col = {};
  for (let r = 0; r < Math.min(10, rows.length) && hi < 0; r++) {
    const c = {};
    (rows[r] || []).forEach((v, i) => { const s = String(v ?? '').trim(); for (const k of Object.keys(H)) if (c[k] == null && H[k].test(s)) c[k] = i; });
    if (c.gate != null && c.t != null) { hi = r; col = c; }
  }
  if (hi < 0) throw new Error('Hittar inte kolumnerna Gate och Punkt.');
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const gate = gTxt(String((r || [])[col.gate] ?? ''), 24), t = gTxt(String((r || [])[col.t] ?? ''), 500), sec = col.sec != null ? gTxt(String((r || [])[col.sec] ?? ''), 120) : '';
    if (gate && t) out.push({ gate, t, ...(sec ? { sec } : {}) });
  }
  return out;
}
// Lägger rader { gate (kod eller namn), t, sec? } till gaterna: saknade gater skapas, samma text i samma gate och avsnitt hoppas över
function mergeGateItems(gates, items, rows, mkId) {
  const G = (gates || []).map(g => ({ ...g })), I = {};
  for (const [k, v] of Object.entries(items || {})) I[k] = [...v];
  let added = 0, dup = 0; const newGates = [];
  for (const r of rows || []) {
    let g = G.find(x => gLow(x.code) === gLow(r.gate)) || G.find(x => gLow(x.name) === gLow(r.gate));
    if (!g) { g = { id: mkId(), code: gTxt(r.gate, 24), name: gTxt(r.gate, 120) }; G.push(g); newGates.push(g.code); }
    const list = I[g.id] = I[g.id] || [];
    if (list.some(i => gLow(i.t) === gLow(r.t) && gLow(i.sec) === gLow(r.sec))) { dup++; continue; }
    list.push({ id: mkId(), t: r.t, ...(r.sec ? { sec: r.sec } : {}) }); added++;
  }
  return { gates: G, items: I, added, dup, newGates };
}
// Planens gater och punkter i mallens form (#73): bara när planen har egna gater (settings.gates)
function tplGatesOf(p) {
  const st = (p && p.settings) || {};
  if (!Array.isArray(st.gates)) return null;
  const gates = cleanGates(st.gates), items = cleanGateItems(st.gateItems, gates);
  return gates.map(g => ({ code: g.code, name: g.name, items: (items[g.id] || []).map(i => ({ t: i.t, ...(i.sec ? { sec: i.sec } : {}) })) }));
}
// Mallens gater → planens settings.gates/gateItems och milstolparnas gateId (t.gateCode från templateTasks tas bort).
// Finns gater redan (Lägg till från mall) slås de ihop på koden; befintliga punkter med samma text läggs inte till igen.
function tplGateSettings(tplGates, tasks, st, mkId, oldTasks = []) {
  const has = Array.isArray(tplGates) && tplGates.length;
  const linked = (tasks || []).filter(t => t.gateCode);
  if (!has && !linked.length) return null;
  const base = st && Array.isArray(st.gates) ? cleanGates(st.gates) : planGates({ settings: st || {}, tasks: oldTasks || [] });
  const rows = [];
  let m = mergeGateItems(base, cleanGateItems((st || {}).gateItems, base), [], mkId);
  for (const g of has ? tplGates : []) {
    if (!m.gates.some(x => gLow(x.code) === gLow(g.code))) m.gates.push({ id: mkId(), code: gTxt(g.code, 24) || gTxt(g.name, 24), name: gTxt(g.name, 120) || gTxt(g.code, 120) });
    for (const i of g.items || []) rows.push({ gate: g.code, t: i.t, ...(i.sec ? { sec: i.sec } : {}) });
  }
  for (const t of linked) if (!m.gates.some(x => gLow(x.code) === gLow(t.gateCode))) m.gates.push({ id: mkId(), code: gTxt(t.gateCode, 24), name: gTxt(t.gateCode, 120) });
  m = mergeGateItems(m.gates, m.items, rows, mkId);
  for (const t of linked) { const g = m.gates.find(x => gLow(x.code) === gLow(t.gateCode)); if (g) { t.gateId = g.id; t.gate = true; } delete t.gateCode; }
  return { gates: m.gates, gateItems: m.items };
}
// Mallens gater rensas (vitlista): kod, namn och punkter med text och avsnitt
function cleanTplGates(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const g of list.slice(0, 50)) {
    if (!g || typeof g !== 'object') continue;
    const code = gTxt(g.code, 24), name = gTxt(g.name, 120);
    if (!(code || name) || out.some(x => gLow(x.code) === gLow(code || name))) continue;
    const items = (Array.isArray(g.items) ? g.items : []).slice(0, 500).map(i => i && typeof i === 'object' ? { t: gTxt(i.t, 500), sec: gTxt(i.sec, 120) } : null)
      .filter(i => i && i.t).map(i => i.sec ? i : { t: i.t });
    out.push({ code: code || name.slice(0, 24), name: name || code, items });
  }
  return out.length ? out : null;
}
// Ren funktion: plan → mall. opts = { ids (valda aktiviteter, standard alla), anchor ('START' eller en milstolpes id), name, description }
function planToTemplate(p, opts = {}) {
  const all = (p && p.tasks) || [], st = (p && p.settings) || {};
  const anchorTask = opts.anchor && opts.anchor !== 'START' ? all.find(t => t.id === opts.anchor && (t.end || t.start)) : null;
  const want = opts.ids ? new Set(opts.ids) : null;
  const sel = all.filter(t => (t.start || t.end) && (!want || want.has(t.id) || t === anchorTask));
  const days = t => [toDay(t.start || t.end), toDay(t.end || t.start)];
  const bucket = t => t.bucket || 'Övrigt';
  const present = [...new Set(sel.map(bucket))];
  const phases = [...(st.bucketOrder || []).filter(b => present.includes(b)), ...present.filter(b => !(st.bucketOrder || []).includes(b))];
  const items = phases.flatMap(ph => sel.filter(t => bucket(t) === ph));
  const A = anchorTask ? days(anchorTask)[1] : Math.min(...items.map(t => days(t)[0]));
  const key = anchorTask ? tplAnchorKey(anchorTask) : 'START';
  const name = String(opts.name ?? (p && p.name) ?? '').trim();
  const cnt = {};
  items.forEach(t => { const k = normName(t.name); cnt[k] = (cnt[k] || 0) + 1; });
  const ref = t => cnt[normName(t.name)] > 1 || String(t.name).includes(TPL_SEP) ? bucket(t) + TPL_SEP + t.name : t.name;
  const byId = new Map(items.map(t => [t.id, t]));
  const codes = st.phaseCodes || {}, cols = cleanPhaseColors(st.phaseColors);
  // Egna gater och gate-checklista (#75) följer med när planen har dem
  const gl = Array.isArray(st.gates) ? planGates(p) : null, tg = tplGatesOf(p);
  return {
    format: TPL_FORMAT, version: TPL_VERSION, name, description: String(opts.description || '').trim(), units: 'weeks', own: true,
    anchor: { key, name: anchorTask ? anchorTask.name : 'Start' },
    ...(PALETTE_IDS.includes(st.palette) ? { palette: st.palette } : {}),
    // Fasens färg (#74) följer med i mallen
    phases: phases.map(ph => ({ name: ph, ...(codes[ph] ? { gate: codes[ph] } : {}), ...(cols[ph] ? { color: cols[ph] } : {}) })),
    ...(tg && tg.length ? { gates: tg } : {}),
    groups: [{ id: 'own', name, anchor: key, items: items.map((t, i) => {
      const [s, e] = days(t), ms = !!t.milestone;
      const it = { name: t.name, phase: bucket(t), anchor: key, endW: Math.round((weekMon(A) - weekMon(e)) / 7), durW: ms ? 0 : Math.max(1, Math.round((weekMon(e) - weekMon(s)) / 7) + 1), order: i + 1 };
      if (ms) it.milestone = true;
      if (ms && weekday(e) !== 4) it.day = weekday(e); // milstolpe som inte ligger på en fredag (#77)
      if (ms && isGateMs(t)) { it.gateMs = true; const g = gl && taskGate(t, gl); if (g) it.gate = g.code; }
      const after = [...new Set((t.deps || []).map(d => byId.get(d)).filter(x => x && x !== t).map(ref))];
      if (after.length) it.after = after;
      // Beroendetyp och fördröjning (#83) per namn i after; bara det som avviker från slut–start utan fördröjning
      const ai = {};
      for (const d of t.deps || []) { const x = byId.get(d), inf = x && x !== t && t.depInfo && t.depInfo[d]; if (inf && ((inf.type && inf.type !== 'FS') || +inf.lag)) ai[ref(x)] = { type: /^[SF][SF]$/.test(inf.type) ? inf.type : 'FS', lag: Math.round(+inf.lag || 0) }; }
      if (Object.keys(ai).length) it.afterInfo = ai;
      const checks = [...new Set((t.checks || []).map(c => String((c && c.text) || '').trim()).filter(Boolean))];
      if (checks.length) it.checks = checks;
      const eh = t.effort ? effortPlanned(t.effort) : null; // insats (#94): bara planerade timmar följer med
      if (eh != null && eh > 0) it.effortH = eh;
      return it;
    }) }],
  };
}
// Mallen som bibliotek för templateTasks
const templateLib = tpl => ({ own: true, phases: tpl.phases, groups: tpl.groups, ...(tpl.palette ? { palette: tpl.palette } : {}), ...(tpl.gates ? { gates: tpl.gates } : {}) });
// Mallens färger (#74) som planinställningar: fasens färg i planens fas (bucketOf) och mallens palett
function tplColorSettings(lib, bucketOf = n => n) {
  const phaseColors = {};
  for (const ph of (lib && lib.phases) || []) if (ph && isHexColor(ph.color)) phaseColors[bucketOf(ph.name)] = ph.color.toLowerCase();
  return { ...(Object.keys(phaseColors).length ? { phaseColors } : {}), ...(lib && PALETTE_IDS.includes(lib.palette) ? { palette: lib.palette } : {}) };
}
function tplCounts(tpl) {
  const items = tpl.groups.flatMap(g => [...g.items, ...(g.repeat ? (g.repeat.tasks || []).flatMap(t => Array(g.repeat.count || 1).fill(t)) : [])]);
  return { items: items.length, ms: items.filter(i => i.milestone).length, deps: items.reduce((a, i) => a + (i.after || []).length, 0), checks: items.reduce((a, i) => a + (i.checks || []).length, 0) };
}
// Kontrollerar och rensar en mall (fil eller tabell). Bara kända fält följer med – inga koder, ägare eller id.
// Utbyggbart: nya fält (t.ex. ett `repeat`-block för agila mallar, #77) läggs till här, i planToTemplate och i templateTasks.
// Ett tillägg som äldre versioner kan ignorera behåller TPL_VERSION; ändras betydelsen av befintliga fält höjs versionen.
function cleanTemplate(d) {
  const bad = () => { throw new Error(tr('Mallen är skadad eller har ändrats. Exportera den igen från NexusOrdo.')); };
  if (!tpObj(d) || d.format !== TPL_FORMAT) bad();
  if (typeof d.version !== 'number' || d.version > TPL_VERSION) throw new Error(tr('Mallen kommer från en nyare version av NexusOrdo och kan inte läsas här.'));
  const str = (v, n = 200) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const name = str(d.name);
  const groups = Array.isArray(d.groups) ? d.groups : [];
  if (!name || !groups.length || groups.length > 20) bad();
  const key = str(tpObj(d.anchor) ? d.anchor.key : '', 40) || str(groups[0] && groups[0].anchor, 40);
  if (!key) bad();
  const items = groups.flatMap(g => tpObj(g) && Array.isArray(g.items) ? g.items : bad());
  // Upprepningsblocket (#77) följer med; en mall med block behöver inga andra aktiviteter
  const repeat = cleanRepeat(tpObj(groups[0]) && groups[0].repeat, str, int, bad);
  if ((!items.length && !repeat) || items.length > 2000) bad();
  const outItems = items.map((it, i) => {
    if (!tpObj(it) || !str(it.name) || !int(it.endW, -2000, 2000) || !int(it.durW, 0, 2000)) bad();
    const o = { name: str(it.name), phase: str(it.phase) || 'Övrigt', anchor: repeat && it.anchor === 'END' ? 'END' : key, endW: it.endW, durW: it.milestone === true ? 0 : Math.max(1, it.durW), order: i + 1 };
    if (it.milestone === true) o.milestone = true;
    if (it.gateMs === true && o.milestone) { o.gateMs = true; const gc = str(it.gate, 24); if (gc) o.gate = gc; }
    if (o.milestone && int(it.day, 0, 6) && it.day !== 4) o.day = it.day;
    const after = Array.isArray(it.after) ? [...new Set(it.after.map(a => str(a, 420)).filter(Boolean))].slice(0, 50) : [];
    if (after.length) o.after = after;
    // #83: typ och fördröjning (arbetsdagar) per namn i after
    const ai = {};
    if (tpObj(it.afterInfo)) for (const a of after) { const x = Object.prototype.hasOwnProperty.call(it.afterInfo, a) && it.afterInfo[a];
      if (tpObj(x)) ai[a] = { type: /^[SF][SF]$/.test(String(x.type)) ? String(x.type) : 'FS', lag: Number.isInteger(x.lag) && Math.abs(x.lag) <= 3650 ? x.lag : 0 }; }
    if (Object.keys(ai).length) o.afterInfo = ai;
    const checks = Array.isArray(it.checks) ? [...new Set(it.checks.map(c => str(c, 500)).filter(Boolean))].slice(0, 200) : [];
    if (checks.length) o.checks = checks;
    if (typeof it.effortH === 'number' && isFinite(it.effortH) && it.effortH > 0 && it.effortH <= EFFORT_MAX) o.effortH = round2(it.effortH);
    return o;
  });
  const phases = [];
  for (const ph of Array.isArray(d.phases) ? d.phases : []) {
    const n = str(tpObj(ph) ? ph.name : '');
    if (!n || phases.some(x => x.name === n)) continue;
    const g = str(ph.gate, 12), c = isHexColor(ph.color) ? ph.color.toLowerCase() : '';
    phases.push({ name: n, ...(g ? { gate: g } : {}), ...(c ? { color: c } : {}), ...(repeat && ph.repeat === true ? { repeat: true } : {}) });
  }
  outItems.forEach(it => { if (!phases.some(x => x.name === it.phase)) phases.push({ name: it.phase }); });
  const gates = cleanTplGates(d.gates);
  return { format: TPL_FORMAT, version: TPL_VERSION, name, description: str(d.description, 1000), units: 'weeks', own: true,
    anchor: { key, name: str(tpObj(d.anchor) ? d.anchor.name : '') || key }, ...(PALETTE_IDS.includes(d.palette) ? { palette: d.palette } : {}), phases, ...(gates ? { gates } : {}), groups: [{ id: 'own', name, anchor: key, items: outItems, ...(repeat ? { repeat } : {}) }] };
}
// Upprepningsblocket (#77) i en mall: bara kända fält, heltal inom gränser, högst 50 aktiviteter per upprepning
function cleanRepeat(r, str, int, bad) {
  if (r == null || r === false) return null;
  if (!tpObj(r) || !Array.isArray(r.tasks)) bad();
  const num = (v, lo, hi) => int(v, lo, hi) ? v : undefined;
  const refs = a => Array.isArray(a) ? [...new Set(a.map(x => str(x, 420)).filter(Boolean))].slice(0, 20) : [];
  const countMin = num(r.countMin, 1, 52) || 1, countMax = Math.max(countMin, num(r.countMax, 1, 52) || 26);
  const lenMin = num(r.lenMin, 1, 52) || 1, lenMax = Math.max(lenMin, num(r.lenMax, 1, 52) || 12);
  const tasks = r.tasks.slice(0, 50).map(t => {
    if (!tpObj(t) || !str(t.name)) bad();
    const o = { name: str(t.name) };
    if (t.milestone === true) { o.milestone = true; if (t.at === 'start') o.at = 'start'; if (t.gateMs === true) o.gateMs = true; }
    if (Array.isArray(t.part) && int(t.part[1], 1, 52) && int(t.part[0], 1, t.part[1])) o.part = [t.part[0], t.part[1]];
    else { if (int(t.startW, 0, 52)) o.startW = t.startW; if (int(t.durW, 1, 52)) o.durW = t.durW; }
    const after = refs(t.after);
    if (after.length) o.after = after;
    return o;
  });
  if (!tasks.length) bad();
  const name = str(r.name) || 'Sprint {n}';
  const o = { name: name.includes('{n}') ? name : name + ' {n}', count: Math.min(countMax, Math.max(countMin, Number.isInteger(r.count) ? r.count : countMin)), countMin, countMax,
    lenW: Math.min(lenMax, Math.max(lenMin, Number.isInteger(r.lenW) ? r.lenW : lenMin)), lenMin, lenMax, tasks };
  if (['sprint', 'PI'].includes(r.unit)) o.unit = r.unit;
  if (int(r.startW, -2000, 2000)) o.startW = r.startW;
  if (int(r.gapW, 0, 52) && r.gapW) o.gapW = r.gapW;
  const within = refs(r.within).slice(0, 10), startAfter = refs(r.startAfter);
  if (within.length) o.within = within;
  if (startAfter.length) o.startAfter = startAfter;
  if (tpObj(r.release)) {
    const rel = r.release;
    o.release = { every: num(rel.every, 0, 52) || 0, name: str(rel.name) || 'Release {r}' };
    if (str(rel.phase)) o.release.phase = str(rel.phase);
    if (rel.last === true) o.release.last = true;
    if (str(rel.after)) o.release.after = str(rel.after);
  }
  return o;
}
// Excel-fil: läsbar flik Mall + dold flik TimePlan-mall med JSON i bitar (som #69)
// build (#78) = NexusOrdo-versionen som skapade filen; cleanTemplate läser bara kända fält, så äldre versioner bryr sig inte
function templateWorkbook(tpl, build = null) {
  const wb = XLSX.utils.book_new(), its = tpl.groups.flatMap(g => g.items);
  const rel = w => w === 0 ? '0' : (w < 0 ? '+' : '−') + Math.abs(w);
  const rp = (tpl.groups[0] || {}).repeat;
  const rows = [[tr('Mall'), tpl.name], [tr('Beskrivning'), tpl.description || ''], [tr('Ankare'), tpl.anchor.key === 'START' ? tr('Planens start') : tpl.anchor.name],
    ...(rp ? [[tr('Upprepas'), tr('{name} × {n} à {w} veckor: {tasks}', { name: rp.name, n: rp.count, w: rp.lenW, tasks: rp.tasks.map(t => t.name).join('; ') })]] : []), [],
    [tr('Fas'), tr('Aktivitet'), tr('Slutvecka (veckor från ankaret)'), tr('Längd (veckor)'), tr('Milstolpe'), tr('Gate'), tr('Efter'), tr('Checklista'), tr('Planerat (h)')],
    ...its.map(i => [i.phase, i.name, rel(i.endW), i.durW, i.milestone ? tr('Ja') : '', i.gateMs ? tr('Ja') : '', (i.after || []).join('; '), (i.checks || []).join('; '), i.effortH ?? ''])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [22, 44, 14, 10, 10, 8, 40, 50, 12].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, tr('Mall'));
  // Egen gate-checklista (#75): samma kolumner som när en checklista läses in från Excel
  if ((tpl.gates || []).some(g => g.items.length)) {
    const gws = XLSX.utils.aoa_to_sheet([[tr('Gate'), tr('Punkt'), tr('Avsnitt')], ...tpl.gates.flatMap(g => g.items.map(i => [g.code, i.t, i.sec || '']))]);
    gws['!cols'] = [12, 60, 24].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, gws, tr('Gate-checklista'));
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[tr('TimePlan-mall – ändra inte. Används när mallen importeras i NexusOrdo.')], ...tpChunks(JSON.stringify({ ...cleanTemplate(tpl), ...(build ? { build } : {}) })).map(c => [c])]), TPL_SHEET);
  wb.Workbook = { Sheets: wb.SheetNames.map(n => ({ name: n, Hidden: n === TPL_SHEET ? 1 : 0 })) };
  return wb;
}
function readTemplateWb(wb) {
  const name = wb.SheetNames.find(n => n.trim().toLowerCase() === TPL_SHEET.toLowerCase());
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  let d = null;
  try { d = JSON.parse(rows.slice(1).map(r => r[0]).filter(v => typeof v === 'string').join('')); } catch { /* fel i cleanTemplate */ }
  return cleanTemplate(d);
}

// Lagring: tp_templates i arbetskopian i LS (lokala versionen: per fil)
let TplStore = null;
const tplStore = () => TplStore || (TplStore = makeStore('tp_templates'));
async function loadTemplates() {
  const parse = v => typeof v === 'string' ? JSON.parse(v) : v;
  const rows = await tplStore().list();
  return rows.map(r => { try { return { id: r.id, name: r.name || '', template: cleanTemplate(parse(r.template)), updated_at: r.updated_at || r.created_at || '' }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}
async function saveTemplateRow(tpl) {
  const now = new Date().toISOString();
  return tplStore().insert({ name: tpl.name, template: cleanTemplate(tpl), created_at: now, updated_at: now });
}
const tplFileName = name => `${name} – ${tr('mall')}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
// Lokala versionen: spara som fil (File System Access API, annars nedladdning)
async function saveTemplateFile(tpl) {
  if (!window.XLSX) return toast(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
  const wb = templateWorkbook(tpl, tpBuild()), fname = tplFileName(tpl.name);
  if (FILE_MODE && window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: fname, types: pickerTypes });
      const w = await h.createWritable(); await w.write(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })); await w.close();
      return toast(tr('Mallen är sparad till {file}', { file: h.name }));
    } catch (e) { if (e.name !== 'AbortError') toast(tr('Kunde inte spara: ') + e.message); return; }
  }
  downloadWorkbook(wb, fname.replace(/\.xlsx$/, ''), tr('Mallen är exporterad'));
}
// Importerad mall läggs i Mina mallar; samma namn som en egen mall får tillägget "(importerad datum)"
async function importTemplate(tpl, ask = false) {
  const own = await loadTemplates().catch(() => []);
  let name = tpl.name;
  if (own.some(r => lc(r.name) === lc(name))) name += tr(' (importerad {d})', { d: new Date().toISOString().slice(0, 10) });
  if (ask) {
    const c = tplCounts(tpl);
    const ok = await dialog({ title: tr('Importera mall'), body: `<p>${tr('Filen är en NexusOrdo-mall: <b>{name}</b> med {n} aktiviteter, {m} milstolpar och {d} beroenden.', { name: esc(tpl.name), n: c.items, m: c.ms, d: c.deps })}</p>
        <p>${tr('Den läggs i <b>Mina mallar</b>. Skapa sedan en plan med ⋯ → Ny plan från mall….')}</p>`,
      buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Importera mall'), value: true }] });
    if (!ok) return null;
  }
  const t = { ...tpl, name, groups: tpl.groups.map(g => ({ ...g, name })) };
  try {
    const row = await saveTemplateRow(t);
    toast(tr('Mallen ”{name}” finns nu i Mina mallar', { name }));
    return row;
  } catch (e) { toast(tr('Kunde inte spara mallen: ') + e.message); return null; }
}
async function importTemplateFile(file) {
  if (!window.XLSX) throw new Error(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  if (!wb.SheetNames.some(n => n.trim().toLowerCase() === TPL_SHEET.toLowerCase())) throw new Error(tr('Filen är ingen NexusOrdo-mall (fliken TimePlan-mall saknas).'));
  const tpl = readTemplateWb(wb);
  await warnNewerFile(sheetBuild(wb, TPL_SHEET));
  return importTemplate(tpl);
}
// Byt namn, ta bort och exportera – från listan Mina mallar i mall-dialogen
async function templateAction(act, r) {
  if (!r) return;
  const stamp = { updated_at: new Date().toISOString() };
  try {
    if (act === 'export') return saveTemplateFile(r.template);
    if (act === 'rename') {
      const name = await dialog({ title: tr('Byt namn på mallen'), body: tr('Nytt namn:'), input: r.name, buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara'), value: true }] });
      if (!name || name === r.name) return;
      const t = { ...r.template, name, groups: r.template.groups.map(g => ({ ...g, name })) };
      await tplStore().update(r.id, { name, template: cleanTemplate(t), ...stamp });
      return toast(tr('Mallen heter nu ”{name}”', { name }));
    }
    if (act === 'delete') {
      const ok = await dialog({ title: tr('Ta bort mall?'), body: tr('Mallen <b>{name}</b> tas bort. Planer som skapats från den påverkas inte.', { name: esc(r.name) }),
        buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Ta bort'), value: true, danger: true }] });
      if (!ok) return;
      await tplStore().remove(r.id);
      return toast(tr('Mallen ”{name}” är borttagen', { name: r.name }));
    }
  } catch (e) { toast(tr('Kunde inte spara mallen: ') + e.message); }
}

// ⋯ → 📐 Spara som mall… – välj faser och aktiviteter, ankare, namn och beskrivning
async function openSaveTemplate() {
  if (!plan || plan.synthetic || ui.mode === 'program') return toast(tr('Öppna en plan först.'));
  const p = plan, dated = t => !!(t.start || t.end);
  if (!p.tasks.some(dated)) return toast(tr('Planen har inga aktiviteter med datum.'));
  const bs = bucketList(), start = Math.min(...p.tasks.filter(dated).map(t => toDay(t.start || t.end)));
  const gms = p.tasks.filter(t => t.milestone && t.end && isGateMs(t)).sort((a, b) => toDay(a.end) - toDay(b.end));
  const info = t => [t.milestone ? '◆' : '', (t.deps || []).length ? `→${t.deps.length}` : '', (t.checks || []).length ? `☑${t.checks.length}` : '', dated(t) ? '' : tr('saknar datum')].filter(Boolean).join(' ');
  const tree = bs.map((b, i) => { const ts = p.tasks.filter(t => (t.bucket || 'Övrigt') === b); return ts.length ? `<div class="st-ph">
      <label class="chk st-phl"><input type="checkbox" data-ph="${i}" checked> <b>${esc(bName(b))}</b> <small>(${ts.length})</small></label>
      <div class="st-tasks">${ts.map(t => `<label class="chk ${dated(t) ? '' : 'off'}"><input type="checkbox" data-t="${esc(t.id)}" data-pi="${i}" ${dated(t) ? 'checked' : 'disabled'}> ${esc(t.name)} <small>${esc(info(t))}</small></label>`).join('')}</div></div>` : ''; }).join('');
  let tpl = null;
  const done = dialog({ title: tr('Spara som mall – {name}', { name: esc(p.name) }), wide: true,
    body: `<div class="st-cols"><div>
        <div class="field"><label>${tr('Mallens namn')}</label><input type="text" id="stName" value="${esc(p.name + ' – ' + tr('mall'))}"></div>
        <div class="field"><label>${tr('Beskrivning')}</label><textarea id="stDesc" rows="3" placeholder="${tr('Vad mallen passar för, t.ex. typ av projekt')}"></textarea></div>
        <div class="field"><label>${tr('Ankare')}</label><select id="stAnchor"><option value="START">${tr('Planens start (v {w})', { w: fmtYYWW(start) })}</option>
          ${gms.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (${fmtYYWW(toDay(t.end))})</option>`).join('')}</select>
          <p class="tpl-hint">${tr('Datumen sparas som veckor före eller efter ankaret. När en plan skapas från mallen anger du ankarets vecka.')}</p></div>
        <p class="tpl-hint">${tr('Risker, status och bockar följer inte med. Checklistornas punkter följer med utan bockar.')}</p>
      </div><div><b>${tr('Faser och aktiviteter')}</b> <button class="btn ghost small" id="stAll" type="button">${tr('Alla')}</button><button class="btn ghost small" id="stNone" type="button">${tr('Inga')}</button>
        <div class="st-tree" id="stTree">${tree}</div></div></div>
      <div class="tpl-prev" id="stSum"></div>`,
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara mall'), value: 'ok', keep: true }],
    onButton: (v, close) => {
      if (!$('#stName').value.trim()) return toast(tr('Skriv ett namn på mallen'));
      if (!tpl || !tpl.groups[0].items.length) return toast(tr('Välj minst en aktivitet med datum'));
      close(tpl);
    },
    onBody: e => {
      const all = e.target.id === 'stAll', none = e.target.id === 'stNone';
      if (all || none) { $$('#stTree input[data-t]:not(:disabled)').forEach(c => { c.checked = all; }); sync(); }
    } });
  const sync = (e) => {
    if (!$('#stSum')) return;
    const ph = e && e.target && e.target.dataset && e.target.dataset.ph;
    if (ph != null) $$(`#stTree input[data-pi="${ph}"]:not(:disabled)`).forEach(c => { c.checked = e.target.checked; });
    $$('#stTree input[data-ph]').forEach(c => {
      const kids = $$(`#stTree input[data-pi="${c.dataset.ph}"]:not(:disabled)`), on = kids.filter(k => k.checked).length;
      c.checked = !!kids.length && on === kids.length; c.indeterminate = on > 0 && on < kids.length;
    });
    const ids = $$('#stTree input[data-t]').filter(c => c.checked).map(c => c.dataset.t);
    tpl = ids.length ? planToTemplate(p, { ids, anchor: $('#stAnchor').value, name: $('#stName').value, description: $('#stDesc').value }) : null;
    const sel = new Set(ids), lost = p.tasks.filter(t => sel.has(t.id)).reduce((a, t) => a + (t.deps || []).filter(d => !sel.has(d) && p.tasks.some(x => x.id === d)).length, 0);
    const c = tpl ? tplCounts(tpl) : { items: 0, ms: 0, deps: 0, checks: 0 };
    $('#stSum').innerHTML = `<b>${tr('Mallen får')}</b>: ${tr('{n} aktiviteter · {m} milstolpar · {d} beroenden · {c} checklistpunkter', { n: c.items, m: c.ms, d: c.deps, c: c.checks })}
      ${tpl ? `<div class="tpl-note">${tr('{p} faser, {w} veckor från första till sista aktiviteten', { p: tpl.phases.length, w: tplSpan(tpl) })}</div>` : ''}
      ${lost ? `<div class="tpl-note">${tr('{n} beroenden till aktiviteter som inte är valda följer inte med', { n: lost })}</div>` : ''}`;
  };
  $('#modal').addEventListener('change', sync);
  $('#modal').addEventListener('input', sync);
  sync();
  const r = await done;
  $('#modal').removeEventListener('change', sync); $('#modal').removeEventListener('input', sync);
  if (!r) return;
  let t = cleanTemplate(r);
  const same = (await loadTemplates().catch(() => [])).find(x => lc(x.name) === lc(t.name));
  if (same) {
    const c = await dialog({ title: tr('Mallen finns redan'), body: tr('Du har redan en mall som heter <b>{name}</b>. Ersätta den, eller spara som en ny mall?', { name: esc(t.name) }),
      buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara som ny'), value: 'new', ghost: true }, { label: tr('Ersätt'), value: 'replace' }] });
    if (!c) return;
    if (c === 'replace') {
      try { await tplStore().update(same.id, { template: t, updated_at: new Date().toISOString() }); }
      catch (e) { return toast(tr('Kunde inte spara mallen: ') + e.message); }
      toast(tr('Mallen ”{name}” är uppdaterad', { name: t.name }));
      if (FILE_MODE) await saveTemplateFile(t);
      return;
    }
    const n = t.name + ' (2)'; t = { ...t, name: n, groups: t.groups.map(g => ({ ...g, name: n })) };
  }
  try { await saveTemplateRow(t); }
  catch (e) { return toast(tr('Kunde inte spara mallen: ') + e.message); }
  toast(tr('Mallen ”{name}” är sparad – använd den med ⋯ → Ny plan från mall…', { name: t.name }));
  if (FILE_MODE) await saveTemplateFile(t); // lokala versionen: mallen sparas också som fil
}
const tplSpan = tpl => { const its = tpl.groups.flatMap(g => g.items); return its.length ? Math.max(...its.map(i => -i.endW)) - Math.min(...its.map(i => -i.endW - Math.max(0, i.durW - 1))) + 1 : 0; };

/* ---------- Gate-checklistans skala och gate-kriterier (generiska checklistan och statusrapporten) ---------- */
// Mallens skala: 0 = klart, 50 = påverkar tid, pengar eller resurser, 100 = kritiskt
const CHK_ST = { 0: { label: 'Klart', cls: 'ok' }, 50: { label: 'Påverkar', cls: 'warn' }, 100: { label: 'Kritiskt', cls: 'crit' } };
const GATE_CRITERIA = ['Leverabler för nästa fas kända och accepterade', 'Resurser för nästa fas säkrade', 'Risker under kontroll', 'Budget under kontroll', 'Projektspecifika frågor lösta'];
const openChecklist = col => openGenChecklist(col);

/* =========================================================
   NexusOrdo bas (#75): egna gater och generisk gate-checklista – gränssnitt
   ⋯ → 🚩 Gater… (openGates) och ☑ Gate-checklista… (openGenChecklist). Rena funktioner: planGates, taskGate, genSummary m.fl.
   ========================================================= */
const genGateTask = (p, g) => g ? gateMsOf(p.tasks, planGates(p), g) : null;
const genGateWk = (p, g) => { const t = genGateTask(p, g); return t && t.end ? ` · ${fmtDayY(toDay(t.end))} (${fmtYYWW(toDay(t.end))})` : ''; };
// Gaterna sparas i planen första gången de ändras (härledda gater får då sina id)
const ensureGates = p => { if (!Array.isArray(p.settings.gates)) p.settings.gates = planGates(p); return p.settings.gates; };

function openGates() {
  if (!plan || plan.synthetic) return toast(tr('Öppna en plan först'));
  const p = plan;
  const ms = p.tasks.filter(t => t.milestone).sort((a, b) => (toDay(a.end) ?? 1e9) - (toDay(b.end) ?? 1e9));
  const cur = planGates(p);
  const work = cur.map(g => ({ ...g, ms: (genGateTask(p, g) || {}).id || '' }));
  const removed = [];
  const draw = () => {
    const box = $('#gtBody'); if (!box) return;
    box.innerHTML = `<p class="tpl-hint">${tr('Gater är beslutspunkter i planen. Namn och kod väljer du själv, t.ex. G1 Start eller Beslut 2. Koppla varje gate till en milstolpe – den visas som romb med beredskap från gate-checklistan.')}</p>
      ${work.length ? `<div class="gt-list">${work.map((g, i) => `<div class="gt-row" data-i="${i}">
        <input type="text" class="gt-code" data-f="code" value="${esc(g.code)}" maxlength="24" placeholder="${tr('Kod')}" aria-label="${tr('Kod')}">
        <input type="text" class="gt-name" data-f="name" value="${esc(g.name)}" maxlength="120" placeholder="${tr('Namn')}" aria-label="${tr('Namn')}">
        <select data-f="ms" aria-label="${tr('Milstolpe')}"><option value="">${tr('– ingen milstolpe –')}</option>${ms.map(t => `<option value="${esc(t.id)}" ${t.id === g.ms ? 'selected' : ''}>${esc(t.name)}${t.end ? ' · ' + fmtYYWW(toDay(t.end)) : ''}</option>`).join('')}</select>
        <span class="gt-n">${tr('{n} punkter', { n: genItems(p.settings, g.id).length })}</span>
        <span class="gt-x"><button class="icon-btn" data-mv="-1" title="${tr('Flytta upp')}" ${i ? '' : 'disabled'}>↑</button><button class="icon-btn" data-mv="1" title="${tr('Flytta ned')}" ${i < work.length - 1 ? '' : 'disabled'}>↓</button><button class="icon-btn" data-rm title="${tr('Ta bort gate')}">🗑</button></span>
      </div>`).join('')}</div>` : `<p><i>${tr('Planen har inga gater ännu.')}</i></p>`}
      <button class="btn ghost small" id="gtAdd">${tr('+ Ny gate')}</button>`;
  };
  const read = () => $$('#gtBody .gt-row').forEach(r => { const g = work[+r.dataset.i]; $$('[data-f]', r).forEach(inp => { g[inp.dataset.f] = inp.value.trim(); }); });
  const done = dialog({ title: tr('Gater – {name}', { name: esc(p.name) }), wide: true, body: '<div id="gtBody" class="gt"></div>',
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara'), value: 'ok', keep: true }],
    onButton: async (v, close) => {
      read();
      if (work.some(g => !g.code && !g.name)) return toast(tr('Varje gate behöver en kod eller ett namn'));
      const codes = work.map(g => lc(g.code || g.name));
      if (codes.some((c, i) => codes.indexOf(c) !== i)) return toast(tr('Två gater har samma kod'));
      close(v);
    },
    onBody: e => {
      const b = e.target.closest('button'); if (!b) return;
      read();
      if (b.id === 'gtAdd') { work.push({ id: uid(), code: 'G' + (work.length + 1), name: '', ms: '' }); draw(); const r = $$('#gtBody .gt-row').pop(); if (r) $('.gt-name', r).focus(); return; }
      const i = +b.closest('.gt-row').dataset.i;
      if (b.dataset.mv) { const j = i + +b.dataset.mv; [work[i], work[j]] = [work[j], work[i]]; }
      if (b.dataset.rm != null) removed.push(...work.splice(i, 1));
      draw();
    } });
  draw();
  done.then(async v => {
    if (v !== 'ok') return;
    const lost = removed.filter(g => cur.some(c => c.id === g.id) && (genItems(p.settings, g.id).length || Object.keys(((p.settings.gateChecks || {})[genKey(g.id)]) || {}).length));
    if (lost.length) {
      const ok = await dialog({ title: tr('Ta bort gater?'), body: tr('Gate-checklistan för {names} tas bort med sina punkter och svar. Ångra fungerar.', { names: lost.map(g => `<b>${esc(g.code)}</b>`).join(', ') }),
        buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Ta bort'), value: true, danger: true }] });
      if (!ok) return;
    }
    pushUndo();
    const st = p.settings;
    for (const g of removed) {
      if (st.gateItems) delete st.gateItems[g.id];
      if (st.gateChecks) delete st.gateChecks[genKey(g.id)];
      if (st.gateCriteria) delete st.gateCriteria[genKey(g.id)];
    }
    st.gates = work.map(g => ({ id: g.id, code: (g.code || g.name).slice(0, 24), name: g.name || g.code }));
    // Milstolparnas koppling: vald milstolpe får gateId; en milstolpe som inte längre är vald släpps (Planner-gater behåller t.gate)
    p.tasks.forEach(t => {
      const g = work.find(x => x.ms === t.id);
      if (g) { t.gateId = g.id; t.gate = true; }
      else if (t.gateId && t.gateId !== 'none') { delete t.gateId; if (!t.goalStatus && !t.goals) delete t.gate; }
    });
    scheduleSave(); render();
    toast(tr('Gaterna är sparade'));
  });
}

async function importGateChecklist(file) {
  if (!file || !plan || plan.synthetic) return;
  const p = plan;
  try {
    if (!window.XLSX) throw new Error(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    let rows = null;
    for (const n of wb.SheetNames) {
      try { rows = parseGateChecklist(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })); break; } catch { /* nästa flik */ }
    }
    if (!rows) throw new Error(tr('Hittar inte kolumnerna Gate och Punkt.'));
    if (!rows.length) throw new Error(tr('Filen har inga punkter.'));
    pushUndo();
    const m = mergeGateItems(planGates(p), cleanGateItems(p.settings.gateItems, planGates(p)), rows, uid);
    p.settings.gates = m.gates; p.settings.gateItems = m.items;
    scheduleSave(); render();
    toast(tr('{n} punkter inlästa', { n: m.added }) + (m.newGates.length ? ' · ' + tr('nya gater: {g}', { g: m.newGates.join(', ') }) : '') + (m.dup ? ' · ' + tr('{n} fanns redan', { n: m.dup }) : ''));
    const g = m.gates.find(x => lc(x.code) === lc(rows[0].gate)) || m.gates[0];
    openGenChecklist(g && g.id);
  } catch (e) { dialog({ title: tr('Kunde inte läsa checklistan'), body: esc(e.message), buttons: [{ label: tr('OK'), value: true }] }); }
}

function openGenChecklist(gid) {
  if (!plan || plan.synthetic) return toast(tr('Gate-checklistan finns per plan – öppna en plan'));
  const p = plan;
  const gates = () => planGates(p);
  const okId = id => gates().some(g => g.id === id);
  gid = okId(gid) ? gid : okId(ui.chkCol) ? ui.chkCol : (nextGenGate(p) || gates()[0] || {}).id || null;
  let filter = 'all', showNA = false, undone = false, passing = false, editing = null;
  const mark = () => { if (!undone) { pushUndo(); undone = true; } };
  const save = () => { mark(); scheduleSave(); };
  const gate = () => gates().find(g => g.id === gid) || null;
  const ans = () => { const st = p.settings; st.gateChecks = st.gateChecks || {}; return (st.gateChecks[genKey(gid)] = st.gateChecks[genKey(gid)] || {}); };
  const list = () => { ensureGates(p); const st = p.settings; st.gateItems = st.gateItems || {}; return (st.gateItems[gid] = st.gateItems[gid] || []); };
  const done = dialog({ title: `${tr('Gate-checklista')} – ${esc(p.name)}`, wide: true, body: '<div id="ckBody" class="ck gen"></div>', buttons: [{ label: tr('Stäng'), value: true }] });
  done.then(() => { if (gid) ui.chkCol = gid; const st = p.settings; if (st.gateItems) for (const k of Object.keys(st.gateItems)) if (!st.gateItems[k].length) delete st.gateItems[k]; saveUi(); render(); });

  const passHTML = () => {
    const gt = genGateTask(p, gate());
    if (!gt) return `<div class="ck-pass"><small>${tr('Ingen milstolpe är kopplad till gaten – koppla en i 🚩 Gater… eller i panelen.')}</small></div>`;
    if (gt.actual) return `<div class="ck-pass"><span>✓ ${tr('{gate} passerad vecka {w}', { gate: esc(gate().code), w: `<b>${esc(gt.actual.week)}</b>` })}</span><button class="btn ghost small" id="ckPassClr">${tr('Rensa utfall')}</button></div>`;
    if (!passing) return `<div class="ck-pass"><button class="btn ghost small" id="ckPass">${tr('Markera gate passerad…')}</button></div>`;
    return `<div class="ck-pass"><label for="ckPassWk">${tr('Utfall (vecka)')}</label><input type="text" class="wk" id="ckPassWk" value="${esc(fmtYYWW(proposeActual(gt, todayDay())))}" maxlength="6" inputmode="numeric">
      <button class="btn small" id="ckPassOk">${tr('Spara')}</button><button class="btn ghost small" id="ckPassNo">${tr('Avbryt')}</button></div>`;
  };
  const draw = () => {
    const box = $('#ckBody'); if (!box) return;
    const scroll = box.closest('.m-body').scrollTop;
    const gs = gates(), g = gate();
    const tools = `<button class="btn ghost small" id="ckGates">${tr('🚩 Gater…')}</button><label for="gchkFile" class="btn ghost small">${tr('⇪ Importera punkter (Excel)…')}</label>`;
    if (!g) {
      box.innerHTML = `<p>${tr('Planen har inga gater ännu. Lägg till gater med <b>🚩 Gater…</b> eller markera en milstolpe som gate i panelen. Du kan också läsa in punkter från Excel med kolumnerna <b>Gate</b>, <b>Punkt</b> och <b>Avsnitt</b> – gaterna skapas då.')}</p><div class="ck-tools">${tools}</div>`;
      return;
    }
    const a = ans(), n = genSummary(p.settings, gid), its = genItems(p.settings, gid);
    const crit = ((p.settings.gateCriteria || {})[genKey(gid)]) || [];
    const vis = its.map((i, k) => ({ ...i, k: k + 1 })).filter(i => {
      const x = a[i.id] || {};
      if (x.na && !showNA) return false;
      return filter === 'all' || (filter === 'open' && x.s == null && !x.na) || (filter === 'bad' && (x.s === 50 || x.s === 100));
    });
    const secs = [...new Set(its.map(i => i.sec || ''))];
    const seg = (k, cls) => n.total && n[k] ? `<span class="${cls}" style="width:${n[k] / n.total * 100}%"></span>` : '';
    const row = i => {
      const x = a[i.id] || {}, on = !x.na;
      const txt = editing === i.id ? `<input type="text" class="ck-edit" data-edit value="${esc(i.t)}" maxlength="500">` : `<span class="ck-t" data-ed title="${tr('Klicka för att ändra')}">${esc(i.t)}</span>`;
      return `<div class="ck-row ${on ? '' : 'na'}" data-n="${esc(i.id)}">
        <span class="ck-n">${i.k}</span>${txt}
        <span class="ck-st">${on ? [0, 50, 100].map(v => `<button class="ck-b ${CHK_ST[v].cls} ${x.s === v ? 'on' : ''}" data-s="${v}" title="${tr(CHK_ST[v].label)}">${tr(CHK_ST[v].label)}</button>`).join('') : `<i>${tr('Gäller inte projektet')}</i>`}</span>
        <span class="ck-x"><button class="icon-btn" data-cmt title="${tr('Kommentar')}">${x.c ? '💬' : '＋'}</button><button class="icon-btn" data-na title="${on ? tr('Gäller inte projektet') : tr('Gäller projektet')}">${on ? '⊘' : '↺'}</button><button class="icon-btn" data-mv="-1" title="${tr('Flytta upp')}">↑</button><button class="icon-btn" data-mv="1" title="${tr('Flytta ned')}">↓</button><button class="icon-btn" data-del title="${tr('Ta bort punkten')}">🗑</button></span>
        ${x.c != null && (x.c || x.edit) ? `<input type="text" class="ck-c" data-c value="${esc(x.c)}" placeholder="${tr('Kommentar')}">` : ''}</div>`;
    };
    const body = secs.map(s => {
      const rows = vis.filter(i => (i.sec || '') === s);
      if (!rows.length) return '';
      const real = its.filter(i => (i.sec || '') === s && !(a[i.id] || {}).na);
      const ok = real.filter(i => (a[i.id] || {}).s === 0).length;
      return secs.length > 1 || s ? `<details class="ck-sec" open><summary><b>${esc(s || tr('Övriga punkter'))}</b><span>${tr('{a}/{b} klara', { a: ok, b: real.length })}</span></summary>${rows.map(row).join('')}</details>` : rows.map(row).join('');
    }).join('');
    box.innerHTML = `
      <div class="ck-tabs gen">${gs.map(x => { const m = genSummary(p.settings, x.id); return `<button data-col="${esc(x.id)}" class="${x.id === gid ? 'on' : ''}" title="${esc(x.name)}"><b>${esc(x.code)}</b><small>${m.total ? m.pct + ' %' : '–'}${m.crit ? ' · ' + tr('{n} röda', { n: m.crit }) : ''}</small></button>`; }).join('')}</div>
      <div class="ck-sum"><div><b>${esc(g.code)}</b>${g.name && g.name !== g.code ? ' ' + esc(g.name) : ''}${genGateWk(p, g)}: ${tr('<b>{ok} av {total}</b> klara · {warn} påverkar · {crit} kritiska · {open} ej bedömda', { ok: n.ok, total: n.total, warn: n.warn, crit: n.crit, open: n.open })}</div>
        <div class="ck-bar">${seg('ok', 'ok')}${seg('warn', 'warn')}${seg('crit', 'crit')}</div>${passHTML()}</div>
      <div class="ck-crit"><b>${tr('Gate-kriterier inför {gate}', { gate: esc(g.code) })}</b>${GATE_CRITERIA.map((c, k) => `<label><span>${tr(c)}</span>
        <span class="ck-ok"><button data-gk="${k}" data-v="1" class="${crit[k] === true ? 'on ok' : ''}">${tr('OK')}</button><button data-gk="${k}" data-v="0" class="${crit[k] === false ? 'on crit' : ''}">${tr('Ej OK')}</button></span></label>`).join('')}</div>
      <div class="ck-tools">
        <span class="seg small">${[['all', 'Alla'], ['open', 'Ej bedömda'], ['bad', 'Gula och röda']].map(([v, l]) => `<button data-f="${v}" class="${filter === v ? 'on' : ''}">${tr(l)}</button>`).join('')}</span>
        <label class="chk"><input type="checkbox" id="ckNA" ${showNA ? 'checked' : ''}> ${tr('Visa punkter som inte gäller')}</label>
        ${tools}
      </div>
      ${body || `<p>${its.length ? tr('Inga punkter matchar filtret.') : tr('Inga punkter för {gate} ännu. Skriv en punkt nedan eller läs in från Excel.', { gate: esc(g.code) })}</p>`}
      <div class="ck-addrow"><input type="text" id="ckNew" placeholder="${tr('Ny punkt…')}" maxlength="500"><input type="text" id="ckNewSec" list="ckSecs" placeholder="${tr('Avsnitt (valfritt)')}" maxlength="120"><datalist id="ckSecs">${secs.filter(Boolean).map(s => `<option value="${esc(s)}">`).join('')}</datalist><button class="btn ghost small" id="ckAdd">${tr('+ Lägg till')}</button></div>
      <p class="ck-src">${tr('Egen checklista för planen. Skala: Klart, Påverkar tid, pengar eller resurser, Kritiskt. Följer med i exporten och när planen sparas som mall (📐 Spara som mall…). Excel för inläsning: kolumnerna Gate, Punkt och Avsnitt.')}</p>`;
    box.closest('.m-body').scrollTop = scroll;
    const ed = $('#ckBody [data-edit]'); if (ed) { ed.focus(); ed.select(); }
  };
  const addItem = () => {
    const t = ($('#ckNew').value || '').replace(/\s+/g, ' ').trim(), sec = ($('#ckNewSec').value || '').replace(/\s+/g, ' ').trim();
    if (!t) return $('#ckNew').focus();
    mark(); list().push({ id: uid(), t: t.slice(0, 500), ...(sec ? { sec: sec.slice(0, 120) } : {}) }); save();
    draw(); const s = $('#ckNewSec'); if (s) s.value = sec; const inp = $('#ckNew'); if (inp) inp.focus();
  };
  const finishEdit = ok => {
    const inp = $('#ckBody [data-edit]'); if (!inp || !editing) return;
    const it = list().find(i => i.id === editing), v = inp.value.replace(/\s+/g, ' ').trim();
    editing = null;
    if (ok && it && v && v !== it.t) { mark(); it.t = v.slice(0, 500); save(); }
    draw();
  };
  $('#ckBody').addEventListener('click', e => {
    if (e.target.closest('[data-ed]')) { editing = e.target.closest('.ck-row').dataset.n; return draw(); }
    const b = e.target.closest('button'); if (!b) return;
    const row = b.closest('.ck-row'), id = row && row.dataset.n;
    if (b.id === 'ckGates') { ui.chkCol = gid; $('#modal').hidden = true; $('#modal').innerHTML = ''; return openGates(); }
    if (b.dataset.col) { gid = b.dataset.col; passing = false; editing = null; return draw(); }
    if (b.dataset.f) { filter = b.dataset.f; return draw(); }
    if (b.id === 'ckAdd') return addItem();
    if (b.id === 'ckPass' || b.id === 'ckPassNo') { passing = b.id === 'ckPass'; draw(); const w = $('#ckPassWk'); if (w) { w.focus(); w.select(); } return; }
    if (b.id === 'ckPassClr') { mark(); delete genGateTask(p, gate()).actual; save(); return draw(); }
    if (b.id === 'ckPassOk') {
      const gt = genGateTask(p, gate()), w = $('#ckPassWk'), d = actualDayFromWeek(w.value, proposeActual(gt, todayDay()));
      if (d == null) { w.classList.add('bad'); return toast(tr('Okänd vecka: {v}. Skriv ÅÅVV, t.ex. 2645', { v: w.value })); }
      mark(); gt.actual = mkActual(d, 'manual'); passing = false; save();
      toast(tr('{gate} markerad som passerad vecka {w}', { gate: gate().code, w: gt.actual.week }));
      return draw();
    }
    if (b.dataset.gk != null) {
      mark(); ensureGates(p);
      p.settings.gateCriteria = p.settings.gateCriteria || {};
      const arr = p.settings.gateCriteria[genKey(gid)] = p.settings.gateCriteria[genKey(gid)] || [null, null, null, null, null];
      const v = b.dataset.v === '1'; arr[+b.dataset.gk] = arr[+b.dataset.gk] === v ? null : v;
      save(); return draw();
    }
    if (!id) return;
    const L = list(), k = L.findIndex(i => i.id === id);
    if (b.dataset.mv) { const j = k + +b.dataset.mv; if (j < 0 || j >= L.length) return; mark(); [L[k], L[j]] = [L[j], L[k]]; save(); return draw(); }
    if (b.dataset.del != null) { mark(); L.splice(k, 1); delete ans()[id]; save(); return draw(); }
    const x = ans()[id] = ans()[id] || {};
    if (b.dataset.s != null) { mark(); ensureGates(p); const v = +b.dataset.s; if (x.s === v) delete x.s; else x.s = v; x.at = new Date().toISOString().slice(0, 10); save(); }
    else if (b.dataset.cmt != null) { x.c = x.c || ''; x.edit = true; draw(); const inp = $(`.ck-row[data-n="${CSS.escape(id)}"] .ck-c`); if (inp) inp.focus(); return; }
    else if (b.dataset.na != null) { mark(); ensureGates(p); if (x.na) delete x.na; else x.na = true; save(); }
    if (x.s == null && !x.c && !x.na) delete ans()[id];
    draw();
  });
  $('#ckBody').addEventListener('keydown', e => {
    if (e.target.id === 'ckNew' || e.target.id === 'ckNewSec') { if (e.key === 'Enter') { e.preventDefault(); addItem(); } return; }
    if (e.target.dataset.edit != null) { if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; draw(); } }
  });
  $('#ckBody').addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.edit != null) setTimeout(() => finishEdit(true), 0); });
  $('#ckBody').addEventListener('change', e => {
    if (e.target.id === 'ckNA') { showNA = e.target.checked; draw(); }
    if (e.target.dataset.c != null) {
      mark(); ensureGates(p);
      const id = e.target.closest('.ck-row').dataset.n, x = ans()[id] = ans()[id] || {};
      x.c = e.target.value.trim(); delete x.edit;
      if (!x.c && x.s == null && !x.na) delete ans()[id];
      save(); draw();
    }
  });
  draw();
  offerPageTourSoon('checklist');
}

/* =========================================================
   Risklista (#38)
   Sparas i planen: settings.risks = [{ id, no, desc, area, p, c, prev, cons, ready ('YYWW' eller 'YYWW/YYWW'), owner,
   status 'G'|'Y'|'R', taskId, gate, createdAt, updatedAt, closed }]. Påverkas inte av import från Planner.
   Riskvärde = sannolikhet × konsekvens (1–25). Färgbanden för värdet är NexusOrdos egna (mallen har inga);
   status (grön/gul/röd) sätts av projektledaren och är skild från värdet.
   ========================================================= */
const RISK_AREAS = ['Technical', 'Quality', 'Time', 'Resources', 'Performance', 'Finances', 'External'];
const RISK_AREA_SV = { Technical: 'Teknik', Quality: 'Kvalitet', Time: 'Tid', Resources: 'Resurser', Performance: 'Prestanda', Finances: 'Ekonomi', External: 'Externt' };
const RISK_P_TXT = ['Mycket liten', 'Liten', 'Medel', 'Hög', 'Mycket hög'];
const RISK_C_TXT = ['Mycket liten', 'Liten', 'Medel', 'Stor', 'Mycket stor'];
const RISK_ST = { G: 'Grön – OK', Y: 'Gul – pågår', R: 'Röd – inte OK' };
const riskValue = r => (+r.p || 0) * (+r.c || 0);
const riskBand = v => !v ? null : v >= 15 ? 'red' : v >= 10 ? 'orange' : v >= 5 ? 'yellow' : 'green';
const riskHigh = r => !r.closed && (riskValue(r) >= 15 || r.status === 'R');
const riskReadyDay = r => { const w = String(r.ready || '').split('/')[0].trim(); return w ? parseWeek(w, true) : null; };
function riskSort(risks, key = 'value', dir = -1) {
  const val = r => key === 'value' ? riskValue(r) : key === 'no' ? +r.no || 0 : key === 'ready' ? (riskReadyDay(r) ?? 1e9)
    : key === 'status' ? ({ R: 0, Y: 1, G: 2 }[r.status] ?? 3) : String(r[key] || '').toLowerCase();
  return [...risks].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || (+a.no || 0) - (+b.no || 0); });
}
const riskTop5 = risks => riskSort(risks.filter(r => !r.closed), 'value', -1).slice(0, 5);
// Åtgärder med "klar senast" passerad (över) eller inom två veckor (snart); stängda risker räknas inte
function riskDue(risks, today) {
  const soon = [], over = [];
  for (const r of risks) {
    if (r.closed) continue;
    const d = riskReadyDay(r);
    if (d == null) continue;
    if (d < today) over.push(r); else if (d <= today + 14) soon.push(r);
  }
  return { soon, over };
}
const planRisks = (p = plan) => (p && p.settings && p.settings.risks) || [];

/* =========================================================
   Milstolpetrend (#41) – MTA. Ögonblicksbilder av milstolparnas datum sparas i settings.snapshots
   [{ at, src: import|update|manual|baseline, ms: { taskId: 'YYYY-MM-DD' } }] vid import, uppdatering och för hand.
   ========================================================= */
const SNAP_CAP = 60;
const MTA_GATE_RE = /\b(G[1-4])\b/i;
// Ögonblicksbild av alla milstolpar med datum
function snapshotOf(p, at, src) {
  const ms = {};
  for (const t of (p && p.tasks) || []) if (t.milestone && t.end) ms[t.id] = t.end;
  return { at, src, ms };
}
// Lägg till: samma dag och samma datum ersätter den senaste; taket behåller alltid den första (baslinjen)
function addSnapshot(list, snap, cap = SNAP_CAP) {
  const out = [...(list || [])];
  const last = out[out.length - 1];
  const same = (a, b) => { const ka = Object.keys(a || {}), kb = Object.keys(b || {}); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };
  if (last && last.at === snap.at && same(last.ms, snap.ms)) out[out.length - 1] = snap;
  else out.push(snap);
  if (out.length > cap) out.splice(1, out.length - cap);
  return out;
}
// Trenden för en milstolpe: punkter, antal flyttar och total förskjutning i dagar
function msTrend(snaps, id) {
  const points = (snaps || []).filter(s => s.ms && s.ms[id]).map(s => ({ at: s.at, d: s.ms[id], src: s.src }));
  let moves = 0, lastMove = null;
  for (let i = 1; i < points.length; i++) if (points[i].d !== points[i - 1].d) { moves++; lastMove = points[i].at; }
  const totalShiftDays = points.length ? toDay(points[points.length - 1].d) - toDay(points[0].d) : 0;
  return { points, moves, lastMove, totalShiftDays };
}
// Baslinje för planer utan ögonblicksbilder: datumen före senaste importen (t.moved) eller vid importen (t.imp)
function baselineFromImp(tasks, importedAt) {
  const ms = {};
  for (const t of tasks || []) {
    if (!t.milestone) continue;
    const d = (t.moved && t.moved.fromEnd) || (t.imp && t.imp.end);
    if (d) ms[t.id] = d;
  }
  if (!Object.keys(ms).length) return null;
  return { at: String(importedAt || '').slice(0, 10) || fromDay(todayDay()), src: 'baseline', ms };
}
// Se till att planen har en historik innan den ändras; returnerar true om något lades till
function ensureSnapshots(p) {
  if (!p || p.synthetic) return false;
  const s = p.settings;
  if (s.snapshots && s.snapshots.length) return false;
  const base = baselineFromImp(p.tasks, p.imported_at);
  let list = base ? [base] : [];
  const cur = snapshotOf(p, fromDay(todayDay()), base ? 'update' : 'import');
  if (Object.keys(cur.ms).length && (!base || JSON.stringify(base.ms) !== JSON.stringify(cur.ms))) list = addSnapshot(list, cur);
  s.snapshots = list;
  return list.length > 0;
}
function recordSnapshot(p, src) {
  if (!p || p.synthetic) return;
  const snap = snapshotOf(p, fromDay(todayDay()), src);
  if (!Object.keys(snap.ms).length) return;
  p.settings.snapshots = addSnapshot(p.settings.snapshots, snap);
}
const mtaKind = t => isGateMs(t) ? 'gate' : 'other';
const fmtShiftW = d => { const w = Math.round(d / 7); return w === 0 ? (d ? (d > 0 ? '+' : '') + d + ' d' : '±0') : (w > 0 ? '+' : '') + w + ' ' + tr('v'); };

function openTrend(focusId) {
  if (!plan || plan.synthetic) return toast(tr('Milstolpetrenden finns per plan – öppna planen'));
  const p = plan;
  if (ensureSnapshots(p)) scheduleSave();
  const ms = p.tasks.filter(t => t.milestone && t.end).sort((a, b) => toDay(a.end) - toDay(b.end));
  if (!ms.length) return toast(tr('Planen har inga milstolpar med datum'));
  const sel = new Set(ms.filter(t => mtaKind(t) === 'gate').map(t => t.id));
  if (focusId) sel.add(focusId);
  if (!sel.size) ms.slice(0, 6).forEach(t => sel.add(t.id));
  const done = dialog({ title: tr('Milstolpetrend – {name}', { name: esc(p.name) }), wide: true, body: '<div id="mtaBody" class="mta"></div>',
    buttons: [{ label: tr('Spara ögonblicksbild'), value: 'snap', ghost: true, keep: true }, { label: tr('Stäng'), value: true }],
    onButton: v => {
      if (v !== 'snap') return;
      pushUndo(); recordSnapshot(p, 'manual'); scheduleSave(); draw();
      toast(tr('Ögonblicksbild sparad ({d})', { d: fmtYYWW(todayDay()) }));
    } });
  $('#modal .modal').classList.add('xl');
  done.then(() => render());
  const colorFor = (t, i) => {
    const m = String(t.name || '').toUpperCase().match(MTA_GATE_RE);
    if (m) { const ph = PMI_PHASES.find(x => x.gates.includes(m[1].toUpperCase())); if (ph) return edgeOf(ph.col); }
    return PAL.series[i % PAL.series.length];
  };

  const draw = () => {
    const box = $('#mtaBody'); if (!box) return;
    const snaps = p.settings.snapshots || [];
    const lines = ms.filter(t => sel.has(t.id)).map((t, i) => ({ t, col: colorFor(t, i), ...msTrend(snaps, t.id) })).filter(l => l.points.length);
    const W = Math.max(520, Math.min(1100, (box.clientWidth || 1000) - 250)), H = 380, L = 70, R = 16, T = 14, B = 46;
    const td = todayDay();
    const xs = snaps.map(s => toDay(s.at)).concat([td]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    if (x1 - x0 < 28) { x0 -= 14; x1 += 14; }
    const ys = lines.flatMap(l => l.points.map(pt => toDay(pt.d)));
    let y0 = Math.min(x0, ...(ys.length ? ys : [x0])), y1 = Math.max(x1, ...(ys.length ? ys : [x1]));
    const pad = Math.max(14, (y1 - y0) * .06); y0 -= pad; y1 += pad;
    const pad2 = Math.max(7, (x1 - x0) * .04); x0 -= pad2; x1 += pad2;
    const X = d => L + (d - x0) / (x1 - x0) * (W - L - R), Y = d => H - B - (d - y0) / (y1 - y0) * (H - T - B);
    const P = PAL;
    const monthTicks = (a, b, maxN) => { let out = [], m = monthStart(a); while (m <= b) { if (m >= a) out.push(m); m = addMonths(m, 1); } const step = Math.ceil(out.length / maxN); return out.filter((_, i) => i % step === 0); };
    const lab = d => `${MONTHS[dObj(d).getUTCMonth()]} ${String(dObj(d).getUTCFullYear()).slice(2)}`;
    let svg = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="${P.surface}" stroke="${P.grid}"/>`;
    for (const m of monthTicks(y0, y1, 9)) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(m)}" y2="${Y(m)}" stroke="${P.grid}"/><text x="${L - 8}" y="${Y(m) + 4}" font-size="11" text-anchor="end" fill="${P.muted}">${lab(m)}</text>`;
    for (const m of monthTicks(x0, x1, 10)) svg += `<line x1="${X(m)}" x2="${X(m)}" y1="${T}" y2="${H - B}" stroke="${P.grid}"/><text x="${X(m)}" y="${H - B + 16}" font-size="11" text-anchor="middle" fill="${P.muted}">${lab(m)}</text>`;
    // Diagonalen: prognos = rapportdatum (milstolpen nådd)
    const da = Math.max(x0, y0), db = Math.min(x1, y1);
    if (db > da) svg += `<line x1="${X(da)}" y1="${Y(da)}" x2="${X(db)}" y2="${Y(db)}" stroke="${P.muted}" stroke-dasharray="6 4"/><text x="${X(db) - 4}" y="${Y(db) + 14}" font-size="10.5" text-anchor="end" fill="${P.muted}">${tr('nådd')}</text>`;
    svg += `<line x1="${X(td)}" x2="${X(td)}" y1="${T}" y2="${H - B}" stroke="${P.today}" stroke-width="2"/><text x="${X(td) + 4}" y="${T + 12}" font-size="10.5" fill="${P.today}">${tr('Idag')}</text>`;
    svg += `<text x="${(L + W - R) / 2}" y="${H - 8}" font-size="11.5" text-anchor="middle" fill="${P.text2}">${tr('Rapportdatum (ögonblicksbild)')}</text>`;
    svg += `<text x="14" y="${(T + H - B) / 2}" font-size="11.5" text-anchor="middle" fill="${P.text2}" transform="rotate(-90 14 ${(T + H - B) / 2})">${tr('Prognos för milstolpen')}</text>`;
    for (const l of lines) {
      const pts = l.points.map(pt => `${X(toDay(pt.at)).toFixed(1)},${Y(toDay(pt.d)).toFixed(1)}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${l.col}" stroke-width="2.25" stroke-linejoin="round"/>`;
      l.points.forEach((pt, i) => {
        const dd = i ? toDay(pt.d) - toDay(l.points[i - 1].d) : 0;
        const tip = `${l.t.name} · ${fmtYYWW(toDay(pt.d))} · ${fmtDayY(toDay(pt.d))}${i ? ' · ' + fmtShiftW(dd) : ''}\n${tr('Rapport')}: ${fmtDayY(toDay(pt.at))} (${fmtYYWW(toDay(pt.at))})${pt.src === 'baseline' ? ' · ' + tr('före senaste importen') : ''}`;
        svg += `<circle class="mta-pt" cx="${X(toDay(pt.at))}" cy="${Y(toDay(pt.d))}" r="4.5" fill="${dd > 0 ? P.surface : l.col}" stroke="${l.col}" stroke-width="2"><title>${esc(tip)}</title></circle>`;
      });
      const lp = l.points[l.points.length - 1];
      svg += `<text x="${Math.min(W - R - 4, X(toDay(lp.at)) + 8)}" y="${Y(toDay(lp.d)) + 4}" font-size="11" font-weight="600" fill="${P.text}" text-anchor="${X(toDay(lp.at)) + 60 > W - R ? 'end' : 'start'}">${esc(truncate(l.t.name, 11, 600, 120))}</text>`;
    }
    const rows = lines.slice().sort((a, b) => b.totalShiftDays - a.totalShiftDays);
    const cls = d => d >= 28 ? 'bad' : d >= 7 ? 'warn' : '';
    const group = (k, label) => { const g = ms.filter(t => mtaKind(t) === k); return g.length ? `<div class="mta-grp"><b>${label}</b>${g.map(t => `<label class="chk"><input type="checkbox" data-ms="${esc(t.id)}" ${sel.has(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}</div>` : ''; };
    box.innerHTML = `
      <p class="mta-lead">${tr('Hur milstolparnas prognos har flyttats mellan uppdateringarna. En linje uppåt betyder att milstolpen har skjutits fram. Ögonblicksbilder sparas vid import, vid uppdatering från Excel och med knappen nedan ({n} sparade).', { n: snaps.length })}</p>
      <div class="mta-wrap">
        <div class="mta-chart"><svg id="mtaSvg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" font-family="${FONT}">${svg}</svg>
          ${lines.length ? '' : `<p class="mta-empty">${tr('Välj milstolpar till höger.')}</p>`}
          ${snaps.length < 2 ? `<p class="mta-empty">${tr('Trenden syns efter nästa uppdatering från Excel – eller spara en ögonblicksbild nu.')}</p>` : ''}</div>
        <div class="mta-pick">${group('gate', tr('Gater'))}${group('other', tr('Övriga milstolpar'))}</div>
      </div>
      <table class="mta-list" id="mtaList"><thead><tr><th>${tr('Milstolpe')}</th><th>${tr('Prognos nu')}</th><th>${tr('Första')}</th><th>${tr('Förskjutning')}</th><th>${tr('Flyttar')}</th><th>${tr('Senast flyttad')}</th></tr></thead><tbody>
        ${rows.map(l => { const f = l.points[0], c = l.points[l.points.length - 1]; return `<tr><td><i style="background:${l.col}"></i>${esc(l.t.name)}</td><td>${fmtDayY(toDay(c.d))} · ${fmtYYWW(toDay(c.d))}</td><td>${fmtYYWW(toDay(f.d))}</td><td class="${cls(l.totalShiftDays)}">${fmtShiftW(l.totalShiftDays)}</td><td>${l.moves}</td><td>${l.lastMove ? fmtDayY(toDay(l.lastMove)) : '–'}</td></tr>`; }).join('') || `<tr><td colspan="6">–</td></tr>`}
      </tbody></table>`;
  };
  $('#mtaBody').addEventListener('change', e => { const id = e.target.dataset.ms; if (id == null) return; if (e.target.checked) sel.add(id); else sel.delete(id); draw(); });
  draw();
}

/* =========================================================
   Burndown (#95) – 📊 Uppföljning → 📉 Burndown… och 📉 på fasraden. Rena funktioner i blocket "Burndown (#95)" (burnSeries, idealLine, backfill …).
   Historiken bakåt (versioner och ögonblicksbilder) räknas bara i minnet – visningen sparar aldrig något.
   ========================================================= */
// Dagens värden sparas med planen (scheduleSave, savePlanNow, applyMerge, createPlan)
function recordBurn(p) {
  if (!p || p.synthetic || !p.settings) return;
  p.settings.burn = burnRecord(p.settings.burn, p.tasks || [], fromDay(todayDay()));
}
const BURN_LBL = { hours: 'Timmar', checks: 'Checklistpunkter', points: 'Aktivitetspoäng' };
const burnUnit = m => m === 'hours' ? tr('timmar') : m === 'checks' ? tr('punkter') : tr('poäng');
const fmtBurn = (v, m) => v == null ? '–' : m === 'hours' ? fmtH(v) : m === 'checks' ? String(Math.round(v)) : numFmt(v);
const burnScopeName = scope => scope === 'plan' ? tr('Hela planen') : scope === 'program' ? tr('Hela programmet') : bName(String(scope).slice(3));
// Historik bakåt för en plan: ögonblicksbilderna direkt, versionerna när de har lästs (async)
async function burnExtra(p, withVersions = true) {
  let versions = [];
  if (withVersions) try { versions = (await verStore().list(p.id, 100)).filter(v => !v.kind || v.kind === 'plan'); } catch (e) { console.warn('[NexusOrdo] burndown: versioner', e.message); }
  return backfill({ versions, snapshots: (p.settings && p.settings.snapshots) || [], tasks: p.tasks || [], today: todayDay() });
}
// Diagrammet som SVG-innehåll. s = burnSeries/programBurn().sum. → { svg (utan <svg>), W, H }
function burnChartSVG(s, { W = 900, H = 340, title = null } = {}) {
  const P = PAL, td = todayDay(), m = s.measure, top = title ? 46 : 0;
  const lgTxt = [tr('Kvar'), tr('Ideal (arbetsdagar)'), tr('Totalt (omfång)'), tr('Uppskattat'), tr('Ökat omfång')], lgW = t => 34 + t.length * 6.2;
  const L = 62, R = 16, T = 14 + top, twoRows = lgTxt.reduce((a, t) => a + lgW(t), 0) > W - L - R, B = twoRows ? 60 : 44;
  const ds = [td, ...s.points.map(p => p.d), ...(s.start != null ? [s.start] : []), ...(s.end != null ? [s.end] : [])];
  let x0 = Math.min(...ds), x1 = Math.max(...ds);
  if (x1 - x0 < 14) { x0 -= 3; x1 = x0 + 17; }
  const padX = Math.max(1, Math.round((x1 - x0) * .02)); x0 -= padX; x1 += padX;
  const vmax = Math.max(1e-9, ...s.points.map(p => Math.max(p.remaining, p.total)), ...s.ideal.map(p => p.v));
  const step = (() => { const raw = vmax / 5, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow; })();
  const y1 = Math.ceil(vmax * 1.04 / step) * step;
  const X = d => L + (d - x0) / (x1 - x0) * (W - L - R), Y = v => H - B - v / y1 * (H - T - B);
  let svg = title ? `<text x="16" y="26" font-size="16" font-weight="700" fill="${P.text}">${esc(title.main)}</text><text x="16" y="42" font-size="11.5" fill="${P.muted}">${esc(title.sub)}</text>` : '';
  svg += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="${P.surface}" stroke="${P.grid}"/>`;
  for (let i = 0; i * step <= y1 + 1e-9; i++) { const v = i * step; svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${P.grid}"/><text x="${L - 8}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="${P.muted}">${esc(numFmt(v))}</text>`; }
  // Tidsaxel: veckor (måndagar, ÅÅVV) för korta perioder, annars månader
  const span = x1 - x0;
  if (span <= 140) {
    const every = Math.max(1, Math.ceil(span / 7 / 12));
    let k = 0;
    for (let d = x0 + ((7 - weekday(x0)) % 7); d <= x1; d += 7, k++) if (k % every === 0) svg += `<line x1="${X(d)}" x2="${X(d)}" y1="${T}" y2="${H - B}" stroke="${P.grid}"/><text x="${X(d)}" y="${H - B + 16}" font-size="11" text-anchor="middle" fill="${P.muted}">${tr('v')}${isoWeek(d)}</text>`;
  } else {
    let ms = [], mm = monthStart(x0); while (mm <= x1) { if (mm >= x0) ms.push(mm); mm = addMonths(mm, 1); }
    const every = Math.ceil(ms.length / 10);
    ms.filter((_, i) => i % every === 0).forEach(d => { svg += `<line x1="${X(d)}" x2="${X(d)}" y1="${T}" y2="${H - B}" stroke="${P.grid}"/><text x="${X(d)}" y="${H - B + 16}" font-size="11" text-anchor="middle" fill="${P.muted}">${MONTHS[dObj(d).getUTCMonth()]} ${String(dObj(d).getUTCFullYear()).slice(2)}</text>`; });
  }
  svg += `<text x="14" y="${(T + H - B) / 2}" font-size="11.5" text-anchor="middle" fill="${P.text2}" transform="rotate(-90 14 ${(T + H - B) / 2})">${esc(tr('Kvar ({unit})', { unit: burnUnit(m) }))}</text>`;
  // Omfång (totalt) som tunn trappa, idealkurvan streckad
  const stepPts = key => s.points.map((p, i) => i ? `${X(p.d).toFixed(1)},${Y(s.points[i - 1][key]).toFixed(1)} ${X(p.d).toFixed(1)},${Y(p[key]).toFixed(1)}` : `${X(p.d).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ');
  if (s.points.length > 1) svg += `<polyline class="bd-total" points="${stepPts('total')}" fill="none" stroke="${P.muted}" stroke-width="1.25" stroke-dasharray="2 3"/>`;
  if (s.ideal.length) svg += `<polyline class="bd-ideal" points="${s.ideal.map(p => `${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${P.text2}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  // Ökat omfång
  for (const c of s.changes || []) svg += `<line x1="${X(c.d)}" x2="${X(c.d)}" y1="${T}" y2="${H - B}" stroke="${P.critical}" stroke-dasharray="3 3" opacity=".7"/><path class="bd-chg" d="M${X(c.d) - 6},${T + 1} L${X(c.d) + 6},${T + 1} L${X(c.d)},${T + 10} Z" fill="${P.critical}"><title>${esc(tr('Omfånget ökade {a} → {b} ({d})', { a: fmtBurn(c.from, m), b: fmtBurn(c.to, m), d: fmtDayY(c.d) }))}</title></path>`;
  // Idag
  svg += `<line x1="${X(td)}" x2="${X(td)}" y1="${T}" y2="${H - B}" stroke="${P.today}" stroke-width="2"/><text x="${X(td) + 4}" y="${T + 22}" font-size="10.5" fill="${P.today}">${tr('Idag')}</text>`;
  // Faktiskt kvar: trappa, uppskattade punkter ofyllda
  const col = P.series[0];
  svg += `<polyline class="bd-actual" points="${stepPts('remaining')}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>`;
  const srcTxt = { rec: tr('sparat värde'), ver: tr('från en version'), est: tr('uppskattat'), now: tr('nu') };
  for (const p of s.points) svg += `<circle class="bd-pt" cx="${X(p.d)}" cy="${Y(p.remaining)}" r="${p.src === 'now' ? 5 : 3.5}" fill="${p.src === 'est' ? P.surface : col}" stroke="${col}" stroke-width="2"><title>${esc(`${fmtDayY(p.d)} (${fmtYYWW(p.d)}): ${tr('kvar')} ${fmtBurn(p.remaining, m)} ${tr('av')} ${fmtBurn(p.total, m)} · ${srcTxt[p.src] || ''}`)}</title></circle>`;
  // Förklaring
  const lg = [`<line x1="0" x2="18" y1="0" y2="0" stroke="${col}" stroke-width="2.5"/>`, `<line x1="0" x2="18" y1="0" y2="0" stroke="${P.text2}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
    `<line x1="0" x2="18" y1="0" y2="0" stroke="${P.muted}" stroke-width="1.25" stroke-dasharray="2 3"/>`, `<circle cx="9" cy="0" r="3.5" fill="${P.surface}" stroke="${col}" stroke-width="2"/>`,
    `<path d="M3,-5 L15,-5 L9,4 Z" fill="${P.critical}"/>`];
  let lx = L, ly = H - (twoRows ? 26 : 10);
  lg.forEach((g, i) => { const t = lgTxt[i]; if (lx + lgW(t) > W - R && lx > L) { lx = L; ly += 16; } svg += `<g transform="translate(${lx},${ly})">${g}<text x="24" y="4" font-size="11" fill="${P.text2}">${esc(t)}</text></g>`; lx += lgW(t); });
  return { svg, W, H };
}
// Velocity per sprint som stapeldiagram. v = velocity(), sel = vald sprint (bucket)
function velocitySVG(v, m, sel, W = 900, H = 170) {
  const P = PAL, L = 62, R = 16, T = 16, B = 34, rows = v.rows;
  if (!rows.length) return '';
  const vmax = Math.max(1e-9, ...rows.map(r => r.done), v.avg || 0), y1 = vmax * 1.15;
  const bw = Math.min(46, (W - L - R) / rows.length * .62), gap = (W - L - R) / rows.length;
  const Y = x => H - B - x / y1 * (H - T - B);
  let svg = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="${P.surface}" stroke="${P.grid}"/>`;
  rows.forEach((r, i) => {
    const cx = L + gap * i + gap / 2, y = Y(r.done), on = r.bucket === sel;
    const fill = r.state === 'future' ? 'none' : P.series[0], op = r.state === 'active' ? .45 : 1;
    svg += `<rect class="bd-vbar" data-scope="${esc(burnScopeKey(r.bucket))}" x="${cx - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, H - B - y)}" fill="${fill}" fill-opacity="${op}" stroke="${on ? P.text : P.series[0]}" stroke-width="${on ? 2.5 : 1}" style="cursor:pointer"><title>${esc(`${bName(r.bucket)}: ${tr('klart')} ${fmtBurn(r.done, m)}${r.state === 'active' ? ' · ' + tr('pågår') : r.state === 'future' ? ' · ' + tr('inte startad') : ''}`)}</title></rect>`;
    if (r.state !== 'future') svg += `<text x="${cx}" y="${y - 4}" font-size="10.5" text-anchor="middle" fill="${P.text2}">${esc(fmtBurn(r.done, m))}</text>`;
    svg += `<text x="${cx}" y="${H - B + 15}" font-size="11" text-anchor="middle" fill="${on ? P.text : P.muted}" font-weight="${on ? 700 : 400}">${esc(truncate(bName(r.bucket), 11, 400, gap - 4))}</text>`;
  });
  if (v.avg != null) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v.avg)}" y2="${Y(v.avg)}" stroke="${P.text2}" stroke-dasharray="5 4"/><text x="${W - R - 4}" y="${Y(v.avg) - 4}" font-size="10.5" text-anchor="end" fill="${P.text2}">${esc(tr('medel {v}', { v: fmtBurn(v.avg, m) }))}</text>`;
  return { svg, W, H };
}
const burnSvgDoc = (inner, W, H) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" font-family='${FONT}'>${inner}</svg>`;
// Nyckeltal: kvar, klart, mot idealet idag
function burnStatsHTML(s) {
  const m = s.measure, td = todayDay(), id = s.ideal.length ? (burnAt(s.ideal.map(p => ({ ...p, remaining: p.v })), td) || {}).v : null;
  const pct = s.total > 0 ? Math.round((1 - s.remaining / s.total) * 100) : null;
  const diff = id != null && s.start != null && td >= s.start ? round2(s.remaining - id) : null;
  const rel = diff == null ? '' : Math.abs(diff) < (m === 'hours' ? .5 : m === 'checks' ? .5 : .05) ? tr('i fas med idealet')
    : diff > 0 ? tr('{v} efter idealet', { v: fmtBurn(diff, m) }) : tr('{v} före idealet', { v: fmtBurn(-diff, m) });
  return `<div class="bd-kpis"><div class="kpi"><b>${esc(fmtBurn(s.remaining, m))}</b><span>${tr('kvar av {t}', { t: esc(fmtBurn(s.total, m)) })}</span></div>
    ${pct != null ? `<div class="kpi"><b>${pct} %</b><span>${tr('klart')}</span></div>` : ''}
    ${rel ? `<div class="kpi ${diff > 0 ? 'alert' : ''}"><b>${esc(rel)}</b><span>${tr('ideal idag: {v}', { v: esc(fmtBurn(id, m)) })}</span></div>` : ''}
    ${s.start != null ? `<div class="kpi"><b>${fmtYYWW(s.start)}–${fmtYYWW(s.end)}</b><span>${fmtDayY(s.start)} – ${fmtDayY(s.end)}</span></div>` : ''}
    ${(s.changes || []).length ? `<div class="kpi"><b>▲ ${s.changes.length}</b><span>${tr('ökat omfång')}</span></div>` : ''}</div>`;
}
// PNG via samma mönster som Exportera bild: ljust tema, canvas, nedladdning eller ny flik (canDownload)
async function svgToPng(svg, W, H) {
  const scale = Math.min(2, 16000 / W, 16000 / H);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(tr('Kunde inte rendera bilden'))); img.src = url; });
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { blob, png: URL.createObjectURL(blob) };
}
function savePng(png, fname) {
  if (canDownload()) { const a = document.createElement('a'); a.href = png; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); return 'dl'; }
  // I en ram som inte tillåter nedladdning: öppna bilden i en ny flik i stället
  if (window.open(png, '_blank')) { toast(tr('Bilden öppnades i en ny flik. Högerklicka och välj Spara bild som')); return 'tab'; }
  toast(tr('Nedladdning blockeras här. Högerklicka på bilden och välj Spara bild som')); return null;
}
// Bygger exportbilden i ljust tema: build() → { svg, W, H } (innehåll utan <svg>)
async function exportBurnPng(build, name) {
  const root = document.documentElement, prev = root.dataset.theme;
  root.dataset.theme = 'light'; readPalette();
  let res;
  try { res = build(); } finally { root.dataset.theme = prev; readPalette(); }
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${res.W}" height="${res.H}" font-family='${FONT}'><rect width="${res.W}" height="${res.H}" fill="${PAL.surface}"/>${res.svg}</svg>`;
  try { const { png } = await svgToPng(doc, res.W, res.H); return savePng(png, `${String(name).replace(/[^\wåäöÅÄÖ\- ]+/g, '').trim() || 'burndown'} - burndown.png`); }
  catch (e) { toast(e.message); return null; }
}

// 📊 Uppföljning → 📉 Burndown… (planen eller programmet) och 📉 på fasraden (scope = 'ph:<fas>')
function openBurndown(scope) {
  if (ui.mode === 'program' && program) return openProgramBurndown();
  if (!plan || plan.synthetic) return toast(tr('Öppna en plan först.'));
  if (!plan.tasks.length) return toast(tr('Planen har inga aktiviteter ännu.'));
  const p = plan, cal = calendarOf(p.settings);
  const sprints = detectSprints(p), sprintSet = new Set(sprints.map(s => s.bucket));
  const phases = bucketList().filter(b => !sprintSet.has(b) && p.tasks.some(t => (t.bucket || 'Övrigt') === b));
  const valid = new Set(['plan', ...sprints.map(s => burnScopeKey(s.bucket)), ...phases.map(burnScopeKey)]);
  const st = { scope: valid.has(scope) ? scope : 'plan', measure: null, extra: [] };
  burnExtra(p, false).then(x => { st.extra = x; draw(); });
  burnExtra(p, true).then(x => { st.extra = x; draw(); });
  const series = () => {
    const ts = burnTasks(p.tasks, st.scope), avail = burnMeasures(ts).map(x => x.measure), auto = burnAuto(ts);
    const m = st.measure && avail.includes(st.measure) ? st.measure : auto;
    return { s: burnSeries(p, st.scope, m, cal, { extra: st.extra }), avail, auto, ts };
  };
  const title = () => { const { s } = series(); return { main: `${p.name} – ${burnScopeName(st.scope)}`, sub: `${tr('Burndown')} · ${tr(BURN_LBL[s.measure])} · ${tr('uppdaterad')} ${fmtDayY(todayDay())}` }; };
  const done = dialog({ title: tr('📉 Burndown – {name}', { name: esc(p.name) }), wide: true, body: '<div id="bdBody" class="bd"></div>',
    buttons: [{ label: tr('⬇ Exportera bild (PNG)'), value: 'png', ghost: true, keep: true }, { label: tr('Stäng'), value: true }],
    onButton: v => {
      if (v !== 'png') return;
      const { s } = series(), sel = sprintSet.has(st.scope.slice(3)) ? st.scope.slice(3) : null;
      exportBurnPng(() => {
        const c = burnChartSVG(s, { W: 1000, H: 400, title: title() });
        if (!sprints.length || !(sel || st.scope === 'plan')) return c;
        const v2 = velocitySVG(velocity(p, s.measure, cal, { extra: st.extra }), s.measure, sel, 1000, 170);
        return { svg: c.svg + `<text x="16" y="${c.H + 18}" font-size="13" font-weight="700" fill="${PAL.text}">${esc(tr('Velocity per sprint'))}</text><g transform="translate(0,${c.H + 22})">${v2.svg}</g>`, W: c.W, H: c.H + 22 + v2.H };
      }, `${p.name} - ${burnScopeName(st.scope)}`);
    } });
  $('#modal .modal').classList.add('xl');
  done.then(() => render());
  const draw = () => {
    const box = $('#bdBody'); if (!box) return;
    const { s, avail, auto, ts } = series(), W = Math.max(560, Math.min(1100, (box.clientWidth || 1000)));
    const isSprint = st.scope !== 'plan' && sprintSet.has(st.scope.slice(3)), showVel = sprints.length && (isSprint || st.scope === 'plan');
    const dflt = ts.filter(t => t.effort && t.effort.dflt && t.effort.src !== 'tp').length, noVal = ts.filter(t => !t.milestone && !burnTaskValue(t, s.measure)).length;
    const opt = (v, l) => `<option value="${esc(v)}" ${st.scope === v ? 'selected' : ''}>${esc(l)}</option>`;
    const c = burnChartSVG(s, { W, H: 340 });
    const vel = showVel ? velocity(p, s.measure, cal, { extra: st.extra }) : null, vs = vel ? velocitySVG(vel, s.measure, isSprint ? st.scope.slice(3) : null, W, 170) : null;
    box.innerHTML = `
      <div class="bd-tools">
        <label>${tr('Omfång')} <select id="bdScope">${opt('plan', tr('Hela planen'))}
          ${sprints.length ? `<optgroup label="${tr('Sprintar')}">${sprints.map(x => opt(burnScopeKey(x.bucket), bName(x.bucket))).join('')}</optgroup>` : ''}
          ${phases.length ? `<optgroup label="${tr('Faser')}">${phases.map(b => opt(burnScopeKey(b), bName(b))).join('')}</optgroup>` : ''}</select></label>
        <div class="seg" id="bdMeasure">${BURN_MEASURES.map(m => `<button data-m="${m}" class="${s.measure === m ? 'on' : ''}" ${avail.includes(m) ? '' : 'disabled'} title="${esc(avail.includes(m) ? (m === auto ? tr('Förvalt mått för omfånget') : '') : tr('Inga värden i det här omfånget'))}">${tr(BURN_LBL[m])}${m === auto ? ' · ' + tr('förval') : ''}</button>`).join('')}</div>
      </div>
      ${burnStatsHTML(s)}
      <div class="bd-chart" id="bdChart">${burnSvgDoc(c.svg, c.W, c.H)}</div>
      <p class="bd-note">${esc(burnMeasureNote(s.measure))}${noVal ? ' ' + esc(tr('{n} aktiviteter saknar värde i måttet och räknas inte.', { n: noVal })) : ''}${s.measure === 'hours' && dflt ? ' ' + esc(tr('{n} aktiviteter med Planners standardinsats räknas inte.', { n: dflt })) : ''}</p>
      ${vs ? `<h4 class="bd-h">${tr('Velocity per sprint')}</h4><div class="bd-vel" id="bdVel">${burnSvgDoc(vs.svg, vs.W, vs.H)}</div>
        <p class="bd-note">${esc(tr('Klart per sprint vid sprintens slut (pågående: hittills). Medel för avslutade sprintar: {v}. Klicka på en stapel för sprintens burndown.', { v: vel.avg == null ? '–' : fmtBurn(vel.avg, s.measure) }))}</p>` : ''}
      <p class="bd-note muted">${esc(tr('Ett värde sparas när planen sparas (högst ett per dag) och vid uppdatering från Excel. Bakåt i tiden används versionerna och, uppskattat från klara aktiviteters slutdatum, ögonblicksbilderna (ofyllda punkter).'))}</p>`;
  };
  const box = $('#bdBody');
  box.addEventListener('change', e => { if (e.target.id === 'bdScope') { st.scope = e.target.value; draw(); } });
  box.addEventListener('click', e => {
    const b = e.target.closest('#bdMeasure button[data-m]');
    if (b && !b.disabled) { st.measure = b.dataset.m; return draw(); }
    const bar = e.target.closest('.bd-vbar');
    if (bar) { st.scope = bar.getAttribute('data-scope'); draw(); }
  });
  draw();
}
const burnMeasureNote = m => m === 'hours' ? tr('Mått: kvarvarande timmar (insats) – kvar enligt panelen, annars planerat − utfört eller planerat × (1 − % klart).')
  : m === 'checks' ? tr('Mått: obockade checklistpunkter. En klar aktivitet räknas som helt avbockad.')
  : tr('Mått: aktivitetspoäng – varje aktivitet väger 1 och kvar = 1 − % klart. Milstolpar räknas inte.');

// Programmets burndown: summan av planernas, när måttet finns i alla planer – annars en burndown per plan
function openProgramBurndown() {
  const pls = program.plans.map(r => allPlans.find(p => p.id === r.planId)).filter(Boolean);
  if (!pls.length) return toast(tr('Programmet har inga planer ännu.'));
  const cal = calendarOf((program.settings && program.settings.calendar) ? program.settings : pls[0].settings);
  const st = { measure: null, extra: {} };
  const load = async withV => { const out = {}; for (const pl of pls) out[pl.id] = await burnExtra(pl, withV); st.extra = out; draw(); };
  load(false).then(() => load(true));
  const result = () => programBurn(pls, st.measure, cal, { extra: st.extra });
  const done = dialog({ title: tr('📉 Burndown – {name}', { name: esc(program.name) }), wide: true, body: '<div id="bdBody" class="bd"></div>',
    buttons: [{ label: tr('⬇ Exportera bild (PNG)'), value: 'png', ghost: true, keep: true }, { label: tr('Stäng'), value: true }],
    onButton: v => {
      if (v !== 'png') return;
      const r = result();
      exportBurnPng(() => {
        if (r.mode === 'sum') return burnChartSVG(r.sum, { W: 1000, H: 400, title: { main: `${program.name} – ${tr('Hela programmet')}`, sub: `${tr('Burndown')} · ${tr(BURN_LBL[r.measure])} · ${tr('uppdaterad')} ${fmtDayY(todayDay())}` } });
        let y = 0, svg = '';
        for (const x of r.series) { const c = burnChartSVG(x.s, { W: 1000, H: 300, title: { main: x.plan.name, sub: `${tr('Burndown')} · ${tr(BURN_LBL[x.s.measure])}` } }); svg += `<g transform="translate(0,${y})">${c.svg}</g>`; y += c.H + 10; }
        return { svg, W: 1000, H: y };
      }, `${program.name}`);
    } });
  $('#modal .modal').classList.add('xl');
  done.then(() => render());
  const draw = () => {
    const box = $('#bdBody'); if (!box) return;
    const r = result(), W = Math.max(560, Math.min(1100, (box.clientWidth || 1000)));
    const seg = `<div class="seg" id="bdMeasure">${BURN_MEASURES.map(m => `<button data-m="${m}" class="${r.measure === m ? 'on' : ''}" title="${esc(r.common.includes(m) ? '' : tr('Finns inte i alla planer – visas per plan'))}">${tr(BURN_LBL[m])}</button>`).join('')}</div>`;
    let body;
    if (r.mode === 'sum') {
      const c = burnChartSVG(r.sum, { W, H: 340 });
      body = `${burnStatsHTML(r.sum)}<div class="bd-chart" id="bdChart">${burnSvgDoc(c.svg, c.W, c.H)}</div>
        <p class="bd-note">${esc(tr('Summan av {n} planer i samma mått. {m}', { n: r.series.length, m: burnMeasureNote(r.measure) }))}</p>
        <table class="mta-list bd-plans"><thead><tr><th>${tr('Plan')}</th><th>${tr('Kvar')}</th><th>${tr('Totalt')}</th><th>${tr('Period')}</th></tr></thead><tbody>
        ${r.series.map(x => `<tr><td>${esc(x.plan.name)}</td><td>${esc(fmtBurn(x.s.remaining, r.measure))}</td><td>${esc(fmtBurn(x.s.total, r.measure))}</td><td>${x.s.start != null ? `${fmtYYWW(x.s.start)}–${fmtYYWW(x.s.end)}` : '–'}</td></tr>`).join('')}</tbody></table>`;
    } else {
      body = `<div class="upd-warn">${esc(tr('Måttet finns inte i alla planer, så programmet kan inte summeras – varje plan visas för sig i sitt eget mått. Välj Aktivitetspoäng för en summa.'))}</div>
        <div class="bd-grid">${r.series.map(x => { const c = burnChartSVG(x.s, { W: Math.max(420, Math.floor(W / 2) - 12), H: 260 }); return `<div class="bd-mini"><b>${esc(x.plan.name)}</b> <small>${esc(tr(BURN_LBL[x.s.measure]))} · ${tr('kvar')} ${esc(fmtBurn(x.s.remaining, x.s.measure))} ${tr('av')} ${esc(fmtBurn(x.s.total, x.s.measure))}</small>${burnSvgDoc(c.svg, c.W, c.H)}</div>`; }).join('')}</div>`;
    }
    box.innerHTML = `<div class="bd-tools"><span>${tr('Omfång')}: <b>${tr('Hela programmet')}</b> (${tr('{n} planer', { n: pls.length })})</span>${seg}</div>${body}
      <p class="bd-note muted">${esc(tr('Programmet ändrar aldrig planerna. Varje plan sparar sina egna värden när den sparas.'))}</p>`;
  };
  $('#bdBody').addEventListener('click', e => { const b = e.target.closest('#bdMeasure button[data-m]'); if (b) { st.measure = b.dataset.m; draw(); } });
  draw();
}

function riskKpiHTML() {
  if (!plan || plan.synthetic) return '';
  const rs = planRisks(), open = rs.filter(r => !r.closed), high = open.filter(riskHigh).length, over = riskDue(rs, todayDay()).over.length;
  return `<button class="kpi kpi-btn ${high || over ? 'alert' : ''}" id="kpiRisk" title="${tr('Öppna risklistan')}"><b>⚠ ${open.length}</b><span>${tr('risker')}${high ? ` · ${tr('{n} höga', { n: high })}` : ''}${over ? ` · ${tr('{n} försenade åtgärder', { n: over })}` : ''}</span></button>`;
}

function openRisks() {
  if (!plan || plan.synthetic) return toast(tr('Risklistan finns per plan – öppna en plan'));
  const p = plan;
  p.settings.risks = p.settings.risks || [];
  let f = { area: '', status: '', owner: '', closed: false, cell: null }, sortKey = 'value', sortDir = -1, undone = false;
  // Ångra: ögonblicksbilden tas före första ändringen i dialogen
  const mark = () => { if (!undone) { pushUndo(); undone = true; } };
  const save = () => scheduleSave();
  const done = dialog({ title: tr('Risklista – {name}', { name: esc(p.name) }), wide: true, body: '<div id="rkBody" class="rk"></div>',
    buttons: [{ label: tr('Exportera Excel'), value: 'export', ghost: true, keep: true }, { label: tr('Stäng'), value: true }],
    onButton: v => { if (v === 'export') exportRisks(p); } });
  $('#modal .modal').classList.add('xl');
  done.then(() => render());
  const areaTxt = a => LANG === 'en' ? a : (RISK_AREA_SV[a] || a);
  const tasks = [...p.tasks].filter(t => t.name).sort((a, b) => (toDay(a.end) ?? 1e9) - (toDay(b.end) ?? 1e9));

  const draw = () => {
    const box = $('#rkBody'); if (!box) return;
    const mb = box.closest('.m-body'), scroll = mb.scrollTop;
    const all = p.settings.risks, today = todayDay(), due = riskDue(all, today);
    const base = all.filter(r => (f.closed || !r.closed) && (!f.area || r.area === f.area) && (!f.status || r.status === f.status) && (!f.owner || lc(r.owner) === lc(f.owner)));
    const rows = riskSort(base.filter(r => !f.cell || (+r.p === f.cell[0] && +r.c === f.cell[1])), sortKey, sortDir);
    const owners = [...new Set(all.map(r => (r.owner || '').trim()).filter(Boolean))].sort();
    const top = riskTop5(all);
    const cnt = (pp, cc) => base.filter(r => +r.p === pp && +r.c === cc).length;
    const sel = (name, val, opts) => `<select data-f="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const th = (k, l) => `<th data-sort="${k}" class="${sortKey === k ? 'on' : ''}">${l}${sortKey === k ? (sortDir < 0 ? ' ▾' : ' ▴') : ''}</th>`;
    box.innerHTML = `
      <div class="rk-top">
        <div class="rk-top5"><b>${tr('Topp 5 risker')}</b>${top.length ? `<ol>${top.map(r => `<li><span class="rk-v ${riskBand(riskValue(r))}">${riskValue(r) || '–'}</span> ${esc(r.desc || tr('(utan beskrivning)'))}${r.owner ? ` <small>· ${esc(r.owner)}</small>` : ''}</li>`).join('')}</ol>` : `<p class="rk-muted">${tr('Inga öppna risker ännu.')}</p>`}
          ${due.over.length || due.soon.length ? `<p class="rk-due">${due.over.length ? `<span class="over">${tr('{n} åtgärder försenade', { n: due.over.length })}</span>` : ''} ${due.soon.length ? `<span class="soon">${tr('{n} ska vara klara inom två veckor', { n: due.soon.length })}</span>` : ''}</p>` : ''}</div>
        <div class="rk-matrix" id="rkMatrix" title="${tr('Klicka på en ruta för att filtrera')}">
          <div class="rk-ylab">${tr('Sannolikhet')}</div>
          <div class="rk-grid">${[5, 4, 3, 2, 1].map(pp => `<span class="rk-ax">${pp}</span>` + [1, 2, 3, 4, 5].map(cc => { const n = cnt(pp, cc); return `<button class="rk-cell ${riskBand(pp * cc)} ${f.cell && f.cell[0] === pp && f.cell[1] === cc ? 'on' : ''}" data-cell="${pp},${cc}" title="${tr('Sannolikhet {p} × konsekvens {c} = {v}', { p: pp, c: cc, v: pp * cc })}">${n || ''}</button>`; }).join('')).join('')}
            <span></span>${[1, 2, 3, 4, 5].map(cc => `<span class="rk-ax">${cc}</span>`).join('')}</div>
          <div class="rk-xlab">${tr('Konsekvens')}</div>
        </div>
      </div>
      <div class="rk-tools">
        ${sel('f-area', f.area, [['', tr('Alla områden')], ...RISK_AREAS.map(a => [a, areaTxt(a)])])}
        ${sel('f-status', f.status, [['', tr('Alla statusar')], ...Object.keys(RISK_ST).map(s => [s, tr(RISK_ST[s])])])}
        ${sel('f-owner', f.owner, [['', tr('Alla ansvariga')], ...owners.map(o => [o, o])])}
        <label class="chk"><input type="checkbox" id="rkClosed" ${f.closed ? 'checked' : ''}> ${tr('Visa stängda')}</label>
        ${f.cell ? `<button class="btn ghost small" id="rkCellClear">${tr('Ruta {p}×{c} ✕', { p: f.cell[0], c: f.cell[1] })}</button>` : ''}
        <span class="spacer"></span><span class="rk-muted">${tr('{n} av {m} risker', { n: rows.length, m: all.length })}</span>
        <button class="btn small" id="rkAdd">${tr('+ Ny risk')}</button>
      </div>
      <div class="rk-scroll"><table class="rk-table" id="rkTable"><thead><tr>
        ${th('no', tr('Nr'))}${th('desc', tr('Risk (Om … så …)'))}${th('area', tr('Område'))}<th>${tr('Sannolikhet')}</th><th>${tr('Konsekvens')}</th>${th('value', tr('Värde'))}
        <th>${tr('Förebyggande åtgärder')}</th><th>${tr('Konsekvensåtgärder')}</th>${th('ready', tr('Klar senast'))}${th('owner', tr('Ansvarig'))}${th('status', tr('Status'))}<th>${tr('Kopplad till')}</th><th></th>
      </tr></thead><tbody>
      ${rows.map(r => { const v = riskValue(r), d = riskReadyDay(r), dueCls = r.closed || d == null ? '' : d < today ? 'due-over' : d <= today + 14 ? 'due-soon' : '';
        return `<tr data-id="${esc(r.id)}" class="${r.closed ? 'closed' : ''} ${dueCls}">
          <td class="rk-no">${esc(r.no)}</td>
          <td><textarea data-f="desc" rows="2" placeholder="${tr('Om … så …')}">${esc(r.desc || '')}</textarea></td>
          <td>${sel('area', r.area, [['', '–'], ...RISK_AREAS.map(a => [a, areaTxt(a)])])}</td>
          <td>${sel('p', r.p, [['', '–'], ...RISK_P_TXT.map((l, i) => [i + 1, `${i + 1} – ${tr(l)}`])])}</td>
          <td>${sel('c', r.c, [['', '–'], ...RISK_C_TXT.map((l, i) => [i + 1, `${i + 1} – ${tr(l)}`])])}</td>
          <td class="rk-val"><span class="rk-v ${riskBand(v) || ''}">${v || '–'}</span></td>
          <td><textarea data-f="prev" rows="2">${esc(r.prev || '')}</textarea></td>
          <td><textarea data-f="cons" rows="2">${esc(r.cons || '')}</textarea></td>
          <td><input type="text" class="wk" data-f="ready" value="${esc(r.ready || '')}" placeholder="${tr('ÅÅVV')}" title="${tr('Vecka som ÅÅVV, t.ex. 2645 – eller 2645/2650 för förebyggande/konsekvens')}"></td>
          <td><input type="text" data-f="owner" value="${esc(r.owner || '')}" list="rkOwners"></td>
          <td>${sel('status', r.status, [['', '–'], ...Object.keys(RISK_ST).map(s => [s, tr(RISK_ST[s])])])}<i class="rk-st ${r.status || ''}"></i></td>
          <td>${sel('taskId', r.taskId, [['', '–'], ...tasks.map(t => [t.id, (t.milestone ? '◆ ' : '') + t.name])])}</td>
          <td class="rk-act"><button class="icon-btn" data-close-risk title="${r.closed ? tr('Öppna igen') : tr('Stäng risken')}">${r.closed ? '↺' : '✓'}</button><button class="icon-btn" data-del title="${tr('Ta bort')}">✕</button></td>
        </tr>`; }).join('') || `<tr><td colspan="13" class="rk-empty">${all.length ? tr('Inga risker matchar filtret.') : tr('Inga risker ännu. Klicka + Ny risk.')}</td></tr>`}
      </tbody></table></div>
      <datalist id="rkOwners">${owners.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
      <p class="rk-note">${tr('Värde = sannolikhet × konsekvens (1–25). Färgerna på värdet är NexusOrdos egna; status sätts av dig.')}</p>`;
    mb.scrollTop = scroll;
  };
  const find = el => { const tr_ = el.closest('tr[data-id]'); return tr_ && p.settings.risks.find(r => r.id === tr_.dataset.id); };
  const box = $('#rkBody');
  box.addEventListener('click', e => {
    const b = e.target.closest('button, th[data-sort]'); if (!b) return;
    if (b.dataset.sort) { if (sortKey === b.dataset.sort) sortDir = -sortDir; else { sortKey = b.dataset.sort; sortDir = b.dataset.sort === 'value' ? -1 : 1; } return draw(); }
    if (b.dataset.cell) { const [pp, cc] = b.dataset.cell.split(',').map(Number); f.cell = f.cell && f.cell[0] === pp && f.cell[1] === cc ? null : [pp, cc]; return draw(); }
    if (b.id === 'rkCellClear') { f.cell = null; return draw(); }
    if (b.id === 'rkAdd') {
      mark();
      const now = new Date().toISOString(), no = Math.max(0, ...p.settings.risks.map(r => +r.no || 0)) + 1;
      p.settings.risks.push({ id: uid(), no, desc: '', area: '', p: null, c: null, prev: '', cons: '', ready: null, owner: '', status: 'Y', taskId: null, createdAt: now, updatedAt: now, closed: false });
      f = { ...f, cell: null }; sortKey = 'no'; sortDir = 1; save(); draw();
      const ta = $(`tr[data-id="${p.settings.risks[p.settings.risks.length - 1].id}"] textarea`); if (ta) ta.focus();
      return;
    }
    const r = find(b); if (!r) return;
    if (b.hasAttribute('data-close-risk')) { mark(); r.closed = !r.closed; r.updatedAt = new Date().toISOString(); save(); return draw(); }
    if (b.hasAttribute('data-del')) { mark(); p.settings.risks = p.settings.risks.filter(x => x !== r); save(); return draw(); }
  });
  box.addEventListener('change', e => {
    const el = e.target, k = el.dataset.f;
    if (el.id === 'rkClosed') { f.closed = el.checked; return draw(); }
    if (k && k.startsWith('f-')) { f[k.slice(2)] = el.value; return draw(); }
    const r = find(el); if (!r || !k) return;
    let v = el.value;
    if (k === 'p' || k === 'c') v = v ? +v : null;
    if (k === 'ready') {
      const parts = v.split('/').map(s => s.trim()).filter(Boolean);
      const days = parts.map(s => parseWeek(s, true));
      if (days.some(d => d == null)) { el.classList.add('bad'); return toast(tr('Okänd vecka: {v}. Skriv ÅÅVV, t.ex. 2645', { v })); }
      v = parts.length ? days.map(fmtYYWW).join('/') : null; el.classList.remove('bad');
    }
    mark();
    if (k === 'taskId') { const t = p.tasks.find(x => x.id === v); r.gate = t && t.milestone ? (String(t.name).toUpperCase().match(/\b(G[1-4])\b/) || [])[1] || null : null; v = v || null; }
    r[k] = typeof v === 'string' && k !== 'ready' ? v.trim() : v; r.updatedAt = new Date().toISOString(); save();
    if (['p', 'c', 'status', 'area', 'ready', 'owner'].includes(k)) draw();
  });
  draw();
}

function exportRisks(p) {
  if (!window.XLSX) return toast(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
  const st = { G: 'Green', Y: 'Yellow', R: 'Red' };
  const head = ['No./ID', 'Risk description', 'Risk area', 'Probability', 'Consequence', 'Risk value', 'Preventive actions to be taken', 'Consequence actions to be taken', 'Ready (latest)', 'Responsible', 'Status', 'Linked to', 'Closed'];
  const rows = riskSort(planRisks(p), 'no', 1).map(r => [r.no, r.desc || '', r.area || '', r.p || '', r.c || '', riskValue(r) || '', r.prev || '', r.cons || '', r.ready || '', r.owner || '', st[r.status] || '',
    ((p.tasks.find(t => t.id === r.taskId) || {}).name) || '', r.closed ? 'Yes' : '']);
  const ws = XLSX.utils.aoa_to_sheet([['Project Name', p.name], ['Document title', 'Risk Analysis'], ['Date', new Date().toISOString().slice(0, 10)], [], head, ...rows]);
  ws['!cols'] = [6, 50, 14, 11, 12, 10, 40, 40, 14, 20, 10, 30, 8].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Risk Analysis');
  const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), fname = `Risk Analysis – ${p.name}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  if (canDownload()) { const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); toast(tr('Risklistan är exporterad')); }
  else if (window.open(url, '_blank')) toast(tr('Exporten öppnades i en ny flik'));
  else toast(tr('Webbläsaren blockerade exporten'));
}

/* =========================================================
   Veckostatus (#42) – lätt veckostatus per vecka.
   settings.status [{ week: 'YYWW', at, by, dims: { goal, fin, hr, deliv, time, risk, tech, comm, ergo, safety, env }: 'G'|'Y'|'R'|null,
   overall, comment, actions: [{ text, state: 'ongoing'|'planned', owner, due }], money: { request, spent, forecast } }] – en post per
   ISO-vecka, påverkas inte av import. Förslag (tidplan, risk, leverabler, ekonomi) sätts aldrig automatiskt.
   ========================================================= */
const ST_DIMS = [
  { k: 'goal', sv: 'Målstyrning', en: 'Goal Management', q: 'Är målen och effektmålen tydliga och fortfarande giltiga?' },
  { k: 'fin', sv: 'Ekonomi', en: 'Financial Resources', q: 'Håller prognosen sig inom anslaget?' },
  { k: 'hr', sv: 'Personal och resurser', en: 'Human Resources', q: 'Har vi rätt personer och tid för fasen?' },
  { k: 'deliv', sv: 'Fasleverabler', en: 'Phase Deliverables', q: 'Blir leverablerna inför nästa gate klara?' },
  { k: 'time', sv: 'Tidplan', en: 'Time Plan', q: 'Följer vi tidplanen? Finns kritisk linje?' },
  { k: 'risk', sv: 'Riskhantering', en: 'Risk Management', q: 'Är risklistan uppdaterad och åtgärderna i tid?' },
  { k: 'tech', sv: 'Teknisk framdrift', en: 'Technical Progress', q: 'Når lösningen förväntad teknisk kvalitet?' },
  { k: 'comm', sv: 'Kommunikation', en: 'Communication', q: 'Är intressenter och linjen informerade?' },
  { k: 'ergo', sv: 'Ergonomi', en: 'Ergonomics', q: 'Är ergonomin bedömd och hanterad?' },
  { k: 'safety', sv: 'Säkerhet', en: 'Safety', q: 'Är säkerhetsriskerna kända och hanterade?' },
  { k: 'env', sv: 'Miljö', en: 'Environment', q: 'Är miljöpåverkan screenad och godkänd?' },
];
const ST_RANK = { G: 1, Y: 2, R: 3 };
const ST_TXT = { G: 'Grön', Y: 'Gul', R: 'Röd' };
const ST_COL = { R: 'var(--critical)', Y: '#e0a800', G: '#3f9a2b' };
const statusWeekKey = day => fmtYYWW(day);
// Sämsta färgen (R > Y > G); null om ingen är satt
const worstOf = vals => { let w = null; for (const v of vals || []) if (ST_RANK[v] && (!w || ST_RANK[v] > ST_RANK[w])) w = v; return w; };
// En post per vecka: samma vecka ersätts; listan sorteras på vecka
function upsertStatus(list, entry) {
  const out = (list || []).filter(e => e.week !== entry.week);
  out.push(entry);
  return out.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
}
// Förslag för tidplanen: gaternas förskjutning (milstolpetrenden) och försenade aktiviteter
function suggestTime(p, today) {
  const snaps = (p.settings && p.settings.snapshots) || [];
  let big = 0, small = 0;
  for (const g of (p.tasks || []).filter(t => t.milestone && MTA_GATE_RE.test(t.name || ''))) {
    const d = msTrend(snaps, g.id).totalShiftDays;
    if (d >= 28) big++; else if (d >= 7) small++;
  }
  const late = (p.tasks || []).filter(t => !t.milestone && t.end && toDay(t.end) < today && (t.progress || 0) < 100).length;
  // Gatens status i Planner (#66): "Ur fas" → röd, "I riskzonen" → gul; sämsta vinner
  const off = (p.tasks || []).filter(t => t.goalStatus === 'offtrack').length, risk = (p.tasks || []).filter(t => t.goalStatus === 'atrisk').length;
  if (off) return { v: 'R', code: 'gateOff', n: off };
  if (big) return { v: 'R', code: 'slipBig', n: big };
  if (risk) return { v: 'Y', code: 'gateRisk', n: risk };
  if (small) return { v: 'Y', code: 'slipSmall', n: small };
  if (late) return { v: 'Y', code: 'late', n: late };
  return { v: 'G', code: 'onTime', n: 0 };
}
// Förslag för riskhantering: höga risker → röd, försenade åtgärder → gul, ingen risklista → gul
function suggestRisk(risks, today) {
  const open = (risks || []).filter(r => !r.closed);
  if (!(risks || []).length) return { v: 'Y', code: 'noRisks', n: 0 };
  const high = open.filter(riskHigh).length;
  if (high) return { v: 'R', code: 'riskHigh', n: high };
  const over = riskDue(risks, today).over.length;
  if (over) return { v: 'Y', code: 'riskOver', n: over };
  return { v: 'G', code: 'riskOk', n: open.length };
}
// Förslag för fasleverabler: gate-checklistan inför nästa gate (chkSummary)
function suggestDeliv(sum) {
  if (!sum || !sum.total) return null;
  if (sum.crit) return { v: 'R', code: 'chkCrit', n: sum.crit };
  if (sum.warn) return { v: 'Y', code: 'chkWarn', n: sum.warn };
  return { v: 'G', code: 'chkOk', n: sum.ok };
}
// Ekonomi enligt statusrapporten: inom anslag grön, 0,1–5 % över gul, mer än 5 % över röd
function moneyColour(m) {
  const req = +((m || {}).request), fc = (m || {}).forecast;
  if (!req || fc === '' || fc == null || isNaN(+fc)) return null;
  const over = (+fc - req) / req;
  return over <= 0 ? 'G' : over <= 0.05 ? 'Y' : 'R';
}
const planStatus = (p = plan) => (p && p.settings && p.settings.status) || [];
const latestStatus = (p = plan) => { const l = planStatus(p); return l[l.length - 1] || null; };
const statusOverall = e => e ? (e.overall || worstOf(Object.values(e.dims || {}))) : null;
const stLbl = d => LANG === 'en' ? d.en : tr(d.sv);

function statusKpiHTML() {
  if (!plan || plan.synthetic) return '';
  const wk = statusWeekKey(todayDay()), cur = planStatus().find(e => e.week === wk), last = latestStatus(), ov = statusOverall(cur || last);
  const txt = ov ? tr(ST_TXT[ov]) : '–';
  return `<button class="kpi kpi-btn st-kpi ${ov ? 'st-' + ov : ''}" id="kpiStatus" title="${tr('Öppna veckostatus')}"><b>🚦 ${txt}</b><span>${cur ? tr('Status v{w}', { w: isoWeek(todayDay()) }) : last ? tr('Senast v{w} – ej rapporterad denna vecka', { w: +last.week.slice(2) }) : tr('Veckostatus ej rapporterad')}</span></button>`;
}
function statusDotsHTML(pl) {
  const e = latestStatus(pl);
  if (!e) return '';
  const ov = statusOverall(e);
  return `<div class="st-dots" title="${tr('Veckostatus v{w}', { w: +e.week.slice(2) })}"><span>🚦 v${+e.week.slice(2)}</span>${ov ? `<i class="st-${ov} big"></i>` : ''}${ST_DIMS.map(d => `<i class="st-${(e.dims || {})[d.k] || 'none'}" title="${esc(stLbl(d))}"></i>`).join('')}</div>`;
}
function stWhy(s) {
  if (!s) return '';
  const T = { gateOff: 'Gater ur fas i Planner: {n}', gateRisk: 'Gater i riskzonen i Planner: {n}', slipBig: 'Gater flyttade ≥ 4 v: {n}', slipSmall: 'Gater flyttade 1–3 v: {n}', late: 'Försenade aktiviteter: {n}', onTime: 'Inga gater flyttade och inga försenade aktiviteter',
    noRisks: 'Ingen risklista', riskHigh: 'Höga risker: {n}', riskOver: 'Försenade riskåtgärder: {n}', riskOk: 'Inga höga risker eller försenade åtgärder',
    chkCrit: 'Kritiska punkter i gate-checklistan: {n}', chkWarn: 'Punkter som påverkar i gate-checklistan: {n}', chkOk: 'Inga gula eller röda punkter i gate-checklistan',
    money: 'Prognos mot anslag' };
  return tr(T[s.code] || s.code, { n: s.n });
}

function openStatus(week) {
  if (!plan || plan.synthetic) return toast(tr('Veckostatus finns per plan – öppna en plan'));
  const p = plan, today = todayDay();
  p.settings.status = p.settings.status || [];
  let wk = week || statusWeekKey(today), undone = false;
  const mark = () => { if (!undone) { pushUndo(); undone = true; } };
  const blank = w => ({ week: w, at: null, dims: {}, overall: null, comment: '', actions: [], money: {} });
  const get = () => JSON.parse(JSON.stringify(p.settings.status.find(e => e.week === wk) || blank(wk)));
  let e = get();
  const commit = () => { mark(); e.at = new Date().toISOString(); p.settings.status = upsertStatus(p.settings.status, e); scheduleSave(); };
  const done = dialog({ title: tr('Veckostatus – {name}', { name: esc(p.name) }), wide: true, body: '<div id="stBody" class="st"></div>',
    buttons: [{ label: tr('Kopiera som text'), value: 'text', ghost: true, keep: true }, { label: tr('Exportera Excel'), value: 'xlsx', ghost: true, keep: true }, { label: tr('Stäng'), value: true }],
    onButton: v => { if (v === 'text') copyStatusText(p, e); if (v === 'xlsx') exportStatus(p); } });
  $('#modal .modal').classList.add('xl');
  done.then(() => render());

  const draw = () => {
    const box = $('#stBody'); if (!box) return;
    const scroll = box.closest('.m-body').scrollTop;
    // Nästa egna gate och dess checklista; kriterierna ligger under 'g:' + gatens id
    const gg = nextGenGate(p);
    const col = gg && genKey(gg.id), gate = gg && { gate: gg.code };
    const gTask = gate && genGateTask(p, gg);
    const sum = gg && genSummary(p.settings, gg.id);
    const sug = { time: suggestTime(p, today), risk: suggestRisk(planRisks(p), today), deliv: suggestDeliv(sum),
      fin: moneyColour(e.money) ? { v: moneyColour(e.money), code: 'money', n: 0 } : null };
    const worst = worstOf(Object.values(e.dims));
    const yr = ST_DIMS.filter(d => ['Y', 'R'].includes(e.dims[d.k]));
    const weeks = [...new Set([statusWeekKey(today), ...p.settings.status.map(x => x.week), ...[1, 2, 3, 4].map(i => statusWeekKey(today - 7 * i))])].sort().reverse();
    const hist = p.settings.status.slice(-12);
    const btns = (k, v0) => ['G', 'Y', 'R'].map(v => `<button class="st-b st-${v} ${v0 === v ? 'on' : ''}" data-d="${k}" data-v="${v}" aria-pressed="${v0 === v}" title="${tr(ST_TXT[v])}">${tr(ST_TXT[v])}</button>`).join('');
    const top5 = riskTop5(planRisks(p));
    const crit = (col && (p.settings.gateCriteria || {})[col]) || [];
    box.innerHTML = `
      <div class="st-head">
        <label>${tr('Vecka')} <select id="stWeek">${weeks.map(w => `<option value="${w}" ${w === wk ? 'selected' : ''}>v${+w.slice(2)} · ${w}${p.settings.status.some(x => x.week === w) ? ' ✓' : ''}</option>`).join('')}</select></label>
        <button class="btn ghost small" id="stCopyPrev">${tr('Kopiera från förra veckan')}</button>
        <span class="st-gate">${gate ? tr('Nästa gate: {g}', { g: gate.gate }) + (gTask ? ` · ${fmtYYWW(toDay(gTask.end))}` : '') : ''}</span>
      </div>
      <table class="st-dims" id="stDims"><tbody>
        ${ST_DIMS.map(d => { const s = sug[d.k]; return `<tr><td class="st-n"><b>${esc(stLbl(d))}</b><small>${tr(d.q)}</small></td>
          <td class="st-btns">${btns(d.k, e.dims[d.k])}</td>
          <td class="st-sug">${s ? `<span class="st-dot st-${s.v}"></span>${tr('Förslag: {v}', { v: tr(ST_TXT[s.v]) })} – ${esc(stWhy(s))} ${e.dims[d.k] !== s.v ? `<button class="ck-link st-use" data-use="${d.k}" data-v="${s.v}">${tr('Använd')}</button>` : ''}` : ''}</td>
          <td><input type="text" class="st-c" data-dc="${d.k}" value="${esc((e.dimc || {})[d.k] || '')}" placeholder="${tr('Kommentar')}"></td></tr>`; }).join('')}
        <tr class="st-money"><td class="st-n"><b>${tr('Ekonomi (MSEK)')}</b><small>${tr('Grön inom anslag, gul 0,1–5 % över, röd mer än 5 % över')}</small></td>
          <td colspan="3">${['request', 'spent', 'forecast'].map(k => `<label>${tr({ request: 'Anslag', spent: 'Utfall', forecast: 'Prognos' }[k])} <input type="number" step="0.1" data-m="${k}" value="${e.money && e.money[k] != null ? e.money[k] : ''}"></label>`).join('')}</td></tr>
        <tr class="st-overall"><td class="st-n"><b>${tr('Total projekthälsa')}</b><small>${tr('Projektledarens förslag – fastställs av styrgruppen')}</small></td>
          <td class="st-btns">${btns('overall', e.overall)}</td>
          <td class="st-sug">${worst ? `<span class="st-dot st-${worst}"></span>${tr('Förslag: {v}', { v: tr(ST_TXT[worst]) })} – ${tr('sämsta dimensionen')} ${e.overall !== worst ? `<button class="ck-link st-use" data-use="overall" data-v="${worst}">${tr('Använd')}</button>` : ''}` : ''}</td><td></td></tr>
      </tbody></table>
      <div class="st-grid">
        <div class="st-box" id="stActions"><b>${tr('Åtgärder för att säkra projektets hälsa')}</b>
          ${yr.length && !e.actions.length ? `<p class="st-warn">${tr('Lägg till åtgärder för gula och röda dimensioner: {d}', { d: yr.map(stLbl).join(', ') })}</p>` : ''}
          ${e.actions.map((a, i) => `<div class="st-act" data-i="${i}"><select data-a="state"><option value="ongoing" ${a.state !== 'planned' ? 'selected' : ''}>${tr('Pågående')}</option><option value="planned" ${a.state === 'planned' ? 'selected' : ''}>${tr('Planerad')}</option></select>
            <input type="text" data-a="text" value="${esc(a.text || '')}" placeholder="${tr('Åtgärd')}"><input type="text" data-a="owner" value="${esc(a.owner || '')}" placeholder="${tr('Ansvarig')}"><input type="text" data-a="due" class="wk" value="${esc(a.due || '')}" placeholder="${tr('ÅÅVV')}"><button class="icon-btn" data-rm="${i}" title="${tr('Ta bort')}">✕</button></div>`).join('')}
          <button class="btn ghost small" id="stAddAct">${tr('+ Åtgärd')}</button>
          <textarea id="stComment" rows="2" placeholder="${tr('Sammanfattning för veckan')}">${esc(e.comment || '')}</textarea></div>
        <div class="st-box"><b>${tr('Topp 5 risker')}</b> <button class="ck-link" id="stOpenRisks">${tr('Öppna risklistan')}</button>
          ${top5.length ? `<ol>${top5.map(r => `<li><span class="rk-v ${riskBand(riskValue(r)) || ''}">${riskValue(r) || '–'}</span> ${esc(r.desc || '–')}</li>`).join('')}</ol>` : `<p class="st-muted">${tr('Inga risker ännu.')}</p>`}
          <b>${gate ? tr('Gate-kriterier inför {g}', { g: gate.gate }) : tr('Gate-kriterier')}</b> ${gate ? `<button class="ck-link" id="stOpenChk">${tr('Öppna gate-checklistan')}</button>` : ''}
          ${gate ? `<ul class="st-crit">${GATE_CRITERIA.map((g, i) => `<li><span class="st-dot st-${crit[i] === true ? 'G' : crit[i] === false ? 'R' : 'none'}"></span>${tr(g)}</li>`).join('')}</ul>` : `<p class="st-muted">${tr('Ingen kommande gate i planen.')}</p>`}</div>
      </div>
      <div class="st-hist" id="stHist"><b>${tr('Historik')}</b>${hist.length ? `<table><thead><tr><th></th>${hist.map(h => `<th><button class="ck-link" data-wk="${h.week}">v${+h.week.slice(2)}</button></th>`).join('')}</tr></thead><tbody>
        ${[...ST_DIMS.map(d => [stLbl(d), h => h.dims && h.dims[d.k]]), [tr('Totalt'), h => statusOverall(h)]].map(([n, fn]) => `<tr><td>${esc(n)}</td>${hist.map(h => `<td><i class="st-cell st-${fn(h) || 'none'}" title="${esc(n)} v${+h.week.slice(2)}: ${fn(h) ? tr(ST_TXT[fn(h)]) : '–'}"></i></td>`).join('')}</tr>`).join('')}
        </tbody></table>` : `<p class="st-muted">${tr('Historiken byggs upp vecka för vecka.')}</p>`}</div>`;
    box.closest('.m-body').scrollTop = scroll;
  };

  const box = $('#stBody');
  box.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.d) { const k = b.dataset.d, v = b.dataset.v; if (k === 'overall') e.overall = e.overall === v ? null : v; else e.dims[k] = e.dims[k] === v ? null : v; commit(); return draw(); }
    if (b.dataset.use) { if (b.dataset.use === 'overall') e.overall = b.dataset.v; else e.dims[b.dataset.use] = b.dataset.v; commit(); return draw(); }
    if (b.id === 'stAddAct') { e.actions.push({ text: '', state: 'ongoing', owner: '', due: '' }); commit(); draw(); const ins = $$('#stActions .st-act input[data-a="text"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
    if (b.dataset.rm != null) { e.actions.splice(+b.dataset.rm, 1); commit(); return draw(); }
    if (b.id === 'stCopyPrev') {
      const prev = [...p.settings.status].reverse().find(x => x.week < wk);
      if (!prev) return toast(tr('Ingen tidigare vecka att kopiera'));
      e = { ...JSON.parse(JSON.stringify(prev)), week: wk }; commit(); toast(tr('Kopierade v{w}', { w: +prev.week.slice(2) })); return draw();
    }
    if (b.dataset.wk) { wk = b.dataset.wk; e = get(); return draw(); }
    if (b.id === 'stOpenRisks') { $('#modal').hidden = true; $('#modal').innerHTML = ''; return openRisks(); }
    if (b.id === 'stOpenChk') { $('#modal').hidden = true; $('#modal').innerHTML = ''; return openChecklist((nextGenGate(p) || {}).id); }
  });
  box.addEventListener('keydown', ev => {
    const b = ev.target.closest('.st-b'); if (!b || !['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    const sib = [...b.parentElement.querySelectorAll('.st-b')], i = sib.indexOf(b) + (ev.key === 'ArrowRight' ? 1 : -1);
    if (sib[i]) { ev.preventDefault(); sib[i].focus(); }
  });
  box.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'stWeek') { wk = t.value; e = get(); return draw(); }
    if (t.dataset.dc) { e.dimc = e.dimc || {}; e.dimc[t.dataset.dc] = t.value.trim(); commit(); return; }
    if (t.dataset.m) { e.money = e.money || {}; e.money[t.dataset.m] = t.value === '' ? null : +t.value; commit(); return draw(); }
    if (t.id === 'stComment') { e.comment = t.value.trim(); commit(); return; }
    if (t.dataset.a) {
      const i = +t.closest('.st-act').dataset.i, a = e.actions[i];
      if (t.dataset.a === 'due' && t.value.trim()) { const d = parseWeek(t.value, true); if (d == null) { t.classList.add('bad'); return toast(tr('Okänd vecka: {v}. Skriv ÅÅVV, t.ex. 2645', { v: t.value })); } t.value = fmtYYWW(d); t.classList.remove('bad'); }
      a[t.dataset.a] = t.value.trim(); commit(); if (t.dataset.a === 'state') draw();
    }
  });
  draw();
}

function statusText(p, e) {
  const L = [];
  const ov = statusOverall(e);
  L.push(`${tr('Veckostatus')} – ${p.name} – ${tr('vecka')} ${+e.week.slice(2)} (${e.week})`);
  L.push(`${tr('Total projekthälsa')}: ${ov ? tr(ST_TXT[ov]) : '–'}${e.overall ? '' : ` (${tr('sämsta dimensionen')})`}`);
  L.push('');
  for (const d of ST_DIMS) { const v = e.dims && e.dims[d.k]; const c = (e.dimc || {})[d.k]; L.push(`${stLbl(d)}: ${v ? tr(ST_TXT[v]) : '–'}${c ? ' – ' + c : ''}`); }
  if (moneyColour(e.money)) L.push(`${tr('Ekonomi (MSEK)')}: ${tr('Anslag')} ${e.money.request}, ${tr('Utfall')} ${e.money.spent ?? '–'}, ${tr('Prognos')} ${e.money.forecast}`);
  const act = st => (e.actions || []).filter(a => (a.state === 'planned') === (st === 'planned') && a.text);
  for (const [st, h] of [['ongoing', tr('Pågående åtgärder')], ['planned', tr('Planerade åtgärder')]]) if (act(st).length) { L.push(''); L.push(h + ':'); act(st).forEach(a => L.push(`- ${a.text}${a.owner ? ' (' + a.owner + ')' : ''}${a.due ? ' ' + a.due : ''}`)); }
  const top = riskTop5(planRisks(p));
  if (top.length) { L.push(''); L.push(tr('Topp 5 risker') + ':'); top.forEach((r, i) => L.push(`${i + 1}. [${riskValue(r) || '–'}] ${r.desc || '–'}`)); }
  if (e.comment) { L.push(''); L.push(e.comment); }
  return L.join('\n');
}
async function copyStatusText(p, e) {
  const txt = statusText(p, e);
  try { await navigator.clipboard.writeText(txt); return toast(tr('Statusen är kopierad – klistra in i Teams eller e-post')); }
  catch { /* sandlåda: visa texten att kopiera */ }
  const box = document.createElement('div'); // ovanpå statusdialogen, som ligger kvar
  box.className = 'st-copy';
  box.innerHTML = `<div class="modal"><h3>${tr('Kopiera statusen')}</h3><div class="m-body"><p>${tr('Markera texten och kopiera (Ctrl+C).')}</p><textarea readonly rows="14">${esc(txt)}</textarea></div><div class="m-foot"><button class="btn">${tr('Stäng')}</button></div></div>`;
  document.body.appendChild(box);
  const ta = $('textarea', box); ta.focus(); ta.select();
  $('button', box).onclick = () => box.remove();
}
function exportStatus(p) {
  if (!window.XLSX) return toast(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
  const st = { G: 'Green', Y: 'Yellow', R: 'Red' };
  const head = ['Week', ...ST_DIMS.map(d => d.en), 'Overall Project Health', 'Comment', 'Actions – Ongoing', 'Actions – Planned', 'Request (MSEK)', 'Spent (MSEK)', 'Forecast (MSEK)'];
  const acts = (e, s) => (e.actions || []).filter(a => (a.state === 'planned') === (s === 'planned') && a.text).map(a => a.text + (a.owner ? ` (${a.owner})` : '') + (a.due ? ` ${a.due}` : '')).join('; ');
  const rows = planStatus(p).map(e => [e.week, ...ST_DIMS.map(d => st[(e.dims || {})[d.k]] || ''), st[statusOverall(e)] || '', e.comment || '', acts(e, 'ongoing'), acts(e, 'planned'),
    (e.money || {}).request ?? '', (e.money || {}).spent ?? '', (e.money || {}).forecast ?? '']);
  const ws = XLSX.utils.aoa_to_sheet([['Project Name', p.name], ['Document title', 'Status Report – weekly'], ['Date', new Date().toISOString().slice(0, 10)], [], head, ...rows]);
  ws['!cols'] = head.map((h, i) => ({ wch: i === 0 ? 8 : i <= ST_DIMS.length + 1 ? 12 : 36 }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Status');
  const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), fname = `Status Report – ${p.name}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  if (canDownload()) { const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); toast(tr('Statusen är exporterad')); }
  else if (window.open(url, '_blank')) toast(tr('Exporten öppnades i en ny flik'));
  else toast(tr('Webbläsaren blockerade exporten'));
}

/* =========================================================
   Export och import av planer (#69): Excel med läsbara flikar och en dold flik TimePlan-data med hela planerna som JSON.
   Import skapar alltid nya planer (ingen återställning).
   ========================================================= */
const TP_SHEET = 'TimePlan-data', TP_FORMAT = 'timeplan-export', TP_VERSION = 1, TP_CHUNK = 30000;
/* Byggets version (#78): build-lokal.mjs skriver in {version: commit, date, at} här;
   källkoden har null (ingen version). Export (#69) och mallfiler (#73) bär versionen som `build`. */
/* BUILD:START */
const TP_BUILD = null;
/* BUILD:END */
function cleanBuild(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const version = typeof b.version === 'string' ? b.version.trim() : '', date = typeof b.date === 'string' ? b.date.trim() : '';
  if (!/^[0-9a-f]{4,40}$/i.test(version) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const o = { version, date };
  if (typeof b.at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(b.at) && !isNaN(Date.parse(b.at))) o.at = b.at;
  return o;
}
// Kommer filen från ett nyare bygge än mitt? Samma commit = nej. Annars datum (dag) först och samma dag commit-tiden;
// utan tid går ordningen inte att avgöra utan nätverk, och då varnas inte.
function newerBuild(file, mine) {
  const f = cleanBuild(file), m = cleanBuild(mine);
  if (!f || !m || f.version.toLowerCase() === m.version.toLowerCase()) return false;
  if (f.date !== m.date) return f.date > m.date;
  return !!(f.at && m.at) && Date.parse(f.at) > Date.parse(m.at);
}
const tpBuild = () => cleanBuild(TP_BUILD) || cleanBuild(globalThis.TP_LOCAL);
// Versionen i en exporterad plan eller mallfil (dold flik med JSON i bitar); äldre filer saknar den
function sheetBuild(wb, sheet) {
  const name = wb.SheetNames.find(n => n.trim().toLowerCase() === sheet.toLowerCase());
  if (!name) return null;
  try { return cleanBuild(JSON.parse(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }).slice(1).map(r => r[0]).filter(v => typeof v === 'string').join('')).build); }
  catch { return null; }
}
const TP_SECRET = new Set(['viewCode', 'ownerCode', 'sharedWith']);
const tpObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
// Koder tas bort på alla nivåer; owner bara i settings, eftersom risker och åtgärder också har en ansvarig "owner"
const tpClean = v => JSON.parse(JSON.stringify(v ?? null, (k, x) => TP_SECRET.has(k) ? undefined : x));
const tpSettings = s => { const o = tpClean(tpObj(s) ? s : {}); delete o.owner; delete o.deleted_at; delete o.deleted_by; return o; };
// Färger (#74): bara giltiga färger och kända paletter följer med vid import
const tpColors = st => { if ('phaseColors' in st) st.phaseColors = cleanPhaseColors(st.phaseColors); if ('palette' in st && !PALETTE_IDS.includes(st.palette)) delete st.palette; return st; };
function buildExport(pls, progs = [], now = new Date().toISOString(), build = null) {
  const ids = new Set(pls.map(p => p.id));
  return {
    format: TP_FORMAT, version: TP_VERSION, exportedAt: now, ...(cleanBuild(build) ? { build: cleanBuild(build) } : {}),
    plans: pls.map(p => ({ id: p.id, name: p.name, tasks: tpClean(p.tasks || []), settings: tpSettings(p.settings), imported_at: p.imported_at || null })),
    programs: progs.map(pr => ({ id: pr.id, name: pr.name, plans: (pr.plans || []).filter(r => ids.has(r.planId)).map(r => ({ planId: r.planId, addedAt: r.addedAt || null })),
      dependencies: tpClean(pr.dependencies || []), milestones: tpClean(pr.milestones || []), requests: tpClean(pr.requests || []), settings: tpSettings(pr.settings) })),
  };
}
// Bitar under Excels gräns på 32 767 tecken per cell, utan att dela ett surrogatpar (emoji)
function tpChunks(s, n = TP_CHUNK) {
  const out = [];
  for (let i = 0; i < s.length;) {
    let j = Math.min(i + n, s.length);
    if (j < s.length && /[\uD800-\uDBFF]/.test(s[j - 1])) j--;
    out.push(s.slice(i, j)); i = j;
  }
  return out;
}
function tpSheetName(name, used) {
  const base = String(name || '').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Plan';
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 30 - String(i).length)} ${i}`;
  used.add(n.toLowerCase());
  return n;
}
const tpWeek = d => typeof d === 'string' && d ? fmtYYWW(toDay(d)) : '';
function tpTaskRows(p) {
  const nameOf = new Map((p.tasks || []).map(t => [t.id, t.name]));
  return [[tr('Fas'), tr('Aktivitet'), tr('Start'), tr('Slut'), tr('Startvecka'), tr('Slutvecka'), tr('% klart'), tr('Milstolpe'), tr('Beroenden'), tr('Ansvarig'), tr('Anteckningar'), tr('Deluppgifter klara'), tr('Planerat (h)'), tr('Kvar (h)')],
    ...(p.tasks || []).map(t => [t.bucket || '', t.name || '', t.start || '', t.end || '', tpWeek(t.start), tpWeek(t.end), t.progress || 0, t.milestone ? tr('Ja') : '',
      (t.deps || []).filter(d => nameOf.has(d)).map(d => { const x = (t.depInfo || {})[d], ty = x ? fmtDepType(x.type || 'FS', +x.lag || 0, true) : ''; return nameOf.get(d) + (ty ? ` (${ty})` : ''); }).join('; '), t.assignees || '', t.notes || '', (t.checks || []).length ? `${t.checks.filter(c => c.done).length}/${t.checks.length}` : '',
      t.effort ? effortPlanned(t.effort) ?? '' : '', t.effort ? effortLeft(t) ?? '' : ''])];
}
function exportWorkbook(data) {
  const wb = XLSX.utils.book_new(), used = new Set([TP_SHEET.toLowerCase()]);
  const add = (rows, name, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, tpSheetName(name, used));
  };
  const taskW = [22, 44, 11, 11, 10, 10, 8, 10, 30, 20, 30, 12, 11, 9];
  const st = s => s ? tr({ G: 'Grön', Y: 'Gul', R: 'Röd' }[s] || s) : '';
  if (data.plans.length === 1 && !data.programs.length) {
    const p = data.plans[0], s = p.settings;
    add([[tr('Plan'), p.name], [tr('Exporterad'), data.exportedAt.slice(0, 10)], [], ...tpTaskRows(p)], tr('Aktiviteter'), taskW);
    add([[tr('Nr'), tr('Risk'), tr('Område'), tr('Sannolikhet'), tr('Konsekvens'), tr('Värde'), tr('Ansvarig'), tr('Status'), tr('Klar senast'), tr('Stängd')],
      ...(s.risks || []).map(r => [r.no ?? '', r.desc || '', r.area || '', r.p || '', r.c || '', (+r.p || 0) * (+r.c || 0) || '', r.owner || '', st(r.status), r.ready || '', r.closed ? tr('Ja') : ''])],
    tr('Risker'), [6, 50, 14, 11, 11, 8, 20, 8, 12, 8]);
    add([[tr('Vecka'), tr('Total hälsa'), tr('Kommentar'), tr('Åtgärder')],
      ...(s.status || []).map(e => [e.week || '', st(e.overall || ['R', 'Y', 'G'].find(c => Object.values(e.dims || {}).includes(c))), e.comment || '',
        (e.actions || []).map(a => a.text).filter(Boolean).join('; ')])], tr('Veckostatus'), [8, 12, 50, 50]);
    add(Object.entries(s.project || {}).filter(([, v]) => v != null && typeof v !== 'object' && v !== '').map(([k, v]) => [k, v]), tr('Projektuppgifter'), [16, 50]);
  } else {
    add([[tr('Plan'), tr('Aktiviteter'), tr('Risker'), tr('Veckostatus'), tr('Program')],
      ...data.plans.map(p => [p.name, p.tasks.length, (p.settings.risks || []).length, (p.settings.status || []).length,
        data.programs.filter(pr => pr.plans.some(r => r.planId === p.id)).map(pr => pr.name).join('; ')])], tr('Planer'), [40, 12, 8, 12, 30]);
    data.plans.forEach(p => add([[tr('Plan'), p.name], [], ...tpTaskRows(p)], p.name, taskW));
  }
  const ws = XLSX.utils.aoa_to_sheet([[tr('TimePlan-data – ändra inte. Används när filen importeras i NexusOrdo.')], ...tpChunks(JSON.stringify(data)).map(c => [c])]);
  XLSX.utils.book_append_sheet(wb, ws, TP_SHEET);
  wb.Workbook = { Sheets: wb.SheetNames.map(n => ({ name: n, Hidden: n === TP_SHEET ? 1 : 0 })) };
  return wb;
}
// Läser och kontrollerar fliken TimePlan-data. Felaktig eller ändrad fil ger ett begripligt fel – inget skapas.
function readExport(wb) {
  const fail = msg => { throw new Error(msg); };
  const name = wb.SheetNames.find(n => n.trim().toLowerCase() === TP_SHEET.toLowerCase());
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
  let d = null;
  try { d = JSON.parse(rows.slice(1).map(r => r[0]).filter(v => typeof v === 'string').join('')); } catch { /* fel nedan */ }
  if (!tpObj(d) || d.format !== TP_FORMAT) fail(tr('Fliken TimePlan-data är skadad eller har ändrats. Exportera planen igen från NexusOrdo.'));
  if (typeof d.version !== 'number' || d.version > TP_VERSION) fail(tr('Filen kommer från en nyare version av NexusOrdo och kan inte läsas här.'));
  const plans = Array.isArray(d.plans) ? d.plans : [], programs = Array.isArray(d.programs) ? d.programs : [];
  if (!plans.length && !programs.length) fail(tr('Filen innehåller inga planer.'));
  if (plans.length > 500 || programs.length > 100) fail(tr('Filen innehåller för många planer.'));
  const isDate = v => v == null || v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const badPlan = tr('Fliken TimePlan-data är skadad eller har ändrats. Exportera planen igen från NexusOrdo.');
  const ids = new Set();
  const outPlans = plans.map(p => {
    if (!tpObj(p) || typeof p.id !== 'string' || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.tasks) || p.tasks.length > 5000
      || (p.settings != null && !tpObj(p.settings))) fail(badPlan);
    ids.add(p.id);
    const tasks = tpClean(p.tasks).map(t => {
      if (!tpObj(t) || typeof t.id !== 'string' || typeof t.name !== 'string' || !isDate(t.start) || !isDate(t.end)) fail(badPlan);
      const o = { ...t, deps: Array.isArray(t.deps) ? t.deps.filter(x => typeof x === 'string') : [] };
      // Beroendetyper (#83): bara giltiga typer och fördröjningar för beroenden som finns
      if ('depInfo' in o) { const di = cleanDepInfo(o.depInfo, o.deps); if (di) o.depInfo = di; else delete o.depInfo; }
      // Bara http/https-länkar, som när en länk läggs till i panelen
      if ('links' in o) o.links = Array.isArray(o.links) ? o.links.filter(l => tpObj(l) && /^https?:\/\//i.test(String(l.url || ''))) : [];
      // Checklista (#71): bara giltiga punkter
      if ('checks' in o) { o.checks = cleanChecks(o.checks); if (!o.checks.length) delete o.checks; }
      // Insats (#94): bara tal i timmar och känd källa
      if ('effort' in o) { const e = cleanEffort(o.effort); if (e) o.effort = e; else delete o.effort; }
      if (tpObj(o.imp) && 'effort' in o.imp) o.imp = { ...o.imp, effort: cleanEffort(o.imp.effort) };
      if ('plannerChecks' in o) { const pc = tpObj(o.plannerChecks) ? parseCheckCount(`${o.plannerChecks.done}/${o.plannerChecks.total}`) : null; if (pc) o.plannerChecks = pc; else delete o.plannerChecks; }
      return o;
    });
    return { id: p.id, name: p.name.trim().slice(0, 200), tasks, settings: tpBaselines(tpBurn(tpCapacity(tpGates(tpColors(tpSettings(p.settings)))))), imported_at: typeof p.imported_at === 'string' ? p.imported_at : null };
  });
  const outProgs = programs.map(pr => {
    if (!tpObj(pr) || typeof pr.name !== 'string' || !pr.name.trim() || !Array.isArray(pr.plans) || pr.plans.some(r => !tpObj(r) || typeof r.planId !== 'string')
      || [pr.dependencies, pr.milestones, pr.requests].some(a => a != null && !Array.isArray(a)) || (pr.settings != null && !tpObj(pr.settings))) fail(badPlan);
    return { name: pr.name.trim().slice(0, 200), plans: pr.plans.map(r => ({ planId: r.planId, addedAt: typeof r.addedAt === 'string' ? r.addedAt : null })),
      dependencies: tpClean(pr.dependencies || []), milestones: tpClean(pr.milestones || []), requests: tpClean(pr.requests || []), settings: tpCapacity(tpSettings(pr.settings)) };
  });
  return { exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : '', plans: outPlans, programs: outProgs };
}
// Burndown (#95) vid import: bara giltiga värden
const tpBaselines = st => { if (st && 'baselines' in st) { const b = cleanBaselines(st.baselines); if (b.length) st.baselines = b; else delete st.baselines; } return st; };
const tpBurn = st => { if (st && 'burn' in st) { const b = cleanBurn(st.burn); if (b.length) st.burn = b; else delete st.burn; } return st; };
// Insats och kapacitet (#94) vid import: bara giltiga värden
const cleanEffort = v => { if (!tpObj(v)) return null; const e = effortFrom(v.planned, v.done, v.remaining, v.src); if (e && v.dflt === true && e.src === 'planner') e.dflt = true; return e; };
function tpCapacity(st) {
  if (!st) return st;
  if ('capacity' in st) { if (tpObj(st.capacity)) st.capacity = capacityOf(st); else delete st.capacity; }
  if ('calendar' in st) { if (tpObj(st.calendar)) st.calendar = calendarOf(st); else delete st.calendar; }
  return st;
}
// Egna gater och gate-checklista (#75) vid import: bara giltiga gater och punkter
function tpGates(st) {
  if (!st) return st;
  if ('gates' in st) { const g = cleanGates(st.gates); if (g) st.gates = g; else delete st.gates; }
  if ('gateItems' in st) { const its = cleanGateItems(st.gateItems, planGates({ settings: st, tasks: [] })); if (Object.keys(its).length) st.gateItems = its; else delete st.gateItems; }
  return st;
}
// Import skapar alltid nya planer; samma namn som en befintlig plan får tillägget suffix (t.ex. " (importerad 2026-10-29)")
function prepareImport(data, planNames, progNames, suffix) {
  const rename = (name, taken) => { const n = taken.has(lc(name)) ? name + suffix : name; taken.add(lc(n)); return { name: n, origName: name, renamed: n !== name }; };
  const tp = new Set(planNames.map(lc)), tg = new Set(progNames.map(lc));
  return {
    plans: data.plans.map(p => ({ oldId: p.id, ...rename(p.name, tp), tasks: p.tasks, settings: p.settings, imported_at: p.imported_at })),
    programs: data.programs.map(pr => ({ ...pr, ...rename(pr.name, tg) })),
  };
}
// Programmets referenser till planer (plans, beroendenas from/to) pekar om till de nya planernas id
function remapProgram(pr, idMap) {
  const walk = v => Array.isArray(v) ? v.map(walk)
    : tpObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'planId' && idMap[x] ? idMap[x] : walk(x)])) : v;
  return { name: pr.name, plans: pr.plans.filter(r => idMap[r.planId]).map(r => ({ ...r, planId: idMap[r.planId] })),
    dependencies: walk(pr.dependencies), milestones: walk(pr.milestones), requests: walk(pr.requests), settings: pr.settings };
}

async function openPlanExport() {
  if (!window.XLSX) return toast(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
  const real = ui.mode !== 'program' && plan && !plan.synthetic ? plan : null;
  const progPlans = pr => pr.plans.map(r => allPlans.find(p => p.id === r.planId)).filter(Boolean);
  const opts = [
    real && { label: tr('Den öppna planen ”{name}”', { name: esc(real.name) }), pls: [real], progs: [], file: real.name },
    plans.length && !(plans.length === 1 && plans[0] === real) && { label: tr('Alla planer ({n})', { n: plans.length }), pls: plans, progs: [], file: tr('Mina planer') },
    ui.mode === 'program' && program && { label: tr('Programmet ”{name}” med {n} planer', { name: esc(program.name), n: progPlans(program).length }), pls: progPlans(program), progs: [program], file: program.name },
    allPrograms.length && { label: tr('Allt: {p} planer och {g} program (säkerhetskopia)', { p: allPlans.length, g: allPrograms.length }), pls: allPlans, progs: allPrograms, file: tr('NexusOrdo säkerhetskopia') },
  ].filter(Boolean);
  if (!opts.length) return toast(tr('Det finns inget du kan exportera.'));
  const i = await dialog({
    title: tr('Exportera plan (Excel)'),
    body: `<p>${tr('Filen går att läsa i Excel och kan importeras i NexusOrdo med <b>+ Ny plan / Importera…</b> i planväljaren, t.ex. i en annan miljö.')}</p>
      ${opts.map((o, k) => `<label style="display:block;margin:6px 0"><input type="radio" name="tpExp" value="${k}" ${k ? '' : 'checked'}> ${o.label}</label>`).join('')}`,
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Exportera'), value: 'go', keep: true }],
    onButton: (v, close) => close(+$('#modal input[name="tpExp"]:checked').value),
  });
  if (i == null) return;
  const o = opts[i], day = new Date().toISOString().slice(0, 10);
  const wb = exportWorkbook(buildExport(o.pls, o.progs, undefined, tpBuild()));
  const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), fname = `${o.file} – NexusOrdo ${day}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  if (canDownload()) { const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); toast(tr('Exporterat: {n} planer', { n: o.pls.length })); }
  else if (window.open(url, '_blank')) toast(tr('Exporten öppnades i en ny flik'));
  else toast(tr('Webbläsaren blockerade exporten'));
}

// En plan eller ett program från en NexusOrdo-fil blir en ny rad
async function insertFilePlan(p) {
  const settings = { ...p.settings };
  const np = rowToPlan(await Store.insert(planRow({ name: p.name, tasks: p.tasks, settings, imported_at: p.imported_at })));
  np.tasks = p.tasks; np.settings = settings;
  rememberBase('plan', [np]);
  plans.push(np); allPlans.push(np);
  return np;
}
async function insertFileProgram(r) {
  const np = rowToProgram(await ProgStore.insert(programRow(r)));
  np.settings = r.settings;
  allPrograms.push(np); programs.push(np);
  return np;
}

async function importTimePlan(data, { ask = true } = {}) {
  if (!ProgStore) await loadPrograms();
  const day = new Date().toISOString().slice(0, 10);
  const prep = prepareImport(data, allPlans.map(p => p.name), allPrograms.map(p => p.name), tr(' (importerad {d})', { d: day }));
  const same = x => x.renamed ? ` <span style="color:var(--danger, #c0392b)">${tr('– finns redan, skapas som ”{name}”', { name: esc(x.name) })}</span>` : '';
  const planLi = p => `<li><b>${esc(p.origName)}</b>: ${tr('{n} aktiviteter, {r} risker, {s} veckor med status', { n: p.tasks.length, r: (p.settings.risks || []).length, s: (p.settings.status || []).length })}${same(p)}</li>`;
  const ok = !ask || await dialog({
    title: tr('Importera från NexusOrdo-export'),
    body: `<p>${tr('Filen är en NexusOrdo-export från {d}. Följande skapas som nya planer – inget befintligt ändras.', { d: esc(data.exportedAt.slice(0, 10) || '?') })}</p>
      ${prep.plans.length ? `<ul>${prep.plans.map(planLi).join('')}</ul>` : ''}
      ${prep.programs.length ? `<b>${tr('Program')}</b><ul>${prep.programs.map(pr => `<li><b>${esc(pr.origName)}</b>: ${tr('{n} planer', { n: pr.plans.length })}${same(pr)}</li>`).join('')}</ul>` : ''}`,
    buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Importera'), value: true }],
  });
  if (!ok) return toast(tr('Ingen ändring gjord'));
  const idMap = {}, created = [];
  try {
    for (const p of prep.plans) {
      const np = await insertFilePlan(p);
      idMap[p.oldId] = np.id; created.push(np); markDirty(np);
    }
    for (const pr of prep.programs) {
      const np = await insertFileProgram(remapProgram(pr, idMap));
      created.push(np); markDirty(np);
    }
  } catch (e) {
    toast(tr('Kunde inte importera: ') + e.message + (created.length ? tr(' ({n} skapade)', { n: created.length }) : ''));
  }
  if (!created.length) return created;
  const newIds = new Set(Object.values(idMap)), firstPlan = created.find(x => newIds.has(x.id));
  if (firstPlan) selectPlan(firstPlan.id, true); else selectProgram(created[0].id);
  if (ask) toast(tr('Importerat: {p} planer, {g} program', { p: newIds.size, g: created.length - newIds.size }));
  return created;
}

/* =========================================================
   Versionshistorik och papperskorg (#76)
   En kopia av planen (eller programmet) sparas i webbläsarens lagring före varje uppdatering från Excel, import ovanpå,
   Ta bort och återställning – och högst en gång per dag vid vanlig sparning. Ta bort är mjuk: settings.deleted_at sätts,
   planen ligger kvar i 30 dagar och kan återställas.
   Lokal version och lokalt läge: versionerna i LS per plan (högst VER_KEEP_LOCAL).
   ========================================================= */
const VER_KEEP = 30, VER_WEEKS = 8, VER_KEEP_LOCAL = 10, TRASH_DAYS = 30;
const verReason = r => VER_REASONS[r] ? tr(VER_REASONS[r]) : String(r || '');
const VER_REASONS = { update: 'Före uppdatering från Excel', import: 'Före import ovanpå planen', delete: 'Före borttagning',
  restore: 'Före återställning', daily: 'Daglig kopia', manual: 'Sparad för hand' };
// Rotation: behåll de `keep` senaste och den senaste i var och en av de `weeks` senaste veckorna (7 dagar bakåt från now). Ger id att ta bort.
function pruneVersions(vs, now, keep = VER_KEEP, weeks = VER_WEEKS) {
  const t = v => Date.parse(v.at) || 0, n = Date.parse(now);
  const sorted = [...vs].sort((a, b) => t(b) - t(a));
  const keepIds = new Set(sorted.slice(0, keep).map(v => v.id));
  for (let w = 0; w < weeks; w++) {
    const hi = n - w * 7 * DAY, lo = hi - 7 * DAY;
    const v = sorted.find(x => t(x) <= hi && t(x) > lo);
    if (v) keepIds.add(v.id);
  }
  return sorted.filter(v => !keepIds.has(v.id)).map(v => v.id);
}
// Samma kalenderdag (lokal tid) – styr den dagliga kopian
const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
function verCounts(kind, d) {
  d = d || {};
  if (kind === 'program') return { plans: (d.plans || []).length, deps: (d.dependencies || []).length, ms: (d.milestones || []).length };
  const tasks = d.tasks || [], s = d.settings || {};
  return { tasks: tasks.length, risks: (s.risks || []).length, deps: tasks.reduce((n, t) => n + (t.deps || []).length, 0),
    status: (s.status || []).length, checks: Object.values(s.gateChecks || {}).reduce((n, c) => n + Object.keys(c || {}).length, 0) };
}
// Skillnad mellan en version och nuvarande läge: antal, aktiviteter (eller planer) som bara finns i den ena, ändrade aktiviteter
function verDiff(kind, ver, cur) {
  ver = ver || {}; cur = cur || {};
  const a = verCounts(kind, ver), b = verCounts(kind, cur);
  const out = { counts: Object.keys(a).map(k => ({ k, ver: a[k], cur: b[k] })), name: (ver.name || '') !== (cur.name || '') ? { ver: ver.name, cur: cur.name } : null };
  if (kind === 'program') {
    const vi = new Set((ver.plans || []).map(r => r.planId)), ci = new Set((cur.plans || []).map(r => r.planId));
    out.onlyVer = [...vi].filter(x => !ci.has(x)); out.onlyCur = [...ci].filter(x => !vi.has(x)); out.changed = [];
    return out;
  }
  const vm = new Map((ver.tasks || []).map(t => [t.id, t])), cm = new Map((cur.tasks || []).map(t => [t.id, t]));
  out.onlyVer = [...vm.values()].filter(t => !cm.has(t.id)).map(t => t.name);
  out.onlyCur = [...cm.values()].filter(t => !vm.has(t.id)).map(t => t.name);
  out.changed = [...vm.values()].filter(t => cm.has(t.id) && (['name', 'start', 'end', 'progress', 'bucket'].some(k => (t[k] ?? null) !== (cm.get(t.id)[k] ?? null)) || JSON.stringify(t.effort || null) !== JSON.stringify(cm.get(t.id).effort || null))).map(t => t.name); // insats (#94) räknas som ändring
  return out;
}
// Återställ: innehållet från versionen, men samma id som nu
function restoreFrom(kind, data, cur) {
  const d = JSON.parse(JSON.stringify(data || {}));
  const s = d.settings && typeof d.settings === 'object' ? d.settings : {};
  delete s.deleted_at; delete s.deleted_by;
  if (kind === 'program') return { name: d.name || cur.name, plans: d.plans || [], dependencies: d.dependencies || [], milestones: d.milestones || [], requests: d.requests || [], settings: s };
  return { name: d.name || cur.name, tasks: d.tasks || [], settings: s, imported_at: d.imported_at ?? null };
}
// Papperskorgen: borttagna rader har settings.deleted_at
const isDeleted = p => !!(p && p.settings && p.settings.deleted_at);
const trashDays = (p, now) => Math.floor((Date.parse(now) - Date.parse(p.settings.deleted_at)) / DAY);
const trashExpired = (p, now) => trashDays(p, now) >= TRASH_DAYS;
const splitTrash = items => ({ live: items.filter(p => !isDeleted(p)), trash: items.filter(isDeleted) });
let trashPlans = [], trashPrograms = [];

// Lagring av versioner: LS (en nyckel per plan, tak VER_KEEP_LOCAL)
let VerStore = null;
function verStore() {
  if (VerStore) return VerStore;
  const K = id => 'timeplan.versions.' + id, read = id => parseJSON(LS.get(K(id)), []);
  VerStore = { mode: 'local', keep: VER_KEEP_LOCAL, weeks: 0,
    list: async (id, limit = 100) => read(id).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, limit),
    insert: async r => { const row = { ...r, id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }; LS.set(K(r.plan_id), JSON.stringify([...read(r.plan_id), row])); return row; },
    remove: async r => LS.set(K(r.plan_id), JSON.stringify(read(r.plan_id).filter(x => x.id !== r.id))) };
  return VerStore;
}
const verRow = (kind, p) => JSON.parse(JSON.stringify(kind === 'program' ? programRow(p) : planRow(p)));
const verWho = () => '';
const verLast = new Map(); // id → tid för senaste versionen (avgör den dagliga kopian)
const verBase = new Map(); // id → senast inlästa läget (JSON), dagens första kopia tar det läget före ändringarna
function rememberBase(kind, items) { for (const p of items) if (p && p.id && !verBase.has(p.id)) verBase.set(p.id, JSON.stringify(verRow(kind, p))); }
// Sparar en version. Kopian tas direkt (innan något await), så att den alltid visar läget före ändringen.
async function saveVersion(kind, p, reason, data = null) {
  if (!p || !p.id || p.synthetic) return null;
  const row = { plan_id: p.id, kind, name: (data && data.name) || p.name, at: new Date().toISOString(), by: verWho(), reason, data: data || verRow(kind, p) };
  try {
    const vs = verStore(), saved = await vs.insert(row);
    verLast.set(p.id, row.at);
    pruneVersionsOf(p.id).catch(e => console.warn('[NexusOrdo] rotation', e.message));
    return saved || row;
  } catch (e) { toast(tr('Kunde inte spara versionen: ') + e.message); return null; }
}
async function pruneVersionsOf(id) {
  const vs = verStore(), all = await vs.list(id, 500);
  const drop = new Set(pruneVersions(all, new Date().toISOString(), vs.keep, vs.weeks));
  for (const v of all) if (drop.has(v.id)) await vs.remove(v);
}
// Högst en kopia per dag vid vanlig sparning
async function dailyVersion(kind, p) {
  if (!p || !p.id || p.synthetic) return;
  const now = new Date().toISOString(), last = verLast.get(p.id);
  if (last && sameDay(last, now)) return;
  verLast.set(p.id, now); // markera direkt så att snabba sparningar inte ger flera kopior
  if (!last) {
    try { const [l] = await verStore().list(p.id, 1); if (l && sameDay(l.at, now)) return verLast.set(p.id, l.at); }
    catch (e) { verLast.delete(p.id); return console.warn('[NexusOrdo] versioner', e.message); }
  }
  const base = verBase.get(p.id);
  if (!(await saveVersion(kind, p, 'daily', base ? JSON.parse(base) : null))) verLast.delete(p.id);
}

const fmtWhen = iso => { const d = new Date(iso); if (isNaN(d)) return '–'; return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const verTarget = () => ui.mode === 'program' && program ? ['program', program] : (plan && !plan.synthetic ? ['plan', plan] : [null, null]);
const canRestoreVer = (kind, p) => !!p;

function verDiffHTML(kind, v, cur) {
  const d = verDiff(kind, v.data, verRow(kind, cur));
  const lbl = { tasks: tr('aktiviteter'), risks: tr('risker'), deps: tr('beroenden'), status: tr('veckor med status'), checks: tr('svar i gate-checklistan'), plans: tr('planer'), ms: tr('programgater') };
  const names = id => esc((allPlans.find(p => p.id === id) || trashPlans.find(p => p.id === id) || { name: id }).name);
  const li = (arr, f = esc) => `${arr.slice(0, 6).map(x => `<li>${f(x)}</li>`).join('')}${arr.length > 6 ? `<li>${tr('… och {n} till', { n: arr.length - 6 })}</li>` : ''}`;
  const f = kind === 'program' ? names : esc;
  return `<div class="ver-diff"><b>${tr('Versionen från {d} jämfört med nu', { d: esc(fmtWhen(v.at)) })}</b>
    <table class="ver-cnt"><tr><th></th><th>${tr('Versionen')}</th><th>${tr('Nu')}</th></tr>${d.counts.map(c => `<tr class="${c.ver !== c.cur ? 'ver-ch' : ''}"><td>${lbl[c.k]}</td><td>${c.ver}</td><td>${c.cur}</td></tr>`).join('')}</table>
    ${d.name ? `<p>${tr('Namn: ”{a}” → nu ”{b}”', { a: esc(d.name.ver), b: esc(d.name.cur) })}</p>` : ''}
    ${d.onlyVer.length ? `<p><b>${tr('Finns bara i versionen – kommer tillbaka')} (${d.onlyVer.length})</b></p><ul class="upd-list">${li(d.onlyVer, f)}</ul>` : ''}
    ${d.onlyCur.length ? `<p><b>${tr('Finns bara nu – försvinner vid återställning')} (${d.onlyCur.length})</b></p><ul class="upd-list">${li(d.onlyCur, f)}</ul>` : ''}
    ${d.changed.length ? `<p><b>${tr('Ändrade (namn, datum, fas eller % klart)')} (${d.changed.length})</b></p><ul class="upd-list">${li(d.changed)}</ul>` : ''}
    ${!d.onlyVer.length && !d.onlyCur.length && !d.changed.length && d.counts.every(c => c.ver === c.cur) && !d.name ? `<p>${tr('Ingen skillnad i aktiviteter och antal.')}</p>` : ''}</div>`;
}

// ⋯ → 🕘 Versioner…
async function openVersions() {
  const [kind, cur] = verTarget();
  if (!cur) return toast(tr('Öppna en plan först.'));
  let vs;
  try { vs = await verStore().list(cur.id, 100); } catch (e) { return toast(tr('Kunde inte läsa versionerna: ') + e.message); }
  const canRestore = canRestoreVer(kind, cur);
  const cnt = v => { const c = verCounts(kind, v.data); return kind === 'program' ? tr('{p} planer · {d} beroenden', { p: c.plans, d: c.deps }) : tr('{t} akt. · {r} risker · {d} ber.', { t: c.tasks, r: c.risks, d: c.deps }); };
  const rows = vs.map((v, i) => `<tr data-i="${i}"><td>${esc(fmtWhen(v.at))}</td><td>${esc(verReason(v.reason))}</td><td>${esc(v.by || tr('okänd (länk)'))}</td><td>${esc(cnt(v))}</td>
    <td class="ver-act"><button class="btn ghost small" data-vact="diff" data-i="${i}">${tr('Jämför')}</button>${canRestore ? `<button class="btn ghost small" data-vact="restore" data-i="${i}">${tr('Återställ')}</button>` : ''}<button class="btn ghost small" data-vact="export" data-i="${i}">${tr('Exportera')}</button></td></tr>`).join('');
  const r = await dialog({
    title: tr('Versioner av ”{name}”', { name: esc(cur.name) }), wide: true,
    body: `<p>${tr('En version sparas automatiskt före varje uppdatering från Excel, import ovanpå, borttagning och återställning, och en gång per dag när den ändras.')}</p>
      ${FILE_MODE || verStore().mode === 'local' ? `<div class="upd-warn">${tr('Versionerna finns bara i den här webbläsarens arbetskopia (högst {n} per plan). Spara till fil med ⋯ → 💾 Spara för en säker kopia.', { n: VER_KEEP_LOCAL })}</div>` : ''}
      ${vs.length ? `<div id="verDiff"></div><table class="ver-tbl"><tr><th>${tr('Datum')}</th><th>${tr('Orsak')}</th><th>${tr('Vem')}</th><th>${tr('Innehåll')}</th><th></th></tr>${rows}</table>`
        : `<p><i>${tr('Inga versioner ännu.')}</i></p>`}`,
    buttons: [{ label: tr('Spara version nu'), value: 'manual', ghost: true }, { label: tr('Stäng'), value: null }],
    onBody: (e, close) => {
      const b = e.target.closest('[data-vact]');
      if (!b) return;
      const v = vs[+b.dataset.i];
      if (b.dataset.vact === 'diff') { $('#verDiff').innerHTML = verDiffHTML(kind, v, cur); $$('#modal .ver-tbl tr').forEach(tr_ => tr_.classList.toggle('on', tr_.dataset.i === b.dataset.i)); return; }
      close({ act: b.dataset.vact, v });
    },
  });
  if (r === 'manual') { if (await saveVersion(kind, cur, 'manual')) toast(tr('Versionen är sparad')); return openVersions(); }
  if (!r) return;
  if (r.act === 'export') return exportVersion(kind, cur, r.v);
  if (r.act === 'restore') return restoreVersion(kind, cur, r.v);
}

async function restoreVersion(kind, cur, v) {
  const ok = await dialog({
    title: tr('Återställ versionen?'),
    body: `${tr('<b>{name}</b> återställs till versionen från {d} ({why}).', { name: esc(cur.name), d: esc(fmtWhen(v.at)), why: esc(verReason(v.reason)) })}
      ${verDiffHTML(kind, v, cur)}
      <p>${tr('Nuvarande läge sparas först som en version, så att du kan ångra återställningen under 🕘 Versioner.')}</p>`,
    wide: true, buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Återställ'), value: true }],
  });
  if (!ok) return;
  if (!(await saveVersion(kind, cur, 'restore'))) return toast(tr('Återställningen avbröts – nuvarande läge kunde inte sparas som version.'));
  const r = restoreFrom(kind, v.data, cur);
  if (kind === 'plan') {
    clearTimeout(saveTimer);
    Object.assign(cur, r);
    try { await Store.update(cur.id, planRow(cur)); } catch (e) { return toast(tr('Kunde inte spara: ') + e.message); }
    markDirty(cur); undoStack = []; $('#undoBtn').disabled = true;
    setSaveState(FILE_MODE ? tr('● Ej sparad till fil') : '');
  } else {
    clearTimeout(progSaveTimer);
    Object.assign(cur, r);
    try { await ProgStore.update(cur.id, programRow(cur)); } catch (e) { return toast(tr('Kunde inte spara programmet: ') + e.message); }
  }
  render(true);
  toast(tr('Versionen från {d} är återställd. Ångra med 🕘 Versioner → ”Före återställning”.', { d: fmtWhen(v.at) }));
}

function downloadWorkbook(wb, file, okMsg) {
  const blob = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), fname = `${file}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  if (canDownload()) { const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); toast(okMsg); }
  else if (window.open(url, '_blank')) toast(tr('Exporten öppnades i en ny flik'));
  else toast(tr('Webbläsaren blockerade exporten'));
}
// Exportera en version i #69:s format (koder och ägare följer inte med)
function exportVersion(kind, cur, v) {
  if (!window.XLSX) return toast(tr('Excel-läsaren kunde inte laddas (kontrollera nätverket).'));
  const day = String(v.at || '').slice(0, 10), d = v.data || {};
  const data = kind === 'program'
    ? buildExport((d.plans || []).map(r => allPlans.find(p => p.id === r.planId)).filter(Boolean), [{ id: cur.id, ...d }], undefined, tpBuild())
    : buildExport([{ id: cur.id, name: d.name || cur.name, tasks: d.tasks || [], settings: d.settings || {}, imported_at: d.imported_at || null }], [], undefined, tpBuild());
  downloadWorkbook(exportWorkbook(data), `${d.name || cur.name} – ${tr('version')} ${day}`, tr('Versionen är exporterad'));
}

// Ta bort = flytta till papperskorgen (deleted_at). En version sparas först.
async function trashItem(kind, p) {
  const st = kind === 'plan' ? Store : ProgStore;
  await saveVersion(kind, p, 'delete');
  const s = { ...p.settings, deleted_at: new Date().toISOString(), deleted_by: verWho() };
  try { await st.update(p.id, kind === 'plan' ? planRow({ ...p, settings: s }) : programRow({ ...p, settings: s })); }
  catch (e) { toast(tr('Kunde inte ta bort: ') + e.message); return false; }
  p.settings = s;
  if (kind === 'plan') {
    clearTimeout(saveTimer);
    fileDirty.delete(p.id); saveDirty();
    plans = plans.filter(x => x.id !== p.id); allPlans = allPlans.filter(x => x.id !== p.id); trashPlans.push(p);
  } else {
    clearTimeout(progSaveTimer);
    allPrograms = allPrograms.filter(x => x.id !== p.id); programs = programs.filter(x => x.id !== p.id); trashPrograms.push(p);
  }
  return true;
}
const canRestoreTrash = p => !trashExpired(p, new Date().toISOString());
async function restoreTrash(kind, p, open = true) {
  const st = kind === 'plan' ? Store : ProgStore;
  await saveVersion(kind, p, 'restore');
  const s = { ...p.settings }; delete s.deleted_at; delete s.deleted_by;
  try { await st.update(p.id, kind === 'plan' ? planRow({ ...p, settings: s }) : programRow({ ...p, settings: s })); }
  catch (e) { toast(tr('Kunde inte återställa: ') + e.message); return false; }
  p.settings = s;
  if (kind === 'plan') {
    trashPlans = trashPlans.filter(x => x.id !== p.id); allPlans.push(p); plans = allPlans;
    if (open) selectPlan(p.id, true);
  } else {
    trashPrograms = trashPrograms.filter(x => x.id !== p.id); allPrograms.push(p); programs = allPrograms;
    if (open) selectProgram(p.id);
  }
  toast(tr('”{name}” är återställd', { name: p.name }));
  return true;
}
// Ta bort för gott (raden och dess versioner)
async function purgeItem(kind, p) {
  await (kind === 'plan' ? Store : ProgStore).remove(p.id);
  try { const vs = verStore(); for (const v of await vs.list(p.id, 500)) await vs.remove(v); } catch (e) { console.warn('[NexusOrdo] versioner', e.message); }
  if (kind === 'plan') trashPlans = trashPlans.filter(x => x.id !== p.id); else trashPrograms = trashPrograms.filter(x => x.id !== p.id);
}

// ⋯ → 🗑 Papperskorg…
async function openTrash() {
  if (!ProgStore) await loadPrograms();
  const now = new Date().toISOString();
  const items = [...trashPlans.map(p => ({ kind: 'plan', p })), ...trashPrograms.map(p => ({ kind: 'program', p }))]
    .sort((a, b) => String(b.p.settings.deleted_at).localeCompare(String(a.p.settings.deleted_at)));
  const expired = items.filter(x => trashExpired(x.p, now));
  const left = x => { const n = TRASH_DAYS - trashDays(x.p, now); return n > 0 ? tr(n === 1 ? '{n} dag kvar' : '{n} dagar kvar', { n }) : tr('äldre än {n} dagar', { n: TRASH_DAYS }); };
  const cnt = x => { const c = verCounts(x.kind, x.p); return x.kind === 'program' ? tr('{p} planer', { p: c.plans }) : tr('{t} akt. · {r} risker', { t: c.tasks, r: c.risks }); };
  const r = await dialog({
    title: tr('🗑 Papperskorg'), wide: true,
    body: `<p>${tr('Borttagna planer och program ligger här i {n} dagar. Återställ ger tillbaka dem som de var.', { n: TRASH_DAYS })}</p>
      ${items.length ? `<table class="ver-tbl"><tr><th></th><th>${tr('Namn')}</th><th>${tr('Borttagen')}</th><th>${tr('Av')}</th><th>${tr('Innehåll')}</th><th></th></tr>
        ${items.map((x, i) => `<tr class="${trashExpired(x.p, now) ? 'ver-old' : ''}"><td>${x.kind === 'program' ? '▣' : '▤'}</td><td>${esc(x.p.name)}</td><td>${esc(fmtWhen(x.p.settings.deleted_at))}<br><small>${esc(left(x))}</small></td>
          <td>${esc(x.p.settings.deleted_by || tr('okänd (länk)'))}</td><td>${esc(cnt(x))}</td>
          <td class="ver-act">${canRestoreTrash(x.p) ? `<button class="btn small" data-tact="restore" data-i="${i}">${tr('Återställ')}</button>` : ''}</td></tr>`).join('')}</table>`
        : `<p><i>${tr('Papperskorgen är tom.')}</i></p>`}`,
    buttons: [...(expired.length ? [{ label: tr('Ta bort permanent ({n} äldre än {d} dagar)', { n: expired.length, d: TRASH_DAYS }), value: 'purge', ghost: true, danger: true }] : []), { label: tr('Stäng'), value: null }],
    onBody: (e, close) => { const b = e.target.closest('[data-tact]'); if (b) close({ x: items[+b.dataset.i] }); },
  });
  if (r === 'purge') {
    const ok = await dialog({ title: tr('Ta bort permanent?'), body: tr('{n} planer och program som legat i papperskorgen längre än {d} dagar tas bort för gott, med sina versioner. Det går inte att ångra (men den dagliga säkerhetskopian finns kvar i 30 dagar).', { n: expired.length, d: TRASH_DAYS }),
      buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Ta bort permanent'), value: true, danger: true }] });
    if (!ok) return openTrash();
    let n = 0;
    for (const x of expired) { try { await purgeItem(x.kind, x.p); n++; } catch (e) { toast(tr('Kunde inte ta bort: ') + e.message); break; } }
    toast(tr('{n} borttagna permanent', { n }));
    return openTrash();
  }
  if (r && r.x) { await restoreTrash(r.x.kind, r.x.p); renderPlanSelect(); }
}

/* ---------- Lokal version (#70): Öppna plan… / Spara / Spara som… mot fil i #69:s format ----------
   Filhandtagen finns bara under besöket; vilka planer som har osparade ändringar sparas i arbetskopian. */
const fileHandles = new Map();
const fileDirty = new Set(parseJSON(LS.get('timeplan.fileDirty'), []));
const saveDirty = () => LS.set('timeplan.fileDirty', JSON.stringify([...fileDirty]));
function markDirty(p) { if (FILE_MODE && p && p.id && !p.synthetic) { fileDirty.add(p.id); saveDirty(); } }
function markSaved(id) { fileDirty.delete(id); saveDirty(); const cur = fileCurrent(); if (cur && cur.id === id) setSaveState(tr('Sparad till fil ✓')); }
// Det som 💾 Spara gäller: programmet när ett program är öppet, annars planen (#102)
const fileCurrent = () => ui.mode === 'program' ? program : (plan && !plan.synthetic ? plan : null);
const progPlansOf = pr => pr.plans.map(r => allPlans.find(p => p.id === r.planId)).filter(Boolean);
// Raden överst (#102) säger så länge något är osparat att det bara finns i webbläsaren – syns även när fönstret är för smalt för ● Ej sparad till fil
function updateFileBanner() {
  const b = $('#fileBanner'), cur = fileCurrent();
  if (!b) return;
  const dirty = FILE_MODE && cur && fileDirty.has(cur.id);
  b.hidden = !dirty;
  if (dirty) $('span', b).innerHTML = ui.mode === 'program'
    ? tr('<b>Programmet är inte sparat till fil.</b> Ändringarna finns bara i webbläsaren – spara programmet (med alla dess planer) till en fil i din egen mapp.')
    : tr('<b>Planen är inte sparad till fil.</b> Ändringarna finns bara i webbläsaren – spara planen till en fil i din egen mapp.');
}
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const pickerTypes = [{ description: 'NexusOrdo (Excel)', accept: { [XLSX_TYPE]: ['.xlsx'] } }];

async function saveToFile(as = false) {
  const p = fileCurrent(), prog = ui.mode === 'program' ? p : null;
  if (!p) return toast(tr('Öppna en plan först.'));
  // Ett program sparas med alla sina planer i samma fil (#102)
  const pls = prog ? progPlansOf(prog) : [p];
  const bytes = XLSX.write(exportWorkbook(buildExport(pls, prog ? [prog] : [], undefined, tpBuild())), { type: 'array', bookType: 'xlsx' });
  const name = `${p.name}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  const saved = () => { markSaved(p.id); if (prog) pls.forEach(x => markSaved(x.id)); };
  if (window.showSaveFilePicker) {
    let h = !as && fileHandles.get(p.id);
    try {
      if (!h) h = await window.showSaveFilePicker({ suggestedName: name, types: pickerTypes });
      const w = await h.createWritable(); await w.write(bytes); await w.close();
    } catch (e) { if (e.name !== 'AbortError') toast(tr('Kunde inte spara: ') + e.message); return; }
    fileHandles.set(p.id, h); saved();
    return toast(prog ? tr('Programmet och {n} planer sparade till {file}', { n: pls.length, file: h.name }) : tr('Sparad till {file}', { file: h.name }));
  }
  // Utan File System Access API: nedladdning (webbläsaren frågar var filen ska sparas eller lägger den i Hämtade filer)
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_TYPE }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  saved();
  toast(prog ? tr('Programmet laddades ner som {file}', { file: name }) : tr('Planen laddades ner som {file}', { file: name }));
}

// Lokala versionen (#78): filen kommer från en nyare NexusOrdo – säg det och hänvisa till senaste filen, men öppna ändå (utan nätverk)
const localFileName = () => { const L = globalThis.TP_LOCAL || {}; return `NexusOrdo${L.theme ? '-' + L.theme : ''}.html`; };
async function warnNewerFile(build) {
  const mine = tpBuild();
  if (!FILE_MODE || !newerBuild(build, mine)) return;
  const b = cleanBuild(build);
  await dialog({ title: tr('Filen kommer från en nyare NexusOrdo'),
    body: `<p>${tr('Filen kommer från en nyare NexusOrdo ({v}, {d}) än den här ({mv}, {md}). Den öppnas ändå, men det som är nytt i filen kan saknas här.', { v: esc(b.version), d: esc(b.date), mv: esc(mine.version), md: esc(mine.date) })}</p>
      <p>${tr('Hämta den senaste versionen av <b>{file}</b>, spara dina planer till fil, stäng fliken och öppna den nya filen – se <b>Lokal version</b> i hjälpcentret.', { file: esc(localFileName()) })}</p>`,
    buttons: [{ label: tr('Öppna ändå'), value: true }] });
}

async function openFromFile() {
  if (!window.showOpenFilePicker) return $('#openInput').click();
  let h;
  try { [h] = await window.showOpenFilePicker({ types: pickerTypes }); } catch (e) { if (e.name !== 'AbortError') toast(e.message); return; }
  openPlanFile(await h.getFile(), h);
}

async function openPlanFile(file, handle = null) {
  if (!file) return;
  let imp;
  try { imp = await parseWorkbook(file); }
  catch (e) { return dialog({ title: tr('Kunde inte läsa filen'), body: esc(e.message), buttons: [{ label: tr('OK'), value: true }] }); }
  if (imp.timeplan || imp.template) await warnNewerFile(imp.build);
  if (imp.template) { const row = await importTemplate(imp.template, true); if (row) openTemplateDialog('new', null, { src: row.id }); return; }
  if (!imp.timeplan) return handleFile(file); // Planner-export: vanlig import
  const d = imp.timeplan;
  if (FILE_MODE && d.programs.length === 1) return openProgramFile(d, handle);
  if (d.plans.length !== 1 || d.programs.length) return importTimePlan(d);
  const src = d.plans[0], cur = plans.find(p => lc(p.name) === lc(src.name));
  let created;
  if (cur) {
    const choice = await dialog({
      title: tr('Öppna ”{name}”', { name: esc(src.name) }),
      body: tr('Det finns redan en arbetskopia av <b>{name}</b> i webbläsaren. Ersätt den med filens version, eller öppna filen som en kopia?', { name: esc(cur.name) })
        + (fileDirty.has(cur.id) ? `<p><b>${tr('Arbetskopian har ändringar som inte sparats till fil – de försvinner om du ersätter den.')}</b></p>` : ''),
      buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Öppna som kopia'), value: 'copy', ghost: true }, { label: tr('Ersätt arbetskopian'), value: 'replace' }],
    });
    if (!choice) return;
    if (choice === 'replace') {
      await saveVersion('plan', cur, 'import'); // arbetskopian går att få tillbaka under 🕘 Versioner (#76)
      cur.tasks = src.tasks; cur.settings = { ...src.settings, viewCode: cur.settings.viewCode, ownerCode: cur.settings.ownerCode }; cur.imported_at = src.imported_at;
      try { await Store.update(cur.id, planRow(cur)); } catch (e) { return toast(tr('Kunde inte spara: ') + e.message); }
      created = [cur];
      selectPlan(cur.id, true);
    }
  }
  if (!created) created = await importTimePlan(d, { ask: false });
  if (!created || !created.length) return;
  if (handle) fileHandles.set(created[0].id, handle);
  // En kopia med nytt namn är inte samma fil
  if (created[0].name === src.name) markSaved(created[0].id); else fileHandles.delete(created[0].id);
  toast(tr('Öppnade ”{name}”', { name: created[0].name }));
}

// Lokala versionen (#102): en programfil (sparad med 💾 Spara) innehåller programmet och alla dess planer. Finns de redan i
// arbetskopian ersätts de (namnen matchas) eller öppnas som kopia – annars blir det dubbletter varje gång filen öppnas.
async function openProgramFile(d, handle = null) {
  if (!ProgStore) await loadPrograms();
  const src = d.programs[0], byName = n => plans.find(p => lc(p.name) === lc(n));
  const curProg = programs.find(p => lc(p.name) === lc(src.name)), curPlans = d.plans.map(sp => byName(sp.name)).filter(Boolean);
  const cur = [curProg, ...curPlans].filter(Boolean);
  let choice = 'copy';
  if (cur.length) {
    choice = await dialog({
      title: tr('Öppna ”{name}”', { name: esc(src.name) }),
      body: tr('Det finns redan en arbetskopia av programmet eller dess planer i webbläsaren ({list}). Ersätt dem med filens version, eller öppna filen som en kopia?', { list: cur.map(x => `<b>${esc(x.name)}</b>`).join(', ') })
        + (cur.some(x => fileDirty.has(x.id)) ? `<p><b>${tr('Arbetskopian har ändringar som inte sparats till fil – de försvinner om du ersätter den.')}</b></p>` : ''),
      buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Öppna som kopia'), value: 'copy', ghost: true }, { label: tr('Ersätt arbetskopian'), value: 'replace' }],
    });
    if (!choice) return;
  }
  if (choice === 'copy') {
    const created = await importTimePlan(d, { ask: false });
    const np = (created || []).find(x => allPrograms.includes(x));
    if (!np) return;
    selectProgram(np.id);
    // Utan namnkrockar är kopian samma fil
    if (!cur.length) { if (handle) fileHandles.set(np.id, handle); created.forEach(x => markSaved(x.id)); }
    return toast(tr('Öppnade ”{name}”', { name: np.name }));
  }
  const idMap = {};
  let prog;
  try {
    for (const sp of d.plans) {
      const p = byName(sp.name);
      if (!p) { idMap[sp.id] = (await insertFilePlan(sp, {})).id; continue; }
      await saveVersion('plan', p, 'import'); // arbetskopian går att få tillbaka under 🕘 Versioner (#76)
      p.tasks = sp.tasks; p.settings = { ...sp.settings, viewCode: p.settings.viewCode, ownerCode: p.settings.ownerCode }; p.imported_at = sp.imported_at;
      await Store.update(p.id, planRow(p));
      idMap[sp.id] = p.id;
    }
    const r = remapProgram(src, idMap);
    if (curProg) {
      await saveVersion('program', curProg, 'import');
      Object.assign(curProg, { plans: r.plans, dependencies: r.dependencies, milestones: r.milestones, requests: r.requests,
        settings: { ...r.settings, viewCode: curProg.settings.viewCode, ownerCode: curProg.settings.ownerCode } });
      await ProgStore.update(curProg.id, programRow(curProg));
      prog = curProg;
    } else prog = await insertFileProgram(r, {});
  } catch (e) { return toast(tr('Kunde inte öppna: ') + e.message); }
  if (handle) fileHandles.set(prog.id, handle);
  selectProgram(prog.id);
  [prog.id, ...Object.values(idMap)].forEach(markSaved);
  toast(tr('Öppnade ”{name}”', { name: prog.name }));
}

/* =========================================================
   Generic dialog & toast (sandboxed frame: no alert/confirm/prompt)
   ========================================================= */
// onBody(e, close): klick i dialogens innehåll (t.ex. knappar per rad i en lista) kan stänga dialogen med ett värde
function dialog({ title, body, input, buttons, wide, onButton, onBody }) {
  return new Promise(resolve => {
    const m = $('#modal');
    m.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><h3>${title}</h3><div class="m-body">${body || ''}${input != null ? `<input type="text" id="mInput" value="${esc(input)}">` : ''}</div>
      <div class="m-foot">${buttons.map((b, i) => `<button class="btn ${b.ghost ? 'ghost' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}">${b.label}</button>`).join('')}</div></div>`;
    m.hidden = false;
    const close = v => { m.hidden = true; m.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && input != null) { e.preventDefault(); const v = $('#mInput').value.trim(); close(v || null); }
    };
    document.addEventListener('keydown', onKey, true);
    $$('.m-foot button', m).forEach(btn => btn.onclick = () => {
      const b = buttons[+btn.dataset.i];
      if (b.keep && onButton) return onButton(b.value, close);
      if (input != null && b.value === true) { const v = $('#mInput').value.trim(); return close(v || null); }
      close(b.value);
    });
    m.onclick = e => { if (e.target === m) close(null); };
    if (onBody) $('.m-body', m).addEventListener('click', e => onBody(e, close));
    const inp = $('#mInput'); if (inp) { inp.focus(); inp.select(); }
  });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3500);
}
// Byts språket medan ett meddelande visas döljs det – annars står det kvar på det gamla språket (#100)
function hideToast() { clearTimeout(toastTimer); $('#toast').hidden = true; }

/* =========================================================
   Render
   ========================================================= */
function renderKpis() {
  const ts = plan.tasks;
  const done = ts.filter(t => t.progress >= 100).length;
  const late = ts.filter(t => statusOf(t) === 'late').length;
  const td = todayDay();
  const next = ts.filter(t => t.milestone && t.progress < 100 && toDay(t.end) != null).sort((a, b) => toDay(a.end) - toDay(b.end))[0];
  const days = next ? toDay(next.end) - td : null;
  $('#kpis').innerHTML = `
    <div class="kpi"><b>${ts.length}</b><span>${tr('aktiviteter')}</span></div>
    <div class="kpi"><b>${ts.length ? Math.round(done / ts.length * 100) : 0}%</b><span>${tr('klara ({n} st)', { n: done })}</span></div>
    ${late || ui.onlyLate ? `<button class="kpi kpi-btn ${late ? 'alert' : ''} ${ui.onlyLate ? 'on' : ''}" id="kpiLate" aria-pressed="${ui.onlyLate ? 'true' : 'false'}" title="${ui.onlyLate ? tr('Visa alla aktiviteter') : tr('Visa bara försenade aktiviteter')}"><b>${late ? '! ' : ''}${late}</b><span>${ui.onlyLate ? tr('försenade – visar bara dem') : tr('försenade')}</span></button>` : `<div class="kpi"><b>0</b><span>${tr('försenade')}</span></div>`}
    ${nextGenGate(plan) ? (() => { const g = nextGenGate(plan), n = genSummary(plan.settings, g.id); return n.total ? `<button class="kpi kpi-btn ${n.crit ? 'alert' : ''}" id="kpiChk" title="${tr('Öppna gate-checklistan')}"><b>☑ ${n.pct} %</b><span>${tr('{gate}-beredskap', { gate: esc(g.code) })}${n.crit ? ` · ${tr('{n} röda', { n: n.crit })}` : ''}</span></button>` : ''; })() : ''}
    ${projKpiHTML()}
    ${riskKpiHTML()}
    ${statusKpiHTML()}
    ${critKpiHTML()}
    ${next ? `<button class="kpi wide kpi-btn" id="kpiNext" title="${esc(next.name)} – ${tr('📈 Milstolpetrend')}"><b>◆ ${esc(next.name)}</b><span>${tr('Nästa milstolpe')} · ${fmtDay(toDay(next.end))} · ${tr('v')}${isoWeek(toDay(next.end))} (${days < 0 ? tr('{n} dagar sen', { n: Math.abs(days) }) : days === 0 ? tr('idag') : tr('om {n} dagar', { n: days })})</span></button>` : ''}`;
  const kl = $('#kpiLate');
  if (kl) kl.onclick = () => { ui.onlyLate = !ui.onlyLate; saveUi(); render(); };
  const kc = $('#kpiChk');
  if (kc) kc.onclick = () => openChecklist((nextGenGate(plan) || {}).id);
  const kn = $('#kpiNext');
  if (kn) kn.onclick = () => openTrend(next.id);
  const kcr = $('#kpiCrit');
  if (kcr) kcr.onclick = () => showCritical((planGateMargin(plan) || {}).gate?.id);
  const kp = $('#kpiProj');
  if (kp) kp.onclick = () => openProjectInfo();
  const kr = $('#kpiRisk');
  if (kr) kr.onclick = () => openRisks();
  const ks = $('#kpiStatus');
  if (ks) ks.onclick = () => openStatus();
}

function render(fresh = false) {
  readPalette();
  renderPlanSelect();
  // Belastning (#94): planens vy (ui.view = 'load') eller programmets (ui.pgView = 'load')
  const inProgram = ui.mode === 'program' && !!program;
  const loadOn = ui.view !== 'howto' && (inProgram ? ui.pgView === 'load' || ui.view === 'load' : ui.view === 'load');
  $('#loadView').hidden = !loadOn;
  // Gate-översikten (#21): programmets flik Gater
  const gatesOn = inProgram && !loadOn && ui.pgView === 'gates' && ui.view !== 'howto';
  $('#gatesView').hidden = !gatesOn;
  document.body.classList.toggle('in-prog', inProgram);
  // Uppföljning (#100) när en plan eller ett program är öppet; i programvyn bara Burndown (.no-prog döljs)
  $('#fuWrap').hidden = !(inProgram || (ui.mode !== 'program' && plan && !plan.synthetic));
  if ($('#fuWrap').hidden) closeMenu('#fuMenu');
  if (gatesOn) {
    ['#empty', '#ganttView', '#roadmapView', '#programView', '#howtoView'].forEach(s => $(s).hidden = true);
    $('#viewSeg').style.display = 'none'; $('#pgSeg').style.display = '';
    $$('#pgSeg button').forEach(b => b.classList.toggle('on', b.dataset.pg === 'gates'));
    $('#toolbar').style.display = 'none'; $('#updWrap').hidden = true; $('#exportBtn').disabled = true;
    return renderGates();
  }
  if (loadOn) {
    ['#empty', '#ganttView', '#roadmapView', '#programView', '#howtoView'].forEach(s => $(s).hidden = true);
    $('#viewSeg').style.display = inProgram ? 'none' : ''; $('#pgSeg').style.display = inProgram ? '' : 'none';
    $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === 'load'));
    $$('#pgSeg button').forEach(b => b.classList.toggle('on', b.dataset.pg === 'load'));
    $('#toolbar').style.display = 'none'; $('#updWrap').hidden = true; $('#exportBtn').disabled = true;
    return renderLoad();
  }
  // Hjälpcentret (#47/#68): ui.view = 'howto', öppnas från ? → 📖 Hjälpcenter eller &help= (ingen egen flik sedan #101); flikarna leder tillbaka
  $('#howtoView').hidden = ui.view !== 'howto';
  if (ui.view === 'howto') {
    ['#empty', '#ganttView', '#roadmapView', '#programView'].forEach(s => $(s).hidden = true);
    $('#viewSeg').style.display = ''; $('#pgSeg').style.display = 'none';
    $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === 'howto'));
    $('#toolbar').style.display = 'none'; $('#updWrap').hidden = true; $('#exportBtn').disabled = true;
    return renderHowto();
  }
  const inProg = ui.mode === 'program' && !!program;
  const pgGantt = inProg && ui.pgView === 'gantt';
  $('#programView').hidden = !inProg || pgGantt;
  $('#viewSeg').style.display = inProg ? 'none' : '';
  $('#pgSeg').style.display = inProg ? '' : 'none';
  $$('#pgSeg button').forEach(b => b.classList.toggle('on', b.dataset.pg === (pgGantt ? 'gantt' : 'cards')));
  $('#toolbar').style.display = inProg && !pgGantt ? 'none' : '';
  $('#addBtn').style.display = inProg ? 'none' : ''; $('#addBtn').textContent = tr('+ Aktivitet');
  $('#onlyBlockedLbl').hidden = true; $('#pgSeenBtn').hidden = true;
  $('#onlyChkLbl').hidden = true; $('#showHoursLbl').hidden = true;
  $('#updWrap').hidden = true; // ingen uppdatering av program – planerna uppdateras var för sig
  if (pgGantt) {
    // Program-Gantt: samma vy som en plan, men med programmets planer sammanslagna och skrivskyddade
    plan = programPlan();
    ['#empty', '#roadmapView'].forEach(s => $(s).hidden = true);
    $('#ganttView').hidden = false;
    $('#toolbar').style.visibility = '';
    $('#zoomSeg').hidden = false; $('#detailSeg').hidden = true;
    $$('#zoomSeg button').forEach(b => b.classList.toggle('on', b.dataset.z === ui.zoom));
    $('#exportBtn').disabled = !program.plans.length;
    $('#addBtn').style.display = ''; $('#addBtn').textContent = tr('+ Beroende');
    $('#onlyBlockedLbl').hidden = false; $('#onlyBlocked').checked = !!ui.pgOnlyBlocked;
    $('#showHoursLbl').hidden = !plan.tasks.some(t => t.effort) && !ui.showHours; $('#showHours').checked = !!ui.showHours;
    const nChg = changedDeps(program, seenKey()).size;
    $('#pgSeenBtn').hidden = !nChg; $('#pgSeenBtn').textContent = tr('✓ Markera som sett ({n} ändrade)', { n: nChg });
    renderKpis();
    renderGantt(!fresh);
    renderCritBar(); renderBaseBar();
    return;
  }
  if (inProg) {
    ['#empty', '#ganttView', '#roadmapView'].forEach(s => $(s).hidden = true);
    $('#exportBtn').disabled = true;
    return renderProgram();
  }
  $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.view));
  $$('#zoomSeg button').forEach(b => b.classList.toggle('on', b.dataset.z === ui.zoom));
  $$('#detailSeg button').forEach(b => b.classList.toggle('on', b.dataset.d === ui.detail));
  $('#zoomSeg').hidden = ui.view !== 'gantt';
  $('#detailSeg').hidden = ui.view !== 'roadmap';
  $('#hideDone').checked = ui.hideDone;
  const has = !!plan;
  // Filter "Checklista klar" (#71) visas bara när någon aktivitet har alla punkter klara (eller filtret redan är på)
  const chkAll = has ? plan.tasks.filter(checksAllDone).length : 0;
  $('#onlyChkLbl').hidden = !has || ui.view !== 'gantt' || (!chkAll && !ui.onlyChkDone);
  $('#onlyChk').checked = !!ui.onlyChkDone; $('#onlyChkN').textContent = chkAll ? ` (${chkAll})` : '';
  // Kolumnen Timmar (#94) erbjuds när någon aktivitet har insats (eller kolumnen redan är på)
  $('#showHoursLbl').hidden = !has || ui.view !== 'gantt' || (!plan.tasks.some(t => t.effort) && !ui.showHours); $('#showHours').checked = !!ui.showHours;
  $('#updWrap').hidden = !has || !plan.tasks.length;
  $('#empty').hidden = has && plan.tasks.length > 0;
  $('#toolbar').style.visibility = has ? '' : 'hidden';
  $('#exportBtn').disabled = !has;
  $('#ganttView').hidden = !has || ui.view !== 'gantt';
  $('#roadmapView').hidden = !has || ui.view !== 'roadmap';
  if (!has) { $('#critLbl').hidden = $('#critTarget').hidden = $('#critWarn').hidden = $('#blSel').hidden = $('#blSum').hidden = true; return; }
  bucketList(); // säkerställer fast färgordning innan något ritas
  critDirty = true;
  renderKpis();
  if (ui.view === 'gantt') renderGantt(!fresh); else renderRoadmap();
  renderCritBar(); renderBaseBar();
}

/* =========================================================
   Belastning (#94) – insats per person och vecka som värmekarta. Planens vy (ui.view = 'load') eller programmets (ui.pgView = 'load'),
   där samma person kan finnas i flera planer. Rena beräkningar i workload(); här bara visning och inställningar.
   ui.ldFrom (måndag, null = innevarande vecka), ui.ldWeeks (8/13/26), ui.ldBasis ('remaining'|'planned'), ui.ldPerson, ui.ldInclDflt (Planners standardinsats räknas bara när rutan är ikryssad).
   ========================================================= */
let ldSel = null; // vald cell {p: personnamn, w: måndag}
// Planerna, inställningarna och vem som får ändra dem för vyn som visas
function loadCtx() {
  if (ui.mode === 'program' && program) {
    const pls = program.plans.map(r => allPlans.find(p => p.id === r.planId)).filter(Boolean);
    return { prog: true, name: program.name, plans: pls, st: program.settings || {}, cap: mergeCapacity((program.settings || {}).capacity, pls.map(p => (p.settings || {}).capacity)),
      canEdit: true, save: () => saveProgram() };
  }
  if (!plan || plan.synthetic) return null;
  return { prog: false, name: plan.name, plans: [plan], st: plan.settings, cap: capacityOf(plan.settings), canEdit: true, save: () => scheduleSave() };
}
const ldWeeks = () => [8, 13, 26].includes(ui.ldWeeks) ? ui.ldWeeks : 13;
const ldFrom = () => { const t = todayDay(); return ui.ldFrom != null ? ui.ldFrom : t - weekday(t); };
function loadResult(c) {
  return workload(c.plans, ldFrom(), ldWeeks(), calendarOf(c.st), c.cap, { basis: ui.ldBasis === 'planned' ? 'planned' : 'remaining', dflt: !!ui.ldInclDflt });
}
function renderLoad() {
  const el = $('#loadView'), c = loadCtx();
  if (!c) { el.innerHTML = `<div class="ld-wrap"><div class="ld-empty">${tr('Öppna en plan för att se belastningen.')}</div></div>`; return; }
  const r = loadResult(c), cal = calendarOf(c.st);
  const all = r.people, rows = ui.ldPerson ? all.filter(p => p.name.toLowerCase() === String(ui.ldPerson).toLowerCase()) : all;
  const hol = w => cal.holidays === 'se' ? [...seHolidays(dObj(w).getUTCFullYear()), ...seHolidays(dObj(w + 6).getUTCFullYear())].filter(h => h.day >= w && h.day < w + 7 && weekday(h.day) < 5) : [];
  const pName = n => n === '' ? tr('Ej tilldelad') : n;
  const cell = (p, i) => {
    const x = p.cells[i], sel = ldSel && ldSel.p === p.name && ldSel.w === x.week;
    const lvl = x.hours > 0 ? (x.level || 'na') : 'zero';
    const tip = `${pName(p.name)} · ${tr('v')}${isoWeek(x.week)}: ${fmtH(x.hours)}${x.capacity != null ? ' ' + tr('av {c}', { c: fmtH(x.capacity) }) + (x.pct != null ? ` (${x.pct} %)` : '') : ''}`;
    return `<td class="ld-c lv-${lvl} ${sel ? 'sel' : ''}" data-p="${esc(p.name)}" data-w="${x.week}" title="${esc(tip)}">${x.hours > 0 ? `<b>${numFmt(x.hours)}</b>${x.pct != null ? `<small>${x.pct} %</small>` : ''}` : x.capacity === 0 ? '<small>–</small>' : ''}</td>`;
  };
  const weekTh = w => { const h = hol(w); return `<th class="ld-w ${w === todayDay() - weekday(todayDay()) ? 'now' : ''}" ${h.length ? `title="${esc(h.map(x => tr(x.name)).join(', '))}"` : ''}>${tr('v')}${isoWeek(w)}${h.length ? ' <span class="ld-hol">●</span>' : ''}<small>${fmtYYWW(w)}</small></th>`; };
  const people = all.filter(p => p.name !== '').map(p => p.name);
  el.innerHTML = `<div class="ld-wrap">
    <div class="ld-head"><div><div class="pg-kicker">${c.prog ? tr('Belastning i programmet') : tr('Belastning')}</div><h2>${esc(c.name)}</h2></div>
      <div class="ld-sub">${tr('Insats per person och vecka – fördelad jämnt över aktivitetens arbetsdagar och delad mellan de tilldelade.')}</div></div>
    <div class="ld-ctrl">
      <span class="ld-nav"><button class="icon-btn" id="ldPrev" title="${tr('Föregående veckor')}">◀</button><input type="text" class="wk" id="ldFrom" value="${fmtYYWW(ldFrom())}" title="${tr('Första vecka (ÅÅVV)')}" maxlength="8"><button class="icon-btn" id="ldNext" title="${tr('Nästa veckor')}">▶</button>
        <button class="btn ghost small" id="ldNow">${tr('Denna vecka')}</button></span>
      <div class="seg small" id="ldWeeksSeg">${[8, 13, 26].map(n => `<button data-w="${n}" class="${ldWeeks() === n ? 'on' : ''}">${tr('{n} v', { n })}</button>`).join('')}</div>
      <div class="seg small" id="ldBasisSeg" title="${tr('Kvar: återstående insats från idag. Planerat: hela insatsen över aktivitetens period.')}"><button data-b="remaining" class="${ui.ldBasis !== 'planned' ? 'on' : ''}">${tr('Kvar')}</button><button data-b="planned" class="${ui.ldBasis === 'planned' ? 'on' : ''}">${tr('Planerat')}</button></div>
      <select id="ldPerson" aria-label="${tr('Person')}"><option value="">${tr('Alla personer ({n})', { n: people.length })}</option>${people.map(n => `<option value="${esc(n)}" ${ui.ldPerson && n.toLowerCase() === String(ui.ldPerson).toLowerCase() ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <label class="chk" title="${tr('Räkna inte måndag–fredag som är helgdagar eller midsommar-, jul- och nyårsafton')}"><input type="checkbox" id="ldHol" ${cal.holidays === 'se' ? 'checked' : ''} ${c.canEdit ? '' : 'disabled'}> ${tr('Svenska helgdagar')}</label>
      ${r.dflt ? `<label class="chk" title="${tr('Planner Premium sätter insatsen till varaktighet × 8 h per person (heltid) när ingen annan insats angetts. Den räknas inte med förrän du kryssar i rutan.')}"><input type="checkbox" id="ldDflt" ${ui.ldInclDflt ? 'checked' : ''}> ${tr('Planners standardinsats ({n})', { n: r.dflt })}</label>` : ''}
      <span class="spacer"></span>
      <button class="btn ghost small" id="ldCap">${tr('⏱ Kapacitet…')}</button>
    </div>
    <div class="ld-info">${tr('{n} aktiviteter med insats i perioden', { n: r.tasks })}${r.missing ? ` · <span class="ld-warn">${tr('{n} aktiviteter med ansvarig saknar insats', { n: r.missing })}</span>` : ''}${r.dflt ? ` · ${tr(ui.ldInclDflt ? '{n} med Planners standardinsats (heltid)' : '{n} med Planners standardinsats räknas inte', { n: r.dflt })}` : ''}
      <span class="ld-legend"><i class="lv-ok"></i>${tr('≤ 80 %')}<i class="lv-warn"></i>${tr('80–100 %')}<i class="lv-over"></i>${tr('> 100 %')}</span></div>
    ${rows.length ? `<div class="ld-scroll" id="ldScroll"><table class="ld-tbl" id="ldTbl"><thead><tr><th class="ld-p">${tr('Person')}</th><th class="ld-cap">${tr('h/vecka')}</th>${r.weeks.map(weekTh).join('')}<th class="ld-sum">${tr('Summa')}</th></tr></thead>
      <tbody>${rows.map(p => `<tr class="${p.name === '' ? 'ld-none' : ''}"><th class="ld-p" title="${esc(pName(p.name))}">${esc(pName(p.name))}</th><td class="ld-cap">${p.hpw == null ? '–' : numFmt(p.hpw)}</td>
        ${p.cells.map((x, i) => cell(p, i)).join('')}<td class="ld-sum"><b>${numFmt(p.hours)}</b>${p.pct != null ? `<small>${p.pct} %</small>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="ld-empty">${tr('Ingen insats i perioden. Ange insats i aktivitetens panel (Planerat, Utfört, Kvar) eller uppdatera planen från en Planner Premium-export med kolumnen Arbete.')}</div>`}
    <div class="ld-detail" id="ldDetail">${ldDetailHTML(r, c)}</div>
  </div>`;
  const set = (k, v) => { ui[k] = v; saveUi(); renderLoad(); };
  $('#ldPrev').onclick = () => set('ldFrom', ldFrom() - 7 * Math.max(1, Math.floor(ldWeeks() / 2)));
  $('#ldNext').onclick = () => set('ldFrom', ldFrom() + 7 * Math.max(1, Math.floor(ldWeeks() / 2)));
  $('#ldNow').onclick = () => set('ldFrom', null);
  $('#ldFrom').onchange = e => { const d = parseWeek(e.target.value); if (d == null) { e.target.classList.add('bad'); return toast(tr('Okänd vecka: {v}. Skriv ÅÅVV, t.ex. 2645', { v: e.target.value })); } set('ldFrom', d - weekday(d)); };
  $$('#ldWeeksSeg button').forEach(b => b.onclick = () => set('ldWeeks', +b.dataset.w));
  $$('#ldBasisSeg button').forEach(b => b.onclick = () => set('ldBasis', b.dataset.b));
  $('#ldPerson').onchange = e => { ldSel = null; set('ldPerson', e.target.value || null); };
  const dc = $('#ldDflt'); if (dc) dc.onchange = e => set('ldInclDflt', e.target.checked);
  $('#ldHol').onchange = e => {
    if (!c.canEdit) return;
    if (!c.prog) pushUndo();
    c.st.calendar = { ...(c.st.calendar || {}), holidays: e.target.checked ? 'se' : 'none' };
    c.save(); renderLoad();
  };
  $('#ldCap').onclick = () => openCapacity();
  const tbl = $('#ldTbl');
  if (tbl) tbl.onclick = e => {
    const td = e.target.closest('.ld-c'); if (td) { const k = { p: td.dataset.p, w: +td.dataset.w }; ldSel = ldSel && ldSel.p === k.p && ldSel.w === k.w ? null : k; renderLoad(); return; }
    const th = e.target.closest('th.ld-p'); if (th && th.closest('tbody')) { const n = th.closest('tr').querySelector('.ld-c').dataset.p; if (n) set('ldPerson', ui.ldPerson ? null : n); }
  };
  const det = $('#ldDetail');
  det.onclick = e => {
    const a = e.target.closest('[data-task]'); if (!a) return;
    e.preventDefault();
    // Programmet: öppna planen i Gantt och aktivitetens panel; planen: panelen direkt (belastningen ritas om när panelen sparas)
    if (a.dataset.plan) { if (!plans.some(p => p.id === a.dataset.plan)) return toast(tr('Du har inte tillgång till den planen.')); ui.view = 'gantt'; saveUi(); selectPlan(a.dataset.plan, true); }
    if (plan && plan.tasks.some(t => t.id === a.dataset.task)) openDrawer(a.dataset.task);
  };
}
// Aktiviteterna bakom en cell
function ldDetailHTML(r, c) {
  if (!ldSel) return `<div class="ld-hint">${tr('Klicka på en ruta för att se vilka aktiviteter som ger belastningen. Klicka på ett namn för att bara visa den personen.')}</div>`;
  const p = r.people.find(x => x.name === ldSel.p), x = p && p.cells.find(cl => cl.week === ldSel.w);
  if (!x) { ldSel = null; return ''; }
  const nm = p.name === '' ? tr('Ej tilldelad') : p.name, plName = id => (c.plans.find(q => q.id === id) || {}).name || '';
  return `<h3>${esc(nm)} · ${tr('v')}${isoWeek(x.week)} (${fmtYYWW(x.week)}): ${fmtH(x.hours)}${x.capacity != null ? ' ' + tr('av {c}', { c: fmtH(x.capacity) }) : ''}${x.pct != null ? ` · <span class="lvt-${x.level}">${x.pct} %</span>` : ''}</h3>
    ${x.tasks.length ? `<table class="ld-tasks"><tr><th>${tr('Aktivitet')}</th>${c.prog ? `<th>${tr('Projekt')}</th>` : ''}<th class="r">${tr('Timmar')}</th><th>${tr('Period')}</th></tr>
      ${x.tasks.map(t => { const pl = c.plans.find(q => q.id === t.planId), tk = pl && pl.tasks.find(y => y.id === t.id);
        return `<tr><td><a href="#" data-task="${esc(t.id)}" ${c.prog ? `data-plan="${esc(t.planId)}"` : ''}>${esc(t.name)}</a>${tk && tk.effort && tk.effort.dflt ? ` <small class="ld-dflt">${tr('Planners standard')}</small>` : ''}</td>${c.prog ? `<td>${esc(plName(t.planId))}</td>` : ''}
          <td class="r">${numFmt(t.hours)}</td><td>${tk ? `${fmtShort(toDay(tk.start || tk.end))} – ${fmtShort(toDay(tk.end || tk.start))} · ${esc(fmtEffort(tk.effort))}` : ''}</td></tr>`; }).join('')}</table>`
    : `<p>${tr('Ingen insats den här veckan.')}</p>`}`;
}
// ⋯ → ⏱ Kapacitet…: timmar per vecka som standard och per person, och arbetskalendern. Arbetskopia som sparas med Spara.
async function openCapacity() {
  const c = loadCtx();
  if (!c) return toast(tr('Öppna en plan först.'));
  const own = capacityOf(c.st), cal = calendarOf(c.st);
  const names = new Map();
  for (const p of c.plans) for (const t of p.tasks || []) for (const n of peopleOf(t.assignees)) if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), n);
  for (const n of Object.keys(c.cap.people)) if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), n);
  const list = [...names.values()].sort((a, b) => a.localeCompare(b, 'sv'));
  const val = n => { const k = Object.keys(own.people).find(x => x.toLowerCase() === n.toLowerCase()); return k != null ? own.people[k] : ''; };
  const inherited = n => c.prog && val(n) === '' && Object.keys(c.cap.people).some(x => x.toLowerCase() === n.toLowerCase()) ? capHours(c.cap, n) : null;
  const v = await dialog({ title: tr('⏱ Kapacitet – {name}', { name: esc(c.name) }), wide: true,
    body: `<p class="cap-help">${tr('Timmar per vecka som varje person kan lägga på {what}. Tom ruta = standard. Veckor med helgdagar får lägre kapacitet.', { what: c.prog ? tr('programmets planer') : tr('planen') })}</p>
      <div class="cap-top"><label>${tr('Standard (h/vecka)')} <input type="text" id="capDef" inputmode="decimal" value="${esc(effVal(own.defaultHoursPerWeek))}"></label>
        <label class="chk"><input type="checkbox" id="capHol" ${cal.holidays === 'se' ? 'checked' : ''}> ${tr('Svenska helgdagar är lediga')}</label></div>
      <div class="cap-list">${list.length ? list.map((n, i) => `<label class="cap-row"><span>${esc(n)}</span><input type="text" data-i="${i}" inputmode="decimal" value="${esc(effVal(val(n)))}" placeholder="${esc(inherited(n) != null ? numFmt(inherited(n)) + ' ' + tr('(från planen)') : tr('standard'))}"></label>`).join('')
        : `<p>${tr('Inga personer är tilldelade aktiviteter ännu.')}</p>`}</div>
      <p class="cap-err" id="capErr"></p>`,
    buttons: [{ label: tr('Avbryt'), value: null, ghost: true }, { label: tr('Spara'), value: 'save', keep: true }],
    onButton: (b, close) => {
      const num = s => { const x = String(s).trim().replace(',', '.'); return x === '' ? '' : isFinite(+x) && +x >= 0 && +x <= 168 ? round2(+x) : null; };
      const def = num($('#capDef').value);
      if (def == null || def === '' || def === 0) { $('#capErr').textContent = tr('Ange standard som timmar per vecka (1–168).'); return; }
      const people = {};
      for (const inp of $$('#modal .cap-list input')) { const x = num(inp.value); if (x == null) { inp.classList.add('bad'); $('#capErr').textContent = tr('Ange timmar per vecka (0–168).'); return; } if (x !== '') people[list[+inp.dataset.i]] = x; }
      close({ def, people, hol: $('#capHol').checked });
    } });
  if (!v || v === 'save') return;
  if (!c.prog) pushUndo();
  c.st.capacity = { defaultHoursPerWeek: v.def, people: v.people };
  c.st.calendar = { ...(c.st.calendar || {}), holidays: v.hol ? 'se' : 'none' };
  c.save(); render();
  toast(tr('Kapaciteten är sparad'));
}

/* =========================================================
   Projektuppgifter (#53) – sparas i planen (settings.project)
   ========================================================= */
const PROJ_FIELDS = [['program', 'Program'], ['pcode', 'Projektkod'], ['l1', 'Nivå 1 (huvudprojekt)'], ['l2', 'Nivå 2 (delprojekt)'],
  ['pm', 'Projektledare'], ['chairman', 'Sponsor'], ['sc', 'Styrgrupp'], ['org', 'Organisation'], ['site', 'Plats'], ['inv', 'Budget']];
// Skillnad i hela veckor mellan två dagar (veckans måndag mot måndag)
const wkDiff = (a, b) => Math.round(((a - weekday(a)) - (b - weekday(b))) / 7);
const planProject = (p = plan) => (p && p.settings && p.settings.project) || {};
// Sparar en plan som inte behöver vara den öppna
async function savePlanNow(p) {
  if (p === plan) return scheduleSave();
  markDirty(p);
  dailyVersion('plan', p);
  recordBurn(p); // burndown (#95)
  try { await Store.update(p.id, planRow(p)); } catch (e) { toast(tr('Kunde inte spara: ') + e.message); }
}
/* Projektuppgifter för den öppna planen (#53) */
function projKpiHTML() {
  if (!plan || plan.synthetic) return '';
  const pr = planProject();
  if (!pr.program && !pr.sc && !pr.pcode) return '';
  // Kortat (#101): bara namnet (styrgrupp, annars program eller projektkod); detaljerna i tooltipen
  const tip = [tr('🏷 Projektuppgifter'), [pr.program, pr.pcode, pr.sc].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  return `<button class="kpi kpi-btn kpi-proj" id="kpiProj" title="${esc(tip)}"><b>🏷 ${esc(pr.sc || pr.program || pr.pcode || '–')}</b><span>${tr('Projekt')}</span></button>`;
}
function openProjectInfo() {
  if (!plan || plan.synthetic) return toast(tr('Projektuppgifter finns per plan – öppna en plan'));
  const p = plan, pr = { ...planProject(p) };
  const done = dialog({ title: tr('Projektuppgifter – {name}', { name: esc(p.name) }), wide: true, buttons: [{ label: tr('Avbryt'), value: false, ghost: true }, { label: tr('Spara'), value: true }],
    body: `<div class="pj-grid" id="pjForm">${PROJ_FIELDS.map(([k, l]) => `<label class="field"><span class="lbl">${tr(l)}</span><input type="text" data-k="${k}" value="${esc(pr[k] ?? '')}"></label>`).join('')}</div>
      ${pjRoleHTML(p, pr)}` });
  // Värdena följs under tiden (dialogen töms när den stängs)
  const pjSnap = { ...pr };
  done.then(ok => {
    if (!ok) return;
    pushUndo();
    p.settings.project = Object.fromEntries(Object.entries(pjSnap).filter(([, v]) => v !== '' && v != null));
    scheduleSave(); render(); toast(tr('Projektuppgifterna är sparade'));
  });
  $('#pjForm').addEventListener('input', e => { const k = e.target.dataset.k; if (k) pjSnap[k] = e.target.value.trim(); });
  $('#pjMain').onchange = e => { pjSnap.role = e.target.checked ? 'main' : ''; };
  $('#pjGates').onchange = e => { pjSnap.gates = e.target.value; };
}

// Huvudplan och gater för delprojekt (#67) i Projektuppgifter
function pjRoleHTML(p, pr) {
  const other = allPlans.find(x => x !== p && isMainPlan(x) && pr.l1 && l1Key(x) === normName(pr.l1));
  return `<div class="pj-role">
    <label class="chk"><input type="checkbox" id="pjMain" ${pr.role === 'main' ? 'checked' : ''}> ${tr('Huvudplan – planen äger huvudprojektets gemensamma gater')}</label>
    ${other ? `<small class="upd-warn">${tr('{name} är redan huvudplan för samma huvudprojekt.', { name: esc(other.name) })}</small>` : ''}
    <label class="field"><span class="lbl">${tr('Gater i programmet')}</span><select id="pjGates">
      ${[['', 'Egna om planen har gater med datum, annars huvudplanens'], ['inherit', 'Alltid huvudplanens (ärvda)'], ['none', 'Inga gater (stödprojekt, t.ex. IT eller Facility)']]
        .map(([v, l]) => `<option value="${v}" ${(pr.gates || '') === v ? 'selected' : ''}>${tr(l)}</option>`).join('')}</select></label>
  </div>`;
}

/* =========================================================
   Hjälpcenter (#68, ersätter How to-sidan från #47/#60) – fliken How to: kategorier och sök till vänster, en artikel i taget
   till höger, &help=<id> i länken öppnar en artikel. Bilderna ligger i app/howto/<sv|en>/ och tas om med
   scripts/howto-bilder.mjs (bara påhittade testplaner). Regel: ny eller ändrad funktion = Nytt-rundtur + artikel eller rad här.
   Artikel: { id, cat, title, lead, body: [html], img?, tour?: rundturens id, qa?: frågor och svar, keywords? }
   ========================================================= */
const HELP_CATS = () => [['start', tr('Kom igång')], ['plan', tr('Planera')], ['follow', tr('Följa upp')],
  ['port', tr('Program')], ['kb', tr('Kunskapsbank')]];

function helpArticles() {
  return [
    // Kom igång
    { id: 'importera', cat: 'start', img: '01-start', tour: 'intro', title: tr('Importera från Planner'),
      lead: tr('Exportera planen till Excel i Planner och läs in den med <b>+ Ny plan / Importera…</b> i planväljaren.'), body: [
      tr('Exportera planen i Planner: <b>⋯ → Exportera plan till Excel</b>. Planner Premium: exportera projektet till Excel på samma sätt.'),
      tr('Stäng av alla filter i Planner innan du exporterar. Med ett filter aktivt tar exporten bara med en del av planen, och datum och aktiviteter saknas i NexusOrdo.'),
      tr('Välj <b>+ Ny plan / Importera…</b> sist i planväljaren (eller <b>⋯ → ⇪ Importera från Excel…</b>) och välj filen, eller dra in filen i fönstret.'),
      tr('Faser, gater och milstolpar känns igen automatiskt. Färgerna väljer du med <b>⋯ → 🎨 Färger…</b>'),
      tr('En plan från NexusOrdo (<b>⬇ Exportera plan (Excel)</b>) öppnas på samma sätt.'),
    ], keywords: 'import excel planner premium' },
    { id: 'mall', cat: 'start', img: '06-template', tour: 'template', title: tr('Ny plan från mall'),
      lead: tr('<b>⋯ → Ny plan från mall</b> skapar en plan från en agil mall eller en egen mall.'), body: [
      tr('<b>⋯ → Ny plan från mall…</b> skapar en plan med standardaktiviteter. <b>Lägg till från mall…</b> lägger till dem i en befintlig plan.'),
      tr('Under <b>Agilt</b> finns Scrum och PI-planering (SAFe-inspirerad) – se <b>Agila mallar</b>.'),
      tr('Under <b>Mina mallar</b> finns mallar du sparat själv med <b>📐 Spara som mall…</b> eller importerat från fil.'),
      tr('Skriv start- eller ankarveckan som ÅÅVV. Förhandsvisningen visar antal per fas. Aktiviteter som redan finns läggs inte till igen.'),
    ], keywords: 'template mall' },
    { id: 'sprak', cat: 'start', title: tr('Språk och tema'),
      lead: tr('<b>SV ▾</b> väljer språk och <b>◐</b> byter tema.'), body: [
      tr('Språkknappen uppe till höger (<b>SV ▾</b>) visar språket – välj <b>Svenska</b> eller <b>English</b>. Valet sparas i din webbläsare.'),
      tr('<b>◐</b> växlar mellan ljust och mörkt tema.'),
    ], keywords: 'language english dark theme' },
    { id: 'rundturer', cat: 'start', tour: 'intro', title: tr('Rundturer och hjälp'),
      lead: tr('<b>?</b> uppe till höger startar rundturer, visar vad som är nytt och öppnar hjälpcentret.'), body: [
      tr('<b>▶ Kom igång</b> är en kort rundtur genom de viktigaste knapparna. <b>Rundtur för den här sidan</b> visar sidan du står på.'),
      tr('Under <b>Nytt</b> finns en rundtur för varje ny funktion. En prick på ?-knappen betyder att något är nytt de senaste två veckorna.'),
      tr('<b>? → 📖 Hjälpcenter</b> öppnar hjälpcentret och <b>📖 Hjälp för den här sidan</b> artikeln om sidan du står på. Tillbaka till planen kommer du med flikarna Gantt, Roadmap eller Belastning.'),
      tr('I hjälpcentret söker du i alla artiklar. Artiklar med <b>▶ Visa rundtur</b> visar funktionen på riktigt.'),
      tr('Länka direkt till en artikel med <b>&help=</b> och artikelns namn i länken, t.ex. <b>&help=risklista</b>.'),
    ], keywords: 'tour onboarding nytt' },
    { id: 'lokal', cat: 'start', tour: 'new-local', title: tr('Lokal version'),
      lead: tr('NexusOrdo som en fil på din dator – utan installation. <b>Det du gör finns bara i webbläsaren tills du sparar det till fil med 💾 Spara (Ctrl+S).</b>'), body: [
      tr('<b>Spara alltid till fil.</b> Webbläsaren håller bara en arbetskopia, som försvinner om webbläsardata rensas eller om du byter dator. Så länge något inte är sparat visar en gul rad överst knappen <b>💾 Spara till fil</b>.'),
      tr('Spara <b>{file}</b> på din dator och öppna den därifrån, i Edge eller Chrome. Öppna alltid samma fil på samma plats – då har du samma arbetskopia varje gång.', { file: localFileName() }),
      tr('Ingen installation behövs, och ingen nätverksanslutning när filen väl finns på datorn.'),
      tr('Spara dina planer i en egen mapp, skild från programfilen.'),
      tr('<b>⋯ → 📂 Öppna plan…</b> öppnar en plan från disk. <b>💾 Spara</b> (Ctrl+S) skriver tillbaka till samma fil, <b>Spara som…</b> till en ny.'),
      tr('<b>Program:</b> <b>⋯ → Nytt program…</b>, lägg till planerna med <b>＋ Lägg till plan</b> (välj i listan) och spara med <b>💾 Spara</b> – filen innehåller programmet och alla dess planer. Öppnar du filen igen väljer du <b>Ersätt arbetskopian</b> eller <b>Öppna som kopia</b>.'),
      tr('Planfilen fungerar i alla versioner av NexusOrdo: dina gater, punkter och svar följer med.'),
      tr('<b>Ny version:</b> 1) Spara alla planer till fil med <b>💾 Spara</b>, 2) stäng fliken, 3) ersätt filen med den nya versionen på samma plats och med samma namn – då finns arbetskopian kvar – och öppna den. Öppna vid behov dina planfiler med <b>📂 Öppna plan…</b>'),
      tr('Öppnar du en plan- eller mallfil från en nyare NexusOrdo visas en varning. Filen öppnas ändå – använd den senaste versionen av NexusOrdo så att allt i filen följer med.'),
      ...(globalThis.TP_LOCAL ? [tr('Version {v} ({d}).', { v: globalThis.TP_LOCAL.version, d: globalThis.TP_LOCAL.date })] : []),
    ], keywords: 'lokal offline fil spara öppna uppdatera ny version varning' },
    // Planera
    { id: 'gantt', cat: 'plan', img: '02-gantt', tour: 'gantt', title: tr('Gantt-vyn'),
      lead: tr('Faser är färgade rader, ◆ är gater och milstolpar, pilar är beroenden.'), body: [
      tr('Varje fas är en färgad rubrikrad med en fasstapel. Klicka på raden för att fälla ihop eller ut fasen.'),
      tr('◆ är milstolpar och gater. Pilar visar beroenden – en röd pil betyder att ordningen inte går ihop.'),
      tr('Flaggor: <b>! Sen</b> = försenad, <b>⇄ +7 d</b> = flyttad sedan förra importen, <b>? Kontrollera</b> = osäker matchning vid import.'),
      tr('Nyckeltalen högst upp visar antal, andel klart, försenade, gate-beredskap och nästa milstolpe.'),
      tr('Byt skala med <b>Vecka</b>, <b>Månad</b> eller <b>Kvartal</b>. <b>Dölj klara</b> och sökrutan filtrerar listan.'),
      tr('Klicka på nyckeltalet <b>försenade</b> för att bara visa försenade aktiviteter – klicka igen för att visa alla. <b>Klart</b> i panelen kan dras eller skrivas in som siffra.'),
      tr('<b>Roadmap</b> visar en översikt per fas – bra i presentationer.'),
      tr('Byt färg på en fas med 🎨 på fasraden eller <b>⋯ → 🎨 Färger…</b> – se artikeln <b>Färger</b>.'),
      tr('Kryssrutan <b>Timmar</b> visar planerad insats i listan när planen har insats – se <b>Insats och belastning</b>.'),
      tr('📉 på fasraden visar burndown för fasen eller sprinten – se <b>Burndown</b>.'),
      tr('<b>Kritisk linje</b> markerar aktiviteterna som styr planens slut eller en gate – se <b>Kritisk linje och marginal</b>.'),
      tr('<b>📊 Uppföljning ▾</b> i toppmenyn har gate-checklistan, risklistan, veckostatus, milstolpetrenden och burndown. <b>⋯</b> bredvid planlistan har resten under rubriker: Ny, Den här planen, Dela och exportera, Program och Historik.'),
    ], keywords: 'gantt roadmap nyckeltal flaggor färg burndown uppföljning meny menu follow-up' },
    { id: 'andra', cat: 'plan', img: '03-edit', tour: 'gantt', title: tr('Ändra i planen'),
      lead: tr('Dra staplar eller klicka på en aktivitet för att ändra – datum kan skrivas som vecka (2645).'), body: [
      tr('Dra en stapel för att flytta den, eller dra i kanten för att ändra start eller slut.'),
      tr('Klicka på en aktivitet för att öppna panelen: namn, fas, datum, klart, ansvarig, beroenden och anteckningar.'),
      tr('<b>+ Aktivitet</b> lägger till en ny aktivitet. <b>↶ Ångra</b> (Ctrl+Z) tar tillbaka den senaste ändringen.'),
      tr('Ändringar sparas automatiskt.'),
    ], keywords: 'edit panel ångra undo' },
    { id: 'veckor', cat: 'plan', tour: 'new-weeks', title: tr('Veckor ÅÅVV'),
      lead: tr('Datum kan skrivas och visas som vecka: <b>2645</b> = vecka 45 2026.'), body: [
      tr('Datum kan skrivas som vecka (ÅÅVV) i fältet bredvid datumet, t.ex. <b>2645</b> = vecka 45 2026. Start blir måndag och slut fredag.'),
      tr('Det går också att skriva 26-45, v45 eller v45 2026.'),
      tr('Veckan visas i tooltip, panelen, nyckeltalet nästa milstolpe, programöversikten och gate-checklistan.'),
    ], keywords: 'week vecka yyww' },
    { id: 'beroenden', cat: 'plan', title: tr('Beroenden'),
      lead: tr('Pilar visar vad som måste vara klart först – NexusOrdo varnar men flyttar aldrig datum.'), body: [
      tr('Klicka på en aktivitet och välj under <b>Beroenden</b> vilka aktiviteter som måste vara klara först.'),
      tr('En röd pil betyder att ordningen inte går ihop: aktiviteten börjar innan den föregående är klar.'),
      tr('Ingen automatisk schemaläggning: datum sätts av dig, beroenden varnar när ordningen inte går ihop.'),
      tr('Beroenden från Planner följer med vid import och finns kvar när planen uppdateras.'),
      tr('<b>Typ och fördröjning:</b> Planner Premium-exportens <b>AS, SS, AA, SA</b> (svenska) och <b>FS, SS, FF, SF</b> (engelska) med fördröjning, t.ex. <b>+2 dagar</b>, läses in. Pilen går från föregångarens start eller slut till efterföljarens start eller slut, och tooltipen visar t.ex. <b>SS +2 d</b>. Pilen blir röd först när typen bryts. Egna beroenden får typ och fördröjning (arbetsdagar) i panelen; de från Planner skrivs över vid uppdatering.'),
      tr('Beroenden mellan projekt visas i programvyn.'),
    ], keywords: 'dependency pil föregående' },
    { id: 'dokument', cat: 'plan', tour: 'new-docs', title: tr('Dokument på aktiviteter'),
      lead: tr('Länka dokument från SharePoint till en aktivitet – bara länken sparas.'), body: [
      tr('<b>Dokument</b> i panelen: klistra in en länk från SharePoint. Aktiviteten får 📎 i Gantt-vyn och länken finns kvar vid ny import.'),
      tr('Aktiviteter med dokument får 📎 med antal. Länkarna finns kvar när planen uppdateras från Planner.'),
      tr('Gate-milstolpens panel visar alla dokument i fasen.'),
    ], keywords: 'sharepoint länk dokument document' },
    { id: 'checklista-aktivitet', cat: 'plan', tour: 'new-checks', title: tr('Checklista på aktiviteter'),
      lead: tr('Deluppgifter på en aktivitet – från Planner eller egna – som du bockar av i NexusOrdo.'), body: [
      tr('Planners checklista följer med när planen importeras eller uppdateras från Excel. Har planen importerats tidigare: <b>⟳ Uppdatera → Uppdatera från Excel…</b> en gång så kommer punkterna.'),
      tr('<b>Checklista</b> i panelen: bocka av, lägg till, ändra text (klicka på texten), ta bort och flytta upp eller ner. Ändringarna sparas med <b>Spara</b> och går att ångra.'),
      tr('Aktiviteten får <b>☑ 2/3</b> i Gantt-vyn, listan och tooltip. Grön betyder att alla punkter är klara men att aktiviteten inte är markerad klar – filtret <b>☑ Checklista klar</b> visar bara dem.'),
      tr('Planners export säger bara hur många punkter som är klara, inte vilka. Därför är punkterna obockade första gången och räknaren visas som <b>Planner: 2 av 3 klara</b>.'),
      tr('Vid uppdatering behålls dina bockar och punkter du lagt till. Nya punkter i Planner läggs till. En punkt som tagits bort i Planner tas bort bara om den inte är bockad eller ändrad här – annars behålls den och visas i förhandsvisningen.'),
      tr('NexusOrdo skriver inte till Planner – bockar du av här, gör det i Planner också om planen fortsätter att uppdateras därifrån.'),
      tr('Punkterna följer med i <b>Exportera plan (Excel)</b> och i den lokala versionen.'),
    ], keywords: 'checklist checklista deluppgift subtask bocka punkter planner' },
    { id: 'bild', cat: 'plan', img: '09-export', title: tr('Exportera bild'),
      lead: tr('<b>Exportera bild</b> ger en bild för PowerPoint och e-post.'), body: [
      tr('<b>Exportera bild</b> gör en bild av Gantt- eller roadmapvyn som passar i PowerPoint och e-post.'),
      tr('Välj <b>Kopiera</b> och klistra in, eller <b>Ladda ner PNG</b>.'),
      tr('Om nedladdningen blockeras öppnas bilden i en ny flik – högerklicka och välj <b>Spara bild som</b>.'),
    ], keywords: 'export png powerpoint' },
    { id: 'exportplan', cat: 'plan', tour: 'new-planexport', title: tr('Exportera och importera planer'),
      lead: tr('<b>⋯ → ⬇ Exportera plan (Excel)…</b> sparar planer i en Excel-fil som kan importeras i en annan miljö.'), body: [
      tr('Välj den öppna planen, alla planer eller – i programvyn – programmet med dess planer. Allt kan också exporteras som säkerhetskopia.'),
      tr('Filen har läsbara flikar (aktiviteter med veckor, risker, veckostatus, projektuppgifter) och en dold flik <b>TimePlan-data</b> med hela planen.'),
      tr('Importera med <b>+ Ny plan / Importera…</b> i planväljaren. Du ser vad som skapas innan något sparas, och importen skapar alltid nya planer.'),
      tr('Finns redan en plan med samma namn får den nya tillägget ”(importerad datum)”.'),
    ], keywords: 'export import backup säkerhetskopia excel flytta' },
    { id: 'skapamall', cat: 'plan', img: '17-save-template', tour: 'new-templates', title: tr('Skapa mall'),
      lead: tr('<b>⋯ → 📐 Spara som mall…</b> gör en mall av planen, så att nästa projekt kan börja från den.'), body: [
      tr('Välj faser och aktiviteter i trädet – alla är valda från början. Ge mallen ett namn och en beskrivning.'),
      tr('Välj ankare: planens start eller en gate. Datumen sparas som veckor före eller efter ankaret.'),
      tr('Faser, längder i veckor, milstolpar, gater, beroenden, checklistornas punkter och <b>gate-checklistan</b> (dina punkter per gate) följer med. Bockar, svar, risker och status följer inte med.'),
      tr('<b>⋯ → Ny plan från mall…</b> visar mallen under <b>Mina mallar</b>. Välj den och skriv ankarets vecka (ÅÅVV).'),
      tr('<b>⇪ Importera mall från fil…</b> läser en mallfil (Excel) – så delar du mallar med kollegor.'),
      tr('Mallen sparas också som en fil när du skapar den.'),
    ], keywords: 'mall template spara som mall skapa mall egen mall mina mallar' },
    { id: 'agila', cat: 'plan', img: '16-agile', tour: 'new-agile', title: tr('Agila mallar'),
      lead: tr('<b>⋯ → Ny plan från mall…</b> → <b>Agilt</b>: Scrum och PI-planering (SAFe-inspirerad). Antal och längd väljer du när planen skapas.'), body: [
      tr('<b>Scrum:</b> Sprint 0 (uppstart) och N sprintar à 1–4 veckor (1–26 sprintar, förvalt 6 × 2 veckor). Varje sprint är en egen fas med <b>Sprint Planning</b>, <b>Sprint Backlog</b>, <b>Sprint Review</b> och <b>Sprint Retrospective</b>.'),
      tr('<b>Release var X:e sprint</b> (0 = ingen) och alltid efter sista sprinten, i fasen <b>Releases</b> tillsammans med <b>Product Goal</b> som gate.'),
      tr('<b>PI-planering (SAFe-inspirerad):</b> 1–8 PI à 8–12 veckor med <b>PI Planning</b>, <b>Iteration 1–4</b>, <b>IP Iteration</b>, <b>System Demo</b> och <b>Inspect & Adapt</b>.'),
      tr('Skriv startveckan (ÅÅVV). Förhandsvisningen visar antal per fas.'),
      tr('Sprintarna hänger ihop med beroenden. Datum sätts en gång – ingen automatisk schemaläggning efteråt.'),
      tr('Burndown och velocity per sprint: <b>📊 Uppföljning → 📉 Burndown…</b> eller 📉 på sprintens fasrad – se <b>Burndown</b>.'),
    ], keywords: 'agil agile scrum sprint pi safe-inspirerad iteration release product goal hybrid retrospective review planning' },
    { id: 'farger', cat: 'plan', img: '15-colors', tour: 'new-colors', title: tr('Färger'),
      lead: tr('Välj färg per fas och en palett för planen med <b>⋯ → 🎨 Färger…</b> eller 🎨 på fasraden.'), body: [
      tr('Paletter: <b>Standard</b> (förvald), <b>Mjuk</b> och <b>Hög kontrast</b>.'),
      tr('Klicka på en förvald färg eller välj <b>Egen…</b> för en valfri färg. Den gäller före paletten. <b>Återställ</b> går tillbaka till palettens färg.'),
      tr('Texten på fasraden blir mörk eller vit efter färgen och kanten mörkas så att den syns. Ger en egen färg lägre kontrast än 3:1 mot bakgrunden visas en varning.'),
      tr('Färgerna gäller i Gantt, Roadmap och den exporterade bilden, och följer med i export, versioner och mallar.'),
    ], keywords: 'färg färger palett kontrast fas bucket color palette pmi' },
    { id: 'versioner', cat: 'plan', img: '18-versions', tour: 'new-versions', title: tr('Versioner och papperskorg'),
      lead: tr('<b>⋯ → 🕘 Versioner…</b> återställer en tidigare version av planen. Borttagna planer ligger i <b>🗑 Papperskorg</b> i 30 dagar.'), body: [
      tr('En version sparas automatiskt före varje <b>Uppdatera från Excel</b>, import ovanpå planen, <b>Ta bort</b> och återställning – och en gång per dag när planen ändras.'),
      tr('<b>⋯ → 🕘 Versioner…</b> listar versionerna med datum, orsak, vem och antal aktiviteter, risker och beroenden. <b>Jämför</b> visar skillnaden mot nu.'),
      tr('<b>Återställ</b>: nuvarande läge sparas först som en version, så att återställningen kan ångras.'),
      tr('<b>Exportera</b> sparar versionen som Excel i samma format som <b>⬇ Exportera plan (Excel)</b>.'),
      tr('Upp till 30 versioner per plan sparas, och minst en per vecka i 8 veckor. I programvyn gäller samma sak för programmet.'),
      tr('<b>Ta bort plan</b> flyttar planen till papperskorgen. Du återställer den med <b>⋯ → 🗑 Papperskorg…</b> inom 30 dagar.'),
      tr('Importerar du en plan som redan finns föreslås <b>Uppdatera</b>. En ny kopia får inte risker, veckostatus, checklistans svar eller kopplingar – ta aldrig bort planen för att importera den på nytt.'),
      tr('I den lokala versionen sparas upp till 10 versioner per plan i webbläsarens arbetskopia. Spara till fil med 💾 för en säker kopia.'),
    ], keywords: 'version historik ångra återställ papperskorg borttagen ta bort backup säkerhetskopia restore trash undo' },
    { id: 'insats', cat: 'plan', img: '19-effort', tour: 'new-effort', title: tr('Insats och belastning'),
      lead: tr('Arbetstid är inte kalendertid: ange insatsen i timmar och se belastningen per person och vecka i fliken <b>Belastning</b>.'), body: [
      tr('Klicka på en aktivitet och fyll i <b>Insats (timmar)</b>: <b>Planerat</b>, <b>Utfört</b> och <b>Kvar</b>. Skriv timmar eller t.ex. <b>2 d</b> (8 h per dag) eller <b>1 v</b> (40 h). Panelen visar också persondagar.'),
      tr('Lämnas <b>Kvar</b> tomt räknas det ut: planerat − utfört, annars planerat × (1 − % klart). Klara aktiviteter har inget kvar.'),
      tr('Planner Premium: kolumnerna <b>Arbete</b>, <b>Slutfört arbete</b> och <b>Återstående arbete</b> (Work, Completed work, Remaining work) läses vid import och <b>Uppdatera från Excel</b>. Insats som du ändrat i NexusOrdo behålls tills värdet ändras i Planner – förhandsvisningen visar det.'),
      tr('Obs: Premium sätter insatsen till varaktighet × 8 h per tilldelad (heltid) om projektledaren inte angett något. Sådana aktiviteter märks <b>Planners standard</b> och räknas inte i Belastning förrän du kryssar i <b>Planners standardinsats</b>.'),
      tr('<b>Belastning</b> visar personer × veckor: insatsen fördelas jämnt över aktivitetens arbetsdagar (måndag–fredag, utan svenska helgdagar) och delas lika mellan de tilldelade. Grön ≤ 80 %, gul 80–100 %, röd över 100 % av kapaciteten.'),
      tr('<b>Kvar</b> visar återstående insats från idag (kvar på försenade aktiviteter läggs på idag), <b>Planerat</b> hela insatsen över aktivitetens period. Välj 8, 13 eller 26 veckor och bläddra med ◀ ▶.'),
      tr('Klicka på en ruta för att se vilka aktiviteter som ger belastningen, och på en aktivitet för att öppna den. Välj en person i listan eller klicka på namnet för att bara visa den personen.'),
      tr('<b>⋯ → ⏱ Kapacitet…</b> anger timmar per vecka som standard (40) och per person, och om svenska helgdagar är lediga. Veckor med helgdagar får lägre kapacitet.'),
      tr('I programvyn visar <b>Belastning</b> alla programmets planer tillsammans – samma person kan finnas i flera planer. Kapaciteten ändras där för hela programmet.'),
      tr('I Gantt-vyn visar kryssrutan <b>Timmar</b> planerad insats i listan, och tooltipen visar insatsen. Insatsen följer med i export, versioner och mallar (mallar: bara planerade timmar).'),
    ], keywords: 'insats timmar effort work arbete belastning workload kapacitet capacity resurs persondagar helgdagar' },
    // Följa upp
    { id: 'uppdatera', cat: 'follow', img: '04-update', title: tr('Uppdatera från Excel'),
      lead: tr('<b>⟳ Uppdatera → Uppdatera från Excel</b> visar vad som ändrats i Planner innan något sparas.'), body: [
      tr('Exportera planen från Planner igen och välj <b>⟳ Uppdatera ▾ → Uppdatera från Excel…</b>'),
      tr('NexusOrdo jämför filen med den öppna planen och visar först vad som är ändrat, nytt, borttaget och flyttat. Ingen ny plan skapas.'),
      tr('Beroenden, anteckningar och gate-checklistans svar som du lagt till i NexusOrdo finns kvar.'),
      tr('Får du en varning om att filen gäller en annan plan – kontrollera att du valt rätt fil.'),
      tr('Planners export på svenska och engelska fungerar. Saknar filen start- eller slutdatum, eller skulle många aktiviteter bli endagsaktiviteter eller tappa beroenden och gater, varnar NexusOrdo innan något sparas – välj <b>Avbryt</b> och exportera igen.'),
    ], keywords: 'update import planner' },
    { id: 'utfall', cat: 'follow', tour: 'new-actual', title: tr('Utfall'),
      lead: tr('Utfall är veckan då en gate faktiskt passerades – plan och utfall visas sida vid sida.'), body: [
      tr('Gater som blivit klara i Planner utan utfall i NexusOrdo visas under <b>Utfall föreslås</b>: kontrollera veckan (ÅÅVV) och kryssa i de gater som ska få utfall. Gatens status i Planner (I fas, I riskzonen, Ur fas, Klar) följer med: gul kant = i riskzonen, röd kant = ur fas, fylld = klar.'),
      tr('<b>Markera gate passerad…</b> sparar veckan då gaten passerades (utfall). Utfallet kan också skrivas i panelen under <b>Utfall (vecka)</b>.'),
      tr('Utfallet visas som fylld romb i Gantt.'),
    ], keywords: 'actual gate passerad act' },
    { id: 'gatestatus', cat: 'follow', tour: 'new-goalstatus', title: tr('Gatens status från Planner'),
      lead: tr('Status på gaterna i Planner följer med vid import och syns på gatens romb.'), body: [
      tr('Status på gaterna i Planner (Goals) följer med vid import: gul kant = i riskzonen, röd kant = ur fas, fylld romb = klar. Håll musen över gaten för status.'),
      tr('Gater ur fas ger förslaget röd tidplan i veckostatus, gater i riskzonen gul.'),
    ], keywords: 'goals status on track at risk off track' },
    { id: 'checklista', cat: 'follow', img: '05-checklist', tour: 'new-gates', title: tr('Gater och gate-checklista'),
      lead: tr('Egna gater med en egen checklista per gate: Klart, Påverkar eller Kritiskt.'), body: [
      tr('<b>⋯ → 🚩 Gater…</b>: lägg till gater med kod och namn (t.ex. <b>G1</b> Start), ordna dem och koppla varje gate till en milstolpe. I panelen kan en milstolpe också markeras som gate.'),
      tr('<b>📊 Uppföljning → ☑ Gate-checklista…</b>: skriv egna punkter per gate, gärna i avsnitt. Klicka på texten för att ändra, ↑↓ flyttar och 🗑 tar bort.'),
      tr('<b>⇪ Importera punkter (Excel)…</b> läser en fil med kolumnerna <b>Gate</b>, <b>Punkt</b> och <b>Avsnitt</b>. Gater som saknas skapas.'),
      tr('Bedöm varje punkt: <b>Klart</b>, <b>Påverkar</b> (tid, pengar eller resurser) eller <b>Kritiskt</b>. ＋ ger en kommentar, ⊘ betyder att punkten inte gäller.'),
      tr('Fyll i de fem gate-kriterierna och <b>Markera gate passerad…</b>. Gaten i Gantt-vyn visar beredskapen, t.ex. <b>☑ 42 % · 2 röda</b>.'),
      tr('Gaterna och punkterna följer med när planen sparas som mall och i <b>⬇ Exportera plan (Excel)</b>.'),
    ], keywords: 'gate gater checklist checklista beredskap readiness egen' },
    { id: 'risklista', cat: 'follow', img: '13-risks', tour: 'new-risks', title: tr('Risklista'),
      lead: tr('Risker med sannolikhet × konsekvens, åtgärder och topp 5.'), body: [
      tr('<b>📊 Uppföljning → ⚠ Risklista…</b> eller nyckeltalet <b>⚠</b> öppnar risklistan.'),
      tr('Beskriv risken som <b>Om … så …</b> och välj sannolikhet och konsekvens 1–5 – värdet räknas ut.'),
      tr('Skriv förebyggande åtgärder och konsekvensåtgärder, ansvarig och <b>klar senast</b> som vecka (2645).'),
      tr('Matrisen och <b>Topp 5</b> visar de största riskerna. <b>Exportera Excel</b> ger listan som fil.'),
    ], keywords: 'risk matris' },
    { id: 'veckostatus', cat: 'follow', img: '14-status', tour: 'new-status', title: tr('Veckostatus'),
      lead: tr('Veckans status i elva dimensioner, med förslag från trend, risker och checklista.'), body: [
      tr('<b>📊 Uppföljning → 🚦 Veckostatus…</b> eller nyckeltalet <b>🚦</b> öppnar veckans status.'),
      tr('Sätt grön, gul eller röd för de elva dimensionerna. <b>Förslag</b> från milstolpetrenden, risklistan och gate-checklistan sätts med <b>Använd</b> – aldrig automatiskt.'),
      tr('Lägg till åtgärder för gula och röda dimensioner. Total projekthälsa är ditt förslag – styrgruppen fastställer den.'),
      tr('<b>Kopiera från förra veckan</b> sparar tid. Historiken visar de senaste tolv veckorna. <b>Kopiera som text</b> passar Teams och e-post.'),
    ], keywords: 'status report hälsa health' },
    { id: 'trend', cat: 'follow', tour: 'new-trend', title: tr('Milstolpetrend'),
      lead: tr('Hur gaterna har flyttats mellan uppdateringarna – en stigande linje betyder att milstolpen skjutits fram.'), body: [
      tr('<b>📈 Milstolpetrend</b> (klicka på nästa milstolpe eller <b>📊 Uppföljning</b>) visar hur gaterna har flyttats mellan uppdateringarna från Planner.'),
      tr('Rapportdatum åt höger, prognos uppåt. En stigande linje betyder att milstolpen har skjutits fram.'),
      tr('Total förskjutning, antal flyttar och senaste flytt. Röd = minst fyra veckor.'),
      tr('En ögonblicksbild sparas vid import och vid varje uppdatering från Excel. <b>Spara ögonblicksbild</b> sparar en direkt.'),
    ], keywords: 'mta trend milestone' },
    { id: 'burndown', cat: 'follow', img: '21-burndown', tour: 'new-burndown', title: tr('Burndown'),
      lead: tr('Kvarvarande arbete över tid mot en idealkurva – för hela planen, en fas eller en sprint.'), body: [
      tr('<b>📊 Uppföljning → 📉 Burndown…</b> visar hela planen. 📉 på fasraden (håll musen över raden) visar fasen eller sprinten direkt.'),
      tr('<b>Omfång:</b> hela planen, en sprint eller en fas. Faser som heter <b>Sprint N</b>, <b>Iteration N</b> eller <b>PI N</b> räknas som sprintar – som i de agila mallarna.'),
      tr('<b>Mått:</b> <b>Timmar</b> (kvarvarande insats) när minst hälften av aktiviteterna har insats, annars <b>Checklistpunkter</b> när minst hälften har en checklista, annars <b>Aktivitetspoäng</b> (varje aktivitet väger 1, kvar = 1 − % klart). Förvalet är märkt – byt mått med knapparna. Planners standardinsats räknas inte.'),
      tr('Den heldragna linjen är kvarvarande arbete, den streckade idealkurvan går från totalen vid start till noll på slutdagen och sjunker bara på arbetsdagar (helger och svenska helgdagar enligt <b>⏱ Kapacitet…</b>). ▲ markerar dagar då omfånget ökade.'),
      tr('Nyckeltalen visar kvar, andel klart och om du ligger före eller efter idealet idag.'),
      tr('<b>Velocity per sprint</b> (när planen har sprintar): klart per sprint och medel för avslutade sprintar. Klicka på en stapel för sprintens burndown.'),
      tr('Historiken: ett värde sparas när planen sparas (högst ett per dag) och vid uppdatering från Excel. Bakåt i tiden används planens versioner och – uppskattat från klara aktiviteters slutdatum – milstolpetrendens ögonblicksbilder (ofyllda punkter).'),
      tr('I programvyn summeras planerna när måttet finns i alla planer, annars visas varje plan för sig. <b>⬇ Exportera bild (PNG)</b> sparar diagrammet för PowerPoint.'),
    ], keywords: 'burndown burn down sprint velocity kvar remaining ideal scrum agil agile' },
    { id: 'baslinje', cat: 'follow', img: '23-baseline', tour: 'new-baselines', title: tr('Baslinjer'),
      lead: tr('Spara hur planen ser ut i dag och se senare vad som har flyttats – som baslinjen i MS Project.'), body: [
      tr('<b>⋯ → 📏 Baslinjer…</b> → <b>Spara baslinje</b> sparar start och slut för alla aktiviteter och milstolpar. Ge baslinjen ett namn, t.ex. <i>Inför nästa gate</i> – spara gärna en vid varje gate.'),
      tr('Välj baslinje i raden med Vecka/Månad/Kvartal. Baslinjen visas som en tunn grå stapel under aktiviteten (ofylld romb för milstolpar), och avvikelsen i slutdatum står efter namnet: <b>+5 d</b> i rött = senare, <b>−3 d</b> i grönt = tidigare.'),
      tr('Bredvid valet står hur många aktiviteter som slutar senare och tidigare än baslinjen och hur många som är nya. Tooltipen och panelen visar baslinjens datum och avvikelsen.'),
      tr('Upp till 11 baslinjer per plan. I listan byter du namn, sparar om med planens datum i dag (⟳) eller tar bort (🗑) – båda kräver ett andra klick.'),
      tr('Vilken baslinje som visas väljer var och en – planen ändras inte av det. Uppdatera från Excel ändrar inte baslinjerna, och de följer med när planen exporteras, i versionerna och i den lokala versionens fil.'),
    ], keywords: 'baslinje baseline jämför avvikelse variance ms project försening förskjutning' },
    { id: 'kritisk', cat: 'follow', img: '22-critical', tour: 'new-critical', title: tr('Kritisk linje och marginal'),
      lead: tr('Vilka aktiviteter styr slutdatumet, och hur mycket marginal finns det till nästa gate? Beräknas från beroendena – inga datum ändras.'), body: [
      tr('Kryssa i <b>Kritisk linje</b> i raden med Vecka/Månad/Kvartal. <b>Röd ram</b> = kritisk (slack 0 eller mindre), <b>streckad orange</b> = nära kritisk (högst en veckas slack). Övriga aktiviteter tonas ned och pilarna i kedjan markeras.'),
      tr('<b>Mål:</b> planens slut eller en gate. Mot en gate räknas bara aktiviteterna som leder fram till gaten via beroenden. Har gaten inga beroenden räknas fasens aktiviteter som föregångare.'),
      tr('<b>Slack</b> = hur många arbetsdagar aktiviteten kan försenas innan målet flyttas. Den visas i tooltipen och i panelen (med tidigaste och senaste start och slut). Helger och svenska helgdagar räknas inte (<b>⏱ Kapacitet…</b>). Negativ slack betyder att planen redan går ut över målet – ofta en röd pil.'),
      tr('Raden under verktygen visar antal kritiska, andel aktiviteter med beroenden och varningar. Har färre än 30 % av aktiviteterna beroenden kan den kritiska linjen vara ofullständig – lägg till beroenden i panelen (<b>Beroenden – startar efter att dessa är klara</b>).'),
      tr('Nyckeltalet <b>⏳ 3 v till DG</b> visar marginalen till nästa gate som inte är passerad. Klicka för att visa den kritiska linjen mot gaten; tooltipen visar kedjan som styr. Utan beroenden räknas marginalen från fasens sista aktivitet.'),
      tr('Beroendetyp (FS, SS, FF, SF) och fördröjning i arbetsdagar räknas – från Planner Premium, från panelen och mellan projekt i ett program. Utan typ är beroendet slut → start.'),
      tr('I programvyn räknas varje plan mot sitt eget slut, och programmets beroenden mellan projekten kopplar ihop planerna. Projektkorten i översikten visar marginalen till nästa gate per plan.'),
      tr('NexusOrdo flyttar aldrig några datum (ingen automatisk schemaläggning) – den kritiska linjen är ett underlag för dig.'),
    ], keywords: 'kritisk linje critical path slack float marginal margin gate beroenden dependencies cpm' },
    { id: 'program', cat: 'port', img: '08-program', tour: 'program', title: tr('Programvyn'),
      lead: tr('Ett program samlar flera projekts planer och visar beroenden mellan dem.'), body: [
      tr('Ett program samlar flera projekts planer och visar fas, andel klart, försenade och nästa gate per projekt.'),
      tr('Beroenden mellan projekt visas som pilar i statusfärg: grön OK, gul risk, röd blockerad.'),
      tr('<b>Påverkar andra projekt:</b> när en plan i programmet uppdateras visar förhandsvisningen beroenden som blir risk eller blockerade i program du har tillgång till, med marginalen före och efter i dagar och veckor. Programmet visar sedan en banner, och pilarna och aktiviteterna märks <b>ändrad</b> i Gantt tills någon klickar <b>Markera som sett</b>.'),
      tr('Programmet läser planerna men ändrar dem aldrig.'),
      tr('<b>Gater</b> jämför projektens gater med programgaterna – se <b>Programgater och gate-översikt</b>.'),
    ], keywords: 'program' },
    { id: 'delprojekt', cat: 'port', title: tr('Huvudprojekt och delprojekt'),
      lead: tr('Ett huvudprojekt har en huvudplan med de gemensamma gaterna. Varje delprojekt har en egen plan som följer gaterna eller har egna. Så här lägger du till delprojekt i ett befintligt projekt:'), body: [
      tr('<b>1. Gör projektets plan till huvudplan.</b> Öppna planen och välj <b>⋯ → 🏷 Projektuppgifter…</b>. Fyll i <i>Program</i> och <i>{l1}</i> (huvudprojektets namn), kryssa i <i>Huvudplan</i> och klicka <b>Spara</b>.', { l1: tr('Nivå 1 (huvudprojekt)') }),
      tr('<b>2. Lägg huvudplanen i ett program.</b> Finns inget program: <b>⋯ → Nytt program…</b>. Välj programmet (▣) i planväljaren, klicka <b>＋ Lägg till plan</b> och kryssa i huvudplanen i listan.'),
      tr('<b>3. Klicka ＋ Nytt delprojekt</b> på huvudprojektets kort i programmets <b>Översikt</b>. Knappen syns när huvudprojektet har en huvudplan.'),
      tr('<b>4. Fyll i dialogen.</b> Skriv delprojektets namn – det blir <i>{l2}</i>. Gate-veckorna är huvudplanens: låt dem stå, ändra dem om delprojektet har egna gater, eller töm dem så ärver delprojektet huvudplanens. Välj mallgrupper och klicka <b>Skapa plan</b>.', { l2: tr('Nivå 2 (delprojekt)') }),
      tr('<b>5. Klart.</b> Delprojektet får huvudplanens projektuppgifter, läggs i programmet och visas under huvudprojektet. Upprepa för varje delprojekt.'),
      tr('<b>Finns delprojektets plan redan</b> (t.ex. importerad från Planner): öppna den, välj <b>⋯ → 🏷 Projektuppgifter…</b>, fyll i samma <i>Program</i> och <i>{l1}</i> som huvudplanen och delprojektets namn i <i>{l2}</i>. Lägg sedan till planen i programmet med <b>＋ Lägg till plan</b>.', { l1: tr('Nivå 1 (huvudprojekt)'), l2: tr('Nivå 2 (delprojekt)') }),
      tr('Hierarkin kommer från <b>🏷 Projektuppgifter</b>: program → nivå 1 (huvudprojekt) → nivå 2 (delprojekt).'),
      tr('<b>Huvudplan</b>: kryssa i <i>Huvudplan</i> i Projektuppgifter. Huvudplanens gater är huvudprojektets gater; delprojekt utan egna gater visar dem som <b>ärvda</b>.'),
    ], keywords: 'huvudplan delprojekt huvudprojekt ärvd subproject main skapa plan' },
    { id: 'programgater', cat: 'port', img: '20-gates', tour: 'new-pgates', title: tr('Programgater och gate-översikt'),
      lead: tr('Programmets egna gater jämförs med projektens gater i fliken <b>Gater</b>.'), body: [
      tr('<b>⋯ → 🚩 Programgater…</b>: kod, namn, vecka (ÅÅVV) eller datum, status och anteckning. Koden är fri, t.ex. G1–G4, och jämförs med projektens gater med samma kod.'),
      tr('Programgaterna visas som chips överst i <b>Översikt</b> och som romber på raden <b>Programgater</b> överst i <b>Gantt</b>, med en streckad linje genom diagrammet.'),
      tr('<b>Gater</b> visar projekten (huvudprojekt → huvudplan och delprojekt) × gate-koderna. Varje ruta har planens vecka, utfall, status och avvikelsen i hela veckor mot programgaten – plus betyder att projektet ligger senare. Ärvda gater har streckad ram.'),
      tr('Färger: <b>röd</b> minst en vecka efter programgaten eller Ur fas, <b>orange</b> senare inom samma vecka, I riskzonen eller passerad utan utfall, <b>grön</b> i tid eller klar, <b>grå</b> saknas. <b>Bara avvikelser</b> visar bara röda och orange.'),
      tr('<b>Varning när en gate glider förbi:</b> när ett projekt uppdateras från Planner och en gate hamnar minst en vecka efter programgaten (eller ännu längre efter än förut) visar förhandsvisningen det, och programmet får en banner tills någon klickar <b>Markera som sett</b>. Rutan i Gater får ⚠ med veckan före och efter.'),
      tr('⚠ markerar gaten efter en aktivitet vars beroende har påverkats av en uppdatering (som bannern i Översikt). Klicka på en ruta för detaljer och <b>Öppna plan</b>; <b>⬇ Exportera (Excel)</b> sparar tabellen med veckor som tal.'),
      tr('Programmet ändrar aldrig projektens planer – projekten äger sina gater, programmet äger samordningen.'),
    ], keywords: 'programgate programgater gate-översikt gater avvikelse program gate overview deviation space' },
    // Kunskapsbank
    { id: 'kalla', cat: 'kb', title: tr('Var kommer planen ifrån?'),
      lead: tr('Varje plan har en källa som äger datumen – NexusOrdo visar och analyserar.'), body: [
      tr('<b>Planner</b> är källan för planer som importerats från Planner. De hålls aktuella med <b>⟳ Uppdatera → Uppdatera från Excel</b>.'),
      tr('<b>NexusOrdo</b> är källan för planer som skapats här, till exempel från en mall eller som tom plan. Där ändrar du direkt i Gantt-vyn.'),
      tr('Ändringar i NexusOrdo går inte tillbaka till Planner. Ändra datum i Planner för Planner-planer – annars skrivs de över vid nästa uppdatering.'),
    ], keywords: 'källa source planner' },
    { id: 'ms-project', cat: 'kb', img: '11-roadmap', title: tr('Från MS Project till NexusOrdo'),
      lead: tr('Faser, milstolpar och beroenden som i MS Project – men utan automatisk schemaläggning.'), body: [
      tr('Sammanfattningsaktivitet → <b>fas</b> (bucket i Planner). Milstolpe → <b>milstolpe</b> eller <b>gate</b>.'),
      tr('Föregående aktiviteter → <b>beroenden</b> (slut till start). % färdigt → <b>Klart</b>.'),
      tr('Ingen automatisk schemaläggning: datum sätts av dig, beroenden varnar när ordningen inte går ihop.'),
      tr('Veckonummer (ÅÅVV) fungerar som i MS Project-tidplaner. <b>Roadmap</b>-vyn ger en översikt per fas.'),
    ], keywords: 'ms project mpp' },
    { id: 'faq', cat: 'kb', qa: true, title: tr('Vanliga frågor'),
      lead: tr('Svar på det som oftast undras.'), body: [
      tr('<b>Går mina ändringar tillbaka till Planner?</b> Nej. Planner äger uppgifterna; ändringar i NexusOrdo stannar i NexusOrdo.'),
      tr('<b>Försvinner mina beroenden när jag uppdaterar från Excel?</b> Nej, beroenden och anteckningar finns kvar.'),
      tr('<b>Varför står det ”? Kontrollera”?</b> I Planner Premium är Task number en radplats som kan ändras. När en aktivitet inte kan matchas säkert markeras den.'),
      tr('<b>Var sparas mina planer?</b> I filerna du sparar med 💾. Webbläsaren har bara en arbetskopia.'),
      tr('<b>Kan jag ha samma gate-checklista i flera planer?</b> Ja – spara planen som mall eller läs in samma Excel-fil i varje plan.'),
    ], keywords: 'faq frågor' },
    { id: 'ordlista', cat: 'kb', title: tr('Ordlista'),
      lead: tr('Ord och tecken som används i NexusOrdo.'), body: [
      tr('<b>ÅÅVV</b> – år och vecka, t.ex. 2645 = vecka 45 2026. Start är måndag, slut fredag.'),
      tr('<b>Gate</b> – beslutspunkt i planen med egen kod och eget namn (<b>⋯ → 🚩 Gater…</b>). Visas som romb.'),
      tr('<b>Gate-checklista</b> – dina punkter inför en gate, bedömda som Klart, Påverkar eller Kritiskt. <b>Beredskap</b> = andel klara.'),
      tr('<b>Utfall</b> – veckan då gaten faktiskt passerades. Plan = ofylld romb ◇, utfall = fylld ◆.'),
      tr('<b>Huvudplan</b> – projektets plan som är källan för gater och status. Programmet läser den.'),
      tr('<b>? Kontrollera</b> – aktiviteten kunde inte matchas säkert vid import.'),
      tr('<b>Sprint / PI</b> – agila tidsrutor: en sprint är 1–4 veckor (Scrum), en PI (Program Increment) 8–12 veckor med 4 iterationer + IP Iteration (SAFe-inspirerad). Se <b>Agila mallar</b>.'),
    ], keywords: 'glossary ordlista begrepp sprint pi agil' },
  ];
}

/* ---------- Hjälpcenter och rundturer ----------
   Bilderna kommer från app/howto/<sv|en>/ (#78) med en neutral plan. */
// Anpassningar av rundturerna i tours()
const TOUR_FIX = {
    template: t => ({ ...t, steps: t.steps.filter(s => s.sel !== '.tpl-cols').map(s => s.sel === '#tplSrc' ? { ...s, text: tr('Inbyggda agila mallar eller Mina mallar – dina egna. Här importerar du också en mall från fil.') } : s) }),
    program: t => ({ ...t, steps: t.steps.filter(s => s.sel !== '.pg-sum').map(s => s.sel === '#pgSeg' ? { ...s, text: tr('Gantt visar alla projekt med sina faser.') } : s) }),
    checklist: t => ({ ...t, steps: [...t.steps, { sel: '.ck-addrow', title: tr('Egna punkter'), text: tr('Skriv en punkt och ett avsnitt, eller läs in punkter från Excel (Gate, Punkt, Avsnitt).') }] }),
    'new-agile': t => ({ ...t, steps: [{ sel: '#tplSrc', title: tr('Nytt: agila mallar'), text: tr('Under Agilt finns Scrum och PI-planering (SAFe-inspirerad).') }, { ...t.steps[1], text: tr('Välj en agil mall: fälten för antal sprintar eller PI, veckor och release var X:e visas till höger. Skriv startveckan.') }, { ...t.steps[2], text: tr('Sprintar och PI blir egna faser med sina händelser.') }] }),
    'new-colors': t => ({ ...t, steps: t.steps.map(s => s.title === tr('Paletter') ? { ...s, text: tr('⋯ → 🎨 Färger… väljer palett för hela planen (Standard, Mjuk, Hög kontrast) och färg för alla faser.') } : s) }),
    'new-status': t => ({ ...t, steps: t.steps.map((s, i) => i ? s : { ...s, text: tr('Klicka på 🚦 eller välj 📊 Uppföljning → 🚦 Veckostatus… för veckans status.') }) }),
    'new-risks': t => ({ ...t, steps: t.steps.map((s, i) => i ? s : { ...s, text: tr('📊 Uppföljning → ⚠ Risklista…: sannolikhet × konsekvens, åtgärder och ansvarig.') }) }),
};
// Rundtur: egna gater och generisk gate-checklista
const gateTours = () => [
  { id: 'new-gates', kind: 'new', since: '2026-11-02', title: tr('Gater och gate-checklista'), steps: [
    { sel: '#planSelect', title: tr('Nytt: egna gater'), text: tr('Öppna en plan för att lägga till gater.'), skip: () => hasPlanTasks() },
    { sel: '#planMenuBtn', title: tr('Nytt: egna gater'), text: tr('⋯ → 🚩 Gater… lägger till gater med egen kod och eget namn och kopplar dem till milstolpar. En milstolpe kan också bli gate i panelen.') },
    { sel: '#fuBtn', title: tr('Egen gate-checklista'), text: tr('📊 Uppföljning → ☑ Gate-checklista… har dina punkter per gate: lägg till, ändra, flytta, ta bort eller läs in från Excel (Gate, Punkt, Avsnitt).') },
    { sel: '#kpis', title: tr('Beredskap'), text: tr('Bedöm punkterna som Klart, Påverkar eller Kritiskt. Beredskapen visas vid gaten i Gantt och i nyckeltalen.'), skip: () => !hasPlanTasks() },
    { sel: '#planMenuBtn', title: tr('Med i mallen'), text: tr('📐 Spara som mall… tar med gaterna och punkterna, så att nästa projekt börjar med samma checklista.') },
  ] },
];
function helpFor(list, file = false) { return file ? fileHelp(list) : list; }
function toursFor(list, file = false) {
  const ts = [...list.map(t => TOUR_FIX[t.id] ? TOUR_FIX[t.id](t) : t), ...gateTours()];
  return file ? fileTours(ts) : ts.filter(t => !t.fileOnly); // fileOnly: bara i lokala filen (#102)
}
// Lokala filen (FILE_MODE): texter om Nytt program ersätts med hur det går till lokalt (#102). Texterna är redan översatta (tr).
const FILE_NEWPROG_RE = /⋯ → (?:Nytt program|New programme)…/;
// Bilder med en egen variant för lokala filen (body.file-mode) – tas med scripts/howto-bilder.mjs
const FILE_IMG = { '08-program': '08-program-fil' };
function fileHelp(arts) {
  return arts.map(a => {
    const body = a.body.map(s => !FILE_NEWPROG_RE.test(s) ? s : /^<b>2\./.test(s) ? tr('<b>2. Lägg huvudplanen i ett program.</b> Finns inget program: <b>⋯ → Nytt program…</b>. Klicka <b>＋ Lägg till plan</b> i programmet och välj huvudplanen i listan. Spara programmet med <b>💾 Spara</b>.') : tr('I den lokala versionen: <b>⋯ → Nytt program…</b>, lägg till planerna med <b>＋ Lägg till plan</b> (välj i listan) och spara programmet med <b>💾 Spara</b> – filen innehåller programmet och alla dess planer.'));
    const img = FILE_IMG[a.img] || a.img;
    return body.length === a.body.length && body.every((s, i) => s === a.body[i]) && img === a.img ? a : { ...a, img, body };
  });
}
function fileTours(ts) {
  ts = ts.map(t => t.steps.some(s => s.fileText) ? { ...t, steps: t.steps.map(s => s.fileText ? { ...s, text: s.fileText } : s) } : t);
  return ts.map(t => t.id !== 'intro' ? t : { ...t, steps: t.steps.map(s => s.sel === '#planSelect' && s.title === tr('Dina planer') ? { ...s, text: tr('Välj plan här. Menyn ⋯ bredvid har ny plan, mallar, Öppna och Spara till fil, export och versioner.') } : s) });
}
const shownArticles = () => helpFor(helpArticles(), FILE_MODE);
const shownTours = () => toursFor(tours(), FILE_MODE);

// Bilderna bäddas in av scripts/build-lokal.mjs; källkoden läser filerna i app/howto/
/* HOWTO:START */
const HOWTO_IMG = {};
/* HOWTO:END */
// Bygget bäddar in bilderna; källkoden läser filerna i app/howto/<sv|en>/ (#78)
const howtoImg = img => (HOWTO_IMG[LANG] || {})[img] || `howto/${LANG}/${img}.png`;

// Sök: utan hänsyn till skiftläge och accenter (å = a), alla ord ska finnas i titel, ingress, text eller nyckelord
let helpQ = '';
const foldText = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const helpPlain = s => String(s).replace(/<[^>]*>/g, '');
const helpWords = q => foldText(q).split(/\s+/).filter(Boolean);
const helpHits = (arts, q) => {
  const ws = helpWords(q);
  if (!ws.length) return arts;
  return arts.filter(a => { const t = foldText(helpPlain([a.title, a.lead, ...a.body, a.keywords || ''].join(' '))); return ws.every(w => t.includes(w)); });
};
// Markerar sökorden i html (bara i texten, inte i taggarna)
function helpMark(html, q) {
  const ws = helpWords(q);
  if (!ws.length) return html;
  return String(html).split(/(<[^>]*>)/).map(part => {
    if (part.startsWith('<')) return part;
    let norm = ''; const map = [];
    for (let i = 0; i < part.length; i++) { const f = foldText(part[i]); for (let k = 0; k < f.length; k++) map.push(i); norm += f; }
    const hits = [];
    ws.forEach(w => { for (let k = norm.indexOf(w); k >= 0; k = norm.indexOf(w, k + w.length)) hits.push([map[k], map[k + w.length - 1] + 1]); });
    hits.sort((a, b) => a[0] - b[0]);
    let out = '', last = 0;
    hits.forEach(([a, b]) => { if (a < last) return; out += part.slice(last, a) + '<mark>' + part.slice(a, b) + '</mark>'; last = b; });
    return out + part.slice(last);
  }).join('');
}
// Utdrag runt första träffen i ingress eller text (visas under titeln i menyn)
function helpSnippet(a, q) {
  const ws = helpWords(q); if (!ws.length) return '';
  const src = [a.lead, ...a.body].map(helpPlain).find(s => ws.some(w => foldText(s).includes(w)));
  if (!src) return '';
  const k = Math.min(...ws.map(w => foldText(src).indexOf(w)).filter(i => i >= 0)), from = Math.max(0, k - 24);
  return helpMark(esc((from ? '…' : '') + src.slice(from, from + 80) + (src.length > from + 80 ? '…' : '')), q);
}

function renderHowto() {
  const v = $('#howtoView');
  v.innerHTML = `<div class="ht-wrap">
    <nav class="ht-toc" aria-label="${tr('Hjälpcenter')}">
      <div class="ht-head"><div class="ht-title">📖 ${'NexusOrdo – ' + tr('Hjälpcenter')}</div>
        <input type="search" id="htQ" placeholder="${tr('Sök i hjälpen…')}" value="${esc(helpQ)}" autocomplete="off"></div>
      <div class="ht-nav" id="htNav"></div>
    </nav>
    <article class="ht-main" id="htMain"></article></div>`;
  helpNav();
  helpShow(ui.helpId);
  const q = $('#htQ', v);
  q.oninput = () => { helpQ = q.value; helpNav(); $('#htNav').scrollTop = 0; helpShow(ui.helpId, false); };
  q.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); const a = $('#htNav a'); if (a) helpShow(a.dataset.ht); }
    else if (e.key === 'Escape' && q.value) { e.preventDefault(); e.stopPropagation(); q.value = helpQ = ''; helpNav(); helpShow(ui.helpId, false); }
  };
}
function helpNav() {
  const box = $('#htNav'); if (!box) return;
  const hits = helpHits(shownArticles(), helpQ), q = helpQ;
  if (!hits.length) { box.innerHTML = `<p class="ht-none">${tr('Inga träffar för ”{q}”. Prova ett annat ord, t.ex. gate, risk eller vecka.', { q: esc(q.trim()) })}</p>`; return; }
  box.innerHTML = HELP_CATS().map(([c, name]) => {
    const list = hits.filter(a => a.cat === c);
    return list.length ? `<div class="ht-cat">${esc(name)}</div>${list.map(a => `<a href="#" data-ht="${a.id}" class="${a.id === ui.helpId ? 'on' : ''}">${helpMark(esc(a.title), q)}${q.trim() ? `<small>${helpSnippet(a, q)}</small>` : ''}</a>`).join('')}` : '';
  }).join('');
  $$('a', box).forEach(a => a.onclick = e => { e.preventDefault(); helpShow(a.dataset.ht); });
}
function helpShow(id, toTop = true) {
  const main = $('#htMain'); if (!main) return;
  const arts = shownArticles(), a = arts.find(x => x.id === id) || arts[0], i = arts.indexOf(a), prev = arts[i - 1], next = arts[i + 1];
  if (ui.helpId !== a.id) { ui.helpId = a.id; saveUi(); }
  const m = s => helpMark(s, helpQ), cat = (HELP_CATS().find(c => c[0] === a.cat) || [])[1] || '';
  const tour = a.tour && shownTours().some(t => t.id === a.tour);
  main.innerHTML = `<div class="ht-kicker">${esc(cat)}</div><h1>${m(esc(a.title))}</h1>
    <p class="ht-lead">${m(a.lead)}</p>
    ${tour ? `<button class="btn small ht-tour" id="htTour">▶ ${tr('Visa rundtur')}</button>` : ''}
    ${a.img ? `<button class="ht-img" data-img="${a.img}" title="${tr('Klicka för större bild')}"><img src="${howtoImg(a.img)}" alt="${esc(a.title)}"></button>` : ''}
    <ul class="ht-points${a.qa ? ' qa' : ''}">${a.body.map(b => `<li>${m(b)}</li>`).join('')}</ul>
    <div class="ht-pager">${prev ? `<a href="#" data-ht="${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="#" data-ht="${next.id}">${esc(next.title)} →</a>` : ''}</div>`;
  if (toTop) main.scrollTop = 0;
  $$('.ht-pager a', main).forEach(x => x.onclick = e => { e.preventDefault(); helpShow(x.dataset.ht); });
  const img = $('.ht-img', main); if (img) img.onclick = () => openLightbox(howtoImg(img.dataset.img), a.title);
  if (tour) $('#htTour', main).onclick = () => helpTour(a.tour);
  $$('#htNav a').forEach(x => x.classList.toggle('on', x.dataset.ht === a.id));
  const on = $('#htNav a.on'); if (on && toTop) on.scrollIntoView({ block: 'nearest' });
}
// Visa rundtur: byt först till sidan som rundturen visar, sedan startTour
async function helpTour(id) {
  const t = shownTours().find(x => x.id === id); if (!t) return;
  if ((t.view === 'program' || t.view === 'gates') && ui.mode !== 'program' && programs.length) { ui.view = 'gantt'; ui.pgView = t.view === 'gates' ? 'gates' : 'cards'; selectProgram(programs[0].id); }
  else { ui.view = t.view === 'load' ? 'load' : 'gantt'; if (t.view === 'program') ui.pgView = 'cards'; if (t.view === 'gates' && ui.mode === 'program') ui.pgView = 'gates'; if (t.view === 'load' && ui.mode === 'program') ui.pgView = 'load'; saveUi(); render(true); }
  if (t.view === 'checklist' && hasPlanTasks()) openChecklist();
  if (t.view === 'template') await openTemplateDialog('new');
  setTimeout(() => startTour(id), 300);
}
// Öppna hjälpcentret, eventuellt vid en viss artikel (?-menyn, &help=<id>)
function openHelp(id) {
  if (id) { ui.helpId = id; helpQ = ''; }
  if (ui.view !== 'howto') { ui.view = 'howto'; saveUi(); render(true); } else renderHowto();
}
// Artikeln för sidan som visas (snabblänk i ?-menyn)
function helpPageArticle() {
  if (ui.view === 'howto') return null;
  const id = !$('#loadView').hidden ? 'insats' : !$('#gatesView').hidden ? 'programgater' : ui.mode === 'program' && program ? 'program'
    : hasPlanTasks() ? 'gantt' : 'importera';
  return shownArticles().find(a => a.id === id) || null;
}
// &help=<id> i länken öppnar hjälpcentret vid artikeln
function helpFromUrl() {
  const urls = [location.href];
  try { urls.push(window.top.location.href); } catch { /* annan ram */ }
  if (document.referrer) urls.push(document.referrer);
  for (const u of urls) { const m = String(u).match(/[?#&]help=([A-Za-z0-9-]+)/); if (m) return m[1]; }
  return null;
}

function openLightbox(src, alt) {
  const lb = document.createElement('div');
  lb.className = 'ht-lb';
  lb.innerHTML = `<img src="${esc(src)}" alt="${esc(alt)}"><button class="icon-btn" title="${tr('Stäng')}">✕</button>`;
  const close = () => { lb.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  lb.onclick = close;
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(lb);
}

/* =========================================================
   Onboarding i steg (#60) – korta rundturer som pekar på riktiga knappar; hjälpcentret (How to) är uppslaget.
   Kom igång startar inte automatiskt (publicerad länk kan inte komma ihåg något): rutan "Ny i NexusOrdo?" erbjuder den,
   och &tour=1 (eller &tour=<id>) i länken startar den direkt. Sidrundturer erbjuds första gången en sida öppnas under besöket.
   Nytt-rundturer har release-datum (since) och markeras på ?-knappen i 14 dagar.
   Regel: ny eller ändrad funktion = Nytt-rundtur här (kind 'new', since = release-datum) + artikel eller rad i hjälpcentret (helpArticles).
   ========================================================= */
const TOUR_NEW_DAYS = 14;
// Nytt-rundturer som släppts de senaste `days` dagarna (today och since som ÅÅÅÅ-MM-DD)
const newTours = (tours, today, days = TOUR_NEW_DAYS) => tours.filter(t => t.kind === 'new' && t.since
  && toDay(t.since) <= toDay(today) && toDay(today) - toDay(t.since) < days);
const tourSeen = new Set(parseJSON(LS.get('timeplan.tours'), []));
const markTourSeen = id => { tourSeen.add(id); LS.set('timeplan.tours', JSON.stringify([...tourSeen])); };
const tourOffered = new Set(); // under besöket
const hasPlanTasks = () => !!(plan && !plan.synthetic && plan.tasks.length);
const showView = v => { if (ui.view !== v) { ui.view = v; saveUi(); render(true); } };

function tours() {
  return [
    { id: 'intro', kind: 'intro', title: tr('Kom igång'), steps: [
      { sel: '#planSelect', title: tr('Dina planer'), text: tr('Välj plan här. Menyn ⋯ bredvid har ny plan, mallar, export och versioner.') },
      { sel: '#planSelect', title: tr('Importera från Planner'), text: tr('Exportera planen till Excel i Planner och välj + Ny plan / Importera… sist i planväljaren. Faser och gater känns igen automatiskt.') },
      { sel: '#updBtn', title: tr('Uppdatera planen'), text: tr('Har planen ändrats i Planner? Läs in en ny export – du ser vad som ändrats innan något sparas.'), skip: () => $('#updWrap').hidden },
      { sel: '#fuBtn', title: tr('Följa upp'), text: tr('📊 Uppföljning har gate-checklistan, risklistan, veckostatus, milstolpetrenden och burndown.'), skip: () => $('#fuWrap').hidden },
      { sel: '#viewSeg', title: tr('Vyer'), text: tr('Gantt för detaljer, Roadmap för översikt, Belastning för timmar per person. Hjälpcentret öppnas från ? → 📖 Hjälpcenter.') },
      { sel: '#kpis', title: tr('Nyckeltal'), text: tr('Andel klart, försenade, beredskap inför nästa gate och nästa milstolpe – klicka på ☑ för gate-checklistan.'), skip: () => !hasPlanTasks() || ui.view === 'howto' },
      { sel: '#helpBtn', title: tr('Hjälp när du vill'), text: tr('Här kör du rundturer igen, ser vad som är nytt och öppnar hjälpcentret.') },
    ] },
    { id: 'gantt', kind: 'page', view: 'gantt', title: tr('Gantt-vyn'), steps: [
      { sel: '.g-row.grp', title: tr('Faser'), text: tr('Varje fas är en färgad rad. Klicka för att fälla ihop eller ut.') },
      { sel: '.g-row.grp.strong', title: tr('Fasens färg'), text: tr('Håll musen över fasraden: 🎨 byter färg, ↑ ↓ flyttar fasen. ⋯ → 🎨 Färger… väljer palett.') },
      { sel: '#gBodySvg .bar', title: tr('Flytta och ändra'), text: tr('Dra en stapel för att flytta den, eller dra i kanten för att ändra start eller slut.') },
      { sel: '#fStartW', title: tr('Veckor'), text: tr('Klicka på en aktivitet. Datum kan skrivas som vecka, t.ex. 2645.'),
        before: () => { const r = $('.g-row.task'); if (r && $('#drawer').hidden) r.click(); }, after: () => closeDrawer() },
      { sel: '#zoomSeg', title: tr('Skala'), text: tr('Byt mellan vecka, månad och kvartal. Idag visar dagens datum.') },
      { sel: '#critLbl', title: tr('Kritisk linje'), text: tr('Kryssa i Kritisk linje för att se vilka aktiviteter som styr planens slut eller en vald gate. Beräknas från beroendena – inga datum ändras.'), skip: () => $('#critLbl').hidden },
    ] },
    { id: 'checklist', kind: 'page', view: 'checklist', title: tr('Gate-checklistan'), steps: [
      { sel: '.ck-tabs', title: tr('Välj gate'), text: tr('En flik per gate med andel klart och antal röda.') },
      { sel: '.ck-sec[open] .ck-row .ck-st', before: () => { const d = $('.ck-sec'); if (d && !$('.ck-sec[open]')) { d.open = true; d.dispatchEvent(new Event('toggle')); } }, title: tr('Bedöm punkten'), text: tr('Klart, Påverkar (tid, pengar eller resurser) eller Kritiskt. ＋ ger en kommentar, ⊘ betyder att punkten inte gäller.') },
      { sel: '[data-f="bad"]', title: tr('Underlag till styrgruppen'), text: tr('Gula och röda visar det som behöver tas upp vid gaten.') },
    ] },
    { id: 'template', kind: 'page', view: 'template', title: tr('Ny plan från mall'), steps: [
      { sel: '#tplSrc', title: tr('Välj mall'), text: tr('Inbyggda mallar eller Mina mallar – dina egna mallar. Här importerar du också en mall från fil.') },
      { sel: '.tpl-cols', title: tr('Välj grupper'), text: tr('Kryssa i PMI-projektmallen.'), skip: () => !$('.tpl-cols') },
      { sel: '#tplRep', title: tr('Antal och längd'), text: tr('Agila mallar: välj antal sprintar eller PI, veckor per sprint eller PI och release var X:e sprint.'), skip: () => !$('#tplRep') },
      { sel: '.tpl-gates', title: tr('Gate-veckor'), text: tr('Skriv veckorna som ÅÅVV. Lämna tomt för gater som inte gäller. En egen mall har en vecka: ankaret.') },
      { sel: '#tplPrev', title: tr('Förhandsvisning'), text: tr('Antal aktiviteter per fas. Inget skapas förrän du klickar på knappen.') },
    ] },
    { id: 'program', kind: 'page', view: 'program', title: tr('Programvyn'), steps: [
      { sel: '#pgAlert', title: tr('Påverkade beroenden'), text: tr('Har en uppdatering gjort ett beroende till risk eller blockerat visas en banner här. Visa beroendena, se dem i Gantt eller klicka Markera som sett.'), skip: () => !$('#pgAlert') || $('#pgAlert').hidden },
      { sel: '#pgGrid', title: tr('Projekten'), text: tr('Fas, andel klart, försenade och nästa gate per projekt.') },
      { sel: '.pg-sum', title: tr('Huvudprojekt'), text: tr('Planer med samma nivå 1 samlas under huvudprojektet: antal delprojekt, sämsta hälsa och nästa gemensamma gate. Delprojekt utan egna gater visar huvudplanens (ärvd).'), skip: () => !$('.pg-sum') },
      { sel: '#pgSeg', title: tr('Översikt och Gantt'), text: tr('Gantt visar alla projekt med sina faser. Ett huvudprojekt fälls ut till delprojekt, faser och aktiviteter.') },
      { sel: '#pgDeps', title: tr('Beroenden'), text: tr('Beroenden mellan projekten med status: OK, risk eller blockerad.') },
      { sel: '#pgSeg [data-pg="gates"]', title: tr('Gater'), text: tr('<b>Gater</b> jämför projektens gater med programgaterna – se <b>Programgater och gate-översikt</b>.') },
    ] },
    { id: 'new-depalerts', kind: 'new', since: '2026-11-02', title: tr('Påverkar andra projekt'), steps: [
      { sel: '#updBtn', title: tr('Nytt: påverkan på andra projekt'), text: tr('Ingår planen i ett program visar förhandsvisningen vid Uppdatera vilka beroenden till andra projekt som blir risk eller blockerade – med marginalen före och efter i dagar och veckor. Uppdateringen stoppas inte.'), skip: () => !$('#updWrap') || $('#updWrap').hidden },
      { sel: '#pgAlert', title: tr('Varning i programmet'), text: tr('Programmets översikt visar hur många beroenden som påverkats sedan senaste uppdateringen, med länk till listan.'), skip: () => !$('#pgAlert') || $('#pgAlert').hidden },
      { sel: '#planSelect', title: tr('Varning i programmet'), text: tr('Öppna programmet: översikten visar en banner med antalet påverkade beroenden, och i Gantt märks pilarna och aktiviteterna ändrad tills någon klickar Markera som sett.'), skip: () => !!$('#pgAlert') && !$('#pgAlert').hidden },
    ] },
    { id: 'new-templates', kind: 'new', since: '2026-11-02', title: tr('Skapa mall'), steps: [
      { sel: '#planMenuBtn', title: tr('Nytt: Spara som mall'), text: tr('⋯ → 📐 Spara som mall… gör en mall av den öppna planen: välj faser och aktiviteter, ankare (start eller gate), namn och beskrivning.') },
      { sel: '#planMenuBtn', title: tr('Mina mallar'), text: tr('⋯ → Ny plan från mall… visar Inbyggda mallar och Mina mallar. Faser, veckor, beroenden och checklistor följer med.') },
      { sel: '#planMenuBtn', title: tr('Mallar som fil'), text: tr('Exportera en mall (⬇) och importera den på en annan dator med ⇪ Importera mall från fil….') },
    ] },
    { id: 'new-agile', kind: 'new', since: '2026-11-02', view: 'template', title: tr('Agila mallar'), steps: [
      { sel: '#tplSrc', title: tr('Nytt: agila mallar'), text: tr('Under Agilt finns Scrum, PI-planering (SAFe-inspirerad) och hybrid PMI + sprintar.') },
      { sel: '#tplSrc', title: tr('Antal och längd'), text: tr('Välj en agil mall: fälten för antal sprintar eller PI, veckor och release var X:e visas till höger. Skriv startveckan, eller gate-veckorna för hybriden.') },
      { sel: '#tplPrev', title: tr('Förhandsvisning'), text: tr('Sprintar och PI blir egna faser med sina händelser. Hybridens sprintar läggs i Development och Final Development.') },
    ] },
    { id: 'new-colors', kind: 'new', since: '2026-11-02', view: 'gantt', title: tr('Färger'), steps: [
      { sel: '#planSelect', title: tr('Nytt: färger'), text: tr('Öppna en plan för att välja färger på faserna.'), skip: () => hasPlanTasks() },
      { sel: '.g-row.grp.strong', title: tr('Nytt: färg per fas'), text: tr('Håll musen över fasraden och klicka på 🎨 för att välja fasens färg – förvald eller egen.') },
      { sel: '#planMenuBtn', title: tr('Paletter'), text: tr('⋯ → 🎨 Färger… väljer palett för hela planen (PMI, Standard, Mjuk, Hög kontrast) och färg för alla faser.') },
    ] },
    { id: 'load', kind: 'page', view: 'load', title: tr('Belastning'), steps: [
      { sel: '#ldTbl', title: tr('Personer × veckor'), text: tr('Timmar per person och vecka och andel av kapaciteten: grön ≤ 80 %, gul 80–100 %, röd över 100 %. Klicka på en ruta för aktiviteterna bakom.'), skip: () => !$('#ldTbl') },
      { sel: '#ldBasisSeg', title: tr('Kvar eller planerat'), text: tr('Kvar = återstående insats från idag. Planerat = hela insatsen över aktivitetens period.') },
      { sel: '#ldPerson', title: tr('Filtrera på person'), text: tr('Visa en person i taget – eller klicka på namnet i tabellen.') },
      { sel: '#ldCap', title: tr('Kapacitet'), text: tr('Timmar per vecka som standard och per person, och om svenska helgdagar är lediga.') },
    ] },
    { id: 'gates', kind: 'page', view: 'gates', title: tr('Programgater och gate-översikt'), steps: [
      { sel: '#gxTbl', title: tr('Projekt × gater'), text: tr('En rad per projekt, grupperat under huvudprojektet, och en kolumn per gate-kod. Rutan visar planens vecka, avvikelsen mot programgaten och status. Streckad ram = ärvd från huvudplanen.'), skip: () => !$('#gxTbl') },
      { sel: '.gx-legend', title: tr('Färgerna'), text: tr('Röd: minst en vecka efter programgaten eller Ur fas. Orange: senare inom veckan, I riskzonen eller passerad. Grön: i tid eller klar. Grå: saknas.') },
      { sel: '#gxOnlyDevLbl', title: tr('Bara avvikelser'), text: tr('Bara de projekt som har en röd eller orange gate.') },
      { sel: '#gxGates, #gxEdit', title: tr('Programgater'), text: tr('Lägg till och ändra programgaterna här eller via ⋯ → 🚩 Programgater….') },
      { sel: '#gxExport', title: tr('Exportera'), text: tr('Tabellen som Excel, med veckor som tal.') },
    ] },
    // Toppraden (#101): planens verktyg till höger, sedan ? · språk · tema; import i planväljaren, ingen How to-flik
    { id: 'new-topbar', kind: 'new', since: '2026-11-01', title: tr('Ny topprad'), steps: [
      { sel: '#planSelect', title: tr('Nytt: + Ny plan / Importera…'), text: tr('Ny plan och import finns sist i planväljaren: + Ny plan / Importera…. Samma val finns under ⋯ → Ny.') },
      { sel: '#fuWrap:not([hidden]), #updWrap:not([hidden]), #exportBtn', title: tr('Planens verktyg'), text: tr('Till höger ligger det som gäller den öppna planen: 📊 Uppföljning, ⟳ Uppdatera, Exportera bild och ↶ Ångra.') },
      { sel: '#helpBtn', title: tr('Hjälp i ?-menyn'), text: tr('? har rundturerna, 📖 Hjälpcenter och hjälp för sidan du står på.') },
      { sel: '#langBtn', title: tr('Språk'), text: tr('Språkknappen visar språket du använder. Klicka och välj Svenska eller English.') },
    ] },
    { id: 'new-followup', kind: 'new', since: '2026-11-01', title: tr('Uppföljning och ⋯-menyn'), steps: [
      { sel: '#planSelect', title: tr('Nytt: 📊 Uppföljning'), text: tr('Öppna en plan för att se knappen 📊 Uppföljning.'), skip: () => !$('#fuWrap').hidden },
      { sel: '#fuBtn', title: tr('Nytt: 📊 Uppföljning'), text: tr('Gate-checklista, risklista, veckostatus, milstolpetrend och burndown nås nu med ett klick här, i stället för via ⋯.'), skip: () => $('#fuWrap').hidden },
      { sel: '#fuMenu', title: tr('Fem verktyg'), text: tr('☑ Gate-checklista, ⚠ Risklista, 🚦 Veckostatus, 📈 Milstolpetrend och 📉 Burndown. I programvyn finns Burndown för alla planer.'),
        before: () => { if ($('#fuMenu').hidden) toggleMenu('#fuMenu'); }, after: () => closeMenu('#fuMenu'), skip: () => $('#fuWrap').hidden },
      { sel: '#planMenuBtn', title: tr('⋯ under rubriker'), text: tr('Menyn ⋯ är ordnad under rubriker: Ny, Den här planen, Dela och exportera, Program och Historik. Ta bort plan ligger sist.') },
    ] },
    { id: 'new-burndown', kind: 'new', since: '2026-10-31', title: tr('Burndown'), steps: [
      { sel: '#planSelect', title: tr('Nytt: burndown'), text: tr('Öppna en plan för att se burndown – till exempel en plan från den agila Scrum-mallen.'), skip: () => hasPlanTasks() },
      { sel: '.g-row.grp.strong', title: tr('Nytt: 📉 på fasraden'), text: tr('Håll musen över en fas- eller sprintrad och klicka på 📉 för fasens burndown.'), before: () => { if (ui.view !== 'gantt') showView('gantt'); }, skip: () => !hasPlanTasks() || ui.mode === 'program' },
      { sel: '#fuBtn', title: tr('Nytt: 📊 Uppföljning → 📉 Burndown…'), text: tr('Kvarvarande arbete mot idealkurvan för planen, en fas eller en sprint – i timmar, checklistpunkter eller aktivitetspoäng. Velocity per sprint och export som bild. I programvyn för alla planer.') },
    ] },
    { id: 'new-pickplans', kind: 'new', since: '2026-11-05', title: tr('Lägg till planer från en lista'), steps: [
      { sel: '#planSelect', title: tr('Nytt: planer från en lista'), text: tr('Öppna ett program i listan. ＋ Lägg till plan visar nu dina planer – kryssa i dem.'), skip: () => ui.mode === 'program' },
      { sel: '.pg-card.add', title: tr('Nytt: planer från en lista'), text: tr('＋ Lägg till plan visar planerna du har tillgång till. Kryssa i en eller flera. En plan som någon annan delat lägger du till med länken eller koden under listan.'), skip: () => !$('.pg-card.add') },
    ] },
    { id: 'new-gateslip', kind: 'new', since: '2026-11-04', title: tr('Varning när en gate glider förbi'), steps: [
      { sel: '#pgAlert:not([hidden]), #planSelect', title: tr('Nytt: gate som glider förbi'), text: tr('När ett projekt uppdateras och en gate hamnar minst en vecka efter programgaten visar programmet en varning här. Markera som sett tar bort den.') },
      { sel: '#pgSeg [data-pg="gates"]', title: tr('Visa i Gater'), text: tr('I Gater får rutan ⚠ och detaljen visar veckan före och efter uppdateringen.'), skip: () => !$('#pgSeg [data-pg="gates"]') || $('#pgSeg').hidden },
    ] },
    { id: 'new-pgates', kind: 'new', since: '2026-10-31', title: tr('Programgater och gate-översikt'), steps: [
      { sel: '#planSelect', title: tr('Nytt: programgater'), text: tr('Öppna ett program i listan för att se programgaterna och gate-översikten.'), skip: () => ui.mode === 'program' },
      { sel: '#pgGates, #planMenuBtn', title: tr('Nytt: programgater'), text: tr('⋯ → 🚩 Programgater… lägger till programmets egna gater: kod, vecka, status och anteckning. De visas som chips i Översikt och som romber överst i Gantt.') },
      { sel: '#pgSeg [data-pg="gates"]', title: tr('Nytt: gate-översikten'), text: tr('Fliken Gater visar alla projektens gater mot programgaterna med avvikelsen i veckor – röd, orange, grön eller grå. Bara avvikelser filtrerar.'), skip: () => ui.mode !== 'program' },
    ] },
    { id: 'new-effort', kind: 'new', since: '2026-10-31', title: tr('Insats och belastning'), steps: [
      { sel: '#planSelect', title: tr('Nytt: insats i timmar'), text: tr('Öppna en plan och klicka på en aktivitet för att ange insatsen i timmar.'), skip: () => hasPlanTasks() },
      { sel: '#effSec', title: tr('Nytt: insats i timmar'), text: tr('Planerat, utfört och kvar i timmar – eller t.ex. 2 d eller 1 v. Kvar räknas ut om det är tomt. Planner Premiums Arbete läses vid import.'),
        before: () => { if (ui.view !== 'gantt') showView('gantt'); const r = $('.g-row.task'); if (r && $('#drawer').hidden) r.click(); }, skip: () => !hasPlanTasks() },
      { sel: '#viewSeg [data-v="load"], #pgSeg [data-pg="load"]', title: tr('Nytt: Belastning'), text: tr('Fliken Belastning visar timmar per person och vecka mot kapaciteten – grön, gul eller röd. I programvyn för alla programmets planer.'), before: () => closeDrawer() },
      { sel: '#planMenuBtn', title: tr('Kapacitet'), text: tr('⋯ → ⏱ Kapacitet… anger timmar per vecka per person och om svenska helgdagar är lediga.') },
    ] },
    { id: 'new-versions', kind: 'new', since: '2026-11-02', title: tr('Versioner och papperskorg'), steps: [
      { sel: '#planMenuBtn', title: tr('Nytt: versioner'), text: tr('⋯ → 🕘 Versioner… visar sparade versioner av planen – före varje uppdatering, import och borttagning, och en per dag. Jämför med nu, återställ eller exportera.') },
      { sel: '#planMenuBtn', title: tr('Återställ går att ångra'), text: tr('Innan en version återställs sparas nuvarande läge som en ny version.') },
      { sel: '#planMenuBtn', title: tr('Nytt: papperskorg'), text: tr('Ta bort plan flyttar planen till papperskorgen i 30 dagar. ⋯ → 🗑 Papperskorg… återställer den.') },
      { sel: '#planSelect', title: tr('Importera inte på nytt'), text: tr('Finns planen redan föreslås Uppdatera. En ny kopia tappar risker, veckostatus, checklistans svar och kopplingar.') },
    ] },
    { id: 'new-deptypes', kind: 'new', since: '2026-11-02', view: 'gantt', title: tr('Beroendetyper och fördröjning'), steps: [
      { sel: '#planSelect', title: tr('Nytt: beroendetyper'), text: tr('Beroenden från Planner Premium läses nu in med typ – AS/FS (slut → start), SS (start → start), AA/FF (slut → slut), SA/SF (start → slut) – och fördröjning, t.ex. SS +2 d. Pilen går från rätt ände och blir röd först när typen bryts.') },
      { sel: '#planSelect', title: tr('Typ och fördröjning i panelen'), text: tr('Klicka på en aktivitet: under Beroenden visas typ och fördröjning för varje föregångare. Egna beroenden kan ändras (arbetsdagar, negativt = överlapp); de från Planner skrivs över vid uppdatering.') },
      { sel: '#critLbl', title: tr('Kritisk linje'), text: tr('Den kritiska linjen och marginalen till nästa gate räknar med typ och fördröjning. Ändrade typer syns i förhandsvisningen när planen uppdateras från Excel.'), skip: () => !hasPlanTasks() || $('#critLbl').hidden },
    ] },
    { id: 'new-baselines', kind: 'new', since: '2026-11-04', view: 'gantt', title: tr('Baslinjer'), steps: [
      { sel: '#planMenuBtn', title: tr('Nytt: baslinjer'), text: tr('⋯ → 📏 Baslinjer… sparar hur planen ser ut nu, så att du senare ser vad som har flyttats. Upp till 11 per plan, t.ex. en vid varje gate.') },
      { sel: '#blSel', title: tr('Jämför med baslinjen'), text: tr('Välj baslinje här. Grå staplar visar baslinjen och avvikelsen står efter namnet; bredvid står hur många som är senare och tidigare.'), skip: () => $('#blSel').hidden },
    ] },
    { id: 'new-critical', kind: 'new', since: '2026-11-01', view: 'gantt', title: tr('Kritisk linje och marginal'), steps: [
      { sel: '#planSelect', title: tr('Nytt: kritisk linje'), text: tr('Öppna en plan med beroenden för att se vilka aktiviteter som styr slutdatumet och hur mycket marginal det finns till nästa gate.'), skip: () => hasPlanTasks() },
      { sel: '#critLbl', title: tr('Nytt: kritisk linje'), text: tr('Kryssa i Kritisk linje. Röd ram = kritisk (ingen slack), streckad orange = mindre än en veckas marginal; övriga tonas ned. Inga datum ändras.'),
        before: () => { if (hasPlanTasks() && !ui.crit) { ui.crit = true; render(); } }, skip: () => !hasPlanTasks() || $('#critLbl').hidden },
      { sel: '#critTarget', title: tr('Välj mål'), text: tr('Räkna mot planens slut eller mot en gate. Slacken visas i tooltipen och i panelen, i arbetsdagar enligt planens kalender.'), skip: () => $('#critTarget').hidden },
      { sel: '#critWarn', title: tr('Hur säker är linjen?'), text: tr('Raden visar antal kritiska och hur stor del av aktiviteterna som har beroenden. Under 30 % kan den kritiska linjen vara ofullständig.'), skip: () => $('#critWarn').hidden },
      { sel: '#kpiCrit', title: tr('Marginal till nästa gate'), text: tr('⏳ visar marginalen till nästa gate. Klicka för att visa den kritiska linjen mot gaten – kedjan som styr står i tooltipen.'), skip: () => !$('#kpiCrit') },
    ] },
    { id: 'new-late', kind: 'new', since: '2026-10-31', title: tr('Nytt: bara försenade'), steps: [
      { sel: '#kpiLate', title: tr('Nytt: bara försenade'), text: tr('Klicka på nyckeltalet för att bara visa försenade aktiviteter. Klicka igen för att visa alla.'), skip: () => !$('#kpiLate') },
      { sel: '#planSelect', title: tr('Nytt: skriv in % klart'), text: tr('I panelen kan du nu skriva in hur klar en aktivitet är som en siffra, eller dra i reglaget som förut.') },
    ] },
    { id: 'new-checks', kind: 'new', since: '2026-10-30', title: tr('Checklista på aktiviteter'), steps: [
      { sel: '#planSelect', title: tr('Nytt: checklista'), text: tr('Öppna en plan och klicka på en aktivitet för att se och bocka av dess checklista.'), skip: () => hasPlanTasks() },
      { sel: '#chkSec', title: tr('Nytt: checklista'), text: tr('Planners checklista visas i panelen. Bocka av, lägg till egna punkter och spara – bockarna finns kvar när planen uppdateras från Planner.'),
        before: () => { if (ui.view !== 'gantt') showView('gantt'); const r = $('.g-row.task.has-checks') || $('.g-row.task'); if (r && $('#drawer').hidden) r.click(); }, skip: () => !hasPlanTasks() },
      { sel: '#chkNew', title: tr('Egna punkter'), text: tr('Skriv en ny punkt och tryck Enter. Klicka på en text för att ändra den.'), skip: () => !hasPlanTasks() },
      { sel: '#gBodySvg', title: tr('☑ i Gantt-vyn'), text: tr('Aktiviteter med checklista får ☑ 2/3. Grön = alla punkter klara men aktiviteten inte markerad klar.'),
        before: () => closeDrawer(), skip: () => !hasPlanTasks() },
      { sel: '#updWrap', title: tr('Få punkterna från Planner'), text: tr('Planer som importerats tidigare får punkterna med ⟳ Uppdatera → Uppdatera från Excel… en gång.'), skip: () => !hasPlanTasks() || $('#updWrap').hidden },
    ] },
    { id: 'new-local', kind: 'new', since: '2026-10-29', title: tr('Lokal version'), steps: [
      { sel: '#helpBtn', title: tr('Nytt: lokal version'), text: tr('NexusOrdo finns som en fil för din egen dator. Planer flyttas mellan datorer med ⬇ Exportera plan (Excel) och + Ny plan / Importera… i planväljaren. Läs mer i hjälpcentret: Lokal version.') },
      { sel: '#planMenuBtn', title: tr('Öppna och spara'), text: tr('I den lokala versionen finns 📂 Öppna plan…, 💾 Spara och Spara som… här i menyn ⋯.') },
    ] },
    { id: 'new-planexport', kind: 'new', since: '2026-10-29', title: tr('Export och import av planer'), steps: [
      { sel: '#planMenuBtn', title: tr('Nytt: exportera plan (Excel)'), text: tr('⋯ → ⬇ Exportera plan (Excel)… sparar den öppna planen, dina planer eller programmet i en Excel-fil – läsbar i Excel och en egen säkerhetskopia.') },
      { sel: '#planSelect', title: tr('Importera i en annan miljö'), text: tr('+ Ny plan / Importera… i planväljaren känner igen filen och skapar planerna med allt innehåll.') },
    ] },
    { id: 'new-localprog', kind: 'new', since: '2026-11-02', fileOnly: true, title: tr('Program i lokala versionen'), steps: [
      { sel: '#planMenuBtn', title: tr('Nytt: program i lokala versionen'), text: tr('⋯ → Nytt program… skapar ett program. ＋ Lägg till plan i programmet visar dina planer i en lista.') },
      { sel: '#fileBanner:not([hidden]), #planMenuBtn', title: tr('Spara till fil'), text: tr('Med programmet öppet sparar 💾 Spara (Ctrl+S) programmet och alla dess planer i en fil. Den gula raden överst visas så länge något inte är sparat till fil.') },
    ] },
    { id: 'new-help', kind: 'new', since: '2026-10-29', title: tr('Hjälpcenter'), steps: [
      { sel: '#helpBtn', title: tr('Nytt: hjälpcenter'), text: tr('Hjälpcentret öppnas från ? → 📖 Hjälpcenter: välj ämne i menyn till vänster och läs en artikel i taget.') },
      { sel: '#htQ', title: tr('Sök'), text: tr('Skriv ett ord, t.ex. risk eller vecka. Enter öppnar första träffen.'), before: () => showView('howto') },
      { sel: '#htTour, #htMain', title: tr('Visa rundtur'), text: tr('Många artiklar har ▶ Visa rundtur som visar funktionen på riktigt. ? → Hjälp för den här sidan öppnar rätt artikel direkt.') },
    ] },
    { id: 'new-trend', kind: 'new', since: '2026-10-29', title: tr('Milstolpetrend'), steps: [
      { sel: '#kpiNext, #fuBtn', title: tr('Nytt: milstolpetrend'), text: tr('Klicka på nästa milstolpe eller välj 📊 Uppföljning → 📈 Milstolpetrend… för att se hur gaterna har flyttats.') },
      { sel: '#mtaSvg', title: tr('Trenddiagram'), text: tr('Rapportdatum åt höger, prognos uppåt. En stigande linje betyder att milstolpen har skjutits fram.'),
        before: () => { if (!$('#mtaBody') && hasPlanTasks()) openTrend(); }, skip: () => !hasPlanTasks() || !plan.tasks.some(t => t.milestone && t.end) },
      { sel: '#mtaList', title: tr('Förskjutning per milstolpe'), text: tr('Total förskjutning, antal flyttar och senaste flytt. Röd = minst fyra veckor.'), skip: () => !hasPlanTasks() || !plan.tasks.some(t => t.milestone && t.end) },
    ] },
    { id: 'new-goalstatus', kind: 'new', since: '2026-10-29', title: tr('Gatens status från Planner'), steps: [
      { sel: '#ganttView, #viewSeg', title: tr('Nytt: gatens status'), text: tr('Status på gaterna i Planner (Goals) följer med vid import: gul kant = i riskzonen, röd kant = ur fas, fylld romb = klar. Håll musen över gaten för status.') },
      { sel: '#kpiStatus, #fuBtn', title: tr('Förslag i veckostatus'), text: tr('Gater ur fas ger förslaget röd tidplan i veckostatus, gater i riskzonen gul.') },
    ] },
    { id: 'new-actual', kind: 'new', since: '2026-10-29', title: tr('Gate passerad – utfall'), steps: [
      { sel: '#updBtn, #planMenuBtn', title: tr('Nytt: utfall föreslås'), text: tr('När en gate blivit klar i Planner föreslår uppdateringen en utfallsvecka – kontrollera veckan och kryssa i.') },
      { sel: '#kpiChk, #fuBtn', title: tr('Markera gate passerad'), text: tr('I gate-checklistan: Markera gate passerad… sparar veckan. Utfallet visas som fylld romb i Gantt.') },
    ] },
    { id: 'new-status', kind: 'new', since: '2026-10-29', title: tr('Veckostatus'), steps: [
      { sel: '#kpiStatus, #fuBtn', title: tr('Nytt: veckostatus'), text: tr('Klicka på 🚦 eller välj 📊 Uppföljning → 🚦 Veckostatus… för veckans status.') },
      { sel: '#stDims', title: tr('Dimensioner och förslag'), text: tr('Grön, gul eller röd per dimension. Förslagen kommer från milstolpetrenden, risklistan och gate-checklistan – klicka Använd om du håller med.'),
        before: () => { if (!$('#stBody') && hasPlanTasks()) openStatus(); }, skip: () => !hasPlanTasks() },
      { sel: '#stHist', title: tr('Historik'), text: tr('De senaste tolv veckorna per dimension. Klicka på en vecka för att se eller ändra den.'), skip: () => !hasPlanTasks() },
    ] },
    { id: 'new-risks', kind: 'new', since: '2026-10-29', title: tr('Risklista'), steps: [
      { sel: '#fuBtn', title: tr('Nytt: risklista'), text: tr('📊 Uppföljning → ⚠ Risklista… bygger på en vanlig riskanalys: sannolikhet × konsekvens, åtgärder och ansvarig.') },
      { sel: '#kpiRisk', title: tr('Risker i nyckeltalen'), text: tr('⚠ visar öppna risker, höga risker och försenade åtgärder. Klicka för att öppna listan.'), skip: () => !$('#kpiRisk') },
      { sel: '#rkTable', title: tr('Värde och status'), text: tr('Värdet är sannolikhet × konsekvens. Status (grön, gul, röd) sätter du själv.'),
        before: () => { if (!$('#rkBody')) openRisks(); }, skip: () => !hasPlanTasks() },
      { sel: '#rkMatrix', title: tr('Riskmatris och topp 5'), text: tr('Klicka på en ruta i matrisen för att filtrera. Topp 5 går till statusrapporten.'), skip: () => !hasPlanTasks() },
    ] },
    { id: 'new-docs', kind: 'new', since: '2026-10-28', title: tr('Dokument på aktiviteter'), steps: [
      { sel: '#planSelect', title: tr('Nytt: dokument'), text: tr('Öppna en plan och klicka på en aktivitet för att länka dokument från SharePoint.'), skip: () => hasPlanTasks() },
      { sel: '#docSec', title: tr('Nytt: dokument'), text: tr('Under Dokument i panelen länkar du till dokument på SharePoint. Bara länken sparas.'),
        before: () => { if (ui.view !== 'gantt') showView('gantt'); const r = $('.g-row.task'); if (r && $('#drawer').hidden) r.click(); }, skip: () => !hasPlanTasks() },
      { sel: '#docAdd', title: tr('Lägg till'), text: tr('Klistra in länken (Kopiera länk i SharePoint), ge den en titel och spara aktiviteten.'), skip: () => !hasPlanTasks() },
      { sel: '#gBodySvg', title: tr('📎 i Gantt-vyn'), text: tr('Aktiviteter med dokument får 📎 med antal. Länkarna finns kvar när planen uppdateras från Planner.'),
        before: () => closeDrawer(), skip: () => !hasPlanTasks() },
    ] },
    { id: 'new-weeks', kind: 'new', since: '2026-10-27', title: tr('Veckor ÅÅVV'), steps: [
      { sel: '#viewSeg', title: tr('Nytt: veckor'), text: tr('Datum visas och kan skrivas som vecka, t.ex. 2645 = vecka 45 2026.') },
      { sel: '#kpis', title: tr('Nästa milstolpe'), text: tr('Nyckeltalet visar veckan för nästa milstolpe.'), skip: () => !hasPlanTasks() || ui.view !== 'gantt' && ui.view !== 'roadmap' },
    ] },
  ];
}
// Sidan som visas just nu (för "Rundtur för den här sidan")
function currentPage() {
  if (!$('#modal').hidden) return $('.ck-tabs') ? 'checklist' : $('.tpl-gates') ? 'template' : null;
  if (ui.view === 'howto') return null;
  if (!$('#loadView').hidden) return 'load';
  if (!$('#gatesView').hidden) return 'gates';
  if (ui.mode === 'program' && program && ui.pgView !== 'gantt') return 'program';
  return hasPlanTasks() && ui.view === 'gantt' ? 'gantt' : null;
}

let tourState = null;
const visibleEl = sel => $$(sel.split(',').map(s => s.trim()).join(',')).find(e => e.getClientRects().length && !e.closest('[hidden]'));
function startTour(id, at = 0) {
  const t = shownTours().find(x => x.id === id);
  if (!t) return;
  endTour();
  closeMenu('#helpMenu'); hideChip('start');
  tourOffered.add(id);
  const wrap = document.createElement('div');
  wrap.className = 'tour';
  wrap.innerHTML = '<div class="tour-block"></div><div class="tour-hl"></div><div class="tour-pop" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(wrap);
  tourState = { t, i: -1, wrap, onKey: null, onMove: null };
  tourState.onKey = e => {
    if (!tourState) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endTour(true); }
    else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('input,textarea'))) { e.preventDefault(); e.stopImmediatePropagation(); tourGo(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); tourGo(-1); }
  };
  tourState.onMove = () => tourPlace();
  addEventListener('keydown', tourState.onKey, true);
  addEventListener('resize', tourState.onMove);
  addEventListener('scroll', tourState.onMove, true);
  tourState.i = at - 1;
  tourGo(1);
}
async function tourGo(dir) {
  const s = tourState; if (!s) return;
  const cur = s.t.steps[s.i];
  if (cur && cur.after) { try { cur.after(); } catch { /* inget */ } }
  let i = s.i + dir;
  while (i >= 0 && i < s.t.steps.length && s.t.steps[i].skip && s.t.steps[i].skip()) i += dir;
  if (i >= s.t.steps.length) return endTour(true);
  if (i < 0) { i = s.i; if (i < 0) return; }
  s.i = i;
  const st = s.t.steps[i];
  if (st.before) { try { await st.before(); } catch { /* inget */ } await new Promise(r => setTimeout(r, 220)); }
  if (!tourState) return;
  const el = visibleEl(st.sel);
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const steps = s.t.steps.map((x, k) => ({ k, skip: x.skip && x.skip() })).filter(x => !x.skip);
  const pos = steps.findIndex(x => x.k === i), last = !s.t.steps.slice(i + 1).some(x => !(x.skip && x.skip()));
  $('.tour-pop', s.wrap).innerHTML = `<div class="tour-k">${esc(s.t.title)} · ${pos + 1}/${steps.length}</div><h4>${esc(st.title)}</h4><p>${esc(st.text)}</p>
    <div class="tour-foot"><span class="tour-dots">${steps.map((x, k) => `<i class="${k === pos ? 'on' : ''}"></i>`).join('')}</span>
      <button class="btn ghost small" data-t="skip">${tr('Hoppa över')}</button>
      ${pos > 0 ? `<button class="btn ghost small" data-t="prev">${tr('Tillbaka')}</button>` : ''}
      <button class="btn small" data-t="next">${last ? tr('Klar') : tr('Nästa')}</button></div>`;
  $$('[data-t]', s.wrap).forEach(b => b.onclick = e => { e.stopPropagation(); b.dataset.t === 'skip' ? endTour(true) : tourGo(b.dataset.t === 'next' ? 1 : -1); });
  tourPlace();
  $('[data-t="next"]', s.wrap).focus({ preventScroll: true });
}
function tourPlace() {
  const s = tourState; if (!s) return;
  const st = s.t.steps[s.i], el = st && visibleEl(st.sel);
  const hl = $('.tour-hl', s.wrap), pop = $('.tour-pop', s.wrap);
  const W = innerWidth, H = innerHeight, pw = Math.min(340, W - 24);
  pop.style.width = pw + 'px';
  if (!el) { hl.style.display = 'none'; s.wrap.classList.add('dim'); pop.style.left = (W - pw) / 2 + 'px'; pop.style.top = Math.max(12, (H - pop.offsetHeight) / 2) + 'px'; return; }
  s.wrap.classList.remove('dim');
  const r = el.getBoundingClientRect(), pad = 6;
  Object.assign(hl.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: Math.min(r.height, H - 20) + pad * 2 + 'px' });
  const ph = pop.offsetHeight, below = r.bottom + pad + 10 + ph < H;
  pop.style.top = (below ? r.bottom + pad + 10 : Math.max(12, r.top - pad - 10 - ph)) + 'px';
  pop.style.left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), W - pw - 12) + 'px';
}
function endTour(done = false) {
  const s = tourState; if (!s) return;
  const cur = s.t.steps[s.i];
  if (cur && cur.after) { try { cur.after(); } catch { /* inget */ } }
  removeEventListener('keydown', s.onKey, true);
  removeEventListener('resize', s.onMove);
  removeEventListener('scroll', s.onMove, true);
  s.wrap.remove(); // inga dolda lager kvar över vyerna
  tourState = null;
  if (done) markTourSeen(s.t.id);
}

// Små rutor nere i hörnet: "Ny i NexusOrdo?" och "Visa rundtur för …?" – tas bort ur DOM när de stängs
const chips = {};
function showChip(key, html, onYes, ms = 10000) {
  hideChip(key);
  const c = document.createElement('div');
  c.className = 'tour-chip'; c.dataset.chip = key;
  c.innerHTML = `${html} <button class="btn small" data-c="yes"></button><button class="btn ghost small" data-c="no"></button>`;
  document.body.appendChild(c);
  chips[key] = { el: c, timer: ms ? setTimeout(() => hideChip(key), ms) : null };
  return c;
}
function hideChip(key) { const c = chips[key]; if (!c) return; clearTimeout(c.timer); c.el.remove(); delete chips[key]; }
function offerStartTour() {
  if (tourOff || tourSeen.has('intro') || tourSeen.has('intro-skip') || tourState) return;
  const c = showChip('start', `<span>${tr('Ny i NexusOrdo?')}</span>`, null, 25000);
  $('[data-c="yes"]', c).textContent = tr('Ta rundturen (1 min)');
  $('[data-c="no"]', c).textContent = tr('Hoppa över');
  $('[data-c="yes"]', c).onclick = () => startTour('intro');
  $('[data-c="no"]', c).onclick = () => { hideChip('start'); markTourSeen('intro-skip'); };
}
function offerPageTour(page) {
  page = page || currentPage();
  if (tourOff || !page || tourState || tourOffered.has(page) || tourSeen.has(page) || tourSeen.has(page + '-skip') || chips.start) return;
  const t = shownTours().find(x => x.id === page); if (!t) return;
  tourOffered.add(page);
  const c = showChip('page', `<span>${tr('Visa rundtur för {page}?', { page: t.title })}</span>`);
  $('[data-c="yes"]', c).textContent = tr('Visa');
  $('[data-c="no"]', c).textContent = tr('Nej tack');
  $('[data-c="yes"]', c).onclick = () => { hideChip('page'); startTour(page); };
  $('[data-c="no"]', c).onclick = () => { hideChip('page'); markTourSeen(page + '-skip'); };
}
const offerPageTourSoon = page => setTimeout(() => offerPageTour(page), 500);

// ?-knappen: rundturer, Nytt och hjälpcentret (med snabblänk till sidans artikel) (#101)
/* UPDATE:START */
const RELEASES_URL = 'https://github.com/Flaxx83/nexusordo/releases/latest';
function releaseParts(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''));
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function compareRelease(a, b) {
  const x = releaseParts(a), y = releaseParts(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
async function latestRelease() {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://api.github.com/repos/Flaxx83/nexusordo/releases/latest', {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error('Release lookup failed');
    const data = await response.json();
    if (data.draft || data.prerelease || !releaseParts(data.tag_name)) throw new Error('Invalid release');
    return data.tag_name;
  } finally { clearTimeout(timer); }
}
let updateChecking = false;
async function checkForUpdates(manual = false) {
  if (updateChecking) return;
  updateChecking = true;
  let message, available = false;
  try {
    const latest = await latestRelease(), current = globalThis.TP_LOCAL?.release;
    const cmp = compareRelease(latest, current);
    available = cmp === 1;
    message = available ? tr('En ny version finns: {v}', { v: latest })
      : cmp === 0 ? tr('Du har den senaste versionen ({v}).', { v: current })
      : cmp === -1 ? tr('Det här bygget är nyare än senaste releasen ({v}).', { v: latest })
      : tr('Utvecklingsversion – senaste release är {v}.', { v: latest });
  } catch {
    message = tr('Kunde inte kontrollera versionen. Kontrollera internetanslutningen eller öppna releaserna på GitHub.');
  } finally { updateChecking = false; }
  if (manual) {
    await dialog({ title: tr('Sök efter uppdateringar'),
      body: `<p>${esc(message)}</p><p><a href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer">${tr('Hämta senaste versionen')}</a></p><p>${tr('Spara dina planer till Excel innan du byter HTML-fil.')}</p>`,
      buttons: [{ label: tr('Stäng'), value: true }] });
  } else if (available) {
    let notice = $('#updateNotice');
    if (!notice) {
      notice = document.createElement('div'); notice.id = 'updateNotice'; notice.className = 'update-notice';
      notice.setAttribute('role', 'status'); $('.topbar').after(notice);
    }
    notice.innerHTML = `${esc(message)} · <a href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer">${tr('Hämta senaste versionen')}</a>`;
  }
}
/* UPDATE:END */
function renderHelpMenu() {
  const today = fromDay(todayDay()), all = shownTours(), fresh = new Set(newTours(all, today).map(t => t.id)), page = currentPage();
  $('#helpBtn').classList.toggle('has-new', fresh.size > 0);
  const pt = page && all.find(t => t.id === page), hp = helpPageArticle();
  // Hjälpcentret och sidans artikel överst (#101) – Nytt-listan är lång och menyn rullar (max-height i CSS)
  $('#helpMenu').innerHTML = `<button data-update>↻ ${tr('Sök efter uppdateringar')}</button><hr><button data-help="">📖 ${tr('Hjälpcenter')}</button>
    ${hp ? `<button data-help="${hp.id}">📖 ${tr('Hjälp för den här sidan')} <small>${esc(hp.title)}</small></button>` : ''}
    <hr><button data-tour="intro">▶ ${tr('Kom igång')}</button>
    ${pt ? `<button data-tour="${pt.id}">▶ ${tr('Rundtur för den här sidan')} <small>${esc(pt.title)}</small></button>` : ''}
    <hr><div class="menu-h">${tr('Nytt')}</div>
    ${all.filter(t => t.kind === 'new').map(t => `<button data-tour="${t.id}">${fresh.has(t.id) ? '<i class="new-dot"></i>' : ''}${esc(t.title)} <small>${fmtDayY(toDay(t.since))}</small></button>`).join('')}`;
  $$('#helpMenu [data-tour]').forEach(b => b.onclick = e => { e.stopPropagation(); startTour(b.dataset.tour); });
  $$('#helpMenu [data-help]').forEach(b => b.onclick = () => { closeMenu('#helpMenu'); openHelp(b.dataset.help); });
  $('#helpMenu [data-update]').onclick = () => { closeMenu('#helpMenu'); void checkForUpdates(true); };
  $$('#helpMenu button').forEach(b => b.setAttribute('role', 'menuitem'));
}
// &tour=1 (Kom igång) eller &tour=<id> i länken startar en rundtur direkt
function tourFromUrl() {
  const urls = [location.href];
  try { urls.push(window.top.location.href); } catch { /* annan ram */ }
  if (document.referrer) urls.push(document.referrer);
  for (const u of urls) { const m = String(u).match(/[?#&]tour=([A-Za-z-]+|[01])/); if (m) return m[1] === '1' ? 'intro' : m[1]; }
  return null;
}
let tourOff = false; // &tour=0: inga erbjudanden (t.ex. när How to-bilderna tas)
function initOnboarding() {
  renderHelpMenu();
  const t = tourFromUrl();
  if (t === '0') { tourOff = true; return; }
  if (ui.view === 'howto') return; // &help=<id>: inga erbjudanden ovanpå artikeln
  if (t && shownTours().some(x => x.id === t)) setTimeout(() => startTour(t), 400);
  else setTimeout(offerStartTour, 800);
}

/* =========================================================
   Wiring
   ========================================================= */
function applyTheme() {
  const dark = ui.theme ? ui.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/* ---------- Menyerna i toppmenyn (#100, #101): ⋯, 📊 Uppföljning, ⟳ Uppdatera, ? och språk ----------
   Samma beteende för alla: klick på knappen öppnar/stänger, klick utanför stänger, Esc stänger och lämnar fokus på knappen,
   ↓/↑ (och Home/End) flyttar mellan synliga rader, Tab ut ur menyn stänger den. */
const MENUS = [['#planMenuBtn', '#planMenu', '.plan-picker'], ['#fuBtn', '#fuMenu', '.fu-picker'], ['#updBtn', '#updMenu', '.upd-picker'], ['#helpBtn', '#helpMenu', '.help-picker'], ['#langBtn', '#langMenu', '.lang-picker']];
const menuBtn = m => (MENUS.find(x => x[1] === m) || [])[0];
function closeMenu(m) {
  const el = $(m); if (!el || el.hidden) return;
  el.hidden = true;
  const b = $(menuBtn(m)); if (b) b.setAttribute('aria-expanded', 'false');
}
function closeMenus(except) { for (const [, m] of MENUS) if (m !== except) closeMenu(m); }
function toggleMenu(m) {
  const el = $(m), open = el.hidden;
  closeMenus(open ? m : null);
  if (!open) return closeMenu(m);
  syncMenuGroups(el);
  el.hidden = false;
  const b = $(menuBtn(m)); if (b) b.setAttribute('aria-expanded', 'true');
}
// Rubrik + avdelare döljs när ingen rad i gruppen syns i läget (lokal fil, bas, programvy, behörighet); första synliga gruppen har ingen avdelare
function syncMenuGroups(menu) {
  let first = true;
  for (const g of $$('.menu-grp', menu)) {
    const vis = $$('button', g).some(b => !b.hidden && getComputedStyle(b).display !== 'none');
    g.hidden = !vis;
    const hr = $('hr', g); if (hr) hr.hidden = vis && first;
    if (vis) first = false;
  }
}
const menuItems = el => $$('button, [tabindex]', el).filter(b => !b.disabled && b.getClientRects().length && !b.closest('[hidden]'));
function wireMenuKeys() {
  addEventListener('keydown', e => {
    if (tourState) return;
    const open = MENUS.find(([, m]) => !$(m).hidden);
    const onBtn = MENUS.find(([b]) => e.target === $(b));
    if (!open) {
      // ↓ på en stängd menyknapp öppnar menyn och går till första raden
      if (onBtn && e.key === 'ArrowDown') { e.preventDefault(); $(onBtn[0]).click(); const it = menuItems($(onBtn[1])); if (it[0]) it[0].focus(); }
      return;
    }
    const [btn, m] = open, el = $(m), items = menuItems(el), i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(m); $(btn).focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      items[i < 0 ? (d > 0 ? 0 : items.length - 1) : (i + d + items.length) % items.length].focus();
    } else if ((e.key === 'Home' || e.key === 'End') && i >= 0) { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); }
    // En rad som är en <label for> (⋯ → ⇪ Importera från Excel…) öppnar filväljaren med Enter/mellanslag, som en knapp
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0 && items[i].tagName === 'LABEL') { e.preventDefault(); items[i].click(); }
    else if (e.key === 'Tab') setTimeout(() => { if (!el.contains(document.activeElement) && document.activeElement !== $(btn)) closeMenu(m); });
  }, true);
}

function wire() {
  $('#planSelect').onchange = e => {
    const v = e.target.value;
    if (v === NEW_OPT) { renderPlanSelect(); return openNewPlan(); } // + Ny plan / Importera… (#101): väljaren visar planen igen
    return v.startsWith('prog:') ? selectProgram(v.slice(5)) : selectPlan(v, true);
  };
  $('#planMenuBtn').onclick = e => { e.stopPropagation(); toggleMenu('#planMenu'); };
  $('#fuBtn').onclick = e => { e.stopPropagation(); toggleMenu('#fuMenu'); };
  $('#updBtn').onclick = e => { e.stopPropagation(); toggleMenu('#updMenu'); };
  $('#updateInput').onchange = e => { closeMenus(); updateFromFile(e.target.files[0]); e.target.value = ''; };
  document.addEventListener('click', e => { for (const [, m, pick] of MENUS) if (!e.target.closest(pick)) closeMenu(m); });
  $$('#planMenu button, #fuMenu button').forEach(b => b.onclick = () => planAction(b.dataset.act));
  // ⋯ → ⇪ Importera från Excel… är en <label for="fileInput"> (filväljaren i sandlådan); menyn stängs efter klicket
  $('#planMenu [data-act="import"]').addEventListener('click', () => setTimeout(closeMenus));
  wireMenuKeys();
  $('#gchkFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; $('#modal').hidden = true; $('#modal').innerHTML = ''; importGateChecklist(f); };
  $$('#viewSeg button').forEach(b => b.onclick = () => { ui.view = b.dataset.v; saveUi(); render(true); offerPageTourSoon(); });
  $('#helpBtn').onclick = e => { e.stopPropagation(); if ($('#helpMenu').hidden) renderHelpMenu(); toggleMenu('#helpMenu'); };
  $$('#pgSeg button').forEach(b => b.onclick = () => { ui.pgView = b.dataset.pg; if (ui.view === 'load' && b.dataset.pg !== 'load') ui.view = 'gantt'; saveUi(); render(true); offerPageTourSoon(); });
  $('#showHours').onchange = e => { ui.showHours = e.target.checked; saveUi(); render(); };
  $$('#zoomSeg button').forEach(b => b.onclick = () => { ui.zoom = b.dataset.z; saveUi(); render(true); });
  $$('#detailSeg button').forEach(b => b.onclick = () => { ui.detail = b.dataset.d; saveUi(); render(); });
  $('#hideDone').onchange = e => { ui.hideDone = e.target.checked; saveUi(); render(); };
  $('#critOn').onchange = e => { ui.crit = e.target.checked; saveUi(); render(); };
  $('#critTarget').onchange = e => { ui.critTarget = e.target.value; saveUi(); render(); };
  $('#blSel').onchange = e => { setBlSel(e.target.value); render(); };
  $('#onlyChk').onchange = e => { ui.onlyChkDone = e.target.checked; saveUi(); render(); };
  $('#search').oninput = e => { search = e.target.value; render(); };
  $('#todayBtn').onclick = () => { if (ui.view === 'gantt') scrollToToday(); };
  $('#undoBtn').onclick = undo;
  $('#exportBtn').onclick = () => doExport().catch(e => toast(e.message));
  $('#langBtn').onclick = e => { e.stopPropagation(); toggleMenu('#langMenu'); };
  $$('#langMenu [data-lang]').forEach(b => b.onclick = () => { const l = b.dataset.lang; closeMenus(); $('#langBtn').focus(); if (l !== LANG) setLang(l); });
  $('#themeBtn').onclick = () => { ui.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; saveUi(); applyTheme(); render(); };
  $('#emptySample').onclick = () => {
    if (plan && !plan.tasks.length) { plan.tasks = samplePlan(); plan.settings = sampleSettings(); scheduleSave(); render(true); }
    else createPlan(sampleName(), samplePlan(), null, sampleSettings());
  };
  $('#fileInput').onchange = e => { handleFile(e.target.files[0]); e.target.value = ''; };
  $('#fileBannerSave').onclick = () => saveToFile();
  $('#openInput').onchange = e => { openPlanFile(e.target.files[0]); e.target.value = ''; };
  addEventListener('beforeunload', e => { if (FILE_MODE && fileDirty.size) { e.preventDefault(); e.returnValue = ''; } });
  if (FILE_MODE) addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 's') { e.preventDefault(); saveToFile(e.shiftKey); } });
  $('#onlyBlocked').onchange = e => { ui.pgOnlyBlocked = e.target.checked; saveUi(); render(); };
  wirePgGateChips($('#pgGates'));
  $('#pgSeenBtn').onclick = () => markProgramSeen();
  $('#addBtn').onclick = () => {
    if (ui.mode === 'program' && program) return addDependency();
    if (!plan) return;
    const td = todayDay();
    openDrawer({ id: uid(), name: '', bucket: bucketList()[0] || 'Övrigt', start: fromDay(td), end: fromDay(td + 6), progress: 0, deps: [], notes: '' }, true);
  };

  let dragDepth = 0;
  addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('#drop').hidden = true; const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('input,textarea')) { e.preventDefault(); undo(); }
    if (e.key === 'Escape') closeDrawer();
  });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (plan && ui.view === 'roadmap') renderRoadmap(); }, 120); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!ui.theme) { applyTheme(); if (plan) render(); } });

  setupGanttInteraction();
  setupRoadmapInteraction();
}

async function init() {
  if (ui.view === 'howto' || ui.view === 'portfolio') ui.view = 'gantt'; // starta alltid i planen (äldre sparat läge kan ha portfolio)
  const helpId = helpFromUrl(); // &help=<id> öppnar hjälpcentret vid artikeln (#68)
  if (helpId && shownArticles().some(a => a.id === helpId)) { ui.view = 'howto'; ui.helpId = helpId; }
  applyTheme();
  applyStaticI18n();
  Store = makeStore();
  if (FILE_MODE) document.body.classList.add('file-mode');
  wire();
  try {
    ({ live: allPlans, trash: trashPlans } = splitTrash((await Store.list()).map(rowToPlan))); // borttagna ligger i papperskorgen (#76)
    rememberBase('plan', allPlans);
    plans = allPlans;
    await loadPrograms();
  } catch (e) {
    console.error(e);
    allPlans = plans = []; trashPlans = [];
    showBanner(tr('Kunde inte läsa planerna ({msg}).', { msg: e.message }));
  }
  const start = plans.find(p => p.id === ui.planId) || plans[0];
  plan = start || null;
  program = programs.find(p => p.id === ui.programId) || null;
  if (ui.mode === 'program' && !program) ui.mode = 'plan';
  if (FILE_MODE) {
    [...fileDirty].filter(id => !allPlans.some(p => p.id === id)).forEach(id => fileDirty.delete(id)); saveDirty();
    const unsaved = allPlans.filter(p => fileDirty.has(p.id));
    if (unsaved.length) showBanner(tr('Arbetskopian har ändringar som inte sparats till fil: {names}. Spara med ⋯ → 💾 Spara.', { names: unsaved.map(p => p.name).join(', ') }));
  }
  render(true);
  if (FILE_MODE && plan && fileDirty.has(plan.id)) setSaveState(tr('● Ej sparad till fil'));
  initOnboarding();
  if (FILE_MODE) setTimeout(() => { void checkForUpdates(); }, 3000);
}

function showBanner(msg) {
  const b = $('#banner');
  b.querySelector('span').textContent = msg;
  b.hidden = false;
}

// Fel ska alltid synas – annars upplevs det som att ”ingenting händer”
addEventListener('error', e => showBanner(tr('Något gick fel: ') + (e.message || tr('okänt fel'))));
addEventListener('unhandledrejection', e => showBanner(tr('Något gick fel: ') + (e.reason?.message || e.reason || tr('okänt fel'))));

init().catch(e => { console.error(e); showBanner(tr('Kunde inte starta: ') + e.message); render(true); });
