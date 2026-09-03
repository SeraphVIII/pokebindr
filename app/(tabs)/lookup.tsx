// Lookup — debounced card search. With a binderId param, tapping a result
// upserts straight into that binder; otherwise it opens the card detail screen.

import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable,
  ActivityIndicator, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { IconDisc, Skeleton } from '@/components/ui';
import { useSearch, useUpsertCard, useSets, useCollection, usePrefetchCard, TcgdexBrief } from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { getCard, cardImages } from '@/lib/tcgdex';
import { theme } from '@/lib/theme';

export default function Lookup() {
  const { binderId, position, page } = useLocalSearchParams<{
    binderId?: string;
    position?: string;
    page?: string;
  }>();
  const positionOverride = position != null ? parseInt(position, 10) : undefined;
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [focused, setFocused] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data: searchData,
    isLoading,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSearch(debounced);
  const { data: sets = [] } = useSets();
  const { data: owned = [] } = useCollection();
  const upsert = useUpsertCard();
  const prefetchCard = usePrefetchCard();
  const toast = useToast();

  const results = useMemo(
    () => searchData?.pages.flatMap((p) => p.items) ?? [],
    [searchData],
  );

  const setName = useMemo(() => {
    const m = new Map<string, string>();
    sets.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [sets]);

  const ownedCountByCardId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of owned) m.set(r.card_id, (m.get(r.card_id) ?? 0) + 1);
    return m;
  }, [owned]);

  const [busyCardId, setBusyCardId] = useState<string | null>(null);

  const onTapResult = async (brief: TcgdexBrief) => {
    if (busyCardId) return;
    if (binderId) {
      setBusyCardId(brief.id);
      try {
        // The /cards list endpoint omits prices; fetch the full card so
        // the upserted row has last_price_eur populated.
        const card = await getCard(brief.id);
        await upsert.mutateAsync({
          card,
          status: 'have',
          binderId,
          position: Number.isFinite(positionOverride) ? positionOverride : undefined,
        });
        // Pop back so the binder's tab state (current page) is preserved.
        router.back();
      } catch (e: any) {
        toast.error(e.message ?? 'Could not add card');
      } finally {
        setBusyCardId(null);
      }
    } else {
      prefetchCard(brief.id);
      router.push(`/card/${brief.id}`);
    }
  };

  return (
    <Screen>
      <View style={{ padding: 24, paddingBottom: 14 }}>
        <Eyebrow>{binderId ? 'Adding to current binder' : 'TCGdex catalogue'}</Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplaySemi, fontSize: 28, lineHeight: 34,
          color: theme.text, marginTop: 4,
        }}>Search</Text>
      </View>

      <View style={{ paddingHorizontal: 24, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{
            flex: 1,
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: theme.glass,
            borderWidth: 1,
            borderColor: focused ? theme.borderStrong : theme.hairline,
            borderRadius: theme.pill,
            paddingHorizontal: 16, paddingVertical: 9,
            boxShadow: focused ? theme.shadowGold : theme.shadowInner,
          }}>
            <Feather name="search" size={16} color={focused ? theme.accent : theme.textDim} />
            <TextInput
              value={q}
              onChangeText={setQ}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              // "rayquaza" → name search; "rayquaza 194" → name + collector
              // number filter; bare "194" → all cards numbered 194 across sets.
              placeholder="Name, or name + #194…"
              placeholderTextColor={theme.textMute}
              autoFocus
              autoCapitalize="none"
              style={{
                flex: 1, color: theme.text, fontSize: 14,
                fontFamily: theme.fontUI,
                paddingVertical: 4,
              }}
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')} hitSlop={8}>
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
          {/* Binder slot params are forwarded so /scan can upsert directly
              into the slot in the in-binder flow. */}
          <IconDisc
            name="camera"
            size={44}
            active
            onPress={() => router.push({
              pathname: '/scan',
              params: {
                ...(binderId ? { binderId } : null),
                ...(position != null ? { position } : null),
                ...(page != null ? { page } : null),
              },
            })}
          />
        </View>
      </View>

      <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        <Eyebrow>
          {isLoading ? 'Searching…' : `${results.length} matches`}
          {isFetching && !isLoading && ' · refreshing'}
        </Eyebrow>
      </View>

      <FlatList
        data={results}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.hairline, marginLeft: 70 }} />}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={{ paddingVertical: 18, alignItems: 'center' }}>
              <ActivityIndicator color={theme.accent} size="small" />
            </View>
          ) : !hasNextPage && results.length > 0 ? (
            <Text style={{
              color: theme.textMute, fontSize: 11, fontFamily: theme.fontMono,
              textAlign: 'center', paddingVertical: 18, letterSpacing: 1,
              textTransform: 'uppercase',
            }}>End of results</Text>
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={{ paddingHorizontal: 8, gap: 12, paddingTop: 8 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Skeleton width={44} height={62} radius={6} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <Skeleton width="70%" height={14} radius={6} />
                    <Skeleton width="40%" height={10} radius={5} />
                  </View>
                </View>
              ))}
            </View>
          ) : debounced.trim().length === 0 ? (
            <View style={{ padding: 40, alignItems: 'center', gap: 12 }}>
              <View style={{
                width: 52, height: 52, borderRadius: theme.pill,
                backgroundColor: theme.glass,
                borderWidth: 1, borderColor: theme.hairline,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Feather name="search" size={20} color={theme.textDim} />
              </View>
              <Text style={{ color: theme.textDim, textAlign: 'center', fontSize: 13, fontFamily: theme.fontUI, lineHeight: 19 }}>
                Type a card name or number,{'\n'}or scan a card with the camera.
              </Text>
            </View>
          ) : (
            <Text style={{ color: theme.textDim, textAlign: 'center', padding: 40, fontSize: 13, fontFamily: theme.fontUI }}>
              No matches for “{debounced.trim()}”.
            </Text>
          )
        }
        renderItem={({ item: c }) => {
          const busy = busyCardId === c.id;
          const setId = c.id.split('-')[0];
          // cardImages falls back to PokemonTCG.io for cards TCGdex has no
          // artwork for (TG / GG gallery subsets).
          const imgSmall = cardImages(c.image, setId, c.localId).small || undefined;
          const ownedQty = ownedCountByCardId.get(c.id) ?? 0;
          return (
            <Pressable
              onPress={() => onTapResult(c)}
              disabled={!!busyCardId}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 14,
                paddingVertical: 11, paddingHorizontal: 8,
                borderRadius: theme.radiusSm,
                backgroundColor: pressed ? theme.accentFaint : 'transparent',
                opacity: busyCardId && !busy ? 0.4 : 1,
              })}>
              {imgSmall ? (
                <Image
                  source={{ uri: imgSmall }}
                  style={{ width: 44, height: 62, borderRadius: 6, backgroundColor: theme.surface2 }}
                />
              ) : (
                <View style={{ width: 44, height: 62, borderRadius: 6, backgroundColor: theme.surface2 }} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontFamily: theme.fontUIBold, flexShrink: 1 }} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {ownedQty > 0 && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 3,
                      paddingHorizontal: 7, paddingVertical: 2.5,
                      borderRadius: theme.pill,
                      backgroundColor: theme.statusHaveSoft,
                    }}>
                      <Feather name="check" size={9} color={theme.statusHave} />
                      <Text style={{
                        color: theme.statusHave, fontSize: 9,
                        fontFamily: theme.fontMono, letterSpacing: 0.5,
                      }}>
                        {ownedQty === 1 ? 'OWNED' : `×${ownedQty}`}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, marginTop: 3 }}>
                  {setName.get(setId) ?? setId} · {c.localId}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {busy
                  ? <ActivityIndicator color={theme.accent} size="small" />
                  : <Feather name="chevron-right" size={15} color={theme.textMute} />}
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
