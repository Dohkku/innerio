import { triplit } from '$lib/triplit';

/**
 * Wipe Triplit's local IndexedDB outright. Used after account deletion: the
 * server has already cascade-wiped, so we don't want per-row syncing — we
 * want the local store gone so no zombie rows survive with the deleted
 * `user_id`. Audit 2026-05-09 item #2.
 */
export async function wipeLocalDatabase(): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: TriplitClient.clear is typed loosely across versions; full=true wipes the entire local store.
  await (triplit as any).clear({ full: true });
}
