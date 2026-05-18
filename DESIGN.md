# Pokémon Tracker — Design Document

> A handoff doc for picking up this codebase in Claude Code (or any
> dev environment) and polishing it to ship. Covers the product, the
> design system, every screen, the data model, and a prioritised list
> of what to do next.

---

## 1. Product overview

A mobile app for tracking a personal Pokémon TCG collection — what you
**Have**, what you **Want**, and what you **Really want**. The headline
features are:

1. **A binder metaphor.** Cards live in paginated 3×3 grid pages,
   nodding visually to a real card binder without skeuomorphism. Card
   status drives the border colour, not separate lists.
2. **Live EU pricing.** Every card has a market value from Cardmarket
   (via PokemonTCG.io's free API). The home screen sums it up; the
   detail screen breaks it down.
3. **Effortless add flow.** Tap **Add**, type a name, tap a result. The
   card is in the binder in <2 taps.
4. **Account sync** via Supabase email/password — same binder on every
   device the user signs into.

**Tone:** premium, collector-grade, museum-y. Dark by default. The
user is a serious hobbyist; the app should feel like it respects the
cards.

**Target user:** EU-based hobbyist collector tracking a personal
collection of 50–2000 cards across multiple sets. Not a dealer, not a
play-style tracker.

**Non-goals (v1):**
- Deck-building or play modes
- Trading / marketplace
- Grading / population reports (PSA, BGS, CGC)
- US (TCGplayer) pricing
- Sealed product tracking
- Social features

---

## 2. Information architecture

```
┌─ (auth)
│  └─ sign-in            email + password, toggles to sign-up
│
├─ (tabs)                bottom tab bar
│  ├─ index   "Home"     overview + recent activity
│  ├─ binder  "Binder"   3×3 grid, filter, pagination
│  ├─ lookup  "Add"      search → add to collection
│  ├─ wantlist "Hunt"    really-want + want, with total cost
│  └─ profile "You"      account + sign out
│
└─ card/[id]             modal-feel detail screen
                         opens from binder, home, wantlist, lookup
```

Modal vs tab: the bottom tabs are the **navigation backbone**;
**card/[id]** is presented as a stack push from any tab, with a back
arrow.

---

## 3. Design system — "Vault"

The codebase ships **one direction** (Vault — obsidian + gold). Two
sister directions exist in the HTML prototype (Ember = copper, Holo =
iridescent blue); see `pokemon-app.html` if you want to port either
in.

### 3.1 Color tokens (`lib/theme.ts`)

| Token            | Hex / value                  | Used for                                |
|------------------|------------------------------|-----------------------------------------|
| `bg`             | `#0c0a08`                    | Every screen background                 |
| `surface`        | `#15110d`                    | Cards, list rows, sheets                |
| `surface2`       | `#1d1812`                    | Inset bevels, sparkline track           |
| `surface3`       | `#27201a`                    | Striped placeholders, range chip bg     |
| `border`         | `rgba(212,175,55,0.14)`      | Default 1px borders                     |
| `borderStrong`   | `rgba(212,175,55,0.32)`      | Primary tile borders, monogram          |
| `text`           | `#f4eedc`                    | Body text, headlines                    |
| `textDim`        | `#a89a7a`                    | Captions, secondary labels              |
| `textMute`       | `#5e5440`                    | Dashed-placeholder text, disabled state |
| `accent`         | `#d4af37` (gold)             | CTAs, monogram, active chips            |
| `accent2`        | `#8c6d1f`                    | Avatar gradient terminus                |
| `accentText`     | `#0c0a08`                    | Text on accent fills                    |
| `statusHave`     | `#6b9a78` (muted emerald)    | "Have" borders, dots, copy              |
| `statusWant`     | `#c8a04a` (muted amber)      | "Want" borders, dots, copy              |
| `statusReally`   | `#c75c5c` (muted rose)       | "Really want" borders + outer glow      |

**Light mode** is not in v1 but is sketched in `pokemon-app.html`
(invert `bg`/`surface*`, keep `accent` and `status*`).

### 3.2 Typography

Three faces; system fallbacks until Google Fonts are wired in:

| Role        | Family target                    | Where it shows up                              |
|-------------|----------------------------------|------------------------------------------------|
| Display    | **Cormorant Garamond 500/600**   | Hero numbers, screen titles, card name on slot |
| UI         | **Manrope 500/700**              | Body, buttons, list rows                       |
| Mono       | **JetBrains Mono 500**           | Eyebrows, prices, dex numbers, set codes       |

**Scale:**

| Token              | Size / line-height | Family   |
|--------------------|--------------------|----------|
| `hero`             | 44 / 46            | Display  |
| `screenTitle`      | 30 / 32            | Display  |
| `sectionTitle`     | 19 / 22            | Display  |
| `cardName` (slot)  | 7–10 (scales with `width * 0.085`) | Display |
| `body`             | 14 / 21            | UI       |
| `bodySmall`        | 12 / 18            | UI       |
| `eyebrow`          | 10 / 14            | Mono, 2px tracking, uppercase |
| `price`            | 13.5 / 16          | Mono, tabular |

### 3.3 Spacing, radii, shadows

- **Spacing scale:** `4, 8, 12, 16, 20, 24, 28, 32, 40, 60, 80`. Use
  multiples of 4; favour 24 as the default screen padding.
- **Radii:** `theme.radius = 8` for inputs / cards / chips.
  `theme.radius * 1.5 = 12` for hero tiles. `theme.radius * 2 = 16`
  for bottom sheets.
- **Shadows:** dark theme so we lean on borders + subtle inner glows
  instead of drop shadows. Exception: status="really" cards get an
  outer rose glow (`shadowColor: theme.statusReally`,
  `shadowRadius: 10`, `shadowOpacity: 0.55`).

### 3.4 Card slot anatomy (binder)

```
┌──────────────────────────┐  ← border colour from status
│ Charizard           120  │  ← display 8% of width / mono HP, accent colour
│                          │
│  ░░░░░░░░░░░░░░░░░░░░░░  │  ← art window: real card image OR striped placeholder
│  ░░░░░░░░ #004 ░░░░░░░░  │     (dex watermark when placeholder)
│  ░░░░░░░░░░░░░░░░░░░░░░  │
│                          │
│ ● ★              4/102   │  ← type pip, rarity mark, set number (mono)
└──────────────────────────┘
```

Scales fluidly from `width = 50` (wantlist row thumbnail) up to `170`
(detail hero). All inner offsets are `width * <factor>` so the slot
stays proportional.

### 3.5 Status border treatment

| Status      | Border               | Outer effect                                 |
|-------------|----------------------|----------------------------------------------|
| **have**    | 1.5px solid emerald  | none                                         |
| **want**    | 1.5px solid amber    | none                                         |
| **really**  | 2.5px solid rose     | rose glow shadow (radius 10, opacity 55%)    |
| **missing** | 1px dashed mute      | opacity 0.45 on the whole slot (empty look)  |

The HTML prototype also implements a "tint" treatment (border + inset
glow) as an alternate; not used in v1.

### 3.6 Iconography

- `@expo/vector-icons` → Feather set. Line icons only.
- Bottom-tab icons: `home`, `grid`, `plus-circle`, `star`, `user`.
- The "Add" tab uses a larger `plus-circle` in accent colour as a
  pseudo-FAB sitting *in* the tab bar (not floating).

---

## 4. Component inventory

All in `components/`. Each is small (<200 LOC) and styled inline.

| Component       | Purpose                                                              | Key props                                          |
|-----------------|----------------------------------------------------------------------|----------------------------------------------------|
| `Screen`        | Themed `SafeAreaView` wrapper, used by every route                   | `style?`, `edges?`                                 |
| `Eyebrow`       | Small mono caption (uppercase, 2px tracking)                         | `children`, `style?`                               |
| `Chip`          | Toggle pill — filter bar, status picker                              | `label`, `active?`, `color?`, `onPress`            |
| `CardSlot`      | Binder slot: image + status border + glow                            | `row`, `width`, `onPress?`, `onLongPress?`         |
| `EmptySlot`     | Dashed placeholder slot (for un-filled binder positions)             | `width`, `label?`, `onPress?`                      |
| `Sparkline`     | Tiny line chart from a `number[]` (uses `react-native-svg`)           | `data`, `width`, `height`, `color?`                |
| `StatusDot`     | 8px coloured dot for "Have/Want/Really"                              | `status`, `size?`                                  |

**Not yet built (planned):**

- `BottomSheet` — used as the long-press status picker on the binder.
  Currently the long-press just rotates through statuses; a sheet
  would be a nicer UX.
- `PriceBlock` — extract the price card from `card/[id].tsx`.
- `SetBadge` — pill showing the set's symbol + name. Right now we
  render set name as plain text.
- `BinderSpine` — the row of "rings" on the binder edge. Inline in
  `binder.tsx`; should be extracted.

---

## 5. Screen specs

### 5.1 Sign-in (`(auth)/sign-in.tsx`)

**Goal:** get the user into Supabase Auth in ≤30 seconds.

**Layout (top → bottom):**
- `P` monogram (56×56, accent-bordered surface)
- Eyebrow `Collector's archive`
- Display headline `Sign in to your binder.` (the "your binder" half
  in accent)
- Body copy explaining what the app does
- Email field (mono eyebrow label, surface input)
- Password field
- Primary CTA: `Enter the vault` (accent fill)
- Toggle: "New collector? Create one" → flips mode to sign-up

**States:**
- `signin` / `signup` mode toggle
- `busy` while auth call is in flight (CTA opacity 0.6)
- `error` → native `Alert`

**Interactions:**
- Submit on CTA tap
- KeyboardAvoidingView on iOS so the CTA stays visible

**Polish needed:**
- Replace native `Alert` with toast/snackbar
- Add "Forgot password?" link → `supabase.auth.resetPasswordForEmail`
- Add Apple / Google OAuth (Supabase supports both natively)

### 5.2 Home (`(tabs)/index.tsx`)

**Goal:** at-a-glance read of collection health.

**Layout:**
1. Greeting: eyebrow `Welcome back`, display title `Good evening,
   Trainer.` (Trainer in accent)
2. **Hero value tile** — bg `surface`, accent-tinted radial gradient
   in top-right corner, displaying `€{total}` in 44px display.
   Below: "{n} cards owned · prices via Cardmarket" caption.
3. **Status strip** — three side-by-side stat tiles (Have / Want /
   Really), each with status-dot + count.
4. **Recently added** section — last 4 collection entries, tappable
   rows. Empty state: dashed CTA "Your binder is empty. Tap to add
   your first card →"

**States:**
- `isLoading` shows "Loading…" inline
- empty state when `collection.length === 0`

**Polish needed:**
- Add the sparkline tile from the HTML prototype (7-day collection
  value trend — needs `price_snapshots` to be real)
- Wire "Recently added" to actually order by `added_at desc` rather
  than the default order
- Add a "Top movers" row (cards whose price changed most in 7d)

### 5.3 Binder (`(tabs)/binder.tsx`)

**Goal:** browse the collection visually, by page.

**Layout:**
- Header: eyebrow `Binder · 3×3`, title `Your collection`
- Filter chips: All / Have / Want / Really
- Spread: thin vertical "spine" of dots on the left, 3×3 grid of
  `CardSlot` to the right
- Pager: left chevron · `PAGE 01 / 02` · right chevron

**Interactions:**
- Tap card → `/card/[id]`
- Long-press card → rotates through have → want → really (optimistic
  via React Query)
- Tap empty slot → `/lookup`
- Tap chevron / chip → updates state, resets to page 1

**States:**
- Empty filter → padded slots show as `EmptySlot`
- Loading → renders empty page (could improve)

**Polish needed:**
- Make the long-press open a `BottomSheet` with all 4 status options
  + Remove, instead of cycling
- Add a horizontal swipe gesture between pages (use
  `react-native-gesture-handler` + `react-native-reanimated`)
- Surface set picker — currently shows the user's whole collection as
  one binder; should let them swap between sets ("Base Set", "Jungle",
  etc.) like in the prototype
- Grid-size picker (1×1, 2×2, 3×3, 4×3, 4×4) — schema-ready, just no
  UI yet
- Drag-and-drop reorder within a page

### 5.4 Lookup (`(tabs)/lookup.tsx`)

**Goal:** find and add a card in <5 seconds.

**Layout:**
- Search bar: `search` icon · TextInput · `x` clear button
- Eyebrow: `{n} matches · refreshing`
- FlatList of results: small image (44×62) · name + set/number/rarity
  caption · Cardmarket trend price on the right

**Interactions:**
- TextInput debounced 250ms before hitting the API
- Tap result → `useUpsertCard({card, status:'have'})` then push to
  `/card/[id]`
- Empty state copy varies by `debounced.length`

**States:**
- `isLoading` shows spinner in list
- `<2 chars`: "Type a card name to search."
- `0 results`: "No matches."

**Polish needed:**
- Show whether the card is already in the user's collection (badge
  on the row)
