/**
 * Installable web app (PWA). Registers the service worker in real browsers
 * only (the desktop and Android shells already ship the build) and keeps the
 * browser's install prompt so Settings can offer an "Instalar" button.
 */
import { isNativeShell } from '$lib/platform';

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

class Pwa {
  /** Browser-provided prompt (Chromium on desktop and Android). */
  prompt = $state<InstallPrompt | null>(null);
  /** Already running as an installed app. */
  installed = $state(false);

  start(): void {
    if (typeof window === 'undefined' || isNativeShell()) return;
    this.installed =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.prompt = e as InstallPrompt;
    });
    window.addEventListener('appinstalled', () => {
      this.prompt = null;
      this.installed = true;
    });
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch((err) => {
        console.warn('[pwa] service worker', err);
      });
    }
  }

  async install(): Promise<boolean> {
    const p = this.prompt;
    if (!p) return false;
    await p.prompt();
    const { outcome } = await p.userChoice;
    this.prompt = null;
    return outcome === 'accepted';
  }
}

export const pwa = new Pwa();

/** iPhone/iPad Safari has no install prompt: it's done from the share sheet. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
