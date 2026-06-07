// TCGdex API client.
// Docs: https://tcgdex.dev
// Coverage is broader (and updated faster) than PokemonTCG.io — especially
// for the newer Mega Evolution + Pocket sets — and Cardmarket prices are
// first-class in EUR.

import type { TcgCard } from './types';

export type Locale = 'en' | 'ja';
const ROOT = 'https://api.tcgdex.net/v2';
const baseFor = (locale: Locale) => `${ROOT}/${locale}`;
const BASE = baseFor('en'); // legacy default for callers that haven't migrated

// What the /cards list endpoint returns: just enough to render a search row.
// Set name + price come from a separate /cards/{id} fetch.
export interface TcgdexBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

interface TcgdexCardmarketPricing {
  updated?: string;
  unit?: string;
  idProduct?: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
}

interface TcgdexPricing {
  cardmarket?: TcgdexCardmarketPricing | null;
  tcgplayer?: unknown | null;
}

interface TcgdexCardFull extends TcgdexBrief {
  rarity?: string;
  types?: string[];
  hp?: number;
  set: { id: string; name: string };
  pricing?: TcgdexPricing;
  variants_detailed?: Array<{ pricing?: TcgdexPricing }>;
}

export interface TcgdexSet {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { official: number; total: number };
  /** ISO date string from TCGdex, e.g. "2024-11-08". Used to sort card
   *  search results newest-first since TCGdex's own sort param is silently
   *  ignored on the /cards endpoint. */
  releaseDate?: string;
  /** Locale this set was fetched under. Added client-side; not from TCGdex. */
  locale?: Locale;
}

function imageUrls(base: string | undefined) {
  // TCGdex's image field is a base URL; quality + extension go on the end.
  // The CDN serves both webp and jpg; webp is smaller.
  if (!base) return { small: '', large: '' };
  return {
    small: `${base}/low.webp`,
    large: `${base}/high.webp`,
  };
}

function pickPricing(c: TcgdexCardFull): TcgdexCardmarketPricing | undefined {
  // Older cards expose a single `pricing` block.
  if (c.pricing?.cardmarket) return c.pricing.cardmarket;
  // Newer cards put pricing on each detailed variant. Take the first one
  // with cardmarket data.
  if (c.variants_detailed) {
    for (const v of c.variants_detailed) {
      if (v.pricing?.cardmarket) return v.pricing.cardmarket;
    }
  }
  return undefined;
}

/** Convert a full TCGdex card to the TcgCard shape the rest of the app uses. */
function toTcgCard(c: TcgdexCardFull): TcgCard {
  const cm = pickPricing(c);
  return {
    id: c.id,
    name: c.name,
    number: c.localId,
    rarity: c.rarity,
    types: c.types,
    hp: c.hp != null ? String(c.hp) : undefined,
    images: imageUrls(c.image),
    set: { id: c.set.id, name: c.set.name },
    cardmarket: cm
      ? {
          url: cm.idProduct
            ? `https://www.cardmarket.com/en/Pokemon/Products/Singles?idProduct=${cm.idProduct}`
            : undefined,
          updatedAt: cm.updated,
          prices: {
            averageSellPrice: cm.avg ?? undefined,
            trendPrice: cm.trend ?? undefined,
            lowPrice: cm.low ?? undefined,
            avg1: cm.avg1 ?? undefined,
            avg7: cm.avg7 ?? undefined,
            avg30: cm.avg30 ?? undefined,
          },
        }
      : undefined,
  };
}

/** Number of items per page in card search. Exported so the infinite-query
 *  hook can detect "this was the last page" (page length < ITEMS_PER_PAGE). */
export const SEARCH_ITEMS_PER_PAGE = 60;

/** Search by name and/or collector-number / set. TCGdex matches both name and
 *  localId case-insensitively as substring — so "194" also matches 1940, etc.
 *  That's coarser than exact match but TCGdex's `eq:` operator doesn't behave
 *  the way the docs suggest on this endpoint, so substring is what we ship. */
