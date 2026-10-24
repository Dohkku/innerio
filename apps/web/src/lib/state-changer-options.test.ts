import { describe, expect, it } from 'vitest';
import { stateChangerKeysFor } from './state-changer-options';

function keys(state: Parameters<typeof stateChangerKeysFor>[0], isProject = false, rem = false) {
  return stateChangerKeysFor(state, isProject, rem).map((o) => o.key);
}

describe('stateChangerKeysFor — visibilidad por contexto', () => {
  describe('item live, no proyecto, sin recordatorio pendiente', () => {
    it('inbox → p, h, d (sin b porque ya está en bandeja, sin r duplicado)', () => {
      expect(keys('inbox')).toEqual(['p', 'h', 'd']);
    });

    it('next → p, h, d, b', () => {
      expect(keys('next')).toEqual(['p', 'h', 'd', 'b']);
    });

    it('someday → h, d, b (sin p; clarificar a "Algún día" termina la indecisión)', () => {
      expect(keys('someday')).toEqual(['h', 'd', 'b']);
    });

    it('reference → d, b (referencia no se "completa")', () => {
      expect(keys('reference')).toEqual(['d', 'b']);
    });
  });

  describe('item proyecto (isProject=true)', () => {
    it('inbox proyecto → h, d (no se ofrece "Proyecto" porque ya lo es)', () => {
      expect(keys('inbox', true)).toEqual(['h', 'd']);
    });

    it('next proyecto → h, d, b', () => {
      expect(keys('next', true)).toEqual(['h', 'd', 'b']);
    });
  });

  describe('estados terminales', () => {
    it('done → solo b (reactivar)', () => {
      expect(keys('done')).toEqual(['b']);
    });

    it('trashed → solo b (restaurar)', () => {
      expect(keys('trashed')).toEqual(['b']);
    });
  });

  describe('reminder-pending', () => {
    it('cualquier estado con remind_at futuro → d, b', () => {
      expect(keys('inbox', false, true)).toEqual(['d', 'b']);
      expect(keys('next', false, true)).toEqual(['d', 'b']);
      expect(keys('next', true, true)).toEqual(['d', 'b']);
    });
  });
});

describe('stateChangerKeysFor — etiquetas dinámicas de b', () => {
  it('done → "Reactivar"', () => {
    const opts = stateChangerKeysFor('done', false, false);
    expect(opts.find((o) => o.key === 'b')?.label).toBe('Reactivar');
  });

  it('trashed → "Restaurar"', () => {
    const opts = stateChangerKeysFor('trashed', false, false);
    expect(opts.find((o) => o.key === 'b')?.label).toBe('Restaurar');
  });

  it('next → "Devolver a Bandeja"', () => {
    const opts = stateChangerKeysFor('next', false, false);
    expect(opts.find((o) => o.key === 'b')?.label).toBe('Devolver a Bandeja');
  });
});

describe('stateChangerKeysFor — tonos', () => {
  it('h es positivo, d es peligroso, p/b son default', () => {
    const opts = stateChangerKeysFor('next', false, false);
    const toneOf = (k: string) => opts.find((o) => o.key === k)?.tone;
    expect(toneOf('h')).toBe('positive');
    expect(toneOf('d')).toBe('danger');
    expect(toneOf('p')).toBe('default');
    expect(toneOf('b')).toBe('default');
  });
});
