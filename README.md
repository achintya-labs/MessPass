# Mess Pass

A simple, offline-first web & Android app for managing your daily mess QR coupons.

**Everything stays 100% local on your device.** No servers, no accounts, no tracking, and no data ever leaves your device. Once loaded, it works completely offline.

## Features

- **100% Local & Offline:** All coupons are stored compactly in `localStorage` under a single `mc_v1` key.
- **Offline Multi-Page PDF Import:** Extracts meal types and QR codes from coupon PDFs directly on-device via `pdfjs-dist` and `jsQR`.
- **Time-of-Day Smart Highlighting & Auto-Selection:**
  - **Breakfast:** 7:00 - 10:00 AM
  - **Lunch:** 12:00 - 2:30 PM
  - **Snacks:** 4:30 - 5:30 PM
  - **Dinner:** 7:00 - 9:30 PM
- **Camera QR Scanner:** Scans individual mess coupons or multi-chunk `MC1:` device-transfer QRs.
- **Device Transfer & Backup:** Move passes between devices via `MC1:` QR chunks or `.txt` backup files (uses native Android share sheet in the Android app).
- **Android Native Enhancements:** Interactive horizontal swipe between tabs, Android Back button support, and native camera permission handling.

---

## Web Development & Deployment

### Prerequisites
- **Node.js** (v20+ recommended) and `npm`

### Local Development & Testing
```bash
npm install
npm run dev          # Start Astro dev server
npm run typecheck    # Run TypeScript type checking (tsc --noEmit)
npm run build        # Build static site into dist/
npm test             # Run Node test suite (build first for dist/ checks)
```

### Cloudflare Deployment
Configured via `wrangler.jsonc` to serve the static `dist/` directory:
```bash
npm run cf:dev       # Build dist/ and preview locally with Wrangler
npm run deploy       # Build dist/ and deploy to Cloudflare
```

---

## Android App (Capacitor)

The `android/` project wraps the static `dist/` build using Capacitor 8 (`appId: com.messpass.app`).

