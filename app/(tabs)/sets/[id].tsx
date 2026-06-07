// Set detail — every card in the chosen set, with ownership filtering,
// dimmed thumbnails for missing cards, and a multi-select bulk-add flow
// that drops the selection into the user's Bulk binder.

import { View, Text, FlatList, Pressable, Image, ActivityIndicator } from 'react-native';
import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Chip } from '@/components/Chip';
import {
  useSet, useCollection, useMasteringSets, useToggleMastering,
  useMarkCardOwned, useMarkCardsOwned,
} from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { useContentWidth } from '@/lib/layout';
import { theme } from '@/lib/theme';

const GRID_COLS = 3;
const GRID_GAP = 10;
const GRID_PAD = 16;

type OwnershipFilter = 'all' | 'missing' | 'owned';

export default function SetDetail() {
  const { id, lang } = useLocalSearchParams<{ id: string; lang?: string }>();
  const locale: 'en' | 'ja' = lang === 'ja' ? 'ja' : 'en';
  const router = useRouter();
  const { data: set, isLoading } = useSet(id, locale);
  const { data: owned = [] } = useCollection();
  const { data: mastering = [] } = useMasteringSets();
  const toggleMastering = useToggleMastering();
  const markOwned = useMarkCardOwned();
  const markCards = useMarkCardsOwned();
  const toast = useToast();

  const ownedSet = useMemo(() => new Set(owned.map((r) => r.card_id)), [owned]);
  const isMastering = id ? mastering.includes(id) : false;

  const [filter, setFilter] = useState<OwnershipFilter>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const visible = useMemo(() => {
    if (!set) return [];
    if (filter === 'missing') return set.cards.filter((c) => !ownedSet.has(c.id));
    if (filter === 'owned') return set.cards.filter((c) => ownedSet.has(c.id));
    return set.cards;
  }, [set, filter, ownedSet]);

  // Owned-in-this-set count (unique card_ids).
  const ownedInSet = useMemo(() => {
    if (!set) return 0;
    let n = 0;
    for (const c of set.cards) if (ownedSet.has(c.id)) n++;
    return n;
  }, [set, ownedSet]);

  const onToggleMaster = () => {
    if (!id) return;
    toggleMastering.mutate(
      { setId: id, mastering: !isMastering },
      {
        onSuccess: () =>
          toast.success(isMastering ? 'Removed from mastering' : 'Now mastering this set'),
        onError: (e: any) => toast.error(e?.message ?? 'Could not update'),
      },
    );
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const onAddSelected = () => {
    if (!set || selected.size === 0) return;
    const cards = set.cards
      .filter((c) => selected.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        localId: c.localId,
        image: c.image,
        rarity: c.rarity,
        setId: set.id,
        setName: set.name,
      }));
    markCards.mutate(cards, {
      onSuccess: ({ inserted }) => {
        toast.success(`Added ${inserted} ${inserted === 1 ? 'card' : 'cards'} to Bulk`);
        exitSelection();
      },
      onError: (e: any) => toast.error(e?.message ?? 'Could not add'),
    });
  };

  const winW = useContentWidth();
  const cardW = (winW - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cardH = cardW * 1.4;

  if (isLoading) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </Screen>
    );
  }
  if (!set) {
    return (
      <Screen>
        <Header onBack={() => router.back()} title="Not found" />
        <View style={{ padding: 24 }}>
          <Text style={{ color: theme.textDim, fontSize: 14 }}>
            Couldn&apos;t load this set.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {selecting ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingTop: 6, paddingBottom: 6, gap: 8,
        }}>
          <Pressable onPress={exitSelection} hitSlop={12}>
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
              // Only unowned cards in the current filter are selectable.
              const selectable = visible.filter((c) => !ownedSet.has(c.id));
              const allSelected =
                selectable.length > 0 && selectable.every((c) => selected.has(c.id));
              return (
                <Pressable
                  onPress={() => {
                    if (allSelected) setSelected(new Set());
                    else setSelected(new Set(selectable.map((c) => c.id)));
                  }}
                  disabled={selectable.length === 0}
                  hitSlop={12}>
                  <Text style={{
                    color: selectable.length === 0 ? theme.textMute : theme.accent,
                    fontFamily: theme.fontUIBold,
                    fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
                  }}>{allSelected ? 'None' : 'All'}</Text>
                </Pressable>
              );
            })()}
            <Pressable
              onPress={onAddSelected}
              disabled={selected.size === 0 || markCards.isPending}
              hitSlop={12}
            >
              <Text style={{
                color: selected.size === 0 ? theme.textMute : theme.accent,
                fontFamily: theme.fontUIBold,
                fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase',
              }}>Add to Bulk</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Header
          onBack={() => router.back()}
          title={set.name}
          subtitle={`${ownedInSet} / ${set.cards.length} owned`}
          rightSlot={
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable onPress={() => setSelecting(true)} hitSlop={10}>
                <Feather name="check-square" size={18} color={theme.textDim} />
              </Pressable>
              <Pressable onPress={onToggleMaster} hitSlop={10}>
                <Feather
                  name="star"
                  size={20}
                  color={isMastering ? theme.accent : theme.textDim}
                  style={{ opacity: isMastering ? 1 : 0.7 }}
                />
              </Pressable>
            </View>
          }
        />
      )}

      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 6,
        paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6,
      }}>
        <Chip label="All"     active={filter === 'all'}     onPress={() => setFilter('all')} />
        <Chip label="Missing" active={filter === 'missing'} color={theme.statusReally} onPress={() => setFilter('missing')} />
        <Chip label="Owned"   active={filter === 'owned'}   color={theme.statusHave}   onPress={() => setFilter('owned')} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        numColumns={GRID_COLS}
        columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: GRID_PAD }}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 32, gap: GRID_GAP }}
        renderItem={({ item }) => {
          const small = item.image ? `${item.image}/low.webp` : undefined;
          const ownedHere = ownedSet.has(item.id);
          const isSelected = selected.has(item.id);

          const onAdd = (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            if (!set) return;
            markOwned.mutate(
              {
                id: item.id,
                name: item.name,
                localId: item.localId,
                image: item.image,
                rarity: item.rarity,
                setId: set.id,
                setName: set.name,
              },
              {
                onSuccess: () => toast.success(`${item.name} added to Bulk`),
                onError: (e: any) => toast.error(e?.message ?? 'Could not mark as owned'),
              },
            );
          };

          const onTap = () => {
            if (selecting) {
              // Owned cards are already in your collection — disallow
              // re-selecting them via the bulk flow.
              if (ownedHere) return;
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                return next;
              });
            } else {
              router.push(`/card/${item.id}${locale === 'ja' ? '?lang=ja' : ''}`);
            }
          };
          const onLongPress = () => {
            if (ownedHere) return;
            if (!selecting) setSelecting(true);
            setSelected((prev) => {
              const next = new Set(prev);
              next.add(item.id);
              return next;
            });
          };

          return (
            <Pressable
              onPress={onTap}
              onLongPress={onLongPress}
              delayLongPress={280}
              style={{ width: cardW }}
            >
              <View style={{ position: 'relative' }}>
                {small ? (
                  <Image
                    source={{ uri: small }}
                    style={{
                      width: cardW, height: cardH,
                      borderRadius: 6,
                      backgroundColor: theme.surface2,
                      borderWidth: isSelected ? 2 : 0,
                      borderColor: theme.accent,
                      opacity: ownedHere ? 1 : 0.42,
                    }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{
                    width: cardW, height: cardH, borderRadius: 6,
                    backgroundColor: theme.surface2,
                    opacity: ownedHere ? 1 : 0.42,
                  }} />
                )}
                {/* Selection checkbox overlay */}
                {selecting && !ownedHere && (
                  <View style={{
                    position: 'absolute', left: 4, top: 4,
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: isSelected ? theme.accent : 'rgba(0,0,0,0.55)',
                    borderWidth: 1,
                    borderColor: isSelected ? theme.accent : theme.borderStrong,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <Feather name="check" size={12} color={theme.accentText} />}
                  </View>
                )}
                {/* Single-add + button — hidden in selection mode and on owned cards */}
                {!selecting && !ownedHere && (
                  <Pressable
                    onPress={onAdd}
                    disabled={markOwned.isPending}
                    hitSlop={6}
                    style={{
                      position: 'absolute', right: 4, bottom: 4,
                      width: 26, height: 26, borderRadius: 13,
                      backgroundColor: theme.accent,
                      alignItems: 'center', justifyContent: 'center',
                      opacity: markOwned.isPending ? 0.5 : 1,
                    }}
                  >
                    <Feather name="plus" size={14} color={theme.accentText} />
                  </Pressable>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={{
                  marginTop: 4,
                  color: ownedHere ? theme.text : theme.textDim,
                  fontSize: 11,
                }}
              >
                {item.name}
              </Text>
              <Text style={{
                color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
              }}>
                #{item.localId}
                {ownedHere ? '  · OWNED' : ''}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={{ color: theme.textDim, textAlign: 'center', padding: 40 }}>
            No cards in this set.
          </Text>
        }
      />
    </Screen>
  );
}

function Header({
  onBack, title, subtitle, rightSlot,
}: { onBack: () => void; title: string; subtitle?: string; rightSlot?: React.ReactNode }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 14, paddingTop: 6, paddingBottom: 6,
    }}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Feather name="arrow-left" size={22} color={theme.textDim} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: theme.fontDisplay, fontSize: 22, color: theme.text }}
        >
          {title}
        </Text>
        {subtitle && (
          <Text style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono }}>
            {subtitle}
          </Text>
        )}
      </View>
      {rightSlot}
    </View>
  );
}
