// Layout helpers — desktop-friendly clamps for screens originally designed
// for phone widths.

import { useWindowDimensions } from 'react-native';
import { theme } from './theme';

/** The width that screens should base their layout math on. Caps at
 *  theme.maxContentW so cards/blobs don't blow up on wide desktop browsers. */
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(width, theme.maxContentW);
}

/** Synchronous variant — for places where a hook can't be called (gesture
 *  callbacks, top-level constants). */
export function clampToContent(w: number): number {
  return Math.min(w, theme.maxContentW);
}
