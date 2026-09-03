// React-Query hooks wrapping Supabase + PokemonTCG.io.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'react-native';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { supabase } from './supabase';
import {
  searchCards,
  getCard,
  getCardFacts,
  getCardVariants,
  getSets,
  getSet,
  getAllCardIds,
  parseSearchQuery,
  cardImages,
  fallbackImageUrls,
  SEARCH_ITEMS_PER_PAGE,
  INTL_LOCALES,
  CardVariantsInfo,
  TcgdexBrief,
  TcgdexSet,
  TcgdexSetDetail,
  Locale,
} from './tcgdex';
import {
  Binder,
  BinderPage,
  CardFacts,
  CollectionRow,
  PaletteEntry,
  FriendState,
  Friendship,
  Profile,
  Status,
  TcgCard,
  Visibility,
  tcgToCollectionRow,
} from './types';

const KEY = {
  binders: ['binders'] as const,
  binder: (id: string) => ['binder', id] as const,
  binderPages: (id: string) => ['binder', id, 'pages'] as const,
  collection: ['collection'] as const,
  collectionByBinder: (id: string) => ['collection', 'binder', id] as const,
  card: (id: string) => ['card', id] as const,
  search: (q: string) => ['search', q] as const,
  sets: ['sets'] as const,
};

// ─────────────────────────────────────────────────────────────
// Binders
// ─────────────────────────────────────────────────────────────
export function useBinders() {
  return useQuery({
    queryKey: KEY.binders,
    queryFn: async (): Promise<Binder[]> => {
      // RLS exposes non-private binders cross-user, so this list must
      // filter explicitly to the signed-in user.
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from('binders')
        .select('*')
        .eq('user_id', u.user.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as Binder[];
    },
  });
}

/** Persist a new binder ordering; each id gets `position = index`. */
export function useReorderBinders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in');
      const results = await Promise.all(
        orderedIds.map((id, i) =>
          supabase
            .from('binders')
            .update({ position: i })
            .eq('id', id)
            .eq('user_id', u.user!.id),
        ),
      );
      for (const r of results) if (r.error) throw r.error;
      return { count: orderedIds.length };
    },
    onMutate: async (orderedIds) => {
      // Apply the optimistic order synchronously before any await, or
      // DraggableFlatList snaps back to the prior data for a frame.
      const prev = qc.getQueryData<Binder[]>(KEY.binders);
      if (prev) {
        const byId = new Map(prev.map((b) => [b.id, b]));
        const next = orderedIds
          .map((id) => byId.get(id))
          .filter((b): b is Binder => !!b);
        qc.setQueryData(KEY.binders, next);
      }
      // Cancel in-flight refetches so they can't overwrite the optimistic order.
      await qc.cancelQueries({ queryKey: KEY.binders });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY.binders, ctx.prev);
    },
    // Skip invalidation on success: a refetch would briefly show the
    // server's pre-update order. Only refetch on error.
    onSettled: (_data, error) => {
      if (error) qc.invalidateQueries({ queryKey: KEY.binders });
    },
  });
}

export function useBinder(binderId: string | undefined) {
  return useQuery({
    queryKey: KEY.binder(binderId ?? ''),
    enabled: !!binderId,
    queryFn: async (): Promise<Binder | null> => {
      if (!binderId) return null;
      // Restrict to the signed-in user so the authed view can't show
      // someone else's public binder.
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from('binders')
        .select('*')
        .eq('id', binderId)
        .eq('user_id', u.user.id)
        .maybeSingle();
      if (error) throw error;
      return data as Binder | null;
    },
  });
}

export function useBinderPages(binderId: string | undefined) {
  return useQuery({
    queryKey: KEY.binderPages(binderId ?? ''),
    enabled: !!binderId,
    queryFn: async (): Promise<BinderPage[]> => {
      if (!binderId) return [];
      const { data, error } = await supabase
        .from('binder_pages')
        .select('*')
        .eq('binder_id', binderId)
        .order('page_index', { ascending: true });
      if (error) throw error;
      return data as BinderPage[];
    },
  });
}

export function useCreateBinder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      cols: number;
      rows: number;
      initialPages: number;
    }): Promise<Binder> => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error('Not signed in');

      const { data: binder, error } = await supabase
        .from('binders')
        .insert({
          user_id: user.id,
          name: input.name,
          grid_cols: input.cols,
          grid_rows: input.rows,
        })
        .select()
        .single();
      if (error) throw error;

      const pages = Array.from({ length: Math.max(1, input.initialPages) }).map(
        (_, i) => ({ binder_id: binder.id, page_index: i, title: null }),
      );
      const { error: pErr } = await supabase.from('binder_pages').insert(pages);
      if (pErr) throw pErr;

      return binder as Binder;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.binders }),
  });
}

export function useRenameBinder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ binderId, name }: { binderId: string; name: string }) => {
      const { error } = await supabase
        .from('binders')
        .update({ name })
        .eq('id', binderId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: KEY.binder(vars.binderId) });
    },
  });
}

export function useDeleteBinder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (binderId: string) => {
      const { error } = await supabase.from('binders').delete().eq('id', binderId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

export function useAddPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { binderId: string; title?: string | null; afterIndex?: number }) => {
      const { data: existing, error: pErr } = await supabase
        .from('binder_pages')
        .select('page_index')
        .eq('binder_id', input.binderId)
        .order('page_index', { ascending: false })
        .limit(1);
      if (pErr) throw pErr;
      const next = (existing?.[0]?.page_index ?? -1) + 1;
      const { data: inserted, error } = await supabase
        .from('binder_pages')
        .insert({ binder_id: input.binderId, page_index: next, title: input.title ?? null })
        .select('id')
        .single();
      if (error) throw error;
      // Insert-after: the page is created at the end, then reorder_binder_page
      // shifts it into place. Skip the reorder when it already lands last.
      const targetIndex = input.afterIndex !== undefined ? input.afterIndex + 1 : next;
      if (targetIndex !== next && inserted?.id) {
        const { error: rErr } = await supabase.rpc('reorder_binder_page', {
          binder: input.binderId,
          page_id: inserted.id,
          new_index: targetIndex,
        });
        if (rErr) throw rErr;
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

export function useUpdatePageTitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pageId: string; binderId: string; title: string | null }) => {
      const { error } = await supabase
        .from('binder_pages')
        .update({ title: input.title })
        .eq('id', input.pageId);
      if (error) throw error;
    },
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) }),
  });
}

// ─────────────────────────────────────────────────────────────
// Collection — list across all binders, or scoped to one binder
// ─────────────────────────────────────────────────────────────

/** TCGdex has no artwork for Trainer/Galarian Gallery subsets (letter-prefixed
 *  numbers like TG01); fall back to PokemonTCG.io. The DB row is untouched. */
function healRowImages(row: CollectionRow): CollectionRow {
  if (row.image_small || !/^[A-Za-z]/.test(row.card_number)) return row;
  const img = fallbackImageUrls(row.set_id, row.card_number);
  return { ...row, image_small: img.small, image_large: img.large };
}

export function useCollection() {
  return useQuery({
    queryKey: KEY.collection,
    queryFn: async (): Promise<CollectionRow[]> => {
      // RLS exposes cards from non-private binders cross-user, so this
      // list must stay scoped to the signed-in user.
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('user_id', u.user.id)
        .order('added_at', { ascending: false });
      if (error) throw error;
      return (data as CollectionRow[]).map(healRowImages);
    },
  });
}

export function useCollectionByBinder(binderId: string | undefined) {
  return useQuery({
    queryKey: KEY.collectionByBinder(binderId ?? ''),
    enabled: !!binderId,
    queryFn: async (): Promise<CollectionRow[]> => {
      if (!binderId) return [];
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('binder_id', binderId)
        .eq('user_id', u.user.id)
        .order('position', { ascending: true });
      if (error) throw error;
      return (data as CollectionRow[]).map(healRowImages);
    },
  });
}

/** First row found for a card_id. Used by card detail when no specific
 *  instance is requested. */
export function useCollectionItem(cardId: string | undefined) {
  return useQuery({
    queryKey: ['collection', cardId],
    enabled: !!cardId,
    queryFn: async (): Promise<CollectionRow | null> => {
      if (!cardId) return null;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('card_id', cardId)
        .eq('user_id', u.user.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? healRowImages(data as CollectionRow) : null;
    },
  });
}

/** All owned rows for a card_id across binders. */
export function useCollectionItemsByCardId(cardId: string | undefined) {
  return useQuery({
    queryKey: ['collection', 'byCard', cardId ?? ''],
    enabled: !!cardId,
    queryFn: async (): Promise<CollectionRow[]> => {
      if (!cardId) return [];
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('card_id', cardId)
        .eq('user_id', u.user.id);
      if (error) throw error;
      return ((data ?? []) as CollectionRow[]).map(healRowImages);
    },
  });
}

/** Look up a specific row by UUID, for contexts that know the exact instance. */
export function useCollectionRowById(rowId: string | undefined) {
  return useQuery({
    queryKey: ['collection', 'row', rowId ?? ''],
    enabled: !!rowId,
    queryFn: async (): Promise<CollectionRow | null> => {
      if (!rowId) return null;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('id', rowId)
        .eq('user_id', u.user.id)
        .maybeSingle();
      if (error) throw error;
      return data ? healRowImages(data as CollectionRow) : null;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────
/** Adds one card instance: a fresh row at the next free position. The same
 *  card_id can appear multiple times per binder, each row with its own state. */
export function useUpsertCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      card,
      status,
      binderId,
      position: positionOverride,
    }: {
      card: TcgCard;
      status: Status;
      binderId: string;
      // Insert at this exact slot when set; otherwise append at the end.
      position?: number;
    }): Promise<CollectionRow> => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error('Not signed in');

      let position: number;
      if (positionOverride != null) {
        position = positionOverride;
      } else {
        const { data: last, error: lastErr } = await supabase
          .from('collections')
          .select('position')
          .eq('binder_id', binderId)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastErr) throw lastErr;
        position = (last?.position ?? -1) + 1;
      }

      const row = {
        ...tcgToCollectionRow(card, status, binderId),
        user_id: user.id,
        position,
      };
      const { data: inserted, error } = await supabase
        .from('collections')
        .insert(row)
        .select()
        .single();
      if (error) throw error;

      await ensureBinderHasSpace(binderId);
      return inserted as CollectionRow;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEY.collection });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) });
    },
  });
}