- Let user pick the initial status before adding (segmented control
  above results, defaulting to "Have")
- Show more recent / popular searches when input is empty (cache in
  AsyncStorage)
- Add filters: set, rarity, type (PokemonTCG.io API supports all
  three in the `q` parameter)
- Better "card already added" detection — could disable the row or
  show a checkmark

### 5.5 Card detail (`card/[id].tsx`)

**Goal:** make a single card feel like an exhibit. Status + price.

**Layout:**
- Top bar: back arrow · trash icon (only if in collection)
- Card hero: 220×308 image, no chrome, centered
- Meta block: eyebrow with set + number + rarity, display name, HP +
  type line
- Status pills: Have / Want / Really want (Chip component, active
  state coloured)
- Price block: `surface` tile with eyebrow `EU market avg · Cardmarket`,
  large display price, "Low" alongside. Sparkline below using avg30,
  avg7, avg1, trend as waypoints. "Updated YYYY-MM-DD" caption.
- Breakdown: list of `Low / Trend / Avg sale / 7-day avg / 30-day avg`
  in mono.

**Interactions:**
- Tap a status pill → upserts (if new) or updates status (if existing)
- Tap trash → confirm alert → delete + back

**Polish needed:**
- **Real price history.** The sparkline is currently a 6-point fake
  from avg waypoints. Wire up `price_snapshots` (see §8).
