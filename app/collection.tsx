// My Collection — a flat list of every owned card across all binders.

import { useMemo, useState } from 'react';
import {
  FlatList, View, Text, Pressable, Image, RefreshControl, TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { Chip } from '@/components/Chip';
import { IconDisc } from '@/components/ui';
import { useCollection, useBinders, useRemoveCards, usePrefetchCard } from '@/lib/queries';
import { useConfirm } from '@/components/ConfirmDialog';
import { theme } from '@/lib/theme';

type Sort = 'recent' | 'name' | 'price';
type StatusFilter = 'all' | 'have' | 'want' | 'really';

// One "group" = one unique card_id. Aggregates qty across all instances.
type CardGroup = {
  card_id: string;
  card_name: string;
  set_name: string;
  card_number: string;
  rarity: string | null;
  image_small: string | null;
  price: number | null;
  qty: number;
  maxAddedAt: string;
  statuses: Set<string>;
};

const SORT_LABELS: Record<Sort, string> = {
  recent: 'Recent',
  name:   'Name',
  price:  'Price',
};
// Each sort's "natural" first-tap direction. A second tap on the same chip
// flips it; tapping a different chip resets to that sort's default.
const DEFAULT_REVERSE: Record<Sort, boolean> = {
  recent: false, // newest-first
  name:   false, // A→Z
  price:  false, // high→low
};

export default function MyCollection() {
  const router = useRouter();
  const qc = useQueryClient();
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  const { data: rows = [] } = useCollection();
  const { data: binders = [] } = useBinders();
  const removeCards = useRemoveCards();
  const prefetchCard = usePrefetchCard();
  const confirm = useConfirm();
  const [sort, setSort] = useState<Sort>('recent');
  const [reverse, setReverse] = useState(DEFAULT_REVERSE.recent);
  const onTapSort = (s: Sort) => {
    if (s === sort) setReverse((r) => !r);
    else { setSort(s); setReverse(DEFAULT_REVERSE[s]); }
  };
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    if (statusParam === 'have' || statusParam === 'want' || statusParam === 'really') {
      return statusParam;
    }
    return 'all';
  });
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  // Selection mode toggles between "open detail" and "select card_id" on tap.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const onBulkDelete = async () => {
    if (selected.size === 0) return;
    const ids = rows.filter((r) => selected.has(r.card_id)).map((r) => r.id);
    const ok = await confirm({
      title: `Remove ${selected.size} ${selected.size === 1 ? 'card' : 'cards'}?`,
      message: `This deletes all ${ids.length} ${ids.length === 1 ? 'instance' : 'instances'} from your collection.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await removeCards.mutateAsync(ids);
    setSelected(new Set());
    setSelecting(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await qc.refetchQueries({ queryKey: ['collection'] });
    setRefreshing(false);
  };

  const grouped = useMemo<CardGroup[]>(() => {
    const map = new Map<string, CardGroup>();
    for (const r of rows) {
      const g = map.get(r.card_id);
      if (g) {
        g.qty += 1;
        if (r.added_at > g.maxAddedAt) g.maxAddedAt = r.added_at;
        if (r.last_price_eur != null && (g.price == null || r.last_price_eur > g.price)) {
          g.price = r.last_price_eur;
        }
        g.statuses.add(r.status);
      } else {
        map.set(r.card_id, {
          card_id: r.card_id,
          card_name: r.card_name,
          set_name: r.set_name,
          card_number: r.card_number,
          rarity: r.rarity,
          image_small: r.image_small,
          price: r.last_price_eur,
          qty: 1,
          maxAddedAt: r.added_at,
          statuses: new Set([r.status]),
        });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  const sorted = useMemo(() => {
    const arr = [...grouped];
    switch (sort) {
      case 'recent':
        arr.sort((a, b) => b.maxAddedAt.localeCompare(a.maxAddedAt));
        break;
      case 'name':
        arr.sort((a, b) => a.card_name.localeCompare(b.card_name));
        break;
      case 'price':
        arr.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
        break;
    }
    if (reverse) arr.reverse();
    return arr;
  }, [grouped, sort, reverse]);

  // Filter and search apply after sort so toggling chips keeps the order.
  const visible = useMemo(() => {
    let out = sorted;
    if (statusFilter !== 'all') {
      out = out.filter((g) => g.statuses.has(statusFilter));
    }
    const term = search.trim().toLowerCase();
    if (term) {
      out = out.filter((g) =>
        g.card_name.toLowerCase().includes(term)
        || g.set_name.toLowerCase().includes(term)
        || g.card_number.toLowerCase().includes(term),
      );
    }
    return out;
  }, [sorted, statusFilter, search]);

  const totalValue = rows.reduce((s, r) => s + (r.last_price_eur ?? 0), 0);

  return (
    <Screen edges={['top', 'left', 'right']}>
      {selecting ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingTop: 6, gap: 8,
        }}>
          <Pressable
            onPress={() => { setSelecting(false); setSelected(new Set()); }}
            hitSlop={12}>
            <Text style={{
              color: theme.textDim, fontFamily: theme.fontUIBold,
              fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>Cancel</Text>
          </Pressable>
          <Text style={{
            color: theme.text, fontFamily: theme.fontMono, fontSize: 12,
            letterSpacing: 1.5, textTransform: 'uppercase',
          }}>{selected.size} selected</Text>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            {(() => {
              const allSelected =
                visible.length > 0 && visible.every((g) => selected.has(g.card_id));
              return (
                <Pressable
                  onPress={() => {
                    if (allSelected) setSelected(new Set());
                    else setSelected(new Set(visible.map((g) => g.card_id)));
                  }}
                  disabled={visible.length === 0}
                  hitSlop={12}
                >
                  <Text style={{
                    color: visible.length === 0 ? theme.textMute : theme.accent,
                    fontFamily: theme.fontUIBold,
                    fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
                  }}>{allSelected ? 'None' : 'All'}</Text>
                </Pressable>
              );
            })()}
            <Pressable onPress={onBulkDelete} disabled={selected.size === 0} hitSlop={12}>
              <Text style={{
                color: selected.size === 0 ? theme.textMute : theme.statusReally,
                fontFamily: theme.fontUIBold,
                fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
              }}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingTop: 6,
        }}>
          <IconDisc name="chevron-left" onPress={() => router.back()} />
          <IconDisc name="check-square" iconSize={15} onPress={() => setSelecting(true)} />
        </View>
      )}

      <View style={{ paddingHorizontal: 24, paddingTop: 10 }}>
        <Eyebrow>
          {grouped.length} unique · {rows.length} {rows.length === 1 ? 'card' : 'cards'} · €{totalValue.toFixed(0)} · {binders.length} {binders.length === 1 ? 'binder' : 'binders'}
        </Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplaySemi,
          fontSize: 30, color: theme.text, marginTop: 4, lineHeight: 38,
        }}>My Collection</Text>
      </View>

      <View style={{ paddingHorizontal: 24, paddingTop: 14 }}>
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
            value={search}
            onChangeText={setSearch}
            placeholder="Name, set, or number…"
            placeholderTextColor={theme.textMute}
            autoCapitalize="none"
            style={{
              flex: 1, color: theme.text, fontSize: 14,
              fontFamily: theme.fontUI,
              paddingVertical: 4,
            }}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={6}>
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

      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 6,
        paddingHorizontal: 24, paddingTop: 12,
      }}>
        <Chip label="All"  active={statusFilter === 'all'}    onPress={() => setStatusFilter('all')} />
        <Chip label="Have" active={statusFilter === 'have'}   color={theme.statusHave}   onPress={() => setStatusFilter('have')} />
        <Chip label="Want" active={statusFilter === 'want'}   color={theme.statusWant}   onPress={() => setStatusFilter('want')} />
        <Chip label="Need" active={statusFilter === 'really'} color={theme.statusReally} onPress={() => setStatusFilter('really')} />
      </View>

      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 6,
        paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12,
      }}>
        <Eyebrow style={{ marginRight: 4, alignSelf: 'center' }}>Sort by</Eyebrow>
        {(Object.keys(SORT_LABELS) as Sort[]).map((s) => {
          const active = sort === s;
          return (
            <Pressable
              key={s}
              onPress={() => onTapSort(s)}
              style={({ pressed }) => ({
                alignSelf: 'flex-start',
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 12, paddingVertical: 7,
                borderRadius: theme.pill,
                borderWidth: 1,
                borderColor: active ? theme.accent : theme.hairline,
                backgroundColor: active ? theme.accentSoft : theme.glass,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}>
              <Text style={{
                fontFamily: theme.fontUIBold, fontSize: 11,
                letterSpacing: 0.5, textTransform: 'uppercase',
                color: active ? theme.accent : theme.textDim,
              }}>{SORT_LABELS[s]}</Text>
              {active && (
                <Feather
                  name={reverse ? 'arrow-up' : 'arrow-down'}
                  size={10}
                  color={theme.accent}
                />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Keep this virtualized: mounting hundreds of groups at once stalls
          the screen and starves the image pipeline. */}
      <FlatList
        data={visible}
        keyExtractor={(g) => g.card_id}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 }}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center', gap: 12 }}>
            <View style={{
              width: 52, height: 52, borderRadius: theme.pill,
              backgroundColor: theme.glass,
              borderWidth: 1, borderColor: theme.hairline,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name="layers" size={20} color={theme.textDim} />
            </View>
            <Text style={{
              color: theme.textDim, textAlign: 'center',
              fontSize: 13, fontFamily: theme.fontUI, lineHeight: 19,
            }}>
              {search.trim() || statusFilter !== 'all'
                ? 'Nothing matches the current filters.'
                : 'No cards yet. Add your first from Search.'}
            </Text>
          </View>
        }
        renderItem={({ item: g }) => {
            const dots: { color: string }[] = [];
            if (g.statuses.has('have'))   dots.push({ color: theme.statusHave });
            if (g.statuses.has('want'))   dots.push({ color: theme.statusWant });
            if (g.statuses.has('really')) dots.push({ color: theme.statusReally });
            const isSelected = selected.has(g.card_id);
            return (
              <Pressable
                onPress={() => {
                  if (selecting) {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.card_id)) next.delete(g.card_id);
                      else next.add(g.card_id);
                      return next;
                    });
                  } else {
                    prefetchCard(g.card_id);
                    router.push(`/card/${g.card_id}`);
                  }
                }}
                onLongPress={() => {
                  // While selecting, toggling is handled by onPress.
                  if (selecting) return;
                  setSelecting(true);
                  setSelected(new Set([g.card_id]));
                }}
                delayLongPress={300}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  paddingVertical: 11, paddingHorizontal: 8,
                  borderRadius: theme.radiusSm,
                  borderBottomWidth: 1, borderBottomColor: theme.hairline,
                  backgroundColor: isSelected
                    ? theme.accentSoft
                    : pressed ? theme.accentFaint : 'transparent',
                })}>
                {selecting && (
                  <View style={{
                    width: 22, height: 22, borderRadius: 11,
                    borderWidth: 1.5,
                    borderColor: isSelected ? theme.accent : theme.hairline,
                    backgroundColor: isSelected ? theme.accent : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <Feather name="check" size={14} color={theme.accentText} />}
                  </View>
                )}
                {g.image_small ? (
                  <Image
                    source={{ uri: g.image_small }}
                    style={{ width: 44, height: 62, borderRadius: 6, backgroundColor: theme.surface2 }}
                  />
                ) : (
                  <View style={{ width: 44, height: 62, borderRadius: 6, backgroundColor: theme.surface2 }} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontFamily: theme.fontUIBold }} numberOfLines={1}>
                    {g.card_name}
                  </Text>
                  <Text style={{
                    color: theme.textDim, fontSize: 11,
                    fontFamily: theme.fontMono, marginTop: 3,
                  }} numberOfLines={1}>
                    {g.set_name} · {g.card_number}{g.rarity ? ` · ${g.rarity}` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 3, marginTop: 5 }}>
                    {dots.map((d, i) => (
                      <View key={i} style={{
                        width: 6, height: 6, borderRadius: 3,
                        backgroundColor: d.color,
                      }} />
                    ))}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 5 }}>
                  <View style={{
                    paddingHorizontal: 8, paddingVertical: 3,
                    borderRadius: theme.pill,
                    backgroundColor: theme.accentSoft,
                  }}>
                    <Text style={{
                      color: theme.accent, fontSize: 10,
                      fontFamily: theme.fontMono, letterSpacing: 0.5,
                    }}>×{g.qty}</Text>
                  </View>
                  <Text style={{
                    color: g.price != null ? theme.text : theme.textMute, fontSize: 13,
                    fontFamily: theme.fontMono,
                  }}>
                    {g.price != null ? `€${g.price.toFixed(2)}` : '·'}
                  </Text>
                </View>
              </Pressable>
            );
        }}
      />
    </Screen>
  );
}
