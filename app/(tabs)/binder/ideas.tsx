// The Curator — a ranked, swipeable feed of page ideas for one binder.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Pressable, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen } from '@/components/Screen';
import { Eyebrow } from '@/components/Eyebrow';
import { IconDisc } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useContentWidth } from '@/lib/layout';
import { theme } from '@/lib/theme';
import { getSet } from '@/lib/tcgdex';
import {
  generateIdeas,
  type GhostCard,
  type IdeaSlot,
  type PageIdea,
  type SetCardBrief,
} from '@/lib/curator';
import {
  useApplyIdea,
  useBinder,
  useBinderPages,
  useCardFacts,
  useCardPairScores,
  useCardPalettes,
  useCollectionByBinder,
  useSets,
  useUndoApplyIdea,
  useUpsertCard,
  type AppliedIdea,
} from '@/lib/queries';
import type { TcgCard } from '@/lib/types';

const ARCHETYPE_LABEL: Record<PageIdea['archetype'], string> = {
  ladder: 'evolution lines',
  centerpiece: 'centerpiece',
  artist: 'artist gallery',
  timeline: 'through the years',
  monotype: 'monotype',
  showcase: 'showcase',
  hueflow: 'hue flow',
  monochrome: 'monochrome',
  panorama: 'connecting art',
};

const dismissedKey = (binderId: string) => `curator:dismissed:${binderId}`;
const appliedKey = (binderId: string) => `curator:applied:${binderId}`;

