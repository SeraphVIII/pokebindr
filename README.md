# Pokémon Collection Tracker

A mobile app for tracking your Pokémon TCG collection — built with Expo
(React Native), Supabase, and the [PokemonTCG.io](https://pokemontcg.io)
API. EU prices come from Cardmarket via PokemonTCG.io's free data feed.

**Features**

- Email/password account via Supabase Auth
- Live card lookup with images, sets, rarity, EU market price
- Binder view — 3×3 grid, paginated, filter by status
- Have / Want / Really-want statuses, with colored borders + glow
- Card detail with Cardmarket price block, low/trend/avg breakdown,
  rough sparkline
- Wantlist with running "to acquire" total
- Profile + sign out

---

## Quick start (5 minutes)

### 1. Prereqs

You need:
- **Node 20+** and **npm**
- **Expo Go** app on your phone (App Store / Play Store), *or* an
  iOS simulator (Xcode) / Android emulator (Android Studio)
- A free **Supabase** project — sign up at <https://supabase.com>

### 2. Install dependencies

```bash
cd pokemon-tracker-app
npm install
```

### 3. Set up Supabase

1. Create a new project at <https://supabase.com/dashboard>.
2. In the project, go to **SQL Editor → New query**, paste the contents
   of `supabase/schema.sql`, and run it. This creates the `collections`
   table with row-level security and the (optional) `price_snapshots`
   table.
3. In **Authentication → Providers**, make sure **Email** is enabled.
   For frictionless development, also turn off "Confirm email" while
   testing — otherwise every sign-up needs a confirmed email before
   the user can log in.
4. In **Settings → API**, copy:
   - `Project URL` → goes into `EXPO_PUBLIC_SUPABASE_URL`
   - `anon public` key → goes into `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### 4. Configure env vars

```bash
cp .env.example .env
# edit .env, paste your two values
```

(Optional — get a free API key at <https://dev.pokemontcg.io> and put
it in `EXPO_PUBLIC_POKEMONTCG_API_KEY`. Without it, lookup still works
but is rate-limited.)

### 5. Run

```bash
npx expo start
```

This opens the Expo dev tools. Then:

- **On your phone:** scan the QR code with the Expo Go app
- **iOS simulator:** press `i`
- **Android emulator:** press `a`
- **Web (limited):** press `w`

First launch lands on the sign-in screen — create an account, then add
cards by tapping the **Add** tab and searching.

---

## Project layout

```
pokemon-tracker-app/
├── app/                          # expo-router file-based routes
│   ├── _layout.tsx              # providers + auth gate
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── sign-in.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx          # bottom tab bar
│   │   ├── index.tsx            # Home
│   │   ├── binder.tsx
│   │   ├── lookup.tsx
│   │   ├── wantlist.tsx
│   │   └── profile.tsx
│   └── card/
│       ├── _layout.tsx
│       └── [id].tsx             # Card detail
├── components/
│   ├── CardSlot.tsx             # The binder slot with status border
│   ├── Chip.tsx
│   ├── Eyebrow.tsx              # Small mono caption
│   ├── Screen.tsx               # Themed SafeAreaView wrapper
│   ├── Sparkline.tsx
│   └── StatusDot.tsx
├── lib/
│   ├── auth.tsx                 # Session context
│   ├── pokemonTcg.ts            # PokemonTCG.io API client
│   ├── queries.ts               # React-Query hooks
│   ├── supabase.ts              # Supabase client (SecureStore on native)
│   ├── theme.ts                 # Vault color/font tokens
│   └── types.ts
├── supabase/
│   └── schema.sql               # Run this in the SQL editor
├── app.json
├── babel.config.js
├── package.json
└── tsconfig.json
```

---

## How the data flows

```
PokemonTCG.io  ─search─►  Lookup screen  ─upsert─►  Supabase.collections
                                                          ▲
                                          Binder / Home  ◄┘  (React Query cache)
```

- Card *catalogue* (names, images, prices) is never stored in your
  Supabase — it lives in PokemonTCG.io. You only persist what the user
  owns / wants.
- The `collections` table holds denormalized card metadata
  (`card_name`, `image_small`, `last_price_eur`) so lists render fast
  without re-hitting the API.
- React Query handles caching, optimistic mutations (e.g. status
  changes flip the border colour instantly), and refetch on focus.

---

## Adding things later

### Price history chart
Currently the detail sparkline is built from PokemonTCG.io's
`avg1`/`avg7`/`avg30` waypoints — not a real time series. To get a
proper 90-day chart:

1. Write a Supabase **Edge Function** that runs daily on a schedule,
   pulls `cardmarket.prices` for every distinct `card_id` in the
   `collections` table, and inserts rows into `price_snapshots`.
2. Add a query in `lib/queries.ts` that selects from `price_snapshots`
   by `card_id` and date range.
3. Swap the `series` array in `app/card/[id].tsx` for the result.

### Multiple binder sizes
The grid is hardcoded to 3×3 in `app/(tabs)/binder.tsx`. To support
2×2, 4×3, 4×4, 1×1 toploader views: lift `GRID` into a state, render
a size-picker chip row, and persist the choice to AsyncStorage.

### OAuth (Apple / Google)
Supabase Auth supports both. Enable in the Supabase dashboard, then
follow [supabase-js OAuth docs](https://supabase.com/docs/guides/auth/social-login)
— mostly one extra `signInWithOAuth` call.

### Real-time sync across devices
`supabase-js` includes a realtime client. Subscribe to changes on
`collections` filtered by `user_id` in `lib/auth.tsx` and invalidate
the React Query cache when a row mutates.

### Offline mutations
Wrap `useMutation` with a queue that persists pending writes to
AsyncStorage and replays on reconnect. Or swap to
[PowerSync](https://www.powersync.com/) / WatermelonDB for proper
local-first.

---

## Known limitations / v1 trade-offs

- **No price history yet** — see "Adding things later".
- **Only one binder size** (3×3) wired up.
- **System fonts** — the design comp uses Cormorant Garamond + Manrope.
  To match, install `@expo-google-fonts/cormorant-garamond` and
  `@expo-google-fonts/manrope`, load them in `app/_layout.tsx`, and
  update the `font*` keys in `lib/theme.ts`.
- **Cardmarket prices only** — PokemonTCG.io also exposes `tcgplayer`
  for US prices; not wired in.
- **No condition tracker UI** — schema supports it (`condition`
  field) but no screen surfaces it yet.

---

## Troubleshooting

**`Missing EXPO_PUBLIC_SUPABASE_URL`** — you didn't create `.env` or
the Metro bundler didn't pick it up. Restart with `npx expo start -c`.

**Sign-in says "Email not confirmed"** — disable email confirmation in
Supabase → Authentication → Providers → Email while developing.

**Search returns nothing** — PokemonTCG.io rate-limits unauthenticated
requests aggressively. Get a free key at <https://dev.pokemontcg.io>.

**App crashes on `expo-secure-store`** — only happens on web; the
client falls back to AsyncStorage there. If it bites on native, run
`npx expo install expo-secure-store` to make sure native modules are
linked.
