// Two-step confirmation: first click arms, second click fires, the timeout
// disarms. Tested on a stub node — no DOM, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initConfirmButton } from '../../src/web/observatory/confirm-button.js';

function stubNode(label) {
  const classes = new Set();
  let onClick = null;
  return {
    textContent: label,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
    addEventListener: (event, fn) => { if (event === 'click') onClick = fn; },
    click: () => onClick(),
    hasClass: c => classes.has(c),
  };
}

test('first click arms without firing', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const node = stubNode('Purger la base');
  let fired = 0;
  initConfirmButton(node, { armedLabel: 'Confirmer la purge ?', onConfirm: () => { fired += 1; } });
  node.click();
  assert.equal(node.textContent, 'Confirmer la purge ?');
  assert.equal(node.hasClass('confirm-armed'), true);
  assert.equal(fired, 0);
});

test('second click fires once and disarms', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const node = stubNode('Purger la base');
  let fired = 0;
  initConfirmButton(node, { armedLabel: 'Confirmer la purge ?', onConfirm: () => { fired += 1; } });
  node.click();
  node.click();
  assert.equal(fired, 1);
  assert.equal(node.textContent, 'Purger la base');
  assert.equal(node.hasClass('confirm-armed'), false);
});

test('the delay disarms without firing; the next click only re-arms', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const node = stubNode('Purger la base');
  let fired = 0;
  initConfirmButton(node, {
    armedLabel: 'Confirmer ?', onConfirm: () => { fired += 1; }, disarmDelayMs: 5000,
  });
  node.click();
  t.mock.timers.tick(5000);
  assert.equal(node.textContent, 'Purger la base');
  assert.equal(node.hasClass('confirm-armed'), false);
  assert.equal(fired, 0);
  node.click();
  assert.equal(fired, 0);
  assert.equal(node.textContent, 'Confirmer ?');
});
