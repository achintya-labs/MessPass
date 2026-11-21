import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import jsQR from 'jsqr';
import {
  parseCouponPayload,
  sanitizeMetaField,
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

const DISCLAIMER_PATTERN = /\b(return|refund|eligible)\b/i;
const STOP_LINE_PATTERN = /^(s\.?\s*no\b|authority\s+sign\b)/i;
const HEADER_OR_DATE_PATTERN =
  /^(office\s+of\b|iit\b|guest\s+coupon\b|mess\s+coupon\b|[a-z]{3,9}\s+\d{1,2}\s*,\s*\d{4}$)/i;

interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
}

export function extractLinesFromTextItems(
  items: ReadonlyArray<{ str?: string; transform?: number[] }>
): string[] {
  const positioned: PositionedTextItem[] = [];
  for (const item of items) {
    const str = typeof item.str === 'string' ? item.str.trim() : '';
    if (!str) continue;
    const tr = Array.isArray(item.transform) ? item.transform : [];
    const x = typeof tr[4] === 'number' ? tr[4] : 0;
    const y = typeof tr[5] === 'number' ? tr[5] : 0;
    positioned.push({ str, x, y });
  }

  positioned.sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 4) return yDiff;
    return a.x - b.x;
  });

  const lines: Array<{ y: number; parts: string[] }> = [];
  for (const item of positioned) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= 4) {
      last.parts.push(item.str);
    } else {
      lines.push({ y: item.y, parts: [item.str] });
    }
  }

  return lines.map((l) => l.parts.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * Extracts roll number and mess name from coupon PDF lines:
 * - Line before meal name -> roll number
 * - Meal name line -> meal type
 * - Disclaimer line -> skipped
 * - Next up to 2 lines (before S.No / Authority Sign) -> mess name
 */
export function extractCouponMetadataFromLines(lines: readonly string[]): {
  rollNo: string;
  mess: string;
} {
  const mealIdx = lines.findIndex((line) => inferMealFromText(line) !== 'U');
  if (mealIdx === -1) {
    return { rollNo: '', mess: '' };
  }

  let rollNo = '';
  if (mealIdx > 0) {
    const candidate = lines[mealIdx - 1];
    if (!HEADER_OR_DATE_PATTERN.test(candidate)) {
      rollNo = sanitizeMetaField(candidate);
    }
  }

  let cursor = mealIdx + 1;
  if (cursor < lines.length) {
    const nextLine = lines[cursor];
    if (DISCLAIMER_PATTERN.test(nextLine) || /^\(.*\)$/.test(nextLine)) {
      cursor++;
    }
  }

  const messParts: string[] = [];
  while (cursor < lines.length && messParts.length < 2) {
    const line = lines[cursor];
    if (STOP_LINE_PATTERN.test(line)) break;
    messParts.push(sanitizeMetaField(line));
    cursor++;
  }

  return {
    rollNo,
    mess: messParts.filter(Boolean).join(' · '),
  };
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
        const typedItems = textContent.items as ReadonlyArray<{
          str?: string;
          transform?: number[];
        }>;
        const pageText = typedItems
          .map((item) => (typeof item.str === 'string' ? item.str : ''))
          .join(' ');
        const meal = inferMealFromText(pageText);
        const lines = extractLinesFromTextItems(typedItems);
        const { rollNo, mess } = extractCouponMetadataFromLines(lines);

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
              rollNo,
              mess,
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
