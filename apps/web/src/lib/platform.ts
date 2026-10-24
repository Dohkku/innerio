import { Capacitor } from '@capacitor/core';

/** Bridge exposed by the Electron preload (apps/desktop/preload.cjs). */
export type DesktopBridge = { version?: string };

export function desktopBridge(): DesktopBridge | undefined {
  return (globalThis as { innerioDesktop?: DesktopBridge }).innerioDesktop;
}

/**
 * True inside a packaged shell (Android/Capacitor at https://localhost,
 * desktop/Electron at app://innerio). Links that would leave the app
 * (magic-link redirects to WEB_ORIGIN) must be handled in-place there.
 */
export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform() || Boolean(desktopBridge());
}
