// React-Query hooks wrapping Supabase + PokemonTCG.io.
// All collection mutations are optimistic; the query cache is the source
// of truth between fetches.

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
  getSets,
  getSet,
  parseSearchQuery,
  SEARCH_ITEMS_PER_PAGE,
  TcgdexBrief,
  TcgdexSet,
  TcgdexSetDetail,
  Locale,
} from './tcgdex';
import {
  Binder,
  BinderPage,
  CollectionRow,
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
      // RLS now allows reading non-private binders cross-user (for public
      // viewing). The "my binders" list must filter explicitly to the
      // signed-in user, otherwise every public binder in the DB shows up.
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

/** Persist a new ordering of the user's binders. Caller passes a list of
 *  binder ids in the desired display order; each gets `position = index`. */
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
      // Apply the optimistic order SYNCHRONOUSLY before any await — otherwise
      // there's a microtask window between mutate() and the cache update where
      // DraggableFlatList snaps back to the prior `data` prop and the list
      // looks "chaotic" for a frame after the drop.
      const prev = qc.getQueryData<Binder[]>(KEY.binders);
      if (prev) {
        const byId = new Map(prev.map((b) => [b.id, b]));
        const next = orderedIds
          .map((id) => byId.get(id))
          .filter((b): b is Binder => !!b);
        qc.setQueryData(KEY.binders, next);
      }
      // Cancel any in-flight refetch so it can't overwrite our optimistic
      // order before the mutation commits.
      await qc.cancelQueries({ queryKey: KEY.binders });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY.binders, ctx.prev);
    },
    // Don't auto-invalidate on success — the optimistic order is already
    // correct and a refetch would briefly show the server's pre-update state
    // until the new positions land. Only refetch on error (via setQueryData
    // rollback above, which doesn't trigger a network call, but the next
    // mount/visibility change will pull fresh data anyway).
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
      // Same rationale as useBinders — restrict to the signed-in user so
      // the authed binder view can't accidentally show a public binder
      // belonging to someone else.
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
      // Insert-after: page is created at the end, then reorder_binder_page
      // shifts it (and the rows + card positions in between) into place.
      // Skip the reorder when afterIndex already points to the last slot.
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
export function useCollection() {
  return useQuery({
    queryKey: KEY.collection,
    queryFn: async (): Promise<CollectionRow[]> => {
      // RLS now lets us read cards from non-private binders cross-user.
      // The "my collection" list must stay scoped to the signed-in user.
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('user_id', u.user.id)
        .order('added_at', { ascending: false });
      if (error) throw error;
      return data as CollectionRow[];
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
      return data as CollectionRow[];
    },
  });
}

/**
 * Returns the first row found for a card_id. Used by card detail when no
 * specific instance is requested (e.g. coming from search). May return null
 * if the user owns no copies of this card.
 */
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
      return data as CollectionRow | null;
    },
  });
}

/** All rows the user owns for a given card_id (across all binders).
 * Used by the aggregate card-detail view to show a per-condition breakdown. */
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
      return (data ?? []) as CollectionRow[];
    },
  });
}

/** Look up a specific row by its UUID — used when card detail is opened
 * from a binder, action sheet, or any other context that already knows
 * exactly which instance the user tapped. */
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
      return data as CollectionRow | null;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────
/**
 * Each call adds ONE physical card instance — a fresh row at the next free
 * position in the binder. Same card_id can appear multiple times in the same
 * binder; each row carries its own status/condition.
 */
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
      // When set (empty-slot flow), insert at this exact slot. Otherwise
      // append after the highest-positioned card in the binder.
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

/**
 * Bulk-update positions in a binder. Used by drag-and-drop.
 * Pass an array of { id, position } pairs; this writes them all in one batch.
 * The binder_position_unique constraint is deferrable, so intermediate
 * collisions within the transaction are allowed.
 */
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
  // Page count MUST derive from max(position), not row count — drag-and-drop
  // and bulk moves leave sparse positions (e.g. cards at 0 and 14 with empty
  // slots in between). With count-based math the binder view would render
  // page 1 from maxPos but binder_pages wouldn't have a row for it, so the
  // page-title pill would grey out and the page menu would skip the page.
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

