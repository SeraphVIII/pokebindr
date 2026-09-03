// Set detail — every card in a set, with ownership filters, bulk add, and
// per-printing master-set tracking.

import { View, Text, FlatList, Pressable, Image } from 'react-native';
import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Chip } from '@/components/Chip';
import { IconDisc, Skeleton } from '@/components/ui';
import { cardImages, type Locale, type TcgdexSetDetail } from '@/lib/tcgdex';
import { slotsForLevel, LEVEL_META, type MastersetLevel, type VariantSlot } from '@/lib/variants';
import {
  useSet, useCollection, useMasteringSets, useToggleMastering,
  useMarkCardOwned, useMarkCardsOwned, usePrefetchCard,
  useSetVariants, useToggleVariantOwned,
} from '@/lib/queries';
import { useToast } from '@/components/Toast';
import { useContentWidth } from '@/lib/layout';
import { theme } from '@/lib/theme';

const GRID_COLS = 3;
const GRID_GAP = 10;
const GRID_PAD = 16;

type OwnershipFilter = 'all' | 'missing' | 'owned';
const LEVELS: MastersetLevel[] = ['base', 'master', 'grand'];

type SetCardBrief = TcgdexSetDetail['cards'][number];
/** One grid tile: a whole card at Base level (slot null), or one specific
 *  printing of it at Master / Grandmaster. */
interface GridItem {
  card: SetCardBrief;
  slot: VariantSlot | null;
  /** Resolved ownership for this tile: card-level at base, per-printing above. */
  owned: boolean;
  /** True when rows stored as 'normal' satisfy this slot: the card has no
   *  Normal printing, so those rows map to its base printing. */
  legacyNormal?: boolean;
  /** First printing of the card; rendered without the variant tag. */
  baseSlot?: boolean;
}

