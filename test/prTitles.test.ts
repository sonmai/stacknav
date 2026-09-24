import assert from 'node:assert/strict';
import test from 'node:test';
import { PrTitles } from '../src/prTitles';
import { normalizePrUrl, prSummary, StackBranch } from '../src/core';
import { StackCli } from '../src/cli';

test('normalizes pasted PR tab links and rejects ambiguous input', () => {
  assert.equal(normalizePrUrl(' https://github.com/o/r/pull/184/files?diff=split#file '), 'https://github.com/o/r/pull/184');
  assert.equal(normalizePrUrl('https://git.example.com/o/r/pull/184/'), 'https://git.example.com/o/r/pull/184');
  for (const input of ['184', 'http://github.com/o/r/pull/184', 'https://user:pass@github.com/o/r/pull/184', 'https://github.com/o/r/issues/184']) {
    assert.throws(() => normalizePrUrl(input), /full HTTPS/);
  }
});

test('shows title when available and branch fallback otherwise', () => {
  const branch: StackBranch = { name: 'feature', isCurrent: true, isMerged: false, isQueued: false, needsRebase: false,
    pr: { number: 184, url: 'https://github.com/o/r/pull/184', state: 'OPEN' } };
  assert.equal(prSummary(branch, 'Add API'), '#184 — Add API');
  assert.equal(prSummary(branch), '#184 — feature');
});

test('title lookup uses a normalized explicit URL and validates payload', async () => {
  const cli = new StackCli(async args => {
    assert.deepEqual(args, ['pr', 'view', 'https://github.com/o/r/pull/184', '--json', 'title']);
    return JSON.stringify({ title: 'Add\nAPI' });
  });
  assert.equal(await cli.prTitle('/repo', 'https://github.com/o/r/pull/184/files'), 'Add API');
  await assert.rejects(new StackCli(async () => '{}').prTitle('/repo', 'https://github.com/o/r/pull/184'), /Unexpected/);
});

test('deduplicates lookups, isolates URLs, expires and clears cached titles', async () => {
  let now = 0;
  let calls = 0;
  const cache = new PrTitles(async (_cwd, url) => { calls++; return url; }, () => now);
  const first = cache.get('/repo', 'a');
  assert.equal(cache.get('/repo', 'a'), first);
  await first;
  await cache.get('/repo', 'a');
  await cache.get('/repo', 'b');
  assert.equal(calls, 2);
  assert.equal(cache.peek('a'), 'a');
  now = 300_001;
  await cache.get('/repo', 'a');
  assert.equal(calls, 3);
  cache.clear();
  assert.equal(cache.peek('a'), undefined);
  await cache.get('/repo', 'a');
  assert.equal(calls, 4);
});

test('failed lookups fall back and retry after a short cooldown', async () => {
  let now = 0;
  let calls = 0;
  const cache = new PrTitles(async () => { if (++calls === 1) { throw new Error('offline'); } return 'Recovered'; }, () => now);
  assert.equal(await cache.get('/repo', 'a'), undefined);
  assert.equal(await cache.get('/repo', 'a'), undefined);
  assert.equal(calls, 1);
  now = 30_001;
  assert.equal(await cache.get('/repo', 'a'), 'Recovered');
});
