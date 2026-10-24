/**
 * Empty-state strings, ES. Una sola fuente para mantener voz consistente:
 * `[estado]. [acción opcional].` — corto, factual, sin signo de exclamación.
 * "Bandeja" en vez de "Inbox" para casar con `GLOSSARY.inbox` del Nav.
 */
export const EMPTY = {
  inbox: '',
  processEmptyTitle: 'Bandeja vacía',
  processEmptyBody: 'Nada que procesar. Captura algo primero.',
  processZeroTitle: 'Bandeja a cero. Respira.',
  work: 'Lista despejada.',
  workFiltered: 'Sin resultados con esos filtros.',
  reminders: 'Sin recordatorios pendientes.',
  calendar: 'Nada agendado.',
} as const;
