import type { Item } from '@gtd/schema';
import { describe, expect, it } from 'vitest';
import {
  type Recurrence,
  isRecurringToday,
  nextDate,
  readRecurrence,
  recurNextLabel,
  recurUnitLabel,
} from './recurrence';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'id',
    title: 't',
    notes: '',
    user_id: '',
    is_sequential: false,
    created_at: new Date(2026, 0, 1),
    updated_at: new Date(2026, 0, 1),
    position: 'a0',
    enc_v: 0,
    ...overrides,
  } as Item;
}

describe('readRecurrence — parseo defensivo', () => {
  it('null/undefined/string → null', () => {
    expect(readRecurrence(null)).toBeNull();
    expect(readRecurrence(undefined)).toBeNull();
    expect(readRecurrence('weekly')).toBeNull();
  });

  it('freq desconocida → null', () => {
    expect(readRecurrence({ freq: 'yearly' })).toBeNull();
    expect(readRecurrence({})).toBeNull();
  });

  it('daily/monthly sin extras', () => {
    expect(readRecurrence({ freq: 'daily' })).toEqual({ freq: 'daily' });
    expect(readRecurrence({ freq: 'monthly' })).toEqual({ freq: 'monthly' });
  });

  it('weekly sin byDays → { freq: weekly }', () => {
    expect(readRecurrence({ freq: 'weekly' })).toEqual({ freq: 'weekly' });
  });

  it('weekly con byDays válidos → ordenados, deduplicados', () => {
    expect(readRecurrence({ freq: 'weekly', byDays: [3, 1, 1, 5] })).toEqual({
      freq: 'weekly',
      byDays: [1, 3, 5],
    });
  });

  it('weekly con byDays inválidos → desaparece', () => {
    expect(readRecurrence({ freq: 'weekly', byDays: [-1, 7, 'x'] })).toEqual({ freq: 'weekly' });
    expect(readRecurrence({ freq: 'weekly', byDays: [] })).toEqual({ freq: 'weekly' });
  });

  it('weekly byDays no-array → desaparece', () => {
    expect(readRecurrence({ freq: 'weekly', byDays: 'lunes' })).toEqual({ freq: 'weekly' });
  });

  it('interval 2..99 → conserva', () => {
    expect(readRecurrence({ freq: 'daily', interval: 2 })).toEqual({ freq: 'daily', interval: 2 });
    expect(readRecurrence({ freq: 'monthly', interval: 3 })).toEqual({
      freq: 'monthly',
      interval: 3,
    });
    expect(readRecurrence({ freq: 'weekly', interval: 2 })).toEqual({
      freq: 'weekly',
      interval: 2,
    });
    expect(readRecurrence({ freq: 'monthly', interval: 99 })).toEqual({
      freq: 'monthly',
      interval: 99,
    });
  });

  it('interval ≤ 1 o > 99 o inválido → omitido (default 1)', () => {
    expect(readRecurrence({ freq: 'daily', interval: 1 })).toEqual({ freq: 'daily' });
    expect(readRecurrence({ freq: 'daily', interval: 0 })).toEqual({ freq: 'daily' });
    expect(readRecurrence({ freq: 'daily', interval: -3 })).toEqual({ freq: 'daily' });
    expect(readRecurrence({ freq: 'daily', interval: 100 })).toEqual({ freq: 'daily' });
    expect(readRecurrence({ freq: 'daily', interval: 'tres' })).toEqual({ freq: 'daily' });
    expect(readRecurrence({ freq: 'daily', interval: Number.NaN })).toEqual({ freq: 'daily' });
  });

  it('interval decimal → trunca, sigue regla 2..99', () => {
    expect(readRecurrence({ freq: 'monthly', interval: 3.7 })).toEqual({
      freq: 'monthly',
      interval: 3,
    });
    expect(readRecurrence({ freq: 'monthly', interval: 1.9 })).toEqual({ freq: 'monthly' });
  });

  it('weekly con interval > 1 ignora byDays (ambigüedad semántica)', () => {
    expect(readRecurrence({ freq: 'weekly', interval: 2, byDays: [1, 3] })).toEqual({
      freq: 'weekly',
      interval: 2,
    });
  });

  it('weekly con interval = 1 mantiene byDays (compat v2)', () => {
    expect(readRecurrence({ freq: 'weekly', interval: 1, byDays: [1, 3] })).toEqual({
      freq: 'weekly',
      byDays: [1, 3],
    });
  });
});

