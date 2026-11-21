# Mess Pass

A static, 100% client-side and offline-first web application built with **Astro** and **TypeScript** for managing daily mess QR coupons.

## Features

- **100% Offline & Private:** Zero backend calls, analytics, or external APIs. Ships with a PWA manifest (`public/manifest.json`), Service Worker (`public/sw.js`), and locally bundled PDF.js worker so everything works offline after first load.
- **Minimal Storage Footprint:** Stores coupons in `localStorage` under a single key (`mc_v1`) using a compact line-delimited format (`<epoch_days_base36>|<meal_char>|<id>`), keeping ~1,000 coupons under ~15 KB. Deduplicates by full QR payload (`id` + date), preferring known meals over unknown (`U`).
- **Offline Multi-Page PDF Ingestion:** Upload monthly coupon PDFs to automatically infer meal types (`BREAKFAST`, `LUNCH`, `SNACKS`, `DINNER`) from page text and decode QR codes (`"id\`Nov 22, 2026"`) locally via `pdfjs-dist` and `jsqr`, with live progress and per-page failure reporting.
- **Time-of-Day Smart Highlighting & Auto-Selection:** Automatically highlights and selects the active or next upcoming meal pass for today based on mess timings:
  - **Breakfast:** 7:00 – 10:00 AM
  - **Lunch:** 12:00 – 2:30 PM
  - **Snacks:** 4:30 – 5:30 PM
  - **Dinner:** 7:00 – 9:30 PM
- **Responsive Mobile & Desktop UI:** Swipeable horizontal carousel (`scroll-snap-type: x mandatory`) with pagination dots on mobile, responsive multi-card grid on desktop, crisp vector QR rendering (`qrcode`), and quick date navigation.
- **Camera QR Scanner:** Live rear-camera scanner (`getUserMedia` + `jsQR`) with meal tagging (`Auto`, `Breakfast`, `Lunch`, `Snacks`, `Dinner`) and automatic detection/assembly of `MC1:` device-transfer QR chunks.
- **Device Transfer & Backup:** Compresses coupons with `lz-string` (`compressToBase64`) into sequential QR chunks (`MC1:<part>/<total>:<data>`) for device-to-device scanning, plus downloadable/restorable `.txt` backups.
- **Flexible Cleanup:** Delete a single pass, all passes for a selected date, all expired passes (before today), or wipe all data.

## Getting Started

```bash
npm install
npm run dev
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start local Astro dev server |
| `npm run build` | Build static site into `dist/` |
| `npm run preview` | Preview built static site locally |
| `npm run typecheck` | Run TypeScript type checks (`tsc --noEmit`) |
| `npm test` | Run automated unit & integration test suites |

## Project Structure

```text
public/
  icon.svg          # Local PWA icon
  manifest.json     # PWA manifest
  sw.js             # Offline-first Service Worker
src/
  lib/
    storage.ts      # mc_v1 storage, parsing, deduplication, compression & meal windows
    pdf-parser.ts   # Offline multi-page PDF text + QR ingestion
  pages/
    index.astro     # Mobile + desktop Mess Pass UI
tests/
  storage.test.ts       # Storage, date parsing, chunking, deletion & timing tests
  qr-transfer.test.ts   # QR generation/decoding & multi-chunk transfer tests
  pdf-parser.test.ts    # Meal inference & end-to-end multi-page PDF parsing tests
  pwa-and-build.test.ts # Manifest, Service Worker & static build verification
```
