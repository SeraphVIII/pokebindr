// Wantlist — two tabs: Need and Want. Sum of "to acquire" cost.

import { View, Text, ScrollView, Pressable, Image, RefreshControl, TextInput } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector, Directions } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useCollection, useSetStatus, usePrefetchCard } from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { theme } from '@/lib/theme';
import type { CollectionRow } from '@/lib/types';

type Sort = 'recent' | 'name' | 'price';
type Tab = 'need' | 'want';
const SORT_LABELS: Record<Sort, string> = {
  recent: 'Recent',
  name:   'Name',
  price:  'Price',
};
// Each sort has a "natural" direction. The first tap on a chip applies it;
// a second tap on the same chip flips it.
const DEFAULT_REVERSE: Record<Sort, boolean> = {
  recent: false, // false = newest-first (desc by added_at)
  name:   false, // false = A→Z
  price:  false, // false = high→low
};

export default function Wantlist() {
  const { data: rows = [] } = useCollection();
  const setStatus = useSetStatus();
  const prefetchCard = usePrefetchCard();
  const toast = useToast();
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  // Initial tab: honor ?focus=want|need from the Home stat tiles, otherwise
  // default to Need (the higher-priority bucket).
  const [tab, setTab] = useState<Tab>(() =>
    focus === 'want' ? 'want' : 'need',
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await qc.refetchQueries({ queryKey: ['collection'] });
    setRefreshing(false);
  };

  const onAcquire = async (r: CollectionRow) => {
    try {
      await setStatus.mutateAsync({ rowId: r.id, status: 'have' });
      toast.success(`Marked ${r.card_name} as acquired.`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not update status.');
    }
  };

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [reverse, setReverse] = useState(DEFAULT_REVERSE.recent);

  const onTapSort = (s: Sort) => {
    if (s === sort) {
      setReverse((r) => !r);
    } else {
      setSort(s);
      setReverse(DEFAULT_REVERSE[s]);
    }
  };

  const applyFilterSort = useCallback((list: CollectionRow[]) => {
    const term = search.trim().toLowerCase();
    let out = list;
    if (term) {
      out = out.filter((r) =>
        r.card_name.toLowerCase().includes(term)
        || r.set_name.toLowerCase().includes(term)
        || r.card_number.toLowerCase().includes(term),
      );
    }
    const sorted = [...out];
    switch (sort) {
      case 'recent':
        sorted.sort((a, b) => b.added_at.localeCompare(a.added_at));
        break;
      case 'name':
        sorted.sort((a, b) => a.card_name.localeCompare(b.card_name));
        break;
      case 'price':
        sorted.sort((a, b) => (b.last_price_eur ?? -Infinity) - (a.last_price_eur ?? -Infinity));
        break;
    }
    if (reverse) sorted.reverse();
    return sorted;
  }, [search, sort, reverse]);

  const really = useMemo(
    () => applyFilterSort(rows.filter((r) => r.status === 'really')),
    [rows, applyFilterSort],
  );
  const want = useMemo(
    () => applyFilterSort(rows.filter((r) => r.status === 'want')),
    [rows, applyFilterSort],
  );
  const total = [...really, ...want].reduce((s, r) => s + (r.last_price_eur ?? 0), 0);

  // Pager track: both lists stay mounted; translateX slides between them.
  const trackOffset = useSharedValue(0);
  const [containerW, setContainerW] = useState(0);
  const containerWRef = useRef(0);
  containerWRef.current = containerW;

  const flipTab = useCallback((next: Tab) => {
    setTab(next);
    const w = containerWRef.current;
    if (w === 0) return;
    trackOffset.value = withTiming(next === 'need' ? 0 : -w, { duration: 240 });
  }, [trackOffset]);

  // Realign the track when the container width changes (rotation, first layout).
  useEffect(() => {
    if (containerW > 0) {
      trackOffset.value = tab === 'need' ? 0 : -containerW;
    }
    // Deliberately not keyed on tab; flipTab animates that transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerW]);

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: trackOffset.value }],
  }));

  // Fling (not Pan) so vertical scrolling inside each list stays untouched.
  const swipeGesture = useMemo(() => {
    const left = Gesture.Fling()
      .direction(Directions.LEFT)
      .runOnJS(true)
      .onEnd(() => flipTab('want'));
    const right = Gesture.Fling()
      .direction(Directions.RIGHT)
      .runOnJS(true)
      .onEnd(() => flipTab('need'));
    return Gesture.Race(left, right);
  }, [flipTab]);

  // Route the ?focus param through flipTab so the pager animates on entry.
  useEffect(() => {
    if (focus !== 'want' && focus !== 'need') return;
    flipTab(focus);
    router.setParams({ focus: undefined });
    // Only a focus change should retrigger this; flipTab is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return (
    <Screen>
      {/* Fixed top region; only the lists below scroll. */}
      <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
        <Eyebrow>
          {really.length + want.length} cards · €{total.toFixed(2)} to acquire
        </Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplaySemi,
          fontSize: 30, color: theme.text, marginTop: 4, lineHeight: 38,
        }}>The hunt</Text>

        <View style={{ marginTop: 18 }}>
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
              autoCorrect={false}
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

          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: 6,
            marginTop: 12, alignItems: 'center',
          }}>
            <Eyebrow style={{ marginRight: 4, alignSelf: 'center' }}>Sort by</Eyebrow>
            {(Object.keys(SORT_LABELS) as Sort[]).map((s) => {
              const isActive = sort === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => onTapSort(s)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingHorizontal: 12, paddingVertical: 7,
                    borderRadius: theme.pill,
                    borderWidth: 1,
                    borderColor: isActive ? theme.accent : theme.hairline,
                    backgroundColor: isActive ? theme.accentSoft : theme.glass,
                    transform: [{ scale: pressed ? 0.95 : 1 }],
                  })}>
                  <Text style={{
                    fontFamily: theme.fontUIBold, fontSize: 11,
                    letterSpacing: 0.5, textTransform: 'uppercase',
                    color: isActive ? theme.accent : theme.textDim,
                  }}>{SORT_LABELS[s]}</Text>
                  {isActive && (
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
        </View>

        <View style={{
          flexDirection: 'row', marginTop: 10,
          borderBottomWidth: 1, borderBottomColor: theme.hairline,
        }}>
          {(['need', 'want'] as Tab[]).map((t) => {
            const isActive = tab === t;
            const count = t === 'need' ? really.length : want.length;
            const color = t === 'need' ? theme.statusReally : theme.statusWant;
            return (
              <Pressable
                key={t}
                onPress={() => flipTab(t)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  alignItems: 'center',
                  borderBottomWidth: 2,
                  borderBottomColor: isActive ? color : 'transparent',
                  marginBottom: -1,
                }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                  <Text style={{
                    fontFamily: theme.fontUIBold, fontSize: 12,
                    letterSpacing: 0.8, textTransform: 'uppercase',
                    color: isActive ? theme.text : theme.textDim,
                  }}>
                    {t === 'need' ? 'Need' : 'Want'}
                  </Text>
                  <Text style={{
                    fontFamily: theme.fontMono, fontSize: 11,
                    color: isActive ? theme.textDim : theme.textMute,
                  }}>{count}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Horizontal pager track; overflow hidden clips the offscreen list. */}
      <View
        style={{ flex: 1, overflow: 'hidden' }}
        onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      >
        {containerW > 0 && (
          <GestureDetector gesture={swipeGesture}>
            <Animated.View style={[
              { flexDirection: 'row', width: containerW * 2, flex: 1 },
              trackStyle,
            ]}>
              <TabPager
                width={containerW}
                rows={really}
                emptyTab="need"
                refreshing={refreshing}
                onRefresh={onRefresh}
                search={search}
                onPressRow={(r) => {
                  prefetchCard(r.card_id);
                  router.push(`/card/${r.card_id}?row=${r.id}`);
                }}
                onAcquire={onAcquire}
              />
              <TabPager
                width={containerW}
                rows={want}
                emptyTab="want"
                refreshing={refreshing}
                onRefresh={onRefresh}
                search={search}
                onPressRow={(r) => {
                  prefetchCard(r.card_id);
                  router.push(`/card/${r.card_id}?row=${r.id}`);
                }}
                onAcquire={onAcquire}
              />
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </Screen>
  );
}

function TabPager({
  width, rows, emptyTab, refreshing, onRefresh, search, onPressRow, onAcquire,
}: {
  width: number;
  rows: CollectionRow[];
  emptyTab: Tab;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  search: string;
  onPressRow: (r: CollectionRow) => void;
  onAcquire: (r: CollectionRow) => void;
}) {
  const activeColor = emptyTab === 'need' ? theme.statusReally : theme.statusWant;
  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={{ padding: 24, paddingBottom: 32, gap: 8, flexGrow: 1 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.accent}
          colors={[theme.accent]}
        />
      }
    >
      {rows.map((r) => (
        <WantRow
          key={r.id}
          r={r}
          priority={emptyTab === 'need'}
          onPress={() => onPressRow(r)}
          onAcquire={() => onAcquire(r)}
        />
      ))}
      {rows.length === 0 && (
        <View style={{ marginTop: 40, alignItems: 'center' }}>
          <View style={{
            width: 52, height: 52, borderRadius: theme.pill,
            backgroundColor: `${activeColor}1c`,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name={emptyTab === 'need' ? 'crosshair' : 'star'} size={20} color={activeColor} />
          </View>
          <Text style={{
            color: theme.textDim, textAlign: 'center', fontSize: 14,
            fontFamily: theme.fontUI, lineHeight: 20, marginTop: 14,
          }}>
            {search.trim()
              ? `No matches for "${search.trim()}" in ${emptyTab === 'need' ? 'Need' : 'Want'}.`
              : emptyTab === 'need'
                ? 'Nothing marked as Need yet.\nFlag a card from its detail page.'
                : 'Nothing marked as Want yet.\nFlag a card from its detail page.'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function WantRow({
  r, priority, onPress, onAcquire,
}: {
  r: CollectionRow;
  priority?: boolean;
  onPress: () => void;
  onAcquire: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        padding: 12,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: priority ? 'rgba(205,99,99,0.45)' : theme.hairline,
        borderRadius: theme.radius,
        boxShadow: theme.shadowInner,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      {r.image_small ? (
        <Image
          source={{ uri: r.image_small }}
          style={{ width: 50, height: 70, borderRadius: 6, backgroundColor: theme.surface2 }}
        />
      ) : (
        <View style={{ width: 50, height: 70, borderRadius: 6, backgroundColor: theme.surface2 }} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{
          fontFamily: theme.fontDisplaySemi,
          fontSize: 17, color: theme.text,
        }}>{r.card_name}</Text>
        <Text numberOfLines={1} style={{
          fontSize: 11, color: theme.textDim, fontFamily: theme.fontMono,
          marginTop: 4,
        }}>
          {r.set_name} · {r.card_number}{r.rarity ? ` · ${r.rarity}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Text style={{ color: r.last_price_eur != null ? theme.text : theme.textMute, fontSize: 14, fontFamily: theme.fontMono }}>
          {r.last_price_eur != null ? `€${r.last_price_eur.toFixed(2)}` : '·'}
        </Text>
        <Pressable
          onPress={(e) => { e.stopPropagation(); onAcquire(); }}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 10, paddingVertical: 6,
            borderRadius: theme.pill,
            backgroundColor: theme.statusHaveSoft,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}>
          <Feather name="check" size={11} color={theme.statusHave} />
          <Text style={{
            color: theme.statusHave, fontSize: 10,
            fontFamily: theme.fontUIBold, letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}>
            Got it
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}
