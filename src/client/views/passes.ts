import {
  MEAL_LABELS,
  deleteCoupon,
  epochDaysToDisplayDate,
  getAvailableDates,
  getCouponsForDate,
  getRelevantMealForTime,
  getTodayLocalISO,
  isoToEpochDays,
  shiftISODate,
  type Coupon,
} from '../../lib/storage';
import type { TabName } from '../types';
import {
  escapeHtml,
  findNearestDateWithPasses,
  formatReadableDate,
  renderQrSvg,
} from '../utils';
import { openConfirm } from '../ui/confirm-modal';
import { showToast } from '../ui/toast';

export interface PassesViewCallbacks {
  onNavigateTab: (tab: TabName) => void;
  onCouponsChanged: () => void;
}

const btnPrevDay = document.getElementById('btn-prev-day') as HTMLButtonElement;
const btnNextDay = document.getElementById('btn-next-day') as HTMLButtonElement;
const btnToday = document.getElementById('btn-today') as HTMLButtonElement;
const calendarTrigger = document.getElementById('calendar-trigger') as HTMLButtonElement;
const datePicker = document.getElementById('date-picker') as HTMLInputElement;
const dayReadableEl = document.getElementById('day-readable') as HTMLSpanElement;
const dayPassCountEl = document.getElementById('day-pass-count') as HTMLSpanElement;
const dateChipsBar = document.getElementById('date-chips-bar') as HTMLDivElement;
const passesStage = document.getElementById('passes-stage') as HTMLDivElement;
const passCarousel = document.getElementById('pass-carousel') as HTMLDivElement;
const carouselDots = document.getElementById('carousel-dots') as HTMLDivElement;
const passesEmpty = document.getElementById('passes-empty') as HTMLDivElement;
const emptyTitle = document.getElementById('empty-title') as HTMLHeadingElement;
const emptyJumpWrap = document.getElementById('empty-jump-wrap') as HTMLDivElement;
const btnJumpDate = document.getElementById('btn-jump-date') as HTMLButtonElement;
const btnEmptyImport = document.getElementById('btn-empty-import') as HTMLButtonElement;
const btnEmptyScan = document.getElementById('btn-empty-scan') as HTMLButtonElement;

let selectedDateISO: string = getTodayLocalISO();
let activePassIndex = 0;
let currentDayCoupons: Coupon[] = [];
let renderSequence = 0;
let scrollSyncRaf: number | null = null;
let callbacks: PassesViewCallbacks | null = null;

export function getSelectedDateISO(): string {
  return selectedDateISO;
}

export function setSelectedDateISO(iso: string, resetIndex = true): void {
  selectedDateISO = iso;
  if (resetIndex) activePassIndex = 0;
}

export function shiftSelectedDate(deltaDays: number): void {
  selectedDateISO = shiftISODate(selectedDateISO, deltaDays);
  activePassIndex = 0;
  void renderPassesForSelectedDate();
}

export function updateCarouselDotsVisibility(): void {
  const needsScroll = passCarousel.scrollWidth > passCarousel.clientWidth + 4;
  carouselDots.hidden = !needsScroll || currentDayCoupons.length <= 1;
}

