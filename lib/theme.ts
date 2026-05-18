// Vault theme — obsidian + gold. Single direction in this codebase; add
// more by exporting another object and swapping `theme` at the root.

export const theme = {
  bg:           '#0c0a08',
  surface:      '#15110d',
  surface2:     '#1d1812',
  surface3:     '#27201a',
  border:       'rgba(212,175,55,0.14)',
  borderStrong: 'rgba(212,175,55,0.32)',

  text:    '#f4eedc',
  textDim: '#a89a7a',
  textMute:'#5e5440',

  accent:     '#d4af37',
  accent2:    '#8c6d1f',
  accentText: '#0c0a08',

  statusHave:   '#6b9a78',
  statusWant:   '#c8a04a',
  statusReally: '#c75c5c',

  cardBg: '#1a1611',
  radius: 8,

  // Font families — Google Fonts, loaded in app/_layout.tsx via useFonts.
  // Cormorant Garamond carries the "museum" feel for hero numbers and
  // titles; Manrope is the geometric humanist body face; JetBrains Mono
  // gives tabular pricing + the eyebrow chrome a clean engineered feel.
  fontDisplay:     'CormorantGaramond_500Medium',
  fontDisplaySemi: 'CormorantGaramond_600SemiBold',
  fontUI:          'Manrope_500Medium',
  fontUIBold:      'Manrope_700Bold',
  fontMono:        'IBMPlexMono_500Medium',
} as const;

export type Theme = typeof theme;

export const TYPE_COLOR: Record<string, string> = {
  Fire: '#e07654',
  Water: '#5a9fe0',
  Grass: '#7fb86c',
  Lightning: '#e6c454',
  Psychic: '#c870c8',
  Fighting: '#c08754',
  Darkness: '#5c5466',
  Metal: '#9ba4ad',
  Colorless: '#cfc8b8',
  Dragon: '#b89055',
  Fairy: '#e090b8',
};
