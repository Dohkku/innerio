#!/usr/bin/env bun
/**
 * Patch para @triplit/db 1.1.10 adapter bun-sqlite.
 *
 * Bug aguas arriba: el `freeStatement` del adapter bun:sqlite devuelve
 * siempre el mismo statement preparado. Cuando hay queries concurrentes
 * que llaman `.iterate()` en paralelo (típico al boot del cliente con 3-4
 * CONNECT_QUERY sobre `items`), el segundo iterate sobre un statement aún
 * en uso revienta con `bad parameter or other API misuse` en bun:sqlite.
 *
 * El adapter hermano `sqlite.js` (better-sqlite3) ya tenía la fix
 * correcta: si el statement está busy, preparar uno nuevo desde
 * `statement.source`. En bun:sqlite NO existe `.busy` y `toString()`
 * interpola los params (no preserva los `?`), así que cacheamos
 * `statement → STATEMENTS[name]` en el constructor y usamos eso para
 * re-preparar con `db.prepare(sql)` cuando se entrega un statement.
 *
 * Idempotente: si ya está parcheado no hace nada. Walk manual para
 * sobrevivir bumps de hash en el path de bun PM.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = '/* INNERIO_BUN_SQLITE_PATCH_V1 */';

const SUFFIX = 'node_modules/@triplit/db/dist/kv-store/storage/bun-sqlite.js';

function findTargets(): string[] {
  const out: string[] = [];
  const bunDir = 'node_modules/.bun';
  if (!existsSync(bunDir)) return out;
  for (const name of readdirSync(bunDir)) {
    if (!name.startsWith('@triplit+db@')) continue;
    const candidate = join(bunDir, name, SUFFIX);
    if (existsSync(candidate)) out.push(candidate);
  }
  return out;
}

const targets = findTargets();
if (targets.length === 0) {
  console.error(
    '[patch-bun-sqlite] no @triplit/db install found under node_modules/.bun — has Triplit moved?',
  );
  process.exit(1);
}

let patched = 0;
let already = 0;
for (const path of targets) {
  const src = readFileSync(path, 'utf8');
  if (src.includes(MARKER)) {
    console.log(`[patch-bun-sqlite] skip already patched: ${path}`);
    already++;
    continue;
  }

  const stmtsNeedle = '        };\n        this.transactions = {';
  const stmtsAdd = `        };
        ${MARKER}
        this._stmtSql = new Map([
            [this.statements.get, STATEMENTS.get],
            [this.statements.set, STATEMENTS.set],
            [this.statements.delete, STATEMENTS.delete],
            [this.statements.deleteRange, STATEMENTS.deleteRange],
            [this.statements.scan, STATEMENTS.scan],
            [this.statements.scanValues, STATEMENTS.scanValues],
            [this.statements.count, STATEMENTS.count],
            [this.statements.countRange, STATEMENTS.countRange],
            [this.statements.truncate, STATEMENTS.truncate],
        ]);
        this.transactions = {`;
  if (!src.includes(stmtsNeedle)) throw new Error(`needle for stmts map not found in ${path}`);

  const freeOld =
    '    freeStatement(statement) {\n' +
    '        return statement;\n' +
    '        // if (!statement.busy) return statement;\n' +
    '        // return this.db.prepare(statement.source);\n' +
    '    }';
  const freeNew =
    '    freeStatement(statement) {\n' +
    '        // Patched (Innerio): bun:sqlite no expone .busy ni .source.\n' +
    '        // Statements en iterate() lazy quedan en uso; re-ejecutarlos\n' +
    '        // da `bad parameter or other API misuse`. Reparamos uno fresh\n' +
    '        // via SQL cacheado en el constructor.\n' +
    '        const sql = this._stmtSql && this._stmtSql.get(statement);\n' +
    '        if (sql) return this.db.prepare(sql);\n' +
    '        return statement;\n' +
    '    }';
  if (!src.includes(freeOld)) throw new Error(`needle for freeStatement not found in ${path}`);

  const out = src.replace(stmtsNeedle, stmtsAdd).replace(freeOld, freeNew);
  writeFileSync(path, out);
  console.log(`[patch-bun-sqlite] patched: ${path}`);
  patched++;
}

console.log(`[patch-bun-sqlite] done. patched=${patched} already=${already}`);
