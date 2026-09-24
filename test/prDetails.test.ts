import assert from 'node:assert/strict';
import test from 'node:test';
import { PrDetailsCache } from '../src/prDetails';
import { normalizePrUrl, descriptionPreview, prSummary, StackBranch } from '../src/core';
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
    assert.deepEqual(args, ['pr', 'view', 'https://github.com/o/r/pull/184', '--json', 'title,body']);
    return JSON.stringify({ title: 'Add\nAPI', body: 'Description' });
  });
  assert.deepEqual(await cli.prDetails('/repo', 'https://github.com/o/r/pull/184/files'), { title: 'Add API', body: 'Description' });
  await assert.rejects(new StackCli(async () => '{}').prDetails('/repo', 'https://github.com/o/r/pull/184'), /Unexpected/);
});

test('preserves the title when the description is null, missing or empty', async () => {
  for (const body of [null, undefined, '']) {
    const cli = new StackCli(async () => JSON.stringify({ title: 'Add API', body }));
    assert.deepEqual(await cli.prDetails('/repo', 'https://github.com/o/r/pull/184'), {
      title: 'Add API', body: ''
    });
  }
});

test('still rejects invalid title and non-null body types', async () => {
  for (const value of [
    { title: null, body: '' }, { title: 1 }, { body: '' },
    { title: 'Add API', body: 1 }, { title: 'Add API', body: false },
    { title: 'Add API', body: {} }, { title: 'Add API', body: [] }
  ]) {
    const cli = new StackCli(async () => JSON.stringify(value));
    await assert.rejects(cli.prDetails('/repo', 'https://github.com/o/r/pull/184'), /Unexpected/);
  }
});

test('deduplicates lookups, isolates URLs, expires and clears cached titles', async () => {
  let now = 0;
  let calls = 0;
  const cache = new PrDetailsCache(async (_cwd, url) => { calls++; return { title: url, body: '' }; }, () => now);
  const first = cache.get('/repo', 'a');
  assert.equal(cache.get('/repo', 'a'), first);
  await first;
  await cache.get('/repo', 'a');
  await cache.get('/repo', 'b');
  assert.equal(calls, 2);
  assert.equal(cache.peek('a')?.title, 'a');
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
  const cache = new PrDetailsCache(async () => { if (++calls === 1) { throw new Error('offline'); } return { title: 'Recovered', body: '' }; }, () => now);
  assert.equal(await cache.get('/repo', 'a'), undefined);
  assert.equal(await cache.get('/repo', 'a'), undefined);
  assert.equal(calls, 1);
  now = 30_001;
  assert.equal((await cache.get('/repo', 'a'))?.title, 'Recovered');
});


test('description preview handles empty bodies and caps lines and long paragraphs', () => {
  assert.equal(descriptionPreview('  '), '');
  assert.equal(descriptionPreview(' First\r\n\r\nSecond\r\nThird\r\nFourth'), 'First\nSecond\nThird…');
  assert.equal(descriptionPreview('a'.repeat(401)), 'a'.repeat(400) + '…');
});
