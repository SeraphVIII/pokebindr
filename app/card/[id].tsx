// Card detail — opens for any card_id. Pulls live data from PokemonTCG.io.
//
// If the card is NOT yet in any binder, shows an "Add to: BinderX" button
// (BinderX = last-used binder). The binder name is itself tappable; it
// opens a bottom-anchored picker (40% of screen height).
//
// If the card IS in a binder, shows status pills and a trash icon to remove.

import { useState, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  View, Text, ScrollView, Image, Pressable, Alert, ActivityIndicator,
  useWindowDimensions, Modal, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { Chip } from '@/components/Chip';
import { Sparkline } from '@/components/Sparkline';
import {
  useCollectionItem, useCollectionRowById, useCollectionItemsByCardId,
  useTcgCard, useSetStatus, useRemoveCard, useBinders, useUpsertCard,
  useUpdateCardRow,
} from '@/lib/queries';
import { useLastBinder } from '@/lib/lastBinder';
import { theme } from '@/lib/theme';
import type { Status, Binder, TcgCard, CollectionRow } from '@/lib/types';

const CONDITIONS = ['NM', 'EX', 'GD', 'LP', 'MP', 'HP'] as const;

// Open Cardmarket's search page for this card, English-only.
//
// Earlier attempts (?idProduct=…, resolving the tracker via fetch) ran into
// Cardmarket's anti-bot 403s and inconsistent redirect behaviour. The plain
// search URL is rock-solid: takes a card name, returns a page of products
// the user can click through to, and `language=1` survives the URL.
function openCardmarket(card: { name: string }) {
  const q = encodeURIComponent(card.name);
  const url = `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${q}&language=1`;
  Linking.openURL(url);
}

export default function CardDetail() {
  // `id` = PokemonTCG.io card id. Optional `row` query param identifies
  // a specific user-owned instance (since the same card_id can appear
  // multiple times in a binder).
  const { id, row: rowParam } = useLocalSearchParams<{ id: string; row?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: card, isLoading: loadingCard, error: cardError } = useTcgCard(id);
  // If a row is specified, look it up directly. Otherwise the user came
  // from a context that doesn't know about a specific instance (e.g. search)
  // — show info-only with an Add button.
  const { data: rowById } = useCollectionRowById(rowParam);
  const { data: allInstances = [] } = useCollectionItemsByCardId(rowParam ? undefined : id);
  const { data: fallbackRow } = useCollectionItem(rowParam ? undefined : id);
  // In instance mode (row param set): row = the specific instance.
  // In aggregate mode (no row param): row stays null; the screen shows the
  // "Your copies" breakdown instead of the instance controls.
  const row = rowParam ? rowById : null;
  void fallbackRow;
  const { data: binders = [] } = useBinders();
  const setStatus = useSetStatus();
  const remove = useRemoveCard();
  const upsert = useUpsertCard();
  const updateRow = useUpdateCardRow();
  const { lastBinderId, setLastBinder } = useLastBinder();
  const { width: winW, height: winH } = useWindowDimensions();
  const sparkW = Math.max(160, winW - (24 + 16) * 2);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenBinderId, setChosenBinderId] = useState<string | null>(null);

  // Default the picker selection: whatever the user last used; otherwise
  // the first binder they have.
  const targetBinderId = useMemo(() => {
    if (chosenBinderId && binders.some((b) => b.id === chosenBinderId)) return chosenBinderId;
    if (lastBinderId && binders.some((b) => b.id === lastBinderId)) return lastBinderId;
    return binders[0]?.id ?? null;
  }, [chosenBinderId, lastBinderId, binders]);
  const targetBinder = binders.find((b) => b.id === targetBinderId) ?? null;

  // All hooks must run on every render; compute fallback off card?. so the
  // hook runs even while `card` is loading.
  const tcgFallback = useMemo(() => pickTcgplayerPrice(card?.tcgplayer), [card?.tcgplayer]);

  if (loadingCard) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </Screen>
    );
  }
  if (!card) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <View style={{ paddingHorizontal: 14, paddingTop: 6 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={theme.textDim} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: theme.textDim, fontSize: 14, textAlign: 'center' }}>
            Card data couldn't be loaded.
            {'\n'}
            <Text style={{ color: theme.textMute, fontSize: 11, fontFamily: theme.fontMono }}>
              {String(cardError ?? id)}
            </Text>
          </Text>
        </View>
      </Screen>
    );
  }

  const prices = card.cardmarket?.prices;
  const cmAvg = prices?.trendPrice ?? prices?.averageSellPrice ?? null;
  const cmLow = prices?.lowPrice ?? null;
  const usingCM = cmAvg != null;
  const avg = usingCM ? cmAvg : tcgFallback?.market ?? null;
  const low = usingCM ? cmLow : tcgFallback?.low ?? null;
  const currency = usingCM ? '€' : '$';
  const priceSource = usingCM ? 'Cardmarket · EU' : tcgFallback ? 'TCGplayer · US' : null;

  const series = (usingCM
    ? [prices?.avg30, prices?.avg30, prices?.avg7, prices?.avg7, prices?.avg1, prices?.trendPrice]
    : [tcgFallback?.low, tcgFallback?.mid, tcgFallback?.market, tcgFallback?.high]
  ).filter((n): n is number => typeof n === 'number');

  const pickStatus = async (s: Status) => {
    if (!row) return;
    try {
      await setStatus.mutateAsync({ rowId: row.id, status: s });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const removeFromBinder = () => {
    if (!row) return;
    Alert.alert('Remove from binder?', card.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive',
        onPress: async () => { await remove.mutateAsync(row.id); router.back(); } },
    ]);
  };

  const handleAdd = async () => {
    if (!targetBinder) {
      Alert.alert(
        'No binders yet',
        'Create a binder first.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Create binder', onPress: () => router.push('/binder/new') },
        ],
      );
      return;
    }
    try {
      await upsert.mutateAsync({ card, status: 'have', binderId: targetBinder.id });
      await setLastBinder(targetBinder.id);
      // Stay in aggregate mode so the stepper can keep accumulating copies.
      // The "Your copies" breakdown below the stepper updates automatically.
    } catch (e: any) {
      Alert.alert('Could not add', e.message ?? 'Unknown error');
    }
  };

  // Remove one copy of this card from the currently selected binder. We
  // delete the most recently added row so it pairs naturally with the +
  // button (last-in-first-out).
  const handleRemoveOne = async () => {
    if (!targetBinder) return;
    const here = allInstances.filter((r) => r.binder_id === targetBinder.id);
    if (here.length === 0) return;
    const last = here
      .slice()
      .sort((a, b) => b.added_at.localeCompare(a.added_at))[0];
    try {
      await remove.mutateAsync(last.id);
    } catch (e: any) {
      Alert.alert('Could not remove', e.message ?? 'Unknown error');
    }
  };

  const choose = async (b: Binder) => {
    setChosenBinderId(b.id);
    await setLastBinder(b.id);
    setPickerOpen(false);
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        padding: 14,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={theme.textDim} />
        </Pressable>
        {row && (
          <Pressable onPress={removeFromBinder} hitSlop={12}>
            <Feather name="trash-2" size={18} color={theme.textDim} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <Image
            source={{ uri: card.images.large }}
            style={{ width: 220, height: 308, borderRadius: 12 }}
            resizeMode="contain"
          />
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: 12 }}>
          <Eyebrow>
            {card.set.name} · {card.number}{card.rarity ? ` · ${card.rarity}` : ''}
          </Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 32, color: theme.text, marginTop: 4, lineHeight: 34,
          }}>{card.name}</Text>
          {card.hp && (
            <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 6 }}>
              HP <Text style={{ color: theme.accent, fontFamily: theme.fontMono, fontWeight: '600' }}>{card.hp}</Text>
              {card.types && card.types.length > 0 ? `  ·  ${card.types.join(', ')}` : ''}
            </Text>
          )}

          {row ? (
            <>
              <View style={{ marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Chip label="Have"        active={row.status === 'have'}   color={theme.statusHave}   onPress={() => pickStatus('have')} />
                <Chip label="Want"        active={row.status === 'want'}   color={theme.statusWant}   onPress={() => pickStatus('want')} />
                <Chip label="Need" active={row.status === 'really'} color={theme.statusReally} onPress={() => pickStatus('really')} />
              </View>

              {/* condition (per-instance) */}
              <View style={{ marginTop: 18 }}>
                <Eyebrow style={{ marginBottom: 6 }}>Condition</Eyebrow>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {CONDITIONS.map((c) => {
                    const active = row.condition === c;
                    return (
                      <Pressable
                        key={c}
                        onPress={() => updateRow.mutate({
                          rowId: row.id,
                          fields: { condition: c },
                        })}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 7,
                          borderRadius: theme.radius,
                          borderWidth: 1,
                          borderColor: active ? theme.accent : theme.border,
                          backgroundColor: active ? theme.accent : 'transparent',
                        }}>
                        <Text style={{
                          fontFamily: theme.fontMono, fontSize: 11,
                          color: active ? theme.accentText : theme.textDim,
                        }}>{c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          ) : (
            <>
              <AddStepper
                binder={targetBinder}
                instances={allInstances}
                busy={upsert.isPending || remove.isPending}
                onAdd={handleAdd}
                onRemoveOne={handleRemoveOne}
                onChangeBinder={() => setPickerOpen(true)}
              />
              {allInstances.length > 0 && (
                <CopiesBreakdown
                  instances={allInstances}
                  binders={binders}
                  onTapInstance={(rowId) =>
                    router.setParams({ row: rowId })
                  }
                />
              )}
            </>
          )}
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: 22 }}>
          <View style={{
            backgroundColor: theme.surface,
            borderWidth: 1, borderColor: theme.border,
            borderRadius: theme.radius * 1.5,
            padding: 16,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View>
                <Eyebrow>
                  {priceSource ? `Market avg · ${priceSource}` : 'No price data yet'}
                </Eyebrow>
                <Text style={{
                  fontFamily: theme.fontMono,
                  fontSize: 32, color: theme.text, marginTop: 4, lineHeight: 38,
                  letterSpacing: -0.3,
                }}>
                  {avg != null ? `${currency}${avg.toFixed(2)}` : '—'}
                </Text>
              </View>
              {low != null && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Eyebrow>Low</Eyebrow>
                  <Text style={{ color: theme.text, fontSize: 16, fontFamily: theme.fontMono, marginTop: 4 }}>
                    {currency}{low.toFixed(2)}
                  </Text>
                </View>
              )}
            </View>

            {series.length > 1 && (
              <View style={{ marginTop: 16 }}>
                <Sparkline data={series} width={sparkW} height={56} />
              </View>
            )}

            {(usingCM ? card.cardmarket?.updatedAt : card.tcgplayer?.updatedAt) && (
              <Text style={{
                color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
                marginTop: 12, letterSpacing: 0.5,
              }}>
                Updated {usingCM ? card.cardmarket?.updatedAt : card.tcgplayer?.updatedAt}
              </Text>
            )}
          </View>
        </View>

        {usingCM && prices && (
          <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
            <Eyebrow>Breakdown</Eyebrow>
            <View style={{ marginTop: 10, gap: 8 }}>
              {prices.lowPrice != null         && <PriceRow currency="€" label="Low"        value={prices.lowPrice} />}
              {prices.trendPrice != null       && <PriceRow currency="€" label="Trend"      value={prices.trendPrice} />}
              {prices.averageSellPrice != null && <PriceRow currency="€" label="Avg sale"   value={prices.averageSellPrice} />}
              {prices.avg7 != null             && <PriceRow currency="€" label="7-day avg"  value={prices.avg7} />}
              {prices.avg30 != null            && <PriceRow currency="€" label="30-day avg" value={prices.avg30} />}
            </View>
          </View>
        )}
        {!usingCM && tcgFallback && (
          <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
            <Eyebrow>Breakdown · {tcgFallback.variant}</Eyebrow>
            <View style={{ marginTop: 10, gap: 8 }}>
              {tcgFallback.low    != null && <PriceRow currency="$" label="Low"    value={tcgFallback.low} />}
              {tcgFallback.mid    != null && <PriceRow currency="$" label="Mid"    value={tcgFallback.mid} />}
              {tcgFallback.market != null && <PriceRow currency="$" label="Market" value={tcgFallback.market} />}
              {tcgFallback.high   != null && <PriceRow currency="$" label="High"   value={tcgFallback.high} />}
            </View>
          </View>
        )}

        {card.name && (
          <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
            <Pressable
              onPress={() => openCardmarket(card)}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8,
                paddingVertical: 14,
                borderWidth: 1, borderColor: theme.borderStrong,
                borderRadius: theme.radius,
              }}>
              <Feather name="external-link" size={14} color={theme.accent} />
              <Text style={{
                color: theme.accent, fontSize: 13,
                fontFamily: theme.fontUIBold, letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}>Buy on Cardmarket · EN</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => setPickerOpen(false)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
          />
          <View style={{
            height: winH * 0.4 + insets.bottom,
            backgroundColor: theme.surface,
            borderTopLeftRadius: theme.radius * 2,
            borderTopRightRadius: theme.radius * 2,
            borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
            borderColor: theme.borderStrong,
            paddingHorizontal: 20, paddingTop: 18,
            paddingBottom: 24 + insets.bottom,
          }}>
            <Eyebrow>Add to</Eyebrow>
            <Text style={{
              fontFamily: theme.fontDisplay,
              fontSize: 20, color: theme.text, marginTop: 4, marginBottom: 12,
            }}>Choose a binder</Text>
            <ScrollView>
              {binders.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => choose(b)}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingVertical: 14, paddingHorizontal: 4,
                    borderBottomWidth: 1, borderBottomColor: theme.border,
                  }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      color: b.id === targetBinderId ? theme.accent : theme.text,
                      fontSize: 15,
                      fontFamily: theme.fontUI,
                    }}>{b.name}</Text>
                    <Text style={{
                      fontFamily: theme.fontMono, fontSize: 11, color: theme.textDim, marginTop: 2,
                    }}>{b.grid_cols}×{b.grid_rows}</Text>
                  </View>
                  {b.id === targetBinderId && (
                    <Feather name="check" size={16} color={theme.accent} />
                  )}
                </Pressable>
              ))}
              {binders.length === 0 && (
                <Text style={{ color: theme.textDim, fontSize: 13, paddingVertical: 16 }}>
                  No binders yet. Close this and create one.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function AddStepper({
  binder, instances, busy,
  onAdd, onRemoveOne, onChangeBinder,
}: {
  binder: Binder | null;
  instances: CollectionRow[];
  busy: boolean;
  onAdd: () => void;
  onRemoveOne: () => void;
  onChangeBinder: () => void;
}) {
  const qty = binder
    ? instances.filter((r) => r.binder_id === binder.id).length
    : 0;
  return (
    <View style={{
      marginTop: 16,
      backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.borderStrong,
      borderRadius: theme.radius,
      padding: 14,
    }}>
      <Eyebrow>Add to binder</Eyebrow>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 8, gap: 12,
      }}>
        <Pressable
          onPress={onChangeBinder}
          hitSlop={8}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: theme.text,
              fontFamily: theme.fontDisplay,
              fontSize: 20,
              flex: 1,
            }}>
            {binder ? binder.name : 'No binders — create one'}
          </Text>
          <Feather name="chevron-down" size={16} color={theme.textDim} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <StepperBtn
            icon="minus"
            disabled={qty === 0 || busy || !binder}
            onPress={onRemoveOne}
          />
          <Text style={{
            color: theme.accent,
            fontFamily: theme.fontMono, fontSize: 18, fontWeight: '600',
            minWidth: 22, textAlign: 'center',
          }}>{qty}</Text>
          <StepperBtn
            icon="plus"
            disabled={!binder || busy}
            onPress={onAdd}
          />
        </View>
      </View>
    </View>
  );
}