- Range selector (7D / 30D / 90D / 1Y / All) above the chart
- Cardmarket deep-link button (open `card.cardmarket.url` in browser)
- TCGplayer prices alongside Cardmarket
- Card metadata: attacks, weakness, resistance, retreat cost —
  PokemonTCG.io includes all of these
- Quantity stepper for `quantity` field

### 5.6 Wantlist (`(tabs)/wantlist.tsx`)

**Goal:** the hunt list, prioritised, with total cost.

**Layout:**
- Eyebrow with count + total cost
- Display title `The hunt`
- Section: **Really want** (rose dot + rose-tinted borders on rows)
- Section: **Wantlist** (amber dot, default borders)

**States:**
- Empty: copy "No cards on your wantlist yet."

**Polish needed:**
- Sort within section (default = `added_at desc`; alternatives = price
  asc/desc, name)
- Mark-as-acquired CTA on each row (one tap → flips to "have")
- Group by set when section gets long
- Export wantlist as text / share (useful for Cardmarket searches)

### 5.7 Profile (`(tabs)/profile.tsx`)

**Goal:** account info + settings + escape hatch.

**Layout:**
- Eyebrow: `Trainer profile`
- Avatar (initial of email, accent fill) + name (email username) +
  email (mono caption)
- Two big stat tiles: Cards owned, Collection · EU
- Account section: Price region (EU · €), Default binder size (3×3)
- Sign-out button (rose text on bordered surface)