### Prerequisites
- **JDK 21** (Capacitor 8 uses Gradle `8.14.3` + AGP `8.13.0`, which require Java 17–24 and will not run on Java 25. If your system defaults to a newer JDK, point `org.gradle.java.home` in `android/gradle.properties` to JDK 21 or Android Studio's bundled `jbr/`.)
- **Android SDK** (`ANDROID_HOME` set, with platform-tools / `adb` and build-tools)

### Debug Build & Device Install
Enable **USB Debugging** on your Android phone, connect via USB, and run:
```bash
npm run android:debug      # Build dist/, sync to android/, and build debug APK
npm run android:install    # Build, sync, and install debug APK onto connected device
```
- Debug APK output: `android/app/build/outputs/apk/debug/app-debug.apk`
- You can also open the project in Android Studio with `npm run cap:open`.

### Signed Release Build
1. **Generate a release keystore (one-time):**
   ```bash
   keytool -genkeypair -v \
     -keystore android/messpass-release.jks \
     -alias messpass \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. **Provide signing credentials** via `.env` (gitignored) or environment variables (or `android/keystore.properties`):
   ```dotenv
   KEYSTORE_FILE=../messpass-release.jks
   KEYSTORE_PASSWORD=your-store-password
   KEY_ALIAS=messpass
   KEY_PASSWORD=your-key-password
   ```
3. **Build & verify the signed release APK:**
   ```bash
   npm run android:release    # Build dist/, sync, and assemble signed release APK
   npm run android:verify     # Verify APK signature and print certificate fingerprint
   ```
- Release APK output: `android/app/build/outputs/apk/release/app-release.apk`
- *Note:* Debug and release builds use different signing certificates. Uninstall any existing debug build on your phone before installing the signed release APK.

---

## NPM Scripts Reference

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start local Astro development server |
| `npm run build` | Build production static site to `dist/` |
| `npm run preview` | Preview built `dist/` locally via Astro |
| `npm run astro` | Run Astro CLI commands directly |
| `npm run typecheck` | Run `tsc --noEmit` across TypeScript sources |
| `npm test` | Run all tests in `tests/*.test.ts` |
| `npm run cf:dev` | Build `dist/` and run local Cloudflare Wrangler preview |
| `npm run deploy` | Build `dist/` and deploy to Cloudflare via Wrangler |
| `npm run cap:sync` | Build `dist/` and sync web assets & plugins to `android/` |
| `npm run cap:open` | Open `android/` in Android Studio |
| `npm run android:debug` | Build `dist/`, sync, and build `app-debug.apk` |
| `npm run android:install` | Build `dist/`, sync, and install debug APK via Gradle/ADB |
| `npm run android:release` | Build `dist/`, sync, and build signed `app-release.apk` |
| `npm run android:verify` | Verify `app-release.apk` signature (`apksigner` / `keytool`) |

---

## Codebase Structure

```text
.
├── public/                     # Static PWA assets (manifest.json, sw.js, icon.svg, PNGs)
├── src/
│   ├── pages/
│   │   └── index.astro         # Main shell assembling components, global CSS, and client entry
│   ├── components/             # Modular Astro HTML components (no scoped styles)
│   │   ├── AppHeader.astro     # Top bar, Mess+QR logo, desktop nav, GitHub link
│   │   ├── PassesView.astro    # Daily passes carousel, date picker, date chips, empty state
│   │   ├── ScanView.astro      # Camera preview, meal tag selector, MC1 chunk progress
│   │   ├── ManageView.astro    # Storage stats, PDF dropzone, transfer/backup, cleanup
│   │   ├── BottomNav.astro     # Mobile bottom navigation bar
│   │   ├── TransferModal.astro # Multi-chunk MC1 transfer QR modal
│   │   ├── ConfirmModal.astro  # Reusable confirmation dialog
│   │   └── InstallBanner.astro # PWA "Add as App" prompt banner
│   ├── client/                 # Browser & Capacitor client TypeScript
│   │   ├── app.ts              # Entry coordinator: tab switching, dirty tracking, init
│   │   ├── types.ts            # Shared client UI types
│   │   ├── utils.ts            # Escaping, date/byte formatting, cached QR SVG rendering
│   │   ├── views/
│   │   │   ├── passes.ts       # Pass carousel, date navigation, swipe dots, single delete
│   │   │   ├── scanner.ts      # Camera stream, throttled jsQR loop, MC1 chunk assembly
│   │   │   └── manage.ts       # PDF import, transfer QR modal, .txt backup/share, cleanup
│   │   └── ui/
│   │       ├── confirm-modal.ts     # Confirmation dialog controller
│   │       ├── install-prompt.ts    # PWA install banner (skipped in native Android)
│   │       ├── keyboard-shortcuts.ts# Escape & ArrowLeft/ArrowRight shortcuts
│   │       ├── native-navigation.ts # Android Back button bridge & swipe init
│   │       ├── swipe-tabs.ts        # Live finger-tracking horizontal tab swipe
│   │       ├── sw-register.ts       # Offline Service Worker registration (web only)
│   │       └── toast.ts             # Toast notification helper
│   ├── lib/                    # Core platform-agnostic domain logic
│   │   ├── storage.ts          # mc_v1 serialization, dedup, meal windows, LZ transfer, .txt backup
│   │   └── pdf-parser.ts       # Offline pdfjs-dist + jsQR coupon extraction
│   └── styles/                 # Global CSS modules (bundled without Astro scoping)
│       ├── tokens.css          # Theme variables, reset, base typography
│       ├── layout.css          # Shell, header, nav, view transitions, panels, buttons
│       ├── passes.css          # Date bar, chips, pass cards, QR frame, empty state
│       ├── scan-manage.css     # Scanner, segmented controls, stats, dropzone, cleanup
│       └── overlays.css        # Modals, install banner, toast
├── android/                    # Capacitor Android native project (Gradle / Java)
│   ├── app/
│   │   ├── build.gradle        # Android build types & .env/env/keystore signing config
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── java/com/messpass/app/MainActivity.java
│   │       └── res/            # Adaptive launcher icons, splash screens, styles
│   └── build.gradle            # Top-level AGP & Gradle configuration
├── tests/                      # Node test runner suites (storage, PDF, QR transfer, PWA/build)
├── capacitor.config.ts         # Capacitor configuration (webDir: "dist")
├── wrangler.jsonc              # Cloudflare static asset deployment config
└── package.json                # Dependencies and npm scripts
```
