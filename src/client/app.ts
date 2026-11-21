import { getTodayLocalISO } from '../lib/storage';
import type { TabName } from './types';
import { closeConfirm, initConfirmModal, isConfirmOpen } from './ui/confirm-modal';
import { initInstallPrompt } from './ui/install-prompt';
import { registerOfflineServiceWorker } from './ui/sw-register';
import {
  closeTransferModal,
  initManageView,
  isTransferModalOpen,
  refreshStats,
  stepTransferChunk,
} from './views/manage';
import {
  getSelectedDateISO,
  initPassesView,
  renderPassesForSelectedDate,
  setSelectedDateISO,
  shiftSelectedDate,
} from './views/passes';
import { initScannerView, startCamera, stopCamera } from './views/scanner';

const viewPasses = document.getElementById('view-passes') as HTMLElement;
const viewScan = document.getElementById('view-scan') as HTMLElement;
const viewManage = document.getElementById('view-manage') as HTMLElement;
const navButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.nav-item')
);

let activeTab: TabName = 'passes';

function switchTab(tab: TabName): void {
  activeTab = tab;

  viewPasses.hidden = tab !== 'passes';
  viewScan.hidden = tab !== 'scan';
  viewManage.hidden = tab !== 'manage';

  viewPasses.classList.toggle('is-active', tab === 'passes');
  viewScan.classList.toggle('is-active', tab === 'scan');
  viewManage.classList.toggle('is-active', tab === 'manage');

  navButtons.forEach((btn) => {
    const isCurrent = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', isCurrent);
    if (isCurrent) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  if (tab === 'scan') {
    void startCamera();
  } else {
    stopCamera();
  }

  if (tab === 'passes') {
    void renderPassesForSelectedDate();
  } else if (tab === 'manage') {
    refreshStats();
  }
}

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab as TabName | undefined;
    if (tab) switchTab(tab);
  });
});

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

  if (!isTyping && !isConfirmOpen() && activeTab === 'passes') {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      shiftSelectedDate(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      shiftSelectedDate(1);
    }
  }
});

// Auto-refresh time-of-day meal highlight every minute when viewing Today
window.setInterval(() => {
  if (activeTab === 'passes' && getSelectedDateISO() === getTodayLocalISO()) {
    void renderPassesForSelectedDate({ autoSelectRelevant: false });
  }
}, 60_000);

document.addEventListener('visibilitychange', () => {
  if (
    !document.hidden &&
    activeTab === 'passes' &&
    getSelectedDateISO() === getTodayLocalISO()
  ) {
    void renderPassesForSelectedDate({ autoSelectRelevant: true });
  }
});

// --- Init ---
initConfirmModal();
initPassesView({
  onNavigateTab: switchTab,
  onCouponsChanged: refreshStats,
});
initScannerView({
  isScanTabActive: () => activeTab === 'scan',
  onCouponsChanged: refreshStats,
});
initManageView({
  getSelectedDateISO,
  onViewImportedDate: (dateISO) => {
    setSelectedDateISO(dateISO, true);
    switchTab('passes');
  },
});

void renderPassesForSelectedDate({ autoSelectRelevant: true });
void registerOfflineServiceWorker();
initInstallPrompt();
