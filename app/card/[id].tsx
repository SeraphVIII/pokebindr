// Card detail — status, pricing, and add-to-binder for a single card.

import { useState, useMemo, useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  View, Text, ScrollView, Image, Pressable, ActivityIndicator,
  useWindowDimensions, Modal,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { Chip } from '@/components/Chip';
import { AmbientGlow, IconDisc, Skeleton } from '@/components/ui';
import { Sparkline } from '@/components/Sparkline';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useContentWidth } from '@/lib/layout';
import { fallbackImageUrls, type Locale } from '@/lib/tcgdex';
import {
  useEbaySolds, filterByGrade, averageSoldPrice,
  type GradeFilter, type EbaySold,
} from '@/lib/ebay';
import {
  useCollectionItem, useCollectionRowById, useCollectionItemsByCardId,
  useTcgCard, useSetStatus, useRemoveCard, useBinders, useUpsertCard,
  useUpdateCardRow, useCardmarketUrl,
} from '@/lib/queries';
import { theme } from '@/lib/theme';
import type { Status, Binder, TcgCard, CollectionRow } from '@/lib/types';

const CONDITIONS = ['NM', 'EX', 'GD', 'LP', 'MP', 'HP'] as const;

// The URL is resolved server-side and held in React Query; the button opens
// whatever the cache holds. WebBrowser sidesteps Android intent-dispatch quirks.
async function openCardmarket(url: string | undefined, onError: (msg: string) => void) {
  try {
    if (!url) throw new Error('Still resolving Cardmarket link…');
    await WebBrowser.openBrowserAsync(url);
  } catch (e: any) {
    onError(e?.message ?? 'Could not open Cardmarket');
  }
}