/** Lazy self-heal for binders whose `binder_pages` rows are out of sync
 *  with the actual card positions (a class of bug that pre-dated the move /
 *  upsert fix — sparse positions left missing pages). The binder view calls
 *  this once on mount; it's a no-op when everything's already consistent. */
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

/** Bulk-delete multiple rows in one round-trip. Used by select-multiple
 * mode in the binder view. */
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
  // Parse here (not in the component) so the query key reflects the
  // structured filters — two queries that differ only in trailing collector
  // number get separate cache entries.
  const parsed = parseSearchQuery(q);
  return useInfiniteQuery({
    queryKey: ['search', parsed.name, parsed.localId ?? ''],
    // A name fragment is searchable from 2 chars; a localId alone is a valid
    // query on its own (no minimum length).
    enabled: parsed.name.trim().length >= 2 || !!parsed.localId,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const raw = await searchCards(parsed.name, { localId: parsed.localId, page: pageParam });
      // Mirror the Sets list filter: drop cards from sets whose shortcode
      // starts with a capital letter. Card IDs are `<setId>-<localId>`, so
      // we read the prefix once and toss the row if it's an excluded set.
      const items = raw.filter((c) => !/^[A-Z]/.test(c.id));
      // `fetched` is the RAW page size from TCGdex (pre-filter). Use it for
      // pagination so getNextPageParam doesn't stop early just because the
      // filter removed enough rows to drop the visible page below 60.
      return { items, fetched: raw.length };
    },
    // Short page = we've reached the end. TCGdex returns at most
    // SEARCH_ITEMS_PER_PAGE rows per page; anything less means no next page.
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

/** Resolves the Cardmarket product URL via the cardmarket-resolve Edge
 *  Function. The result is cached for the session (per card id) — first
 *  view costs one round-trip, subsequent taps are instant. */
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

/** Send a base64 photo to the card-scan Edge Function and get ranked
 *  candidate cards back. A mutation (not a query) because each scan is a
 *  discrete user action with a fresh image — nothing to cache by key. */
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

/** Cached list of every TCGdex set. Locale-plumbing for JP is in place
 *  (sets carry an optional `locale` tag) but JP fetching is disabled for
 *  now while TCGdex's JP data has duplicate rows. Flip the comment to
 *  re-enable. */
export function useSets() {
  return useQuery<TcgdexSet[]>({
    queryKey: KEY.sets,
    queryFn: async () => {
      const en = await getSets('en');
      return en.map((x) => ({ ...x, locale: 'en' as const }));
    },
    staleTime: 1000 * 60 * 60 * 24,
  });
}

/** Full set with card list. Used by the Sets tab. `locale` defaults to
 *  'en' — pass 'ja' for Japanese sets. The query key includes locale so
 *  EN and JP variants don't clobber each other in the cache. */
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

/** Current user's profile row. Auto-created by an auth trigger, but
 *  `username` starts as null until the user picks one. */
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

/** Set / change the current user's username. Lowercase a-z, 0-9, _-, 3-24 chars.
 *  Upserts so users whose profile row was never created (auth-trigger miss,
 *  legacy imports) still succeed instead of silently no-op'ing an UPDATE. */
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

/** Find another user's profile by username — used by /u/[username] routes. */
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
      const { data: binders, error: bErr } = await supabase
        .from('binders')
        .select('*')
        .eq('user_id', profile.user_id)
        .eq('visibility', 'public')
        .order('created_at', { ascending: false });
      if (bErr) throw bErr;
      return { profile: profile as Profile, binders: (binders ?? []) as Binder[] };
    },
    staleTime: 1000 * 60,
  });
}

