// TCGdex API client (https://tcgdex.dev).

import type { CardFacts, TcgCard } from './types';

export type Locale = 'en' | 'ja' | 'ko' | 'zh-cn';
const ROOT = 'https://api.tcgdex.net/v2';
const baseFor = (locale: Locale) => `${ROOT}/${locale}`;
const BASE = baseFor('en');

/** Locales the "International" sets toggle pulls in, and the order the
 *  cross-locale card lookup sweeps them. */
export const INTL_LOCALES: Locale[] = ['ja', 'ko', 'zh-cn'];

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'EN', ja: 'JP', ko: 'KR', 'zh-cn': 'CN',
};

// Shape returned by the /cards list endpoint. Set name and price require a
// separate /cards/{id} fetch.
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

/** Coarse printing flags. */
export interface TcgdexVariants {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
  wPromo?: boolean;
}

/** One physical printing. Stamped promo runs, special foils, and sizes
 *  appear here rather than in the coarse flags. */
export interface TcgdexVariantDetailed {
  type: string;
  size?: string;      // 'standard' | 'jumbo' | …
  foil?: string;      // 'cosmos' | …
  stamp?: string[];   // ['pokemon-together'] | ['snowflake'] | …
  variantId?: string;
  pricing?: TcgdexPricing;
}

interface TcgdexCardFull extends TcgdexBrief {
  rarity?: string;
  types?: string[];
  hp?: number;
  set: { id: string; name: string; cardCount?: { official: number; total: number } };
  pricing?: TcgdexPricing;
  variants?: TcgdexVariants;
  variants_detailed?: TcgdexVariantDetailed[];
  // Curator facts — present on the card detail endpoint only.
  category?: string;
  dexId?: number[];
  evolveFrom?: string;
  stage?: string;
  illustrator?: string;
}

/** What the shared card_variants cache stores per card. All-null fields
 *  mean TCGdex has no record under this id (a cached permanent miss). */
export interface CardVariantsInfo {
  card_id: string;
  variants: TcgdexVariants | null;
  variants_detailed: Array<Pick<TcgdexVariantDetailed, 'type' | 'size' | 'foil' | 'stamp' | 'variantId'>> | null;
}

export interface TcgdexSet {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: { official: number; total: number };
  /** ISO date, e.g. "2024-11-08". Used to sort search results newest-first;
   *  TCGdex's sort param is silently ignored on the /cards endpoint. */
  releaseDate?: string;
  /** Locale this set was fetched under. Added client-side; not from TCGdex. */
  locale?: Locale;
}

function imageUrls(base: string | undefined) {
  // TCGdex image fields are base URLs; quality and extension are appended.
  if (!base) return { small: '', large: '' };
  return {
    small: `${base}/low.webp`,
    large: `${base}/high.webp`,
  };
}

/** PokemonTCG.io fallback for artwork TCGdex lacks (notably TG/GG gallery
 *  subsets). Its set ids match TCGdex's except dots become "pt"
 *  (swsh12.5gg → swsh12pt5gg) and numeric localIds are unpadded. */
export function fallbackImageUrls(setId: string, localId: string) {
  // Gallery cards may be stored under the parent set id (set "swsh12.5" +
  // number "GG44"); append the missing subset suffix before mapping.
  let set = setId;
  if (/^tg\d/i.test(localId) && !/tg$/i.test(set)) set = `${set}tg`;
  if (/^gg\d/i.test(localId) && !/gg$/i.test(set)) set = `${set}gg`;
  set = set.replace(/\./g, 'pt');
  const num = /^\d+$/.test(localId) ? String(parseInt(localId, 10)) : localId;
  return {
    small: `https://images.pokemontcg.io/${set}/${num}.png`,
    large: `https://images.pokemontcg.io/${set}/${num}_hires.png`,
  };
}

/** Small/large pair for a card: TCGdex assets when present, PokemonTCG.io
 *  fallback otherwise. */
