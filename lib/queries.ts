// React-Query hooks wrapping Supabase + PokemonTCG.io.
// All collection mutations are optimistic; the query cache is the source
// of truth between fetches.

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { supabase } from './supabase';
import { searchCards, getCard, getSets, TcgdexBrief, TcgdexSet } from './tcgdex';
import {
  Binder,
  BinderPage,
  CollectionRow,
  Status,
  TcgCard,
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
      const { data, error } = await supabase
        .from('binders')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as Binder[];
    },
  });
}

export function useBinder(binderId: string | undefined) {
  return useQuery({
    queryKey: KEY.binder(binderId ?? ''),
    enabled: !!binderId,
    queryFn: async (): Promise<Binder | null> => {
      if (!binderId) return null;
      const { data, error } = await supabase
        .from('binders')
        .select('*')
        .eq('id', binderId)
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
    mutationFn: async (input: { binderId: string; title?: string | null }) => {
      const { data: existing, error: pErr } = await supabase
        .from('binder_pages')
        .select('page_index')
        .eq('binder_id', input.binderId)
        .order('page_index', { ascending: false })
        .limit(1);
      if (pErr) throw pErr;
      const next = (existing?.[0]?.page_index ?? -1) + 1;
      const { error } = await supabase
        .from('binder_pages')
        .insert({ binder_id: input.binderId, page_index: next, title: input.title ?? null });
      if (error) throw error;
    },
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: KEY.binderPages(vars.binderId) }),
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
      const { data, error } = await supabase
        .from('collections')
        .select('*')
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
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('binder_id', binderId)
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
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('card_id', cardId)
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
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('card_id', cardId);
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
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('id', rowId)
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
  const [{ data: binder }, { data: pages }, { count }] = await Promise.all([
    supabase.from('binders').select('grid_cols,grid_rows').eq('id', binderId).single(),
    supabase.from('binder_pages').select('page_index').eq('binder_id', binderId)
      .order('page_index', { ascending: false }).limit(1),
    supabase.from('collections').select('*', { count: 'exact', head: true }).eq('binder_id', binderId),
  ]);
  if (!binder || count == null) return;
  const slotsPerPage = binder.grid_cols * binder.grid_rows;
  const pagesNeeded = Math.max(1, Math.ceil(count / slotsPerPage));
  const currentMaxIdx = pages?.[0]?.page_index ?? -1;
  const currentPages = currentMaxIdx + 1;
  if (pagesNeeded <= currentPages) return;
  const toInsert = [];
  for (let i = currentPages; i < pagesNeeded; i++) {
    toInsert.push({ binder_id: binderId, page_index: i, title: null });
  }
  await supabase.from('binder_pages').insert(toInsert);
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
  return useQuery({
    queryKey: KEY.search(q),
    enabled: q.trim().length >= 2,
    queryFn: () => searchCards(q),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 10,
  });
}

export function useTcgCard(cardId: string | undefined) {
  return useQuery({
    queryKey: KEY.card(cardId ?? ''),
    enabled: !!cardId,
    queryFn: () => getCard(cardId!),
    staleTime: 1000 * 60 * 30,
  });
}

/** Cached list of every TCGdex set — used to resolve set names from id
 * prefixes in search results without an extra round-trip per result. */
export function useSets() {
  return useQuery({
    queryKey: KEY.sets,
    queryFn: getSets,
    staleTime: 1000 * 60 * 60 * 24,
  });
}

export type { TcgdexBrief, TcgdexSet };
