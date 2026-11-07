import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('../app/script.js', import.meta.url), 'utf8');
const code = src.split('/* UPDATE:START */')[1].split('/* UPDATE:END */')[0];
const load = fetch => new Function('fetch', 'AbortController', 'setTimeout', 'clearTimeout', code + '\nreturn { compareRelease, latestRelease };')(fetch, AbortController, setTimeout, clearTimeout);

test('release comparison handles multi-digit versions and rejects unsupported tags', () => {
  const { compareRelease: cmp } = load();
  assert.equal(cmp('v0.1.10', '0.1.2'), 1);
  assert.equal(cmp('v1.0.0', '0.99.99'), 1);
  assert.equal(cmp('v0.1.2', '0.1.2'), 0);
  assert.equal(cmp('v0.1.1', '0.1.2'), -1);
  for (const value of [null, 'dev', 'v1.2.3-beta', '<script>', '999999999999999999999.1.1']) assert.equal(cmp(value, '0.1.2'), null);
});

test('release request sends no credentials or project data', async () => {
  const { latestRelease } = load(async (url, opts) => {
    assert.equal(url, 'https://api.github.com/repos/Flaxx83/nexusordo/releases/latest');
    assert.equal(opts.credentials, 'omit');
    assert.equal(opts.referrerPolicy, 'no-referrer');
    assert.equal(opts.body, undefined);
    assert.ok(opts.signal);
    return { ok: true, json: async () => ({ tag_name: 'v0.1.3', draft: false, prerelease: false }) };
  });
  assert.equal(await latestRelease(), 'v0.1.3');
});

test('offline, rate limits and invalid responses do not count as up to date', async () => {
  for (const fetch of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => ({ tag_name: 'oops' }) }),
    async () => ({ ok: true, json: async () => ({ tag_name: 'v1.0.0', prerelease: true }) })
  ]) await assert.rejects(load(fetch).latestRelease());
});
