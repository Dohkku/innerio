/**
 * Background migration sweep (Phase 9 slice 6, ADR-017; AAD upgrade per
 * ADR-018 / audit N-2 on 2026-05-01).
 *
 * Originalmente promocionaba cada row con `enc_v < ENC_V_CURRENT` al
 * formato actual delegando en `triplit.update(collection, id, () => {})`
 * para que el wrapper de `triplit.ts` reescribiera el row entero con AAD.
 *
 * HOTFIX 2026-05-21: el sweep producía el banner "X elementos no se han
 * podido descifrar" en sesiones nuevas. Causa raíz: seeds insertados
 * pre-login (con `user_id=''` por race entre cryptoStore.init y
 * setTriplitUserId) quedaban sellados con AAD ctx.userId=''. adopt.ts
 * después rotaba `row.user_id` al userId real, dejando el AAD del title
 * desincronizado del nuevo user_id stamped en el row. El sweep
 * promocionaba el row pero el resultado seguía sin descifrarse en
 * sesiones posteriores.
 *
 * Fix: deshabilitado el sweep. Con `seedFirstRun` ya retirado, no quedan
 * inserts pre-login en el flujo normal y todos los rows nacen con
 * `enc_v=2` + AAD selado al userId final. Si en el futuro se vuelve a
 * necesitar (otro bump de ENC_V_CURRENT), reactivar tras solucionar el
 * race con currentUserId.
 */

export type MigrationProgress = {
  collection: string;
  done: number;
  total: number;
};

export type MigrationSummary = {
  totalRows: number;
  migratedRows: number;
  failed: { collection: string; id: string; error: string }[];
  durationMs: number;
};

export type MigrationOptions = {
  throttleMs?: number;
};

type TriplitLike = {
  fetch: (q: unknown) => Promise<Record<string, unknown>[]>;
  query: (collection: string) => unknown;
  update: (
    collection: string,
    id: string,
    fn: (e: Record<string, unknown>) => void,
  ) => Promise<unknown>;
};

export async function runMigrationSweep(
  _triplit: TriplitLike,
  _userId: string,
  _onProgress?: (p: MigrationProgress) => void,
  _options: MigrationOptions = {},
): Promise<MigrationSummary> {
  return { totalRows: 0, migratedRows: 0, failed: [], durationMs: 0 };
}
