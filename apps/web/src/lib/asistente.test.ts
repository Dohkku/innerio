import { afterEach, describe, expect, it, vi } from 'vitest';
import { asistente } from './asistente.svelte';

function respuesta(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('asistente local', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('detects Ollama models and skips embedding ones', async () => {
    vi.stubGlobal('fetch', () =>
      respuesta({ models: [{ name: 'qwen3.5:4b' }, { name: 'nomic-embed-text' }] }),
    );
    const ia = asistente();
    await ia.comprobar();
    expect(ia.modelos).toEqual(['qwen3.5:4b']);
    expect(ia.disponible).toBe(true);
  });

  it('stays hidden when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    const ia = asistente();
    await ia.comprobar();
    expect(ia.disponible).toBe(false);
  });

  it('returns up to three clean actions', async () => {
    const acciones = [
      'Llamar al dentista.',
      '  Pedir cita  ',
      '',
      'Buscar dentista cerca',
      'Extra',
    ];
    let enviado: Record<string, unknown> = {};
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      enviado = JSON.parse(String(init.body));
      return respuesta({ response: JSON.stringify({ acciones }) });
    });
    const ia = asistente();
    ia.modelos = ['qwen3.5:4b'];
    const r = await ia.sugerir('dentista');
    expect(r).toEqual(['Llamar al dentista', 'Pedir cita', 'Buscar dentista cerca']);
    expect(enviado.model).toBe('qwen3.5:4b');
    expect(enviado.think).toBe(false);
    expect(String(enviado.prompt)).toContain('dentista');
  });

  it('fails loudly on a bad response', async () => {
    vi.stubGlobal('fetch', () => respuesta({}, false));
    const ia = asistente();
    ia.modelos = ['qwen3.5:4b'];
    await expect(ia.sugerir('x')).rejects.toThrow();
  });
});
