import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {
  extractCouponMetadataFromLines,
  inferMealFromText,
  parseCouponsFromPDF,
  type PdfParseProgress,
} from '../src/lib/pdf-parser.ts';
import {
  getCouponsForDate,
  mergeCoupons,
} from '../src/lib/storage.ts';

function installMockLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    },
  });
}

class MinimalPath2D {
  rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  private pts: Array<{ x: number; y: number }> = [];

  rect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h });
  }

  moveTo(x: number, y: number): void {
    this.pts = [{ x, y }];
  }

  lineTo(x: number, y: number): void {
    this.pts.push({ x, y });
  }

  closePath(): void {
    if (this.pts.length >= 3) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of this.pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (maxX > minX && maxY > minY) {
        this.rects.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
      }
    }
    this.pts = [];
  }

  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  addPath(other: MinimalPath2D): void {
    if (other && Array.isArray(other.rects)) {
      this.rects.push(...other.rects);
    }
  }
}

/**
 * Minimal pure-JS RGBA Canvas + 2D Context polyfill supporting affine transforms
 * and Path2D filled rectangles, enabling real `pdfjs-dist` vector QR rendering in Node.
 */
class MinimalCanvasContext2D {
  canvas: MinimalCanvas;
  private buffer: Uint8ClampedArray;
  private matrix: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  private stack: Array<{
    matrix: [number, number, number, number, number, number];
    fillStyle: string;
  }> = [];
  private pathRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  private currentPathPts: Array<{ x: number; y: number }> = [];

  fillStyle: string | object = '#000000';
  strokeStyle: string | object = '#000000';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  miterLimit = 10;
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  imageSmoothingEnabled = true;

  constructor(canvas: MinimalCanvas) {
    this.canvas = canvas;
    this.buffer = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  resize(width: number, height: number): void {
    this.buffer = new Uint8ClampedArray(Math.max(0, width * height * 4));
    this.matrix = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.pathRects = [];
    this.currentPathPts = [];
  }

  private parseColor(style: string | object): [number, number, number, number] {
    if (typeof style !== 'string') return [0, 0, 0, 255];
    const s = style.trim().toLowerCase();
    if (s === '#fff' || s === '#ffffff' || s === 'white') return [255, 255, 255, 255];
    if (s === '#000' || s === '#000000' || s === 'black') return [0, 0, 0, 255];
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(s);
    if (hex) {
      return [
        parseInt(hex[1], 16),
        parseInt(hex[2], 16),
        parseInt(hex[3], 16),
        255,
      ];
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
    if (rgb) {
      return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), 255];
    }
    return [0, 0, 0, 255];
  }

