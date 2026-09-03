// Binder card slot with a status-coloured border. EmptySlot is the placeholder.

import { Image, Pressable, View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
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
        borderRadius: Math.max(6, width * 0.08),
        borderWidth: isReally ? 2 : 1.5,
        borderColor: col,
        backgroundColor: theme.cardBg,
        overflow: 'hidden',
        transform: [{ scale: pressed ? 0.96 : 1 }],
        boxShadow: isReally
          ? `0px 4px 18px rgba(205,99,99,0.40)`
          : theme.shadowSoft,
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
          flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6,
        }}>
          <Text
            numberOfLines={3}
            style={{
              fontFamily: theme.fontDisplay,
              color: theme.text, fontSize: Math.max(11, width * 0.11),
              textAlign: 'center',
            }}
          >{row.card_name}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function EmptySlot({ width, label, onPress }: { width: number; label?: string; onPress?: () => void }) {
  const h = width * 1.4;
  const discSize = Math.max(22, Math.min(34, width * 0.28));
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width, height: h,
        borderRadius: Math.max(6, width * 0.08),
        borderWidth: 1, borderColor: theme.hairline,
        borderStyle: 'dashed',
        backgroundColor: theme.glass,
        alignItems: 'center', justifyContent: 'center',
        gap: 6,
        opacity: pressed ? 0.85 : 0.65,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {label ? (
        <Text style={{
          fontFamily: theme.fontMono,
          color: theme.textMute,
          fontSize: Math.max(12, width * 0.16),
        }}>{label}</Text>
      ) : (
        <View style={{
          width: discSize, height: discSize, borderRadius: theme.pill,
          backgroundColor: theme.glassStrong,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name="plus" size={discSize * 0.5} color={theme.textMute} />
        </View>
      )}
    </Pressable>
  );
}
