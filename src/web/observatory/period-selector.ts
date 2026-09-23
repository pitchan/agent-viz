// The 7/30/90 window selector, shared by both observatory pages. Display
// copy of the service's WINDOW_DAYS table — the server clamps anyway.
import { getState, setPeriodDays, subscribe } from './store.ts';

export const WINDOW_DAYS = [7, 30, 90];

// Le panneau Skills n'offre que les fenêtres <= maxDays et surligne la fenêtre
// bornée : le clic doit comparer à cette MÊME valeur bornée, sinon le bouton
// déjà actif (ex. 30 j quand la fenêtre partagée vaut 90) redéclenche un
// setPeriodDays qui fait chuter silencieusement les autres panneaux.
export function clampedPeriodDays(periodDays: number, maxDays: number): number {
  return Math.min(periodDays, maxDays);
}

/** Renders the selector into `node`; calls `onChange()` after each switch.
 *  `maxDays` borne le panneau qui ne sait pas lire au-delà (Skills) : il n'offre
 *  que les fenêtres plus courtes, et marque celle qu'il lit vraiment. */
export function initPeriodSelector(node: HTMLElement, onChange: () => void, maxDays = Infinity): void {
  const render = () => {
    node.innerHTML = '';
    const periodDays = clampedPeriodDays(getState().periodDays, maxDays);
    for (const days of WINDOW_DAYS.filter(d => d <= maxDays)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'period-btn' + (days === periodDays ? ' active' : '');
      btn.textContent = `${days} j`;
      btn.addEventListener('click', () => {
        if (periodDays !== days) { setPeriodDays(days); onChange(); }
      });
      node.appendChild(btn);
    }
  };
  render();
  subscribe(render);
}
