// Sets browser: every TCGdex set, newest first.

import { View, Text, FlatList, Pressable, Image, TextInput } from 'react-native';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { Skeleton } from '@/components/ui';
import { useSets } from '@/lib/queries';
import { theme } from '@/lib/theme';
import type { TcgdexSet } from '@/lib/tcgdex';

export default function SetsList() {
  const { data: sets = [], isLoading } = useSets();
  const router = useRouter();
  const [q, setQ] = useState('');

  // TCGdex returns sets in series order, so reverse for newest-first. Set ids
  // starting with a capital letter are legacy/pre-modern entries; drop them.
  const visible = useMemo(() => {
    const filtered = sets.filter((s) => !/^[A-Z]/.test(s.id));
    const reversed = filtered.reverse();
    const term = q.trim().toLowerCase();
    if (!term) return reversed;
    return reversed.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.id.toLowerCase().includes(term),
    );
  }, [sets, q]);

  return (
    <Screen>
      <View style={{ padding: 24, paddingBottom: 12 }}>
        <Eyebrow>TCGdex library</Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplaySemi,
          fontSize: 30, color: theme.text, marginTop: 4, lineHeight: 38,
        }}>Sets</Text>
        <Text style={{
          color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono,
          marginTop: 6,
        }}>
          {visible.length} {visible.length === 1 ? 'set' : 'sets'} · tap to browse
        </Text>
      </View>

      <View style={{ paddingHorizontal: 24, paddingBottom: 12 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: theme.glass,
          borderWidth: 1, borderColor: theme.hairline,
          borderRadius: theme.pill,
          paddingHorizontal: 16, paddingVertical: 9,
          boxShadow: theme.shadowInner,
        }}>
          <Feather name="search" size={16} color={theme.textDim} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Set name or code…"
            placeholderTextColor={theme.textMute}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              flex: 1, color: theme.text, fontSize: 14,
              fontFamily: theme.fontUI,
              paddingVertical: 4,
            }}
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={6}>
              <View style={{
                width: 20, height: 20, borderRadius: theme.pill,
                backgroundColor: theme.glassStrong,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Feather name="x" size={12} color={theme.textDim} />
              </View>
            </Pressable>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={{ paddingHorizontal: 24, gap: 14, paddingTop: 8 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Skeleton width={54} height={54} radius={10} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton width="60%" height={14} radius={6} />
                <Skeleton width="35%" height={10} radius={5} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(s) => `${s.locale ?? 'en'}-${s.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.hairline, marginLeft: 70 }} />}
          renderItem={({ item }) => (
            <SetRow
              set={item}
              onPress={() => router.push(
                `/sets/${item.id}${item.locale === 'ja' ? '?lang=ja' : ''}`,
              )}
            />
          )}
          ListEmptyComponent={
            <Text style={{
              color: theme.textDim, textAlign: 'center', padding: 40,
              fontFamily: theme.fontUI, fontSize: 13,
            }}>
              No sets match.
            </Text>
          }
        />
      )}
    </Screen>
  );
}

function SetRow({ set, onPress }: { set: TcgdexSet; onPress: () => void }) {
  const total = set.cardCount?.total ?? set.cardCount?.official ?? 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14, paddingHorizontal: 8,
        borderRadius: theme.radiusSm,
        backgroundColor: pressed ? theme.accentFaint : 'transparent',
      })}
    >
      {set.logo ? (
        <Image
          source={{ uri: `${set.logo}.png` }}
          style={{ width: 54, height: 54 }}
          resizeMode="contain"
        />
      ) : set.symbol ? (
        <Image
          source={{ uri: `${set.symbol}.png` }}
          style={{ width: 36, height: 36, alignSelf: 'center' }}
          resizeMode="contain"
        />
      ) : (
        <View style={{
          width: 54, height: 54, borderRadius: 6,
          backgroundColor: theme.surface2,
        }} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{
            color: theme.text, fontSize: 15, fontFamily: theme.fontUIBold,
            flexShrink: 1,
          }} numberOfLines={1}>
            {set.name}
          </Text>
          <View style={{
            paddingHorizontal: 7, paddingVertical: 2.5,
            borderRadius: theme.pill,
            backgroundColor: theme.accentSoft,
          }}>
            <Text style={{
              color: theme.accent,
              fontSize: 9, fontFamily: theme.fontUIBold,
              letterSpacing: 0.6, textTransform: 'uppercase',
            }}>
              EN
            </Text>
          </View>
        </View>
        <Text style={{
          color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono,
          marginTop: 4,
        }}>
          {total} {total === 1 ? 'card' : 'cards'} · {set.id}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={theme.textMute} />
    </Pressable>
  );
}
