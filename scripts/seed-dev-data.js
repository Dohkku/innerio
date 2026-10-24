// Seed data for smoke testing — paste in DevTools Console at http://localhost:5173
// Reads window.triplit (exposed in dev). Run once. Re-runs duplicate.
// To wipe: DevTools → Application → IndexedDB → delete the Triplit DB → reload.
//
// 2026-05-18: schema actual = `items` + `settings`. Fuera areas, contexts,
// goals, reflections, state-field, type-field, defer_until, scheduled_at.

(async () => {
  const t = window.triplit;
  if (!t) {
    console.error('window.triplit not found — open the app first.');
    return;
  }

  const now = new Date();
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const tenDaysAgo = new Date(today.getTime() - 10 * 86_400_000);

  // --- inbox sin clarificar ---
  await t.insert('items', { title: 'Pensar regalo aniversario', position: 'a0' });
  await t.insert('items', { title: 'Llamar al fontanero', position: 'a1' });
  await t.insert('items', { title: 'Idea: app de hábitos', position: 'a2' });

  // --- next con metadata variada ---
  await t.insert('items', {
    title: 'Responder email cliente Acme',
    clarified_at: now,
    energy: 'low',
    estimate_minutes: 15,
    position: 'b0',
  });
  await t.insert('items', {
    title: 'Preparar presentación Q2',
    clarified_at: now,
    energy: 'high',
    estimate_minutes: 90,
    position: 'b1',
  });
  await t.insert('items', {
    title: 'Comprar leche y pan',
    clarified_at: now,
    energy: 'low',
    estimate_minutes: 20,
    position: 'b2',
  });
  await t.insert('items', {
    title: 'Salir a correr 30 min',
    clarified_at: now,
    energy: 'medium',
    estimate_minutes: 30,
    position: 'b3',
  });

  // 1 due hoy
  await t.insert('items', {
    title: 'Pagar factura luz',
    clarified_at: now,
    estimate_minutes: 10,
    due_at: today,
    position: 'b4',
  });

  // 1 overdue
  await t.insert('items', {
    title: 'Renovar DNI',
    clarified_at: now,
    estimate_minutes: 45,
    due_at: yesterday,
    position: 'b5',
  });

  // 1 reunión hoy
  await t.insert('items', {
    title: 'Reunión 1:1 con María',
    clarified_at: now,
    due_at: today,
    position: 'c0',
  });

  // waiting
  await t.insert('items', {
    title: 'Respuesta de Banco sobre hipoteca',
    clarified_at: now,
    waiting_for: 'Banco',
    waiting_since: yesterday,
    position: 'd0',
  });

  // someday
  await t.insert('items', {
    title: 'Aprender japonés',
    clarified_at: now,
    someday_at: now,
    position: 'e0',
  });
  await t.insert('items', {
    title: 'Bicicleta gravel',
    clarified_at: now,
    someday_at: now,
    position: 'e1',
  });

  // reference
  await t.insert('items', {
    title: 'Receta tarta zanahoria',
    clarified_at: now,
    reference_at: now,
    position: 'f0',
  });
  await t.insert('items', {
    title: 'Manual del horno',
    clarified_at: now,
    reference_at: now,
    position: 'f1',
  });

  // Proyecto SANO con 2 children (1 next, 1 inbox)
  const projSano = await t.insert('items', {
    title: 'Reformar baño',
    clarified_at: now,
    outcome: 'Baño nuevo terminado y operativo',
    is_sequential: true,
    position: 'p0',
  });
  await t.insert('items', {
    title: 'Pedir presupuestos a 3 fontaneros',
    clarified_at: now,
    parent_id: projSano.id,
    energy: 'low',
    estimate_minutes: 20,
    position: 'a0',
  });
  await t.insert('items', {
    title: 'Decidir tipo de ducha',
    parent_id: projSano.id,
    position: 'a1',
  });

  // Proyecto ESTANCADO por H1 (sin children en next)
  const projStalled = await t.insert('items', {
    title: 'Plan de ahorro 2026',
    clarified_at: now,
    outcome: 'Aumentar ahorro mensual 20%',
    is_sequential: true,
    position: 'p1',
  });
  await t.insert('items', {
    title: 'Investigar fondos indexados',
    clarified_at: now,
    someday_at: now,
    parent_id: projStalled.id,
    position: 'a0',
  });

  // Proyecto ESTANCADO por H3 (children pero todo viejo, >7 días)
  const projOld = await t.insert('items', {
    title: 'Lanzar blog técnico',
    clarified_at: now,
    outcome: 'Primer post publicado',
    is_sequential: true,
    position: 'p2',
    created_at: tenDaysAgo,
  });
  await t.update('items', projOld.id, (e) => {
    e.updated_at = tenDaysAgo;
  });
  const childOld = await t.insert('items', {
    title: 'Elegir plataforma (Hugo / Astro / 11ty)',
    clarified_at: now,
    parent_id: projOld.id,
    energy: 'medium',
    estimate_minutes: 60,
    position: 'a0',
    created_at: tenDaysAgo,
  });
  await t.update('items', childOld.id, (e) => {
    e.updated_at = tenDaysAgo;
  });

  console.log('✅ Seed completo. Recarga la página.');
})();
