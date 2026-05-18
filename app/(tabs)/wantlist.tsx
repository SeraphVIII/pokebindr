// Wantlist — Need first, then Want. Sum of "to acquire" cost.

import { View, Text, ScrollView, Pressable, Image, RefreshControl } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useCollection, useSetStatus } from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { theme } from '@/lib/theme';
import type { CollectionRow } from '@/lib/types';

export default function Wantlist() {
  const { data: rows = [] } = useCollection();
  const setStatus = useSetStatus();
  const toast = useToast();
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  // Tap-to-scroll: when the Home stat tile sends us here with ?focus=want
  // or ?focus=need, scroll the matching section into view every time the
  // screen comes into focus. We poll for the section's y up to ~500ms in
  // case it hasn't laid out yet on a cold tab-mount.
  const scrollRef = useRef<ScrollView>(null);
  const sectionYRef = useRef<{ need: number; want: number }>({ need: 0, want: 0 });
  useFocusEffect(
    useCallback(() => {
      if (focus !== 'want' && focus !== 'need') return;
      let cancelled = false;
      let attempts = 0;
      const tryScroll = () => {
        if (cancelled) return;
        const y = sectionYRef.current[focus as 'want' | 'need'];
        if (y > 0) {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
          return;
        }
        // Section's onLayout hasn't fired yet — retry a few times.
        if (++attempts < 10) setTimeout(tryScroll, 50);
      };
      const t = setTimeout(tryScroll, 60);
      return () => { cancelled = true; clearTimeout(t); };
    }, [focus]),
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

  const really = rows.filter((r) => r.status === 'really');
  const want = rows.filter((r) => r.status === 'want');
  const total = [...really, ...want].reduce((s, r) => s + (r.last_price_eur ?? 0), 0);

  return (
    <Screen>
      <ScrollView
        ref={scrollRef}
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
        <Eyebrow>
          {really.length + want.length} cards · €{total.toFixed(2)} to acquire
        </Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplay,
          fontSize: 30, color: theme.text, marginTop: 4,
        }}>The hunt</Text>

        {really.length > 0 && (
          <Section
            title="Need"
            color={theme.statusReally}
            onLayout={(e) => { sectionYRef.current.need = e.nativeEvent.layout.y; }}
          >
            {really.map((r) => (
              <WantRow
                key={r.id}
                r={r}
                priority
                onPress={() => router.push(`/card/${r.card_id}?row=${r.id}`)}
                onAcquire={() => onAcquire(r)}
              />
            ))}
          </Section>
        )}
        {want.length > 0 && (
          <Section
            title="Wantlist"
            color={theme.statusWant}
            onLayout={(e) => { sectionYRef.current.want = e.nativeEvent.layout.y; }}
          >
            {want.map((r) => (
              <WantRow
                key={r.id}
                r={r}
                onPress={() => router.push(`/card/${r.card_id}?row=${r.id}`)}
                onAcquire={() => onAcquire(r)}
              />
            ))}
          </Section>
        )}

        {really.length === 0 && want.length === 0 && (
          <Text style={{
            color: theme.textDim, textAlign: 'center',
            marginTop: 60, fontSize: 14,
          }}>
            No cards on your wantlist yet.{'\n'}
            Add a card and tap "Want" or "Need" on the detail screen.
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}

function Section({
  title, color, children, onLayout,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
  onLayout?: (e: import('react-native').LayoutChangeEvent) => void;
}) {
  return (
    <View style={{ marginTop: 24 }} onLayout={onLayout}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        <Text style={{
          fontFamily: theme.fontMono, fontSize: 11,
          color: theme.textDim, letterSpacing: 1.5,
          textTransform: 'uppercase',
        }}>{title}</Text>
      </View>
      <View style={{ marginTop: 12, gap: 8 }}>{children}</View>
    </View>
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
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        padding: 12,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: priority ? theme.statusReally + '88' : theme.border,
        borderRadius: theme.radius,
      }}>
      {r.image_small ? (
        <Image
          source={{ uri: r.image_small }}
          style={{ width: 50, height: 70, borderRadius: 5, backgroundColor: theme.surface2 }}
        />
      ) : (
        <View style={{ width: 50, height: 70, borderRadius: 5, backgroundColor: theme.surface2 }} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{
          fontFamily: theme.fontDisplay,
          fontSize: 17, color: theme.text,
        }}>{r.card_name}</Text>
        <Text style={{
          fontSize: 11, color: theme.textDim, fontFamily: theme.fontMono,
          marginTop: 4,
        }}>
          {r.set_name} · {r.card_number}{r.rarity ? ` · ${r.rarity}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', fontFamily: theme.fontMono }}>
          {r.last_price_eur != null ? `€${r.last_price_eur.toFixed(2)}` : '—'}
        </Text>
        <Pressable
          onPress={(e) => { e.stopPropagation(); onAcquire(); }}
          hitSlop={8}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 8, paddingVertical: 5,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.statusHave + 'AA',
            backgroundColor: theme.statusHave + '22',
          }}>
          <Feather name="check" size={11} color={theme.statusHave} />
          <Text style={{
            color: theme.statusHave, fontSize: 10, fontWeight: '700',
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
