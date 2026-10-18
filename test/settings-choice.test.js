const assert = require('node:assert/strict');
const test = require('node:test');
const { readAgentChoices } = require('../src/dialog/settings-choice');

function input(value, checked) {
  return { value, checked };
}

test('agent choices keep every checked provider in display order', () => {
  const inputs = [input('claude', true), input('codex', true), input('future', false)];
  assert.deepEqual(readAgentChoices(inputs, inputs[0]), ['claude', 'codex']);
});

test('the last agent cannot be unchecked', () => {
  const inputs = [input('claude', false), input('codex', false)];
  assert.deepEqual(readAgentChoices(inputs, inputs[1]), ['codex']);
  assert.equal(inputs[1].checked, true);
});
