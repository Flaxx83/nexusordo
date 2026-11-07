// Bygger NexusOrdo som en enda fil, dist/NexusOrdo.html, av app/ (index.html, style.css, script.js),
// SheetJS (app/vendor/) och hjälpcentrets bilder – öppnas direkt från disk (file://) utan nätverk.
// Mallbiblioteket finns redan i app/script.js (scripts/embed-mallar.mjs). Bilderna blir WebP om sharp finns, annars PNG.
// Kör: node scripts/build-lokal.mjs [--tema glas] [utfil]   (NODE_PATH=$(npm root -g) för sharp)
// --tema glas (#72, demo): lägger till app/teman/glas.css och glas.js → dist/NexusOrdo-glas.html
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildInfo, embedBuild } from './build-info.mjs';
import { fileSkip, howtoImages } from './howto-img.mjs';

const require = createRequire(import.meta.url);
const repo = new URL('../', import.meta.url), app = new URL('app/', repo);
const read = p => readFileSync(new URL(p, app), 'utf8').replace(/\r\n/g, '\n');
const args = process.argv.slice(2), ti = args.indexOf('--tema');
const theme = ti >= 0 ? args.splice(ti, 2)[1] : '';
if (theme && !/^[a-z]+$/.test(theme)) throw new Error('Ogiltigt tema: ' + theme);

// SheetJS: samma fil och kontrollsumma som i app/vendor/README.md
const xlsx = read('vendor/xlsx.full.min.js');
const sha = createHash('sha256').update(readFileSync(new URL('vendor/xlsx.full.min.js', app))).digest('hex');
if (!read('vendor/README.md').includes(sha)) throw new Error('SheetJS stämmer inte med SHA-256 i app/vendor/README.md');

let sharp = null;
try { sharp = require('sharp'); } catch { /* utan sharp bäddas PNG in */ }
let script = read('script.js');
const { img } = await howtoImages(app, sharp, fileSkip(script));

const re = /\/\* HOWTO:START \*\/[\s\S]*?\/\* HOWTO:END \*\//;
if (!re.test(script)) throw new Error('Hittar inte HOWTO:START/HOWTO:END i app/script.js');
script = script.replace(re, () => `/* HOWTO:START */\nconst HOWTO_IMG = ${JSON.stringify(img)};\n/* HOWTO:END */`);

// Version = senaste commit, så att bygget går att upprepa; TP_BUILD (#78) = samma version med tid, för varningen om filer från en nyare NexusOrdo
const info = buildInfo(fileURLToPath(repo).replace(/\/$/, ''));
script = embedBuild(script, info);
const local = { version: info.version, date: info.date, ...(theme ? { theme } : {}) };

const html = read('index.html').replace(/^.*data-embed="sheetjs".*\n/m, '');
// Inbäddad kod får inte innehålla </script, <script eller <!-- (HTML-tolken avslutar eller byter läge); \x3C fungerar i strängar och regex
const inline = s => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<(!--|script)/gi, '\\x3C$1');
const out = `<!doctype html>
<!-- NexusOrdo ${local.version} (${local.date})${theme ? ` – tema ${theme} (demo)` : ''}. Byggd av scripts/build-lokal.mjs från app/. SheetJS 0.20.3 (Apache-2.0). -->
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NexusOrdo</title>
<style>
${read('style.css')}
</style>${theme ? `\n<style>\n${read(`teman/${theme}.css`)}\n</style>` : ''}
</head>
<body>
${html}
<script>
${inline(xlsx)}
</script>
<script>
window.TP_LOCAL = ${JSON.stringify(local)};
</script>
<script>
${inline(script)}
</script>${theme ? `\n<script>\n${inline(read(`teman/${theme}.js`))}\n</script>` : ''}
</body>
</html>
`;
mkdirSync(new URL('dist/', repo), { recursive: true });
const target = args[0] || fileURLToPath(new URL(`dist/NexusOrdo${theme ? '-' + theme : ''}.html`, repo));
writeFileSync(target, out);
console.log(`${target.split(/[\\/]/).pop()}: ${local.version} (${local.date}), ${Math.round(out.length / 1024)} KB, bilder som ${sharp ? 'WebP' : 'PNG'}`);
