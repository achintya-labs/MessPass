import type { TabName } from '../types';
import { closeConfirm, isConfirmOpen } from './confirm-modal';
import {
  closeTransferModal,
  isTransferModalOpen,
  stepTransferChunk,
} from '../views/manage';
import { shiftSelectedDate } from '../views/passes';

export function initKeyboardShortcuts(getActiveTab: () => TabName): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isConfirmOpen()) {
        closeConfirm();
        return;
      }
      if (isTransferModalOpen()) {
        closeTransferModal();
        return;
      }
    }

    if (isTransferModalOpen()) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepTransferChunk(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepTransferChunk(1);
      }
      return;
    }

    const activeEl = document.activeElement;
    const isTyping =
      activeEl instanceof HTMLInputElement ||
      activeEl instanceof HTMLTextAreaElement ||
      activeEl instanceof HTMLSelectElement;

    if (!isTyping && !isConfirmOpen() && getActiveTab() === 'passes') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        shiftSelectedDate(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        shiftSelectedDate(1);
      }
    }
  });
}
