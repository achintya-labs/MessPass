# Mess Pass — Build, Release & Technical Details

This document covers the full build pipeline, Android/Capacitor packaging, signing setup, runtime platform differences, and automated GitHub release tagging for **Mess Pass**.

---

## 1. Architecture Overview

Mess Pass is built from a single codebase (`src/`) that compiles into a 100% static bundle in `dist/` via Astro/Vite:

- **Web / PWA:** `dist/` is deployed directly to Cloudflare (`wrangler.jsonc`) with an offline Service Worker (`public/sw.js`) and Web App Manifest (`public/manifest.json`).
- **Android App:** Capacitor 8 (`capacitor.config.ts`, `appId: dev.arstuff.messpass`) copies `dist/` into `android/app/src/main/assets/public/` and packages it as a native Android WebView app.

---

## 2. Prerequisites & Environment Nuances

### Web & Tests
- **Node.js:** v20+ (CI uses Node.js 22).
- **Astro Telemetry:** In sandboxed environments where `~/.config/astro` is not writable, run builds with `ASTRO_TELEMETRY_DISABLED=1`.

### Android (Local Builds)
- **JDK 21 is required (do not use Java 25):**
  - Capacitor 8 generates **Gradle 8.14.3** (`android/gradle/wrapper/gradle-wrapper.properties`) and **Android Gradle Plugin (AGP) 8.13.0** (`android/build.gradle`).
  - Gradle 8.x supports up to Java 24 and fails on Java 25. Capacitor 8's native plugins (`@capacitor/android`, `@capacitor/filesystem`, `@capacitor/share`) are not compatible with Gradle 9 / AGP 9 (targeted for Capacitor 9).
  - On distros like **Fedora 44** where `java-21-openjdk` is not in the default repo and OpenJDK 25 is the system default, install JDK 21 via **SDKMAN!** (`sdk install java 21.0.6-tem`), **Adoptium Temurin 21**, or **Android Studio's bundled `jbr/`**, and optionally pin it in `android/gradle.properties`:
    ```properties
    org.gradle.java.home=/path/to/jdk-21
    ```
- **Gradle DSL & App Language:**
  - Build scripts use **Groovy DSL** (`.gradle`), and native Android code is **Java** (`MainActivity.java`).
- **Android SDK:** `ANDROID_HOME` configured with `platform-tools` (`adb`) and `build-tools` (`apksigner`).

---

## 3. NPM Scripts & Verification Flow

| Command | What It Does |
| :--- | :--- |
| `npm run dev` | Starts Astro dev server |
| `npm run typecheck` | Runs `tsc --noEmit` across `src/` |
| `npm run build` | Builds production static assets into `dist/` |
| `npm test` | Runs Node test runner (`tests/*.test.ts`). **Note:** `tests/pwa-and-build.test.ts` inspects `dist/`, so run `npm run build` first. |
| `npm run cf:dev` | Runs `astro build && wrangler dev` |
| `npm run deploy` | Runs `astro build && wrangler deploy` |
| `npm run cap:sync` | Runs `astro build && npx cap sync android` |
| `npm run cap:open` | Opens `android/` in Android Studio |
| `npm run android:debug` | Runs `cap:sync` + `./gradlew assembleDebug` -> `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run android:install` | Runs `cap:sync` + `./gradlew installDebug` onto a USB-connected device |
| `npm run android:release` | Runs `cap:sync` + `./gradlew assembleRelease` -> `android/app/build/outputs/apk/release/app-release.apk` |
| `npm run android:verify` | Verifies `app-release.apk` signature using `apksigner verify --print-certs` (or `keytool -printcert -jarfile` fallback) |

---

## 4. Android Release Signing & Build Types

### Keystore Generation (One-Time)
```bash
keytool -genkeypair -v \
  -keystore android/messpass-release.jks \
  -alias messpass \
  -keyalg RSA -keysize 2048 -validity 10000
```
Keep `messpass-release.jks` and its passwords backed up securely. Losing the keystore prevents shipping updates over already-installed release APKs.

