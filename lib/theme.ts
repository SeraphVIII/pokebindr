// Theme tokens: obsidian and champagne gold with layered glass surfaces.

export const theme = {
  // ── Canvas ────────────────────────────────────────────────────────────
  bg:           '#0b0907',            // near-OLED warm black, every screen
  surface:      '#161210',            // cards, rows, sheets
  surface2:     '#1e1814',            // inset bevels, tracks
  surface3:     '#28211a',            // striped placeholders, chips

  // Layered glass: translucent warm fills that read as depth without native blur.
  shell:        'rgba(244,238,220,0.035)',  // double-bezel outer tray
  glass:        'rgba(244,238,220,0.05)',   // input + tile fills
  glassStrong:  'rgba(244,238,220,0.09)',   // hover/active fills, discs
  scrim:        'rgba(6,4,3,0.74)',         // modal backdrop

  // ── Lines ─────────────────────────────────────────────────────────────
  border:       'rgba(212,175,55,0.14)',    // default gold-tinted hairline
  borderStrong: 'rgba(212,175,55,0.34)',    // primary tiles, monogram
  hairline:     'rgba(244,238,220,0.08)',   // neutral hairline (non-gold)
  highlight:    'rgba(255,246,214,0.10)',   // inner top-edge light catch

  // ── Ink ───────────────────────────────────────────────────────────────
  text:    '#f5efdd',
  textDim: '#ab9d7e',
  textMute:'#645a45',

  // ── Accent (single accent: champagne gold) ───────────────────────────
  accent:      '#d4af37',
  accentBright:'#e8ca67',                   // gradient top / icon pop
  accentDeep:  '#9a7b22',                   // gradient bottom
  accent2:     '#8c6d1f',                   // avatar gradient terminus
  accentText:  '#171204',                   // ink on gold fills
  accentSoft:  'rgba(212,175,55,0.13)',     // tinted fills, active pills
  accentFaint: 'rgba(212,175,55,0.06)',     // faint washes, pressed rows
  accentGlow:  'rgba(212,175,55,0.30)',     // boxShadow color for gold glow

  // ── Status ────────────────────────────────────────────────────────────
  statusHave:   '#71a37e',
  statusWant:   '#cba24b',
  statusReally: '#cd6363',
  statusHaveSoft:   'rgba(113,163,126,0.14)',
  statusWantSoft:   'rgba(203,162,75,0.14)',
  statusReallySoft: 'rgba(205,99,99,0.16)',

  cardBg: '#1a1611',

  // ── Shape ─────────────────────────────────────────────────────────────
  // One radius system: sm for chips/inputs, base for cards/rows, lg for
  // hero tiles, xl for sheets/dialogs, pill for buttons + the dock.
  radiusSm: 10,
  radius:   14,
  radiusLg: 22,
  radiusXl: 28,
  pill:     999,

  // ── Shadows (new-arch boxShadow strings) ─────────────────────────────
  // Warm-tinted ambient drops + an inner light catch on elevated tiles.
  shadowAmbient: '0px 10px 30px rgba(0,0,0,0.45)',
  shadowSoft:    '0px 4px 16px rgba(0,0,0,0.35)',
  shadowInner:   'inset 0px 1px 0px rgba(255,246,214,0.10)',
  shadowGold:    '0px 6px 24px rgba(212,175,55,0.18)',

  // Maximum content width; wider viewports letterbox the app in the centre.
  maxContentW: 480,

  // Font families (Google Fonts), loaded in app/_layout.tsx via useFonts.
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
