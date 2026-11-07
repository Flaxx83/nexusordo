// Hjälpcentrets bilder (app/howto/<sv|en>/NN-namn.png) som data-URL:er för bygget (build-lokal.mjs).
import { readdirSync, readFileSync } from 'node:fs';

// Bilder med en egen variant för lokala filen (FILE_IMG i app/script.js, t.ex. 08-program → 08-program-fil): originalen bäddas inte in
export function fileImg(script) {
  const m = String(script).match(/const FILE_IMG = (\{[^}]*\});/);
  if (!m) throw new Error('Hittar inte FILE_IMG i app/script.js');
  return JSON.parse(m[1].replace(/'/g, '"'));
}
export const fileSkip = script => Object.keys(fileImg(script));

// sharp → WebP (1000 px bred, kvalitet 62), annars PNG som den är. skip = nycklar som inte bäddas in
export async function howtoImages(app, sharp = null, skip = []) {
  const img = {};
  let bytes = 0;
  for (const lang of ['sv', 'en']) {
    img[lang] = {};
    const dir = new URL(`howto/${lang}/`, app);
    for (const f of readdirSync(dir).filter(f => f.endsWith('.png') && !skip.includes(f.slice(0, -4))).sort()) {
      const raw = readFileSync(new URL(f, dir));
      const buf = sharp ? await sharp(raw).resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 62 }).toBuffer() : raw;
      img[lang][f.slice(0, -4)] = `data:image/${sharp ? 'webp' : 'png'};base64,` + buf.toString('base64');
      bytes += buf.length;
    }
  }
  return { img, bytes };
}