  private applyMatrix(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.matrix;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  private paintDeviceRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    rgba: [number, number, number, number]
  ): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
    const maxX = Math.min(w, Math.ceil(Math.max(x0, x1)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
    const maxY = Math.min(h, Math.ceil(Math.max(y0, y1)));

    const [r, g, b, a] = rgba;
    for (let y = minY; y < maxY; y++) {
      let rowOffset = (y * w + minX) * 4;
      for (let x = minX; x < maxX; x++) {
        this.buffer[rowOffset] = r;
        this.buffer[rowOffset + 1] = g;
        this.buffer[rowOffset + 2] = b;
        this.buffer[rowOffset + 3] = a;
        rowOffset += 4;
      }
    }
  }

  save(): void {
    this.stack.push({
      matrix: [...this.matrix] as [number, number, number, number, number, number],
      fillStyle: typeof this.fillStyle === 'string' ? this.fillStyle : '#000000',
    });
  }

  restore(): void {
    const top = this.stack.pop();
    if (top) {
      this.matrix = top.matrix;
      this.fillStyle = top.fillStyle;
    }
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const [ma, mb, mc, md, me, mf] = this.matrix;
    this.matrix = [
      ma * a + mc * b,
      mb * a + md * b,
      ma * c + mc * d,
      mb * c + md * d,
      ma * e + mc * f + me,
      mb * e + md * f + mf,
    ];
  }

  setTransform(
    a: number | DOMMatrix2DInit,
    b?: number,
    c?: number,
    d?: number,
    e?: number,
    f?: number
  ): void {
    if (typeof a === 'object' && a !== null) {
      this.matrix = [
        a.a ?? 1,
        a.b ?? 0,
        a.c ?? 0,
        a.d ?? 1,
        a.e ?? 0,
        a.f ?? 0,
      ];
    } else {
      this.matrix = [a, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0];
    }
  }

  scale(sx: number, sy: number): void {
    this.transform(sx, 0, 0, sy, 0, 0);
  }

  translate(tx: number, ty: number): void {
    this.transform(1, 0, 0, 1, tx, ty);
  }

  beginPath(): void {
    this.pathRects = [];
    this.currentPathPts = [];
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.pathRects.push({ x, y, w, h });
  }

  moveTo(x: number, y: number): void {
    this.currentPathPts.push({ x, y });
  }

  lineTo(x: number, y: number): void {
    this.currentPathPts.push({ x, y });
  }

  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  closePath(): void {}
  clip(): void {}
  stroke(): void {}
  setLineDash(): void {}
  fillText(): void {}
  strokeText(): void {}
  drawImage(): void {}
  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const rgba = this.parseColor(this.fillStyle);
    const [x0, y0] = this.applyMatrix(x, y);
    const [x1, y1] = this.applyMatrix(x + w, y + h);
    this.paintDeviceRect(x0, y0, x1, y1, rgba);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const [x0, y0] = this.applyMatrix(x, y);
    const [x1, y1] = this.applyMatrix(x + w, y + h);
    this.paintDeviceRect(x0, y0, x1, y1, [255, 255, 255, 255]);
  }

  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.matrix;
    return { a, b, c, d, e, f };
  }

  fill(pathOrRule?: unknown): void {
    const rgba = this.parseColor(this.fillStyle);
    const rectsToPaint =
      pathOrRule instanceof MinimalPath2D ? pathOrRule.rects : this.pathRects;

    for (const r of rectsToPaint) {
      const [x0, y0] = this.applyMatrix(r.x, r.y);
      const [x1, y1] = this.applyMatrix(r.x + r.w, r.y + r.h);
      this.paintDeviceRect(x0, y0, x1, y1, rgba);
    }
    if (!(pathOrRule instanceof MinimalPath2D) && this.currentPathPts.length >= 3) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const pt of this.currentPathPts) {
        const [px, py] = this.applyMatrix(pt.x, pt.y);
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      if (Number.isFinite(minX)) {
        this.paintDeviceRect(minX, minY, maxX, maxY, rgba);
      }
    }
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  } {
    if (sx === 0 && sy === 0 && sw === this.canvas.width && sh === this.canvas.height) {
      return {
        data: new Uint8ClampedArray(this.buffer),
        width: sw,
        height: sh,
      };
    }
    const out = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const srcIdx = ((sy + y) * this.canvas.width + (sx + x)) * 4;
        const dstIdx = (y * sw + x) * 4;
        out[dstIdx] = this.buffer[srcIdx];
        out[dstIdx + 1] = this.buffer[srcIdx + 1];
        out[dstIdx + 2] = this.buffer[srcIdx + 2];
        out[dstIdx + 3] = this.buffer[srcIdx + 3];
      }
    }
    return { data: out, width: sw, height: sh };
  }
}

class MinimalCanvas {
  private _width = 1;
  private _height = 1;
  private ctx: MinimalCanvasContext2D | null = null;

  get width(): number {
    return this._width;
  }
  set width(val: number) {
    this._width = val;
    this.ctx?.resize(this._width, this._height);
  }

  get height(): number {
    return this._height;
  }
  set height(val: number) {
    this._height = val;
    this.ctx?.resize(this._width, this._height);
  }

