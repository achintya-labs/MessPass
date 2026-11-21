import { Capacitor } from '@capacitor/core';
import { PDF_WORKER_URL } from '../../lib/pdf-parser';

export async function registerOfflineServiceWorker(): Promise<void> {
  if (Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', {
      scope: './',
    });

    const collectAssetUrls = (): string[] => {
      const urls = new Set<string>();
      urls.add(PDF_WORKER_URL);
      document
        .querySelectorAll<HTMLScriptElement>('script[src]')
        .forEach((s) => urls.add(s.src));
      document
        .querySelectorAll<HTMLLinkElement>(
          'link[rel="stylesheet"], link[rel="modulepreload"], link[rel="icon"], link[rel="manifest"]'
        )
        .forEach((l) => {
          if (l.href) urls.add(l.href);
        });
      return Array.from(urls);
    };

    const sendCacheMessage = (sw: ServiceWorker | null): void => {
      sw?.postMessage({
        type: 'CACHE_URLS',
        urls: collectAssetUrls(),
      });
    };

    if (registration.active) {
      sendCacheMessage(registration.active);
    }

    navigator.serviceWorker.ready.then((readyReg) => {
      sendCacheMessage(readyReg.active);
    });
  } catch {
    // Service worker unavailable in restricted contexts
  }
}
