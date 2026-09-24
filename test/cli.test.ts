import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { StackCli } from '../src/cli';

test('every command stays within the reviewer navigation allowlist', async () => {
  const calls: string[][] = [];
  const cli = new StackCli(async args => {
    calls.push([...args]);
    return '{}';
  });
  await cli.view('/repo');
  await cli.currentPr('/repo');
  await cli.load('/repo', 'https://github.com/o/r/pull/184');
  await cli.move('/repo', 'up');
  await cli.move('/repo', 'down');
  await cli.move('/repo', 'up', 2);
  assert.deepEqual(calls, [
    ['stack', 'view', '--json'],
    ['pr', 'view', '--json', 'number,url'],
    ['stack', 'checkout', 'https://github.com/o/r/pull/184'],
    ['stack', 'up'],
    ['stack', 'down'],
    ['stack', 'up', '2']
  ]);
});

test('rejects unsafe or ambiguous checkout arguments', async () => {
  let calls = 0;
  const cli = new StackCli(async () => { calls++; return ''; });
  assert.throws(() => cli.load('/repo', '184'), /Invalid PR URL/);
  assert.throws(() => cli.move('/repo', 'up', 0), /Invalid step count/);
  assert.throws(() => cli.move('/repo', 'sync' as 'up', 1), /Invalid navigation direction/);
  assert.equal(calls, 0);
});

test('background CLI sends EOF to stdin instead of waiting for a prompt', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stacknav-gh-'));
  const fakeGh = join(dir, 'gh');
  const previousPath = process.env.PATH;
  writeFileSync(fakeGh, '#!/usr/bin/env node\nprocess.stdin.on("end", () => process.stdout.write("ok")); process.stdin.resume();\n');
  chmodSync(fakeGh, 0o755);
  process.env.PATH = `${dir}${delimiter}${previousPath ?? ''}`;
  try {
    assert.equal(await new StackCli().view(dir), 'ok');
  } finally {
    process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