/** Bulk-update positions in a binder (drag-and-drop). binder_position_unique
 *  is deferrable, so intermediate collisions within the transaction are fine. */
export function useReorderCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      binderId,
      updates,
    }: {
      binderId: string;
      updates: { id: string; position: number }[];
    }) => {
      const { data, error } = await supabase.rpc('reorder_cards_swap', {
        binder: binderId,
        ids: updates.map((u) => u.id),
        positions: updates.map((u) => u.position),
      });
      if (error) throw error;
      const affected = typeof data === 'number' ? data : 0;
      if (affected !== updates.length) {
        throw new Error(
          `Reorder updated ${affected}/${updates.length} rows. ` +
          `Likely RLS or stale row ids.`,
        );
      }
    },
    onMutate: async ({ binderId, updates }) => {
      const key = KEY.collectionByBinder(binderId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CollectionRow[]>(key);
      const byId = new Map(updates.map((u) => [u.id, u.position]));
      qc.setQueryData<CollectionRow[]>(key, (old) =>
        old
          ?.map((r) => (byId.has(r.id) ? { ...r, position: byId.get(r.id)! } : r))
          .sort((a, b) => a.position - b.position),
      );
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(vars.binderId) });
    },
  });
}

async function ensureBinderHasSpace(binderId: string) {
  // Page count must derive from max(position), not row count: drag-and-drop
  // and bulk moves leave sparse positions.
  const [{ data: binder }, { data: pages }, { data: lastCard }] = await Promise.all([
    supabase.from('binders').select('grid_cols,grid_rows').eq('id', binderId).single(),
    supabase.from('binder_pages').select('page_index').eq('binder_id', binderId)
      .order('page_index', { ascending: false }).limit(1),
    supabase.from('collections').select('position').eq('binder_id', binderId)
      .order('position', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!binder) return;
  const slotsPerPage = binder.grid_cols * binder.grid_rows;
  const maxPos = lastCard?.position ?? -1;
  const pagesNeeded = Math.max(1, Math.ceil((maxPos + 1) / slotsPerPage));
  const currentMaxIdx = pages?.[0]?.page_index ?? -1;
  const currentPages = currentMaxIdx + 1;
  if (pagesNeeded <= currentPages) return;
  const toInsert = [];
  for (let i = currentPages; i < pagesNeeded; i++) {
    toInsert.push({ binder_id: binderId, page_index: i, title: null });
  }
  await supabase.from('binder_pages').insert(toInsert);
}

/** Repairs binders whose binder_pages rows lag behind card positions.
 *  Called once on binder-view mount; no-op when already consistent. */
export function useEnsureBinderPages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (binderId: string) => {
      await ensureBinderHasSpace(binderId);
    },
    onSuccess: (_, binderId) => {
      qc.invalidateQueries({ queryKey: KEY.binderPages(binderId) });
    },
  });
}

export function useSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rowId, status }: { rowId: string; status: Status }) => {
      const { error } = await supabase
        .from('collections')
        .update({ status })
        .eq('id', rowId);
      if (error) throw error;
    },
    onMutate: async ({ rowId, status }) => {
      await qc.cancelQueries({ queryKey: KEY.collection });
      const prev = qc.getQueryData<CollectionRow[]>(KEY.collection);
      qc.setQueryData<CollectionRow[]>(KEY.collection, (old) =>
        old?.map((r) => (r.id === rowId ? { ...r, status } : r))
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY.collection, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY.collection });
      qc.invalidateQueries({ queryKey: ['collection'] });
    },
  });
}

/** Generic partial-update of a collections row. Used for quantity, condition. */
export function useUpdateCardRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rowId, fields,
    }: { rowId: string; fields: Partial<CollectionRow> }) => {
      const { error } = await supabase
        .from('collections')
        .update(fields)
        .eq('id', rowId);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}

