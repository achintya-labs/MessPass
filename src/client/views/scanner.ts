import { Capacitor } from '@capacitor/core';
import jsQR from 'jsqr';
import {
  MEAL_LABELS,
  decompressTransferData,
  mergeCoupons,
  parseCouponPayload,
  parseTransferChunk,
  type MealType,
} from '../../lib/storage';
import type { ScanFeedbackType, ScanMealOption } from '../types';
import { showToast } from '../ui/toast';

export interface ScannerViewCallbacks {
  isScanTabActive: () => boolean;
  onCouponsChanged: () => void;
}

const btnToggleCamera = document.getElementById('btn-toggle-camera') as HTMLButtonElement;
const scanMealButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('#scan-meal-group .seg-btn')
);
const scannerVideo = document.getElementById('scanner-video') as HTMLVideoElement;
const scannerCanvas = document.getElementById('scanner-canvas') as HTMLCanvasElement;
const cameraPlaceholder = document.getElementById('camera-placeholder') as HTMLDivElement;
const cameraStatusText = document.getElementById('camera-status-text') as HTMLParagraphElement;
const scanFeedback = document.getElementById('scan-feedback') as HTMLDivElement;
const transferRxCard = document.getElementById('transfer-rx-card') as HTMLDivElement;
const transferRxCount = document.getElementById('transfer-rx-count') as HTMLDivElement;
const transferRxPills = document.getElementById('transfer-rx-pills') as HTMLDivElement;
const btnResetRx = document.getElementById('btn-reset-rx') as HTMLButtonElement;

let scanMealOption: ScanMealOption = 'AUTO';
let cameraStream: MediaStream | null = null;
let scanRafId: number | null = null;
let lastScannedRaw = '';
let lastScannedTime = 0;
let rxSession: { total: number; parts: Map<number, string> } | null = null;
let callbacks: ScannerViewCallbacks | null = null;

function setScanFeedback(message: string, type: ScanFeedbackType): void {
  scanFeedback.textContent = message;
  scanFeedback.className = `feedback-banner feedback-${type}`;
  scanFeedback.hidden = false;
}

function renderRxProgress(): void {
  if (!rxSession) {
    transferRxCard.hidden = true;
    return;
  }
  transferRxCard.hidden = false;
  transferRxCount.textContent = `${rxSession.parts.size} / ${rxSession.total} chunks scanned`;
  transferRxPills.innerHTML = '';

  for (let i = 1; i <= rxSession.total; i++) {
    const pill = document.createElement('span');
    pill.className = `chunk-pill ${rxSession.parts.has(i) ? 'is-done' : ''}`;
    pill.textContent = String(i);
    transferRxPills.appendChild(pill);
  }
}

function handleScannedPayload(raw: string): void {
  const now = Date.now();
  if (raw === lastScannedRaw && now - lastScannedTime < 2200) {
    return;
  }
  lastScannedRaw = raw;
  lastScannedTime = now;

  const chunk = parseTransferChunk(raw);
  if (chunk) {
    if (!rxSession || rxSession.total !== chunk.total) {
      rxSession = { total: chunk.total, parts: new Map() };
    }
    const alreadyHad = rxSession.parts.has(chunk.part);
    rxSession.parts.set(chunk.part, chunk.data);
    renderRxProgress();

    if (rxSession.parts.size === rxSession.total) {
      let joined = '';
      for (let i = 1; i <= rxSession.total; i++) {
        joined += rxSession.parts.get(i) ?? '';
      }
      const decodedCoupons = decompressTransferData(joined);
      if (!decodedCoupons) {
        setScanFeedback(
          'Transfer chunks could not be decompressed. Please reset and scan again.',
          'error'
        );
        return;
      }
      const stats = mergeCoupons(decodedCoupons);
      rxSession = null;
      renderRxProgress();
      callbacks?.onCouponsChanged();
      const msg = `Transfer complete: ${stats.added} added, ${stats.updated} updated, ${stats.duplicates} already saved.`;
      setScanFeedback(msg, 'success');
      showToast(`Imported ${stats.added + stats.updated} passes`, 'success');
    } else {
      setScanFeedback(
        alreadyHad
          ? `Chunk ${chunk.part}/${chunk.total} already scanned — show next QR.`
          : `Scanned chunk ${chunk.part}/${chunk.total} (${rxSession.parts.size}/${chunk.total} collected).`,
        'info'
      );
    }
    return;
  }

  const parsed = parseCouponPayload(raw);
  if (!parsed) {
    setScanFeedback(
      'Unrecognized QR code. Expected mess coupon ("id`Mon DD, YYYY") or MC1 transfer QR.',
      'error'
    );
    return;
  }

  const meal: MealType = scanMealOption === 'AUTO' ? 'U' : scanMealOption;
  const stats = mergeCoupons(
    [{ epochDays: parsed.epochDays, meal, id: parsed.id }],
    { overwriteKnownMeal: scanMealOption !== 'AUTO' }
  );
  callbacks?.onCouponsChanged();

  if (stats.added > 0) {
    setScanFeedback(
      `Saved ${MEAL_LABELS[meal]} pass · ${parsed.displayDate} (${parsed.id})`,
      'success'
    );
    showToast(`Added pass for ${parsed.displayDate}`, 'success');
  } else if (stats.updated > 0) {
    setScanFeedback(
      `Updated meal to ${MEAL_LABELS[meal]} · ${parsed.displayDate} (${parsed.id})`,
      'success'
    );
    showToast('Updated pass meal tag', 'success');
  } else {
    setScanFeedback(
      `Pass already saved · ${parsed.displayDate} (${parsed.id})`,
      'info'
    );
  }
}

