// Eyebrow — small monospace label, used everywhere as a section caption.

import { Text, TextProps } from 'react-native';
import { theme } from '@/lib/theme';

export function Eyebrow({ children, style, ...rest }: TextProps) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: theme.fontMono,
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: theme.textDim,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