### Credential Resolution Order
`android/app/build.gradle` resolves `signingConfigs.release` in this order:
1. **Process Environment Variables** (`KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) — used in CI.
2. **Root `.env` file** (`../.env` relative to `android/`) — used for local CLI/Android Studio builds.
3. **`android/keystore.properties`** (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) — optional fallback.

If none are provided, `buildTypes.release` builds `app-release-unsigned.apk` without failing.

### Debug vs. Release Nuances
- **Different Signatures:** `debug` is signed with `~/.android/debug.keystore`; `release` is signed with `messpass-release.jks`. Because both share `applicationId "dev.arstuff.messpass"`, you must uninstall the debug APK from your phone before installing a signed release APK (and vice versa).
- **`minifyEnabled false`:** Kept at Capacitor's default in `android/app/build.gradle`. Your TypeScript/CSS is already minified by Astro/Vite in `dist/`, while Capacitor plugins expose Java methods to JS via reflection annotations (`@CapacitorPlugin`, `@PluginMethod`) that R8 can strip without custom ProGuard rules.

---

## 5. Platform-Specific Runtime Behavior

Web and Android share the exact same UI, with native-only behaviors gated behind `Capacitor.isNativePlatform()` or `MainActivity.java`:

- **Service Worker & Install Prompt:** `sw-register.ts` and `install-prompt.ts` exit early on native Android since assets are already bundled inside the APK.
- **Backup Export (`.txt`):** `manage.ts` uses `@capacitor/filesystem` (`Directory.Cache`) + `@capacitor/share` on Android instead of a `blob:` `<a download>` link.
- **Camera Permissions & Video Poster:**
  - `AndroidManifest.xml` declares `android.permission.CAMERA` (and optional `android.hardware.camera`). Capacitor's `BridgeWebChromeClient` handles WebView `VIDEO_CAPTURE` runtime permission prompts.
  - `MainActivity.java` overrides `BridgeWebChromeClient.getDefaultVideoPoster()` to return a `1×1` transparent `Bitmap` (and `scanner.ts` hides `#scanner-video` until playback starts on native) so Android WebView's default gray play-button placeholder never flashes.
- **Live Swipe & Back Button (Android Only):**
  - `swipe-tabs.ts` tracks horizontal `touchmove` drags via `requestAnimationFrame` + `translate3d(...)` with cached container width (ignoring scrollable `.pass-carousel` and `.date-chips-bar` regions).
  - `MainActivity.java` intercepts `OnBackPressedCallback` and calls `window.__handleAndroidBack()` (`native-navigation.ts`), which closes open modals, navigates back to `Passes` if on `Scan`/`Manage`, and minimizes the app (`moveTaskToBack(true)`) when already on `Passes`.
- **QR Scanner & Card Rendering Optimizations:**
  - `scanner.ts` throttles `jsQR` decoding to every `140ms` (~7fps) on a max `640px`-wide offscreen canvas.
  - `utils.ts` caches generated QR SVGs (`qrSvgCache`) and `app.ts` skips re-rendering `Passes` unless coupons were mutated on `Scan` or `Manage`.

---

## 6. Automated Releases & Tag Routing (GitHub Actions)

`.github/workflows/release.yml` triggers on any `v*` tag push (and `workflow_dispatch`) using Node 24-compatible actions (`actions/checkout@v6`, `actions/setup-node@v6`, `actions/setup-java@v5`, and `gh` CLI).

### Tag Routing Rules

| Tag Pattern | Example | Web Check/Build/Test | Android APK + GitHub Release | Cloudflare Deploy |
| :--- | :--- | :---: | :---: | :---: |
| **`v*` (standard)** | `v1.0.0` | Yes | Yes | Yes |
| **`v*-web*`** | `v1.0.1-web` | Yes | **Skipped** | Yes |
| **`v*-app*`** | `v1.0.1-app` | Yes | Yes | **Skipped** |
| **`v*-beta*`** | `v1.0.0-beta`, `v1.0.0-beta-app` | Yes | Marks GitHub Release as **Pre-release** (unless `-web`) | Unless `-app` |

### Automatic App Versioning
`android/app/build.gradle` reads `APP_VERSION_NAME` and `APP_VERSION_CODE` (defaulting to `"1.0"` / `1` locally). In CI, `v<major>.<minor>.<patch>` sets `versionName` (with leading `v` and `-app`/`-web` stripped) and computes a monotonically increasing `versionCode` (`major*1000000 + minor*10000 + patch*100 + offset`, where `-beta` uses `0..98` and stable uses `99` so stable upgrades cleanly over beta).

### Required GitHub Secrets
Configure under **Settings → Secrets and variables → Actions**:
- **Android Signing** *(if omitted, falls back to building & attaching `app-debug.apk`)*:
  - `ANDROID_KEYSTORE_BASE64` — `base64 -w 0 android/messpass-release.jks`
  - `KEYSTORE_PASSWORD`
  - `KEY_ALIAS` (`messpass`)
  - `KEY_PASSWORD`
- **Cloudflare Deployment** *(if omitted, logs a notice and skips deploy)*:
  - `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit permission)
  - `CLOUDFLARE_ACCOUNT_ID`

### Cloudflare Auto-Deploy Setting
To ensure Cloudflare only deploys on tagged releases, pause/disable automatic Git branch builds under **Cloudflare Dashboard → Workers & Pages → `messpass` → Settings → Builds & deployments**.

### Tagging Workflow
Tags point to a specific commit, so always **commit and push your code before tagging**:
```bash
git add -A
git commit -m "Prepare release v1.0.0"
git push origin <branch>

git tag v1.0.0          # or v1.0.0-web / v1.0.0-app
git push origin v1.0.0
```
If you need to move a tag to a newer commit:
```bash
git tag -f v1.0.0
git push -f origin v1.0.0
```

---

## 7. Gitignored / Sensitive Files

Never commit signing keys or local build outputs. Already ignored in `.gitignore` and `android/.gitignore`:
- `.env`, `.dev.vars`, `.wrangler/`, `dist/`, `.astro/`, `node_modules/`
- `android/*.jks`, `android/*.keystore`, `android/keystore.properties`
- `android/.gradle/`, `android/**/build/`, `android/local.properties`, `*.apk`, `*.aab`
- `android/app/src/main/assets/public`, `capacitor.config.json`, `capacitor.plugins.json`
