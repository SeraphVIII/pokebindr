// Tracks which binder the user most recently added a card to. Persisted in
// AsyncStorage so it survives reloads; mirrored into React Query so a write
// re-renders any subscriber immediately.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const KEY = 'lastBinderId';
const QK = ['lastBinderId'] as const;

export function useLastBinder() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: QK,
    queryFn: async () => (await AsyncStorage.getItem(KEY)) ?? null,
    staleTime: Infinity,
  });
  const setLastBinder = async (id: string) => {
    await AsyncStorage.setItem(KEY, id);
    qc.setQueryData(QK, id);
  };
  return { lastBinderId: data ?? null, setLastBinder };
}
