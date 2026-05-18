// TCGdex API client.
// Docs: https://tcgdex.dev
// Coverage is broader (and updated faster) than PokemonTCG.io — especially
// for the newer Mega Evolution + Pocket sets — and Cardmarket prices are
// first-class in EUR.

import type { TcgCard } from './types';

const BASE = 'https://api.tcgdex.net/v2/en';

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

/** Search by name. TCGdex matches case-insensitively as substring. */
export async function searchCards(query: string, page = 1): Promise<TcgdexBrief[]> {
  const term = query.trim();
  if (!term) return [];
  const url = `${BASE}/cards?name=${encodeURIComponent(term)}&pagination:page=${page}&pagination:itemsPerPage=24`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TCGdex search failed: ${r.status}`);
  return (await r.json()) as TcgdexBrief[];
}

/** Fetch a single card by id, with full pricing.
 *
 * Tolerant of the id-padding mismatch between PokemonTCG.io (unpadded,
 * e.g. "me02.5-22") and TCGdex (zero-padded, e.g. "me02.5-022"). Cards
 * added to the user's collection under the old data source kept their
 * unpadded id; we retry with common padding widths when the raw id 404s. */
export async function getCard(cardId: string): Promise<TcgCard> {
  const tryFetch = async (id: string): Promise<TcgdexCardFull | null> => {
    const r = await fetch(`${BASE}/cards/${id}`);
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
export async function getSets(): Promise<TcgdexSet[]> {
  const r = await fetch(`${BASE}/sets`);
  if (!r.ok) throw new Error(`TCGdex getSets failed: ${r.status}`);
  return (await r.json()) as TcgdexSet[];
}
