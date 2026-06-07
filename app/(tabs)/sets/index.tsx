// Sets browser — every TCGdex set, newest first. Tap a set to drill into
// its cards with a rarity filter.

import { View, Text, FlatList, Pressable, Image, ActivityIndicator, TextInput } from 'react-native';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useSets } from '@/lib/queries';
import { theme } from '@/lib/theme';
import type { TcgdexSet } from '@/lib/tcgdex';

export default function SetsList() {
  const { data: sets = [], isLoading } = useSets();
  const router = useRouter();
  const [q, setQ] = useState('');

  // TCGdex returns sets in series order; reverse so newest is first. Apply
  // a simple substring filter when the user searches. Drop sets whose
  // shortcode starts with a capital letter — those are TCGdex's legacy /
  // pre-modern entries the user has opted out of seeing.
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
          fontFamily: theme.fontDisplay,
          fontSize: 30, color: theme.text, marginTop: 4, lineHeight: 40,
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
          backgroundColor: theme.surface,
          borderWidth: 1, borderColor: theme.border,
          borderRadius: theme.radius,
          paddingHorizontal: 14, paddingVertical: 8,
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
              paddingVertical: 4,
            }}
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} hitSlop={6}>
              <Feather name="x" size={16} color={theme.textDim} />
            </Pressable>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(s) => `${s.locale ?? 'en'}-${s.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 70 }} />}
          renderItem={({ item }) => (
            <SetRow
              set={item}
              onPress={() => router.push(
                `/sets/${item.id}${item.locale === 'ja' ? '?lang=ja' : ''}`,
              )}
            />
          )}
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
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14, paddingHorizontal: 8,
      }}
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
            color: theme.text, fontSize: 15, fontFamily: theme.fontUI,
            flexShrink: 1,
          }} numberOfLines={1}>
            {set.name}
          </Text>
          <View style={{
            paddingHorizontal: 6, paddingVertical: 2,
            borderRadius: 4,
            backgroundColor: theme.accent2 + '22',
            borderWidth: 1,
            borderColor: theme.accent2 + '88',
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
