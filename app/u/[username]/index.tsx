// /u/[username] — public profile page listing the user's public binders.

import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { usePublicProfile } from '@/lib/queries';
import { theme } from '@/lib/theme';
import type { Binder } from '@/lib/types';

export default function PublicProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const { data, isLoading } = usePublicProfile(username);

  if (isLoading) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </Screen>
    );
  }
  if (!data?.profile) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: theme.fontDisplay, fontSize: 22, color: theme.text }}>
            No such trainer
          </Text>
          <Text style={{ color: theme.textDim, fontSize: 13, textAlign: 'center' }}>
            @{username} doesn&apos;t exist or hasn&apos;t set a username yet.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
        <Eyebrow>Trainer profile</Eyebrow>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 }}>
          <View style={{
            width: 66, height: 66, borderRadius: 33,
            backgroundColor: theme.accent,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{
              fontFamily: theme.fontDisplay,
              fontSize: 28, color: theme.accentText,
            }}>{(username?.[0] ?? '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontFamily: theme.fontDisplay,
              fontSize: 22, color: theme.text,
            }}>@{username}</Text>
            <Text style={{
              fontFamily: theme.fontMono, fontSize: 11,
              color: theme.textDim, marginTop: 4,
            }}>
              {data.binders.length} public {data.binders.length === 1 ? 'binder' : 'binders'}
            </Text>
          </View>
        </View>

        <Eyebrow style={{ marginTop: 28 }}>Public binders</Eyebrow>

        {data.binders.length === 0 ? (
          <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 16 }}>
            No public binders yet.
          </Text>
        ) : (
          <View style={{ marginTop: 12, gap: 10 }}>
            {data.binders.map((b) => (
              <BinderCard
                key={b.id}
                binder={b}
                onPress={() => router.push(`/u/${username}/binder/${b.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function BinderCard({ binder, onPress }: { binder: Binder; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        padding: 16,
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.border,
        borderRadius: theme.radius,
      }}>
      <View style={{
        width: 44, height: 44, borderRadius: 6,
        backgroundColor: theme.surface2,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Feather name="grid" size={20} color={theme.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{
          fontFamily: theme.fontDisplay,
          fontSize: 18, color: theme.text,
        }} numberOfLines={1}>{binder.name}</Text>
        <Text style={{
          fontFamily: theme.fontMono, fontSize: 11,
          color: theme.textDim, marginTop: 4,
        }}>
          {binder.grid_cols}×{binder.grid_rows}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Feather name="heart" size={13} color={theme.textDim} />
        <Text style={{
          color: theme.textDim, fontFamily: theme.fontMono, fontSize: 12,
        }}>{binder.likes_count}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.textDim} />
    </Pressable>
  );
}