const SCAN_INTERVAL_MS = 140;
const MAX_SCAN_WIDTH = 640;
let lastDecodeTime = 0;

function scanFrameLoop(now: number): void {
  if (!cameraStream) return;

  if (
    now - lastDecodeTime >= SCAN_INTERVAL_MS &&
    scannerVideo.readyState === scannerVideo.HAVE_ENOUGH_DATA &&
    scannerVideo.videoWidth > 0 &&
    scannerVideo.videoHeight > 0
  ) {
    lastDecodeTime = now;
    const ctx = scannerCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    if (ctx) {
      const vw = scannerVideo.videoWidth;
      const vh = scannerVideo.videoHeight;
      const scale = vw > MAX_SCAN_WIDTH ? MAX_SCAN_WIDTH / vw : 1;
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);
      if (scannerCanvas.width !== w || scannerCanvas.height !== h) {
        scannerCanvas.width = w;
        scannerCanvas.height = h;
      }
      ctx.drawImage(scannerVideo, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const qr = jsQR(imageData.data, w, h, {
        inversionAttempts: 'attemptBoth',
      });
      if (qr && qr.data) {
        handleScannedPayload(qr.data);
      }
    }
  }

  scanRafId = requestAnimationFrame(scanFrameLoop);
}

export async function startCamera(): Promise<void> {
  if (cameraStream) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraPlaceholder.hidden = false;
    cameraStatusText.textContent =
      'Camera API unavailable. Ensure HTTPS or localhost context.';
    btnToggleCamera.textContent = 'Start Camera';
    return;
  }

  cameraPlaceholder.hidden = false;
  cameraStatusText.textContent = 'Starting camera...';
  btnToggleCamera.disabled = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    if (!callbacks?.isScanTabActive()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    cameraStream = stream;
    scannerVideo.srcObject = stream;
    await scannerVideo.play();
    scannerVideo.hidden = false;
    cameraPlaceholder.hidden = true;
    btnToggleCamera.textContent = 'Stop Camera';
    scanRafId = requestAnimationFrame(scanFrameLoop);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Camera permission denied';
    cameraPlaceholder.hidden = false;
    cameraStatusText.textContent = `Unable to access camera: ${msg}`;
    btnToggleCamera.textContent = 'Start Camera';
  } finally {
    btnToggleCamera.disabled = false;
  }
}

export function stopCamera(): void {
  if (scanRafId !== null) {
    cancelAnimationFrame(scanRafId);
    scanRafId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  scannerVideo.srcObject = null;
  if (Capacitor.isNativePlatform()) {
    scannerVideo.hidden = true;
  }
  cameraPlaceholder.hidden = false;
  cameraStatusText.textContent = 'Camera paused. Tap "Start Camera" to scan.';
  btnToggleCamera.textContent = 'Start Camera';
}

export function initScannerView(opts: ScannerViewCallbacks): void {
  callbacks = opts;
  if (Capacitor.isNativePlatform()) {
    scannerVideo.hidden = true;
  }

  btnResetRx.addEventListener('click', () => {
    rxSession = null;
    renderRxProgress();
    setScanFeedback('Transfer buffer cleared', 'info');
  });

  scanMealButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const meal = btn.dataset.meal as ScanMealOption | undefined;
      if (!meal) return;
      scanMealOption = meal;
      scanMealButtons.forEach((b) => {
        const selected = b === btn;
        b.classList.toggle('is-selected', selected);
        b.setAttribute('aria-checked', selected ? 'true' : 'false');
      });
    });
  });

  btnToggleCamera.addEventListener('click', () => {
    if (cameraStream) {
      stopCamera();
    } else {
      void startCamera();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && cameraStream) {
      stopCamera();
    }
  });
}
