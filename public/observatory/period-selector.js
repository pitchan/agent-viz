// The 7/30/90 window selector, shared by both observatory pages. Display
// copy of the service's WINDOW_DAYS table — the server clamps anyway.
import { getState, setPeriodDays, subscribe } from './store.js';

export const WINDOW_DAYS = [7, 30, 90];

/** Renders the selector into `node`; calls `onChange()` after each switch. */
export function initPeriodSelector(node, onChange) {
  const render = () => {
    node.innerHTML = '';
    const { periodDays } = getState();
    for (const days of WINDOW_DAYS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'period-btn' + (days === periodDays ? ' active' : '');
      btn.textContent = `${days} j`;
      btn.addEventListener('click', () => {
        if (getState().periodDays !== days) { setPeriodDays(days); onChange(); }
      });
      node.appendChild(btn);
    }
  };
  render();
  subscribe(render);
}
