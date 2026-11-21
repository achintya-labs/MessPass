import { Capacitor } from '@capacitor/core';
import type { TabName } from '../types';
import { closeConfirm, isConfirmOpen } from './confirm-modal';
import { initSwipeTabs } from './swipe-tabs';
import { closeTransferModal, isTransferModalOpen } from '../views/manage';

export interface NativeNavigationOptions {
  tabOrder: readonly TabName[];
  viewsByTab: Record<TabName, HTMLElement>;
  getActiveTab: () => TabName;
  switchTab: (tab: TabName, options?: { animate?: boolean }) => void;
}

export function initNativeAndroidNavigation(opts: NativeNavigationOptions): void {
  if (!Capacitor.isNativePlatform()) return;

  const win = window as Window & { __handleAndroidBack?: () => boolean };
  win.__handleAndroidBack = () => {
    if (isConfirmOpen()) {
      closeConfirm();
      return true;
    }
    if (isTransferModalOpen()) {
      closeTransferModal();
      return true;
    }
    if (opts.getActiveTab() !== 'passes') {
      opts.switchTab('passes');
      return true;
    }
    return false;
  };

  initSwipeTabs({
    tabOrder: opts.tabOrder,
    viewsByTab: opts.viewsByTab,
    getActiveTab: opts.getActiveTab,
    onCommitTab: (tab) => opts.switchTab(tab, { animate: false }),
  });
}
