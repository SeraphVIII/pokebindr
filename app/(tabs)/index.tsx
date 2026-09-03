// Home — collection value, status counts, mastering progress, recents.

import { ScrollView, View, Text, Image, RefreshControl } from 'react-native';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import {
  Bezel, PressableScale, AmbientGlow, ProgressRing, Skeleton, Button, SectionHeader,
} from '@/components/ui';
import { useCollection, useMyProfile, useMasteringSets, useSets, usePrefetchCard } from '@/lib/queries';
import { theme } from '@/lib/theme';
import type { CollectionRow } from '@/lib/types';
import type { TcgdexSet } from '@/lib/tcgdex';

function timeOfDayGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 4 && h < 12) return 'Good morning';
  if (h >= 12 && h < 20) return 'Good afternoon';
  return 'Good evening';
}

const enter = (i: number) => FadeInDown.duration(420).delay(70 * i).springify().damping(24);

export default function Home() {
  const { data: collection = [], isLoading } = useCollection();
  const { data: profile } = useMyProfile();
  const rawName = profile?.username ?? 'trainer';
  // Capitalize first letter so it reads as a name, not a handle.
  const displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const greeting = timeOfDayGreeting();
  const router = useRouter();
  const qc = useQueryClient();
  const prefetchCard = usePrefetchCard();
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

  // Mastering progress counts distinct owned card_ids per set, so multiple
  // variants of a card count once.
  const { data: masteringIds = [] } = useMasteringSets();
  const { data: allSets = [] } = useSets();
  const setMap = useMemo(() => {
    const m = new Map<string, TcgdexSet>();
    for (const s of allSets) m.set(s.id, s);
    return m;
  }, [allSets]);
  const ownedCountBySet = useMemo(() => {
    const m = new Map<string, number>();
    const seen = new Set<string>();
    for (const c of have) {
      const key = `${c.set_id}|${c.card_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      m.set(c.set_id, (m.get(c.set_id) ?? 0) + 1);
    }
    return m;
  }, [have]);
  const masteringSets = masteringIds
    .map((id) => setMap.get(id))
    .filter((s): s is TcgdexSet => !!s);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 36 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <Animated.View entering={enter(0)}>
          <Eyebrow>Welcome back</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 34, color: theme.text,
            marginTop: 6, lineHeight: 42,
          }}>
            {greeting},{'\n'}
            <Text style={{ fontFamily: theme.fontDisplaySemi, color: theme.accent }}>{displayName}.</Text>
          </Text>
        </Animated.View>

        {/* hero value */}
        <Animated.View entering={enter(1)}>
          <PressableScale onPress={() => router.push('/collection')} style={{ marginTop: 22 }}>
            <Bezel glow>
              <View style={{ padding: 22, overflow: 'hidden' }}>
                <AmbientGlow size={300} style={{ top: -150, right: -110 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Eyebrow>Collection value · EUR</Eyebrow>
                  <View style={{
                    width: 26, height: 26, borderRadius: theme.pill,
                    backgroundColor: theme.accentSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Feather name="arrow-up-right" size={13} color={theme.accent} />
                  </View>
                </View>
                {isLoading ? (
                  <Skeleton height={46} width={220} style={{ marginTop: 10 }} />
                ) : (
                  <Text style={{
                    fontFamily: theme.fontMono,
                    fontSize: 42, color: theme.text,
                    marginTop: 8, lineHeight: 50,
                    letterSpacing: -1,
                  }}>
                    €{value.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                )}
                <Text style={{
                  color: theme.textDim, fontSize: 12, marginTop: 8,
                  fontFamily: theme.fontMono,
                }}>
                  {have.length} cards owned · prices via Cardmarket
                </Text>
              </View>
            </Bezel>
          </PressableScale>
        </Animated.View>

        {/* status strip */}
        <Animated.View entering={enter(2)} style={{ marginTop: 14, flexDirection: 'row', gap: 10 }}>
          <Stat label="Have" val={have.length}   color={theme.statusHave}   soft={theme.statusHaveSoft}   onPress={() => router.push('/collection?status=have')} />
          <Stat label="Want" val={want.length}   color={theme.statusWant}   soft={theme.statusWantSoft}   onPress={() => router.push('/wantlist?focus=want')} />
          <Stat label="Need" val={really.length} color={theme.statusReally} soft={theme.statusReallySoft} onPress={() => router.push('/wantlist?focus=need')} />
        </Animated.View>

        {/* mastering carousel */}
        {masteringSets.length > 0 && (
          <Animated.View entering={enter(3)} style={{ marginTop: 30, marginHorizontal: -24 }}>
            <View style={{ paddingHorizontal: 24, marginBottom: 12 }}>
              <SectionHeader title="Mastering" action="Browse sets" onAction={() => router.push('/sets')} />
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
                  <MasteringCard
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
          </Animated.View>
        )}

        {/* recent */}
        <Animated.View entering={enter(4)} style={{ marginTop: 30 }}>
          <SectionHeader title="Recently added" action="See binder" onAction={() => router.push('/binder')} />
          <View style={{ marginTop: 12, gap: 10 }}>
            {isLoading && (
              <>
                <Skeleton height={66} radius={theme.radius} />
                <Skeleton height={66} radius={theme.radius} />
                <Skeleton height={66} radius={theme.radius} />
              </>
            )}
            {collection.slice(0, 4).map((c) => (
              <RecentRow
                key={c.id}
                c={c}
                onPress={() => {
                  prefetchCard(c.card_id);
                  router.push(`/card/${c.card_id}?row=${c.id}`);
                }}
              />
            ))}
            {!isLoading && collection.length === 0 && (
              <View style={{
                borderWidth: 1, borderColor: theme.hairline, borderStyle: 'dashed',
                backgroundColor: theme.glass,
                borderRadius: theme.radiusLg, padding: 28,
                alignItems: 'center',
              }}>
                <View style={{
                  width: 52, height: 52, borderRadius: theme.pill,
                  backgroundColor: theme.accentSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Feather name="layers" size={22} color={theme.accent} />
                </View>
                <Text style={{
                  color: theme.text, fontSize: 20, textAlign: 'center',
                  marginTop: 14, fontFamily: theme.fontDisplaySemi,
                }}>
                  Your binder is empty
                </Text>
                <Text style={{
                  color: theme.textDim, fontSize: 13, textAlign: 'center',
                  marginTop: 6, fontFamily: theme.fontUI, lineHeight: 19,
                }}>
                  Search the catalogue or scan a card to start the collection.
                </Text>
                <Button
                  label="Add your first card"
                  icon="arrow-right"
                  onPress={() => router.push('/lookup')}
                  style={{ marginTop: 18 }}
                />
              </View>
            )}
          </View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label, val, color, soft, onPress,
}: { label: string; val: number; color: string; soft: string; onPress?: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      style={{
        flex: 1,
        backgroundColor: theme.glass,
        borderWidth: 1, borderColor: theme.hairline,
        borderRadius: theme.radius,
        paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14,
        boxShadow: theme.shadowInner,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{
          width: 16, height: 16, borderRadius: theme.pill,
          backgroundColor: soft,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
        </View>
        <Eyebrow style={{ fontSize: 9 }}>{label}</Eyebrow>
      </View>
      <Text style={{
        fontFamily: theme.fontMono,
        fontSize: 26, color: theme.text, marginTop: 10,
        letterSpacing: -0.5,
      }}>{val}</Text>
    </PressableScale>
  );
}

function MasteringCard({
  set, owned, total, pct, onPress,
}: {
  set: TcgdexSet;
  owned: number;
  total: number;
  pct: number;
  onPress: () => void;
}) {
  const W = 132;
  const complete = pct >= 1;
  return (
    <PressableScale
      onPress={onPress}
      style={{
        width: W,
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.hairline,
        borderRadius: theme.radiusLg,
        padding: 14,
        alignItems: 'center',
        gap: 10,
        boxShadow: theme.shadowInner,
      }}
    >
      <ProgressRing size={62} stroke={4} progress={pct} color={complete ? theme.statusHave : theme.accent}>
        <Text style={{
          fontFamily: theme.fontMono, fontSize: 12,
          color: complete ? theme.statusHave : theme.accent,
        }}>
          {Math.round(pct * 100)}%
        </Text>
      </ProgressRing>
      <View style={{ width: W - 28, height: 34, alignItems: 'center', justifyContent: 'center' }}>
        {set.logo ? (
          <Image
            source={{ uri: `${set.logo}.png` }}
            style={{ width: W - 28, height: 34 }}
            resizeMode="contain"
          />
        ) : set.symbol ? (
          <Image
            source={{ uri: `${set.symbol}.png` }}
            style={{ width: 26, height: 26 }}
            resizeMode="contain"
          />
        ) : (
          <Text numberOfLines={2} style={{
            color: theme.textDim, fontSize: 11, textAlign: 'center', fontFamily: theme.fontUI,
          }}>{set.name}</Text>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
        }}
      >
        {owned}/{total} owned
      </Text>
    </PressableScale>
  );
}

function RecentRow({ c, onPress }: { c: CollectionRow; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic={false}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        padding: 12,
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.hairline,
        borderRadius: theme.radius,
        boxShadow: theme.shadowInner,
      }}>
      {c.image_small ? (
        <Image
          source={{ uri: c.image_small }}
          style={{ width: 36, height: 50, borderRadius: 5, backgroundColor: theme.surface3 }}
        />
      ) : (
        <View style={{
          width: 36, height: 50, borderRadius: 5,
          backgroundColor: theme.surface3,
          borderWidth: 1, borderColor: theme.hairline,
        }} />
      )}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14.5, fontFamily: theme.fontUIBold }}>{c.card_name}</Text>
        <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, marginTop: 3 }}>
          {c.set_name} · {c.card_number}
        </Text>
      </View>
      <Text style={{ color: c.last_price_eur != null ? theme.text : theme.textMute, fontSize: 12.5, fontFamily: theme.fontMono }}>
        {c.last_price_eur != null ? `€${c.last_price_eur.toFixed(2)}` : '·'}
      </Text>
      <Feather name="chevron-right" size={15} color={theme.textMute} />
    </PressableScale>
  );
}
