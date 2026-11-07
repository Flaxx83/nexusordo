# NexusOrdo – Gantt & Roadmap

Gantt- och roadmapverktyg för projekttidplaner. Körs helt lokalt som en enda HTML-fil i webbläsaren – ingen server,
ingen installation och ingen nätverksanslutning. Planerna sparas som Excel-filer; webbläsaren håller bara en arbetskopia.

## Funktioner

- **Import från Excel** – Planner-export (buckets och mål), Planner Premium och MS Project-liknande listor. Kolumnnamn känns igen på svenska och engelska.
- **PMI-projektmall** – ⋯ → Ny plan från mall skapar en fas-/gateplan enligt PMI:s processgrupper: Initiating (G1), Planning (G2),
  Executing med övervakning och styrning (G3) och Closing (G4). Gate-veckorna anges som ÅÅVV. Faser som känns igen får PMI-färgerna.
- **Agila mallar** – Scrum, PI-planering (SAFe-inspirerad) och hybrid PMI + sprintar.
- **Egna mallar** – spara en plan som mall och flytta mallar som filer.
- **Gantt, Roadmap och Belastning** med beroenden (FS/SS/FF/SF och fördröjning), kritisk linje, baslinjer och milstolpetrend.
- **Uppföljning** – gate-checklista, risklista, veckostatus, burndown och insats i timmar.
- **Program** – samla flera planer, beroenden mellan projekt, huvudprojekt och delprojekt samt programgater.
- **Versioner och papperskorg**, export till Excel och bild (PNG), svenska och engelska, ljust och mörkt tema.

## Struktur

```
app/        Appen (index.html, style.css, script.js), SheetJS i vendor/, hjälpbilder i howto/, demo-tema i teman/
mallar/     Mallbiblioteket (mallbibliotek.json) – bäddas in i app/script.js
exempel/    Påhittade testplaner i Planners exportformat
scripts/    Bygge, inbäddning av mallar och hjälpbilder
test/       Enhetstester (node --test)
```

## Bygga och köra

Färdiga versioner finns under [Releases](https://github.com/Flaxx83/nexusordo/releases).
Ladda ned ZIP-paketet, packa upp det och öppna `NexusOrdo.html` i Edge eller Chrome.

GitHub Actions kör testerna och bygger appen vid varje push och pull request.
Ett ZIP-paket med appen och licenserna finns som artefakten **NexusOrdo** i respektive lyckad körning.

Kräver Node.js 20 eller senare.

```bash
node scripts/build-lokal.mjs              # → dist/NexusOrdo.html (öppna filen i Edge eller Chrome)
node scripts/build-lokal.mjs --tema glas  # → dist/NexusOrdo-glas.html (demo)
npx serve app -l 3000                     # utvecklingsläge: http://localhost:3000/lokal
node --test "test/*.test.mjs"             # tester
```

- Med `sharp` installerat (`npm i -g sharp`, `NODE_PATH=$(npm root -g)`) bäddas hjälpbilderna in som WebP, annars PNG.
- Ändrar du `mallar/mallbibliotek.json`: kör `node scripts/embed-mallar.mjs`.
- Hjälpbilderna tas om med `node scripts/howto-bilder.mjs` (Playwright; `PW_CHANNEL=msedge` använder Edge). Bara påhittade planer.
- `.gitattributes` tvingar LF – testerna läser `app/script.js` och fallerar med CRLF.

## Viktigt vid utveckling

- Använd `dialog()` i stället för `alert`/`confirm`/`prompt`, och `LS`-wrappern i stället för `localStorage` direkt (kan vara blockerad).
- Ny text i gränssnittet går genom `tr('svensk text')` och får en engelsk översättning i `I18N_EN` – `test/i18n.test.mjs` fallerar annars.
- Checka aldrig in riktiga planer – bara påhittade testdata.

## Licens

Den egna koden är licensierad under MIT, se [LICENSE](LICENSE).

Tredjepartsbibliotek: se `app/vendor/README.md` (SheetJS, Apache-2.0).
