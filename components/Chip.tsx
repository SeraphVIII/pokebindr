// Toggle pill used in filter bars and status pickers.

import { Text } from 'react-native';
import { PressableScale } from '@/components/ui';
import { theme } from '@/lib/theme';

interface Props {
  label: string;
  active?: boolean;
  color?: string;
  onPress?: () => void;
}

export function Chip({ label, active, color, onPress }: Props) {
  const c = color ?? theme.accent;
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.94}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 14,
        paddingVertical: 8,
        minHeight: 34,
        justifyContent: 'center',
        borderRadius: theme.pill,
        borderWidth: 1,
        borderColor: active ? c : theme.hairline,
        backgroundColor: active ? `${c}26` : theme.glass,
      }}
    >
      <Text style={{
        fontFamily: theme.fontUIBold,
        fontSize: 11,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: active ? c : theme.textDim,
      }}>{label}</Text>
    </PressableScale>
  );
}
