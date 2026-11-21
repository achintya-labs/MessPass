import type { ToastVariant } from '../types';

const toastEl = document.getElementById('toast') as HTMLDivElement;
let toastTimer: number | null = null;

export function showToast(message: string, variant: ToastVariant = 'info'): void {
  toastEl.textContent = message;
  toastEl.className = `toast toast-${variant}`;
  toastEl.hidden = false;
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}
