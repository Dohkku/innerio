/**
 * Local AI assistant: suggests the next action for a vague inbox item.
 *
 * Runs against Ollama on the user's own machine (http://127.0.0.1:11434), so
 * the decrypted text never leaves the device and E2EE holds. It only
 * proposes: the user picks one of three options or ignores them, as the
 * vision asks ("agent assists, user owns").
 *
 * Works out of the box in the desktop app: Ollama's default allowed origins
 * include app://*. A website on https would need OLLAMA_ORIGINS and the
 * browser's private-network rules, so there it simply stays hidden when
 * Ollama can't be reached.
 */

const OLLAMA = 'http://127.0.0.1:11434';
const CLAVE_ACTIVO = 'innerio.asistente.activo';
const CLAVE_MODELO = 'innerio.asistente.modelo';

const SISTEMA = `Ayudas a aplicar GTD (David Allen). Alguien apuntó algo vago en su bandeja.
Propón 3 siguientes acciones distintas: físicas, concretas y que se puedan hacer de una sentada.
Reglas:
- Empiezan por un verbo en infinitivo (Llamar, Escribir, Buscar, Comprar, Reservar, Pedir, Revisar...).
- Entre 3 y 9 palabras. Sin punto final.
- Interpreta la intención más probable de la nota. «cumple X» es el cumpleaños de X.
- No inventes nombres propios, cifras ni fechas que no estén en la nota.

Ejemplos:
Nota: mirar lo del proveedor
{"acciones": ["Llamar al proveedor para pedir el precio nuevo", "Buscar el último presupuesto del proveedor", "Escribir al proveedor preguntando el plazo de entrega"]}
Nota: cumple Ana
{"acciones": ["Comprar el regalo de cumpleaños de Ana", "Reservar mesa para celebrar el cumpleaños de Ana", "Preguntar a Ana qué le apetece hacer"]}
Nota: coche ruido raro
{"acciones": ["Pedir cita en el taller para revisar el ruido", "Grabar el ruido del coche con el móvil", "Buscar talleres cercanos con buenas reseñas"]}`;

const ESQUEMA = {
  type: 'object',
  properties: {
    acciones: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
  required: ['acciones'],
};

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
    // Storage blocked: the choice just won't persist.
  }
}

/** Keep generic chat models; embedding-only ones can't answer. */
function esDeTexto(nombre: string): boolean {
  return !/embed|bge|minilm|nomic/i.test(nombre);
}

class Asistente {
  /** Models found in the local Ollama; empty = not reachable. */
  modelos = $state<string[]>([]);
  comprobado = $state(false);
  activo = $state(leer(CLAVE_ACTIVO) !== 'no');
  modeloElegido = $state(leer(CLAVE_MODELO) ?? '');

  get disponible(): boolean {
    return this.activo && this.modelos.length > 0;
  }

  get modelo(): string {
    return this.modelos.includes(this.modeloElegido) ? this.modeloElegido : (this.modelos[0] ?? '');
  }

  async comprobar(): Promise<void> {
    try {
      const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) });
      const data = (await res.json()) as { models?: { name: string }[] };
      this.modelos = (data.models ?? []).map((m) => m.name).filter(esDeTexto);
    } catch {
      this.modelos = [];
    } finally {
      this.comprobado = true;
    }
  }

  setActivo(valor: boolean): void {
    this.activo = valor;
    guardar(CLAVE_ACTIVO, valor ? 'si' : 'no');
  }

  setModelo(nombre: string): void {
    this.modeloElegido = nombre;
    guardar(CLAVE_MODELO, nombre);
  }

  /** Three candidate next actions for `texto` (title + optional notes). */
  async sugerir(texto: string, notas = ''): Promise<string[]> {
    const nota = notas.trim() ? `${texto}\n(Notas: ${notas.trim().slice(0, 400)})` : texto;
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: this.modelo,
        system: SISTEMA,
        prompt: `Nota: ${nota}`,
        stream: false,
        think: false,
        format: ESQUEMA,
        options: { temperature: 0.6, num_predict: 160 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama respondió ${res.status}`);
    const { response } = (await res.json()) as { response: string };
    const { acciones } = JSON.parse(response) as { acciones: unknown };
    if (!Array.isArray(acciones)) throw new Error('Respuesta sin acciones');
    return acciones
      .filter((a): a is string => typeof a === 'string')
      .map((a) => a.trim().replace(/[.。]+$/, ''))
      .filter((a) => a.length > 0 && a.length <= 120)
      .slice(0, 3);
  }
}

let instancia: Asistente | undefined;
/** Lazy singleton (same chunk-ordering reason as the other rune stores). */
export function asistente(): Asistente {
  if (!instancia) instancia = new Asistente();
  return instancia;
}
