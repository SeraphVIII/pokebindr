// Curator engine: arranges collection rows and card facts into ranked,
// fully-specified page ideas. Pure functions, no IO.

import type { BinderPage, CardFacts, CollectionRow, PaletteEntry } from './types';
import { cardImages } from './tcgdex';

export type Archetype =
  | 'ladder' | 'centerpiece' | 'artist' | 'timeline' | 'monotype' | 'showcase'
  | 'hueflow' | 'monochrome' | 'panorama';

/** An unowned card that would complete a page, resolved from a set's card list. */
export interface GhostCard {
  card_id: string;
  name: string;
  card_number: string;
  rarity: string | null;
  set_id: string;
  set_name: string;
  image_small: string | null;
  image_large: string | null;
}

export interface IdeaSlot {
  kind: 'card' | 'ghost' | 'empty';
  row?: CollectionRow;
  ghost?: GhostCard;
}

export interface PageIdea {
  id: string;                 // stable fingerprint; dismiss/applied state keys on it
  archetype: Archetype;
  title: string;              // becomes the binder page title on apply
  reason: string;             // one-line sell shown under the title
  score: number;
  slots: IdeaSlot[];          // length = cols * gridRows, reading order
  /** Rows to move on apply, parallel to slotOffsets (slot index in the new page). */
  moveRowIds: string[];
  slotOffsets: number[];
  /** Cards that would leave a manually titled page. */
  disruption: { count: number; pageTitles: string[] };
}

/** Card entry in TCGdex's set detail; matches TcgdexSetDetail.cards. */
export interface SetCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
  rarity?: string;
}

/** A panorama candidate pair awaiting pixel verification. */
export interface PanoramaPairReq {
  key: string;
  left: { card_id: string; image: string };
  right: { card_id: string; image: string };
}

export const pairKey = (l: string, r: string) => `${l}|${r}`;

/** Minimum edge-continuity score for a pair to count as connecting art;
 *  unrelated artworks measure roughly 0.35-0.50. */
export const PANORAMA_MIN = 0.6;

export interface GenerateInput {
  rows: CollectionRow[];
  facts: Map<string, CardFacts>;
  cols: number;
  gridRows: number;
  pages: BinderPage[];
  /** set_id → releaseDate (ISO). Orders timeline + artist pages. */
  setDates: Map<string, string>;
  /** set_id → full card list, used to resolve ghost slots. The screen fetches
   *  lists for `neededSets` and regenerates. */
  setLists?: Map<string, SetCardBrief[]>;
  /** "leftId|rightId" → edge-continuity score from card_pairs / the
   *  card-panorama function. Unknown pairs surface via `neededPairs`. */
  pairScores?: Map<string, number>;
  /** Idea ids to suppress (dismissed or already applied). */
  suppressed?: Set<string>;
}

export interface GenerateResult {
  ideas: PageIdea[];
  /** Sets whose card list would let us resolve ghost slots — the screen
   *  fetches these (capped) and calls generateIdeas again. */
  neededSets: string[];
  /** Panorama candidate pairs with no verdict yet — the screen sends these
   *  to the card-panorama function and calls generateIdeas again. */
  neededPairs: PanoramaPairReq[];
}

const MAX_IDEAS = 15;
const MAX_NEEDED_SETS = 4;
const MAX_NEEDED_PAIRS = 12;

// ─────────────────────────────────────────────────────────────
// Name + fact helpers
// ─────────────────────────────────────────────────────────────

/** Normalize a card name for evolveFrom matching: strip mechanic suffixes
 *  ("Gardevoir ex" → "gardevoir") but keep regional/owner prefixes. */
export function normName(raw: string): string {
  let n = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  // Repeatedly strip trailing mechanic tokens ("charizard vmax" → "charizard").
  const SUFFIX = /\s+(ex|gx|v|vmax|vstar|v-union|break|lv\.?\s?x|◇|☆|prism star|star)$/;
  for (let guard = 0; guard < 3 && SUFFIX.test(n); guard++) n = n.replace(SUFFIX, '');
  return n;
}

function stageRank(f: CardFacts | undefined): 0 | 1 | 2 | null {
  if (!f) return null;
  const s = (f.stage ?? '').toLowerCase();
  if (s.includes('basic')) return 0;
  if (s.includes('1')) return 1;
  if (s.includes('2')) return 2;
  // VMAX / VSTAR / Mega etc. carry evolveFrom but no numeric stage; their
  // rank is resolved relative to their target during chain building.
  if (f.evolve_from) return null;
  if ((f.category ?? '').toLowerCase() === 'pokemon') return 0;
  return null;
}

