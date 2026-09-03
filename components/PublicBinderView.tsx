// Read-only binder view for the public routes (/u/[username]/binder/[id]
// and /share/[token]). Page grid with arrows and fling-to-flip paging.

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, Directions } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useSharedValue, useAnimatedStyle, withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { IconDisc, Skeleton } from '@/components/ui';
import { CardSlot, EmptySlot } from '@/components/CardSlot';
import { clampToContent } from '@/lib/layout';
import { Dimensions } from 'react-native';
import { useDidILikeBinder, useToggleLike, useBinders, useCopyPageToMyBinder, usePrefetchCard } from '@/lib/queries';
import { useSession } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { theme } from '@/lib/theme';
import type { Binder, BinderPage, CollectionRow } from '@/lib/types';

interface Props {
  binder: Binder;
  pages: BinderPage[];
  cards: CollectionRow[];
  loading?: boolean;
  ownerLabel?: string;
}

export function PublicBinderView({ binder, pages, cards, loading, ownerLabel }: Props) {
  const router = useRouter();

  // Prefetch on tap so /card/[id] mounts cache-hit instead of blocking on a
  // cold TCGdex fetch during the navigation animation.
  const prefetchCard = usePrefetchCard();
  const openCard = (cardId: string) => {
    prefetchCard(cardId);
    router.push(`/card/${cardId}`);
  };
  const { session } = useSession();
  const toast = useToast();
  const { data: liked = false } = useDidILikeBinder(binder.id);
  const toggleLike = useToggleLike();
  const { data: myBinders = [] } = useBinders();
  const copyPage = useCopyPageToMyBinder();
  const [pageIdx, setPageIdx] = useState(0);
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);

  const onToggleLike = () => {
    if (!session) {
      toast.info('Sign in to like binders.');
      return;
    }
    toggleLike.mutate(
      { binderId: binder.id, like: !liked },
      { onError: (e: any) => toast.error(e?.message ?? 'Could not update like') },
    );
  };
  const cols = binder.grid_cols;
  const rowsN = binder.grid_rows;
  const slotsPerPage = cols * rowsN;
  const pageCount = Math.max(pages.length, 1);
  const current = Math.min(pageIdx, pageCount - 1);
  const currentPage = pages[current];

  // Same layout maths as the authed binder view.
  const winW = clampToContent(Dimensions.get('window').width);
  const railPad = 20;
  const gap = 8;
  const innerW = winW - railPad * 2 - 12 - 6;
  const cardW = (innerW - gap * (cols - 1)) / cols;
  const cardH = cardW * 1.4;

  const start = current * slotsPerPage;
  const cardByPos = new Map<number, CollectionRow>();
  for (const c of cards) cardByPos.set(c.position, c);

  const pageCards: CollectionRow[] = [];
  let pagePrice = 0;
  for (let i = 0; i < slotsPerPage; i++) {
    const r = cardByPos.get(start + i);
    if (r) pageCards.push(r);
    if (r?.last_price_eur != null) pagePrice += r.last_price_eur;
  }

  const onCopyToBinder = (targetBinderId: string) => {
    setCopyPickerOpen(false);
    if (pageCards.length === 0) {
      toast.info('Nothing to copy on this page.');
      return;
    }
    copyPage.mutate(
      { sourceCards: pageCards, targetBinderId },
      {
        onSuccess: ({ inserted }) => {
          toast.success(`Copied ${inserted} card${inserted === 1 ? '' : 's'} to your binder`);
        },
        onError: (e: any) => toast.error(e?.message ?? 'Could not copy page'),
      },
    );
  };

  const onTapCopy = () => {
    if (!session) {
      toast.info('Sign in to copy this page.');
      return;
    }
    if (myBinders.length === 0) {
      toast.info('Create a binder first.');
      return;
    }
    setCopyPickerOpen(true);
  };

  // Pager: all pages mounted in one horizontal track. Flipping translates the
  // track, so grids never remount.
  const gridW = cols * cardW + (cols - 1) * gap;
  const gridH = rowsN * cardH + (rowsN - 1) * gap;
  const trackOffset = useSharedValue(-current * gridW);
  const isFlippingRef = useRef(false);
  const clearFlipping = () => { isFlippingRef.current = false; };
  const flipBy = (delta: number) => {
    const next = Math.max(0, Math.min(pageCount - 1, current + delta));
    if (next === current) return;
    isFlippingRef.current = true;
    trackOffset.value = withTiming(-next * gridW, { duration: 260 }, (done) => {
      if (done) runOnJS(clearFlipping)();
    });
    setPageIdx(next);
  };

  // Re-snap on dimension changes (rotation) unless mid-animation.
  useEffect(() => {
    if (!isFlippingRef.current) {
      trackOffset.value = -current * gridW;
    }
    // `current` intentionally excluded; flipBy handles page-change snapping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridW]);

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: trackOffset.value }],
  }));

  const flingGesture = useMemo(() => Gesture.Race(
    Gesture.Fling().direction(Directions.LEFT).onEnd(() => {
      'worklet';
      runOnJS(flipBy)(1);
    }),
    Gesture.Fling().direction(Directions.RIGHT).onEnd(() => {
      'worklet';
      runOnJS(flipBy)(-1);
    }),
    // flipBy captures `current` and `pageCount`; re-create on change so the
    // gesture does not clamp against stale bounds.
  ), [current, pageCount, gridW]);

  return (
    <Screen>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2,
      }}>
        <IconDisc name="chevron-left" onPress={() => router.back()} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {ownerLabel && (
            <Text style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono }}>
              {ownerLabel}
            </Text>
          )}
          <Text
            numberOfLines={1}
            style={{ fontFamily: theme.fontDisplaySemi, fontSize: 22, color: theme.text }}
          >
            {binder.name}
          </Text>
        </View>
        <Pressable
          onPress={onToggleLike}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 11, paddingVertical: 7,
            borderRadius: theme.pill,
            backgroundColor: liked ? theme.statusReallySoft : theme.glass,
            borderWidth: 1,
            borderColor: liked ? 'rgba(205,99,99,0.4)' : theme.hairline,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}
        >
          <Feather
            name="heart"
            size={15}
            color={liked ? theme.statusReally : theme.textDim}
          />
          <Text style={{
            color: liked ? theme.statusReally : theme.textDim,
            fontFamily: theme.fontMono, fontSize: 12,
            minWidth: 12, textAlign: 'right',
          }}>
            {binder.likes_count}
          </Text>
        </Pressable>
        <Feather
          name={binder.visibility === 'public' ? 'globe' : 'link'}
          size={16}
          color={theme.textDim}
          style={{ marginLeft: 8 }}
        />
      </View>

      <View style={{ paddingHorizontal: 24, paddingTop: 4 }}>
        <Eyebrow>{cols}×{rowsN} · {cards.length} {cards.length === 1 ? 'card' : 'cards'} · read-only</Eyebrow>
      </View>

      <View style={{
        paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <Text numberOfLines={1} style={{
          fontFamily: theme.fontDisplay, fontSize: 22,
          color: currentPage?.title ? theme.accent : theme.textDim,
          flexShrink: 1,
        }}>
          {currentPage?.title ?? `Page ${String(current + 1).padStart(2, '0')}`}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {pagePrice > 0 && (
            <Text style={{ color: theme.textDim, fontFamily: theme.fontMono, fontSize: 13 }}>
              €{pagePrice.toFixed(2)}
            </Text>
          )}
          <Pressable
            onPress={onTapCopy}
            disabled={copyPage.isPending}
            hitSlop={6}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 5,
              paddingHorizontal: 11, paddingVertical: 7,
              borderRadius: theme.pill,
              borderWidth: 1, borderColor: theme.borderStrong,
              backgroundColor: pressed ? theme.accentSoft : theme.glass,
              opacity: copyPage.isPending ? 0.5 : 1,
              transform: [{ scale: pressed ? 0.92 : 1 }],
            })}
          >
            <Feather name="copy" size={12} color={theme.accent} />
            <Text style={{
              color: theme.accent, fontSize: 10,
              fontFamily: theme.fontUIBold, letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}>Copy</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{
            width: gridW, height: gridH,
            flexDirection: 'row', flexWrap: 'wrap', gap,
            alignContent: 'flex-start',
          }}>
            {Array.from({ length: slotsPerPage }).map((_, i) => (
              <Skeleton key={i} width={cardW} height={cardH} radius={Math.max(6, cardW * 0.08)} />
            ))}
          </View>
        </View>
      ) : (
        <View style={{
          flex: 1,
          paddingHorizontal: railPad,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <GestureDetector gesture={flingGesture}>
            <View style={{ width: gridW, height: gridH, overflow: 'hidden' }}>
              <Animated.View style={[
                { flexDirection: 'row', width: gridW * pageCount, height: gridH },
                trackStyle,
              ]}>
                {Array.from({ length: pageCount }).map((_, pageI) => {
                  const pStart = pageI * slotsPerPage;
                  return (
                    <View key={pageI} style={{ width: gridW, height: gridH }}>
                      {Array.from({ length: slotsPerPage }).map((_, i) => {
                        const col = i % cols;
                        const rowI = Math.floor(i / cols);
                        const r = cardByPos.get(pStart + i);
                        return (
                          <View
                            key={i}
                            style={{
                              position: 'absolute',
                              left: col * (cardW + gap),
                              top: rowI * (cardH + gap),
                              width: cardW,
                              height: cardH,
                            }}
                          >
                            {r ? (
                              <CardSlot
                                row={r}
                                width={cardW}
                                onPress={() => openCard(r.card_id)}
                              />
                            ) : <EmptySlot width={cardW} />}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </Animated.View>
            </View>
          </GestureDetector>

          {pageCount > 1 && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 20,
              marginTop: 18,
            }}>
              <IconDisc
                name="chevron-left"
                size={34}
                onPress={current === 0 ? undefined : () => flipBy(-1)}
                style={{ opacity: current === 0 ? 0.35 : 1 }}
              />
              <Text style={{
                color: theme.text, fontFamily: theme.fontMono, fontSize: 14,
                letterSpacing: 1, minWidth: 60, textAlign: 'center',
              }}>
                {String(current + 1).padStart(2, '0')} / {String(pageCount).padStart(2, '0')}
              </Text>
              <IconDisc
                name="chevron-right"
                size={34}
                onPress={current === pageCount - 1 ? undefined : () => flipBy(1)}
                style={{ opacity: current === pageCount - 1 ? 0.35 : 1 }}
              />
            </View>
          )}
        </View>
      )}

      <CopyTargetSheet
        open={copyPickerOpen}
        binders={myBinders}
        onClose={() => setCopyPickerOpen(false)}
        onPick={onCopyToBinder}
      />
    </Screen>
  );
}

function CopyTargetSheet({
  open, binders, onClose, onPick,
}: {
  open: boolean;
  binders: Binder[];
  onClose: () => void;
  onPick: (binderId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, alignSelf: 'stretch', backgroundColor: theme.scrim }}
        />
        <View style={{
          width: '100%', maxWidth: theme.maxContentW,
          maxHeight: '60%',
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
          <Eyebrow>Copy page to</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplaySemi,
            fontSize: 21, color: theme.text, marginTop: 4, marginBottom: 4,
          }}>Choose a binder</Text>
          <Text style={{
            color: theme.textDim, fontSize: 11, fontFamily: theme.fontUI, marginBottom: 12,
          }}>
            Cards land on a new page at the end, marked as &quot;want&quot;.
          </Text>
          <ScrollView>
            {binders.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => onPick(b.id)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 14, paddingHorizontal: 8,
                  borderRadius: theme.radiusSm,
                  backgroundColor: pressed ? theme.accentFaint : 'transparent',
                  borderBottomWidth: 1, borderBottomColor: theme.hairline,
                })}>
                <View style={{ flex: 1 }}>
                  <Text style={{
                    color: theme.text, fontSize: 15,
                    fontFamily: theme.fontUI,
                  }}>{b.name}</Text>
                  <Text style={{
                    fontFamily: theme.fontMono, fontSize: 11,
                    color: theme.textDim, marginTop: 2,
                  }}>{b.grid_cols}×{b.grid_rows}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={theme.textMute} />
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
  );
}
