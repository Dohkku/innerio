/**
 * Hardcoded GTD constants. Replaces the parser-based methodology runtime
 * that lived in `$lib/methodology/*` + `@gtd/methodology` before the
 * Musk-3.A simplification pass. The configurable-methodology feature was
 * never explored by a real user; the parser + reactive store + builtins
 * seed (~1600 LOC) became cementerio.
 *
 * Constants here mirror the canonical `gtd-default.md` that used to be
 * the seed. The original markdown lives on (read-only) in
 * `.vault/gtd-default.md` for historical reference. If you need to
 * change a label or clarify key, edit it here; no parser involved.
 */

export const GLOSSARY = {
  inbox: 'Bandeja de entrada',
  work: 'Siguientes acciones',
  projects: 'Proyectos',
  reminders: 'Recordatorios',
  calendar: 'Calendario',
} as const;

export const STATE_LABELS: Record<string, string> = {
  inbox: 'Bandeja',
  next: 'Siguiente',
  someday: 'Algún día',
  reference: 'Referencia',
  done: 'Hecho',
  trashed: 'Descartado',
};

export type ClarifyKey = {
  key: string;
  label: string;
  target_state?: 'inbox' | 'next' | 'someday' | 'reference' | 'done' | 'trashed';
  /**
   * When true, the apply step stamps `outcome=''` and `is_sequential=true` so
   * the row counts as a project under the post-Musk-3.B heuristic
   * (see `lib/projects.ts`). Replaces the old `sets_type: 'project'`.
   */
  marks_as_project?: boolean;
  sets_completed_at?: boolean;
  sets_deleted_at?: boolean;
  /**
   * `date` (doc 47): abre date prompt para tickler. La tecla 'r' deja el
   * item con `remind_at` futuro sin clarificarlo. Cuando la fecha llega,
   * reaparece en Bandeja para reprocesarse.
   *
   * `datetime` (doc 46): abre prompt de evento de calendario. La tecla 'c'
   * clarifica el item a 'next' y le añade `start_at` (+ opcional `end_at`,
   * `all_day`). El item desaparece de /work — vive en /calendar como
   * compromiso de tiempo bloqueado.
   */
  prompt?: 'date' | 'datetime';
};

export const CLARIFY_KEYS: ClarifyKey[] = [
  { key: 'a', label: 'Acción', target_state: 'next' },
  { key: 'p', label: 'Proyecto', target_state: 'next', marks_as_project: true },
  { key: 'c', label: 'Calendario', target_state: 'next', prompt: 'datetime' },
  { key: 'r', label: 'Recordatorio', prompt: 'date' },
  { key: 'h', label: 'Hecho', target_state: 'done', sets_completed_at: true },
  { key: 'd', label: 'Descartar', target_state: 'trashed', sets_deleted_at: true },
  { key: 'b', label: 'Devolver a Bandeja', target_state: 'inbox' },
];

export const DEFAULT_CAPTURE_STATE = 'inbox';

/** Display label for a state id (`'inbox' | 'next' | ...`). */
export function stateLabel(stateId: string): string {
  return STATE_LABELS[stateId] ?? stateId;
}

/** Display label for a navigation / view id. Falls back to the raw key. */
export function viewLabel(viewKey: string): string {
  return (GLOSSARY as Record<string, string>)[viewKey] ?? viewKey;
}

/** Find a clarify key definition by its keyboard letter. */
export function findClarifyKey(letter: string): ClarifyKey | undefined {
  return CLARIFY_KEYS.find((k) => k.key === letter);
}
