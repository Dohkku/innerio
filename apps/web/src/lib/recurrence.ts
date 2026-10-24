/**
 * Recurrence v3: presets + intervalo, guardados como JSON en `item.recurrence`.
 *
 * Formato:
 *   { freq: 'daily',   interval?: 2..99 }
 *   { freq: 'weekly',  interval?: 2..99, byDays?: number[] }  // JS getDay 0=Dom
 *   { freq: 'monthly', interval?: 2..99 }
 *
 * v1 (`{ freq: 'weekly' }`) y v2 (con byDays) parsean limpio: `interval`
 * ausente equivale a 1. `interval=1` se omite al persistir (norma).
 *
 * `interval` + `byDays` simultáneos: el intervalo gana, `byDays` se ignora
 * en weekly cuando `interval > 1` (caso semánticamente ambiguo; ADR-037).
 *
 * Al "completar" un recurrente, `advanceRecurrence(item)` avanza la próxima
 * ocurrencia in-place — mismo id, misma fila. El caller salta la transición
 * normal a done. El comportamiento depende de si el item es un EVENTO de
 * calendario (tiene `start_at`) o una SIGUIENTE ACCIÓN recurrente (no):
 *
 *  - Siguiente acción (sin `start_at`): solo se desplaza `due_at`. Las tareas
 *    recurrentes son perpetuas; guardar una fila por ocurrencia pasada
 *    ensuciaba proyectos + /work sin aportar señal.
 *  - Evento de calendario (con `start_at`): se registra una fila-snapshot de
 *    la ocurrencia de hoy (marcada como hecha, sin recurrencia) y se desplaza
 *    `start_at`/`end_at`/`due_at` a la próxima fecha. Así el evento "se queda"
 *    en el calendario avanzando, y el snapshot deja historial visible en
 *    "ver completadas" (toggle ✓ de /calendar). Decisión del usuario
 *    2026-05-29 (ver worklog).
 */
import type { Item } from '@gtd/schema';

export const RECUR_OPTIONS = [
  { value: '', label: 'No repite' },
  { value: 'daily', label: 'Cada día' },
  { value: 'weekly', label: 'Cada semana' },
  { value: 'monthly', label: 'Cada mes' },
] as const;

export type RecurFreq = 'daily' | 'weekly' | 'monthly';

export type Recurrence =
  | { freq: 'daily'; interval?: number }
  | { freq: 'weekly'; interval?: number; byDays?: number[] }
  | { freq: 'monthly'; interval?: number };

const INTERVAL_MAX = 99;

/** Singular/plural unit label for the UI ("día"/"días", ...). */
export function recurUnitLabel(freq: RecurFreq, interval: number): string {
  const n = interval > 1 ? 1 : 0;
  switch (freq) {
    case 'daily':
      return ['día', 'días'][n];
    case 'weekly':
      return ['semana', 'semanas'][n];
    case 'monthly':
      return ['mes', 'meses'][n];
  }
}

// L M X J V S D → JS getDay codes (Mon-first, Spanish convention).
export const WEEK_DAYS = [
  { code: 1, label: 'L' },
  { code: 2, label: 'M' },
  { code: 3, label: 'X' },
  { code: 4, label: 'J' },
  { code: 5, label: 'V' },
  { code: 6, label: 'S' },
  { code: 0, label: 'D' },
] as const;

function sanitizeByDays(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of value) {
    if (typeof v !== 'number') continue;
    const d = Math.trunc(v);
    if (d < 0 || d > 6) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  if (!out.length) return undefined;
  out.sort((a, b) => a - b);
  return out;
}

/** Entero 2..99 → conserva. Resto → undefined (norma: interval=1 se omite). */
function sanitizeInterval(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  const n = Math.trunc(value);
  if (n < 2 || n > INTERVAL_MAX) return undefined;
  return n;
}