export default function CardDetail() {
  // Optional `row` query param identifies a specific instance; the same
  // card_id can appear multiple times in a binder.
  const { id, row: rowParam, lang } = useLocalSearchParams<{ id: string; row?: string; lang?: string }>();
  const locale: Locale = lang === 'ja' ? 'ja' : 'en';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: card, isLoading: loadingCard, error: cardError } = useTcgCard(id, locale);
  const { data: rowById } = useCollectionRowById(rowParam);
  const { data: allInstances = [] } = useCollectionItemsByCardId(rowParam ? undefined : id);
  const { data: fallbackRow } = useCollectionItem(rowParam ? undefined : id);
  // Instance mode (row param set) shows the instance controls; aggregate
  // mode leaves row null and shows the copies breakdown instead.
  const row = rowParam ? rowById : null;
  void fallbackRow;
  const { data: binders = [] } = useBinders();
  const setStatus = useSetStatus();
  const remove = useRemoveCard();
  const upsert = useUpsertCard();
  const updateRow = useUpdateCardRow();
  const { height: winH } = useWindowDimensions();
  const winW = useContentWidth();
  const sparkW = Math.max(160, winW - (24 + 16) * 2);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenBinderId, setChosenBinderId] = useState<string | null>(null);

  const targetBinderId = useMemo(() => {
    if (chosenBinderId && binders.some((b) => b.id === chosenBinderId)) return chosenBinderId;
    return binders[0]?.id ?? null;
  }, [chosenBinderId, binders]);
  const targetBinder = binders.find((b) => b.id === targetBinderId) ?? null;

  // Hooks must run on every render, so these compute off card?. rather than
  // sitting below the early returns.
  const tcgFallback = useMemo(() => pickTcgplayerPrice(card?.tcgplayer), [card?.tcgplayer]);
  // Pre-resolve the Cardmarket URL so tapping the button is instant; the
  // hook no-ops while `card` is null.
  const { data: cmUrl, isLoading: cmLoading } = useCardmarketUrl(card);

  if (loadingCard) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <View style={{ paddingHorizontal: 14, paddingTop: 6 }}>
          <IconDisc name="chevron-left" onPress={() => router.back()} />
        </View>
        <View style={{ alignItems: 'center', paddingTop: 16 }}>
          <Skeleton width={220} height={308} radius={14} />
        </View>
        <View style={{ paddingHorizontal: 24, marginTop: 24, gap: 10 }}>
          <Skeleton width={140} height={10} radius={5} />
          <Skeleton width={230} height={28} radius={10} />
          <Skeleton height={110} radius={theme.radiusLg} style={{ marginTop: 14 }} />
        </View>
      </Screen>
    );
  }
  if (!card) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <View style={{ paddingHorizontal: 14, paddingTop: 6 }}>
          <IconDisc name="chevron-left" onPress={() => router.back()} />
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

  // Not a real time series: each value is an overlapping rolling-window
  // average, so the sparkline only suggests direction.
  const series = (usingCM
    ? [prices?.avg30, prices?.avg7, prices?.avg1, prices?.trendPrice]
    : [tcgFallback?.low, tcgFallback?.mid, tcgFallback?.market, tcgFallback?.high]
  ).filter((n): n is number => typeof n === 'number');

  const pickStatus = async (s: Status) => {
    if (!row) return;
    try {
      await setStatus.mutateAsync({ rowId: row.id, status: s });
    } catch (e: any) {
      toast.error(e.message ?? 'Could not update status');
    }
  };

  const removeFromBinder = async () => {
    if (!row) return;
    const ok = await confirm({
      title: 'Remove from binder?',
      message: card.name,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await remove.mutateAsync(row.id);
    router.back();
  };

  const handleAdd = async () => {
    if (!targetBinder) {
      const ok = await confirm({
        title: 'No binders yet',
        message: 'Create a binder first.',
        confirmText: 'Create binder',
      });
      if (ok) router.navigate('/binder/new');
      return;
    }
    try {
      await upsert.mutateAsync({ card, status: 'have', binderId: targetBinder.id });
      // Stay in aggregate mode so the stepper can keep accumulating copies.
    } catch (e: any) {
      toast.error(e.message ?? 'Could not add card');
    }
  };

  // Removes the most recently added copy in the selected binder
  // (last in, first out).
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
      toast.error(e.message ?? 'Could not remove card');
    }
  };

  const choose = (b: Binder) => {
    setChosenBinderId(b.id);
    setPickerOpen(false);
  };

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        padding: 14,
      }}>
        <IconDisc name="chevron-left" onPress={() => router.back()} />
        {row && (
          <IconDisc name="trash-2" iconSize={15} onPress={removeFromBinder} />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <AmbientGlow size={340} style={{ top: -40, alignSelf: 'center' }} opacity={0.14} />
          <View style={{ borderRadius: 14, boxShadow: theme.shadowAmbient }}>
            <HeroArt
              card={card}
              instanceArt={
                row?.image_large ?? row?.image_small
                ?? allInstances[0]?.image_large ?? allInstances[0]?.image_small
                ?? null
              }
            />
          </View>
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: 14 }}>
          <Eyebrow>
            {card.set.name} · {card.number}{card.rarity ? ` · ${card.rarity}` : ''}
          </Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplaySemi,
            fontSize: 32, color: theme.text, marginTop: 4, lineHeight: 40,
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
                        style={({ pressed }) => ({
                          paddingHorizontal: 13, paddingVertical: 8,
                          borderRadius: theme.pill,
                          borderWidth: 1,
                          borderColor: active ? theme.accent : theme.hairline,
                          backgroundColor: active ? theme.accentSoft : theme.glass,
                          transform: [{ scale: pressed ? 0.94 : 1 }],
                        })}>
                        <Text style={{
                          fontFamily: theme.fontMono, fontSize: 11,
                          color: active ? theme.accent : theme.textDim,
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

        <EbaySoldsSection card={card} />

        <View style={{ paddingHorizontal: 24, marginTop: 24 }}>
          <View style={{
            backgroundColor: theme.surface,
            borderWidth: 1, borderColor: theme.hairline,
            borderRadius: theme.radiusLg,
            padding: 18,
            overflow: 'hidden',
            boxShadow: `${theme.shadowSoft}, ${theme.shadowInner}`,
          }}>
            <AmbientGlow size={220} style={{ top: -110, right: -80 }} opacity={0.12} />
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
                  {avg != null ? `${currency}${avg.toFixed(2)}` : '·'}
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
              onPress={() => openCardmarket(cmUrl, toast.error)}
              disabled={cmLoading}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 10,
                paddingVertical: 14,
                borderWidth: 1, borderColor: theme.borderStrong,
                borderRadius: theme.pill,
                backgroundColor: pressed ? theme.accentSoft : theme.glass,
                opacity: cmLoading ? 0.6 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}>
              <Text style={{
                color: theme.accent, fontSize: 13,
                fontFamily: theme.fontUIBold, letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}>Buy on Cardmarket · EN</Text>
              <View style={{
                width: 24, height: 24, borderRadius: theme.pill,
                backgroundColor: theme.accentSoft,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {cmLoading ? (
                  <ActivityIndicator color={theme.accent} size="small" />
                ) : (
                  <Feather name="external-link" size={12} color={theme.accent} />
                )}
              </View>
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
        <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
          <Pressable
            onPress={() => setPickerOpen(false)}
            style={{ flex: 1, alignSelf: 'stretch', backgroundColor: theme.scrim }}
          />
          <View style={{
            width: '100%', maxWidth: theme.maxContentW,
            height: winH * 0.4 + insets.bottom,
            backgroundColor: theme.surface,
            borderTopLeftRadius: theme.radiusXl,
            borderTopRightRadius: theme.radiusXl,
            borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
            borderColor: theme.hairline,
            paddingHorizontal: 20, paddingTop: 12,
            paddingBottom: 24 + insets.bottom,
            boxShadow: theme.shadowInner,
          }}>
            <View style={{
              alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
              backgroundColor: theme.glassStrong, marginBottom: 12,
            }} />
            <Eyebrow>Add to</Eyebrow>
            <Text style={{
              fontFamily: theme.fontDisplaySemi,
              fontSize: 21, color: theme.text, marginTop: 4, marginBottom: 12,
            }}>Choose a binder</Text>
            <ScrollView>
              {binders.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => choose(b)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center',
                    paddingVertical: 14, paddingHorizontal: 8,
                    borderRadius: theme.radiusSm,
                    backgroundColor: pressed ? theme.accentFaint : 'transparent',
                    borderBottomWidth: 1, borderBottomColor: theme.hairline,
                  })}>
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

// Hero artwork fallback chain: hires render, low-res render, stored instance
// art, then the CDN guess. Advances on load error; a named placeholder
// renders if every candidate fails.
function HeroArt({ card, instanceArt }: { card: TcgCard; instanceArt: string | null }) {
  const candidates = useMemo(() => {
    const fb = fallbackImageUrls(card.set.id, card.number);
    const list = [card.images.large, card.images.small, instanceArt, fb.large, fb.small]
      .filter((u): u is string => !!u);
    return [...new Set(list)];
  }, [card, instanceArt]);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [candidates]);
  const uri = candidates[idx];

  if (!uri) {
    return (
      <View style={{
        width: 220, height: 308, borderRadius: 14,
        backgroundColor: theme.cardBg,
        borderWidth: 1, borderColor: theme.hairline,
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
        <Text style={{
          fontFamily: theme.fontDisplaySemi, fontSize: 22,
          color: theme.text, textAlign: 'center',
        }}>{card.name}</Text>
        <Text style={{
          fontFamily: theme.fontMono, fontSize: 11,
          color: theme.textDim, marginTop: 8,
        }}>{card.set.name} · {card.number}</Text>
      </View>
    );
  }
  return (
    <Image
      key={uri}
      source={{ uri }}
      onError={() => setIdx((i) => i + 1)}
      style={{ width: 220, height: 308, borderRadius: 14 }}
      resizeMode="contain"
    />
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
      borderRadius: theme.radiusLg,
      padding: 16,
      boxShadow: theme.shadowInner,
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
      style={({ pressed }) => ({
        width: 36, height: 36, borderRadius: 18,
        borderWidth: 1,
        borderColor: disabled ? theme.hairline : theme.accent,
        backgroundColor: disabled ? theme.glass : theme.accent,
        alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
        boxShadow: disabled ? undefined : theme.shadowGold,
        transform: [{ scale: pressed && !disabled ? 0.9 : 1 }],
      })}>
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
        borderWidth: 1, borderColor: theme.hairline,
        borderRadius: theme.radiusLg,
        backgroundColor: theme.surface,
        overflow: 'hidden',
        boxShadow: theme.shadowInner,
      }}>
        {ordered.map(([condition, rows], gi) => (
          <View
            key={condition}
            style={{
              borderTopWidth: gi === 0 ? 0 : 1,
              borderTopColor: theme.hairline,
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
                <Text style={{ color: theme.textDim, fontSize: 13, fontFamily: theme.fontUI }}>
                  in {binderName.get(r.binder_id) ?? 'unknown binder'}
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

// ─────────────────────────────────────────────────────────────
// eBay UK last solds
// ─────────────────────────────────────────────────────────────

const GRADE_TABS: Array<{ key: GradeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'raw', label: 'Raw' },
  { key: 'psa9', label: 'PSA 9' },
  { key: 'psa10', label: 'PSA 10' },
];

function EbaySoldsSection({ card }: { card: TcgCard }) {
  const { data, isLoading } = useEbaySolds(card);
  const [grade, setGrade] = useState<GradeFilter>('all');
  const toast = useToast();

  const openUrl = async (url: string | null) => {
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not open eBay');
    }
  };

  if (isLoading) {
    return (
      <View style={{ paddingHorizontal: 24, marginTop: 24, gap: 10 }}>
        <Skeleton width={150} height={10} radius={5} />
        <Skeleton height={120} radius={theme.radiusLg} />
      </View>
    );
  }
  if (!data) return null;

  if (data.items.length === 0) {
    return (
      <View style={{ paddingHorizontal: 24, marginTop: 24 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: theme.glass,
          borderWidth: 1, borderColor: theme.hairline,
          borderRadius: theme.radius,
          paddingHorizontal: 14, paddingVertical: 12,
          boxShadow: theme.shadowInner,
        }}>
          <Feather name="tag" size={13} color={theme.textDim} />
          <Text style={{ flex: 1, color: theme.textDim, fontSize: 12, fontFamily: theme.fontUI }}>
            {data.failed
              ? 'eBay UK solds unavailable right now — showing Cardmarket pricing below.'
              : 'No recent UK solds found — showing Cardmarket pricing below.'}
          </Text>
          <Pressable onPress={() => openUrl(data.searchUrl)} hitSlop={8}>
            <Text style={{
              color: theme.accent, fontSize: 11, fontFamily: theme.fontUIBold,
              letterSpacing: 0.4, textTransform: 'uppercase',
            }}>eBay</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const filtered = filterByGrade(data.items, grade);
  const avg = averageSoldPrice(filtered, 5);
  const avgCount = Math.min(5, filtered.length);
  const counts: Record<GradeFilter, number> = {
    all: data.items.length,
    raw: filterByGrade(data.items, 'raw').length,
    psa9: filterByGrade(data.items, 'psa9').length,
    psa10: filterByGrade(data.items, 'psa10').length,
  };
  const shown = filtered.slice(0, 8);

  return (
    <View style={{ paddingHorizontal: 24, marginTop: 24 }}>
      <View style={{
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.hairline,
        borderRadius: theme.radiusLg,
        padding: 18,
        overflow: 'hidden',
        boxShadow: `${theme.shadowSoft}, ${theme.shadowInner}`,
      }}>
        <AmbientGlow size={220} style={{ top: -110, left: -80 }} opacity={0.12} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <Eyebrow>
              Last solds · eBay UK{data.stale ? ' · cached' : ''}
            </Eyebrow>
            <Text style={{
              fontFamily: theme.fontMono,
              fontSize: 32, color: theme.text, marginTop: 4, lineHeight: 38,
              letterSpacing: -0.3,
            }}>
              {avg != null ? `£${avg.toFixed(2)}` : '·'}
            </Text>
            <Text style={{
              color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
              marginTop: 2, letterSpacing: 0.5,
            }}>
              {avg != null
                ? `avg of last ${avgCount} ${avgCount === 1 ? 'sale' : 'sales'}`
                : 'no sales match this filter'}
            </Text>
          </View>
          {data.fetchedAt && (
            <Text style={{
              color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
              letterSpacing: 0.5,
            }}>
              as of {data.fetchedAt.slice(0, 10)}
            </Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
          {GRADE_TABS.map((t) => (
            (t.key === 'all' || counts[t.key] > 0) && (
              <Chip
                key={t.key}
                label={`${t.label} · ${counts[t.key]}`}
                active={grade === t.key}
                onPress={() => setGrade(t.key)}
              />
            )
          ))}
        </View>

        <View style={{ marginTop: 12 }}>
          {shown.map((item, i) => (
            <SoldRow key={item.url ?? `${i}`} item={item} first={i === 0} onPress={() => openUrl(item.url ?? data.searchUrl)} />
          ))}
        </View>

        <Pressable
          onPress={() => openUrl(data.searchUrl)}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginTop: 14, paddingVertical: 10,
            borderWidth: 1, borderColor: theme.hairline,
            borderRadius: theme.pill,
            backgroundColor: pressed ? theme.accentSoft : theme.glass,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}>
          <Text style={{
            color: theme.accent, fontSize: 11, fontFamily: theme.fontUIBold,
            letterSpacing: 0.5, textTransform: 'uppercase',
          }}>See all solds on eBay UK</Text>
          <Feather name="external-link" size={11} color={theme.accent} />
        </Pressable>
      </View>
    </View>
  );
}

function SoldRow({ item, first, onPress }: { item: EbaySold; first: boolean; onPress: () => void }) {
  const meta = [
    item.soldAt ? `Sold ${item.soldAt.slice(0, 10)}` : null,
    item.grade ? `${item.grade.grader} ${item.grade.grade}` : item.condition,
  ].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1, borderTopColor: theme.hairline,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={2}
          style={{ color: theme.text, fontSize: 12, fontFamily: theme.fontUI, lineHeight: 16 }}
        >
          {item.title}
        </Text>
        {!!meta && (
          <Text style={{
            color: theme.textDim, fontSize: 10, fontFamily: theme.fontMono,
            marginTop: 3, letterSpacing: 0.3,
          }}>
            {meta}
          </Text>
        )}
      </View>
      <Text style={{
        color: theme.accent, fontSize: 14, fontFamily: theme.fontMono, fontWeight: '600',
      }}>
        £{item.price.toFixed(2)}
      </Text>
    </Pressable>
  );
}

function PriceRow({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 12, paddingRight: 14, paddingLeft: 14,
      backgroundColor: theme.glass,
      borderWidth: 1, borderColor: theme.hairline,
      borderRadius: theme.radius,
      boxShadow: theme.shadowInner,
    }}>
      <Text style={{
        color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono,
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>{label}</Text>
      <Text style={{
        color: theme.text, fontSize: 14, fontWeight: '600',
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
