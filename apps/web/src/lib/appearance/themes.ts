/**
 * Catálogo de theme packs. Cada pack define un par light+dark coherente
 * con sus respectivas shadows. El usuario alterna día/noche desde el Nav
 * con el toggle existente; el `theme-pack` store aplica el variant
 * correspondiente del pack activo. Cambiar de pack en
 * `/settings/appearance` cambia ambos modos a la vez.
 *
 * Tokens consumidos (14 colour + 6 shadow):
 *   --surface-base/raised/sunken/input
 *   --text-primary/secondary/muted
 *   --border-subtle/default/strong
 *   --accent/-hover/-muted/-contrast
 *   --shadow-float-lg/-sm, -inset-sm, -flat, -cascade-flat, -sunken-sm
 *
 * Para promover un pack a default duro, copiar light a `:root` y dark a
 * `[data-theme="dark"]` + `@media (prefers-color-scheme: dark)` en
 * `appearance.css`. Cuando un pack se promueve, el variant igual queda
 * aquí — el theme-pack lo aplica sobre lo del CSS sin daño (mismos
 * valores) y mantiene la opción visible en /settings/appearance.
 */

export type PaletteTokens = {
  surfaceBase: string;
  surfaceRaised: string;
  surfaceSunken: string;
  surfaceInput: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  accent: string;
  accentHover: string;
  accentMuted: string;
  accentContrast: string;
};

export type ShadowTokens = {
  floatLg: string;
  floatSm: string;
  insetSm: string;
  flat: string;
  cascadeFlat: string;
  sunkenSm: string;
};

export type Variant = {
  tokens: PaletteTokens;
  shadows: ShadowTokens;
};

export type ThemePack = {
  id: string;
  name: string;
  description: string;
  light: Variant;
  dark: Variant;
};

// === HELPERS =============================================================
// Light: pequeño tinte `halo` da el sabor (cremoso, azulado, etc.). Los
// negros internos quedan iguales — la regla "hundido lee oscuro" se
// mantiene en todos los packs.
function shLight(halo = '50, 50, 93'): ShadowTokens {
  return {
    floatLg: `rgba(${halo}, 0.22) 0 30px 60px -12px, rgba(0, 0, 0, 0.25) 0 18px 36px -18px`,
    floatSm: `rgba(${halo}, 0.22) 0 2px 5px -1px, rgba(0, 0, 0, 0.25) 0 1px 3px -1px`,
    insetSm: `inset 0 2px 4px rgba(0, 0, 0, 0.22), inset 0 1px 2px rgba(${halo}, 0.16)`,
    flat: 'rgba(0, 0, 0, 0.10) 0 1px 3px, rgba(0, 0, 0, 0.20) 0 1px 2px',
    cascadeFlat: 'rgba(0, 0, 0, 0.08) 0 1px 2px 0',
    sunkenSm: 'inset 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(0, 0, 0, 0.04)',
  };
}

// Dark: halos negros saturados. El opcional `glow` añade un acento muy
// sutil del accent en `shadow-float-lg` (tipo phosphor CRT, halo de neón).
function shDark(glow?: string): ShadowTokens {
  const glowLayer = glow ? `, rgba(${glow}, 0.05) 0 0 24px -4px` : '';
  return {
    floatLg: `rgba(0, 0, 0, 0.55) 0 30px 60px -12px, rgba(0, 0, 0, 0.4) 0 18px 36px -18px${glowLayer}`,
    floatSm: 'rgba(0, 0, 0, 0.5) 0 2px 5px -1px, rgba(0, 0, 0, 0.35) 0 1px 3px -1px',
    insetSm: 'inset 0 2px 4px rgba(0, 0, 0, 0.55), inset 0 1px 2px rgba(0, 0, 0, 0.4)',
    flat: 'rgba(0, 0, 0, 0.45) 0 1px 3px, rgba(0, 0, 0, 0.55) 0 1px 2px',
    cascadeFlat: 'rgba(0, 0, 0, 0.4) 0 1px 2px 0',
    sunkenSm: 'inset 0 1px 2px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(0, 0, 0, 0.25)',
  };
}

