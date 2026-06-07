// Lookup — debounced PokemonTCG.io search.
//
// Two flows:
//   Global   (no `binderId` query param) → tap a result → open card detail.
//                                          The detail screen handles the add.
//   In-binder (binderId set, e.g. navigated from an empty slot) → tap a
//                                          result → upsert directly to that
//                                          binder → return to the binder.

import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable,
  ActivityIndicator, Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useSearch, useUpsertCard, useSets, useCollection, TcgdexBrief } from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { getCard } from '@/lib/tcgdex';
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
  const toast = useToast();

  // useInfiniteQuery returns paged data; flatten the items into a single
  // list for the FlatList. Memoized so the FlatList doesn't see a fresh
  // array identity on unrelated renders. Order is TCGdex's default.
  const results = useMemo(
    () => searchData?.pages.flatMap((p) => p.items) ?? [],
    [searchData],
  );

  const setName = useMemo(() => {
    const m = new Map<string, string>();
    sets.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [sets]);

  // Quick lookup: how many copies of a given card_id the user owns.
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
        // the row we upsert has last_price_eur populated.
        const card = await getCard(brief.id);
        await upsert.mutateAsync({
          card,
          status: 'have',
          binderId,
          position: Number.isFinite(positionOverride) ? positionOverride : undefined,
        });
        // Pop back to the binder that opened us — the binder's tab state
        // is preserved across the trip so the user lands on the same page.
        // (Using router.replace to /binder/[id] left the binder URL on the
        // Lookup tab's stack, which broke the back arrow inside the binder.)
        router.back();
      } catch (e: any) {
        toast.error(e.message ?? 'Could not add card');
      } finally {
        setBusyCardId(null);
      }
    } else {
      router.push(`/card/${brief.id}`);
    }
  };

  return (
    <Screen>
      <View style={{ padding: 24, paddingBottom: 12 }}>
        <Eyebrow>{binderId ? 'Adding to current binder' : 'TCGdex search'}</Eyebrow>
      </View>

      <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{
            flex: 1,
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
              // "rayquaza" → name search; "rayquaza 194" → name + collector
              // number filter; bare "194" → all cards numbered 194 across sets.
              placeholder="Name, or name + #194…"
              placeholderTextColor={theme.textMute}
              autoFocus
              autoCapitalize="none"
              style={{
                flex: 1, color: theme.text, fontSize: 14,
                paddingVertical: 4,
              }}
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')}>
                <Feather name="x" size={16} color={theme.textDim} />
              </Pressable>
            )}
          </View>
          {/* Scan is available in both flows: in the global flow it hands off
              to /card/[id]; in the in-binder flow we forward the binder slot
              so /scan can upsert directly into it via the same useUpsertCard
              call this screen uses. */}
          <Pressable
            onPress={() => router.push({
              pathname: '/scan',
              params: {
                ...(binderId ? { binderId } : null),
                ...(position != null ? { position } : null),
                ...(page != null ? { page } : null),
              },
            })}
            accessibilityRole="button"
            accessibilityLabel="Scan a card with the camera"
            style={{
              width: 42, height: 42, borderRadius: 21,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: theme.borderStrong,
              backgroundColor: theme.surface,
            }}>
            <Feather name="camera" size={18} color={theme.accent} />
          </Pressable>
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
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 70 }} />}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          // Guard against React Query firing fetchNextPage redundantly while
          // a fetch is already in flight; also no-op once we've hit the tail.
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
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : debounced.trim().length === 0 ? (
            <Text style={{ color: theme.textDim, textAlign: 'center', padding: 40, fontSize: 13 }}>
              Type a card name or number to search.
            </Text>
          ) : (
            <Text style={{ color: theme.textDim, textAlign: 'center', padding: 40, fontSize: 13 }}>
              No matches.
            </Text>
          )
        }
        renderItem={({ item: c }) => {
          const busy = busyCardId === c.id;
          const setId = c.id.split('-')[0];
          const imgSmall = c.image ? `${c.image}/low.webp` : undefined;
          const ownedQty = ownedCountByCardId.get(c.id) ?? 0;
          return (
            <Pressable
              onPress={() => onTapResult(c)}
              disabled={!!busyCardId}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 14,
                paddingVertical: 10, paddingHorizontal: 6,
                opacity: busyCardId && !busy ? 0.4 : 1,
              }}>
              {imgSmall ? (
                <Image
                  source={{ uri: imgSmall }}
                  style={{ width: 44, height: 62, borderRadius: 4, backgroundColor: theme.surface2 }}
                />
              ) : (
                <View style={{ width: 44, height: 62, borderRadius: 4, backgroundColor: theme.surface2 }} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {ownedQty > 0 && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 3,
                      paddingHorizontal: 6, paddingVertical: 2,
                      borderRadius: 10,
                      backgroundColor: theme.statusHave + '22',
                      borderWidth: 1,
                      borderColor: theme.statusHave + '88',
                    }}>
                      <Feather name="check" size={9} color={theme.statusHave} />
                      <Text style={{
                        color: theme.statusHave, fontSize: 9, fontWeight: '700',
                        fontFamily: theme.fontMono, letterSpacing: 0.5,
                      }}>
                        {ownedQty === 1 ? 'OWNED' : `×${ownedQty}`}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, marginTop: 2 }}>
                  {setName.get(setId) ?? setId} · {c.localId}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {busy && <ActivityIndicator color={theme.accent} size="small" />}
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
