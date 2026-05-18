// Binders tab — list of all the user's binders. Tap one to enter it.

import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useBinders, useCollection } from '@/lib/queries';
import { theme } from '@/lib/theme';
import type { Binder } from '@/lib/types';

export default function BindersList() {
  const { data: binders = [], isLoading } = useBinders();
  const { data: collection = [] } = useCollection();
  const router = useRouter();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.refetchQueries({ queryKey: ['binders'] }),
      qc.refetchQueries({ queryKey: ['collection'] }),
    ]);
    setRefreshing(false);
  };

  // Cheap client-side count per binder.
  const countByBinder = collection.reduce<Record<string, number>>((acc, r) => {
    acc[r.binder_id] = (acc[r.binder_id] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <View>
            <Eyebrow>Your binders</Eyebrow>
            <Text style={{
              fontFamily: theme.fontDisplay,
              fontSize: 28, color: theme.text, marginTop: 4,
            }}>Collection</Text>
          </View>
          <Pressable
            onPress={() => router.push('/binder/new')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: theme.radius,
              backgroundColor: theme.accent,
            }}>
            <Feather name="plus" size={14} color={theme.accentText} />
            <Text style={{
              color: theme.accentText, fontSize: 12,
              fontFamily: theme.fontUIBold, letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}>New</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 20, gap: 10 }}>
          {/* Flat all-cards list — distinct from the grid binders below. */}
          <Pressable
            onPress={() => router.push('/collection')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 14,
              padding: 16,
              backgroundColor: theme.surface,
              borderWidth: 1, borderColor: theme.borderStrong,
              borderRadius: theme.radius,
            }}>
            <View style={{
              width: 44, height: 44, borderRadius: 6,
              backgroundColor: theme.surface2,
              borderWidth: 1, borderColor: theme.accent,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name="list" size={20} color={theme.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{
                fontFamily: theme.fontDisplay,
                fontSize: 18, color: theme.text,
              }}>My Collection</Text>
              <Text style={{
                fontFamily: theme.fontMono, fontSize: 11,
                color: theme.textDim, marginTop: 4,
              }}>
                {collection.length} {collection.length === 1 ? 'card' : 'cards'} · sortable list
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={theme.textDim} />
          </Pressable>

          {/* Divider before the user's grid binders. */}
          {binders.length > 0 && (
            <Text style={{
              fontFamily: theme.fontMono, fontSize: 10,
              color: theme.textMute, letterSpacing: 1.5,
              textTransform: 'uppercase', marginTop: 8, marginBottom: -2,
            }}>Binders</Text>
          )}

          {isLoading && (
            <Text style={{ color: theme.textDim }}>Loading…</Text>
          )}

          {!isLoading && binders.length === 0 && (
            <Pressable
              onPress={() => router.push('/binder/new')}
              style={{
                borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed',
                borderRadius: theme.radius, padding: 28,
                alignItems: 'center',
              }}>
              <Text style={{ color: theme.textDim, fontSize: 14, textAlign: 'center' }}>
                No binders yet.{'\n'}
                <Text style={{ color: theme.accent }}>Tap to create your first one →</Text>
              </Text>
            </Pressable>
          )}

          {binders.map((b) => (
            <BinderCard
              key={b.id}
              binder={b}
              cards={countByBinder[b.id] ?? 0}
              onPress={() => router.push(`/binder/${b.id}`)}
            />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function BinderCard({ binder, cards, onPress }: { binder: Binder; cards: number; onPress: () => void }) {
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
      {/* mini grid icon */}
      <View style={{
        width: 44, height: 44, borderRadius: 6,
        backgroundColor: theme.surface2,
        borderWidth: 1, borderColor: theme.borderStrong,
        flexDirection: 'row', flexWrap: 'wrap', gap: 2,
        alignItems: 'center', justifyContent: 'center',
        padding: 4,
      }}>
        {Array.from({ length: Math.min(9, binder.grid_cols * binder.grid_rows) }).map((_, i) => (
          <View key={i} style={{
            width: 8, height: 10, borderRadius: 1,
            backgroundColor: theme.surface3,
          }} />
        ))}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{
          fontFamily: theme.fontDisplay,
          fontSize: 18, color: theme.text,
        }}>{binder.name}</Text>
        <Text style={{
          fontFamily: theme.fontMono, fontSize: 11,
          color: theme.textDim, marginTop: 4,
        }}>
          {binder.grid_cols}×{binder.grid_rows} · {cards} {cards === 1 ? 'card' : 'cards'}
        </Text>
      </View>

      <Feather name="chevron-right" size={18} color={theme.textDim} />
    </Pressable>
  );
}
