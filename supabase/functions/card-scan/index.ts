// Edge Function: identify a Pokémon card from a photo. Runs Google Vision
// OCR, parses name / collector number / HP, then searches TCGdex and returns
// a ranked candidate list for the client to confirm.
//
// Secret required:  supabase secrets set GOOGLE_VISION_API_KEY=...
// Deploy:           supabase functions deploy card-scan --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TCGDEX_ROOT = 'https://api.tcgdex.net/v2';
const tcgdexBase = (locale: Locale) => `${TCGDEX_ROOT}/${locale}`;
const VISION = 'https://vision.googleapis.com/v1/images:annotate';

type Locale = 'en' | 'ja';
// Hiragana, katakana, or CJK kanji anywhere marks the card as Japanese,
// searched via TCGdex's /ja endpoint.
const JA_CHARS = /[぀-ヿ一-龯]/;
// Keep Latin + CJK so Japanese names survive cleaning and normalisation.
const KEEP_NAME = /[^A-Za-z0-9'.\-぀-ヿ一-龯 ]/g;
const KEEP_NORM = /[^a-z0-9぀-ヿ一-龯]+/g;

// ─────────────────────────────────────────────────────────────
// Google Vision
// ─────────────────────────────────────────────────────────────
interface Vertex { x?: number; y?: number }
interface TextAnnotation { description: string; boundingPoly?: { vertices: Vertex[] } }

async function runOcr(imageBase64: string, apiKey: string): Promise<TextAnnotation[]> {
  // Strip a data-URL prefix if present.
  const content = imageBase64.includes(',') ? imageBase64.split(',', 2)[1] : imageBase64;
  const r = await fetch(`${VISION}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content },
        features: [{ type: 'TEXT_DETECTION' }],
        // Hint both scripts so Vision doesn't mis-segment Japanese cards.
        imageContext: { languageHints: ['ja', 'en'] },
      }],
    }),
  });
  if (!r.ok) throw new Error(`Vision API ${r.status}: ${await r.text()}`);
  const json = await r.json();
  const err = json?.responses?.[0]?.error;
  if (err) throw new Error(`Vision error: ${err.message ?? 'unknown'}`);
  // textAnnotations[0] is the full text block (newline-separated lines,
  // top-to-bottom); [1..] are per-word boxes.
  return (json?.responses?.[0]?.textAnnotations ?? []) as TextAnnotation[];
}

// ─────────────────────────────────────────────────────────────
// Parse name / number / hp out of the OCR text
// ─────────────────────────────────────────────────────────────
// Tokens never part of a card name: evolution-stage labels and the HP marker.
const SKIP = /^(lv|stage|stage1|stage2|basic|evolves|evolution)\.?$/i;
const HP_STOP = /^hp$/i;

// Words from the card body that never appear in a name ("VSTAR Power",
// "Ability", the rules box, the stat row).
const BODY_WORD = /^(power|ability|abilities|rule|rules|weakness|resistance|retreat|trait)$/i;

/** Strip a line down to name-like tokens: drop digits, the HP label, slashes,
 *  stage and body words; keep punctuation used in real names (Mr. Mime, Ho-Oh). */
function cleanName(s: string): string {
  return s
    .split(/\s+/)
    .filter((t) => !/\d/.test(t) && !HP_STOP.test(t) && !t.includes('/') && !SKIP.test(t) && !BODY_WORD.test(t))
    .join(' ')
    .replace(KEEP_NAME, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Japanese stage / evolves-from lines ("○○から進化", "たね", "1進化");
// never part of a name.
const JA_SKIP = /進化|たね/;

// Corner badge words (VSTAR, GX...). Stripped only when leading: a trailing
// badge is part of the name ("Arceus VSTAR"). OCR often reads the VSTAR
// badge as a bare "STAR".
const BADGE = /^(v|vmax|vstar|gx|ex|star|mega|break|legend|prism|radiant|tag|team|prime)\.?$/i;

function stripLeadingBadges(name: string): string {
  const toks = name.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && BADGE.test(toks[0])) toks.shift();
  return toks.join(' ');
}

/** Ordered name guesses from the OCR text, scanned top-down in reading order.
 *  Stray non-name lines are harmless: guesses with no TCGdex hits are skipped. */
function nameCandidates(annotations: TextAnnotation[]): string[] {
  const fullText = annotations[0]?.description ?? '';
  const out: string[] = [];
  let scanned = 0;
  for (const raw of fullText.split('\n')) {
    const line = raw.trim();
    if (!line || !/[A-Za-z぀-ヿ一-龯]/.test(line)) continue; // skip blank / number-only lines
    if (++scanned > 12) break;                      // the name sits near the top
    if (line.split(/\s+/).length > 4 || JA_SKIP.test(line)) continue; // prose / evolves-from
    const c = stripLeadingBadges(cleanName(line));
    if (c.length >= 3 && !BODY_WORD.test(c)) out.push(c);
  }

  // Dedupe case-insensitively, keep order, cap the number of search round-trips.
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of out) {
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  return uniq.slice(0, 5);
}

// Known subset prefixes for lettered collector numbers (Galarian/Trainer
// Gallery, Shiny Vault, Radiant Collection). OCR glues set symbols and
// regulation marks onto the number, so only known prefixes embedded in the
// text are accepted.
const GALLERY = /(GG|TG|SV|RC)\s*(\d{1,3})/;

// Promo prefixes that print without a "/total" denominator (e.g. "SWSH039").
// Whitelisted so the HP block ("HP210") is not mistaken for a number.
const PROMO_PREFIX = /^(SWSH|SVP|XY|BW|DP|HGSS|PR)$/;

/** Parse the collector number into TCGdex `localId` form. The numeric
 *  "167/165" form wins over gallery prefixes so a set code printed near the
 *  number (e.g. "SV2a") is not misread as a gallery number. */
function parseCollectorNumber(fullText: string): { number?: string; total?: string } {
  const t = fullText.toUpperCase();

  // No leading \b: a glued regulation mark ("F056/159") would hide the match.
  // Leading zeros stripped; TCGdex localIds are unpadded.
  let m = t.match(/(\d{1,3})\s*\/\s*(\d{1,3})\b/);
  if (m) return { number: String(parseInt(m[1], 10)), total: m[2] };

  m = t.match(GALLERY);
  if (m) return { number: `${m[1]}${m[2]}` };

  m = t.match(/\b([A-Z]{2,4})(\d{2,4})\b/);
  if (m && PROMO_PREFIX.test(m[1])) return { number: `${m[1]}${m[2]}` };

  return {};
}

interface Parsed { name: string; candidates: string[]; number?: string; total?: string; hp?: string }

function parseCard(annotations: TextAnnotation[]): Parsed {
  const fullText = annotations[0]?.description ?? '';
  const { number, total } = parseCollectorNumber(fullText);
  const hp = fullText.match(/\bHP\s*(\d{2,3})\b/i) ?? fullText.match(/\b(\d{2,3})\s*HP\b/i);

  const candidates = nameCandidates(annotations);
  return {
    name: candidates[0] ?? '',
    candidates,
    number,
    total,
    hp: hp?.[1],
  };
}

// ─────────────────────────────────────────────────────────────
// TCGdex search + scoring
// ─────────────────────────────────────────────────────────────
interface Brief { id: string; localId: string; name: string; image?: string }

function norm(s: string): string {
  return s.toLowerCase().replace(KEEP_NORM, '');
}

/** Levenshtein-based similarity, 0..1. */
function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const m = x.length;
  const n = y.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

/** localId can be "16" / "016" / "TG12". Compare numerically when both look
 *  numeric, else fall back to a normalised string compare. */
function numberMatches(localId: string, parsed?: string): boolean {
  if (!parsed) return false;
  const a = localId.trim();
  const b = parsed.trim();
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return parseInt(a, 10) === parseInt(b, 10);
  return norm(a) === norm(b);
}

async function searchBriefs(name: string, locale: Locale, localId?: string): Promise<Brief[]> {
  let url = `${tcgdexBase(locale)}/cards?name=${encodeURIComponent(name)}&pagination:page=1&pagination:itemsPerPage=60`;
  // TCGdex string filters are substring matches; filtering by localId pins
  // the right print even when a popular name has many pages of results.
  if (localId) url += `&localId=${encodeURIComponent(localId)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TCGdex search ${r.status}`);
  return (await r.json()) as Brief[];
}

/** Ordered query attempts: full name, progressively shorter right-trims,
 *  single words of 4+ chars, then a one-glyph shave ("Charizardd" →
 *  "Charizard"). Results are still scored against the full original name. */
function queryAttempts(name: string): string[] {
  const tokens = name.split(/\s+/).filter(Boolean);
  const tries: string[] = [];
  for (let n = tokens.length; n >= 1; n--) tries.push(tokens.slice(0, n).join(' '));
  for (const t of tokens) if (t.length >= 4) tries.push(t);
  if (tokens.length === 1 && tokens[0].length >= 5) tries.push(tokens[0].slice(0, -1));
  // dedupe, preserve order
  const seen = new Set<string>();
  return tries.filter((q) => { const k = q.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); });
}

/** Name-only search (no collector number). Tries each attempt until one hits. */
async function searchWithFallback(name: string, locale: Locale): Promise<{ hits: Brief[]; query: string }> {
  for (const q of queryAttempts(name)) {
    const hits = await searchBriefs(q, locale);
    if (hits.length) return { hits, query: q };
  }
  return { hits: [], query: name };
}

/** Number-filtered search. The localId pins the print, so any hit is
 *  trustworthy without a name-similarity gate. */
async function searchNumbered(name: string, locale: Locale, localId: string): Promise<{ hits: Brief[]; query: string }> {
  for (const q of queryAttempts(name)) {
    const hits = await searchBriefs(q, locale, localId);
    if (hits.length) return { hits, query: q };
  }
  return { hits: [], query: name };
}

// ─────────────────────────────────────────────────────────────
// Enrich top candidates → TcgCard shape (matches lib/types.ts)
// ─────────────────────────────────────────────────────────────
function imageUrls(base?: string) {
  if (!base) return { small: '', large: '' };
  return { small: `${base}/low.webp`, large: `${base}/high.webp` };
}

// deno-lint-ignore no-explicit-any
function pickPricing(c: any) {
  if (c?.pricing?.cardmarket) return c.pricing.cardmarket;
  for (const v of c?.variants_detailed ?? []) if (v?.pricing?.cardmarket) return v.pricing.cardmarket;
  return undefined;
}

// deno-lint-ignore no-explicit-any
function toTcgCard(c: any) {
  const cm = pickPricing(c);
  return {
    id: c.id,
    name: c.name,
    number: c.localId,
    rarity: c.rarity,
    types: c.types,
    hp: c.hp != null ? String(c.hp) : undefined,
    images: imageUrls(c.image),
    set: { id: c.set?.id, name: c.set?.name },
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

// deno-lint-ignore no-explicit-any
async function fetchFull(id: string, locale: Locale): Promise<any | null> {
  const r = await fetch(`${tcgdexBase(locale)}/cards/${id}`);
  if (!r.ok) return null;
  return await r.json();
}

// ─────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  // Structured trace emitted as a single log line. Silent unless the
  // SCAN_DEBUG secret is set; errors always log (force=true).
  // deno-lint-ignore no-explicit-any
  const trace: Record<string, any> = { attempts: [] };
  const DEBUG = !!Deno.env.get('SCAN_DEBUG');
  const flush = (force = false) => {
    if (DEBUG || force) console.log('[card-scan] ' + JSON.stringify(trace));
  };

  try {
    const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY');
    if (!apiKey) {
      trace.error = 'GOOGLE_VISION_API_KEY not set';
      flush(true);
      return json({ error: trace.error }, 500);
    }

    const { imageBase64 } = (await req.json()) as { imageBase64?: string };
    if (!imageBase64) { trace.error = 'missing imageBase64'; flush(true); return json({ error: trace.error }, 400); }
    trace.imageBytesBase64 = imageBase64.length;

    const annotations = await runOcr(imageBase64, apiKey);
    const ocrText = annotations[0]?.description ?? '';
    const locale: Locale = JA_CHARS.test(ocrText) ? 'ja' : 'en';
    trace.ocrAnnotations = annotations.length;
    trace.locale = locale;
    trace.ocrText = ocrText;

    const parsed = parseCard(annotations);
    trace.candidates = parsed.candidates;
    trace.number = parsed.number ?? null;
    trace.hp = parsed.hp ?? null;
    if (!parsed.candidates.length) {
      trace.note = 'no name parsed';
      flush();
      return json({ candidates: [], parsed, ocrText });
    }

    let chosen = parsed.name;
    let briefs: Brief[] = [];

    // Pass 1: filter each name guess by the parsed collector number, which
    // pins the exact print. Scoring is against the full candidate name.
    if (parsed.number) {
      for (const q of parsed.candidates) {
        const { hits, query } = await searchNumbered(q, locale, parsed.number);
        const bestSim = hits.reduce((m, b) => Math.max(m, similarity(b.name, q)), 0);
        trace.attempts.push({ pass: 'num', q, query, localId: parsed.number, hits: hits.length, bestSim: Number(bestSim.toFixed(2)) });
        if (hits.length && bestSim >= 0.5) { chosen = q; briefs = hits; break; }
      }
    }

    // Pass 2: name-only fallback when there is no number or the numbered
    // search found nothing. Accepts the first guess with sim >= 0.5 results.
    if (!briefs.length) {
      for (const q of parsed.candidates) {
        const { hits, query } = await searchWithFallback(q, locale);
        const bestSim = hits.reduce((m, b) => Math.max(m, similarity(b.name, q)), 0);
        trace.attempts.push({ pass: 'name', q, query, hits: hits.length, bestSim: Number(bestSim.toFixed(2)) });
        if (hits.length && bestSim >= 0.5) { chosen = q; briefs = hits; break; }
        if (hits.length && !briefs.length) { chosen = q; briefs = hits; } // weak fallback
      }
    }
    trace.chosen = chosen;
    trace.briefs = briefs.length;

    const scored = briefs
      .map((b) => {
        const nameSim = similarity(b.name, chosen);
        const numMatch = numberMatches(b.localId, parsed.number);
        const confidence = parsed.number
          ? 0.55 * nameSim + 0.45 * (numMatch ? 1 : 0)
          : nameSim;
        return { brief: b, confidence };
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6);

    // Enrich the shortlist into full TcgCards (images + pricing) in parallel.
    const candidates = (
      await Promise.all(
        scored.map(async (s) => {
          const full = await fetchFull(s.brief.id, locale);
          if (!full) return null;
          return { card: toTcgCard(full), confidence: Number(s.confidence.toFixed(3)) };
        }),
      )
    ).filter((c): c is { card: ReturnType<typeof toTcgCard>; confidence: number } => !!c);

    trace.results = candidates.map((c) => `${c.card.name} [${c.card.id}] ${c.confidence}`);
    flush();
    return json({ candidates, parsed: { ...parsed, name: chosen }, ocrText, locale });
  } catch (e) {
    trace.error = (e as Error).message ?? 'unknown';
    flush(true);
    return json({ error: trace.error }, 500);
  }
});
