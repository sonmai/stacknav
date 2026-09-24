import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalStacks, parseLocalStacks } from '../src/localStacks';
const fixture = () => ({ schemaVersion: 1, stacks: [
  { number: 7, trunk: { branch: 'main' }, branches: [
    { branch: 'old', pullRequest: { number: 1, merged: true } },
    { branch: 'api', pullRequest: { number: 2 } }
  ] },
  { number: 8, trunk: { branch: 'main' }, branches: [{ branch: 'ui', pullRequest: { number: 3 } }] },
  { number: 9, trunk: { branch: 'develop' }, branches: [{ branch: 'other' }] }
] });

test('lists only stacks on the current trunk and enters the chosen first active branch', async () => {
  const calls: string[][] = [];
  const stacks = new LocalStacks(async (args, root) => {
    assert.equal(root, '/repo'); calls.push([...args]);
    return args[0] === 'symbolic-ref' ? 'main\n' : args[0] === 'rev-parse' ? '/repo/.git\n' : 'ok';
  }, async path => { assert.equal(path, '/repo/.git/gh-stack'); return JSON.stringify(fixture()); });
  const choices = await stacks.list('/repo');
  assert.deepEqual(choices.map(s => s.number), [7, 8]);
  await stacks.enter('/repo', choices[0]);
  assert.deepEqual(calls, [
    ['symbolic-ref', '--quiet', '--short', 'HEAD'], ['rev-parse', '--absolute-git-dir'],
    ['symbolic-ref', '--quiet', '--short', 'HEAD'], ['rev-parse', '--absolute-git-dir'],
    ['switch', '--no-guess', '--', 'api']
  ]);
});

test('cancels checkout when branch, stack composition or merge state changes', async () => {
  for (const change of ['branch', 'removed', 'merged']) {
    let current = 'main';
    const data = fixture();
    let switches = 0;
    const stacks = new LocalStacks(async args => {
      if (args[0] === 'switch') { switches++; }
      return args[0] === 'symbolic-ref' ? current : '/repo/.git';
    }, async () => JSON.stringify(data));
    const [choice] = await stacks.list('/repo');
    if (change === 'branch') { current = 'api'; }
    if (change === 'removed') { data.stacks.shift(); }
    if (change === 'merged') { Object.assign(data.stacks[0].branches[1], { pullRequest: { number: 2, merged: true } }); }
    await assert.rejects(stacks.enter('/repo', choice), /changed/);
    assert.equal(switches, 0);
  }
});

test('unsupported metadata fails closed', () => {
  assert.throws(() => parseLocalStacks('{"schemaVersion":2,"stacks":[]}', 'main'), /Unsupported/);
  assert.throws(() => parseLocalStacks('{"schemaVersion":1,"stacks":[{"trunk":{"branch":"main"},"branches":[{}]}]}', 'main'), /Invalid/);
});
