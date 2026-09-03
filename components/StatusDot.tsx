// Coloured dot indicating collection status.

import { View } from 'react-native';
import { statusColor } from './CardSlot';
import type { Status } from '@/lib/types';

interface Props {
  status: Status | 'missing';
  size?: number;
}

export function StatusDot({ status, size = 8 }: Props) {
  const c = statusColor(status);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c,
        shadowColor: c,
        shadowOpacity: status === 'really' ? 0.8 : 0,
        shadowRadius: 4,
      }}
    />
  );
}
