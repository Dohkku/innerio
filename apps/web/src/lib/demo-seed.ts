/**
 * Example data for the web trial mode (no account).
 *
 * A first-time visitor lands on an empty app and can't see what Innerio
 * does, so we fill this browser with a small, realistic GTD setup: a few
 * vague things in the inbox, next actions, two projects, a reminder, a
 * calendar event, someday and reference items. It lives only in this
 * browser's IndexedDB, like everything else in trial mode, and the visitor
 * can edit or delete it freely.
 *
 * Runs once per browser (flag in localStorage) and only when the local
 * database is empty, so it never touches real data. The ids of the seeded
 * rows are remembered: when the visitor signs in, `adoptDemoData` drops
 * them instead of uploading examples into the real account.
 */
import { keyForAppend } from '@gtd/core';
import type { Item } from '@gtd/schema';
import { triplit } from '$lib/triplit';

const FLAG = 'innerio.demo.sembrado';
const IDS = 'innerio.demo.ids';

type Fechas = Partial<
  Pick<
    Item,
    'clarified_at' | 'someday_at' | 'reference_at' | 'completed_at' | 'due_at' | 'remind_at' | 'start_at' | 'end_at'
  >
>;

type Ejemplo = {
  title: string;
  notes?: string;
  outcome?: string;
  is_sequential?: boolean;
  estimate_minutes?: number;
  fechas?: (hoy: Date) => Fechas;
  hijos?: Ejemplo[];
};

function dia(base: Date, dias: number, hora = 9, min = 0): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  d.setHours(hora, min, 0, 0);
  return d;
}

const aclarado = (hoy: Date): Fechas => ({ clarified_at: dia(hoy, -1) });

const EJEMPLOS: Ejemplo[] = [
  // Bandeja: cosas apuntadas deprisa, sin aclarar todavía.
  { title: 'Regalo cumple de mamá' },
  { title: 'Seguro del coche, vence pronto' },
  { title: 'Factura de la luz más alta de lo normal' },
  { title: 'Idea: aprender a hacer pan de masa madre' },

  // Siguientes acciones.
  {
    title: 'Responder a Laura sobre las fechas del viaje',
    estimate_minutes: 5,
    fechas: (hoy) => ({ clarified_at: dia(hoy, -1), due_at: dia(hoy, 0, 20) }),
  },
  { title: 'Comprar pilas para el mando de la tele', estimate_minutes: 10, fechas: aclarado },
  {
    title: 'Pedir cita para la ITV',
    notes: 'La pegatina caduca a final de mes.',
    estimate_minutes: 10,
    fechas: (hoy) => ({ clarified_at: dia(hoy, -2), due_at: dia(hoy, 6) }),
  },

  // Proyectos.
  {
    title: 'Organizar el viaje a Asturias',
    outcome: 'Viaje reservado y pagado, con el plan de cada día',
    is_sequential: true,
    fechas: aclarado,
    hijos: [
      { title: 'Elegir fechas con Laura', fechas: aclarado },
      { title: 'Buscar casa rural cerca de Cangas de Onís', fechas: aclarado },
      { title: 'Reservar el coche de alquiler', fechas: aclarado },
    ],
  },
  {
    title: 'Montar el despacho en la habitación pequeña',
    outcome: 'Poder trabajar allí con buena luz y sin ruido',
    fechas: aclarado,
    hijos: [
      { title: 'Medir la pared para el escritorio', estimate_minutes: 10, fechas: aclarado },
      { title: 'Mirar lámparas de pie', fechas: aclarado },
      { title: 'Vender la estantería vieja', fechas: aclarado },
    ],
  },

  // Recordatorio: se esconde hasta su fecha.
  {
    title: 'Comprobar si llegó el reembolso de la devolución',
    fechas: (hoy) => ({ clarified_at: dia(hoy, -1), remind_at: dia(hoy, 3) }),
  },

  // Calendario: compromiso con hora fija.
  {
    title: 'Reunión con la gestoría',
    notes: 'Llevar las facturas del trimestre.',
    fechas: (hoy) => ({
      clarified_at: dia(hoy, -1),
      start_at: dia(hoy, 2, 10),
      end_at: dia(hoy, 2, 11),
    }),
  },

  // Algún día / quizá.
  { title: 'Aprender a tocar el ukelele', fechas: (hoy) => ({ clarified_at: dia(hoy, -3), someday_at: dia(hoy, -3) }) },
  { title: 'Hacer el Camino de Santiago', fechas: (hoy) => ({ clarified_at: dia(hoy, -3), someday_at: dia(hoy, -3) }) },

  // Referencia.
  {
    title: 'Wifi de casa de mis padres',
    notes: 'Red: Casa_Garcia\nLa contraseña está en la pegatina del router.',
    fechas: (hoy) => ({ clarified_at: dia(hoy, -5), reference_at: dia(hoy, -5) }),
  },

  // Hecho.
  { title: 'Renovar el DNI', fechas: (hoy) => ({ clarified_at: dia(hoy, -4), completed_at: dia(hoy, -1, 12) }) },
];

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardar(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Storage blocked: the seed may run again next visit; harmless because
    // it only runs on an empty database.
  }
}

/** Ids of the example rows still known to this browser. */
export function idsDeEjemplo(): string[] {
  try {
    const ids = JSON.parse(leer(IDS) ?? '[]') as unknown;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function olvidarEjemplos(): void {
  try {
    localStorage.removeItem(IDS);
  } catch {
    // ignore
  }
}

async function insertar(ej: Ejemplo, hoy: Date, parentId: string | undefined, position: string, ids: string[]) {
  // Insert without dates, then stamp them with update: Triplit 1.x sometimes
  // leaves Date values unencoded on insert (same workaround as the capture sites).
  const created = await triplit.insert('items', {
    title: ej.title,
    notes: ej.notes ?? '',
    position,
    ...(parentId ? { parent_id: parentId } : {}),
    ...(ej.outcome !== undefined ? { outcome: ej.outcome } : {}),
    ...(ej.is_sequential ? { is_sequential: true } : {}),
    ...(ej.estimate_minutes ? { estimate_minutes: ej.estimate_minutes } : {}),
  });
  const id = created?.id;
  if (!id) return;
  ids.push(id);
  const fechas = ej.fechas?.(hoy);
  if (fechas && Object.keys(fechas).length > 0) {
    await triplit.update('items', id, (e) => {
      Object.assign(e, fechas);
    });
  }
  let last: string | null = null;
  for (const hijo of ej.hijos ?? []) {
    last = keyForAppend(last);
    await insertar(hijo, hoy, id, last, ids);
  }
}

/**
 * Fill an empty trial database with the examples. Call only when there is
 * no signed-in user. Returns true if it seeded.
 */
export async function sembrarEjemplos(): Promise<boolean> {
  if (typeof window === 'undefined' || leer(FLAG)) return false;
  // Mark first so a second tab or a quick reload can't seed twice.
  guardar(FLAG, new Date().toISOString());
  const existentes = await triplit.fetch(triplit.query('items').Select(['id']).Limit(1));
  if ((existentes as unknown[]).length > 0) return false;

  const hoy = new Date();
  const ids: string[] = [];
  let last: string | null = null;
  try {
    for (const ej of EJEMPLOS) {
      last = keyForAppend(last);
      await insertar(ej, hoy, undefined, last, ids);
    }
  } finally {
    guardar(IDS, JSON.stringify(ids));
  }
  return true;
}
