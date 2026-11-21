import type { TabName } from '../types';
import { isConfirmOpen } from './confirm-modal';
import { isTransferModalOpen } from '../views/manage';

export interface SwipeTabsOptions {
  tabOrder: readonly TabName[];
  viewsByTab: Record<TabName, HTMLElement>;
  getActiveTab: () => TabName;
  onCommitTab: (tab: TabName) => void;
}

const TRANSITION_CSS = 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)';
const SETTLE_MS = 210;

function resetViewStyles(el: HTMLElement, hide: boolean): void {
  el.style.transform = '';
  el.style.transition = '';
  el.style.position = '';
  el.style.top = '';
  el.style.left = '';
  el.style.right = '';
  el.style.pointerEvents = '';
  el.style.willChange = '';
  if (hide) {
    el.hidden = true;
  }
}

export function initSwipeTabs(options: SwipeTabsOptions): void {
  const mainContent = document.querySelector('.main-content') as HTMLElement | null;
  if (!mainContent) return;

  const { tabOrder, viewsByTab, getActiveTab, onCommitTab } = options;

  let touchStartX = 0;
  let touchStartY = 0;
  let lastDx = 0;
  let cachedWidth = 0;
  let dragAxis: 'none' | 'horizontal' | 'vertical' = 'none';
  let ignoreSwipe = false;
  let isSettling = false;
  let neighborTab: TabName | null = null;
  let pendingRaf: number | null = null;

  const prepareNeighbor = (nextTab: TabName | null): void => {
    if (neighborTab === nextTab) return;
    if (neighborTab) {
      resetViewStyles(viewsByTab[neighborTab], neighborTab !== getActiveTab());
    }
    neighborTab = nextTab;
    if (!neighborTab) return;

    const el = viewsByTab[neighborTab];
    el.hidden = false;
    el.style.position = 'absolute';
    el.style.top = '12px';
    el.style.left = '14px';
    el.style.right = '14px';
    el.style.pointerEvents = 'none';
    el.style.transition = 'none';
    el.style.willChange = 'transform';
  };

  const applyDragFrame = (): void => {
    pendingRaf = null;
    if (dragAxis !== 'horizontal') return;

    const dx = lastDx;
    const activeTab = getActiveTab();
    const idx = tabOrder.indexOf(activeTab);
    const targetTab =
      dx < 0 && idx < tabOrder.length - 1
        ? tabOrder[idx + 1]
        : dx > 0 && idx > 0
          ? tabOrder[idx - 1]
          : null;

    prepareNeighbor(targetTab);

    const currentView = viewsByTab[activeTab];
    if (!targetTab) {
      const damped = Math.max(-48, Math.min(48, dx * 0.22));
      currentView.style.transform = `translate3d(${damped}px, 0, 0)`;
      return;
    }

    currentView.style.transform = `translate3d(${dx}px, 0, 0)`;
    const neighborView = viewsByTab[targetTab];
    const offset = dx < 0 ? cachedWidth + dx : -cachedWidth + dx;
    neighborView.style.transform = `translate3d(${offset}px, 0, 0)`;
  };

  document.addEventListener(
    'touchstart',
    (e) => {
      if (isSettling || e.touches.length !== 1 || isConfirmOpen() || isTransferModalOpen()) {
        ignoreSwipe = true;
        return;
      }
      const target = e.target as HTMLElement | null;
      const carousel = target?.closest<HTMLElement>('.pass-carousel');
      const inScrollableCarousel =
        Boolean(carousel) &&
        carousel!.scrollWidth > carousel!.clientWidth + 4;
      const inScrollableChips = Boolean(target?.closest('.date-chips-bar'));

      ignoreSwipe = inScrollableCarousel || inScrollableChips;
      dragAxis = 'none';
      lastDx = 0;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (ignoreSwipe || isSettling || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;

      if (dragAxis === 'none') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          dragAxis = 'vertical';
          return;
        }
        dragAxis = 'horizontal';
        cachedWidth = mainContent.clientWidth || window.innerWidth;
        mainContent.classList.add('is-swiping');
        const currentView = viewsByTab[getActiveTab()];
        currentView.style.transition = 'none';
        currentView.style.willChange = 'transform';
      }

      if (dragAxis !== 'horizontal') return;
      lastDx = dx;
      if (pendingRaf === null) {
        pendingRaf = requestAnimationFrame(applyDragFrame);
      }
    },
    { passive: true }
  );

  const finishSwipe = (): void => {
    if (pendingRaf !== null) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = null;
    }
    if (ignoreSwipe || dragAxis !== 'horizontal') {
      dragAxis = 'none';
      return;
    }
    dragAxis = 'none';
    isSettling = true;

    const activeTab = getActiveTab();
    const width = cachedWidth || mainContent.clientWidth || window.innerWidth;
    const threshold = Math.min(90, width * 0.24);
    const committedTab =
      neighborTab && Math.abs(lastDx) >= threshold ? neighborTab : null;

    const currentView = viewsByTab[activeTab];
    currentView.style.transition = TRANSITION_CSS;

    if (committedTab) {
      const targetView = viewsByTab[committedTab];
      targetView.style.transition = TRANSITION_CSS;
      currentView.style.transform = `translate3d(${lastDx < 0 ? -width : width}px, 0, 0)`;
      targetView.style.transform = 'translate3d(0, 0, 0)';

      window.setTimeout(() => {
        resetViewStyles(currentView, true);
        resetViewStyles(targetView, false);
        mainContent.classList.remove('is-swiping');
        neighborTab = null;
        isSettling = false;
        onCommitTab(committedTab);
      }, SETTLE_MS);
      return;
    }

    currentView.style.transform = 'translate3d(0, 0, 0)';
    const prevNeighbor = neighborTab ? viewsByTab[neighborTab] : null;
    if (prevNeighbor) {
      prevNeighbor.style.transition = TRANSITION_CSS;
      prevNeighbor.style.transform = `translate3d(${lastDx < 0 ? width : -width}px, 0, 0)`;
    }

    window.setTimeout(() => {
      resetViewStyles(currentView, false);
      if (prevNeighbor) {
        resetViewStyles(prevNeighbor, true);
      }
      mainContent.classList.remove('is-swiping');
      neighborTab = null;
      isSettling = false;
    }, SETTLE_MS);
  };

  document.addEventListener('touchend', finishSwipe, { passive: true });
  document.addEventListener('touchcancel', finishSwipe, { passive: true });
}
