// Two-step confirmation: first click arms, second click fires, the timeout
// disarms. Tested on a stub node — no DOM, no browser.
import { afterEach, expect, test, vi } from 'vitest';
import { initConfirmButton } from '../../src/web/observatory/confirm-button.ts';

function stubNode(label: string): any {
  const classes = new Set<string>();
  let onClick: (() => void) | null = null;
  return {
    textContent: label,
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    addEventListener: (event: string, fn: () => void) => { if (event === 'click') onClick = fn; },
    click: () => onClick!(),
    hasClass: (c: string) => classes.has(c),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test('first click arms without firing', () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const node = stubNode('Purger la base');
  let fired = 0;
  initConfirmButton(node, { armedLabel: 'Confirmer la purge ?', onConfirm: () => { fired += 1; } });
  node.click();
  expect(node.textContent).toBe('Confirmer la purge ?');
  expect(node.hasClass('confirm-armed')).toBe(true);
  expect(fired).toBe(0);
});

test('second click fires once and disarms', () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const node = stubNode('Purger la base');
  let fired = 0;
  initConfirmButton(node, { armedLabel: 'Confirmer la purge ?', onConfirm: () => { fired += 1; } });
  node.click();
  node.click();
  expect(fired).toBe(1);
  expect(node.textContent).toBe('Purger la base');
  expect(node.hasClass('confirm-armed')).toBe(false);
});

test('the delay disarms without firing; the next click only re-arms', () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const node = stubNode('Purger la base');
  let fired = 0;
  initConfirmButton(node, {
    armedLabel: 'Confirmer ?', onConfirm: () => { fired += 1; }, disarmDelayMs: 5000,
  });
  node.click();
  vi.advanceTimersByTime(5000);
  expect(node.textContent).toBe('Purger la base');
  expect(node.hasClass('confirm-armed')).toBe(false);
  expect(fired).toBe(0);
  node.click();
  expect(fired).toBe(0);
  expect(node.textContent).toBe('Confirmer ?');
});
