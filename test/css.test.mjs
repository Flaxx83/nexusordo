// Dolda vyer får aldrig ligga kvar ovanpå de andra (fel 2026-10-28: portföljvyn fångade scroll och klick i Gantt och How to).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8');
test('.view[hidden] döljs med !important', () => assert.match(css, /\.view\[hidden\][^{]*\{\s*display:\s*none\s*!important/));
