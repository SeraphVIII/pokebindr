// Domain types — shared across screens.

export type Status = 'have' | 'want' | 'really';

export type Visibility = 'private' | 'friends' | 'public';

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friendship {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
}

/** Relationship to a target user, from the viewer's POV. */
export type FriendState =
  | 'self'             // looking at your own profile
  | 'none'             // no row in either direction
  | 'outgoing-pending' // you sent the request, waiting
  | 'incoming-pending' // they sent the request, awaiting your accept
  | 'friends';         // accepted

export interface Binder {
  id: string;
  user_id: string;
  name: string;
  grid_cols: number;
  grid_rows: number;
  visibility: Visibility;
  share_token: string | null;
  likes_count: number;
  is_bulk: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  user_id: string;
  username: string | null;
  created_at: string;
  updated_at: string;
}

export interface BinderPage {
  id: string;
  binder_id: string;
  page_index: number;
  title: string | null;
  created_at: string;
}

export interface CollectionRow {
  id: string;
  user_id: string;
  binder_id: string;
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
  quantity: number;
  condition: string;
  /** Physical printing: a slot key from lib/variants.ts ('normal', 'reverse',
   *  'normal+pokemon-together', …). Treat null/undefined as 'normal'. */
  variant?: string | null;
  notes: string | null;
  last_price_eur: number | null;
  price_checked_at: string | null;
  position: number;
  added_at: string;
  updated_at: string;
}

/** One dominant colour of a card's artwork: HSL plus its pixel-share weight.
 *  Computed once per card by the card-palette Edge Function. */
export interface PaletteEntry {
  h: number; // hue 0–360
  s: number; // saturation 0–1
  l: number; // lightness 0–1
  w: number; // share of sampled pixels 0–1
}

/** Immutable card facts, cached in the shared `card_meta` table. All-null
 *  facts (except card_id) mean TCGdex has no record under this id. */
export interface CardFacts {
  card_id: string;
  category: string | null;    // Pokemon / Trainer / Energy
  dex_ids: number[] | null;   // national dex number(s)
  stage: string | null;       // Basic / Stage1 / Stage2 / VMAX / …
  evolve_from: string | null; // pre-evolution name, as printed
  illustrator: string | null;
  /** Dominant artwork colours, largest weight first; null until extracted. */
  palette: PaletteEntry[] | null;
}

// Subset of the PokemonTCG.io card response used by the app.
export interface TcgCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  types?: string[];
  hp?: string;
  images: { small: string; large: string };
  set: { id: string; name: string; series?: string; total?: number };
  cardmarket?: {
    url?: string;
    updatedAt?: string;
    prices?: {
      averageSellPrice?: number;
      trendPrice?: number;
      lowPrice?: number;
      avg1?: number;
      avg7?: number;
      avg30?: number;
      reverseHoloTrend?: number;
    };
  };
  // Fallback price source, used only when cardmarket is empty. USD.
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: {
      [variant: string]: {
        low?: number;
        mid?: number;
        high?: number;
        market?: number;
        directLow?: number;
      } | undefined;
    };
  };
}

// Map a TCG card → a partial collection row ready for upsert into a binder.
export function tcgToCollectionRow(c: TcgCard, status: Status, binderId: string) {
  return {
    binder_id: binderId,
    card_id: c.id,
    card_name: c.name,
    set_id: c.set.id,
    set_name: c.set.name,
    card_number: c.number,
    rarity: c.rarity ?? null,
    card_type: c.types?.[0] ?? null,
    image_small: c.images.small ?? null,
    image_large: c.images.large ?? null,
    status,
    last_price_eur: c.cardmarket?.prices?.trendPrice ?? c.cardmarket?.prices?.averageSellPrice ?? null,
    price_checked_at: new Date().toISOString(),
  };
}
