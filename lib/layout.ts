// Layout helpers: desktop-friendly clamps for phone-width screens.

import { useWindowDimensions } from 'react-native';
import { theme } from './theme';

/** Width screens should base layout math on, capped at theme.maxContentW. */
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(width, theme.maxContentW);
}

/** Non-hook variant for gesture callbacks and top-level constants. */
export function clampToContent(w: number): number {
  return Math.min(w, theme.maxContentW);
}