/** Read-only fetch of a binder for /u/[username]/binder/[id]. Returns the
 *  binder + its pages + every card, in one bundle. RLS lets us read all
 *  this because the binder's visibility is non-private. */
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
    cards: (cards ?? []) as CollectionRow[],
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
      const { data: binder, error } = await supabase
        .from('binders')
        .select('*')
        .eq('share_token', token!)
        .neq('visibility', 'private')
        .maybeSingle();
      if (error) throw error;
      if (!binder) return null;
      return fetchPublicBinderBundle(binder.id);
    },
    staleTime: 1000 * 60,
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

      // Parallel updates, each with its own sequential position so we
      // don't collide and so reading order is preserved at the target.
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
      // rows or the page menu won't show them — same invariant useUpsertCard
      // maintains. Without this, a move that crosses a page boundary leaves
      // the cards "orphaned" with no rendered page above them.
      await ensureBinderHasSpace(targetBinderId);
      return { moved: rowIds.length, targetBinderId };
    },
    onSuccess: () => {
      // Source AND target binder caches need refresh; cheapest to nuke
      // anything binder/collection scoped.
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

/** Batch version — inserts many cards into the bulk binder in one round-trip.
 *  Used by the multi-select "Add to Bulk" action on the set detail screen. */
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

      const rows = cards.map((card, i) => ({
        user_id: u.user!.id,
        binder_id: bulk.id,
        card_id: card.id,
        card_name: card.name,
        set_id: card.setId,
        set_name: card.setName,
        card_number: card.localId,
        rarity: card.rarity ?? null,
        image_small: card.image ? `${card.image}/low.webp` : null,
        image_large: card.image ? `${card.image}/high.webp` : null,
        status: 'have' as const,
        condition: 'NM',
        position: startPos + i,
      }));

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

/** Insert a card into the user's bulk binder. Used by the "I own this"
 *  button on the set detail screen — minimal card info from TCGdex brief. */
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

      // Append to bulk binder at the next free position.
      const { data: last, error: posErr } = await supabase
        .from('collections')
        .select('position')
        .eq('binder_id', bulk.id)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (posErr) throw posErr;
      const nextPos = (last?.position ?? -1) + 1;

      const imageSmall = card.image ? `${card.image}/low.webp` : null;
      const imageLarge = card.image ? `${card.image}/high.webp` : null;
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

/** Add / remove a set from the user's mastering list. */
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
// Copy a page from a public binder into one of the signed-in user's
// binders. Creates a new page at the end and inserts the source cards
// at the matching positions; duplicates (same card_id already in the
// target binder) are silently skipped via upsert+ignoreDuplicates.
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

      // Re-flow the source cards into target-sized pages, reading order
      // preserved (left-to-right, top-to-bottom). When the source grid is
      // larger than the target's, the page spills into additional new pages.
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
          last_price_eur: c.last_price_eur,
          price_checked_at: c.price_checked_at,
          position: (nextPageIdx + pageOffset) * slotsPerPage + localPos,
        };
      });

      // Plain insert — duplicates are allowed (per_instance_migration drops
      // the (user_id, binder_id, card_id) unique constraint), so the same
      // card can sit in multiple slots of the same binder.
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

// ─────────────────────────────────────────────────────────────
// .pkbinder export / import
// ─────────────────────────────────────────────────────────────

/** Build a .pkbinder JSON string for a binder the user owns. Fetches
 *  the binder, its pages, and every card row in one go — the same shape
 *  fetchPublicBinderBundle returns, but scoped to the signed-in user. */
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
 *  fresh binder owned by the signed-in user — no merge into an existing
 *  one (sidesteps name/position conflict questions entirely). */
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

      // Pages: take the longer of (file pages, pages implied by max card
      // position) so every card has a page row above it. Otherwise a file
      // missing trailing empty pages would leave cards "orphaned" in the
      // grid until ensureBinderHasSpace runs.
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

/** Whether the signed-in user has liked a given binder. Returns false
 *  when not signed in (unauth viewers see counts but can't like). */
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
