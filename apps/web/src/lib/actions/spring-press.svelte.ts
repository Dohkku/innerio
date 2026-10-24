/**
 * springPress — Svelte action que aplica feedback "muelle bajo el botón"
 * a cualquier elemento clicable.
 *
 * Defaults afinados en `/sandbox/buttons` (S3 "Muelle suelo", damping
 * subido a 0.30 a petición): el botón baja al presionar y, al soltar,
 * el spring cruza el reposo con momentum → salta arriba ~1.5px antes
 * de asentar. Lee como si hubiera un muelle físico bajo el botón.
 *
 * Escribe `--y` en `node.style` cada frame que el spring se mueve.
 * El consumidor lo lee con `transform: translateY(var(--y, 0px))` en
 * el elemento que quiere mover (puede ser el propio nodo o un hijo).
 *
 * Para combinar con un offset persistente (ej. un toggle "checked"
 * que se queda 1px hundido), usar:
 *   transform: translateY(calc(var(--y, 0px) + 1px));
 *
 * Coste: una instancia de Spring + un $effect por elemento. Aceptable
 * en listas de decenas de filas. Si una vista pasa a cientos, mover
 * a un solo controlador global con delegación de eventos.
 */
import { Spring } from 'svelte/motion';

export type SpringPressOpts = {
  stiffness?: number;
  damping?: number;
  /** Px bajado en mousedown sostenido. */
  pressY?: number;
  /** Px bajado en hover (sin click). 0 desactiva el hover. */
  hoverY?: number;
};

export function springPress(node: HTMLElement, opts: SpringPressOpts = {}) {
  const stiffness = opts.stiffness ?? 0.18;
  const damping = opts.damping ?? 0.3;
  const pressY = opts.pressY ?? 4;
  const hoverY = opts.hoverY ?? 1;

  const s = new Spring(0, { stiffness, damping });

  // Spring.current es $state-backed: leerlo dentro de un $effect re-corre
  // el efecto cada frame que cambia. $effect.root nos da un scope fuera
  // de un componente (las actions corren en setup del componente padre
  // pero el efecto necesita su propio root para limpiarse en destroy).
  const stop = $effect.root(() => {
    $effect(() => {
      node.style.setProperty('--y', `${s.current}px`);
    });
  });

  function onEnter(): void {
    s.target = hoverY;
  }
  function onLeave(): void {
    s.target = 0;
  }
  function onDown(): void {
    s.target = pressY;
  }
  function onUp(): void {
    s.target = 0;
  }

  node.addEventListener('pointerenter', onEnter);
  node.addEventListener('pointerleave', onLeave);
  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onLeave);

  return {
    destroy(): void {
      stop();
      node.removeEventListener('pointerenter', onEnter);
      node.removeEventListener('pointerleave', onLeave);
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onLeave);
    },
  };
}
