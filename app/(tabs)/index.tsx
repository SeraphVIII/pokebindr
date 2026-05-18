// Home — collection value, status counts, recent additions.

import { ScrollView, View, Text, Pressable, Image, RefreshControl } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { useCollection } from '@/lib/queries';
import { theme } from '@/lib/theme';
import type { CollectionRow } from '@/lib/types';

export default function Home() {
  const { data: collection = [], isLoading } = useCollection();
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
          marginTop: 6, lineHeight: 32,
        }}>
          Good evening,{'\n'}
          <Text style={{ color: theme.accent }}>Trainer.</Text>
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
                  borderWidth: 1, borderColor: theme.border, borderStyle: 'dashed',
                  borderRadius: theme.radius, padding: 24,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.textDim, fontSize: 14, textAlign: 'center' }}>
                  Your binder is empty.{'\n'}
                  <Text style={{ color: theme.accent }}>Tap to add your first card →</Text>
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
        padding: 10,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        <Eyebrow style={{ fontSize: 9 }}>{label}</Eyebrow>
      </View>
      <Text style={{
        fontFamily: theme.fontMono,
        fontSize: 20, color: theme.text, marginTop: 4,
      }}>{val}</Text>
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
