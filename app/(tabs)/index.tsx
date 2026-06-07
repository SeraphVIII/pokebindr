// Home — collection value, status counts, recent additions.

import { ScrollView, View, Text, Pressable, Image, RefreshControl } from 'react-native';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useCollection, useMyProfile, useMasteringSets, useSets } from '@/lib/queries';
import { theme } from '@/lib/theme';
import type { CollectionRow } from '@/lib/types';
import type { TcgdexSet } from '@/lib/tcgdex';

// Pick a greeting based on the device's current hour:
//   04:00–11:59 → morning   12:00–19:59 → afternoon   20:00–03:59 → evening
// "Evening" wraps around midnight, so the early-morning hours before 4 fall
// into the previous evening rather than getting their own greeting.
function timeOfDayGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 4 && h < 12) return 'Good morning';
  if (h >= 12 && h < 20) return 'Good afternoon';
  return 'Good evening';
}

export default function Home() {
  const { data: collection = [], isLoading } = useCollection();
  const { data: profile } = useMyProfile();
  const rawName = profile?.username ?? 'trainer';
  // Capitalize first letter so it reads as a name, not a handle.
  const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const greeting = timeOfDayGreeting();
  const router = useRouter();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await qc.refetchQueries({ queryKey: ['collection'] });
    setRefreshing(false);
  };

  const have = collection.filter((c) => c.status === 'have');
  const want = collection.filter((c) => c.status === 'want');
  const really = collection.filter((c) => c.status === 'really');
  const value = have.reduce((s, c) => s + (c.last_price_eur ?? 0), 0);

  // Master-set progress carousel data. For each mastering set: how many
  // distinct card_ids the user owns (status='have') vs. the set's total
  // card count. One variant per card.
  const { data: masteringIds = [] } = useMasteringSets();
  const { data: allSets = [] } = useSets();
  const setMap = useMemo(() => {
    const m = new Map<string, TcgdexSet>();
    for (const s of allSets) m.set(s.id, s);
    return m;
  }, [allSets]);
  const ownedByCardId = useMemo(() => {
    const s = new Set<string>();
    for (const c of have) s.add(c.card_id);
    return s;
  }, [have]);
  const ownedCountBySet = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of have) {
      if (!m.has(c.set_id)) m.set(c.set_id, 0);
    }
    // Count distinct card_ids per set.
    const seen = new Set<string>();
    for (const c of have) {
      const key = `${c.set_id}|${c.card_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      m.set(c.set_id, (m.get(c.set_id) ?? 0) + 1);
    }
    return m;
  }, [have]);
  void ownedByCardId;
  const masteringSets = masteringIds
    .map((id) => setMap.get(id))
    .filter((s): s is TcgdexSet => !!s);

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
        <Eyebrow>Welcome back</Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplay,
          fontSize: 30, color: theme.text,
          marginTop: 6, lineHeight: 40,
        }}>
          {greeting},{'\n'}
          <Text style={{ color: theme.accent }}>{displayName}.</Text>
        </Text>

        {/* hero value */}
        <Pressable
          onPress={() => router.push('/collection')}
          style={{
            marginTop: 20,
            backgroundColor: theme.surface,
            borderWidth: 1, borderColor: theme.border,
            borderRadius: theme.radius * 1.5,
            padding: 20,
          }}>
          <Eyebrow>Total collection value · EU</Eyebrow>
          <Text style={{
            fontFamily: theme.fontMono,
            fontSize: 40, color: theme.text,
            marginTop: 6, lineHeight: 46,
            letterSpacing: -0.5,
          }}>
            €{value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
          <Text style={{
            color: theme.textDim, fontSize: 12, marginTop: 6,
            fontFamily: theme.fontMono,
          }}>
            {have.length} cards owned · prices via Cardmarket
          </Text>
        </Pressable>

        {/* status strip */}
        <View style={{
          marginTop: 14,
          flexDirection: 'row', gap: 8,
        }}>
          <Stat label="Have" val={have.length}   color={theme.statusHave}   onPress={() => router.push('/collection?status=have')} />
          <Stat label="Want" val={want.length}   color={theme.statusWant}   onPress={() => router.push('/wantlist?focus=want')} />
          <Stat label="Need" val={really.length} color={theme.statusReally} onPress={() => router.push('/wantlist?focus=need')} />
        </View>

        {/* mastering carousel */}
        {masteringSets.length > 0 && (
          <View style={{ marginTop: 24, marginHorizontal: -24 }}>
            <View style={{ paddingHorizontal: 24, marginBottom: 10 }}>
              <Row title="Mastering" action="Browse sets" onAction={() => router.push('/sets')} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}
            >
              {masteringSets.map((s) => {
                const total = s.cardCount?.total ?? s.cardCount?.official ?? 0;
                const owned = Math.min(total, ownedCountBySet.get(s.id) ?? 0);
                const pct = total > 0 ? owned / total : 0;
                return (
                  <MasteringBlob
                    key={`${s.locale ?? 'en'}-${s.id}`}
                    set={s}
                    owned={owned}
                    total={total}
                    pct={pct}
                    onPress={() => router.push(`/sets/${s.id}`)}
                  />
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* recent */}
        <View style={{ marginTop: 28 }}>
          <Row title="Recently added" action="See binder" onAction={() => router.push('/binder')} />
          <View style={{ marginTop: 12, gap: 10 }}>
            {isLoading && <Text style={{ color: theme.textDim }}>Loading…</Text>}
            {collection.slice(0, 4).map((c) => <RecentRow key={c.id} c={c} onPress={() => router.push(`/card/${c.card_id}?row=${c.id}`)} />)}
            {!isLoading && collection.length === 0 && (
              <Pressable
                onPress={() => router.push('/lookup')}
                style={{
                  borderWidth: 1, borderColor: theme.borderStrong,
                  backgroundColor: theme.surface,
                  borderRadius: theme.radius, padding: 28,
                  alignItems: 'center',
                }}
              >
                <Eyebrow>Empty binder</Eyebrow>
                <Text style={{
                  color: theme.textDim, fontSize: 14, textAlign: 'center',
                  marginTop: 8, fontFamily: theme.fontDisplay, lineHeight: 22,
                }}>
                  Nothing in here yet.
                </Text>
                <Text style={{
                  color: theme.accent, fontSize: 12, marginTop: 10,
                  fontFamily: theme.fontUIBold, letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}>
                  Add your first card →
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label, val, color, onPress,
}: { label: string; val: number; color: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{
        flex: 1,
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.border,
        borderRadius: theme.radius,
        paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        <Eyebrow style={{ fontSize: 9 }}>{label}</Eyebrow>
      </View>
      <Text style={{
        fontFamily: theme.fontMono,
        fontSize: 26, color: theme.text, marginTop: 8,
        letterSpacing: -0.5,
      }}>{val}</Text>
    </Pressable>
  );
}

function MasteringBlob({
  set, owned, total, pct, onPress,
}: {
  set: TcgdexSet;
  owned: number;
  total: number;
  pct: number;
  onPress: () => void;
}) {
  const W = 110;
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: W,
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.border,
        borderRadius: theme.radius,
        padding: 10,
        alignItems: 'center',
        gap: 8,
      }}
    >
      <View style={{
        width: W - 20, height: 50,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {set.logo ? (
          <Image
            source={{ uri: `${set.logo}.png` }}
            style={{ width: W - 20, height: 50 }}
            resizeMode="contain"
          />
        ) : set.symbol ? (
          <Image
            source={{ uri: `${set.symbol}.png` }}
            style={{ width: 32, height: 32 }}
            resizeMode="contain"
          />
        ) : (
          <Text numberOfLines={2} style={{
            color: theme.textDim, fontSize: 11, textAlign: 'center',
          }}>{set.name}</Text>
        )}
      </View>
      <View style={{
        width: '100%',
        height: 6,
        backgroundColor: theme.surface3 ?? theme.border,
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <View style={{
          width: `${Math.min(100, Math.round(pct * 100))}%`,
          height: '100%',
          backgroundColor: pct >= 1 ? theme.statusHave : theme.accent,
        }} />
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
        }}
      >
        {owned}/{total} · {Math.round(pct * 100)}%
      </Text>
    </Pressable>
  );
}

function Row({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Text style={{ fontFamily: theme.fontDisplay, fontSize: 19, color: theme.text }}>{title}</Text>
      {action && (
        <Pressable onPress={onAction}>
          <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '600' }}>{action} →</Text>
        </Pressable>
      )}
    </View>
  );
}

function RecentRow({ c, onPress }: { c: CollectionRow; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        padding: 10,
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.border,
        borderRadius: theme.radius,
      }}>
      {c.image_small ? (
        <Image
          source={{ uri: c.image_small }}
          style={{ width: 28, height: 40, borderRadius: 3, backgroundColor: theme.surface3 }}
        />
      ) : (
        <View style={{
          width: 28, height: 40, borderRadius: 3,
          backgroundColor: theme.surface3,
          borderWidth: 1, borderColor: theme.border,
        }} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '500' }}>{c.card_name}</Text>
        <Text style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, marginTop: 2 }}>
          {c.set_name} · {c.card_number}
        </Text>
      </View>
      <Text style={{ color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono }}>
        {c.last_price_eur != null ? `€${c.last_price_eur.toFixed(2)}` : '—'}
      </Text>
    </Pressable>
  );
}
