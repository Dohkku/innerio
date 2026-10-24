/**
 * Catálogo de frases del easter egg "42" en /settings.
 *
 * Vive en un archivo de texto bind-montado desde el host, NO en SQLite.
 * Razón: queríamos que sobreviva a `docker compose down -v` (que sí borra
 * volúmenes named) y que se edite con `vim` sin SQL ni redeploy.
 *
 * Formato (`SECRET_PHRASES_FILE`):
 *   - Una frase por línea.
 *   - Líneas vacías ignoradas.
 *   - Líneas que empiezan por `#` ignoradas (comentarios).
 *   - Trim a izquierda/derecha.
 *
 * Comportamiento:
 *   - El server hace `stat` del archivo en cada hit al endpoint. Si la
 *     mtime cambió desde la última lectura, re-lee y rebuilda la cache.
 *     Así, `vim phrases.txt && :wq` aplica al instante, sin restart.
 *   - Si el archivo no existe o queda vacío, devuelve la frase histórica
 *     como fallback — el easter egg nunca devuelve 503 por culpa de un
 *     archivo que el operador no haya creado todavía.
 *
 * Path: configurable via `SECRET_PHRASES_FILE` env. En docker-compose
 * mapea `./secret-phrases/phrases.txt` (host, gitignored) a
 * `/etc/innerio/secret-phrases.txt` (contenedor).
 *
 * Edit / list / clear:
 *   vim ./secret-phrases/phrases.txt        # añade/quita líneas
 *   cat ./secret-phrases/phrases.txt        # lista
 *   wc -l ./secret-phrases/phrases.txt      # contar
 *
 * Backup: `cp ./secret-phrases/phrases.txt ~/backups/`.
 */
import { readFileSync, statSync } from 'node:fs';
import type { Hono } from 'hono';

const FALLBACK_PHRASE = 'She wished for a weapon, but not for the skill to wield it.';

type Cache = {
  mtimeMs: number;
  phrases: string[];
};
let cache: Cache | null = null;

function readPhrasesFile(path: string): string[] {
  try {
    const stat = statSync(path);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.phrases;
    const raw = readFileSync(path, 'utf8');
    const phrases = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    cache = { mtimeMs: stat.mtimeMs, phrases };
    return phrases;
  } catch {
    // Archivo no existe / no legible — devolvemos cache previa si la había,
    // o array vacío. El caller cae al fallback histórico.
    return cache?.phrases ?? [];
  }
}

export function getRandomPhrase(filePath: string): string {
  const phrases = readPhrasesFile(filePath);
  if (phrases.length === 0) return FALLBACK_PHRASE;
  const idx = Math.floor(Math.random() * phrases.length);
  return phrases[idx] ?? FALLBACK_PHRASE;
}

export function mountSecretPhrasesApi(app: Hono, filePath: string): void {
  app.get('/api/secret/phrase', (c) => {
    return c.json({ text: getRandomPhrase(filePath) });
  });
}