export function readRecurrence(value: unknown): Recurrence | null {
  if (!value || typeof value !== 'object') return null;
  const freq = (value as { freq?: unknown }).freq;
  const interval = sanitizeInterval((value as { interval?: unknown }).interval);
  if (freq === 'daily' || freq === 'monthly') {
    return interval ? { freq, interval } : { freq };
  }
  if (freq === 'weekly') {
    // Si hay interval>1, byDays se ignora (ambigüedad semántica, ADR-037).
    if (interval) return { freq, interval };
    const byDays = sanitizeByDays((value as { byDays?: unknown }).byDays);
    return byDays ? { freq, byDays } : { freq };
  }
  return null;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  // Preserve day-of-month when possible. JS handles overflow (Feb 31 → Mar 3)
  // by rolling forward; we clamp to the last day of the target month instead
  // so "monthly on the 31st" lands on the 30th / 28th when needed.
  const targetMonth = out.getMonth() + n;
  out.setDate(1);
  out.setMonth(targetMonth);
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(d.getDate(), lastDay));
  return out;
}

export function nextDate(from: Date, recur: Recurrence): Date {
  const interval = recur.interval ?? 1;
  switch (recur.freq) {
    case 'daily':
      return addDays(from, interval);
    case 'weekly': {
      // interval>1: byDays se ignoró en readRecurrence; anchor + 7*interval.
      if (interval > 1) return addDays(from, 7 * interval);
      // Without explicit byDays, fall back to anchor + 7 (compat with v1).
      if (!recur.byDays || !recur.byDays.length) return addDays(from, 7);
      // Walk forward 1..7 days; first whose getDay() ∈ byDays wins.
      const set = new Set(recur.byDays);
      for (let i = 1; i <= 7; i++) {
        const candidate = addDays(from, i);
        if (set.has(candidate.getDay())) return candidate;
      }
      // Defensive fallback (unreachable while byDays has entries).
      return addDays(from, 7);
    }
    case 'monthly':
      return addMonths(from, interval);
  }
}

// Returns true if today is a scheduled day for this recurring item.
export function isRecurringToday(item: Item, today: Date): boolean {
  const r = readRecurrence(item.recurrence);
  if (!r) return false;
  // If already anchored to a future due date, let isToday/isOverdue handle it.
  if (item.due_at) {
    const due = new Date(item.due_at);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const d0 = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    if (d0 > t0) return false;
  }
  switch (r.freq) {
    case 'daily':
      return true;
    case 'weekly': {
      if (r.byDays?.length) return r.byDays.includes(today.getDay());
      const anchor = item.due_at;
      if (!anchor) return false;
      return new Date(anchor).getDay() === today.getDay();
    }
    case 'monthly': {
      const anchor = item.due_at;
      if (!anchor) return false;
      return today.getDate() === new Date(anchor).getDate();
    }
  }
}

function fmtRelDate(d: Date, today: Date): string {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((d0.getTime() - t0.getTime()) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

// Returns a human-readable label for when this item next appears in Foco,
// or null if the schedule can't be determined.
export function recurNextLabel(item: Item, today: Date): string | null {
  const r = readRecurrence(item.recurrence);
  if (!r) return null;
  // If has a future due date, that IS the next occurrence.
  if (item.due_at) {
    const due = new Date(item.due_at);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const d0 = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    if (d0 > t0) return fmtRelDate(due, today);
  }
  switch (r.freq) {
    case 'daily':
      return isRecurringToday(item, today) ? 'Hoy' : 'Mañana';
    case 'weekly': {
      if (r.byDays?.length) {
        if (isRecurringToday(item, today)) return 'Hoy';
        return fmtRelDate(nextDate(today, r), today);
      }
      const anchor = item.due_at;
      if (!anchor) return 'Semanal';
      const anchorDay = new Date(anchor).getDay();
      for (let i = 0; i <= 7; i++) {
        const d = addDays(today, i);
        if (d.getDay() === anchorDay) return fmtRelDate(d, today);
      }
      return 'Semanal';
    }
    case 'monthly': {
      const anchor = item.due_at;
      if (!anchor) return 'Mensual';
      if (isRecurringToday(item, today)) return 'Hoy';
      const anchorDay = new Date(anchor).getDate();
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), anchorDay);
      const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (thisMonth > todayMid) return fmtRelDate(thisMonth, today);
      return fmtRelDate(new Date(today.getFullYear(), today.getMonth() + 1, anchorDay), today);
    }
  }
}

