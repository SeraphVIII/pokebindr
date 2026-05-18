// "My Collection" — a flat, scrollable list of every card the user owns
// (across all binders), with toggleable sort.
//
// Pinned at the top of the Binder tab.

import { useMemo, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, Image, RefreshControl, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { Chip } from '@/components/Chip';
import { useCollection, useBinders, useRemoveCards } from '@/lib/queries';
import { theme } from '@/lib/theme';

type Sort = 'recent' | 'name' | 'set' | 'price';
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
  set:    'Set',
  price:  'Price',
};

export default function MyCollection() {
  const router = useRouter();
  const qc = useQueryClient();
  const { status: statusParam } = useLocalSearchParams<{ status?: string }>();
  const { data: rows = [] } = useCollection();
  const { data: binders = [] } = useBinders();
  const removeCards = useRemoveCards();
  const [sort, setSort] = useState<Sort>('recent');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    if (statusParam === 'have' || statusParam === 'want' || statusParam === 'really') {
      return statusParam;
    }
    return 'all';
  });
  const [refreshing, setRefreshing] = useState(false);
  // Selection mode toggles between "open detail" and "select card_id" on tap.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const onBulkDelete = () => {
    if (selected.size === 0) return;
    const ids = rows.filter((r) => selected.has(r.card_id)).map((r) => r.id);
    Alert.alert(
      `Remove ${selected.size} ${selected.size === 1 ? 'card' : 'cards'}?`,
      `This deletes all ${ids.length} ${ids.length === 1 ? 'instance' : 'instances'} from your collection.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await removeCards.mutateAsync(ids);
            setSelected(new Set());
            setSelecting(false);
          },
        },
      ],
    );
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
        return arr.sort((a, b) => b.maxAddedAt.localeCompare(a.maxAddedAt));
      case 'name':
        return arr.sort((a, b) => a.card_name.localeCompare(b.card_name));
      case 'set':
        return arr.sort((a, b) => {
          const s = a.set_name.localeCompare(b.set_name);
          return s !== 0
            ? s
            : a.card_number.localeCompare(b.card_number, undefined, { numeric: true });
        });
      case 'price':
        return arr.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
    }
  }, [grouped, sort]);

  // Status filter applied AFTER sort so chips don't disturb existing order.
  const visible = useMemo(() => {
    if (statusFilter === 'all') return sorted;
    return sorted.filter((g) => g.statuses.has(statusFilter));
  }, [sorted, statusFilter]);

  const totalValue = rows.reduce((s, r) => s + (r.last_price_eur ?? 0), 0);

  return (
    <Screen edges={['top', 'left', 'right']}>
      {selecting ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingTop: 6,
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
          <Pressable onPress={onBulkDelete} disabled={selected.size === 0} hitSlop={12}>
            <Text style={{
              color: selected.size === 0 ? theme.textMute : theme.statusReally,
              fontFamily: theme.fontUIBold,
              fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>Delete</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingTop: 6,
        }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={theme.textDim} />
          </Pressable>
          <Pressable onPress={() => setSelecting(true)} hitSlop={12}>
            <Feather name="check-square" size={18} color={theme.textDim} />
          </Pressable>
        </View>
      )}

      <View style={{ paddingHorizontal: 24, paddingTop: 4 }}>
        <Eyebrow>
          {grouped.length} unique · {rows.length} {rows.length === 1 ? 'card' : 'cards'} · €{totalValue.toFixed(0)} · {binders.length} {binders.length === 1 ? 'binder' : 'binders'}
        </Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplay,
          fontSize: 30, color: theme.text, marginTop: 4,
        }}>My Collection</Text>
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
              onPress={() => setSort(s)}
              style={{
                alignSelf: 'flex-start',
                paddingHorizontal: 10, paddingVertical: 5,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? theme.accent : theme.border,
                backgroundColor: active ? theme.accent : 'transparent',
              }}>
              <Text style={{
                fontFamily: theme.fontUIBold, fontSize: 11,
                letterSpacing: 0.5, textTransform: 'uppercase',
                color: active ? theme.accentText : theme.textDim,
              }}>{SORT_LABELS[s]}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        {visible.length === 0 ? (
          <Text style={{
            color: theme.textDim, textAlign: 'center',
            padding: 40, fontSize: 13,
          }}>No cards yet.</Text>
        ) : (
          visible.map((g) => {
            const dots: { color: string }[] = [];
            if (g.statuses.has('have'))   dots.push({ color: theme.statusHave });
            if (g.statuses.has('want'))   dots.push({ color: theme.statusWant });
            if (g.statuses.has('really')) dots.push({ color: theme.statusReally });
            const isSelected = selected.has(g.card_id);
            return (
              <Pressable
                key={g.card_id}
                onPress={() => {
                  if (selecting) {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.card_id)) next.delete(g.card_id);
                      else next.add(g.card_id);
                      return next;
                    });
                  } else {
                    router.push(`/card/${g.card_id}`);
                  }
                }}
                onLongPress={() => {
                  // Long-press anywhere enters selection mode and picks the
                  // pressed card. Skipped when we're already selecting (the
                  // regular onPress handles toggling).
                  if (selecting) return;
                  setSelecting(true);
                  setSelected(new Set([g.card_id]));
                }}
                delayLongPress={300}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  paddingVertical: 10, paddingHorizontal: 6,
                  borderBottomWidth: 1, borderBottomColor: theme.border,
                  backgroundColor: isSelected ? 'rgba(212,175,55,0.12)' : 'transparent',
                }}>
                {selecting && (
                  <View style={{
                    width: 22, height: 22, borderRadius: 11,
                    borderWidth: 1.5,
                    borderColor: isSelected ? theme.accent : theme.border,
                    backgroundColor: isSelected ? theme.accent : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <Feather name="check" size={14} color={theme.accentText} />}
                  </View>
                )}
                {g.image_small ? (
                  <Image
                    source={{ uri: g.image_small }}
                    style={{ width: 44, height: 62, borderRadius: 4, backgroundColor: theme.surface2 }}
                  />
                ) : (
                  <View style={{ width: 44, height: 62, borderRadius: 4, backgroundColor: theme.surface2 }} />
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: theme.text, fontSize: 15 }} numberOfLines={1}>
                    {g.card_name}
                  </Text>
                  <Text style={{
                    color: theme.textDim, fontSize: 11,
                    fontFamily: theme.fontMono, marginTop: 2,
                  }}>
                    {g.set_name} · {g.card_number}{g.rarity ? ` · ${g.rarity}` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 3, marginTop: 4 }}>
                    {dots.map((d, i) => (
                      <View key={i} style={{
                        width: 6, height: 6, borderRadius: 3,
                        backgroundColor: d.color,
                      }} />
                    ))}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{
                    color: theme.accent, fontSize: 12,
                    fontFamily: theme.fontUIBold,
                    letterSpacing: 0.5, textTransform: 'uppercase',
                  }}>Qty × {g.qty}</Text>
                  <Text style={{
                    color: theme.text, fontSize: 13, fontWeight: '600',
                    fontFamily: theme.fontMono,
                  }}>
                    {g.price != null ? `€${g.price.toFixed(2)}` : '—'}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
