/**
 * Svelte action: hover (mouse) o long-press (touch) hace marquee-scroll del
 * primer hijo del nodo cuando su contenido se desborda visualmente. El nodo
 * action es el contenedor visible (clipea overflow); su firstElementChild
 * es el texto deslizable. El listener real va al `button` más cercano para
 * que el hover/press se detecte sobre toda la fila.
 *
 * Touch: long-press de HOLD_MS dispara la marquee. Si el dedo se mueve más
 * de MOVE_CANCEL_PX antes del hold, se asume scroll de lista y se cancela.
 * Si la marquee sí dispara, el click sintético posterior se suprime para no
 * abrir el item por accidente.
 *
 * Mouse compat tras touch: browsers disparan mouseenter/leave tras un tap.
 * Marcamos lastTouchTs y descartamos esos eventos dentro de la ventana de
 * compat (~500ms) para que un tap simple no dispare la marquee.
 *
 * La transición se aplica con `!important` para sobrescribir la regla
 * global de `prefers-reduced-motion` (la marquee es un reveal funcional,
 * no decoración).
 */
export function scrollMarquee(node: HTMLElement): { destroy(): void } {
  const innerRaw = node.firstElementChild;
  const btnRaw = node.closest('button');
  // Re-binding tras el guard es lo que permite a TS estrechar el tipo a
  // HTMLElement dentro de las closures internas (sin el rebind, TS no
  // garantiza que el valor siga siendo no-null cuando la closure se ejecute
  // de forma asíncrona vía addEventListener).
  if (!(innerRaw instanceof HTMLElement) || !(btnRaw instanceof HTMLElement)) {
    return { destroy() {} };
  }
  const inner = innerRaw;
  const btn = btnRaw;

  // Baseline inline transform. Sin esto, primer hover transiciona desde
  // `transform: none` y algunos engines (Webkit) no interpolan y aplican
  // el target en una sola frame — la marquee se siente instantánea.
  inner.style.transform = 'translateX(0)';
  inner.style.willChange = 'transform';

  const HOLD_MS = 400;
  const MOVE_CANCEL_PX = 8;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;
  let suppressClickTimer: ReturnType<typeof setTimeout> | null = null;
  let activePointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let marqueeFired = false;
  let lastTouchTs = 0;

  function enter() {
    const overflow = inner.offsetWidth - node.clientWidth;
    if (overflow <= 2) return;
    // 28 px/s — calm "marquee read" speed. ease-in-out so el arranque y el
    // final no se sienten abruptos. 450ms delay = pausa "leí, ahora muéstrame
    // el resto". Cap 8s para que títulos muy largos no tarden 15s+.
    const dur = Math.max(1.2, Math.min(8, overflow / 28));
    inner.style.setProperty(
      'transition',
      `transform ${dur}s cubic-bezier(0.4, 0, 0.2, 1) 450ms`,
      'important',
    );
    void inner.offsetWidth; // flush layout para commit del transition
    inner.style.transform = `translateX(${-overflow}px)`;
    marqueeFired = true;
  }

  function leave() {
    // Retorno proporcional al overflow (~180 px/s, cap 2.5s) — más rápido
    // que enter pero sin slingshot. ease-in-out simétrico con enter.
    const overflow = Math.max(0, inner.offsetWidth - node.clientWidth);
    const dur = Math.max(0.65, Math.min(2.5, overflow / 180));
    inner.style.setProperty(
      'transition',
      `transform ${dur}s cubic-bezier(0.4, 0, 0.2, 1)`,
      'important',
    );
    void inner.offsetWidth;
    inner.style.transform = 'translateX(0)';
  }

  function clearHold() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  function onMouseEnter() {
    if (Date.now() - lastTouchTs < 500) return;
    enter();
  }

  function onMouseLeave() {
    if (Date.now() - lastTouchTs < 500) return;
    leave();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'touch') lastTouchTs = Date.now();
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    marqueeFired = false;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      enter();
    }, HOLD_MS);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    if (
      Math.abs(e.clientX - startX) > MOVE_CANCEL_PX ||
      Math.abs(e.clientY - startY) > MOVE_CANCEL_PX
    ) {
      clearHold();
      activePointerId = null;
    }
  }

  function onPointerEnd(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    clearHold();
    activePointerId = null;
    if (marqueeFired) {
      leave();
      suppressClick = true;
      if (suppressClickTimer) clearTimeout(suppressClickTimer);
      suppressClickTimer = setTimeout(() => {
        suppressClick = false;
      }, 400);
    }
  }

  function clickGuard(e: MouseEvent) {
    if (!suppressClick) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    suppressClick = false;
    if (suppressClickTimer) {
      clearTimeout(suppressClickTimer);
      suppressClickTimer = null;
    }
  }

  btn.addEventListener('mouseenter', onMouseEnter);
  btn.addEventListener('mouseleave', onMouseLeave);
  btn.addEventListener('pointerdown', onPointerDown);
  btn.addEventListener('pointermove', onPointerMove);
  btn.addEventListener('pointerup', onPointerEnd);
  btn.addEventListener('pointercancel', onPointerEnd);
  btn.addEventListener('click', clickGuard, { capture: true });

  return {
    destroy() {
      clearHold();
      if (suppressClickTimer) clearTimeout(suppressClickTimer);
      btn.removeEventListener('mouseenter', onMouseEnter);
      btn.removeEventListener('mouseleave', onMouseLeave);
      btn.removeEventListener('pointerdown', onPointerDown);
      btn.removeEventListener('pointermove', onPointerMove);
      btn.removeEventListener('pointerup', onPointerEnd);
      btn.removeEventListener('pointercancel', onPointerEnd);
      btn.removeEventListener('click', clickGuard, { capture: true });
    },
  };
}
