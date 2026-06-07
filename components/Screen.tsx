// Screen — full-bleed container with the Vault background + safe-area
// padding, used by every route. Desktop max-width centering is applied
// once at the root layout, so Screen itself stays simple.

import { PropsWithChildren } from 'react';
import { View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';

interface Props extends PropsWithChildren {
  style?: ViewStyle;
  edges?: ('top' | 'right' | 'bottom' | 'left')[];
}

export function Screen({ children, style, edges = ['top', 'left', 'right'] }: Props) {
  return (
    <SafeAreaView
      edges={edges}
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </SafeAreaView>
  );
}
