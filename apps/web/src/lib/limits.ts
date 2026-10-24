/**
 * Hard limits para campos de texto libre. Generosos pero existentes — corte
 * en input contra pegar accidental de novelas / contenido sucio. Un usuario
 * que necesite más probablemente está usando el campo equivocado (notas
 * largas → archivo aparte, no en title).
 *
 * Convención original venía hardcodeada en InspectorPanel (200/300/1000);
 * aquí la centralizo y la extiendo para casar todos los inputs.
 */
export const LIMITS = {
  /** Título de item / acción / proyecto / sub-acción. */
  title: 200,
  /** Resultado deseado de un proyecto. */
  outcome: 300,
  /** Notas / cuerpo del item. */
  notes: 1000,
  /** Persona o cosa que se espera (waiting_for). */
  waitingFor: 100,
  /** Nombre del área (chip corto). */
  areaName: 80,
  /** Descripción del área. */
  areaDesc: 500,
  /** Query de búsqueda. No se persiste; sólo bloquea paste gigante. */
  searchQuery: 200,
} as const;
