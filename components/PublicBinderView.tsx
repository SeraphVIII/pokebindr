// Read-only binder view used by public routes (/u/[username]/binder/[id]
// and /share/[token]). Renders the page grid + simple paging arrows.
// Supports fling-left / fling-right to flip pages (no animation, just
// gesture-driven navigation).

import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, Directions } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { CardSlot, EmptySlot } from '@/components/CardSlot';
import { clampToContent } from '@/lib/layout';
import { Dimensions } from 'react-native';
import { useDidILikeBinder, useToggleLike, useBinders, useCopyPageToMyBinder } from '@/lib/queries';
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

  // Layout — same maths as the authed binder view.
  const winW = clampToContent(Dimensions.get('window').width);
  const railPad = 20;
  const gap = 8;
  const innerW = winW - railPad * 2 - 12 - 6;
  const cardW = (innerW - gap * (cols - 1)) / cols;
  const cardH = cardW * 1.4;

  // Build a position → card lookup for the current page.
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

  // Fling-left → next page, fling-right → previous page. Re-created per
  // render because the closure captures `current` and `pageCount`.
  const flipBy = (delta: number) => {
    setPageIdx((p) => Math.max(0, Math.min(pageCount - 1, p + delta)));
  };
  const flingGesture = Gesture.Race(
    Gesture.Fling().direction(Directions.LEFT).onEnd(() => {
      'worklet';
      runOnJS(flipBy)(1);
    }),
    Gesture.Fling().direction(Directions.RIGHT).onEnd(() => {
      'worklet';
      runOnJS(flipBy)(-1);
    }),
  );

  return (
    <Screen>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={theme.textDim} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          {ownerLabel && (
            <Text style={{ color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono }}>
              {ownerLabel}
            </Text>
          )}
          <Text
            numberOfLines={1}
            style={{ fontFamily: theme.fontDisplay, fontSize: 22, color: theme.text }}
          >
            {binder.name}
          </Text>
        </View>
        <Pressable
          onPress={onToggleLike}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Feather
            name="heart"
            size={18}
            color={liked ? theme.statusReally : theme.textDim}
          />
          <Text style={{
            color: liked ? theme.statusReally : theme.textDim,
            fontFamily: theme.fontMono, fontSize: 13,
            minWidth: 14, textAlign: 'right',
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
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: 8, paddingVertical: 4,
              borderRadius: 999,
              borderWidth: 1, borderColor: theme.borderStrong,
              opacity: copyPage.isPending ? 0.5 : 1,
            }}
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
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <GestureDetector gesture={flingGesture}>
        <View style={{
          flex: 1,
          paddingHorizontal: railPad,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <View style={{
            width: cols * cardW + (cols - 1) * gap,
            height: rowsN * cardH + (rowsN - 1) * gap,
          }}>
            {Array.from({ length: slotsPerPage }).map((_, i) => {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const r = cardByPos.get(start + i);
              return (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    left: col * (cardW + gap),
                    top: row * (cardH + gap),
                    width: cardW,
                    height: cardH,
                  }}
                >
                  {r ? (
                    <CardSlot
                      row={r}
                      width={cardW}
                      onPress={() => router.push(`/card/${r.card_id}`)}
                    />
                  ) : <EmptySlot width={cardW} />}
                </View>
              );
            })}
          </View>

          {pageCount > 1 && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 20,
              marginTop: 18,
            }}>
              <Pressable
                onPress={() => setPageIdx(Math.max(0, current - 1))}
                disabled={current === 0}
                hitSlop={10}
                style={{ opacity: current === 0 ? 0.3 : 1 }}
              >
                <Feather name="chevron-left" size={24} color={theme.textDim} />
              </Pressable>
              <Text style={{
                color: theme.text, fontFamily: theme.fontMono, fontSize: 14,
                letterSpacing: 1, minWidth: 60, textAlign: 'center',
              }}>
                {String(current + 1).padStart(2, '0')} / {String(pageCount).padStart(2, '0')}
              </Text>
              <Pressable
                onPress={() => setPageIdx(Math.min(pageCount - 1, current + 1))}
                disabled={current === pageCount - 1}
                hitSlop={10}
                style={{ opacity: current === pageCount - 1 ? 0.3 : 1 }}
              >
                <Feather name="chevron-right" size={24} color={theme.textDim} />
              </Pressable>
            </View>
          )}
        </View>
        </GestureDetector>
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
          style={{ flex: 1, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.6)' }}
        />
        <View style={{
          width: '100%', maxWidth: theme.maxContentW,
          maxHeight: '60%',
          backgroundColor: theme.surface,
          borderTopLeftRadius: theme.radius * 2,
          borderTopRightRadius: theme.radius * 2,
          borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
          borderColor: theme.borderStrong,
          paddingHorizontal: 20, paddingTop: 18,
          paddingBottom: 24 + insets.bottom,
        }}>
          <Eyebrow>Copy page to</Eyebrow>
          <Text style={{
            fontFamily: theme.fontDisplay,
            fontSize: 20, color: theme.text, marginTop: 4, marginBottom: 4,
          }}>Choose a binder</Text>
          <Text style={{
            color: theme.textDim, fontSize: 11, marginBottom: 12,
          }}>
            Cards land on a new page at the end, marked as &quot;want&quot;.
          </Text>
          <ScrollView>
            {binders.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => onPick(b.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 14, paddingHorizontal: 4,
                  borderBottomWidth: 1, borderBottomColor: theme.border,
                }}>
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