function StepperBtn({
  icon, disabled, onPress,
}: { icon: 'plus' | 'minus'; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={{
        width: 34, height: 34, borderRadius: 17,
        borderWidth: 1,
        borderColor: disabled ? theme.border : theme.accent,
        backgroundColor: disabled ? 'transparent' : theme.accent,
        alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}>
      <Feather
        name={icon}
        size={16}
        color={disabled ? theme.textDim : theme.accentText}
      />
    </Pressable>
  );
}

function CopiesBreakdown({
  instances, binders, onTapInstance,
}: {
  instances: import('@/lib/types').CollectionRow[];
  binders: Binder[];
  onTapInstance: (rowId: string) => void;
}) {
  const binderName = new Map(binders.map((b) => [b.id, b.name]));
  // Group instances by condition; within each condition, list the binders.
  const groups = new Map<string, typeof instances>();
  for (const r of instances) {
    if (!groups.has(r.condition)) groups.set(r.condition, []);
    groups.get(r.condition)!.push(r);
  }
  // Conditions in a stable order matching the picker.
  const order = ['NM', 'EX', 'GD', 'LP', 'MP', 'HP'];
  const ordered = Array.from(groups.entries()).sort(
    ([a], [b]) => order.indexOf(a) - order.indexOf(b),
  );
  return (
    <View style={{ marginTop: 18 }}>
      <Eyebrow style={{ marginBottom: 8 }}>Your copies · {instances.length}</Eyebrow>
      <View style={{
        borderWidth: 1, borderColor: theme.border,
        borderRadius: theme.radius,
        backgroundColor: theme.surface,
        overflow: 'hidden',
      }}>
        {ordered.map(([condition, rows], gi) => (
          <View
            key={condition}
            style={{
              borderTopWidth: gi === 0 ? 0 : 1,
              borderTopColor: theme.border,
            }}>
            <View style={{
              flexDirection: 'row', alignItems: 'baseline',
              paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6,
            }}>
              <Text style={{
                color: theme.accent,
                fontFamily: theme.fontMono, fontSize: 13,
                letterSpacing: 0.5,
              }}>× {rows.length}</Text>
              <Text style={{
                color: theme.text,
                fontFamily: theme.fontMono, fontSize: 13,
                marginLeft: 10,
              }}>{condition}</Text>
            </View>
            {rows.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => onTapInstance(r.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 14, paddingVertical: 8,
                }}>
                <Text style={{ color: theme.textDim, fontSize: 13 }}>
                  in {binderName.get(r.binder_id) ?? '—'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor:
                      r.status === 'have' ? theme.statusHave :
                      r.status === 'want' ? theme.statusWant : theme.statusReally,
                  }} />
                  <Feather name="chevron-right" size={14} color={theme.textMute} />
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function PriceRow({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      padding: 12,
      backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.border,
      borderRadius: theme.radius,
    }}>
      <Text style={{ color: theme.text, fontSize: 13 }}>{label}</Text>
      <Text style={{
        color: theme.text, fontSize: 13.5, fontWeight: '600',
        fontFamily: theme.fontMono,
      }}>{currency}{value.toFixed(2)}</Text>
    </View>
  );
}

// Pick the most representative TCGplayer variant. Prefers holofoil for
// likely-valuable cards, falls back to whatever variant has data.
function pickTcgplayerPrice(tp: TcgCard['tcgplayer']) {
  const p = tp?.prices;
  if (!p) return null;
  const preferred = ['holofoil', '1stEditionHolofoil', 'normal', 'reverseHolofoil', '1stEditionNormal'];
  for (const v of preferred) {
    const slot = p[v];
    if (slot?.market != null || slot?.mid != null) {
      return {
        variant: v,
        market: slot.market ?? null,
        low: slot.low ?? null,
        mid: slot.mid ?? null,
        high: slot.high ?? null,
      };
    }
  }
  for (const v of Object.keys(p)) {
    const slot = p[v];
    if (slot?.market != null || slot?.mid != null) {
      return {
        variant: v,
        market: slot.market ?? null,
        low: slot.low ?? null,
        mid: slot.mid ?? null,
        high: slot.high ?? null,
      };
    }
  }
  return null;
}
