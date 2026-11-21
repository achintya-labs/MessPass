const confirmModal = document.getElementById('confirm-modal') as HTMLDivElement;
const confirmTitle = document.getElementById('confirm-title') as HTMLHeadingElement;
const confirmMessage = document.getElementById('confirm-message') as HTMLParagraphElement;
const btnConfirmCancel = document.getElementById('btn-confirm-cancel') as HTMLButtonElement;
const btnConfirmOk = document.getElementById('btn-confirm-ok') as HTMLButtonElement;

let pendingConfirmAction: (() => void) | null = null;

export function isConfirmOpen(): boolean {
  return !confirmModal.hidden;
}

export function openConfirm(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void
): void {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  btnConfirmOk.textContent = confirmLabel;
  pendingConfirmAction = onConfirm;
  confirmModal.hidden = false;
}

export function closeConfirm(): void {
  confirmModal.hidden = true;
  pendingConfirmAction = null;
}

export function initConfirmModal(): void {
  btnConfirmCancel.addEventListener('click', closeConfirm);
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirm();
  });
  btnConfirmOk.addEventListener('click', () => {
    const action = pendingConfirmAction;
    closeConfirm();
    action?.();
  });
}
