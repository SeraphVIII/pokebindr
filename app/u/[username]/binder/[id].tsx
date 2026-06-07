// /u/[username]/binder/[id] — public binder owned by a named user.

import { useLocalSearchParams } from 'expo-router';
import { View, Text, ActivityIndicator } from 'react-native';
import { Screen } from '@/components/Screen';
import { PublicBinderView } from '@/components/PublicBinderView';
import { usePublicBinder, useProfileByUsername } from '@/lib/queries';
import { theme } from '@/lib/theme';

export default function PublicBinderRoute() {
  const { username, id } = useLocalSearchParams<{ username: string; id: string }>();
  const { data: profile } = useProfileByUsername(username);
  const { data, isLoading, error } = usePublicBinder(id);

  if (isLoading) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </Screen>
    );
  }
  // Verify the binder is genuinely public AND owned by the named user
  // (defence-in-depth on top of RLS).
  const ok =
    data &&
    data.binder.visibility === 'public' &&
    profile &&
    profile.user_id === data.binder.user_id;
  if (error || !ok || !data) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: theme.fontDisplay, fontSize: 22, color: theme.text }}>
            Binder unavailable
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 13, textAlign: 'center' }}>
            This binder is private, removed, or never belonged to @{username}.
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
      ownerLabel={`@${username}`}
    />
  );
}