/**
 * Inserta una fila-snapshot de la ocurrencia recién completada de un evento
 * recurrente: copia título + bloque temporal de hoy y la deja `done` (sin
 * recurrencia, sin parent). Queda confinada al calendario: /work filtra
 * `start_at != null`, /projects sólo lista hijos con `parent_id`, así que
 * sólo aparece en /calendar al activar el toggle "ver completadas".
 */
async function logCompletedOccurrence(item: Item, completedAt: Date): Promise<void> {
  const { triplit } = await import('$lib/triplit');
  // El insert wrapper (triplit.ts) estampa id/user_id/created_at/position/
  // enc_v y cifra `title`; las fechas Date se convierten a ISO ahí. Los
  // campos opcionales ausentes (undefined) son válidos para el schema.
  await triplit.insert('items', {
    title: item.title,
    start_at: item.start_at,
    end_at: item.end_at,
    all_day: item.all_day,
    tz: item.tz,
    completed_at: completedAt,
    // clarified_at presente por coherencia (si se reabriera, va a "next").
    clarified_at: completedAt,
  });
}

/**
 * If `item` has a recurrence, advance it to the next occurrence in place and
 * return true. The caller should SKIP the normal cascade + done transition.
 *
 * - Calendar event (`start_at` set): log a done snapshot of today's
 *   occurrence, then shift `start_at`/`end_at`/`due_at` to the next date
 *   (same time-of-day, same duration). The row stays "next" at its next slot.
 * - Next action (no `start_at`): shift `due_at` only — no snapshot. The row
 *   stays "next" and re-appears on its next scheduled day.
 *
 * Returns false if the item has no recurrence (caller proceeds with the
 * regular completion flow).
 */
export async function advanceRecurrence(item: Item): Promise<boolean> {
  const r = readRecurrence(item.recurrence);
  if (!r) return false;

  // Dynamic import: pure date logic above (and the test suite) stays free
  // of the Triplit / IndexedDB bootstrap.
  const { triplit } = await import('$lib/triplit');

  // Evento de calendario: snapshot de la ocurrencia de hoy + desplazar el
  // bloque temporal a la próxima fecha (preservando hora y duración vía
  // delta). due_at se mueve el mismo delta si existe (deadline asociado).
  if (item.start_at) {
    const completedAt = new Date();
    await logCompletedOccurrence(item, completedAt);
    const anchor = new Date(item.start_at);
    const nextStart = nextDate(anchor, r);
    const deltaMs = nextStart.getTime() - anchor.getTime();
    const endMs = item.end_at ? new Date(item.end_at).getTime() + deltaMs : null;
    const dueMs = item.due_at ? new Date(item.due_at).getTime() + deltaMs : null;
    await triplit.update('items', item.id, (e) => {
      e.start_at = nextStart;
      if (endMs != null) e.end_at = new Date(endMs);
      if (dueMs != null) e.due_at = new Date(dueMs);
    });
    return true;
  }

  // Siguiente acción recurrente (sin start_at): anclar en su due (fallback a
  // hoy) para que una cadena de "cada lunes" siga alineada aunque se complete
  // tarde, y desplazar due_at in-place.
  const anchor = item.due_at ? new Date(item.due_at) : new Date();
  const nextDue = nextDate(anchor, r);
  await triplit.update('items', item.id, (e) => {
    e.due_at = nextDue;
  });
  return true;
}