async function loadIdSet(key: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistIdSet(key: string, ids: Set<string>) {
  // Cap so years of dismissals don't grow unbounded.
  AsyncStorage.setItem(key, JSON.stringify([...ids].slice(-200))).catch(() => {});
}

export default function CuratorIdeas() {
  const { binder: binderId } = useLocalSearchParams<{ binder: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const contentW = useContentWidth();

  const { data: binder } = useBinder(binderId);
  const { data: rows = [] } = useCollectionByBinder(binderId);
  const { data: pages = [] } = useBinderPages(binderId);
  const { data: sets = [] } = useSets();
  const applyIdea = useApplyIdea();
  const undoApply = useUndoApplyIdea();
  const upsertCard = useUpsertCard();

  const cardIds = useMemo(() => rows.map((r) => r.card_id), [rows]);
  const { facts, progress, error } = useCardFacts(cardIds);

  // Palette extraction runs in the background; colour ideas join the deck
  // as palettes arrive.
  const paletteItems = useMemo(() => {
    if (!facts) return null;
    const seen = new Set<string>();
    const out: { card_id: string; image: string }[] = [];
    for (const r of rows) {
      if (seen.has(r.card_id) || !r.image_small) continue;
      const f = facts.get(r.card_id);
      if (f && !f.palette) {
        seen.add(r.card_id);
        out.push({ card_id: r.card_id, image: r.image_small });
      }
    }
    return out;
  }, [facts, rows]);
  const { palettes, pending: palettesPending } = useCardPalettes(paletteItems);

  const mergedFacts = useMemo(() => {
    if (!facts) return null;
    if (!palettes.size) return facts;
    const m = new Map(facts);
    for (const [id, pal] of palettes) {
      const f = m.get(id);
      if (f && !f.palette) m.set(id, { ...f, palette: pal });
    }
    return m;
  }, [facts, palettes]);

  const [setLists, setSetLists] = useState<Map<string, SetCardBrief[]>>(new Map());
  // null = still loading from AsyncStorage; don't generate until both arrive.
  const [dismissed, setDismissed] = useState<Set<string> | null>(null);
  const [appliedStored, setAppliedStored] = useState<Set<string> | null>(null);
  const [applied, setApplied] = useState<Map<string, AppliedIdea>>(new Map());
  const [deck, setDeck] = useState<PageIdea[] | null>(null);
  const [feedIdx, setFeedIdx] = useState(0);
  const [feedH, setFeedH] = useState(0);

  useEffect(() => {
    if (!binderId) return;
    let cancelled = false;
    (async () => {
      const [d, a] = await Promise.all([
        loadIdSet(dismissedKey(binderId)),
        loadIdSet(appliedKey(binderId)),
      ]);
      if (!cancelled) {
        setDismissed(d);
        setAppliedStored(a);
      }
    })();
    return () => { cancelled = true; };
  }, [binderId]);

  const setDates = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sets) if (s.releaseDate) m.set(s.id, s.releaseDate);
    return m;
  }, [sets]);

  // Panorama pairs resolve in two passes: the first generate emits candidate
  // pairs, the regenerate turns verified runs into "connecting art" ideas.
  const [neededPairs, setNeededPairs] = useState<import('@/lib/curator').PanoramaPairReq[] | null>(null);
  const { pairScores, pending: pairsPending } = useCardPairScores(neededPairs);

  const gen = useMemo(() => {
    if (!binder || !mergedFacts || !dismissed || !appliedStored) return null;
    const suppressed = new Set([...dismissed, ...appliedStored]);
    return generateIdeas({
      rows,
      facts: mergedFacts,
      cols: binder.grid_cols,
      gridRows: binder.grid_rows,
      pages,
      setDates,
      setLists,
      pairScores,
      suppressed,
    });
  }, [binder, mergedFacts, rows, pages, setDates, setLists, pairScores, dismissed, appliedStored]);

  useEffect(() => {
    if (gen?.neededPairs.length) setNeededPairs(gen.neededPairs);
  }, [gen?.neededPairs]);

  // Ghost resolution: fetch the card lists the engine asked for, once each.
  const fetchedSetsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const needed = gen?.neededSets.filter((s) => !fetchedSetsRef.current.has(s)) ?? [];
    if (!needed.length) return;
    needed.forEach((s) => fetchedSetsRef.current.add(s));
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        needed.map(async (sid): Promise<[string, SetCardBrief[]]> => {
          try {
            const d = await getSet(sid);
            return [sid, d.cards];
          } catch {
            return [sid, []];
          }
        }),
      );
      if (!cancelled) {
        setSetLists((prev) => {
          const next = new Map(prev);
          for (const [sid, cards] of results) next.set(sid, cards);
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [gen?.neededSets]);

  // Deck: keep card order stable across regenerations, freeze applied ideas
  // (their cards moved, so the generator no longer emits them), append new.
  useEffect(() => {
    if (!gen) return;
    setDeck((prev) => {
      const byId = new Map(gen.ideas.map((i) => [i.id, i]));
      if (!prev) return gen.ideas;
      const kept: PageIdea[] = [];
      const seen = new Set<string>();
      for (const i of prev) {
        if (applied.has(i.id)) {
          kept.push(i);
          seen.add(i.id);
          continue;
        }
        const fresh = byId.get(i.id);
        if (fresh) {
          kept.push(fresh);
          seen.add(i.id);
        }
      }
      for (const i of gen.ideas) if (!seen.has(i.id)) kept.push(i);
      return kept;
    });
  }, [gen, applied]);

  const slotsPerPage = (binder?.grid_cols ?? 3) * (binder?.grid_rows ?? 3);

  const onDismiss = useCallback((idea: PageIdea) => {
    setDeck((d) => d?.filter((i) => i.id !== idea.id) ?? null);
    setDismissed((prev) => {
      const next = new Set(prev ?? []);
      next.add(idea.id);
      if (binderId) persistIdSet(dismissedKey(binderId), next);
      return next;
    });
  }, [binderId]);

  const onApply = useCallback(async (idea: PageIdea) => {
    if (!binderId) return;
    if (idea.disruption.count > 0) {
      const names = idea.disruption.pageTitles.map((t) => `“${t}”`).join(' and ');
      const ok = await confirm({
        title: 'Cards will move',
        message: `${idea.disruption.count} card${idea.disruption.count === 1 ? '' : 's'} will leave ${names}.`,
        confirmText: 'Apply',
      });
      if (!ok) return;
    }
    try {
      const res = await applyIdea.mutateAsync({
        binderId,
        title: idea.title,
        moveRowIds: idea.moveRowIds,
        slotOffsets: idea.slotOffsets,
        slotsPerPage,
      });
      setApplied((m) => new Map(m).set(idea.id, res));
      setAppliedStored((prev) => {
        const next = new Set(prev ?? []);
        next.add(idea.id);
        persistIdSet(appliedKey(binderId), next);
        return next;
      });
      toast.success(`“${idea.title}” added as page ${res.pageIndex + 1}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply this page');
    }
  }, [binderId, slotsPerPage, applyIdea, confirm, toast]);

  const onUndo = useCallback(async (idea: PageIdea) => {
    if (!binderId) return;
    const res = applied.get(idea.id);
    if (!res) return;
    try {
      await undoApply.mutateAsync({ binderId, applied: res });
      setApplied((m) => {
        const next = new Map(m);
        next.delete(idea.id);
        return next;
      });
      setAppliedStored((prev) => {
        const next = new Set(prev ?? []);
        next.delete(idea.id);
        persistIdSet(appliedKey(binderId), next);
        return next;
      });
      toast.info('Page removed — cards are back where they were');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Undo failed');
    }
  }, [binderId, applied, undoApply, toast]);

  const onGhost = useCallback(async (ghost: GhostCard, idea: PageIdea) => {
    if (!binderId) return;
    const ok = await confirm({
      title: 'Add to wantlist?',
      message: `${ghost.name} (${ghost.set_name} ${ghost.card_number}) completes “${idea.title}”.`,
      confirmText: 'Want it',
    });
    if (!ok) return;
    const card: TcgCard = {
      id: ghost.card_id,
      name: ghost.name,
      number: ghost.card_number,
      rarity: ghost.rarity ?? undefined,
      images: { small: ghost.image_small ?? '', large: ghost.image_large ?? '' },
      set: { id: ghost.set_id, name: ghost.set_name },
    };
    try {
      await upsertCard.mutateAsync({ card, status: 'want', binderId });
      toast.success(`${ghost.name} added to your wantlist`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add card');
    }
  }, [binderId, confirm, upsertCard, toast]);

  // ── render ────────────────────────────────────────────────

  const body = () => {
    if (!binder) {
      return <Centered><ActivityIndicator color={theme.accent} /></Centered>;
    }
    if (rows.length < 4) {
      return (
        <Centered>
          <Feather name="layers" size={28} color={theme.textMute} />
          <Text style={msgStyle}>Add a few more cards to this binder and the Curator will start proposing pages.</Text>
        </Centered>
      );
    }
    if (error) {
      return (
        <Centered>
          <Feather name="alert-triangle" size={28} color={theme.statusReally} />
          <Text style={msgStyle}>{error}</Text>
        </Centered>
      );
    }
    if (!facts || !deck) {
      return (
        <Centered>
          <ActivityIndicator color={theme.accent} />
          <Text style={msgStyle}>
            {progress
              ? `Reading your cards… ${progress.done}/${progress.total}`
              : 'Reading your cards…'}
          </Text>
        </Centered>
      );
    }
    if (deck.length === 0) {
      return (
        <Centered>
          <Feather name="moon" size={28} color={theme.textMute} />
          <Text style={msgStyle}>
            No page ideas right now. Evolution lines, repeat artists, and sets with several special rarities give the Curator the most to work with.
          </Text>
        </Centered>
      );
    }
    return (
      <>
        {/* Feed height is measured so the page miniature fits vertically;
            a full-width grid of card-aspect cells is taller than most screens. */}
        <View
          style={{ flex: 1 }}
          onLayout={(e) => setFeedH(e.nativeEvent.layout.height)}
        >
          {feedH > 0 && (
            <FlatList
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              data={deck}
              keyExtractor={(i) => i.id}
              getItemLayout={(_, index) => ({ length: contentW, offset: contentW * index, index })}
              onMomentumScrollEnd={(e) => {
                setFeedIdx(Math.round(e.nativeEvent.contentOffset.x / contentW));
              }}
              renderItem={({ item }) => (
                <IdeaCard
                  idea={item}
                  width={contentW}
                  maxHeight={feedH}
                  cols={binder.grid_cols}
                  gridRows={binder.grid_rows}
                  appliedInfo={applied.get(item.id) ?? null}
                  busy={applyIdea.isPending || undoApply.isPending}
                  onApply={() => onApply(item)}
                  onDismiss={() => onDismiss(item)}
                  onUndo={() => onUndo(item)}
                  onView={() => {
                    const res = applied.get(item.id);
                    if (res) router.push(`/binder/${binderId}?page=${res.pageIndex}`);
                  }}
                  onGhost={(g) => onGhost(g, item)}
                />
              )}
            />
          )}
        </View>
        <Text style={{
          textAlign: 'center', color: theme.textMute, fontFamily: theme.fontMono,
          fontSize: 11, letterSpacing: 1, paddingVertical: 10,
        }}>
          {feedIdx + 1} / {deck.length}
          {palettesPending > 0 ? `  ·  reading colours (${palettesPending} left)` : ''}
          {pairsPending > 0 ? `  ·  matching artwork edges (${pairsPending} left)` : ''}
        </Text>
      </>
    );
  };

  return (
    <Screen>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2,
      }}>
        <IconDisc name="chevron-left" onPress={() => router.back()} />
      </View>
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 10 }}>
        <Eyebrow style={{ color: theme.accent }}>The Curator</Eyebrow>
        <Text numberOfLines={1} style={{
          fontFamily: theme.fontDisplaySemi,
          fontSize: 26, color: theme.text, marginTop: 4, lineHeight: 34,
        }}>
          {binder ? `Page ideas · ${binder.name}` : 'Page ideas'}
        </Text>
      </View>
      {body()}
    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
      {children}
    </View>
  );
}

const msgStyle = {
  color: theme.textDim,
  fontFamily: theme.fontUI,
  fontSize: 14,
  lineHeight: 21,
  textAlign: 'center' as const,
  maxWidth: 300,
};

function IdeaCard({
  idea, width, maxHeight, cols, gridRows, appliedInfo, busy,
  onApply, onDismiss, onUndo, onView, onGhost,
}: {
  idea: PageIdea;
  width: number;
  maxHeight: number;
  cols: number;
  gridRows: number;
  appliedInfo: AppliedIdea | null;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
  onUndo: () => void;
  onView: () => void;
  onGhost: (g: GhostCard) => void;
}) {
  const GAP = 6;
  const CARD_PAD = 14;
  // Height of everything except the grid: header, buttons, paddings, and
  // slack for the disruption line.
  const CHROME_H = 225;
  // Size the miniature from whichever budget binds (inner width, or height
  // left after the chrome) so the buttons always stay on screen.
  const innerW = width - 48 - CARD_PAD * 2 - 2;
  const gridHBudget = Math.max(160, maxHeight - CHROME_H);
  const cellHFromH = (gridHBudget - GAP * (gridRows - 1)) / gridRows;
  const wFromH = cellHFromH * (63 / 88) * cols + GAP * (cols - 1);
  const gridW = Math.min(innerW, wFromH);

  return (
    <View style={{ width, paddingHorizontal: 24 }}>
      <View style={{
        backgroundColor: theme.surface,
        borderWidth: 1, borderColor: theme.hairline,
        borderRadius: theme.radiusLg,
        padding: CARD_PAD,
        boxShadow: `${theme.shadowSoft}, ${theme.shadowInner}`,
      }}>
        <Eyebrow>{ARCHETYPE_LABEL[idea.archetype]}</Eyebrow>
        <Text style={{
          fontFamily: theme.fontDisplaySemi, fontSize: 22, lineHeight: 30,
          color: theme.accent, marginTop: 2,
        }} numberOfLines={1}>
          {idea.title}
        </Text>
        <Text style={{
          color: theme.textDim, fontFamily: theme.fontUI, fontSize: 13,
          lineHeight: 19, marginTop: 2, marginBottom: 10,
        }} numberOfLines={2}>
          {idea.reason}
        </Text>

        {/* Explicit rows with flex cells, matching the binder page grid for
            any cols × rows. */}
        <View style={{
          width: gridW, alignSelf: 'center', gap: GAP,
          backgroundColor: theme.surface2, borderRadius: theme.radius,
        }}>
          {Array.from({ length: gridRows }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row', gap: GAP }}>
              {idea.slots.slice(r * cols, (r + 1) * cols).map((slot, i) => (
                <Slot key={i} slot={slot} onGhost={onGhost} />
              ))}
            </View>
          ))}
        </View>

        {idea.disruption.count > 0 && !appliedInfo && (
          <Text style={{
            color: theme.statusWant, fontFamily: theme.fontUI, fontSize: 12,
            marginTop: 8,
          }}>
            {idea.disruption.count} card{idea.disruption.count === 1 ? '' : 's'} would leave{' '}
            {idea.disruption.pageTitles.map((t) => `“${t}”`).join(', ')}
          </Text>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          {appliedInfo ? (
            <>
              <ActionBtn label={`Page ${appliedInfo.pageIndex + 1} added`} icon="check" tone="done" onPress={onView} disabled={busy} />
              <ActionBtn label="View" icon="eye" tone="quiet" onPress={onView} disabled={busy} />
              <ActionBtn label="Undo" icon="rotate-ccw" tone="quiet" onPress={onUndo} disabled={busy} />
            </>
          ) : (
            <>
              <ActionBtn label="Add page" icon="plus" tone="primary" onPress={onApply} disabled={busy} />
              <ActionBtn label="Dismiss" icon="x" tone="quiet" onPress={onDismiss} disabled={busy} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// Card aspect ratio (63×88mm), shared by every slot so rows stay even.
const CELL = { flex: 1, aspectRatio: 63 / 88, borderRadius: 4 } as const;

function Slot({
  slot, onGhost,
}: { slot: IdeaSlot; onGhost: (g: GhostCard) => void }) {
  if (slot.kind === 'card') {
    const uri = slot.row!.image_small;
    return uri ? (
      <Image
        source={{ uri }}
        style={{ ...CELL, backgroundColor: theme.surface3 }}
        resizeMode="cover"
      />
    ) : (
      <View style={{
        ...CELL, backgroundColor: theme.surface3,
        alignItems: 'center', justifyContent: 'flex-end', padding: 3,
      }}>
        <Text style={{ color: theme.textDim, fontFamily: theme.fontMono, fontSize: 8 }} numberOfLines={2}>
          {slot.row!.card_name}
        </Text>
      </View>
    );
  }
  if (slot.kind === 'ghost') {
    const g = slot.ghost!;
    return (
      <Pressable
        onPress={() => onGhost(g)}
        accessibilityLabel={`Add ${g.name} to wantlist`}
        style={{
          ...CELL,
          borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.statusWant,
          alignItems: 'center', justifyContent: 'center', gap: 3, padding: 3,
        }}
      >
        <Feather name="plus" size={14} color={theme.statusWant} />
        <Text
          style={{ color: theme.statusWant, fontFamily: theme.fontMono, fontSize: 8, textAlign: 'center' }}
          numberOfLines={2}
        >
          {g.name}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={{ ...CELL, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.glass }} />
  );
}

function ActionBtn({
  label, icon, tone, onPress, disabled,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tone: 'primary' | 'quiet' | 'done';
  onPress: () => void;
  disabled?: boolean;
}) {
  const bg = tone === 'primary' ? theme.accent
    : tone === 'done' ? theme.statusHaveSoft : theme.glass;
  const fg = tone === 'primary' ? theme.accentText
    : tone === 'done' ? theme.statusHave : theme.textDim;
  const border = tone === 'primary' ? theme.accent
    : tone === 'done' ? 'rgba(113,163,126,0.4)' : theme.hairline;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingVertical: 10, paddingHorizontal: 15,
        backgroundColor: bg, borderWidth: 1, borderColor: border,
        borderRadius: theme.pill, opacity: disabled ? 0.5 : 1,
        boxShadow: tone === 'primary' ? theme.shadowGold : undefined,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      <Feather name={icon} size={14} color={fg} />
      <Text style={{ color: fg, fontFamily: theme.fontUIBold, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
