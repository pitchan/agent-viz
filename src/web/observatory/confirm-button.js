// confirm-button.js — two-step confirmation for a destructive action, without
// any browser dialog: the first click arms the button (label + colour), only
// a second click within the delay fires the action, the timeout quietly
// disarms. Same component style as period-selector.js.
export function initConfirmButton(node, { armedLabel, onConfirm, disarmDelayMs = 5000 }) {
  const restLabel = node.textContent;
  let timer = null;
  const disarm = () => {
    clearTimeout(timer);
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
