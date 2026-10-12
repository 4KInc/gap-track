/**
 * Ten-foot design tokens.
 *
 * A television is read from across a room by someone who is not leaning in,
 * so nothing here is sized like a phone. Body text starts at 20px, the
 * smallest label is 14, and focus is signalled by a 3px border rather than a
 * tint — a colour shift alone is invisible at distance and unusable for the
 * viewers this app exists for.
 *
 * The palette is deliberately dark: this sits behind video, and a light
 * ground would bloom on an OLED panel in a dim room.
 */

export const colour = {
  ground: '#0C1113',
  surface: '#141A1C',
  surfaceLift: '#1B2325',
  ink: '#E6ECEB',
  inkMuted: '#8B9A9B',
  line: '#253032',

  /** Admitted, focused, affirmative. */
  accent: '#4FBAC1',
  accentSoft: '#123338',

  /** Dropped, held, anything the viewer should notice but not fear. */
  signal: '#D99A3E',
  signalSoft: '#33260F',

  scrim: 'rgba(8, 12, 13, 0.82)',
} as const;

export const type = {
  display: 34,
  title: 26,
  body: 20,
  label: 16,
  tiny: 14,
} as const;

export const space = {
  xs: 6,
  sm: 12,
  md: 20,
  lg: 32,
  xl: 48,
  /** TV panels overscan; keep anything meaningful inside this margin. */
  safe: 48,
} as const;

/** Monospace for anything where digits must line up or be compared. */
export const mono = 'monospace';

export const radius = { sm: 4, md: 8 } as const;