export default function SetDetail() {
  const { id, lang } = useLocalSearchParams<{ id: string; lang?: string }>();
  // The card-scan flow can land here with ?lang=ja.
  const locale: Locale = lang === 'ja' ? 'ja' : 'en';
  const router = useRouter();
  const { data: set, isLoading } = useSet(id, locale);
  const { data: owned = [] } = useCollection();
  const { data: mastering = [] } = useMasteringSets();
  const toggleMastering = useToggleMastering();
  const markOwned = useMarkCardOwned();
  const markCards = useMarkCardsOwned();
  const prefetchCard = usePrefetchCard();
  const toggleVariant = useToggleVariantOwned();
  const toast = useToast();

  const ownedSet = useMemo(() => new Set(owned.map((r) => r.card_id)), [owned]);
  const isMastering = id ? mastering.includes(id) : false;

  const [filter, setFilter] = useState<OwnershipFilter>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [level, setLevel] = useState<MastersetLevel>('base');

  // Variant resolution starts as soon as the set loads, so Master /
  // Grandmaster are usually ready by the time they're tapped.
  const wantVariants = level !== 'base';
  const variantCardIds = useMemo(
    () => (set ? set.cards.map((c) => c.id) : []),
    [set],
  );
  const { variants, progress: variantsProgress, error: variantsError } = useSetVariants(variantCardIds, locale);

  // Per-variant ownership: card_id → (variant key → copies). Only 'have'
  // rows count — a wantlisted copy isn't an owned printing.
  const ownedVariants = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of owned) {
      if (r.status !== 'have') continue;
      const v = r.variant ?? 'normal';
      let inner = m.get(r.card_id);
      if (!inner) { inner = new Map(); m.set(r.card_id, inner); }
      inner.set(v, (inner.get(v) ?? 0) + 1);
    }
    return m;
  }, [owned]);

  // Owned copies for one slot. On cards with no Normal printing, rows stored
  // as 'normal' satisfy the base (first) slot instead of matching nothing.
  const slotOwnedCount = (cardId: string, slots: VariantSlot[], idx: number): number => {
    const inner = ownedVariants.get(cardId);
    if (!inner) return 0;
    let n = inner.get(slots[idx].key) ?? 0;
    if (idx === 0 && !slots.some((s) => s.key === 'normal')) {
      n += inner.get('normal') ?? 0;
    }
    return n;
  };

  // Card tiles at base level (and always while bulk-selecting), one tile per
  // printing above it. The Missing / Owned filter applies at tile granularity.
  const expanded = !selecting && level !== 'base' && !!variants;
  const gridItems = useMemo<GridItem[]>(() => {
    if (!set) return [];
    const items: GridItem[] = [];
    for (const card of set.cards) {
      if (!expanded) {
        const has = ownedSet.has(card.id);
        if (filter === 'missing' && has) continue;
        if (filter === 'owned' && !has) continue;
        items.push({ card, slot: null, owned: has });
      } else {
        const slots = slotsForLevel(variants!.get(card.id), level);
        slots.forEach((slot, idx) => {
          const has = slotOwnedCount(card.id, slots, idx) > 0;
          if (filter === 'missing' && has) return;
          if (filter === 'owned' && !has) return;
          items.push({
            card, slot, owned: has,
            legacyNormal: idx === 0 && !slots.some((s) => s.key === 'normal'),
            baseSlot: idx === 0,
          });
        });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, expanded, filter, ownedSet, variants, level, ownedVariants]);

  // Owned-in-this-set count (unique card_ids).
  const ownedInSet = useMemo(() => {
    if (!set) return 0;
    let n = 0;
    for (const c of set.cards) if (ownedSet.has(c.id)) n++;
    return n;
  }, [set, ownedSet]);

  // Slot totals for the header once variants are in.
  const slotStats = useMemo(() => {
    if (!set || !wantVariants || !variants) return null;
    let total = 0;
    let ownedCount = 0;
    for (const c of set.cards) {
      const slots = slotsForLevel(variants.get(c.id), level);
      for (let i = 0; i < slots.length; i++) {
        total++;
        if (slotOwnedCount(c.id, slots, i) > 0) ownedCount++;
      }
    }
    return { total, owned: ownedCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, wantVariants, variants, level, ownedVariants]);

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

  const onToggleSlot = (item: GridItem) => {
    const { card, slot } = item;
    if (!set || !slot || toggleVariant.isPending) return;
    toggleVariant.mutate(
      {
        card: {
          id: card.id, name: card.name, localId: card.localId,
          image: card.image, rarity: card.rarity,
          setId: set.id, setName: set.name,
        },
        variantKey: slot.key,
        owned: !item.owned,
        // Un-owning a base slot may need to release a copy stored as 'normal'.
        fallbackKeys: item.legacyNormal ? ['normal'] : undefined,
      },
      { onError: (e: any) => toast.error(e?.message ?? 'Could not update printing') },
    );
  };

  const openCard = (cardId: string) => {
    prefetchCard(cardId, locale);
    router.push(`/card/${cardId}${locale !== 'en' ? `?lang=${locale}` : ''}`);
  };

  const winW = useContentWidth();
  const cardW = (winW - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cardH = cardW * 1.4;

  if (isLoading) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 6 }}>
          <IconDisc name="chevron-left" onPress={() => router.back()} />
          <View style={{ gap: 8 }}>
            <Skeleton width={160} height={20} radius={8} />
            <Skeleton width={90} height={10} radius={5} />
          </View>
        </View>
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap',
          gap: GRID_GAP, paddingHorizontal: GRID_PAD, paddingTop: 20,
        }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} width={cardW} height={cardH} radius={8} />
          ))}
        </View>
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
              const selectable = gridItems
                .map((i) => i.card)
                .filter((c) => !ownedSet.has(c.id));
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
          subtitle={
            wantVariants && slotStats
              ? `${slotStats.owned} / ${slotStats.total} ${LEVEL_META[level].label.toLowerCase()} slots`
              : `${ownedInSet} / ${set.cards.length} owned`
          }
          rightSlot={
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <IconDisc
                name="check-square"
                iconSize={15}
                onPress={() => setSelecting(true)}
              />
              <IconDisc name="star" active={isMastering} onPress={onToggleMaster} />
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

      {!selecting && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingHorizontal: 16, paddingBottom: 6,
        }}>
          {LEVELS.map((l) => (
            <Chip
              key={l}
              label={LEVEL_META[l].label}
              active={level === l}
              onPress={() => setLevel(l)}
            />
          ))}
        </View>
      )}

      {wantVariants && !variantsProgress && variantsError && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{
            color: theme.statusReally, fontSize: 10, fontFamily: theme.fontMono,
            letterSpacing: 0.5,
          }}>
            Couldn&apos;t load printings. Tap Base, then {LEVEL_META[level].label} to retry.
          </Text>
        </View>
      )}

      {variantsProgress && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 5 }}>
          <Text style={{
            color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
            letterSpacing: 0.5,
          }}>
            Fetching printings · {variantsProgress.done}/{variantsProgress.total}
          </Text>
          <View style={{
            height: 3, borderRadius: 2, backgroundColor: theme.glassStrong,
            overflow: 'hidden',
          }}>
            <View style={{
              height: 3, borderRadius: 2, backgroundColor: theme.accent,
              width: `${Math.round((variantsProgress.done / Math.max(1, variantsProgress.total)) * 100)}%`,
            }} />
          </View>
        </View>
      )}

      <FlatList
        data={gridItems}
        keyExtractor={(i) => `${i.card.id}:${i.slot?.key ?? 'card'}`}
        numColumns={GRID_COLS}
        columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: GRID_PAD }}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 32, gap: GRID_GAP }}
        renderItem={({ item }) => {
          const { card, slot } = item;
          // cardImages falls back to PokemonTCG.io for TG / GG gallery
          // subsets, which TCGdex has no artwork for.
          const small = cardImages(card.image, set.id, card.localId).small || undefined;
          const ownedHere = item.owned;
          const isSelected = selected.has(card.id);

          const onAdd = (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            if (!set) return;
            markOwned.mutate(
              {
                id: card.id,
                name: card.name,
                localId: card.localId,
                image: card.image,
                rarity: card.rarity,
                setId: set.id,
                setName: set.name,
              },
              {
                onSuccess: () => toast.success(`${card.name} added to Bulk`),
                onError: (e: any) => toast.error(e?.message ?? 'Could not mark as owned'),
              },
            );
          };

          const onTap = () => {
            if (selecting) {
              // Owned cards can't be re-selected via the bulk flow.
              if (ownedHere) return;
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(card.id)) next.delete(card.id); else next.add(card.id);
                return next;
              });
            } else {
              openCard(card.id);
            }
          };
          const onLongPress = () => {
            if (slot || ownedHere) return;
            if (!selecting) setSelecting(true);
            setSelected((prev) => {
              const next = new Set(prev);
              next.add(card.id);
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
                {slot && !item.baseSlot && (
                  <View style={{
                    position: 'absolute', left: 4, right: 4, bottom: 5,
                    alignItems: 'center',
                  }}>
                    <View style={{
                      maxWidth: '100%',
                      paddingHorizontal: 8, paddingVertical: 3.5,
                      borderRadius: theme.pill,
                      backgroundColor: 'rgba(6,4,3,0.72)',
                      borderWidth: 1,
                      borderColor: ownedHere ? theme.accent : theme.hairline,
                    }}>
                      <Text
                        numberOfLines={1}
                        style={{
                          fontFamily: theme.fontMono, fontSize: 8,
                          letterSpacing: 0.6, textTransform: 'uppercase',
                          color: ownedHere ? theme.accent : theme.textDim,
                        }}>
                        {slot.short}
                      </Text>
                    </View>
                  </View>
                )}
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
                {/* Disc sits top-right so it never collides with the variant tag. */}
                {!selecting && slot && (
                  <Pressable
                    onPress={(e) => { e.stopPropagation(); onToggleSlot(item); }}
                    disabled={toggleVariant.isPending}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      position: 'absolute', right: 5, top: 5,
                      width: 26, height: 26, borderRadius: 13,
                      backgroundColor: ownedHere ? 'rgba(6,4,3,0.72)' : theme.accent,
                      borderWidth: ownedHere ? 1 : 0,
                      borderColor: theme.hairline,
                      alignItems: 'center', justifyContent: 'center',
                      opacity: toggleVariant.isPending ? 0.5 : 1,
                      boxShadow: ownedHere ? undefined : theme.shadowGold,
                      transform: [{ scale: pressed ? 0.88 : 1 }],
                    })}
                  >
                    <Feather
                      name={ownedHere ? 'minus' : 'plus'}
                      size={14}
                      color={ownedHere ? theme.textDim : theme.accentText}
                    />
                  </Pressable>
                )}
                {!selecting && !slot && !ownedHere && (
                  <Pressable
                    onPress={onAdd}
                    disabled={markOwned.isPending}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      position: 'absolute', right: 5, bottom: 5,
                      width: 26, height: 26, borderRadius: 13,
                      backgroundColor: theme.accent,
                      alignItems: 'center', justifyContent: 'center',
                      opacity: markOwned.isPending ? 0.5 : 1,
                      boxShadow: theme.shadowGold,
                      transform: [{ scale: pressed ? 0.88 : 1 }],
                    })}
                  >
                    <Feather name="plus" size={14} color={theme.accentText} />
                  </Pressable>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={{
                  marginTop: 5,
                  color: ownedHere ? theme.text : theme.textDim,
                  fontSize: 11, fontFamily: theme.fontUI,
                }}
              >
                {card.name}
              </Text>
              <Text style={{
                color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
              }}>
                #{card.localId}
                {!slot && ownedHere ? '  · OWNED' : ''}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={{ color: theme.textDim, textAlign: 'center', padding: 40, fontFamily: theme.fontUI, fontSize: 13 }}>
            {filter === 'missing'
              ? (expanded ? 'Every printing at this level is owned.' : 'Nothing missing. Set complete.')
              : filter === 'owned'
              ? (expanded ? 'No printings owned at this level yet.' : 'Nothing owned in this set yet.')
              : locale !== 'en'
              ? 'TCGdex has no card data for this set yet.'
              : 'No cards in this set.'}
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
      <IconDisc name="chevron-left" onPress={onBack} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: theme.fontDisplaySemi, fontSize: 22, color: theme.text }}
        >
          {title}
        </Text>
        {subtitle && (
          <Text style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {rightSlot}
    </View>
  );
}