**Polish needed:**
- Make settings rows actually configurable (route to detail pages)
- Add: Currency (€, £, $), Dark/Light, Notifications toggle, Data
  export
- Show recent activity stream (last 5 status changes)
- Add a destructive "Delete account" CTA below sign-out

---

## 6. Data model

### 6.1 `collections` table (Supabase)

| Column              | Type           | Notes                                                |
|---------------------|----------------|------------------------------------------------------|
| `id`                | uuid (pk)      | auto                                                 |
| `user_id`           | uuid (fk)      | references `auth.users(id)`, cascade delete         |
| `card_id`           | text           | PokemonTCG.io id like `"base1-4"`                    |
| `card_name`         | text           | denormalized for fast list render                    |
| `set_id`            | text           |                                                       |
| `set_name`          | text           |                                                       |
| `card_number`       | text           | `"4/102"` form (string — not all cards are numeric)  |
| `rarity`            | text?          | `"Rare Holo"`                                        |
| `card_type`         | text?          | first type only — covers 95% of cards                |
| `image_small`       | text?          | PokemonTCG.io CDN URL                                |
| `image_large`       | text?          | PokemonTCG.io CDN URL                                |
| `status`            | enum           | `'have' \| 'want' \| 'really'` — CHECK constraint    |
| `quantity`          | int            | default 1; supports multi-copy tracking              |
| `condition`         | text           | default `'NM'`; values: NM/EX/GD/LP/MP/HP            |
| `notes`             | text?          | free-form                                            |
| `last_price_eur`    | numeric(10,2)? | snapshot of Cardmarket trend at add/refresh time     |
| `price_checked_at`  | timestamptz?   |                                                       |
| `added_at`          | timestamptz    | default `now()`                                      |
| `updated_at`        | timestamptz    | trigger keeps in sync                                |
| **unique**          | `(user_id, card_id)` |                                                |