describe('nextDate — avance por frecuencia', () => {
  const D = (y: number, m: number, d: number) => new Date(y, m, d);

  it('daily → +1 día', () => {
    expect(nextDate(D(2026, 0, 15), { freq: 'daily' })).toEqual(D(2026, 0, 16));
  });

  it('weekly sin byDays → +7 días (compat v1)', () => {
    expect(nextDate(D(2026, 0, 15), { freq: 'weekly' })).toEqual(D(2026, 0, 22));
  });

  it('weekly con byDays elige el primero disponible 1..7', () => {
    // 2026-01-15 es jueves (getDay=4). byDays=[1] (lunes) → +4 días = 2026-01-19.
    const r: Recurrence = { freq: 'weekly', byDays: [1] };
    expect(nextDate(D(2026, 0, 15), r)).toEqual(D(2026, 0, 19));
  });

  it('weekly byDays incluye día actual: salta a la próxima ocurrencia', () => {
    // Jueves 2026-01-15, byDays=[4] → próximo jueves +7 días.
    const r: Recurrence = { freq: 'weekly', byDays: [4] };
    expect(nextDate(D(2026, 0, 15), r)).toEqual(D(2026, 0, 22));
  });

  it('monthly → +1 mes preservando día', () => {
    expect(nextDate(D(2026, 0, 15), { freq: 'monthly' })).toEqual(D(2026, 1, 15));
  });

  it('monthly desde día 31 → clamp a fin de mes corto', () => {
    // Enero 31 → Feb 28 (2026 no bisiesto).
    expect(nextDate(D(2026, 0, 31), { freq: 'monthly' })).toEqual(D(2026, 1, 28));
  });

  it('monthly desde día 31 → marzo (que tiene 31) preserva día', () => {
    expect(nextDate(D(2026, 2, 31), { freq: 'monthly' })).toEqual(D(2026, 3, 30));
    // Marzo 31 + 1 mes = abril, pero abril solo tiene 30. clamp.
  });

  it('monthly diciembre → enero del año siguiente', () => {
    expect(nextDate(D(2026, 11, 15), { freq: 'monthly' })).toEqual(D(2027, 0, 15));
  });

  it('daily interval=2 → +2 días', () => {
    expect(nextDate(D(2026, 0, 15), { freq: 'daily', interval: 2 })).toEqual(D(2026, 0, 17));
  });

  it('weekly interval=2 → +14 días (byDays ignorado por sanitización previa)', () => {
    expect(nextDate(D(2026, 0, 15), { freq: 'weekly', interval: 2 })).toEqual(D(2026, 0, 29));
  });

  it('monthly interval=3 → +3 meses (caso "cepillo cada 3 meses")', () => {
    expect(nextDate(D(2026, 0, 15), { freq: 'monthly', interval: 3 })).toEqual(D(2026, 3, 15));
  });

  it('monthly interval=12 → +1 año (anclando día y clampeando en feb bisiesto)', () => {
    expect(nextDate(D(2026, 0, 15), { freq: 'monthly', interval: 12 })).toEqual(D(2027, 0, 15));
  });

  it('monthly interval=6 desde día 31 → clamp a julio 30 (jun) o ago 31', () => {
    // Enero 31 + 6 meses = Julio. Julio tiene 31. Sin clamp.
    expect(nextDate(D(2026, 0, 31), { freq: 'monthly', interval: 6 })).toEqual(D(2026, 6, 31));
    // Marzo 31 + 6 = Septiembre (30 días) → clamp a Sep 30.
    expect(nextDate(D(2026, 2, 31), { freq: 'monthly', interval: 6 })).toEqual(D(2026, 8, 30));
  });
});

describe('recurUnitLabel — singular/plural por intervalo', () => {
  it('singular cuando interval = 1', () => {
    expect(recurUnitLabel('daily', 1)).toBe('día');
    expect(recurUnitLabel('weekly', 1)).toBe('semana');
    expect(recurUnitLabel('monthly', 1)).toBe('mes');
  });

  it('plural cuando interval > 1', () => {
    expect(recurUnitLabel('daily', 2)).toBe('días');
    expect(recurUnitLabel('weekly', 3)).toBe('semanas');
    expect(recurUnitLabel('monthly', 12)).toBe('meses');
  });
});