function updateActiveDot(index: number): void {
  activePassIndex = index;
  const dots = carouselDots.querySelectorAll<HTMLButtonElement>('.carousel-dot');
  dots.forEach((dot, i) => {
    const active = i === index;
    dot.classList.toggle('is-active', active);
    dot.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function scrollToPass(index: number): void {
  const slides = passCarousel.querySelectorAll<HTMLElement>('.pass-slide');
  const target = slides[index];
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  updateActiveDot(index);
}

function renderDateChips(): void {
  const dates = getAvailableDates();
  if (dates.length === 0) {
    dateChipsBar.hidden = true;
    dateChipsBar.innerHTML = '';
    return;
  }

  const maxChips = 15;
  let start = 0;
  if (dates.length > maxChips) {
    let anchorIdx = dates.findIndex((d) => d >= selectedDateISO);
    if (anchorIdx === -1) anchorIdx = dates.length - 1;
    start = Math.max(
      0,
      Math.min(anchorIdx - Math.floor(maxChips / 2), dates.length - maxChips)
    );
  }
  const visibleDates = dates.slice(start, start + maxChips);

  dateChipsBar.hidden = false;
  dateChipsBar.innerHTML = '';

  for (const iso of visibleDates) {
    const epoch = isoToEpochDays(iso);
    if (epoch === null) continue;
    const display = epochDaysToDisplayDate(epoch).replace(/,\s*\d{4}$/, '');
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `date-chip${iso === selectedDateISO ? ' is-active' : ''}`;
    chip.textContent = display;
    chip.title = formatReadableDate(iso);
    chip.addEventListener('click', () => {
      selectedDateISO = iso;
      activePassIndex = 0;
      void renderPassesForSelectedDate();
    });
    dateChipsBar.appendChild(chip);
  }
}

export async function renderPassesForSelectedDate(
  options: { autoSelectRelevant?: boolean } = {}
): Promise<void> {
  const { autoSelectRelevant = true } = options;
  const seq = ++renderSequence;
  datePicker.value = selectedDateISO;

  const todayISO = getTodayLocalISO();
  const isToday = selectedDateISO === todayISO;
  btnToday.classList.toggle('is-today', isToday);

  dayReadableEl.textContent = formatReadableDate(selectedDateISO);
  currentDayCoupons = getCouponsForDate(selectedDateISO);

  const relevant = isToday
    ? getRelevantMealForTime()
    : { meal: null, status: 'none' as const, windowLabel: '' };
  const relevantIndex =
    relevant.meal !== null
      ? currentDayCoupons.findIndex((c) => c.meal === relevant.meal)
      : -1;

  if (isToday && relevant.meal !== null && relevantIndex !== -1) {
    const statusPrefix = relevant.status === 'active' ? 'Now' : 'Up next';
    dayPassCountEl.textContent = `${statusPrefix}: ${MEAL_LABELS[relevant.meal]} (${relevant.windowLabel})`;
  } else {
    dayPassCountEl.textContent = '';
  }

  callbacks?.onCouponsChanged();
  renderDateChips();

  if (currentDayCoupons.length === 0) {
    passesStage.hidden = true;
    passesEmpty.hidden = false;
    passCarousel.innerHTML = '';
    carouselDots.innerHTML = '';
    emptyTitle.textContent = `No passes for ${formatReadableDate(selectedDateISO)}`;

    const nearest = findNearestDateWithPasses(selectedDateISO);
    if (nearest) {
      emptyJumpWrap.hidden = false;
      btnJumpDate.dataset.targetDate = nearest;
      btnJumpDate.textContent = `Jump to ${formatReadableDate(nearest)}`;
    } else {
      emptyJumpWrap.hidden = true;
    }
    return;
  }

  passesEmpty.hidden = true;
  passesStage.hidden = false;

  const svgs = await Promise.all(
    currentDayCoupons.map((c) => renderQrSvg(c.rawPayload))
  );
  if (seq !== renderSequence) return;

  passCarousel.innerHTML = '';
  carouselDots.innerHTML = '';

  const hasRelevantMatch = relevantIndex !== -1;

  currentDayCoupons.forEach((coupon, index) => {
    const slide = document.createElement('article');
    slide.className = 'pass-slide';
    slide.dataset.index = String(index);

    const isRelevantCard = index === relevantIndex;
    const cardStateClass = hasRelevantMatch
      ? isRelevantCard
        ? `is-relevant is-${relevant.status}`
        : 'is-dimmed'
      : '';

    const statusPillHtml = isRelevantCard
      ? `<span class="relevance-pill relevance-${relevant.status}">${
          relevant.status === 'active' ? 'Now' : 'Next'
        }</span>`
      : '';

    const rollHtml = coupon.rollNo
      ? `<span class="pass-meta-value">${escapeHtml(coupon.rollNo)}</span>`
      : `<span class="pass-meta-value pass-meta-unknown">Unknown</span>`;
    const messClass =
      coupon.mess.length > 18
        ? 'pass-meta-value pass-meta-mess is-long'
        : 'pass-meta-value pass-meta-mess';
    const messHtml = coupon.mess
      ? `<span class="${messClass}">${escapeHtml(coupon.mess)}</span>`
      : `<span class="pass-meta-value pass-meta-unknown">Unknown</span>`;

    const mealClass = `meal-badge meal-${coupon.meal.toLowerCase()}`;
    slide.innerHTML = `
      <div class="pass-card ${cardStateClass}" data-index="${index}">
        <div class="pass-card-top">
          <div class="pass-card-badges">
            <span class="${mealClass}">${MEAL_LABELS[coupon.meal]}</span>
            ${statusPillHtml}
          </div>
          <button
            type="button"
            class="delete-coupon-btn"
            data-epoch="${coupon.epochDays}"
            data-id="${escapeHtml(coupon.id)}"
            aria-label="Delete ${MEAL_LABELS[coupon.meal]} pass ${escapeHtml(coupon.id)}"
            title="Delete pass"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
            </svg>
          </button>
        </div>

        <div class="qr-frame" aria-label="QR code for ${escapeHtml(coupon.rawPayload)}">
          <div class="qr-svg-host">${svgs[index]}</div>
        </div>

        <div class="pass-card-footer">
          <div class="pass-meta-row">
            <span class="pass-meta-label">Roll No</span>
            ${rollHtml}
          </div>
          <div class="pass-meta-row">
            <span class="pass-meta-label">Mess</span>
            ${messHtml}
          </div>
        </div>
      </div>
    `;

    passCarousel.appendChild(slide);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `carousel-dot${isRelevantCard ? ' is-relevant-dot' : ''}`;
    dot.setAttribute('role', 'tab');
    dot.setAttribute(
      'aria-label',
      `${MEAL_LABELS[coupon.meal]} pass (${index + 1} of ${currentDayCoupons.length})`
    );
    dot.dataset.index = String(index);
    dot.addEventListener('click', () => scrollToPass(index));
    carouselDots.appendChild(dot);
  });

  if (autoSelectRelevant && hasRelevantMatch) {
    activePassIndex = relevantIndex;
  } else {
    activePassIndex = Math.min(activePassIndex, currentDayCoupons.length - 1);
  }

  updateActiveDot(activePassIndex);
  requestAnimationFrame(() => {
    passCarousel.querySelectorAll<HTMLElement>('.pass-meta-mess').forEach((el) => {
      el.style.width = '';
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects());
      if (rects.length > 1) {
        const maxLine = Math.max(...rects.map((r) => r.width));
        const cs = getComputedStyle(el);
        const pad =
          parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        el.style.width = `${Math.ceil(maxLine + pad) + 1}px`;
      }
    });

    const slides = passCarousel.querySelectorAll<HTMLElement>('.pass-slide');
    const targetSlide = slides[activePassIndex];
    if (targetSlide && passCarousel.scrollWidth > passCarousel.clientWidth + 4) {
      passCarousel.scrollTo({
        left: targetSlide.offsetLeft,
        behavior: 'auto',
      });
    }
    updateCarouselDotsVisibility();
  });
}

export function initPassesView(opts: PassesViewCallbacks): void {
  callbacks = opts;

  passCarousel.addEventListener('scroll', () => {
    if (scrollSyncRaf !== null) return;
    scrollSyncRaf = requestAnimationFrame(() => {
      scrollSyncRaf = null;
      const slides = passCarousel.querySelectorAll<HTMLElement>('.pass-slide');
      const step =
        slides.length > 1
          ? slides[1].offsetLeft - slides[0].offsetLeft
          : passCarousel.clientWidth;
      if (step <= 0) return;
      const idx = Math.round(passCarousel.scrollLeft / step);
      const clamped = Math.max(
        0,
        Math.min(idx, Math.max(0, currentDayCoupons.length - 1))
      );
      if (clamped !== activePassIndex) {
        updateActiveDot(clamped);
      }
    });
  });

  passCarousel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('.delete-coupon-btn');
    if (!btn) return;
    const epoch = Number(btn.dataset.epoch);
    const id = btn.dataset.id ?? '';
    if (!Number.isSafeInteger(epoch) || !id) return;

    openConfirm(
      'Delete Coupon?',
      `Remove coupon ${id} for ${epochDaysToDisplayDate(epoch)}?`,
      'Delete',
      () => {
        if (deleteCoupon(epoch, id)) {
          showToast('Coupon deleted', 'info');
          void renderPassesForSelectedDate();
        }
      }
    );
  });

  btnPrevDay.addEventListener('click', () => shiftSelectedDate(-1));
  btnNextDay.addEventListener('click', () => shiftSelectedDate(1));

  btnToday.addEventListener('click', () => {
    selectedDateISO = getTodayLocalISO();
    activePassIndex = 0;
    void renderPassesForSelectedDate({ autoSelectRelevant: true });
  });

  calendarTrigger.addEventListener('click', () => {
    try {
      if (typeof datePicker.showPicker === 'function') {
        datePicker.showPicker();
        return;
      }
    } catch {
      // Fallback below for browsers restricting showPicker
    }
    datePicker.focus();
    datePicker.click();
  });

  datePicker.addEventListener('change', () => {
    if (datePicker.value) {
      selectedDateISO = datePicker.value;
      activePassIndex = 0;
      void renderPassesForSelectedDate();
    }
  });

  btnJumpDate.addEventListener('click', () => {
    const target = btnJumpDate.dataset.targetDate;
    if (target) {
      selectedDateISO = target;
      activePassIndex = 0;
      void renderPassesForSelectedDate();
    }
  });

  btnEmptyImport.addEventListener('click', () => callbacks?.onNavigateTab('manage'));
  btnEmptyScan.addEventListener('click', () => callbacks?.onNavigateTab('scan'));

  window.addEventListener('resize', updateCarouselDotsVisibility);
}
