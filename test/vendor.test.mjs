// Tredjepartsbibliotek (app/vendor): rätt version, oförändrad fil och inget externt CDN i index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const rd = p => readFileSync(new URL('../' + p, import.meta.url));
test('SheetJS 0.20.3 från app/vendor, med SHA-256 som i README', () => {
  const js = rd('app/vendor/xlsx.full.min.js');
  assert.match(js.toString('utf8', 0, 4000000), /version="0\.20\.3"/);
  const sha = createHash('sha256').update(js).digest('hex');
  assert.ok(rd('app/vendor/README.md').toString().includes(sha), 'SHA-256 i app/vendor/README.md stämmer inte');
});
test('index.html laddar SheetJS från vendor (inbäddas vid driftsättning), inget externt CDN', () => {
  const html = rd('app/index.html').toString();
  assert.match(html, /<script src="vendor\/xlsx\.full\.min\.js" data-embed="sheetjs"><\/script>/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net|unpkg\.com|cdn\.sheetjs\.com/);
});
