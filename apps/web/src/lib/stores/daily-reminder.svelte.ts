/**
 * Preferencia del aviso diario de Bandeja (doc 48, Fase 2).
 *
 * Persistida por-dispositivo en localStorage (`gtd:notify:daily`). La lógica
 * de "cuándo/qué" vive aquí (compartida); la "última milla" del SO está en
 * `$lib/notify`. Por defecto DESACTIVADO (sin opt-in agresivo) y a las 20:00.
 */
import { type DailyTime, notifier } from '$lib/notify';

const KEY = 'gtd:notify:daily';

interface Prefs {
  enabled: boolean;
  h: number;
  m: number;
}

const DEFAULT: Prefs = { enabled: false, h: 20, m: 0 };

function read(): Prefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT.enabled,
      h: clampHour(p.h),
      m: clampMinute(p.m),
    };
  } catch {
    return { ...DEFAULT };
  }
}

function clampHour(h: unknown): number {
  return typeof h === 'number' && h >= 0 && h <= 23 ? Math.floor(h) : DEFAULT.h;
}
function clampMinute(m: unknown): number {
  return typeof m === 'number' && m >= 0 && m <= 59 ? Math.floor(m) : DEFAULT.m;
}

export const dailyReminder = $state<Prefs>(read());

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ enabled: dailyReminder.enabled, h: dailyReminder.h, m: dailyReminder.m }),
    );
  } catch {
    // non-fatal
  }
}

/** El aviso solo tiene sentido en la app nativa. */
export function reminderSupported(): boolean {
  return notifier.isSupported();
}

function time(): DailyTime {
  return { h: dailyReminder.h, m: dailyReminder.m };
}

/**
 * Activa/desactiva. Al activar pide permiso primero; si lo deniega, no
 * activa y devuelve false (el toggle vuelve a off).
 */
export async function setReminderEnabled(on: boolean): Promise<boolean> {
  if (on) {
    const ok = await notifier.ensurePermission();
    if (!ok) {
      dailyReminder.enabled = false;
      persist();
      return false;
    }
    dailyReminder.enabled = true;
    persist();
    await notifier.scheduleDailyInboxCheck(time());
    return true;
  }
  dailyReminder.enabled = false;
  persist();
  await notifier.cancelDailyInboxCheck();
  return false;
}

/** Cambia la hora del aviso; reprograma si está activo. */
export async function setReminderTime(h: number, m: number): Promise<void> {
  dailyReminder.h = clampHour(h);
  dailyReminder.m = clampMinute(m);
  persist();
  if (dailyReminder.enabled) await notifier.scheduleDailyInboxCheck(time());
}

/**
 * Modelo B: recalcula el aviso según el conteo real de Bandeja. Llamar al
 * arrancar y cuando el conteo cambie (foreground / sync). No-op si está
 * desactivado o no es plataforma nativa.
 */
export async function syncReminderFromInbox(inboxCount: number): Promise<void> {
  if (!dailyReminder.enabled || !notifier.isSupported()) return;
  await notifier.refreshFromState(inboxCount, time());
}
