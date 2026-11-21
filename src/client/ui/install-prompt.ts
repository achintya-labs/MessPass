import { showToast } from './toast';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALL_DISMISSED_KEY = 'mp_install_dismissed';

const installBanner = document.getElementById('install-banner') as HTMLDivElement;
const installDesc = document.getElementById('install-desc') as HTMLSpanElement;
const btnInstallApp = document.getElementById('btn-install-app') as HTMLButtonElement;
const btnDismissInstall = document.getElementById('btn-dismiss-install') as HTMLButtonElement;

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

function isRunningStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

function isInstallDismissed(): boolean {
  try {
    return sessionStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissInstallBanner(): void {
  installBanner.hidden = true;
  try {
    sessionStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}

export function initInstallPrompt(): void {
  btnInstallApp.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      installBanner.hidden = true;
    } else {
      dismissInstallBanner();
    }
  });

  btnDismissInstall.addEventListener('click', dismissInstallBanner);

  if (isRunningStandalone() || isInstallDismissed()) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    if (isInstallDismissed() || isRunningStandalone()) return;
    installDesc.textContent = 'Quick offline access from your home screen';
    btnInstallApp.hidden = false;
    installBanner.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installBanner.hidden = true;
    showToast('Mess Pass added to your device', 'success');
  });

  // iOS Safari fallback (does not fire beforeinstallprompt)
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

  if (isIOS && isSafari) {
    installDesc.textContent = 'Tap Share → Add to Home Screen';
    btnInstallApp.hidden = true;
    installBanner.hidden = false;
  }
}