RLS: only the row's owner can select/insert/update/delete (`auth.uid()
= user_id`).

### 6.2 `price_snapshots` table (optional)

Stub table for daily price history. Empty in v1; an Edge Function
should populate it.

| Column      | Type           | Notes                                |
|-------------|----------------|--------------------------------------|
| `card_id`   | text           | composite PK                         |
| `taken_at`  | date           | composite PK                         |
| `price_eur` | numeric(10,2)  |                                       |
| `source`    | text           | default `'cardmarket'`, composite PK |

Readable by anyone signed-in; writes restricted (only Edge Functions
should ever write).

### 6.3 What we don't store

- The full PokemonTCG.io card catalogue. Fetched on demand and cached
  in React Query.
- Card images. URLs only; images are served from PokemonTCG.io's CDN.
- The user's password (Supabase Auth).

---

## 7. Interactions & motion

Currently sparse. Recommended additions:

| Surface              | Motion                                                                            |
|----------------------|-----------------------------------------------------------------------------------|
| Status change        | Border colour cross-fades (200ms) instead of jump-cut                             |
| Card add             | New card slot scales in from 0.92 → 1 with rose glow flash if status="really"     |
| Page change (binder) | Slide spring transition, page dots animate                                        |
| Long-press status    | Bottom sheet rises from below, dimmed backdrop                                    |
| Hero value           | Number rolls up from 0 on first home-screen visit per session (use react-native-reanimated `useDerivedValue`) |
| Empty states         | Gentle pulse on the dashed CTA border                                             |

Use `react-native-reanimated` (already a dep) for everything; avoid
the JS `Animated` API.

---

## 8. Feature roadmap

### 8.1 Done in v1 (this repo)

- ✅ Supabase auth (email + password)
- ✅ Collection CRUD with RLS
- ✅ Lookup against PokemonTCG.io
- ✅ Cardmarket price displayed live
- ✅ Have / Want / Really borders with glow
- ✅ Binder pagination + filter
- ✅ Optimistic status mutations
- ✅ Card detail with price block + breakdown
- ✅ Wantlist + total cost
- ✅ Sign-out

### 8.2 Polish (1–2 days each)

- [ ] **Real fonts.** `@expo-google-fonts/cormorant-garamond` +
      `@expo-google-fonts/manrope` + `@expo-google-fonts/jetbrains-mono`.
- [ ] **Bottom sheet for status picker** (replace long-press cycle).
- [ ] **Set picker** — currently the binder shows all of a user's
      cards; add a horizontal scroll of sets along the top of the
      binder screen.
- [ ] **Grid size picker** (1×1 / 2×2 / 3×3 / 4×3 / 4×4).
- [ ] **Page swipe gesture** with `react-native-gesture-handler`.
- [ ] **Empty states everywhere** — illustrated, with primary CTA.
- [ ] **Error toasts** instead of native `Alert`.
- [ ] **Pull-to-refresh** on Home, Binder, Wantlist (re-fetch prices).
- [ ] **Forgot password** + email OAuth.
- [ ] **Quantity + condition tracker** on detail.

### 8.3 v2 (deeper work)

- [ ] **Daily price snapshots** via Supabase Edge Function +
      `pg_cron`. Real 90-day chart on detail screen.
- [ ] **Top movers** widget on Home.
- [ ] **Card metadata** on detail: attacks, weakness, retreat cost.
- [ ] **Cardmarket deep-link** to buy.
- [ ] **TCGplayer prices** as a second region.
- [ ] **Multi-language** — PokemonTCG.io is English-only; need a
      translation layer for non-en card names.
- [ ] **Real-time sync** via supabase-js Realtime channel.
- [ ] **Offline mutations queue** (WatermelonDB or PowerSync).
- [ ] **Push notifications** for price spikes (Supabase function +
      Expo notifications).
- [ ] **Public collection share link** (read-only RLS-bypass via a
      view).

### 8.4 Out of scope

- Trading, marketplace, peer-to-peer messaging
- Deck building / play modes
- Image upload for owned-card photos (storage cost + grading is hard)
- PSA / BGS grade tracking (separate domain entirely)

---

## 9. Accessibility checklist

Currently **unaudited**. Before shipping:

- [ ] All `Pressable` elements have an `accessibilityLabel` and
      `accessibilityRole`.
- [ ] Status colours meet 3:1 contrast against `bg` (`statusHave` and
      `statusWant` are borderline — check with a tool).
- [ ] Text colour contrast: `text` on `bg` is fine (~15:1);
      `textMute` on `bg` is only ~3:1 (passes for caption but not body
      copy — make sure it's never used for actionable content).
- [ ] Dynamic Type support — wrap critical font sizes with
      `useWindowDimensions().fontScale` or use `PixelRatio.getFontScale`.
- [ ] `Image` components have `accessibilityLabel` describing the
      card (e.g. `"Charizard, Base Set, holo rare"`).
- [ ] Reduce-Motion guard on all reanimated transitions.

---

## 10. Open questions

Decisions that need a product owner before further development:

1. **Multi-copy support.** Schema has `quantity`; should the UI
   surface this everywhere (a `×3` badge on the binder slot) or only
   on detail?
2. **One binder vs many.** Real collectors keep separate binders per
   set / type. v1 is "everything in one binder, filter by status".
   Should v2 introduce user-created binders?
3. **What is "Really want"?** Currently shown as a third status. Some
   apps use a number (1–5 priority). Worth A/B testing.
4. **Onboarding flow.** Today a new user hits an empty Home. Should
   there be a first-run "what's your favourite set?" → pre-populate a
   wantlist?
5. **Pricing accuracy disclaimer.** Cardmarket trend prices are
   averages; they don't account for condition. Where do we say so?
6. **Mobile-only or also web?** Expo can target web; the design works
   responsively. Decide before investing in landscape layouts.

---

## 11. File / code conventions

- **TypeScript everywhere.** `strict: true` in tsconfig.
- **No CSS / no class names.** Inline styles only, using `theme`
  tokens. Style objects can be defined as `const` if reused — never
  call them `styles` at module level (collides across files in some
  bundler configs).
- **Hooks live in `lib/`.** Components consume hooks; components
  never `await supabase.from()` directly.
- **React Query for all server state.** No Redux, no Zustand, no
  `useEffect` + `useState` data fetching.
- **`expo-router` v4** with file-based routing. Dynamic params
  read via `useLocalSearchParams`.
- **Comments** explain *why*, not *what*. Lean.

---

## 12. Where the design comp lives

- Interactive HTML prototype: `pokemon-app.html` in the parent
  project (renders all 3 directions side-by-side on a design canvas,
  plus a Tweaks panel for grid size / card style / status colours /
  accent / light mode).
- The Vault direction was chosen as the ship target. Ember and Holo
  are reserve directions you can port in by duplicating
  `lib/theme.ts` and adding a theme switcher.

---

*Last updated:* May 2026. Maintain this doc as you ship — it's the
single source of truth for design decisions.