describe('isRecurringToday — heurística calendario', () => {
  const today = new Date(2026, 4, 18); // 2026-05-18 lunes (getDay=1)

  it('sin recurrencia → false', () => {
    expect(isRecurringToday(item(), today)).toBe(false);
  });

  it('daily → true', () => {
    expect(isRecurringToday(item({ recurrence: { freq: 'daily' } }), today)).toBe(true);
  });

  it('weekly con byDays incluye hoy → true', () => {
    const it = item({ recurrence: { freq: 'weekly', byDays: [1] } });
    expect(isRecurringToday(it, today)).toBe(true);
  });

  it('weekly con byDays sin hoy → false', () => {
    const it = item({ recurrence: { freq: 'weekly', byDays: [3, 5] } });
    expect(isRecurringToday(it, today)).toBe(false);
  });

  it('weekly anchor mismo getDay que hoy → true', () => {
    const it = item({
      recurrence: { freq: 'weekly' },
      due_at: new Date(2026, 4, 4), // lunes pasado
    });
    expect(isRecurringToday(it, today)).toBe(true);
  });

  it('monthly anchor mismo día del mes → true', () => {
    const it = item({
      recurrence: { freq: 'monthly' },
      due_at: new Date(2026, 3, 18),
    });
    expect(isRecurringToday(it, today)).toBe(true);
  });

  it('due_at futuro → false (lo gestiona isToday/isOverdue normal)', () => {
    const it = item({
      recurrence: { freq: 'daily' },
      due_at: new Date(2026, 4, 25),
    });
    expect(isRecurringToday(it, today)).toBe(false);
  });
});

describe('recurNextLabel — etiqueta humana', () => {
  const today = new Date(2026, 4, 18); // lunes

  it('sin recurrencia → null', () => {
    expect(recurNextLabel(item(), today)).toBeNull();
  });

  it('due_at futuro → fecha formateada', () => {
    const it = item({
      recurrence: { freq: 'weekly' },
      due_at: new Date(2026, 4, 20),
    });
    expect(recurNextLabel(it, today)).toBe('20/05');
  });

  it('due_at mañana → "Mañana"', () => {
    const it = item({
      recurrence: { freq: 'daily' },
      due_at: new Date(2026, 4, 19),
    });
    expect(recurNextLabel(it, today)).toBe('Mañana');
  });

  it('daily sin due → "Hoy"', () => {
    expect(recurNextLabel(item({ recurrence: { freq: 'daily' } }), today)).toBe('Hoy');
  });

  it('weekly byDays sin anchor: hoy si toca, fecha si no', () => {
    const hoy = item({ recurrence: { freq: 'weekly', byDays: [1] } });
    expect(recurNextLabel(hoy, today)).toBe('Hoy');
    const proxJueves = item({ recurrence: { freq: 'weekly', byDays: [4] } });
    expect(recurNextLabel(proxJueves, today)).toBe('21/05');
  });

  it('weekly sin byDays sin anchor → "Semanal"', () => {
    expect(recurNextLabel(item({ recurrence: { freq: 'weekly' } }), today)).toBe('Semanal');
  });

  it('monthly sin anchor → "Mensual"', () => {
    expect(recurNextLabel(item({ recurrence: { freq: 'monthly' } }), today)).toBe('Mensual');
  });

  it('monthly anchor hoy → "Hoy"', () => {
    const it = item({
      recurrence: { freq: 'monthly' },
      due_at: new Date(2026, 3, 18),
    });
    expect(recurNextLabel(it, today)).toBe('Hoy');
  });

  it('monthly anchor día futuro este mes → fecha', () => {
    const it = item({
      recurrence: { freq: 'monthly' },
      due_at: new Date(2026, 3, 25),
    });
    expect(recurNextLabel(it, today)).toBe('25/05');
  });

  it('monthly anchor día ya pasado este mes → próximo mes', () => {
    const it = item({
      recurrence: { freq: 'monthly' },
      due_at: new Date(2026, 3, 10),
    });
    expect(recurNextLabel(it, today)).toBe('10/06');
  });
});
