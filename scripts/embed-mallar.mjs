// Bäddar in mallbiblioteket (mallar/mallbibliotek.json) i app/script.js mellan /* MALLAR:START */ och /* MALLAR:END */.
// Kör: node scripts/embed-mallar.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const repo = new URL('../', import.meta.url);
const lib = JSON.parse(readFileSync(new URL('mallar/mallbibliotek.json', repo), 'utf8'));
const js = new URL('app/script.js', repo);
const src = readFileSync(js, 'utf8');
const re = /\/\* MALLAR:START \*\/[\s\S]*?\/\* MALLAR:END \*\//;
if (!re.test(src)) throw new Error('Hittar inte MALLAR-markeringarna i app/script.js');
const out = src.replace(re, () => `/* MALLAR:START */\nconst TEMPLATE_LIB = ${JSON.stringify(lib)};\n/* MALLAR:END */`);
if (out === src) console.log('Mallbiblioteket oförändrat');
else {
  writeFileSync(js, out);
  console.log('Mallbiblioteket inbäddat:', lib.groups.map(g => `${g.id} ${g.items.length}${g.repeat ? ' + upprepning' : ''}`).join(', '));
}
