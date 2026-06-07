// /share/[token] — open an unlisted binder. Accessible without an account.

import { useLocalSearchParams } from 'expo-router';
import { View, Text, ActivityIndicator } from 'react-native';
import { Screen } from '@/components/Screen';
import { PublicBinderView } from '@/components/PublicBinderView';
import { useBinderByShareToken } from '@/lib/queries';
import { theme } from '@/lib/theme';

export default function SharedBinder() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { data, isLoading, error } = useBinderByShareToken(token);

  if (isLoading) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </Screen>
    );
  }
  if (error || !data) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: theme.fontDisplay, fontSize: 22, color: theme.text }}>
            Binder unavailable
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 13, textAlign: 'center' }}>
            This link has expired, been revoked, or the binder is now private.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <PublicBinderView
      binder={data.binder}
      pages={data.pages}
      cards={data.cards}
      ownerLabel="Shared binder"
    />
  );
}
