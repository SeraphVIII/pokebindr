# PokeBindr

A mobile app for tracking a Pokémon TCG collection — built with Expo
(React Native) and Supabase. Card data comes from
[TCGdex](https://tcgdex.dev); artwork falls back to the PokemonTCG.io
CDN where TCGdex has none. Prices come from eBay UK sold listings with
Cardmarket as the fallback.

**Features**

- Binders with custom grid sizes, drag-and-drop reordering, page
  management, and a bulk binder for unsorted cards
- Set browser with three master-set levels: Base (one of each card),
  Master (every printing — normal, reverse, holo), and Grandmaster
  (stamped and promo printings too), tracked per printing in the grid
- Card detail with eBay UK last-sold prices (avg of the last 5 sales,
  raw / PSA 9 / PSA 10 filters) and Cardmarket pricing
- Live card lookup and camera card scanning (OCR via an edge function)
- Curator: suggested binder pages built from what you own — evolution
  ladders, artist pages, color runs, connecting-artwork panoramas
- Have / Want / Need statuses, per-copy condition, wantlist with a
  running total
- Public profiles, shareable binder links, friends, and likes
- Binder export/import as portable `.pkbinder` files

---

## Quick start

### 1. Prereqs

- **Node 20+** and **npm**
- An Android emulator / iOS simulator, or a device with a dev build
- A **Supabase** project — <https://supabase.com>

### 2. Install

```bash
npm install
```

### 3. Supabase

The database schema (tables, RLS policies, RPC functions) and the edge
functions under `supabase/functions/` are managed separately; the SQL
files are intentionally not part of this repo. Point the app at a
project that already has the schema applied.

In **Settings → API**, copy the project URL and anon key.

### 4. Env

```bash
cp .env.example .env
# paste your Supabase URL + anon key
```

### 5. Run

```bash
npx expo start
```

Press `a` / `i` for an emulator, or scan the QR code from a dev build.

---

## Project layout

```
app/                        # expo-router routes
├── (auth)/sign-in.tsx
├── (tabs)/
│   ├── index.tsx           # home dashboard
│   ├── binder/             # binder list, page view, new, curator ideas
│   ├── sets/               # set browser + master-set grid
│   ├── lookup.tsx          # card search
│   ├── wantlist.tsx
│   └── profile.tsx
├── card/[id].tsx           # card detail + pricing
├── collection.tsx          # full collection list
├── scan.tsx                # camera card scan
├── friends.tsx
├── share/[token].tsx       # shared-binder links
└── u/[username]/           # public profiles + binders
components/                 # ui kit (theme'd), tab bar, binder pieces
lib/
├── tcgdex.ts               # TCGdex client + artwork fallbacks
├── ebay.ts                 # eBay UK solds fetch/parse + hook
├── variants.ts             # master-set printing model
├── curator.ts              # page-idea generation
├── queries.ts              # React-Query hooks over Supabase
├── pkbinder.ts / pkbinderIO.ts
└── theme.ts                # design tokens
supabase/functions/         # card-scan, card-palette, card-panorama,
                            # cardmarket-resolve (Deno edge functions)
```

---

## How the data flows

- The card catalogue lives in TCGdex and is never copied into the
  database; `collections` rows hold denormalized display fields plus
  per-copy state (status, condition, printing variant, position).
- Printing variants, card facts, and eBay sold listings are cached in
  shared tables so each card is fetched once across all users.
- eBay solds are fetched on-device (datacenter IPs get blocked) and
  parsed defensively; when nothing is found the UI falls back to
  Cardmarket pricing.
- React Query handles caching and optimistic mutations throughout.

---

## Troubleshooting

**`Missing EXPO_PUBLIC_SUPABASE_URL`** — create `.env` and restart with
`npx expo start -c`.

**Sign-in says "Email not confirmed"** — disable email confirmation in
Supabase → Authentication → Providers → Email while developing.

**Master-set grid shows a progress bar** — first open of a set fetches
its printings from TCGdex once; after that it's served from the shared
cache.
