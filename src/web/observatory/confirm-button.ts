// confirm-button.js — two-step confirmation for a destructive action, without
// any browser dialog: the first click arms the button (label + colour), only
// a second click within the delay fires the action, the timeout quietly
// disarms. Same component style as period-selector.js.
export function initConfirmButton(
  node: HTMLElement,
  { armedLabel, onConfirm, disarmDelayMs = 5000 }: { armedLabel: string; onConfirm: () => void; disarmDelayMs?: number },
): void {
  const restLabel = node.textContent;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    // clearTimeout n'accepte pas `null` dans son typage (accepte tout a
    // l'execution) — `?? undefined` est le meme no-op, cote types.
    clearTimeout(timer ?? undefined);
    timer = null;
    node.classList.remove('confirm-armed');
    node.textContent = restLabel;
  };
  node.addEventListener('click', () => {
    if (timer === null) {
      node.classList.add('confirm-armed');
      node.textContent = armedLabel;
      timer = setTimeout(disarm, disarmDelayMs);
    } else {
      disarm();
      onConfirm();
    }
  });
}