export async function searchCards(
  query: string,
  opts: { localId?: string; setId?: string; page?: number } = {},
): Promise<TcgdexBrief[]> {
  const term = query.trim();
  const { localId, setId, page = 1 } = opts;
  if (!term && !localId && !setId) return [];
  const params = new URLSearchParams();
  if (term) params.set('name', term);
  if (localId) params.set('localId', localId);
  if (setId) params.set('set.id', setId);
  params.set('pagination:page', String(page));
  params.set('pagination:itemsPerPage', String(SEARCH_ITEMS_PER_PAGE));
  const url = `${BASE}/cards?${params.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TCGdex search failed: ${r.status}`);
  return (await r.json()) as TcgdexBrief[];
}

/** Parse a user-typed search box into structured filters. Detects a trailing
 *  collector-number-like token (e.g. "194", "194/203", "GG56", "TG06") and
 *  treats the remainder as a name. A pure-number query goes through as
 *  `{ localId }` only — useful for "show me every #25 across sets". */
export function parseSearchQuery(q: string): {
  name: string;
  localId?: string;
} {
  const trimmed = q.trim();
  if (!trimmed) return { name: '' };
  const NUM_RE = /^[a-zA-Z]{0,5}\d+(\/\d+)?$/;
  const tokens = trimmed.split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (NUM_RE.test(last)) {
    // Drop the "/total" tail if present — TCGdex's localId is the numerator.
    const localId = last.split('/')[0];
    const name = tokens.slice(0, -1).join(' ');
    return { name, localId };
  }
  return { name: trimmed };
}

/** Fetch a single card by id, with full pricing.
 *
 * Tolerant of the id-padding mismatch between PokemonTCG.io (unpadded,
 * e.g. "me02.5-22") and TCGdex (zero-padded, e.g. "me02.5-022"). Cards
 * added to the user's collection under the old data source kept their
 * unpadded id; we retry with common padding widths when the raw id 404s. */
export async function getCard(cardId: string, locale: Locale = 'en'): Promise<TcgCard> {
  const tryFetch = async (id: string): Promise<TcgdexCardFull | null> => {
    const r = await fetch(`${baseFor(locale)}/cards/${id}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`TCGdex getCard failed: ${r.status}`);
    return (await r.json()) as TcgdexCardFull;
  };

  let card = await tryFetch(cardId);
  if (!card) {
    const dash = cardId.lastIndexOf('-');
    if (dash > 0) {
      const setId = cardId.slice(0, dash);
      const local = cardId.slice(dash + 1);
      if (/^\d+$/.test(local)) {
        const n = parseInt(local, 10);
        // TCGdex padding widths vary by set — try the common ones.
        for (const width of [3, 4, 2]) {
          const padded = String(n).padStart(width, '0');
          if (padded === local) continue;
          card = await tryFetch(`${setId}-${padded}`);
          if (card) break;
        }
      }
    }
  }
  if (!card) throw new Error(`Card not found: ${cardId}`);
  return toTcgCard(card);
}

/** Fetch every set so the lookup screen can resolve set name from the
 * prefix of a card id without an extra round-trip per result. */
export async function getSets(locale: Locale = 'en'): Promise<TcgdexSet[]> {
  const r = await fetch(`${baseFor(locale)}/sets`);
  if (!r.ok) throw new Error(`TCGdex getSets failed: ${r.status}`);
  return (await r.json()) as TcgdexSet[];
}

export interface TcgdexSetDetail extends TcgdexSet {
  releaseDate?: string;
  serie?: { id: string; name: string };
  cards: Array<{
    id: string;
    localId: string;
    name: string;
    image?: string;
    rarity?: string;
  }>;
}

/** Fetch a single set including the full card list. Used by the Sets tab
 * to render a grid + rarity filter for a chosen set. */
export async function getSet(setId: string, locale: Locale = 'en'): Promise<TcgdexSetDetail> {
  const r = await fetch(`${baseFor(locale)}/sets/${setId}`);
  if (!r.ok) throw new Error(`TCGdex getSet failed: ${r.status}`);
  return (await r.json()) as TcgdexSetDetail;
}
