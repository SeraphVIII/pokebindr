// CardSlot — the visual binder slot.
// In v1 we just render the real card image from PokemonTCG.io (with status
// border). The placeholder version from the prototype lives below as
// EmptySlot for un-acquired cards.

import { Image, Pressable, View, Text } from 'react-native';
import { theme } from '@/lib/theme';
import type { CollectionRow, Status } from '@/lib/types';

interface Props {
  row: CollectionRow;
  width: number;
  onPress?: () => void;
  onLongPress?: () => void;
}

export function statusColor(s: Status | 'missing') {
  return s === 'have' ? theme.statusHave
    : s === 'want' ? theme.statusWant
    : s === 'really' ? theme.statusReally
    : theme.textMute;
}

export function CardSlot({ row, width, onPress, onLongPress }: Props) {
  const h = width * 1.4;
  const col = statusColor(row.status);
  const isReally = row.status === 'really';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        width,
        height: h,
        borderRadius: Math.max(4, width * 0.07),
        borderWidth: isReally ? 2.5 : 1.5,
        borderColor: col,
        backgroundColor: theme.cardBg,
        overflow: 'hidden',
        transform: [{ scale: pressed ? 0.98 : 1 }],
        shadowColor: col,
        shadowOpacity: isReally ? 0.55 : 0.25,
        shadowRadius: isReally ? 10 : 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: isReally ? 8 : 0,
      })}
    >
      {row.image_small ? (
        <Image
          source={{ uri: row.image_small }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <View style={{
          flex: 1, alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{
            fontFamily: theme.fontDisplay,
            color: theme.text, fontSize: width * 0.12,
          }}>{row.card_name}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function EmptySlot({ width, label = '+', onPress }: { width: number; label?: string; onPress?: () => void }) {
  const h = width * 1.4;
  return (
    <Pressable
      onPress={onPress}
      style={{
        width, height: h,
        borderRadius: Math.max(4, width * 0.07),
        borderWidth: 1, borderColor: theme.textMute,
        borderStyle: 'dashed',
        alignItems: 'center', justifyContent: 'center',
        opacity: 0.55,
      }}
    >
      <Text style={{
        fontFamily: theme.fontMono,
        color: theme.textMute,
        fontSize: Math.max(14, width * 0.22),
      }}>{label}</Text>
    </Pressable>
  );
}
