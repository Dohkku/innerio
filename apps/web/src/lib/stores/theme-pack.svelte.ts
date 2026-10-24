/**
 * Theme pack store. Aplica el variant correspondiente del pack activo
 * sobre el toggle día/noche del usuario.
 *
 * Sincronización con `appearance.svelte`:
 *   - El usuario alterna día/noche/auto desde el Nav (botones theme).
 *     `appearance.setTheme()` setea `<html data-theme>`.
 *   - Este store observa el atributo + el media query para detectar el
 *     mode actual (light o dark) y aplica `pack.light` o `pack.dark`
 *     vía inline styles en `:root` — los 14 colour tokens + 6 shadow
 *     tokens. Los inline ganan especificidad sobre cualquier regla CSS.
 *
 * Pack default (`DEFAULT_PACK_ID = 'innerio'`) coincide con los valores
 * "hard-coded" en `appearance.css`. Al activarlo se hace clearAll() en
 * vez de override — así no nos arrastramos inline styles innecesarios.
 *
 * Storage: `gtd:theme-pack` con el `id` del pack. Side-effect del
 * import: si hay flag, re-aplica al cargar. Sobrevive a navegación
 * porque el side-effect vive en el module top-level.
 */
import {
  DEFAULT_PACK_ID,
  SHADOW_VARS,
  THEMES,
  TOKEN_VARS,
  type ThemePack,
  type Variant,
} from '$lib/appearance/themes';

const STORAGE_KEY = 'gtd:theme-pack';

type State = { packId: string };

const state = $state<State>({ packId: DEFAULT_PACK_ID });

function findPack(id: string): ThemePack | undefined {
  return THEMES.find((p) => p.id === id);
}

function currentMode(): 'light' | 'dark' {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 'light';
  const dt = document.documentElement.dataset.theme;
  if (dt === 'dark') return 'dark';
  if (dt === 'light') return 'light';
  // 'system' / unset → media query
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyVariant(v: Variant): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, varName] of TOKEN_VARS) {
    root.style.setProperty(varName, v.tokens[key]);
  }
  for (const [key, varName] of SHADOW_VARS) {
    root.style.setProperty(varName, v.shadows[key]);
  }
}

function clearAll(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [, varName] of TOKEN_VARS) root.style.removeProperty(varName);
  for (const [, varName] of SHADOW_VARS) root.style.removeProperty(varName);
}

function reapply(): void {
  const pack = findPack(state.packId);
  if (!pack) return;
  // El default ya está pintado por el CSS — limpiamos inline para no
  // arrastrar valores stale entre pack-switches.
  if (pack.id === DEFAULT_PACK_ID) {
    clearAll();
    return;
  }
  applyVariant(currentMode() === 'dark' ? pack.dark : pack.light);
}

export const themePack = {
  get activeId(): string {
    return state.packId;
  },
  get active(): ThemePack | undefined {
    return findPack(state.packId);
  },
  apply(id: string): void {
    if (!findPack(id)) return;
    state.packId = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // private mode / disabled — efecto inline sigue funcionando.
    }
    reapply();
  },
  reset(): void {
    state.packId = DEFAULT_PACK_ID;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    clearAll();
  },
};

// Side-effect: aplicar al cargar y conectar listeners para reaccionar
// a cambios del toggle día/noche o del media query (modo auto).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && findPack(saved)) {
      state.packId = saved;
      reapply();
    }
  } catch {
    // ignore
  }

  // Observa `<html data-theme>` para re-aplicar cuando setTheme() cambia
  // el modo. Filtro por `data-theme` para no spamear con otros mutations.
  const obs = new MutationObserver(reapply);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // Modo 'system': re-aplicar al cambiar prefers-color-scheme.
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', reapply);
  } else {
    // Safari < 14
    (mql as unknown as { addListener: (cb: () => void) => void }).addListener(reapply);
  }
}