  getContext(type: string): MinimalCanvasContext2D | null {
    if (type !== '2d') return null;
    if (!this.ctx) {
      this.ctx = new MinimalCanvasContext2D(this);
    }
    return this.ctx;
  }
}

interface SyntheticPdfPage {
  text: string;
  qrPayload?: string;
}

/**
 * Generates a valid multi-page PDF 1.4 binary with real text streams and
 * vector-drawn QR codes (using PDF `re f` rectangle ops) for end-to-end testing.
 */
function buildSyntheticCouponPdf(pages: SyntheticPdfPage[]): Uint8Array {
  const pageWidth = 300;
  const pageHeight = 400;

  const objects: string[] = [];
  // Obj 1: Catalog
  // Obj 2: Pages
  // Obj 3: Standard Helvetica Font
  const pageObjNums: number[] = [];
  const firstPageObj = 4;

  for (let i = 0; i < pages.length; i++) {
    pageObjNums.push(firstPageObj + i * 2);
  }

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums
      .map((n) => `${n} 0 R`)
      .join(' ')}] /Count ${pages.length} >>\nendobj\n`
  );
  objects.push(
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`
  );

  for (let i = 0; i < pages.length; i++) {
    const pageObjNum = firstPageObj + i * 2;
    const contentObjNum = pageObjNum + 1;
    const spec = pages[i];

    const escapedText = spec.text
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

    const ops: string[] = [];
    // White page background
    ops.push(`1 1 1 rg 0 0 ${pageWidth} ${pageHeight} re f`);
    // Meal / header text
    ops.push(`0 0 0 rg BT /F1 16 Tf 30 355 Td (${escapedText}) Tj ET`);

    if (spec.qrPayload) {
      const qr = QRCode.create(spec.qrPayload, { errorCorrectionLevel: 'M' });
      const size = qr.modules.size;
      const qrDrawSize = 180;
      const mod = qrDrawSize / size;
      const originX = (pageWidth - qrDrawSize) / 2;
      const originY = 90;

      ops.push('0 0 0 rg');
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (!qr.modules.get(row, col)) continue;
          const x = (originX + col * mod).toFixed(3);
          // Flip Y because PDF coordinates start at bottom-left
          const y = (originY + (size - 1 - row) * mod).toFixed(3);
          const s = mod.toFixed(3);
          ops.push(`${x} ${y} ${s} ${s} re f`);
        }
      }
    }

    const stream = ops.join('\n') + '\n';
    const streamBytes = Buffer.byteLength(stream, 'utf8');

    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${streamBytes} >>\nstream\n${stream}endstream\nendobj\n`
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'utf8'));
}

describe('PDF Meal Inference', () => {
  it('detects BREAKFAST, LUNCH, SNACKS/SNAKS, DINNER case-insensitively and falls back to U', () => {
    assert.equal(inferMealFromText('MESS COUPON - BREAKFAST - Nov 22, 2026'), 'B');
    assert.equal(inferMealFromText('daily breakfast pass'), 'B');
    assert.equal(inferMealFromText('Student Lunch Token'), 'L');
    assert.equal(inferMealFromText('Evening SNACKS Pass'), 'S');
    assert.equal(inferMealFromText('Evening SNAKS Pass'), 'S');
    assert.equal(inferMealFromText('HOSTEL DINNER COUPON'), 'D');
    assert.equal(inferMealFromText('MealType:LUNCH'), 'L');
    assert.equal(inferMealFromText('General Mess Pass Nov 22, 2026'), 'U');
    assert.equal(inferMealFromText(''), 'U');
  });
});

describe('End-to-End Multi-Page PDF Parsing (pdfjs-dist + jsQR)', () => {
  beforeEach(() => {
    installMockLocalStorage();
    Object.defineProperty(globalThis, 'Path2D', {
      configurable: true,
      value: MinimalPath2D,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: (tag: string) => {
          if (tag === 'canvas') return new MinimalCanvas();
          throw new Error(`Unexpected createElement(${tag})`);
        },
      },
    });
  });

  it('extracts text meals, decodes QR coupons, reports progress, and captures failures', async () => {
    const pdfBytes = buildSyntheticCouponPdf([
      { text: 'MESS COUPON - BREAKFAST', qrPayload: 'PDF-101`Nov 22, 2026' },
      { text: 'daily lunch token', qrPayload: 'PDF-102`Nov 22, 2026' },
      { text: 'Evening SNACKS Coupon', qrPayload: 'PDF-105`Nov 22, 2026' },
      { text: 'Hostel DINNER Pass', qrPayload: 'PDF-103`Nov 22, 2026' },
      { text: 'Generic Mess Coupon', qrPayload: 'PDF-104`Nov 23, 2026' },
      { text: 'BREAKFAST (missing QR page)' },
      { text: 'LUNCH (non-coupon QR)', qrPayload: 'https://invalid.example.com' },
    ]);

    const progressLog: PdfParseProgress[] = [];
    const result = await parseCouponsFromPDF(pdfBytes, (p) => {
      progressLog.push({ ...p });
    });

    assert.equal(result.totalPages, 7);
    assert.equal(progressLog.length, 7);
    assert.deepEqual(progressLog[6], {
      currentPage: 7,
      totalPages: 7,
      decodedCount: 5,
      failedCount: 2,
    });

    // 5 valid coupons decoded with right meals and dates
    assert.equal(result.coupons.length, 5);
    assert.deepEqual(
      result.coupons.map((c) => ({
        page: c.page,
        meal: c.meal,
        id: c.id,
        dateISO: c.dateISO,
        displayDate: c.displayDate,
      })),
      [
        { page: 1, meal: 'B', id: 'PDF-101', dateISO: '2026-11-22', displayDate: 'Nov 22, 2026' },
        { page: 2, meal: 'L', id: 'PDF-102', dateISO: '2026-11-22', displayDate: 'Nov 22, 2026' },
        { page: 3, meal: 'S', id: 'PDF-105', dateISO: '2026-11-22', displayDate: 'Nov 22, 2026' },
        { page: 4, meal: 'D', id: 'PDF-103', dateISO: '2026-11-22', displayDate: 'Nov 22, 2026' },
        { page: 5, meal: 'U', id: 'PDF-104', dateISO: '2026-11-23', displayDate: 'Nov 23, 2026' },
      ]
    );

    // 2 failure pages reported with page numbers and reasons
    assert.equal(result.failures.length, 2);
    assert.equal(result.failures[0].page, 6);
    assert.match(result.failures[0].reason, /No QR code/i);
    assert.equal(result.failures[1].page, 7);
    assert.match(result.failures[1].reason, /format/i);
    assert.equal(result.failures[1].rawQr, 'https://invalid.example.com');

    // Merge into storage and verify daily retrieval order (B -> L -> S -> D)
    const merged = mergeCoupons(result.coupons);
    assert.equal(merged.added, 5);
    const nov22 = getCouponsForDate('2026-11-22');
    assert.deepEqual(
      nov22.map((c) => `${c.meal}:${c.id}`),
      ['B:PDF-101', 'L:PDF-102', 'S:PDF-105', 'D:PDF-103']
    );
  });

  it('extracts roll number and mess name from coupon lines and falls back to empty when unavailable', () => {
    const meta = extractCouponMetadataFromLines([
      'Office of Hostel Management',
      'IIT - Madras',
      'GUEST COUPON',
      'Jul 26, 2025',
      'EE23B189',
      'BREAKFAST',
      '( Not eligible for Return / Refund )',
      'SGR Himalaya FF',
      'Left Veg',
      'S.No:',
      '9334171079820',
      'Authority Sign',
    ]);
    assert.deepEqual(meta, {
      rollNo: 'EE23B189',
      mess: 'SGR Himalaya FF · Left Veg',
    });

    const missing = extractCouponMetadataFromLines(['BREAKFAST', 'S.No: 123']);
    assert.deepEqual(missing, { rollNo: '', mess: '' });
  });
});
