import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCurrentPr, parseStack } from '../src/core';

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
