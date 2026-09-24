import assert from 'node:assert/strict';
import test from 'node:test';
import { navigation, parseCurrentPr, parseStack } from '../src/core';

test('reads bottom-to-top stack and current position', () => {
  const state = parseStack(JSON.stringify({
    trunk: 'main', currentBranch: 'api', branches: [
      { name: 'model', isCurrent: false, pr: { number: 176, url: 'https://github.com/o/r/pull/176', state: 'OPEN' } },
      { name: 'api', isCurrent: true, pr: { number: 184, url: 'https://github.com/o/r/pull/184', state: 'OPEN' } },
      { name: 'ui', isCurrent: false, pr: { number: 191, url: 'https://github.com/o/r/pull/191', state: 'OPEN' } }
    ]
  }));
  assert.equal(state.type, 'loaded');
  if (state.type === 'loaded') {
    assert.equal(state.index, 1);
    assert.equal(state.stack.branches[2].pr?.number, 191);
  }
});

test('trunk and malformed payloads never expose a navigation layer', () => {
  assert.deepEqual(parseStack(JSON.stringify({ trunk: 'main', currentBranch: 'main', branches: [
    { name: 'feature', isCurrent: false }
  ] })), { type: 'empty' });
  assert.throws(() => parseStack('{"branches":[]}'), /Unexpected/);
});

test('uses an explicit PR URL instead of ambiguous bare number', () => {
  assert.deepEqual(parseCurrentPr('{"number":184,"url":"https://github.com/o/r/pull/184"}'), {
    number: 184, url: 'https://github.com/o/r/pull/184'
  });
  assert.throws(() => parseCurrentPr('{"number":184,"url":"bad"}'), /Unexpected/);
});

test('navigation counts active layers and labels the actual adjacent targets', () => {
  const state = parseStack(JSON.stringify({
    trunk: 'main', currentBranch: 'base', branches: [
      { name: 'base', isCurrent: true, isMerged: false },
      { name: 'merged', isCurrent: false, isMerged: true },
      { name: 'api', isCurrent: false, isMerged: false },
      { name: 'ui', isCurrent: false, isMerged: false }
    ]
  }));
  assert.equal(state.type, 'loaded');
  if (state.type !== 'loaded') { return; }
  const bottom = navigation(state.stack, 0);
  assert.deepEqual(bottom.selectable, [0, 2, 3]);
  assert.equal(bottom.above, 2);
  assert.deepEqual(bottom.moveTo(2), { direction: 'up', steps: 1 });
  assert.deepEqual(bottom.moveTo(3), { direction: 'up', steps: 2 });
  assert.equal(bottom.moveTo(1), undefined);
  const middle = navigation(state.stack, 2);
  assert.equal(middle.below, 0);
  assert.deepEqual(middle.moveTo(0), { direction: 'down', steps: 1 });
  assert.deepEqual(navigation(state.stack, 3).moveTo(0), { direction: 'down', steps: 2 });
});

test('navigation from a merged current branch uses raw layer positions', () => {
  const state = parseStack(JSON.stringify({
    trunk: 'main', currentBranch: 'merged', branches: [
      { name: 'base', isCurrent: false, isMerged: false },
      { name: 'merged', isCurrent: true, isMerged: true },
      { name: 'api', isCurrent: false, isMerged: false }
    ]
  }));
  assert.equal(state.type, 'loaded');
  if (state.type !== 'loaded') { return; }
  const targets = navigation(state.stack, state.index);
  assert.deepEqual(targets.selectable, [0, 1, 2]);
  assert.deepEqual(targets.moveTo(2), { direction: 'up', steps: 1 });
});