export function cardImages(image: string | undefined, setId: string, localId: string) {
  return image ? imageUrls(image) : fallbackImageUrls(setId, localId);
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

function toTcgCard(c: TcgdexCardFull): TcgCard {
  const cm = pickPricing(c);
  return {
    id: c.id,
    name: c.name,
    number: c.localId,
    rarity: c.rarity,
    types: c.types,
    hp: c.hp != null ? String(c.hp) : undefined,
    images: cardImages(c.image, c.set.id, c.localId),
    // `total` is the printed denominator ("199/165" → 165): the official
    // count, not the count including secrets. Used to build eBay queries.
    set: { id: c.set.id, name: c.set.name, total: c.set.cardCount?.official },
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

/** Page size for card search; a short page marks the last page. */
export const SEARCH_ITEMS_PER_PAGE = 60;

/** Search by name and/or collector number / set. TCGdex matches name and
 *  localId case-insensitively as substrings, so "194" also matches 1940. */
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

/** Parse a search query into filters. A trailing collector-number token
 *  ("194", "194/203", "GG56") becomes localId; the rest is the name. */
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
    // Drop the "/total" tail if present; TCGdex's localId is the numerator.
    const localId = last.split('/')[0];
    const name = tokens.slice(0, -1).join(' ');
    return { name, localId };
  }
  return { name: trimmed };
}

/** Fetch a single card by id, with full pricing. Tolerates the id-padding
 *  mismatch between PokemonTCG.io ("me02.5-22") and TCGdex ("me02.5-022"). */
export async function getCard(cardId: string, locale: Locale = 'en'): Promise<TcgCard> {
  const card = await fetchCardFull(cardId, locale);
  if (!card) throw new Error(`Card not found: ${cardId}`);
  return toTcgCard(card);
}

/** Padding-tolerant card-detail fetch. Returns null when TCGdex 404s the id
 *  and every common zero-padding of it; throws on non-404 failures. */
async function fetchCardFull(cardId: string, locale: Locale): Promise<TcgdexCardFull | null> {
  const tryFetch = async (id: string, loc: Locale = locale): Promise<TcgdexCardFull | null> => {
    const r = await fetch(`${baseFor(loc)}/cards/${id}`);
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
        // TCGdex padding widths vary by set; try the common ones.
        for (const width of [3, 4, 2]) {
          const padded = String(n).padStart(width, '0');
          if (padded === local) continue;
          card = await tryFetch(`${setId}-${padded}`);
          if (card) break;
        }
      } else if (/^tg\d/i.test(local) && !/tg$/i.test(setId)) {
        // Gallery card stored under the parent set id ("swsh9-TG01");
        // TCGdex only knows the subset id ("swsh9tg-TG01").
        card = await tryFetch(`${setId}tg-${local}`);
      } else if (/^gg\d/i.test(local) && !/gg$/i.test(setId)) {
        card = await tryFetch(`${setId}gg-${local}`);
      }
    }
  }
  // Collections rows don't record a catalogue locale, so JP/KR/CN cards can
  // arrive as 'en' and 404. Sweep the international catalogues before giving up.
  if (!card && locale === 'en') {
    for (const alt of INTL_LOCALES) {
      card = await tryFetch(cardId, alt);
      if (card) break;
    }
  }
  return card;
}

/** Printings for one card, keyed by the requested id so cache lookups match.
 *  A 404 returns all-null (cached as a permanent miss); other errors throw. */
export async function getCardVariants(cardId: string, locale: Locale = 'en'): Promise<CardVariantsInfo> {
  const card = await fetchCardFull(cardId, locale);
  return {
    card_id: cardId,
    variants: card?.variants ?? null,
    variants_detailed: card?.variants_detailed
      ? card.variants_detailed.map(({ type, size, foil, stamp, variantId }) => ({
          type, size, foil, stamp, variantId,
        }))
      : null,
  };
}

/** Curator facts for one card, keyed by the requested id so cache lookups
 *  match. A 404 returns all-null facts (cached as a permanent miss); other
 *  errors throw so transient failures aren't cached. */
export async function getCardFacts(cardId: string, locale: Locale = 'en'): Promise<CardFacts> {
  const card = await fetchCardFull(cardId, locale);
  return {
    card_id: cardId,
    category: card?.category ?? null,
    dex_ids: card?.dexId && card.dexId.length ? card.dexId : null,
    stage: card?.stage ?? null,
    evolve_from: card?.evolveFrom ?? null,
    illustrator: card?.illustrator ?? null,
    // Palettes come from the card-palette Edge Function, never from TCGdex.
    palette: null,
  };
}

/** Every card id in a locale's catalogue, in one request. TCGdex lists set
 *  metadata for some sets with no card data; this identifies them. */
export async function getAllCardIds(locale: Locale): Promise<string[]> {
  const r = await fetch(`${baseFor(locale)}/cards`);
  if (!r.ok) throw new Error(`TCGdex cards index failed: ${r.status}`);
  const cards = (await r.json()) as Array<{ id: string }>;
  return cards.map((c) => c.id);
}

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

/** Fetch a single set including its full card list. */
export async function getSet(setId: string, locale: Locale = 'en'): Promise<TcgdexSetDetail> {
  const r = await fetch(`${baseFor(locale)}/sets/${setId}`);
  if (!r.ok) throw new Error(`TCGdex getSet failed: ${r.status}`);
  return (await r.json()) as TcgdexSetDetail;
}
