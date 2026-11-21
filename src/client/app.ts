import { getTodayLocalISO } from '../lib/storage';
import type { TabName } from './types';
import { initConfirmModal } from './ui/confirm-modal';
import { initInstallPrompt } from './ui/install-prompt';
import { initKeyboardShortcuts } from './ui/keyboard-shortcuts';
import { initNativeAndroidNavigation } from './ui/native-navigation';
import { registerOfflineServiceWorker } from './ui/sw-register';
import { initManageView, refreshStats } from './views/manage';
import {
  getSelectedDateISO,
  initPassesView,
  renderPassesForSelectedDate,
  setSelectedDateISO,
} from './views/passes';
import { initScannerView, startCamera, stopCamera } from './views/scanner';

const TAB_ORDER: readonly TabName[] = ['passes', 'scan', 'manage'];

const viewPasses = document.getElementById('view-passes') as HTMLElement;
const viewScan = document.getElementById('view-scan') as HTMLElement;
const viewManage = document.getElementById('view-manage') as HTMLElement;
const navButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.nav-item')
);

const viewsByTab: Record<TabName, HTMLElement> = {
  passes: viewPasses,
  scan: viewScan,
  manage: viewManage,
};

let activeTab: TabName = 'passes';
let passesDirty = true;

function switchTab(tab: TabName, options: { animate?: boolean } = {}): void {
  const { animate = true } = options;
  const prevIdx = TAB_ORDER.indexOf(activeTab);
  const nextIdx = TAB_ORDER.indexOf(tab);
  activeTab = tab;

  for (const [name, el] of Object.entries(viewsByTab) as Array<[TabName, HTMLElement]>) {
    el.hidden = name !== tab;
    el.classList.toggle('is-active', name === tab);
    el.classList.remove('is-entering-right', 'is-entering-left');
  }

  if (animate && prevIdx !== nextIdx) {
    const targetView = viewsByTab[tab];
    void targetView.offsetWidth;
    targetView.classList.add(
      nextIdx > prevIdx ? 'is-entering-right' : 'is-entering-left'
    );
  }

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
    if (passesDirty) {
      passesDirty = false;
      void renderPassesForSelectedDate();
    }
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
initKeyboardShortcuts(() => activeTab);
initNativeAndroidNavigation({
  tabOrder: TAB_ORDER,
  viewsByTab,
  getActiveTab: () => activeTab,
  switchTab,
});
initPassesView({
  onNavigateTab: switchTab,
  onCouponsChanged: refreshStats,
});
initScannerView({
  isScanTabActive: () => activeTab === 'scan',
  onCouponsChanged: () => {
    passesDirty = true;
    refreshStats();
  },
});
initManageView({
  getSelectedDateISO,
  onCouponsChanged: () => {
    passesDirty = true;
  },
  onViewImportedDate: (dateISO) => {
    passesDirty = true;
    setSelectedDateISO(dateISO, true);
    switchTab('passes');
  },
});

passesDirty = false;
void renderPassesForSelectedDate({ autoSelectRelevant: true });
void registerOfflineServiceWorker();
initInstallPrompt();
