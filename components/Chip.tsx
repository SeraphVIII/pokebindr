// Chip — small toggle pill used in filter bars and status pickers.

import { Pressable, Text } from 'react-native';
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
    <Pressable
      onPress={onPress}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? c : theme.border,
        backgroundColor: active ? c : 'transparent',
      }}
    >
      <Text style={{
        fontFamily: theme.fontUIBold,
        fontSize: 11,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        color: active ? theme.accentText : theme.textDim,
      }}>{label}</Text>
    </Pressable>
  );
}
