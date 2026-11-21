import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import jsQR from 'jsqr';
import {
  parseCouponPayload,
  type CouponInput,
  type MealType,
} from './storage';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const PDF_WORKER_URL = pdfWorkerUrl;

export interface ParsedPdfCoupon extends CouponInput {
  page: number;
  rawPayload: string;
  dateISO: string;
  displayDate: string;
}

export interface PdfPageFailure {
  page: number;
  reason: string;
  rawQr?: string;
}

export interface PdfParseProgress {
  currentPage: number;
  totalPages: number;
  decodedCount: number;
  failedCount: number;
}

export interface PdfParseResult {
  totalPages: number;
  coupons: ParsedPdfCoupon[];
  failures: PdfPageFailure[];
}

const RENDER_SCALES = [2.0, 3.0, 1.5] as const;
const MAX_CANVAS_EDGE = 2600;

/**
 * Infers meal type from extracted PDF page text (case-insensitive).
 */
export function inferMealFromText(text: string): MealType {
  const upper = text.toUpperCase();

  if (/\bBREAKFAST\b/.test(upper)) return 'B';
  if (/\bLUNCH\b/.test(upper)) return 'L';
  if (/\bSNA(CK|K)S?\b/.test(upper)) return 'S';
  if (/\bDINNER\b/.test(upper)) return 'D';

  if (upper.includes('BREAKFAST')) return 'B';
  if (upper.includes('LUNCH')) return 'L';
  if (upper.includes('SNACK') || upper.includes('SNAK')) return 'S';
  if (upper.includes('DINNER')) return 'D';

  return 'U';
}

async function decodeQrFromPage(
  page: pdfjsLib.PDFPageProxy,
  canvas: HTMLCanvasElement
): Promise<string | null> {
  const baseViewport = page.getViewport({ scale: 1.0 });
  const maxBaseEdge = Math.max(baseViewport.width, baseViewport.height, 1);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context');
  }

  for (const desiredScale of RENDER_SCALES) {
    const clampedScale = Math.min(desiredScale, MAX_CANVAS_EDGE / maxBaseEdge);
    const viewport = page.getViewport({ scale: clampedScale });

    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const renderTask = page.render({
      canvas,
      viewport,
      background: '#ffffff',
    });
    await renderTask.promise;

    const imageData = ctx.getImageData(0, 0, width, height);
    const qr = jsQR(imageData.data, width, height, {
      inversionAttempts: 'attemptBoth',
    });

    if (qr && qr.data) {
      return qr.data;
    }
  }

  return null;
}

/**
 * Parses a multi-page PDF where each page contains a mess coupon QR code.
 * Extracts text to infer meal type (B/L/D/U), renders each page to canvas,
 * decodes QR via jsQR, and parses `"id`Nov 22, 2026"` payloads.
 */
export async function parseCouponsFromPDF(
  source: File | ArrayBuffer | Uint8Array,
  onProgress?: (progress: PdfParseProgress) => void
): Promise<PdfParseResult> {
  let bytes: Uint8Array;
  if (source instanceof Uint8Array) {
    bytes = source;
  } else if (source instanceof ArrayBuffer) {
    bytes = new Uint8Array(source);
  } else {
    const buffer = await source.arrayBuffer();
    bytes = new Uint8Array(buffer);
  }

  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;
  const coupons: ParsedPdfCoupon[] = [];
  const failures: PdfPageFailure[] = [];

  const canvas = document.createElement('canvas');

  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      let page: pdfjsLib.PDFPageProxy | null = null;
      try {
        page = await pdfDoc.getPage(pageNum);

        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
        const meal = inferMealFromText(pageText);

        const qrRaw = await decodeQrFromPage(page, canvas);
        if (!qrRaw) {
          failures.push({
            page: pageNum,
            reason: 'No QR code detected on page',
          });
        } else {
          const parsed = parseCouponPayload(qrRaw);
          if (!parsed) {
            failures.push({
              page: pageNum,
              reason: 'QR payload did not match expected "id`Mon DD, YYYY" format',
              rawQr: qrRaw,
            });
          } else {
            coupons.push({
              page: pageNum,
              epochDays: parsed.epochDays,
              meal,
              id: parsed.id,
              rawPayload: parsed.rawPayload,
              dateISO: parsed.dateISO,
              displayDate: parsed.displayDate,
            });
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unexpected error parsing page';
        failures.push({
          page: pageNum,
          reason: message,
        });
      } finally {
        if (page) {
          try {
            page.cleanup();
          } catch {
            // Ignore cleanup errors
          }
        }
      }

      onProgress?.({
        currentPage: pageNum,
        totalPages,
        decodedCount: coupons.length,
        failedCount: failures.length,
      });

      // Yield briefly to keep mobile UI responsive during large PDF imports
      if (pageNum % 2 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await pdfDoc.cleanup();
    await loadingTask.destroy();
  }

  return {
    totalPages,
    coupons,
    failures,
  };
}