// === PACKS ===============================================================
export const THEMES: ThemePack[] = [
  // 1 — Innerio (default). Verde hoja claro + dohkku terminal noche.
  {
    id: 'innerio',
    name: 'Innerio',
    description: 'Default. Verde hoja de día, terminal dohkku con verde matrix de noche.',
    light: {
      tokens: {
        surfaceBase: 'hsl(95, 30%, 95%)',
        surfaceRaised: 'hsl(95, 35%, 98%)',
        surfaceSunken: 'hsl(95, 25%, 89%)',
        surfaceInput: 'hsl(95, 35%, 98%)',
        textPrimary: 'hsl(95, 10%, 12%)',
        textSecondary: 'hsl(95, 8%, 34%)',
        textMuted: 'hsl(95, 8%, 60%)',
        borderSubtle: 'hsl(95, 15%, 84%)',
        borderDefault: 'hsl(95, 12%, 72%)',
        borderStrong: 'hsl(95, 10%, 55%)',
        accent: 'hsl(95, 45%, 32%)',
        accentHover: 'hsl(95, 50%, 24%)',
        accentMuted: 'hsl(95, 35%, 86%)',
        accentContrast: '#ffffff',
      },
      shadows: shLight('50, 50, 93'),
    },
    dark: {
      tokens: {
        surfaceBase: '#181818',
        surfaceRaised: '#252525',
        surfaceSunken: '#0a0a0a',
        surfaceInput: '#1f1f1f',
        textPrimary: '#d1d1d1',
        textSecondary: '#888888',
        textMuted: '#555555',
        borderSubtle: '#1a1a1a',
        borderDefault: '#333333',
        borderStrong: '#555555',
        accent: '#00ff42',
        accentHover: '#4dff7a',
        accentMuted: '#1a3a20',
        accentContrast: '#181818',
      },
      shadows: shDark('0, 255, 66'),
    },
  },

  // 2 — Paper. Crema cálido tipo libro + sepia oscuro nocturno.
  {
    id: 'paper',
    name: 'Paper',
    description:
      'Papel crema de día con accent marrón cálido, sepia oscuro de noche con accent ámbar.',
    light: {
      tokens: {
        surfaceBase: 'hsl(40, 28%, 92%)',
        surfaceRaised: 'hsl(45, 35%, 98%)',
        surfaceSunken: 'hsl(38, 22%, 84%)',
        surfaceInput: 'hsl(45, 40%, 99%)',
        textPrimary: 'hsl(30, 18%, 14%)',
        textSecondary: 'hsl(30, 12%, 34%)',
        textMuted: 'hsl(30, 10%, 50%)',
        borderSubtle: 'hsl(38, 22%, 82%)',
        borderDefault: 'hsl(38, 18%, 68%)',
        borderStrong: 'hsl(35, 14%, 48%)',
        accent: 'hsl(25, 60%, 38%)',
        accentHover: 'hsl(25, 65%, 28%)',
        accentMuted: 'hsl(35, 35%, 86%)',
        accentContrast: '#fffaf0',
      },
      shadows: shLight('80, 60, 30'),
    },
    dark: {
      tokens: {
        surfaceBase: '#1f1812',
        surfaceRaised: '#2c241c',
        surfaceSunken: '#140f0a',
        surfaceInput: '#3a3024',
        textPrimary: '#ede2cf',
        textSecondary: '#b5a48a',
        textMuted: '#7c6e5a',
        borderSubtle: '#332a20',
        borderDefault: '#4a3e2e',
        borderStrong: '#6d5c45',
        accent: '#e6a445',
        accentHover: '#f5b95c',
        accentMuted: '#3a2a14',
        accentContrast: '#1f1812',
      },
      shadows: shDark('230, 164, 69'),
    },
  },

  // 3 — Notion. Neutro frío clínico, profesional.
  {
    id: 'notion',
    name: 'Notion',
    description:
      'Gris neutro frío en ambos modos. Accent azul oscuro. Profesional, sin sesgo de color.',
    light: {
      tokens: {
        surfaceBase: 'hsl(220, 8%, 96%)',
        surfaceRaised: 'hsl(220, 14%, 99%)',
        surfaceSunken: 'hsl(220, 6%, 88%)',
        surfaceInput: 'hsl(220, 18%, 100%)',
        textPrimary: 'hsl(220, 14%, 12%)',
        textSecondary: 'hsl(220, 10%, 32%)',
        textMuted: 'hsl(220, 8%, 52%)',
        borderSubtle: 'hsl(220, 12%, 84%)',
        borderDefault: 'hsl(220, 10%, 70%)',
        borderStrong: 'hsl(220, 8%, 48%)',
        accent: 'hsl(220, 55%, 38%)',
        accentHover: 'hsl(220, 60%, 30%)',
        accentMuted: 'hsl(220, 25%, 88%)',
        accentContrast: '#ffffff',
      },
      shadows: shLight('60, 65, 95'),
    },
    dark: {
      tokens: {
        surfaceBase: '#191b1f',
        surfaceRaised: '#252830',
        surfaceSunken: '#0e0f12',
        surfaceInput: '#2c303a',
        textPrimary: '#d8dce4',
        textSecondary: '#9ba3b0',
        textMuted: '#5e6573',
        borderSubtle: '#1f2229',
        borderDefault: '#373c47',
        borderStrong: '#565d6c',
        accent: '#6c8eff',
        accentHover: '#8aa3ff',
        accentMuted: '#1d2540',
        accentContrast: '#0f1216',
      },
      shadows: shDark(),
    },
  },

  // 4 — Solarized. Receta consagrada de Ethan Schoonover.
  {
    id: 'solarized',
    name: 'Solarized',
    description: 'Paleta clásica. Light papiro beige + dark navy profundo con accents calibrados.',
    light: {
      tokens: {
        surfaceBase: '#fdf6e3',
        surfaceRaised: '#fffaee',
        surfaceSunken: '#eee8d5',
        surfaceInput: '#ffffff',
        textPrimary: '#586e75',
        textSecondary: '#657b83',
        textMuted: '#93a1a1',
        borderSubtle: '#eee8d5',
        borderDefault: '#dccdb3',
        borderStrong: '#93a1a1',
        accent: '#268bd2',
        accentHover: '#1f6fa8',
        accentMuted: '#e3d7b0',
        accentContrast: '#fdf6e3',
      },
      shadows: shLight('101, 123, 131'),
    },
    dark: {
      tokens: {
        surfaceBase: '#002b36',
        surfaceRaised: '#073642',
        surfaceSunken: '#001f27',
        surfaceInput: '#0a4452',
        textPrimary: '#fdf6e3',
        textSecondary: '#93a1a1',
        textMuted: '#586e75',
        borderSubtle: '#073642',
        borderDefault: '#1b4a55',
        borderStrong: '#586e75',
        accent: '#b58900',
        accentHover: '#d9a200',
        accentMuted: '#1a3540',
        accentContrast: '#002b36',
      },
      shadows: shDark('181, 137, 0'),
    },
  },

  // 5 — Nord. Polar arctic, frío azulado.
  {
    id: 'nord',
    name: 'Nord',
    description: 'Paleta nórdica. Frost azul claro de día, polar night oscuro de noche.',
    light: {
      tokens: {
        surfaceBase: '#eceff4',
        surfaceRaised: '#f5f7fa',
        surfaceSunken: '#d8dee9',
        surfaceInput: '#ffffff',
        textPrimary: '#2e3440',
        textSecondary: '#4c566a',
        textMuted: '#7b8494',
        borderSubtle: '#d8dee9',
        borderDefault: '#c4ccd9',
        borderStrong: '#7b8494',
        accent: '#5e81ac',
        accentHover: '#4a6b94',
        accentMuted: '#dde4ee',
        accentContrast: '#ffffff',
      },
      shadows: shLight('76, 86, 106'),
    },
    dark: {
      tokens: {
        surfaceBase: '#2e3440',
        surfaceRaised: '#3b4252',
        surfaceSunken: '#242832',
        surfaceInput: '#434c5e',
        textPrimary: '#eceff4',
        textSecondary: '#d8dee9',
        textMuted: '#7b8494',
        borderSubtle: '#3b4252',
        borderDefault: '#4c566a',
        borderStrong: '#7b8494',
        accent: '#88c0d0',
        accentHover: '#a3d2dd',
        accentMuted: '#2c3b48',
        accentContrast: '#2e3440',
      },
      shadows: shDark('136, 192, 208'),
    },
  },

  // 6 — Sunset. Cálido atrevido, magenta/coral.
  {
    id: 'sunset',
    name: 'Sunset',
    description:
      'Cálido y atrevido. Melocotón de día con accent magenta, ciruela oscuro de noche con coral.',
    light: {
      tokens: {
        surfaceBase: 'hsl(22, 35%, 94%)',
        surfaceRaised: 'hsl(22, 45%, 99%)',
        surfaceSunken: 'hsl(20, 28%, 86%)',
        surfaceInput: 'hsl(22, 50%, 100%)',
        textPrimary: 'hsl(345, 22%, 14%)',
        textSecondary: 'hsl(345, 15%, 34%)',
        textMuted: 'hsl(345, 12%, 52%)',
        borderSubtle: 'hsl(20, 25%, 84%)',
        borderDefault: 'hsl(20, 20%, 68%)',
        borderStrong: 'hsl(345, 14%, 48%)',
        accent: 'hsl(340, 60%, 42%)',
        accentHover: 'hsl(340, 65%, 32%)',
        accentMuted: 'hsl(340, 30%, 88%)',
        accentContrast: '#ffffff',
      },
      shadows: shLight('120, 50, 60'),
    },
    dark: {
      tokens: {
        surfaceBase: '#1c1015',
        surfaceRaised: '#2a181f',
        surfaceSunken: '#10080b',
        surfaceInput: '#34202a',
        textPrimary: '#f0d8db',
        textSecondary: '#c08a92',
        textMuted: '#805058',
        borderSubtle: '#2c1820',
        borderDefault: '#48262f',
        borderStrong: '#74404c',
        accent: '#ff7090',
        accentHover: '#ff90a8',
        accentMuted: '#3a1820',
        accentContrast: '#1c1015',
      },
      shadows: shDark('255, 112, 144'),
    },
  },
];

// === CSS VAR MAPPING =====================================================
export const TOKEN_VARS: [keyof PaletteTokens, string][] = [
  ['surfaceBase', '--surface-base'],
  ['surfaceRaised', '--surface-raised'],
  ['surfaceSunken', '--surface-sunken'],
  ['surfaceInput', '--surface-input'],
  ['textPrimary', '--text-primary'],
  ['textSecondary', '--text-secondary'],
  ['textMuted', '--text-muted'],
  ['borderSubtle', '--border-subtle'],
  ['borderDefault', '--border-default'],
  ['borderStrong', '--border-strong'],
  ['accent', '--accent'],
  ['accentHover', '--accent-hover'],
  ['accentMuted', '--accent-muted'],
  ['accentContrast', '--accent-contrast'],
];

export const SHADOW_VARS: [keyof ShadowTokens, string][] = [
  ['floatLg', '--shadow-float-lg'],
  ['floatSm', '--shadow-float-sm'],
  ['insetSm', '--shadow-inset-sm'],
  ['flat', '--shadow-flat'],
  ['cascadeFlat', '--shadow-cascade-flat'],
  ['sunkenSm', '--shadow-sunken-sm'],
];

export const DEFAULT_PACK_ID = 'innerio';
