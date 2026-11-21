import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');

describe('Offline PWA Manifest & Service Worker', () => {
  it('has a valid PWA manifest.json referencing existing local icons', () => {
    const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'public/manifest.json should exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.name, 'Mess Pass');
    assert.equal(manifest.short_name, 'Mess Pass');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.start_url);
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);

    for (const icon of manifest.icons) {
      assert.ok(
        !/^https?:\/\//i.test(icon.src),
        `Icon must be local, not external: ${icon.src}`
      );
      const localIconPath = path.resolve(PUBLIC_DIR, icon.src);
      assert.ok(
        fs.existsSync(localIconPath),
        `Manifest icon file should exist: ${icon.src}`
      );
    }
  });

  it('has a syntactically valid offline Service Worker (public/sw.js) that registers install/activate/fetch/message listeners', () => {
    const swPath = path.join(PUBLIC_DIR, 'sw.js');
    assert.ok(fs.existsSync(swPath), 'public/sw.js should exist');
    const code = fs.readFileSync(swPath, 'utf8');

    assert.equal(
      /https?:\/\//i.test(code),
      false,
      'Service worker must not reference any external URLs'
    );

    const registeredEvents: string[] = [];
    const sandbox = {
      self: {
        location: { origin: 'https://messpass.local', href: 'https://messpass.local/sw.js' },
        addEventListener: (eventName: string) => {
          registeredEvents.push(eventName);
        },
        skipWaiting: () => Promise.resolve(),
        clients: { claim: () => Promise.resolve() },
      },
      caches: {
        open: () => Promise.resolve({ addAll: () => Promise.resolve(), match: () => Promise.resolve(undefined), put: () => Promise.resolve() }),
        keys: () => Promise.resolve([]),
        delete: () => Promise.resolve(true),
        match: () => Promise.resolve(undefined),
      },
      URL,
      Response,
      Promise,
    };

    vm.runInNewContext(code, sandbox, { filename: 'public/sw.js' });

    assert.ok(registeredEvents.includes('install'), 'SW must handle install');
    assert.ok(registeredEvents.includes('activate'), 'SW must handle activate');
    assert.ok(registeredEvents.includes('fetch'), 'SW must handle fetch');
    assert.ok(registeredEvents.includes('message'), 'SW must handle message (CACHE_URLS)');
  });
});

describe('Static Build Output & Zero-Backend Privacy Verification', () => {
  it('emits static dist assets including local pdf.worker.min bundle with zero external scripts/styles/assets', () => {
    const indexPath = path.join(DIST_DIR, 'index.html');
    assert.ok(
      fs.existsSync(indexPath),
      'dist/index.html must exist (run npm run build first)'
    );

    assert.ok(fs.existsSync(path.join(DIST_DIR, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(DIST_DIR, 'sw.js')));
    assert.ok(fs.existsSync(path.join(DIST_DIR, 'icon.svg')));

    const astroDir = path.join(DIST_DIR, '_astro');
    assert.ok(fs.existsSync(astroDir), 'dist/_astro must exist');
    const astroFiles = fs.readdirSync(astroDir);
    assert.ok(
      astroFiles.some((f) => f.endsWith('.js')),
      'dist/_astro must contain bundled JS'
    );
    assert.ok(
      astroFiles.some((f) => f.endsWith('.css')),
      'dist/_astro must contain bundled CSS'
    );
    assert.ok(
      astroFiles.some((f) => f.startsWith('pdf.worker.min.') && f.endsWith('.mjs')),
      'dist/_astro must bundle pdf.worker.min locally for offline PDF parsing'
    );

    const html = fs.readFileSync(indexPath, 'utf8');
    // Ensure zero external network resources (scripts, stylesheets, images, icons)
    assert.equal(
      /<(?:script|link|img)[^>]+(?:src|href)=["']https?:\/\//i.test(html),
      false,
      'Built dist/index.html must not load any external scripts, stylesheets, or images'
    );
  });

  it('includes all required mobile & desktop UI controls, minimal header, and black-blue theme', () => {
    const html = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');

    const requiredIds = [
      'github-link',
      'calendar-trigger',
      'date-picker',
      'btn-prev-day',
      'btn-next-day',
      'btn-today',
      'date-chips-bar',
      'pass-carousel',
      'carousel-dots',
      'scanner-video',
      'scan-meal-group',
      'btn-toggle-camera',
      'transfer-rx-card',
      'pdf-dropzone',
      'pdf-file-input',
      'pdf-progress-wrap',
      'btn-show-transfer-qr',
      'btn-export-txt',
      'txt-restore-input',
      'btn-delete-selected-date',
      'btn-delete-expired',
      'btn-wipe-all',
      'transfer-modal',
      'btn-transfer-prev',
      'btn-transfer-next',
      'confirm-modal',
      'install-banner',
      'btn-install-app',
      'btn-dismiss-install',
    ];

    for (const id of requiredIds) {
      assert.ok(
        html.includes(`id="${id}"`),
        `Built HTML missing required element #${id}`
      );
    }

    assert.equal(html.includes('id="offline-pill"'), false, 'Offline Ready pill should be removed from header');
    assert.equal(html.includes('id="header-count"'), false, 'Pass count pill should be removed from header');
    assert.ok(html.includes('class="desktop-nav'), 'Built HTML should include desktop nav');
    assert.ok(html.includes('class="bottom-nav'), 'Built HTML should include mobile bottom nav');
    assert.ok(html.includes('data-meal="S"'), 'Built HTML should include Snacks meal option');
    assert.ok(html.includes('manifest.json'), 'Built HTML should link manifest.json');

    // Regression guard: box-sizing:border-box must be truly global (not Astro-scoped)
    // and black + blue theme tokens must be emitted.
    const astroDir = path.join(DIST_DIR, '_astro');
    const cssFile = fs.readdirSync(astroDir).find((f) => f.endsWith('.css'));
    assert.ok(cssFile, 'Compiled CSS file should exist');
    const css = fs.readFileSync(path.join(astroDir, cssFile), 'utf8');
    assert.match(
      css,
      /\*,\*?:?:before,\*?:?:after\{box-sizing:border-box\}/,
      'Global box-sizing:border-box must apply to dynamically created DOM nodes'
    );
    assert.equal(
      css.includes('data-astro-cid'),
      false,
      'Single-page styles should be global so dynamic elements inherit all theme rules'
    );
    assert.match(css, /--bg:#000/, 'Theme should use black background');
    assert.match(css, /--primary:#3b82f6/, 'Theme should use blue primary accent');
  });
});