export function useDeletePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pageId }: { pageId: string; binderId: string }) => {
      const { error } = await supabase.rpc('delete_binder_page', { page_id: pageId });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

export function useReorderPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      binderId, pageId, newIndex,
    }: { binderId: string; pageId: string; newIndex: number }) => {
      const { error } = await supabase.rpc('reorder_binder_page', {
        binder: binderId, page_id: pageId, new_index: newIndex,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

export function useSwapPages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      binderId, idxA, idxB,
    }: { binderId: string; idxA: number; idxB: number }) => {
      const { error } = await supabase.rpc('swap_binder_pages', {
        binder: binderId, idx_a: idxA, idx_b: idxB,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

export function useRemoveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase
        .from('collections')
        .delete()
        .eq('id', rowId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}

/** Bulk-delete rows in one round-trip. */
export function useRemoveCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rowIds: string[]) => {
      if (rowIds.length === 0) return;
      const { error } = await supabase
        .from('collections')
        .delete()
        .in('id', rowIds);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}

// ─────────────────────────────────────────────────────────────
// PokemonTCG.io
// ─────────────────────────────────────────────────────────────
export function useSearch(q: string) {
  // Parse here so the query key reflects the structured filters; queries
  // differing only in collector number get separate cache entries.
  const parsed = parseSearchQuery(q);
  return useInfiniteQuery({
    queryKey: ['search', parsed.name, parsed.localId ?? ''],
    enabled: parsed.name.trim().length >= 2 || !!parsed.localId,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const raw = await searchCards(parsed.name, { localId: parsed.localId, page: pageParam });
      // Mirror the Sets list filter: drop cards whose set shortcode starts
      // with a capital letter (card ids are `<setId>-<localId>`).
      const items = raw.filter((c) => !/^[A-Z]/.test(c.id));
      // `fetched` is the raw pre-filter page size; pagination uses it so
      // filtering can't end paging early.
      return { items, fetched: raw.length };
    },
    // A page shorter than SEARCH_ITEMS_PER_PAGE means no next page.
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.fetched === SEARCH_ITEMS_PER_PAGE ? lastPageParam + 1 : undefined,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 10,
  });
}

export function useTcgCard(cardId: string | undefined, locale: Locale = 'en') {
  return useQuery({
    queryKey: [...KEY.card(cardId ?? ''), locale],
    enabled: !!cardId,
    queryFn: () => getCard(cardId!, locale),
    staleTime: 1000 * 60 * 30,
  });
}

/** Warm the card-detail cache and hero image before pushing /card/[id],
 *  so the screen mounts cache-hit. Fire-and-forget. */
export function usePrefetchCard() {
  const qc = useQueryClient();
  return useCallback((cardId: string, locale: Locale = 'en') => {
    qc.fetchQuery({
      queryKey: [...KEY.card(cardId), locale],
      queryFn: () => getCard(cardId, locale),
      staleTime: 1000 * 60 * 30,
    })
      .then((card) => {
        // Native image caches serve this instantly when the hero mounts.
        if (card.images.large) Image.prefetch(card.images.large).catch(() => {});
      })
      .catch(() => {});
  }, [qc]);
}

/** Resolves the Cardmarket product URL via the cardmarket-resolve Edge
 *  Function; cached per card id for the session. */
export function useCardmarketUrl(card: TcgCard | undefined) {
  return useQuery({
    queryKey: ['cardmarket-url', card?.id],
    enabled: !!card,
    staleTime: Infinity,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('cardmarket-resolve', {
        body: {
          name: card!.name,
          set: card!.set.name,
          setId: card!.set.id,
          number: card!.number,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Edge function returned no url');
      return data.url as string;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Card scanning — photo → card-scan Edge Function → ranked matches
// ─────────────────────────────────────────────────────────────
export interface ScanCandidate {
  card: TcgCard;
  /** 0..1 — name similarity blended with collector-number match. */
  confidence: number;
}
export interface ScanResult {
  candidates: ScanCandidate[];
  /** What OCR parsed off the card — surfaced for debugging / "no match" copy. */
  parsed: { name: string; number?: string; total?: string; hp?: string };
  ocrText: string;
  /** Which TCGdex catalogue matched — 'ja' when the card's text is Japanese.
   *  The card-detail route needs this as `?lang=ja` to render the right data. */
  locale?: 'en' | 'ja';
}

/** Send a base64 photo to the card-scan Edge Function; returns ranked
 *  candidates. */
export function useScanCard() {
  return useMutation({
    mutationFn: async (imageBase64: string): Promise<ScanResult> => {
      const { data, error } = await supabase.functions.invoke('card-scan', {
        body: { imageBase64 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as ScanResult;
    },
  });
}

export type SetsScope = 'en' | 'intl';

/** All TCGdex sets for a scope: 'en' or the intl catalogues, tagged with
 *  `locale`. TCGdex ships duplicate rows, so lists are deduped by set id. */
export function useSets(scope: SetsScope = 'en') {
  return useQuery<TcgdexSet[]>({
    queryKey: ['sets', scope],
    queryFn: async () => {
      if (scope === 'en') {
        const en = await getSets('en');
        return en.map((x) => ({ ...x, locale: 'en' as const }));
      }
      const lists = await Promise.all(
        INTL_LOCALES.map(async (loc) => {
          try {
            const sets = await getSets(loc);
            const seen = new Set<string>();
            const deduped = sets.filter(
              (s) => (seen.has(s.id) ? false : (seen.add(s.id), true)),
            );
            // TCGdex lists metadata for intl sets with no cards entered; keep
            // only sets the card index covers, or everything if it won't fetch.
            let hasCards: (setId: string) => boolean = () => true;
            try {
              const ids = await getAllCardIds(loc);
              const prefixes = new Set(
                ids.map((id) => id.slice(0, id.lastIndexOf('-'))).filter(Boolean),
              );
              hasCards = (setId) =>
                prefixes.has(setId) || ids.some((id) => id.startsWith(`${setId}-`));
            } catch {
              // Index unavailable; don't filter.
            }
            return deduped
              .filter((s) => hasCards(s.id))
              .map((x) => ({ ...x, locale: loc }));
          } catch {
            // One locale being down shouldn't blank the whole tab.
            return [] as TcgdexSet[];
          }
        }),
      );
      return lists.flat();
    },
    staleTime: 1000 * 60 * 60 * 24,
  });
}

/** Full set with card list. The query key includes locale so EN and JP
 *  variants don't clobber each other in the cache. */
export function useSet(setId: string | undefined, locale: Locale = 'en') {
  return useQuery<TcgdexSetDetail>({
    queryKey: ['set', locale, setId],
    enabled: !!setId,
    queryFn: () => getSet(setId!, locale),
    staleTime: 1000 * 60 * 60 * 24,
  });
}

export type { TcgdexBrief, TcgdexSet };

// ─────────────────────────────────────────────────────────────
// Profiles + sharing
// ─────────────────────────────────────────────────────────────

/** Signed-in user's profile row. Auto-created by an auth trigger;
 *  `username` starts null. */
export function useMyProfile() {
  return useQuery<Profile | null>({
    queryKey: ['profile', 'me'],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', u.user.id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
    staleTime: 1000 * 60 * 5,
  });
}

/** Set or change the username (lowercase a-z, 0-9, _-, 3-24 chars).
 *  Upserts so a missing profile row still succeeds. */
export function useSetUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) => {
      const v = username.trim().toLowerCase();
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in');
      const { error } = await supabase
        .from('profiles')
        .upsert(
          { user_id: u.user.id, username: v },
          { onConflict: 'user_id' },
        );
      if (error) throw error;
      return v;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

/** Profile lookup by username; used by /u/[username] routes. */
export function useProfileByUsername(username: string | undefined) {
  return useQuery<Profile | null>({
    queryKey: ['profile', 'username', username],
    enabled: !!username,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username!)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
    staleTime: 1000 * 60 * 5,
  });
}

/** Change a binder's visibility (private/unlisted/public). The DB trigger
 *  assigns a share_token the first time visibility flips off 'private'. */
export function useSetBinderVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ binderId, visibility }: { binderId: string; visibility: Visibility }) => {
      const { data, error } = await supabase
        .from('binders')
        .update({ visibility })
        .eq('id', binderId)
        .select('*')
        .single();
      if (error) throw error;
      return data as Binder;
    },
    onSuccess: (binder) => {
      qc.invalidateQueries({ queryKey: KEY.binder(binder.id) });
      qc.invalidateQueries({ queryKey: KEY.binders });
    },
  });
}

/** Public profile + their listed (visibility='public') binders. */
export function usePublicProfile(username: string | undefined) {
  return useQuery({
    queryKey: ['public-profile', username],
    enabled: !!username,
    queryFn: async () => {
      const { data: profile, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username!)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!profile) return { profile: null as Profile | null, binders: [] as Binder[] };
      // RLS hides friends-only binders from strangers, so a friend sees
      // public + friends and a stranger sees only public.
      const { data: binders, error: bErr } = await supabase
        .from('binders')
        .select('*')
        .eq('user_id', profile.user_id)
        .neq('visibility', 'private')
        .order('created_at', { ascending: false });
      if (bErr) throw bErr;
      return { profile: profile as Profile, binders: (binders ?? []) as Binder[] };
    },
    staleTime: 1000 * 60,
  });
}

/** Binder + pages + cards in one bundle for public viewing; readable via
 *  RLS when the binder's visibility is non-private. */
async function fetchPublicBinderBundle(binderId: string) {
  const { data: binder, error: bErr } = await supabase
    .from('binders')
    .select('*')
    .eq('id', binderId)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!binder) return null;
  const { data: pages, error: pErr } = await supabase
    .from('binder_pages')
    .select('*')
    .eq('binder_id', binderId)
    .order('page_index');
  if (pErr) throw pErr;
  const { data: cards, error: cErr } = await supabase
    .from('collections')
    .select('*')
    .eq('binder_id', binderId)
    .order('position');
  if (cErr) throw cErr;
  return {
    binder: binder as Binder,
    pages: (pages ?? []) as BinderPage[],
    cards: ((cards ?? []) as CollectionRow[]).map(healRowImages),
  };
}

export function usePublicBinder(binderId: string | undefined) {
  return useQuery({
    queryKey: ['public-binder', binderId],
    enabled: !!binderId,
    queryFn: () => fetchPublicBinderBundle(binderId!),
    staleTime: 1000 * 60,
  });
}

/** Resolve an unlisted-share token → its binder bundle. */
export function useBinderByShareToken(token: string | undefined) {
  return useQuery({
    queryKey: ['binder-by-token', token],
    enabled: !!token,
    queryFn: async () => {
      // Share links resolve only for public binders; the visibility trigger
      // strips share_token on non-public rows.
      const { data: binder, error } = await supabase
        .from('binders')
        .select('*')
        .eq('share_token', token!)
        .eq('visibility', 'public')
        .maybeSingle();
      if (error) throw error;
      if (!binder) return null;
      return fetchPublicBinderBundle(binder.id);
    },
    staleTime: 1000 * 60,
  });
}

// ─────────────────────────────────────────────────────────────
// Friends — one cached row query (`friendships.mine`); derived views
// are pure; mutations write optimistically into that cache.
// ─────────────────────────────────────────────────────────────

const FRIENDSHIPS_KEY = ['friendships', 'mine'] as const;

/** Cached auth user id; lets derived hooks stay synchronous. */
function useAuthUserId() {
  return useQuery<string | null>({
    queryKey: ['auth-user-id'],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 1000 * 60 * 10,
  });
}

/** All friendship rows the signed-in user is party to, both directions
 *  and statuses. Source cache for the derived hooks. */
function useMyFriendships() {
  return useQuery<Friendship[]>({
    queryKey: FRIENDSHIPS_KEY,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from('friendships')
        .select('*')
        .or(`requester_id.eq.${u.user.id},receiver_id.eq.${u.user.id}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Friendship[];
    },
    staleTime: 1000 * 30,
  });
}

async function fetchProfilesByIds(userIds: string[]): Promise<Profile[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('user_id', userIds);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

/** Batched profile fetch for the other party of each friendship. Sorted-id
 *  key plus keepPreviousData keeps the list from flickering empty. */
function useFriendProfiles() {
  const { data: rows = [] } = useMyFriendships();
  const { data: myId } = useAuthUserId();
  const otherIds = (() => {
    if (!myId) return [] as string[];
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.requester_id === myId ? r.receiver_id : r.requester_id);
    }
    return Array.from(set);
  })();
  const sortedKey = [...otherIds].sort().join(',');
  return useQuery<Profile[]>({
    queryKey: ['friendships', 'profiles', sortedKey],
    enabled: otherIds.length > 0,
    queryFn: () => fetchProfilesByIds(otherIds),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
  });
}

interface FriendListEntry {
  friendship: Friendship;
  profile: Profile;
}

/** Accepted friends, derived from the cached rows and profiles. */
export function useFriends(): { data: FriendListEntry[]; isLoading: boolean } {
  const myships = useMyFriendships();
  const profiles = useFriendProfiles();
  const { data: myId } = useAuthUserId();
  const data: FriendListEntry[] = (() => {
    if (!myId) return [];
    const byId = new Map((profiles.data ?? []).map((p) => [p.user_id, p]));
    return (myships.data ?? [])
      .filter((r) => r.status === 'accepted')
      .map((f) => {
        const otherId = f.requester_id === myId ? f.receiver_id : f.requester_id;
        const profile = byId.get(otherId);
        return profile ? { friendship: f, profile } : null;
      })
      .filter((x): x is FriendListEntry => !!x);
  })();
  return { data, isLoading: myships.isLoading || profiles.isLoading };
}

/** Pending requests received by the signed-in user. */
export function useIncomingRequests(): { data: FriendListEntry[]; isLoading: boolean } {
  const myships = useMyFriendships();
  const profiles = useFriendProfiles();
  const { data: myId } = useAuthUserId();
  const data: FriendListEntry[] = (() => {
    if (!myId) return [];
    const byId = new Map((profiles.data ?? []).map((p) => [p.user_id, p]));
    return (myships.data ?? [])
      .filter((r) => r.status === 'pending' && r.receiver_id === myId)
      .map((f) => {
        const profile = byId.get(f.requester_id);
        return profile ? { friendship: f, profile } : null;
      })
      .filter((x): x is FriendListEntry => !!x);
  })();
  return { data, isLoading: myships.isLoading || profiles.isLoading };
}

/** Pending requests sent by the signed-in user; the profile is the receiver. */
export function useOutgoingRequests(): { data: FriendListEntry[]; isLoading: boolean } {
  const myships = useMyFriendships();
  const profiles = useFriendProfiles();
  const { data: myId } = useAuthUserId();
  const data: FriendListEntry[] = (() => {
    if (!myId) return [];
    const byId = new Map((profiles.data ?? []).map((p) => [p.user_id, p]));
    return (myships.data ?? [])
      .filter((r) => r.status === 'pending' && r.requester_id === myId)
      .map((f) => {
        const profile = byId.get(f.receiver_id);
        return profile ? { friendship: f, profile } : null;
      })
      .filter((x): x is FriendListEntry => !!x);
  })();
  return { data, isLoading: myships.isLoading || profiles.isLoading };
}

/** Relationship state with another user. Pure derivation, so optimistic
 *  cache changes flip the Friend button instantly. */
export function useFriendshipWith(otherUserId: string | undefined): {
  data: { state: FriendState; row: Friendship | null } | undefined;
} {
  const { data: rows = [] } = useMyFriendships();
  const { data: myId } = useAuthUserId();
  if (!otherUserId || myId === undefined) return { data: undefined };
  if (myId === otherUserId) return { data: { state: 'self', row: null } };
  if (!myId) return { data: { state: 'none', row: null } };
  const match = rows.find(
    (r) =>
      (r.requester_id === myId && r.receiver_id === otherUserId) ||
      (r.requester_id === otherUserId && r.receiver_id === myId),
  );
  if (!match) return { data: { state: 'none', row: null } };
  if (match.status === 'accepted') return { data: { state: 'friends', row: match } };
  const state: FriendState =
    match.requester_id === myId ? 'outgoing-pending' : 'incoming-pending';
  return { data: { state, row: match } };
}

/** Invalidate everything gated on friend visibility. Runs after a mutation
 *  settles; the optimistic onMutate flip handles immediacy. */
function refetchFriendDependents(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: FRIENDSHIPS_KEY });
  qc.invalidateQueries({ queryKey: ['public-profile'] });
  qc.invalidateQueries({ queryKey: ['public-binder'] });
  qc.invalidateQueries({ queryKey: KEY.binders });
  qc.invalidateQueries({ queryKey: KEY.collection });
}

/** Send a friend request. Optimistically inserts a pending row so the
 *  Friend button flips immediately. */
export function useSendFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (receiverId: string) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in');
      if (u.user.id === receiverId) throw new Error('Can\'t friend yourself');
      const { error } = await supabase
        .from('friendships')
        .insert({ requester_id: u.user.id, receiver_id: receiverId });
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new Error('Friend request already exists for this user.');
        }
        throw error;
      }
    },
    onMutate: async (receiverId) => {
      await qc.cancelQueries({ queryKey: FRIENDSHIPS_KEY });
      const prev = qc.getQueryData<Friendship[]>(FRIENDSHIPS_KEY);
      const myId = qc.getQueryData<string | null>(['auth-user-id']);
      if (myId) {
        const now = new Date().toISOString();
        const optimistic: Friendship = {
          id: `optimistic-${myId}-${receiverId}`,
          requester_id: myId,
          receiver_id: receiverId,
          status: 'pending',
          created_at: now,
          updated_at: now,
        };
        qc.setQueryData<Friendship[]>(FRIENDSHIPS_KEY, [optimistic, ...(prev ?? [])]);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(FRIENDSHIPS_KEY, ctx.prev);
    },
    onSettled: () => refetchFriendDependents(qc),
  });
}

/** Accept an incoming request. Optimistic: flip status to 'accepted'
 *  in cache so the button + lists update on tap. */
export function useAcceptFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (friendshipId: string) => {
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendshipId);
      if (error) throw error;
    },
    onMutate: async (friendshipId) => {
      await qc.cancelQueries({ queryKey: FRIENDSHIPS_KEY });
      const prev = qc.getQueryData<Friendship[]>(FRIENDSHIPS_KEY);
      qc.setQueryData<Friendship[]>(FRIENDSHIPS_KEY, (rows) =>
        rows?.map((r) =>
          r.id === friendshipId
            ? { ...r, status: 'accepted', updated_at: new Date().toISOString() }
            : r,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(FRIENDSHIPS_KEY, ctx.prev);
    },
    onSettled: () => refetchFriendDependents(qc),
  });
}

/** Delete a friendship row. Covers decline / cancel / unfriend. */
export function useDeleteFriendship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (friendshipId: string) => {
      const { error } = await supabase
        .from('friendships')
        .delete()
        .eq('id', friendshipId);
      if (error) throw error;
    },
    onMutate: async (friendshipId) => {
      await qc.cancelQueries({ queryKey: FRIENDSHIPS_KEY });
      const prev = qc.getQueryData<Friendship[]>(FRIENDSHIPS_KEY);
      qc.setQueryData<Friendship[]>(FRIENDSHIPS_KEY, (rows) =>
        rows?.filter((r) => r.id !== friendshipId),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(FRIENDSHIPS_KEY, ctx.prev);
    },
    onSettled: () => refetchFriendDependents(qc),
  });
}

/** Resolve a username to a user_id. */
export function useUserIdByUsername(username: string | undefined) {
  return useQuery<string | null>({
    queryKey: ['profile', 'id-by-username', username],
    enabled: !!username,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('username', username!)
        .maybeSingle();
      if (error) throw error;
      return data?.user_id ?? null;
    },
    staleTime: 1000 * 60 * 5,
  });
}

// ─────────────────────────────────────────────────────────────
// Move cards across binders. Assigns each moved row a position at
// the end of the target binder (sequential, in the input order).
// ─────────────────────────────────────────────────────────────
export function useMoveCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rowIds, targetBinderId,
    }: { rowIds: string[]; targetBinderId: string }) => {
      if (rowIds.length === 0) return { moved: 0, targetBinderId };
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in');

      const { data: last, error: posErr } = await supabase
        .from('collections')
        .select('position')
        .eq('binder_id', targetBinderId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (posErr) throw posErr;
      const startPos = (last?.position ?? -1) + 1;

      // Sequential positions avoid collisions and preserve reading order.
      const results = await Promise.all(
        rowIds.map((id, i) =>
          supabase
            .from('collections')
            .update({ binder_id: targetBinderId, position: startPos + i })
            .eq('id', id)
            .eq('user_id', u.user!.id),
        ),
      );
      for (const r of results) if (r.error) throw r.error;
      // Cards placed beyond the existing page count need new binder_pages
      // rows or the page menu won't show them.
      await ensureBinderHasSpace(targetBinderId);
      return { moved: rowIds.length, targetBinderId };
    },
    onSuccess: () => {
      // Both source and target binder caches need refreshing.
      qc.invalidateQueries({ queryKey: KEY.collection });
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: ['binder'] });
      qc.invalidateQueries({ queryKey: ['collection', 'binder'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Bulk binder — a per-user pseudo-binder for cards owned but not
// sorted into any curated binder. Lazily created on first use.
// ─────────────────────────────────────────────────────────────

async function getOrCreateBulkBinder(userId: string): Promise<Binder> {
  const { data: existing, error: selErr } = await supabase
    .from('binders')
    .select('*')
    .eq('user_id', userId)
    .eq('is_bulk', true)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing as Binder;

  const { data: created, error: insErr } = await supabase
    .from('binders')
    .insert({ user_id: userId, name: 'Bulk', grid_cols: 3, grid_rows: 3, is_bulk: true })
    .select('*')
    .single();
  if (insErr) throw insErr;

  // Bulk binder has no pages of its own; the list view doesn't need them.
  // Still create a default page-0 so any grid-view fallback doesn't crash.
  await supabase.from('binder_pages').insert({ binder_id: created.id, page_index: 0 });
  return created as Binder;
}

/** Insert many cards into the bulk binder in one round-trip. */
export function useMarkCardsOwned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cards: Array<{
      id: string;
      name: string;
      localId: string;
      image?: string;
      rarity?: string;
      setId: string;
      setName: string;
    }>) => {
      if (cards.length === 0) return { binderId: '', inserted: 0 };
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Sign in to mark as owned');
      const bulk = await getOrCreateBulkBinder(u.user.id);

      const { data: last, error: posErr } = await supabase
        .from('collections')
        .select('position')
        .eq('binder_id', bulk.id)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (posErr) throw posErr;
      const startPos = (last?.position ?? -1) + 1;

      const rows = cards.map((card, i) => {
        const img = cardImages(card.image, card.setId, card.localId);
        return {
          user_id: u.user!.id,
          binder_id: bulk.id,
          card_id: card.id,
          card_name: card.name,
          set_id: card.setId,
          set_name: card.setName,
          card_number: card.localId,
          rarity: card.rarity ?? null,
          image_small: img.small || null,
          image_large: img.large || null,
          status: 'have' as const,
          condition: 'NM',
          position: startPos + i,
        };
      });

      const { error } = await supabase.from('collections').insert(rows);
      if (error) throw error;
      return { binderId: bulk.id, inserted: rows.length };
    },
    onSuccess: ({ binderId }) => {
      qc.invalidateQueries({ queryKey: KEY.collection });
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: KEY.binder(binderId) });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(binderId) });
    },
  });
}

/** Insert a single card into the bulk binder. */
export function useMarkCardOwned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (card: {
      id: string;
      name: string;
      localId: string;
      image?: string;
      rarity?: string;
      setId: string;
      setName: string;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Sign in to mark as owned');
      const bulk = await getOrCreateBulkBinder(u.user.id);

      const { data: last, error: posErr } = await supabase
        .from('collections')
        .select('position')
        .eq('binder_id', bulk.id)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (posErr) throw posErr;
      const nextPos = (last?.position ?? -1) + 1;

      const img = cardImages(card.image, card.setId, card.localId);
      const imageSmall = img.small || null;
      const imageLarge = img.large || null;
      const { error } = await supabase
        .from('collections')
        .insert({
          user_id: u.user.id,
          binder_id: bulk.id,
          card_id: card.id,
          card_name: card.name,
          set_id: card.setId,
          set_name: card.setName,
          card_number: card.localId,
          rarity: card.rarity ?? null,
          image_small: imageSmall,
          image_large: imageLarge,
          status: 'have',
          condition: 'NM',
          position: nextPos,
        });
      if (error) throw error;
      return { binderId: bulk.id };
    },
    onSuccess: ({ binderId }) => {
      qc.invalidateQueries({ queryKey: KEY.collection });
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: KEY.binder(binderId) });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(binderId) });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Master-set tracking
// ─────────────────────────────────────────────────────────────

/** Set ids the signed-in user is mastering. */
export function useMasteringSets() {
  return useQuery<string[]>({
    queryKey: ['mastering-sets'],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from('user_mastering_sets')
        .select('set_id')
        .eq('user_id', u.user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => r.set_id as string);
    },
    staleTime: 1000 * 60,
  });
}

/** Add or remove a set from the mastering list. */
export function useToggleMastering() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ setId, mastering }: { setId: string; mastering: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Sign in to track sets');
      if (mastering) {
        const { error } = await supabase
          .from('user_mastering_sets')
          .insert({ user_id: u.user.id, set_id: setId });
        if (error && (error as { code?: string }).code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('user_mastering_sets')
          .delete()
          .eq('user_id', u.user.id)
          .eq('set_id', setId);
        if (error) throw error;
      }
      return { setId, mastering };
    },
    onMutate: async ({ setId, mastering }) => {
      await qc.cancelQueries({ queryKey: ['mastering-sets'] });
      const prev = qc.getQueryData<string[]>(['mastering-sets']) ?? [];
      qc.setQueryData<string[]>(
        ['mastering-sets'],
        mastering ? [...prev, setId] : prev.filter((id) => id !== setId),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['mastering-sets'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['mastering-sets'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Master-set variants — which printings exist per card, and per-variant
// ownership check-offs. Mirrors the card_meta pattern: memory cache →
// shared card_variants table → TCGdex (throttled), with write-back.
// ─────────────────────────────────────────────────────────────

const variantsMemCache = new Map<string, CardVariantsInfo>();
const VARIANTS_CONCURRENCY = 6;

interface SetVariantsState {
  /** null while resolution is running. */
  variants: Map<string, CardVariantsInfo> | null;
  /** Non-null only while cards are being fetched from TCGdex. */
  progress: { done: number; total: number } | null;
  error: string | null;
}

/** Resolve variant info for a list of card ids. An empty list keeps the
 *  hook dormant, so browsing a set doesn't trigger hundreds of fetches. */
export function useSetVariants(cardIds: string[], locale: Locale = 'en'): SetVariantsState {
  // `forKey` pins the state to the id list it was computed for; without it a
  // level switch briefly exposes the previous request's map and the grid flashes.
  const [state, setState] = useState<SetVariantsState & { forKey: string }>({
    forKey: '', variants: null, progress: null, error: null,
  });
  const key = useMemo(() => [...new Set(cardIds)].sort().join(','), [cardIds]);

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setState({ forKey: key, variants: new Map(), progress: null, error: null });
      return;
    }
    setState({ forKey: key, variants: null, progress: null, error: null });

    (async () => {
      try {
        const out = new Map<string, CardVariantsInfo>();
        let missing: string[] = [];
        for (const id of ids) {
          const hit = variantsMemCache.get(id);
          if (hit) out.set(id, hit);
          else missing.push(id);
        }

        // Shared cache lookup, chunked to keep the .in() URL reasonable.
        // Best-effort: on failure, anything still missing fetches from TCGdex.
        if (missing.length) {
          try {
            const stillMissing: string[] = [];
            for (let i = 0; i < missing.length; i += DB_CHUNK) {
              const chunk = missing.slice(i, i + DB_CHUNK);
              const { data, error } = await supabase
                .from('card_variants')
                .select('card_id,variants,variants_detailed')
                .in('card_id', chunk);
              if (error) throw error;
              const found = new Set<string>();
              for (const row of (data ?? []) as CardVariantsInfo[]) {
                out.set(row.card_id, row);
                variantsMemCache.set(row.card_id, row);
                found.add(row.card_id);
              }
              for (const id of chunk) if (!found.has(id)) stillMissing.push(id);
            }
            missing = stillMissing;
          } catch {
            missing = missing.filter((id) => !out.has(id));
          }
        }

        // Cold path: TCGdex, a few at a time, with live progress.
        if (missing.length) {
          let done = 0;
          if (!cancelled) setState({ forKey: key, variants: null, progress: { done, total: missing.length }, error: null });
          const fetched: CardVariantsInfo[] = [];
          let next = 0;
          const worker = async () => {
            while (next < missing.length && !cancelled) {
              const id = missing[next++];
              try {
                const info = await getCardVariants(id, locale);
                fetched.push(info);
                out.set(id, info);
                variantsMemCache.set(id, info);
              } catch {
                // Transient failure: usable this session but not persisted,
                // so the next run retries instead of caching a false miss.
                out.set(id, { card_id: id, variants: null, variants_detailed: null });
              }
              done++;
              if (!cancelled) setState({ forKey: key, variants: null, progress: { done, total: missing.length }, error: null });
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(VARIANTS_CONCURRENCY, missing.length) }, worker),
          );

          // Best-effort write-back; the grid must still work when the
          // shared cache can't be written.
          try {
            for (let i = 0; i < fetched.length; i += DB_CHUNK) {
              const chunk = fetched.slice(i, i + DB_CHUNK);
              await supabase.from('card_variants').upsert(chunk, { onConflict: 'card_id' });
            }
          } catch {
            // Next session re-fetches from TCGdex; nothing user-facing.
          }
        }

        if (!cancelled) setState({ forKey: key, variants: out, progress: null, error: null });
      } catch (e) {
        if (!cancelled) {
          setState({
            forKey: key, variants: null, progress: null,
            error: e instanceof Error ? e.message : 'Variant lookup failed',
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [key, locale]);

  if (state.forKey !== key) return { variants: null, progress: null, error: null };
  return { variants: state.variants, progress: state.progress, error: state.error };
}

/** Checking on inserts one 'have' row into the bulk binder; checking off
 *  deletes one matching row, preferring a bulk-binder copy so curated
 *  binder layouts are never disturbed. */
export function useToggleVariantOwned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      card, variantKey, owned, fallbackKeys,
    }: {
      card: {
        id: string;
        name: string;
        localId: string;
        image?: string;
        rarity?: string;
        setId: string;
        setName: string;
      };
      variantKey: string;
      owned: boolean; // desired state
      /** Extra variant keys that also satisfy this slot; rows tagged 'normal'
       *  can count toward the base printing of cards without a Normal printing. */
      fallbackKeys?: string[];
    }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Sign in to track variants');

      if (owned) {
        const bulk = await getOrCreateBulkBinder(u.user.id);
        const { data: last, error: posErr } = await supabase
          .from('collections')
          .select('position')
          .eq('binder_id', bulk.id)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (posErr) throw posErr;
        const img = cardImages(card.image, card.setId, card.localId);
        const { error } = await supabase.from('collections').insert({
          user_id: u.user.id,
          binder_id: bulk.id,
          card_id: card.id,
          card_name: card.name,
          set_id: card.setId,
          set_name: card.setName,
          card_number: card.localId,
          rarity: card.rarity ?? null,
          image_small: img.small || null,
          image_large: img.large || null,
          status: 'have',
          condition: 'NM',
          variant: variantKey,
          position: (last?.position ?? -1) + 1,
        });
        if (error) throw error;
        return { binderId: bulk.id };
      }

      const searchKeys = [variantKey, ...(fallbackKeys ?? [])];
      const { data: rows, error } = await supabase
        .from('collections')
        .select('id,binder_id,variant,added_at')
        .eq('user_id', u.user.id)
        .eq('card_id', card.id)
        .in('variant', searchKeys)
        .eq('status', 'have')
        .order('added_at', { ascending: false });
      if (error) throw error;
      // Prefer an exact-variant row; use fallback keys only when the slot's
      // own key has no rows left.
      let candidates: NonNullable<typeof rows> = [];
      for (const k of searchKeys) {
        candidates = (rows ?? []).filter((r) => r.variant === k);
        if (candidates.length) break;
      }
      if (!candidates.length) return { binderId: null };
      const { data: bulk } = await supabase
        .from('binders')
        .select('id')
        .eq('user_id', u.user.id)
        .eq('is_bulk', true)
        .maybeSingle();
      const target = candidates.find((r) => r.binder_id === bulk?.id) ?? candidates[0];
      const { error: dErr } = await supabase.from('collections').delete().eq('id', target.id);
      if (dErr) throw dErr;
      return { binderId: target.binder_id as string };
    },
    onMutate: async ({ card, variantKey, owned, fallbackKeys }) => {
      // Optimistic flip in the collection cache; the checklist derives
      // ownership from these rows.
      await qc.cancelQueries({ queryKey: KEY.collection });
      const prev = qc.getQueryData<CollectionRow[]>(KEY.collection);
      if (prev) {
        if (owned) {
          const img = cardImages(card.image, card.setId, card.localId);
          const now = new Date().toISOString();
          const optimistic: CollectionRow = {
            id: `optimistic-${card.id}-${variantKey}-${Date.now()}`,
            user_id: '', binder_id: '',
            card_id: card.id, card_name: card.name,
            set_id: card.setId, set_name: card.setName,
            card_number: card.localId,
            rarity: card.rarity ?? null, card_type: null,
            image_small: img.small || null, image_large: img.large || null,
            status: 'have', quantity: 1, condition: 'NM',
            variant: variantKey, notes: null,
            last_price_eur: null, price_checked_at: null,
            position: 0, added_at: now, updated_at: now,
          };
          qc.setQueryData<CollectionRow[]>(KEY.collection, [optimistic, ...prev]);
        } else {
          let idx = -1;
          for (const k of [variantKey, ...(fallbackKeys ?? [])]) {
            idx = prev.findIndex(
              (r) => r.card_id === card.id
                && (r.variant ?? 'normal') === k
                && r.status === 'have',
            );
            if (idx >= 0) break;
          }
          if (idx >= 0) {
            qc.setQueryData<CollectionRow[]>(
              KEY.collection,
              [...prev.slice(0, idx), ...prev.slice(idx + 1)],
            );
          }
        }
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY.collection, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['collection'] });
      qc.invalidateQueries({ queryKey: KEY.binders });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Copy a page from a public binder into one of the signed-in user's
// binders as a new page at the end.
// ─────────────────────────────────────────────────────────────
export function useCopyPageToMyBinder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sourceCards,
      targetBinderId,
      status = 'want',
    }: {
      sourceCards: CollectionRow[];
      targetBinderId: string;
      status?: Status;
    }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Sign in to copy');

      const { data: targetBinder, error: bErr } = await supabase
        .from('binders')
        .select('*')
        .eq('id', targetBinderId)
        .eq('user_id', u.user.id)
        .maybeSingle();
      if (bErr) throw bErr;
      if (!targetBinder) throw new Error('Target binder not found');

      const slotsPerPage = targetBinder.grid_cols * targetBinder.grid_rows;
      const { data: lastPage, error: pErr } = await supabase
        .from('binder_pages')
        .select('page_index')
        .eq('binder_id', targetBinderId)
        .order('page_index', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pErr) throw pErr;
      const nextPageIdx = (lastPage?.page_index ?? -1) + 1;

      // Re-flow the source cards into target-sized pages, preserving reading
      // order; a larger source grid spills into additional pages.
      const ordered = [...sourceCards].sort((a, b) => a.position - b.position);
      const pagesNeeded = Math.max(1, Math.ceil(ordered.length / slotsPerPage));
      const newPageRows = Array.from({ length: pagesNeeded }, (_, i) => ({
        binder_id: targetBinderId,
        page_index: nextPageIdx + i,
      }));
      const { error: newPageErr } = await supabase
        .from('binder_pages')
        .insert(newPageRows);
      if (newPageErr) throw newPageErr;

      const rows = ordered.map((c, i) => {
        const pageOffset = Math.floor(i / slotsPerPage);
        const localPos = i % slotsPerPage;
        return {
          user_id: u.user.id,
          binder_id: targetBinderId,
          card_id: c.card_id,
          card_name: c.card_name,
          set_id: c.set_id,
          set_name: c.set_name,
          card_number: c.card_number,
          rarity: c.rarity,
          card_type: c.card_type,
          image_small: c.image_small,
          image_large: c.image_large,
          status,
          condition: 'NM',
          ...(c.variant != null ? { variant: c.variant } : {}),
          last_price_eur: c.last_price_eur,
          price_checked_at: c.price_checked_at,
          position: (nextPageIdx + pageOffset) * slotsPerPage + localPos,
        };
      });

      // Duplicates are allowed; the same card can sit in multiple slots.
      let inserted = 0;
      if (rows.length > 0) {
        const { data, error } = await supabase
          .from('collections')
          .insert(rows)
          .select('id');
        if (error) throw error;
        inserted = data?.length ?? 0;
      }
      return {
        targetBinderId,
        pageIdx: nextPageIdx,
        pagesAdded: pagesNeeded,
        inserted,
      };
    },
    onSuccess: ({ targetBinderId }) => {
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: KEY.binder(targetBinderId) });
      qc.invalidateQueries({ queryKey: KEY.binderPages(targetBinderId) });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(targetBinderId) });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

/** Clone an owned binder: same grid, pages, and cards with fields preserved.
 *  The bulk binder is a per-user singleton and can't be duplicated. */
export function useDuplicateBinder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (binderId: string): Promise<Binder> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in');

      const [srcRes, pagesRes, cardsRes] = await Promise.all([
        supabase.from('binders').select('*').eq('id', binderId).eq('user_id', u.user.id).maybeSingle(),
        supabase.from('binder_pages').select('*').eq('binder_id', binderId).order('page_index'),
        supabase.from('collections').select('*').eq('binder_id', binderId).eq('user_id', u.user.id).order('position'),
      ]);
      if (srcRes.error) throw srcRes.error;
      if (!srcRes.data) throw new Error('Binder not found');
      if (pagesRes.error) throw pagesRes.error;
      if (cardsRes.error) throw cardsRes.error;
      const src = srcRes.data as Binder;
      if (src.is_bulk) throw new Error('The bulk binder can\'t be duplicated.');

      const { data: dup, error: bErr } = await supabase
        .from('binders')
        .insert({
          user_id: u.user.id,
          name: `${src.name} (copy)`,
          grid_cols: src.grid_cols,
          grid_rows: src.grid_rows,
        })
        .select()
        .single();
      if (bErr) throw bErr;

      const pages = (pagesRes.data ?? []) as BinderPage[];
      const pageRows = (pages.length > 0 ? pages : [{ page_index: 0, title: null }])
        .map((p) => ({ binder_id: dup.id, page_index: p.page_index, title: p.title }));
      const { error: pErr } = await supabase.from('binder_pages').insert(pageRows);
      if (pErr) throw pErr;

      const cards = (cardsRes.data ?? []) as CollectionRow[];
      if (cards.length > 0) {
        const cardRows = cards.map((c) => ({
          user_id: u.user!.id,
          binder_id: dup.id,
          card_id: c.card_id,
          card_name: c.card_name,
          set_id: c.set_id,
          set_name: c.set_name,
          card_number: c.card_number,
          rarity: c.rarity,
          card_type: c.card_type,
          image_small: c.image_small,
          image_large: c.image_large,
          status: c.status,
          condition: c.condition,
          quantity: c.quantity,
          ...(c.variant != null ? { variant: c.variant } : {}),
          notes: c.notes,
          last_price_eur: c.last_price_eur,
          price_checked_at: c.price_checked_at,
          position: c.position,
        }));
        const { error: cErr } = await supabase.from('collections').insert(cardRows);
        if (cErr) throw cErr;
      }
      return dup as Binder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

/** Copy rows into a target binder as new rows at the end, preserving their
 *  fields. Source rows stay in place. */
export function useCopyCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rowIds, targetBinderId,
    }: { rowIds: string[]; targetBinderId: string }) => {
      if (rowIds.length === 0) return { copied: 0, targetBinderId };
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in');

      const { data: src, error: srcErr } = await supabase
        .from('collections')
        .select('*')
        .in('id', rowIds)
        .eq('user_id', u.user.id)
        .order('position');
      if (srcErr) throw srcErr;
      const sources = (src ?? []) as CollectionRow[];

      const { data: last, error: posErr } = await supabase
        .from('collections')
        .select('position')
        .eq('binder_id', targetBinderId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (posErr) throw posErr;
      const startPos = (last?.position ?? -1) + 1;

      const rows = sources.map((c, i) => ({
        user_id: u.user!.id,
        binder_id: targetBinderId,
        card_id: c.card_id,
        card_name: c.card_name,
        set_id: c.set_id,
        set_name: c.set_name,
        card_number: c.card_number,
        rarity: c.rarity,
        card_type: c.card_type,
        image_small: c.image_small,
        image_large: c.image_large,
        status: c.status,
        condition: c.condition,
        quantity: c.quantity,
        ...(c.variant != null ? { variant: c.variant } : {}),
        notes: c.notes,
        last_price_eur: c.last_price_eur,
        price_checked_at: c.price_checked_at,
        position: startPos + i,
      }));
      const { error } = await supabase.from('collections').insert(rows);
      if (error) throw error;
      await ensureBinderHasSpace(targetBinderId);
      return { copied: rows.length, targetBinderId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.collection });
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: ['binder'] });
      qc.invalidateQueries({ queryKey: ['collection', 'binder'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// .pkbinder export / import
// ─────────────────────────────────────────────────────────────

/** Build a .pkbinder JSON string for an owned binder: binder + pages + cards. */
export function useExportBinder() {
  return useMutation({
    mutationFn: async (binderId: string): Promise<{
      json: string;
      name: string;
    }> => {
      const { serializeBinder } = await import('./pkbinder');
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in');
      const [binderRes, pagesRes, cardsRes] = await Promise.all([
        supabase.from('binders').select('*').eq('id', binderId).eq('user_id', u.user.id).maybeSingle(),
        supabase.from('binder_pages').select('*').eq('binder_id', binderId).order('page_index'),
        supabase.from('collections').select('*').eq('binder_id', binderId).eq('user_id', u.user.id).order('position'),
      ]);
      if (binderRes.error) throw binderRes.error;
      if (!binderRes.data) throw new Error('Binder not found');
      if (pagesRes.error) throw pagesRes.error;
      if (cardsRes.error) throw cardsRes.error;
      const binder = binderRes.data as Binder;
      const json = serializeBinder(
        binder,
        (pagesRes.data ?? []) as BinderPage[],
        (cardsRes.data ?? []) as CollectionRow[],
        new Date().toISOString(),
      );
      return { json, name: binder.name };
    },
  });
}

/** Recreate a binder from a parsed .pkbinder payload. Always creates a
 *  fresh binder; never merges into an existing one. */
export function useImportBinder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      cols: number;
      rows: number;
      pages: Array<{ title: string | null }>;
      cards: Array<{
        card_id: string;
        card_name: string;
        set_id: string;
        set_name: string;
        card_number: string;
        rarity: string | null;
        card_type: string | null;
        image_small: string | null;
        image_large: string | null;
        status: Status;
        condition: string;
        quantity: number;
        variant?: string | null;
        notes: string | null;
        position: number;
      }>;
    }): Promise<Binder> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Not signed in');

      const { data: binder, error: bErr } = await supabase
        .from('binders')
        .insert({
          user_id: u.user.id,
          name: payload.name,
          grid_cols: payload.cols,
          grid_rows: payload.rows,
        })
        .select()
        .single();
      if (bErr) throw bErr;

      // Take the longer of file pages and pages implied by max card position,
      // so every card has a page row above it.
      const slotsPerPage = payload.cols * payload.rows;
      const maxPos = payload.cards.reduce((m, c) => Math.max(m, c.position), -1);
      const cardPages = maxPos >= 0 ? Math.floor(maxPos / slotsPerPage) + 1 : 0;
      const pageCount = Math.max(1, payload.pages.length, cardPages);
      const pageRows = Array.from({ length: pageCount }, (_, i) => ({
        binder_id: binder.id,
        page_index: i,
        title: payload.pages[i]?.title ?? null,
      }));
      const { error: pErr } = await supabase.from('binder_pages').insert(pageRows);
      if (pErr) throw pErr;

      if (payload.cards.length > 0) {
        const cardRows = payload.cards.map((c) => ({
          user_id: u.user!.id,
          binder_id: binder.id,
          card_id: c.card_id,
          card_name: c.card_name,
          set_id: c.set_id,
          set_name: c.set_name,
          card_number: c.card_number,
          rarity: c.rarity,
          card_type: c.card_type,
          image_small: c.image_small,
          image_large: c.image_large,
          status: c.status,
          condition: c.condition,
          quantity: c.quantity,
          ...(c.variant != null ? { variant: c.variant } : {}),
          notes: c.notes,
          position: c.position,
        }));
        const { error: cErr } = await supabase.from('collections').insert(cardRows);
        if (cErr) throw cErr;
      }
      return binder as Binder;
    },
    onSuccess: (binder) => {
      qc.invalidateQueries({ queryKey: KEY.binders });
      qc.invalidateQueries({ queryKey: KEY.binder(binder.id) });
      qc.invalidateQueries({ queryKey: KEY.binderPages(binder.id) });
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(binder.id) });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Likes
// ─────────────────────────────────────────────────────────────

/** Whether the signed-in user has liked a binder; false when signed out. */
export function useDidILikeBinder(binderId: string | undefined) {
  return useQuery<boolean>({
    queryKey: ['liked-binder', binderId],
    enabled: !!binderId,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data, error } = await supabase
        .from('binder_likes')
        .select('binder_id')
        .eq('binder_id', binderId!)
        .eq('user_id', u.user.id)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    staleTime: 1000 * 30,
  });
}

/** Toggle like on a binder. Optimistically updates the liked-state query
 *  and the cached likes_count on any binder-bundle query in cache. */
export function useToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ binderId, like }: { binderId: string; like: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Sign in to like binders');
      if (like) {
        const { error } = await supabase
          .from('binder_likes')
          .insert({ binder_id: binderId, user_id: u.user.id });
        // 23505 = duplicate key; treat as already-liked, not an error.
        if (error && (error as { code?: string }).code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('binder_likes')
          .delete()
          .eq('binder_id', binderId)
          .eq('user_id', u.user.id);
        if (error) throw error;
      }
      return { binderId, like };
    },
    onMutate: async ({ binderId, like }) => {
      await qc.cancelQueries({ queryKey: ['liked-binder', binderId] });
      const prev = qc.getQueryData<boolean>(['liked-binder', binderId]);
      qc.setQueryData(['liked-binder', binderId], like);
      // Optimistically bump counts on any cached bundle.
      const adjustBundle = (key: readonly unknown[]) => {
        const data = qc.getQueryData<{
          binder: Binder;
          pages: BinderPage[];
          cards: CollectionRow[];
        } | null>(key);
        if (data?.binder?.id === binderId) {
          qc.setQueryData(key, {
            ...data,
            binder: {
              ...data.binder,
              likes_count: Math.max(0, data.binder.likes_count + (like ? 1 : -1)),
            },
          });
        }
      };
      qc.getQueryCache().findAll({ queryKey: ['public-binder'] }).forEach((q) => adjustBundle(q.queryKey));
      qc.getQueryCache().findAll({ queryKey: ['binder-by-token'] }).forEach((q) => adjustBundle(q.queryKey));
      return { prev };
    },
    onError: (_e, { binderId }, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['liked-binder', binderId], ctx.prev);
      qc.invalidateQueries({ queryKey: ['public-binder', binderId] });
      qc.invalidateQueries({ queryKey: ['binder-by-token'] });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['public-profile'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Curator — card-facts enrichment + applying page ideas
// ─────────────────────────────────────────────────────────────

/** Session-wide facts cache so revisiting the ideas screen is instant. */
const factsMemCache = new Map<string, CardFacts>();
const ENRICH_CONCURRENCY = 4;
const DB_CHUNK = 150;

interface CardFactsState {
  /** null while enrichment is running. */
  facts: Map<string, CardFacts> | null;
  /** Non-null only while cards are being fetched from TCGdex. */
  progress: { done: number; total: number } | null;
  error: string | null;
}

/** Resolve CardFacts for card ids: memory, then the shared card_meta table,
 *  then TCGdex, with write-back so each card is fetched once globally. */
export function useCardFacts(cardIds: string[]): CardFactsState {
  const [state, setState] = useState<CardFactsState>({ facts: null, progress: null, error: null });
  const key = useMemo(() => [...new Set(cardIds)].sort().join(','), [cardIds]);

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setState({ facts: new Map(), progress: null, error: null });
      return;
    }
    setState({ facts: null, progress: null, error: null });

    (async () => {
      try {
        const out = new Map<string, CardFacts>();
        let missing: string[] = [];
        for (const id of ids) {
          const hit = factsMemCache.get(id);
          if (hit) out.set(id, hit);
          else missing.push(id);
        }

        // Shared cache lookup, chunked to keep the .in() URL reasonable.
        if (missing.length) {
          const stillMissing: string[] = [];
          for (let i = 0; i < missing.length; i += DB_CHUNK) {
            const chunk = missing.slice(i, i + DB_CHUNK);
            const { data, error } = await supabase
              .from('card_meta')
              .select('card_id,category,dex_ids,stage,evolve_from,illustrator,palette')
              .in('card_id', chunk);
            if (error) throw error;
            const found = new Set<string>();
            for (const row of (data ?? []) as CardFacts[]) {
              out.set(row.card_id, row);
              factsMemCache.set(row.card_id, row);
              found.add(row.card_id);
            }
            for (const id of chunk) if (!found.has(id)) stillMissing.push(id);
          }
          missing = stillMissing;
        }

        // Cold path: TCGdex, a few at a time, with live progress.
        if (missing.length) {
          let done = 0;
          if (!cancelled) setState({ facts: null, progress: { done, total: missing.length }, error: null });
          const fetched: CardFacts[] = [];
          let next = 0;
          const worker = async () => {
            while (next < missing.length && !cancelled) {
              const id = missing[next++];
              try {
                const facts = await getCardFacts(id);
                fetched.push(facts);
                out.set(id, facts);
                factsMemCache.set(id, facts);
              } catch {
                // Transient failure: usable this session but not persisted,
                // so the next run retries instead of caching a false miss.
                const blank: CardFacts = {
                  card_id: id, category: null, dex_ids: null,
                  stage: null, evolve_from: null, illustrator: null, palette: null,
                };
                out.set(id, blank);
              }
              done++;
              if (!cancelled) setState({ facts: null, progress: { done, total: missing.length }, error: null });
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(ENRICH_CONCURRENCY, missing.length) }, worker),
          );

          // Best-effort write-back; the ideas still render if this fails.
          for (let i = 0; i < fetched.length; i += DB_CHUNK) {
            const chunk = fetched.slice(i, i + DB_CHUNK);
            await supabase.from('card_meta').upsert(chunk, { onConflict: 'card_id' });
          }
        }

        if (!cancelled) setState({ facts: out, progress: null, error: null });
      } catch (e) {
        if (!cancelled) {
          setState({
            facts: null, progress: null,
            error: e instanceof Error ? e.message : 'Enrichment failed',
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [key]);

  return state;
}

/** Batch size for the card-palette Edge Function (its own cap is 30). */
const PALETTE_CHUNK = 25;

/** For cards whose facts lack a palette, the card-palette Edge Function
 *  extracts one and persists it to card_meta. Pass null while facts load. */
export function useCardPalettes(
  items: { card_id: string; image: string }[] | null,
): { palettes: Map<string, PaletteEntry[]>; pending: number } {
  const [state, setState] = useState<{
    palettes: Map<string, PaletteEntry[]>;
    pending: number;
  }>({ palettes: new Map(), pending: 0 });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const key = useMemo(
    () => (items ? [...new Set(items.map((i) => i.card_id))].sort().join(',') : ''),
    [items],
  );

  useEffect(() => {
    if (!key) {
      setState({ palettes: new Map(), pending: 0 });
      return;
    }
    const wanted = new Set(key.split(','));
    const seen = new Set<string>();
    const list = (itemsRef.current ?? []).filter((i) => {
      if (!wanted.has(i.card_id) || seen.has(i.card_id)) return false;
      seen.add(i.card_id);
      return true;
    });
    let cancelled = false;
    setState({ palettes: new Map(), pending: list.length });

    (async () => {
      const out = new Map<string, PaletteEntry[]>();
      for (let i = 0; i < list.length; i += PALETTE_CHUNK) {
        if (cancelled) return;
        const chunk = list.slice(i, i + PALETTE_CHUNK);
        try {
          const { data, error } = await supabase.functions.invoke('card-palette', {
            body: { cards: chunk },
          });
          if (!error && data?.palettes) {
            for (const [id, pal] of Object.entries(data.palettes as Record<string, PaletteEntry[]>)) {
              out.set(id, pal);
              const f = factsMemCache.get(id);
              if (f) factsMemCache.set(id, { ...f, palette: pal });
            }
          }
        } catch {
          // Extraction is a nice-to-have; a failed chunk just means those
          // cards sit out the colour archetypes this session.
        }
        if (!cancelled) {
          setState({
            palettes: new Map(out),
            pending: Math.max(0, list.length - (i + chunk.length)),
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [key]);

  return state;
}

/** Session cache of panorama pair verdicts; -1 marks a pair whose
 *  computation failed this session (retried next session, not this one). */
const pairScoreMemCache = new Map<string, number>();
const PAIR_CHUNK = 8;

/** Resolve edge-continuity scores for candidate pairs: card_pairs table first,
 *  then the card-panorama Edge Function. Pass null while ideas are generating. */
export function useCardPairScores(
  pairs: import('./curator').PanoramaPairReq[] | null,
): { pairScores: Map<string, number>; pending: number } {
  const [state, setState] = useState<{
    pairScores: Map<string, number>;
    pending: number;
  }>({ pairScores: new Map(), pending: 0 });
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  const key = useMemo(
    () => (pairs?.length ? pairs.map((p) => p.key).sort().join(';') : ''),
    [pairs],
  );

  useEffect(() => {
    if (!key) return; // keep previously resolved scores visible
    let cancelled = false;
    const list = pairsRef.current ?? [];
    const out = new Map<string, number>();
    const unknown = list.filter((p) => {
      const hit = pairScoreMemCache.get(p.key);
      if (hit !== undefined) {
        out.set(p.key, hit);
        return false;
      }
      return true;
    });
    setState((s) => ({
      pairScores: new Map([...s.pairScores, ...out]),
      pending: unknown.length,
    }));
    if (!unknown.length) return;

    (async () => {
      // Cached verdicts from other users / sessions.
      const { data } = await supabase
        .from('card_pairs')
        .select('left_id,right_id,score')
        .in('left_id', unknown.map((p) => p.left.card_id));
      const wanted = new Map(unknown.map((p) => [p.key, p]));
      for (const row of (data ?? []) as { left_id: string; right_id: string; score: number }[]) {
        const k = `${row.left_id}|${row.right_id}`;
        if (wanted.has(k)) {
          out.set(k, row.score);
          pairScoreMemCache.set(k, row.score);
          wanted.delete(k);
        }
      }
      const toCompute = [...wanted.values()];
      if (!cancelled) {
        setState((s) => ({
          pairScores: new Map([...s.pairScores, ...out]),
          pending: toCompute.length,
        }));
      }

      for (let i = 0; i < toCompute.length; i += PAIR_CHUNK) {
        if (cancelled) return;
        const chunk = toCompute.slice(i, i + PAIR_CHUNK);
        try {
          const { data: res, error } = await supabase.functions.invoke('card-panorama', {
            body: { pairs: chunk.map(({ left, right }) => ({ left, right })) },
          });
          const scores = (!error && res?.scores) ? res.scores as Record<string, number> : {};
          for (const p of chunk) {
            const s = scores[p.key] ?? -1;
            out.set(p.key, s);
            pairScoreMemCache.set(p.key, s);
          }
        } catch {
          for (const p of chunk) {
            out.set(p.key, -1);
            pairScoreMemCache.set(p.key, -1);
          }
        }
        if (!cancelled) {
          setState((s) => ({
            pairScores: new Map([...s.pairScores, ...out]),
            pending: Math.max(0, toCompute.length - (i + chunk.length)),
          }));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [key]);

  return state;
}

export interface AppliedIdea {
  pageId: string;
  pageIndex: number;
  prev: { id: string; position: number }[];
}

/** Apply a Curator idea: append a titled page and move the idea's cards into
 *  its slots. Returns everything undo needs. */
export function useApplyIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      binderId, title, moveRowIds, slotOffsets, slotsPerPage,
    }: {
      binderId: string;
      title: string;
      moveRowIds: string[];
      slotOffsets: number[];
      slotsPerPage: number;
    }): Promise<AppliedIdea> => {
      // Snapshot positions for undo, and as a staleness check: bail if a row
      // moved or was removed since the ideas were generated.
      const { data: prevRows, error: prevErr } = await supabase
        .from('collections')
        .select('id,position')
        .in('id', moveRowIds)
        .eq('binder_id', binderId);
      if (prevErr) throw prevErr;
      if ((prevRows?.length ?? 0) !== moveRowIds.length) {
        throw new Error('Some of these cards changed since the ideas were made — pull to refresh.');
      }

      const [{ data: lastPage, error: pErr }, { data: lastCard, error: cErr }] = await Promise.all([
        supabase.from('binder_pages').select('page_index').eq('binder_id', binderId)
          .order('page_index', { ascending: false }).limit(1),
        supabase.from('collections').select('position').eq('binder_id', binderId)
          .order('position', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (pErr) throw pErr;
      if (cErr) throw cErr;
      // Land past both the last page row and the last occupied slot; the two
      // can disagree when binder_pages lags behind sparse positions.
      const pageIndex = Math.max(
        (lastPage?.[0]?.page_index ?? -1) + 1,
        Math.ceil(((lastCard?.position ?? -1) + 1) / slotsPerPage),
      );

      const { data: pageRow, error: insErr } = await supabase
        .from('binder_pages')
        .insert({ binder_id: binderId, page_index: pageIndex, title })
        .select('id')
        .single();
      if (insErr) throw insErr;

      const positions = slotOffsets.map((off) => pageIndex * slotsPerPage + off);
      const { data: affected, error: rErr } = await supabase.rpc('reorder_cards_swap', {
        binder: binderId,
        ids: moveRowIds,
        positions,
      });
      if (rErr || (typeof affected === 'number' && affected !== moveRowIds.length)) {
        // Clean up the orphan page before surfacing the failure.
        await supabase.from('binder_pages').delete().eq('id', pageRow.id);
        throw rErr ?? new Error('Not every card could be moved — refresh and retry.');
      }

      return {
        pageId: pageRow.id as string,
        pageIndex,
        prev: (prevRows ?? []) as { id: string; position: number }[],
      };
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}

/** Reverse a just-applied idea: cards back to their old slots, page deleted.
 *  The applied page is always the last one and ends up empty. */
export function useUndoApplyIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      binderId, applied,
    }: { binderId: string; applied: AppliedIdea }) => {
      const { error: rErr } = await supabase.rpc('reorder_cards_swap', {
        binder: binderId,
        ids: applied.prev.map((p) => p.id),
        positions: applied.prev.map((p) => p.position),
      });
      if (rErr) throw rErr;
      const { error: dErr } = await supabase
        .from('binder_pages')
        .delete()
        .eq('id', applied.pageId);
      if (dErr) throw dErr;
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: KEY.collectionByBinder(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) });
      qc.invalidateQueries({ queryKey: KEY.collection });
    },
  });
}
