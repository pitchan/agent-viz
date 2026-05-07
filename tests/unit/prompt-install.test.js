'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTargetDefault } = require('../../lib/prompt-install');

test('pickTargetDefault: both detected → index 2 (Both)', () => {
  assert.equal(pickTargetDefault({ claude: true, copilot: true }), 2);
});

test('pickTargetDefault: only claude detected → index 0', () => {
  assert.equal(pickTargetDefault({ claude: true, copilot: false }), 0);
});

test('pickTargetDefault: only copilot detected → index 1', () => {
  assert.equal(pickTargetDefault({ claude: false, copilot: true }), 1);
});

test('pickTargetDefault: nothing detected → index 2 (Both, lets user pre-install)', () => {
  assert.equal(pickTargetDefault({ claude: false, copilot: false }), 2);
});
