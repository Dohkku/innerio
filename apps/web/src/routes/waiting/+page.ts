import { redirect } from '@sveltejs/kit';

// Doc 47: "Esperando" se elimina como tab/concepto. Bookmarks viejos
// caen aquí y rebotan a /reminders. Quitable cuando no quede tráfico.
export function load(): void {
  throw redirect(301, '/reminders');
}