function isPokemon(f: CardFacts | undefined, row: CollectionRow): boolean {
  if (f?.category) return f.category.toLowerCase() === 'pokemon';
  // Facts missing (enrichment miss); fall back on the denormalized type.
  return row.card_type != null;
}

const SPECIAL_RARITY =
  /(holo|ultra|secret|illustration|special|hyper|rainbow|full ?art|amazing|radiant|shiny|gold|ace|double rare|crown|star)/i;

function isSpecialRarity(rarity: string | null): boolean {
  return !!rarity && SPECIAL_RARITY.test(rarity);
}

/** Rarity + price sparkle, shared by every archetype's score. */
function spice(rows: CollectionRow[]): number {
  let s = 0;
  let rare = 0;
  for (const r of rows) {
    s += Math.min(r.last_price_eur ?? 0, 40) / 8;
    if (isSpecialRarity(r.rarity)) rare += 2;
  }
  return s + Math.min(rare, 12);
}

/** djb2 over the cards that make up the idea; stable across regenerations
 *  as long as the same physical cards produce the same page. */
function fingerprint(archetype: Archetype, slots: IdeaSlot[]): string {
  const ids = slots
    .map((s) => (s.kind === 'card' ? s.row!.id : s.kind === 'ghost' ? `g:${s.ghost!.card_id}` : ''))
    .filter(Boolean)
    .sort();
  const str = `${archetype}|${ids.join('|')}`;
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${archetype}-${(h >>> 0).toString(36)}`;
}

function disruptionFor(
  moved: CollectionRow[],
  pages: BinderPage[],
  slotsPerPage: number,
): { count: number; pageTitles: string[] } {
  const titleByIndex = new Map<number, string>();
  for (const p of pages) if (p.title) titleByIndex.set(p.page_index, p.title);
  let count = 0;
  const titles = new Set<string>();
  for (const r of moved) {
    const t = titleByIndex.get(Math.floor(r.position / slotsPerPage));
    if (t) {
      count++;
      titles.add(t);
    }
  }
  return { count, pageTitles: [...titles].slice(0, 2) };
}

function buildIdea(
  archetype: Archetype,
  title: string,
  reason: string,
  baseScore: number,
  slots: IdeaSlot[],
  input: GenerateInput,
): PageIdea {
  const moved = slots.filter((s) => s.kind === 'card').map((s) => s.row!);
  const moveRowIds: string[] = [];
  const slotOffsets: number[] = [];
  slots.forEach((s, i) => {
    if (s.kind === 'card') {
      moveRowIds.push(s.row!.id);
      slotOffsets.push(i);
    }
  });
  const slotsPerPage = input.cols * input.gridRows;
  const disruption = disruptionFor(moved, input.pages, slotsPerPage);
  const ghosts = slots.filter((s) => s.kind === 'ghost').length;
  const score = baseScore + spice(moved) - ghosts * 6 - disruption.count * 8;
  return {
    id: fingerprint(archetype, slots),
    archetype, title, reason, score, slots, moveRowIds, slotOffsets, disruption,
  };
}

const emptySlot = (): IdeaSlot => ({ kind: 'empty' });

// ─────────────────────────────────────────────────────────────
// Ladder — evolution lines as rows
// ─────────────────────────────────────────────────────────────

interface Line {
  nodes: CollectionRow[];      // ordered base → final stage (gap excluded)
  ghost: GhostCard | null;     // resolved missing stage
  ghostName: string | null;    // unresolved missing stage (needs set list)
  ghostIndex: number;          // where the missing stage sits within the line
  setId: string;
  complete: boolean;           // fills a full row with no ghost
}

function buildLadderIdeas(input: GenerateInput, neededSets: Set<string>): PageIdea[] {
  const { rows, facts, cols, gridRows } = input;
  if (cols < 3) return []; // 1–2 wide grids can't hold a readable line

  const bySet = new Map<string, CollectionRow[]>();
  for (const r of rows) {
    if (!isPokemon(facts.get(r.card_id), r)) continue;
    const list = bySet.get(r.set_id) ?? [];
    list.push(r);
    bySet.set(r.set_id, list);
  }

  const ideas: PageIdea[] = [];

  for (const [setId, setRows] of bySet) {
    if (setRows.length < 4) continue;
    const setName = setRows[0].set_name;

    const byBase = new Map<string, CollectionRow[]>();
    for (const r of setRows) {
      const base = normName(r.card_name);
      const list = byBase.get(base) ?? [];
      list.push(r);
      byBase.set(base, list);
    }
    const fromOf = (r: CollectionRow) => {
      const f = facts.get(r.card_id)?.evolve_from;
      return f ? normName(f) : null;
    };

    // Tops: cards nothing owned in this set evolves from.
    const evolvedFromBases = new Set<string>();
    for (const r of setRows) {
      const f = fromOf(r);
      if (f) evolvedFromBases.add(f);
    }
    const used = new Set<string>(); // row ids consumed by a line
    const tops = setRows
      .filter((r) => fromOf(r) && !evolvedFromBases.has(normName(r.card_name)))
      .sort((a, b) => (b.last_price_eur ?? 0) - (a.last_price_eur ?? 0));

    const lines: Line[] = [];
    for (const top of tops) {
      if (used.has(top.id)) continue;
      const chain: CollectionRow[] = [top];
      let ghostName: string | null = null;
      let cur = top;
      for (let guard = 0; guard < 5; guard++) {
        const want = fromOf(cur);
        if (!want) break;
        const candidates = (byBase.get(want) ?? []).filter((c) => !used.has(c.id) && c.id !== top.id);
        if (!candidates.length) {
          ghostName = want;
          break;
        }
        // Prefer the lowest-stage print of the pre-evolution.
        candidates.sort(
          (a, b) => (stageRank(facts.get(a.card_id)) ?? 3) - (stageRank(facts.get(b.card_id)) ?? 3),
        );
        chain.unshift(candidates[0]);
        cur = candidates[0];
      }

      // Bridge a one-card gap: evolution families are usually consecutive dex
      // numbers, so a basic two dex ids below the chain's bottom sits under the gap.
      let ghostIndex = 0;
      if (ghostName) {
        const bottomDex = facts.get(chain[0].card_id)?.dex_ids?.[0];
        if (bottomDex != null) {
          const bridge = setRows.find((r) =>
            !used.has(r.id)
            && !chain.some((c) => c.id === r.id)
            && facts.get(r.card_id)?.dex_ids?.[0] === bottomDex - 2
            && stageRank(facts.get(r.card_id)) === 0,
          );
          if (bridge) {
            chain.unshift(bridge);
            ghostIndex = 1;
          }
        }
      }

      if (chain.length < 2 && !ghostName) continue;
      const nodes = chain.slice(-cols); // over-long chains keep the top end
      for (const n of nodes) used.add(n.id);
      const lineLen = nodes.length + (ghostName ? 1 : 0);
      lines.push({
        nodes,
        ghost: null,
        ghostName: lineLen <= cols ? ghostName : null,
        ghostIndex,
        setId,
        complete: nodes.length >= 3 && !ghostName,
      });
    }
    if (!lines.length) continue;

    // Resolve ghosts from the set's card list when available.
    for (const line of lines) {
      if (!line.ghostName) continue;
      const list = input.setLists?.get(setId);
      if (!list) {
        neededSets.add(setId);
        continue;
      }
      const hit = list.find((c) => normName(c.name) === line.ghostName);
      if (hit) {
        const img = cardImages(hit.image, setId, hit.localId);
        line.ghost = {
          card_id: hit.id,
          name: hit.name,
          card_number: hit.localId,
          rarity: hit.rarity ?? null,
          set_id: setId,
          set_name: setName,
          image_small: img.small || null,
          image_large: img.large || null,
        };
        line.ghostName = null;
      }
    }

    // Best lines first: complete, then ghost-completable, then duos.
    const weight = (l: Line) => (l.complete ? 0 : l.ghost ? 1 : 2);
    lines.sort((a, b) => weight(a) - weight(b) || b.nodes.length - a.nodes.length);

    for (let i = 0; i < lines.length; i += gridRows) {
      const group = lines.slice(i, i + gridRows);
      const strong = group.filter((l) => l.complete || (l.ghost && l.nodes.length >= 2));
      if (group.length < Math.min(2, gridRows) || strong.length === 0) continue;

      const slots: IdeaSlot[] = Array.from({ length: cols * gridRows }, emptySlot);
      group.forEach((line, rowIdx) => {
        const cells: IdeaSlot[] = line.nodes.map((row) => ({ kind: 'card', row }));
        if (line.ghost) {
          cells.splice(line.ghostIndex, 0, { kind: 'ghost', ghost: line.ghost });
        } else if (line.ghostName && line.ghostIndex > 0) {
          // Bridged but unresolved; hold the gap open so the two owned
          // stages don't read as a direct evolution.
          cells.splice(line.ghostIndex, 0, emptySlot());
        }
        // A line missing its first stage with nothing to show there is
        // right-aligned so the final stage still lands in the last column.
        const start = line.ghostName && !line.ghost && line.ghostIndex === 0
          ? rowIdx * cols + Math.max(0, Math.min(cols, 3) - cells.length)
          : rowIdx * cols;
        cells.slice(0, cols).forEach((c, j) => { slots[start + j] = c; });
      });

      const completeCount = group.filter((l) => l.complete).length;
      const ghostCount = group.filter((l) => l.ghost).length;
      // Ghost lines are weighted so that after buildIdea's ghost penalty
      // they still rank between complete lines and duos.
      const base = 100 + completeCount * 18 + ghostCount * 14
        + (group.length - completeCount - ghostCount) * 6;
      const reason = ghostCount > 0
        ? `${group.length} evolution ${group.length === 1 ? 'line' : 'lines'} from ${setName} — ${ghostCount} missing card${ghostCount > 1 ? 's' : ''} shown as slots to hunt`
        : `${group.length} evolution ${group.length === 1 ? 'line' : 'lines'} from ${setName}, Basic → final stage across each row`;
      ideas.push(buildIdea('ladder', `${setName} lines`, reason, base, slots, input));
    }
  }
  return ideas;
}

// ─────────────────────────────────────────────────────────────
// Centerpiece — chase card enthroned, relatives orbiting
// ─────────────────────────────────────────────────────────────

function buildCenterpieceIdeas(input: GenerateInput): PageIdea[] {
  const { rows, facts, cols, gridRows } = input;
  if (cols < 3 || gridRows < 3 || cols % 2 === 0 || gridRows % 2 === 0) return [];
  const slotsPerPage = cols * gridRows;
  const centerIdx = Math.floor(gridRows / 2) * cols + Math.floor(cols / 2);

  const pokemon = rows.filter((r) => isPokemon(facts.get(r.card_id), r));
  const chases = [...pokemon]
    .filter((r) => (r.last_price_eur ?? 0) > 0 || isSpecialRarity(r.rarity))
    .sort((a, b) => (b.last_price_eur ?? 0) - (a.last_price_eur ?? 0))
    .slice(0, 2);

  const dexOf = (r: CollectionRow) => facts.get(r.card_id)?.dex_ids ?? [];
  const relation = (chase: CollectionRow, r: CollectionRow): number => {
    const cd = dexOf(chase);
    const rd = dexOf(r);
    if (cd.some((d) => rd.includes(d))) return 1;
    if (normName(chase.card_name) === normName(r.card_name)) return 1;
    const cf = facts.get(chase.card_id)?.evolve_from;
    const rf = facts.get(r.card_id)?.evolve_from;
    if (cf && normName(cf) === normName(r.card_name)) return 1;
    if (rf && normName(rf) === normName(chase.card_name)) return 1;
    if (r.set_id === chase.set_id && r.card_type === chase.card_type) return 2;
    if (r.card_type != null && r.card_type === chase.card_type) return 3;
    return 4;
  };

  const ideas: PageIdea[] = [];
  for (const chase of chases) {
    const ring = pokemon
      .filter((r) => r.id !== chase.id)
      .map((r) => ({ r, rel: relation(chase, r) }))
      .filter((x) => x.rel <= 3)
      .sort((a, b) => a.rel - b.rel || (b.r.last_price_eur ?? 0) - (a.r.last_price_eur ?? 0))
      .slice(0, slotsPerPage - 1);
    if (ring.length < slotsPerPage - 1) continue;

    const slots: IdeaSlot[] = Array.from({ length: slotsPerPage }, emptySlot);
    slots[centerIdx] = { kind: 'card', row: chase };
    let cursor = 0;
    for (const { r } of ring) {
      while (cursor === centerIdx) cursor++;
      slots[cursor++] = { kind: 'card', row: r };
    }

    const kin = ring.filter((x) => x.rel === 1).length;
    const price = chase.last_price_eur;
    const reason = kin > 0
      ? `${price ? `Your €${price.toFixed(2)} ` : 'Your '}${chase.card_name} at the centre, ${kin} of its kin in the ring`
      : `${price ? `Your €${price.toFixed(2)} ` : 'Your '}${chase.card_name} at the centre of a ${chase.card_type ?? ''} court`;
    const base = 90 + Math.min(price ?? 0, 100) / 5 + kin * 3;
    ideas.push(buildIdea('centerpiece', `${chase.card_name} centerpiece`, reason, base, slots, input));
  }
  return ideas;
}

// ─────────────────────────────────────────────────────────────
// Artist — one illustrator per page
// ─────────────────────────────────────────────────────────────

function buildArtistIdeas(input: GenerateInput): PageIdea[] {
  const { rows, facts, cols, gridRows, setDates } = input;
  const slotsPerPage = cols * gridRows;
  const minFill = Math.ceil(slotsPerPage * 2 / 3);

  const byArtist = new Map<string, CollectionRow[]>();
  for (const r of rows) {
    const a = facts.get(r.card_id)?.illustrator;
    if (!a) continue;
    const list = byArtist.get(a) ?? [];
    list.push(r);
    byArtist.set(a, list);
  }

  const ideas: PageIdea[] = [];
  for (const [artist, cards] of byArtist) {
    if (cards.length < minFill) continue;
    const picked = [...cards]
      .sort((a, b) =>
        (b.last_price_eur ?? 0) - (a.last_price_eur ?? 0)
        || (isSpecialRarity(b.rarity) ? 1 : 0) - (isSpecialRarity(a.rarity) ? 1 : 0))
      .slice(0, slotsPerPage)
      // Hang the gallery chronologically: set release, then collector number.
      .sort((a, b) =>
        (setDates.get(a.set_id) ?? '9999').localeCompare(setDates.get(b.set_id) ?? '9999')
        || (parseInt(a.card_number, 10) || 0) - (parseInt(b.card_number, 10) || 0));

    const slots: IdeaSlot[] = Array.from({ length: slotsPerPage }, emptySlot);
    picked.forEach((row, i) => { slots[i] = { kind: 'card', row }; });

    const setCount = new Set(picked.map((p) => p.set_id)).size;
    const base = 85 + Math.min(cards.length - slotsPerPage, 10)
      - (slotsPerPage - picked.length) * 4;
    ideas.push(buildIdea(
      'artist',
      `Illustrated by ${artist}`,
      `${picked.length} cards in this binder share one artist, across ${setCount} set${setCount === 1 ? '' : 's'}`,
      base, slots, input,
    ));
  }
  return ideas;
}

// ─────────────────────────────────────────────────────────────
// Timeline — one Pokémon through the years
// ─────────────────────────────────────────────────────────────

function buildTimelineIdeas(input: GenerateInput): PageIdea[] {
  const { rows, facts, cols, gridRows, setDates } = input;
  const slotsPerPage = cols * gridRows;

  const byDex = new Map<number, CollectionRow[]>();
  for (const r of rows) {
    const dex = facts.get(r.card_id)?.dex_ids?.[0];
    if (dex == null) continue;
    const list = byDex.get(dex) ?? [];
    list.push(r);
    byDex.set(dex, list);
  }

  const ideas: PageIdea[] = [];
  for (const cards of byDex.values()) {
    const sets = new Set(cards.map((c) => c.set_id));
    if (cards.length < 4 || sets.size < 3) continue;

    const picked = [...cards]
      .sort((a, b) =>
        (setDates.get(a.set_id) ?? '9999').localeCompare(setDates.get(b.set_id) ?? '9999'))
      .slice(0, slotsPerPage);
    const slots: IdeaSlot[] = Array.from({ length: slotsPerPage }, emptySlot);
    picked.forEach((row, i) => { slots[i] = { kind: 'card', row }; });

    // The plain print carries the species name; suffixed prints are longer.
    const species = [...picked].sort((a, b) => a.card_name.length - b.card_name.length)[0].card_name;
    const years = picked
      .map((p) => (setDates.get(p.set_id) ?? '').slice(0, 4))
      .filter(Boolean);
    const span = years.length ? `${years[0]}–${years[years.length - 1]}` : '';
    const base = 80 + picked.length * 2 + new Set(years).size;
    ideas.push(buildIdea(
      'timeline',
      `${species} through the years`,
      `${picked.length} prints across ${sets.size} sets${span ? `, ${span}` : ''}`,
      base, slots, input,
    ));
  }
  return ideas;
}

// ─────────────────────────────────────────────────────────────
// Panorama — connecting artworks, pixel-verified
// ─────────────────────────────────────────────────────────────

function buildPanoramaIdeas(
  input: GenerateInput,
  neededPairs: Map<string, PanoramaPairReq>,
): PageIdea[] {
  const { rows, facts, cols, gridRows, pairScores } = input;
  if (cols < 2) return [];
  const slotsPerPage = cols * gridRows;
  const ideas: PageIdea[] = [];

  const bySet = new Map<string, CollectionRow[]>();
  for (const r of rows) {
    const list = bySet.get(r.set_id) ?? [];
    list.push(r);
    bySet.set(r.set_id, list);
  }

  for (const setRows of bySet.values()) {
    // Candidates: same illustrator, consecutive collector numbers, same
    // rarity. Pixel verification confirms.
    const byArtist = new Map<string, CollectionRow[]>();
    for (const r of setRows) {
      const a = facts.get(r.card_id)?.illustrator;
      if (!a) continue;
      const list = byArtist.get(a) ?? [];
      list.push(r);
      byArtist.set(a, list);
    }

    for (const [artist, cards] of byArtist) {
      if (cards.length < 2) continue;
      const seen = new Set<string>();
      const uniq = cards
        .filter((r) => !seen.has(r.card_id) && (seen.add(r.card_id), true))
        .map((r) => ({ r, n: parseInt(r.card_number, 10) }))
        .filter((x) => Number.isFinite(x.n))
        .sort((a, b) => a.n - b.n);

      // Walk adjacency; verified pairs extend a segment, failed pairs cut
      // it, unknown pairs cut it AND get queued for verification.
      let seg: { r: CollectionRow; score: number }[] = [];
      const segments: (typeof seg)[] = [];
      const flush = () => {
        if (seg.length >= 2) segments.push(seg);
        seg = [];
      };
      for (let i = 0; i < uniq.length; i++) {
        const cur = uniq[i];
        if (!seg.length) {
          seg = [{ r: cur.r, score: 0 }];
          continue;
        }
        const prev = uniq[i - 1];
        const adjacent = cur.n === prev.n + 1 && cur.r.rarity === prev.r.rarity;
        if (!adjacent) {
          flush();
          seg = [{ r: cur.r, score: 0 }];
          continue;
        }
        const key = pairKey(prev.r.card_id, cur.r.card_id);
        const score = pairScores?.get(key);
        if (score === undefined) {
          if (prev.r.image_small && cur.r.image_small) {
            neededPairs.set(key, {
              key,
              left: { card_id: prev.r.card_id, image: prev.r.image_small },
              right: { card_id: cur.r.card_id, image: cur.r.image_small },
            });
          }
          flush();
          seg = [{ r: cur.r, score: 0 }];
        } else if (score >= PANORAMA_MIN) {
          seg.push({ r: cur.r, score });
        } else {
          flush();
          seg = [{ r: cur.r, score: 0 }];
        }
      }
      flush();

      for (const s of segments) {
        const strip = s.slice(0, cols);
        const stripIds = new Set(strip.map((x) => x.r.id));
        // Supporting cast under the panorama: same artist first, then the
        // rest of the set, in collector order.
        const fill = [
          ...cards.filter((r) => !stripIds.has(r.id)),
          ...setRows.filter(
            (r) => !stripIds.has(r.id) && facts.get(r.card_id)?.illustrator !== artist,
          ),
        ].slice(0, slotsPerPage - cols);

        const slots: IdeaSlot[] = Array.from({ length: slotsPerPage }, emptySlot);
        strip.forEach(({ r }, i) => { slots[i] = { kind: 'card', row: r }; });
        fill.forEach((r, i) => { slots[cols + i] = { kind: 'card', row: r }; });

        const avg = s.slice(1).reduce((sum, x) => sum + x.score, 0) / (s.length - 1);
        ideas.push(buildIdea(
          'panorama',
          `${strip[0].r.set_name} panorama`,
          `${strip.length} adjacent artworks by ${artist} share one continuous scene (edge-matched ${Math.round(avg * 100)}%)`,
          105 + avg * 20, slots, input,
        ));
      }
    }
  }
  return ideas;
}

// ─────────────────────────────────────────────────────────────
// Colour pages — hue flow + monochrome, from extracted palettes
// ─────────────────────────────────────────────────────────────

/** Headline colour: the palette entry with the most saturation-weighted
 *  presence. Null for greyscale, very dark, or not-yet-extracted cards. */
function dominantColor(f: CardFacts | undefined): PaletteEntry | null {
  if (!f?.palette?.length) return null;
  let best: PaletteEntry | null = null;
  let bestScore = 0;
  for (const p of f.palette) {
    if (p.s < 0.22 || p.l < 0.1 || p.l > 0.88) continue;
    const score = p.w * p.s;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

const HUE_NAMES: Array<[number, string]> = [
  [0, 'Embers'], [30, 'Amber'], [60, 'Gold'], [90, 'Moss'],
  [120, 'Verdant'], [150, 'Jade'], [180, 'Teal'], [210, 'Deep sea'],
  [240, 'Indigo'], [270, 'Violet'], [300, 'Orchid'], [330, 'Rose'],
];

function hueName(h: number): string {
  const idx = Math.floor(((h % 360) + 360) % 360 / 30) % 12;
  return HUE_NAMES[idx][1];
}

function buildColorIdeas(input: GenerateInput): PageIdea[] {
  const { rows, facts, cols, gridRows } = input;
  const slotsPerPage = cols * gridRows;
  const minFill = Math.ceil(slotsPerPage * 2 / 3);
  const ideas: PageIdea[] = [];

  const colorful = rows
    .map((row) => ({ row, c: dominantColor(facts.get(row.card_id)) }))
    .filter((x): x is { row: CollectionRow; c: PaletteEntry } => !!x.c);
  if (colorful.length < minFill) return ideas;

  // Hue flow: proposed only when the owned hues sweep most of the wheel,
  // measured as 360° minus the largest gap between adjacent hues.
  if (colorful.length >= slotsPerPage) {
    const sorted = [...colorful].sort((a, b) => a.c.h - b.c.h);
    let largestGap = 360 - sorted[sorted.length - 1].c.h + sorted[0].c.h;
    for (let i = 1; i < sorted.length; i++) {
      largestGap = Math.max(largestGap, sorted[i].c.h - sorted[i - 1].c.h);
    }
    const span = 360 - largestGap;
    if (span >= 200) {
      // Evenly-strided picks keep the sweep smooth instead of clumping
      // where the collection happens to be dense.
      const picked: typeof sorted = [];
      for (let i = 0; i < slotsPerPage; i++) {
        picked.push(sorted[Math.floor((i * sorted.length) / slotsPerPage)]);
      }
      // Serpentine order: alternate row direction so the colour flows
      // continuously instead of snapping back at each row start.
      const slots: IdeaSlot[] = Array.from({ length: slotsPerPage }, emptySlot);
      picked.forEach(({ row }, i) => {
        const r = Math.floor(i / cols);
        const cIdx = r % 2 === 0 ? i % cols : cols - 1 - (i % cols);
        slots[r * cols + cIdx] = { kind: 'card', row };
      });
      ideas.push(buildIdea(
        'hueflow',
        'The spectrum',
        `${slotsPerPage} cards sweeping ${Math.round(span)}° of the colour wheel`,
        86, slots, input,
      ));
    }
  }

  // Monochrome — one narrow hue band, dark → light down the page.
  const buckets = new Map<number, typeof colorful>();
  for (const x of colorful) {
    const b = Math.floor(((x.c.h % 360) + 360) % 360 / 30);
    const list = buckets.get(b) ?? [];
    list.push(x);
    buckets.set(b, list);
  }
  for (const [b, cards] of buckets) {
    if (cards.length < minFill) continue;
    const picked = [...cards]
      .sort((a, b2) => b2.c.s * b2.c.w - a.c.s * a.c.w)
      .slice(0, slotsPerPage)
      .sort((a, b2) => a.c.l - b2.c.l);
    const slots: IdeaSlot[] = Array.from({ length: slotsPerPage }, emptySlot);
    picked.forEach(({ row }, i) => { slots[i] = { kind: 'card', row }; });
    const name = hueName(b * 30);
    ideas.push(buildIdea(
      'monochrome',
      `${name} monochrome`,
      `${picked.length} cards in one colour, dark to light`,
      68 + Math.min(cards.length - minFill, 8) - (slotsPerPage - picked.length) * 4,
      slots, input,
    ));
  }
  return ideas;
}

// ─────────────────────────────────────────────────────────────
// Fillers — monotype + rarity showcase (keep the feed non-empty)
// ─────────────────────────────────────────────────────────────

function buildFillerIdeas(input: GenerateInput): PageIdea[] {
  const { rows, cols, gridRows } = input;
  const slotsPerPage = cols * gridRows;
  const minFill = Math.ceil(slotsPerPage * 2 / 3);
  const localNum = (r: CollectionRow) => parseInt(r.card_number, 10) || 0;
  const ideas: PageIdea[] = [];

  // Monotype: one energy type from one set, full page.
  const byTypeSet = new Map<string, CollectionRow[]>();
  for (const r of rows) {
    if (!r.card_type) continue;
    const key = `${r.set_id}|${r.card_type}`;
    const list = byTypeSet.get(key) ?? [];
    list.push(r);
    byTypeSet.set(key, list);
  }
  for (const cards of byTypeSet.values()) {
    if (cards.length < slotsPerPage) continue;
    const picked = [...cards].sort((a, b) => localNum(a) - localNum(b)).slice(0, slotsPerPage);
    const slots: IdeaSlot[] = picked.map((row) => ({ kind: 'card', row } as IdeaSlot));
    ideas.push(buildIdea(
      'monotype',
      `${picked[0].card_type} — ${picked[0].set_name}`,
      `A full page of ${picked[0].card_type} from ${picked[0].set_name}`,
      50, slots, input,
    ));
  }

  // Showcase: a set's special rarities together.
  const specialsBySet = new Map<string, CollectionRow[]>();
  for (const r of rows) {
    if (!isSpecialRarity(r.rarity)) continue;
    const list = specialsBySet.get(r.set_id) ?? [];
    list.push(r);
    specialsBySet.set(r.set_id, list);
  }
  for (const cards of specialsBySet.values()) {
    if (cards.length < minFill) continue;
    const picked = [...cards]
      .sort((a, b) => (b.last_price_eur ?? 0) - (a.last_price_eur ?? 0))
      .slice(0, slotsPerPage)
      .sort((a, b) => localNum(a) - localNum(b));
    const slots: IdeaSlot[] = Array.from({ length: slotsPerPage }, emptySlot);
    picked.forEach((row, i) => { slots[i] = { kind: 'card', row }; });
    ideas.push(buildIdea(
      'showcase',
      `${picked[0].set_name} showcase`,
      `${picked.length} special rarities from ${picked[0].set_name} on one page`,
      60 - (slotsPerPage - picked.length) * 4, slots, input,
    ));
  }
  return ideas;
}

// ─────────────────────────────────────────────────────────────
// Top level
// ─────────────────────────────────────────────────────────────

export function generateIdeas(input: GenerateInput): GenerateResult {
  const neededSets = new Set<string>();
  const neededPairs = new Map<string, PanoramaPairReq>();
  let ideas = [
    ...buildPanoramaIdeas(input, neededPairs),
    ...buildLadderIdeas(input, neededSets),
    ...buildCenterpieceIdeas(input),
    ...buildArtistIdeas(input),
    ...buildTimelineIdeas(input),
    ...buildColorIdeas(input),
    ...buildFillerIdeas(input),
  ];

  if (input.suppressed?.size) {
    ideas = ideas.filter((i) => !input.suppressed!.has(i.id));
  }

  ideas.sort((a, b) => b.score - a.score);

  // Same-archetype near-duplicates (>60% card overlap) keep only the winner.
  const kept: PageIdea[] = [];
  for (const idea of ideas) {
    const cardIds = new Set(idea.moveRowIds);
    const dupe = kept.some((k) => {
      if (k.archetype !== idea.archetype) return false;
      const overlap = k.moveRowIds.filter((id) => cardIds.has(id)).length;
      return overlap / Math.max(1, Math.min(k.moveRowIds.length, cardIds.size)) > 0.6;
    });
    if (!dupe) kept.push(idea);
    if (kept.length >= MAX_IDEAS) break;
  }

  return {
    ideas: kept,
    neededSets: [...neededSets].slice(0, MAX_NEEDED_SETS),
    neededPairs: [...neededPairs.values()].slice(0, MAX_NEEDED_PAIRS),
  };
}
