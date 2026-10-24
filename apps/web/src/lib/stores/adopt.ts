import { triplit } from '$lib/triplit';

const lsKey = (userId: string) => `gtd:adopted:${userId}`;

/**
 * Borra rows locales cuyo `user_id` pertenece a un usuario distinto del
 * actual (huérfanos). Caso típico: wipe del server (auth.sqlite +
 * triplit-data) + re-signup en el mismo navegador. Better Auth genera un
 * user_id NUEVO; el envelope cripto también se regenera (DEK nuevo); pero
 * el IDB local sigue con rows del user_id viejo cifrados con el DEK
 * viejo + AAD bind al user_id viejo. Sin limpiar, esos rows:
 *   - aparecen en listados (las queries no filtran por user_id en cliente),
 *   - disparan errores de descifrado al abrirlos o borrarlos (DEK y AAD
 *     no coinciden),
 *   - son irrecuperables (el server ya no tiene su envelope ni sus datos).
 *
 * Skip silencioso si no hay mismatch — caso normal de un mismo usuario
 * volviendo a entrar en el mismo device. Idempotente.
 *
 * Importante: llamar ANTES de `triplit.startSession(...)`. El delete pasa
 * por el sync queue; sin sesión activa, queda local. Cuando arranque el
 * sync, los deletes intentarán propagarse al server y serán rechazados
 * por la permission filter (`user_id = $role.user_id` no matchea el viejo)
 * — error inocuo, la limpieza local ya hizo su trabajo.
 */
export async function clearOrphanedRows(currentUserId: string): Promise<number> {
  if (typeof window === 'undefined') return 0;
  if (!currentUserId) return 0;

  const [items, settings] = await Promise.all([
    triplit.fetch(triplit.query('items')),
    triplit.fetch(triplit.query('settings')),
  ]);

  type Row = { id: string; user_id?: string };
  const isOrphan = (r: unknown): r is Row => {
    const uid = (r as Row).user_id;
    return typeof uid === 'string' && uid.length > 0 && uid !== currentUserId;
  };

  const orphanItems = (items as unknown[]).filter(isOrphan);
  const orphanSettings = (settings as unknown[]).filter(isOrphan);
  const total = orphanItems.length + orphanSettings.length;
  if (total === 0) return 0;

  console.warn(
    `[adopt] limpiando ${total} rows huérfanos de IDB local (items=${orphanItems.length}, settings=${orphanSettings.length}). user_id actual=${currentUserId}.`,
  );

  await Promise.all([
    ...orphanItems.map((row) => triplit.delete('items', row.id)),
    ...orphanSettings.map((row) => triplit.delete('settings', row.id)),
  ]);

  return total;
}

/**
 * One-shot migration: attach every unowned row (user_id === '') to the newly
 * signed-in user. Runs BEFORE triplit.startSession() so writes happen against
 * the local IndexedDB without server-side rule validation. Once the session
 * starts, the now-stamped rows pass the per-user permission filter on push.
 *
 * Schema actual (post-mayo 2026): solo `items` y `settings` son colecciones
 * con user_id. `crypto_envelopes` se crea durante el setup E2EE, no se adopta.
 * Idempotente: salta si localStorage ya marca adopción completa para este
 * userId en este device.
 */
export async function adoptDemoData(userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(lsKey(userId))) return;

  const [items, settings] = await Promise.all([
    triplit.fetch(triplit.query('items').Where('user_id', '=', '')),
    triplit.fetch(triplit.query('settings').Where('user_id', '=', '')),
  ]);

  const stamp = (e: { user_id: string }) => {
    e.user_id = userId;
  };
  await Promise.all([
    ...items.map((row) => triplit.update('items', row.id, stamp)),
    ...settings.map((row) => triplit.update('settings', row.id, stamp)),
  ]);

  localStorage.setItem(lsKey(userId), new Date().toISOString());

  // Create the settings singleton if none existed. Schema slim (id + user_id
  // + enc_v) hace que el insert sea trivial — sin defaults explícitos extra.
  if (settings.length === 0) {
    await triplit.insert('settings', {
      user_id: userId,
      enc_v: 0,
    });
  }
}
