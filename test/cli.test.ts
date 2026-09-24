import assert from 'node:assert/strict';
import test from 'node:test';
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
  const cli = new StackCli(async () => { throw new Error('runner must not be called'); });
  assert.throws(() => cli.load('/repo', '184'), /Invalid PR URL/);
  assert.throws(() => cli.move('/repo', 'up', 0), /Invalid step count/);
});
