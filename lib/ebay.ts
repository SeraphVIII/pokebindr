// eBay UK sold listings, scraped on-device and cached in the shared
// `ebay_solds` table. On-device is required: eBay blocks datacenter IPs
// but serves residential/mobile clients.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { TcgCard } from './types';

export interface EbayGrade {
  grader: string; // PSA / BGS / CGC / ACE / SGC / TAG
  grade: string;  // '10', '9', '9.5', …
}

export interface EbaySold {
  title: string;
  price: number;             // GBP
  soldAt: string | null;     // ISO date (day precision)
  condition: string | null;  // eBay's own label ("Pre-owned", "Graded", …)
  grade: EbayGrade | null;   // parsed from the title
  url: string | null;
  image: string | null;
}

export interface EbaySoldsResult {
  items: EbaySold[];
  query: string;
  searchUrl: string;
  fetchedAt: string | null;
  /** Live fetch failed; items came from an expired cache entry. */
  stale: boolean;
  /** Live fetch failed and no cache existed; show the Cardmarket fallback. */
  failed: boolean;
}

export type GradeFilter = 'all' | 'raw' | 'psa9' | 'psa10';

// ─────────────────────────────────────────────────────────────
// Query + URL construction
// ─────────────────────────────────────────────────────────────

/** Search phrase "pokemon {name} {num}/{printed}". Gallery and promo numbers
 *  have no denominator, so those search as the bare collector number. */
export function ebayQueryForCard(card: TcgCard): string {
  const num = card.number.replace(/^0+(?=\d)/, '');
  const numToken = /^\d+$/.test(num) && card.set.total ? `${num}/${card.set.total}` : num;
  return `pokemon ${card.name} ${numToken}`.trim();
}

/** Sold+completed search on ebay.co.uk, UK-located items only, most
 *  recently ended first. 183454 = CCG Individual Cards category. */
export function ebaySearchUrl(query: string): string {
  const params: Record<string, string> = {
    _nkw: query,
    _sacat: '183454',
    LH_Sold: '1',
    LH_Complete: '1',
    LH_PrefLoc: '1',
    _ipg: '60',
    _sop: '13',
  };
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `https://www.ebay.co.uk/sch/i.html?${qs}`;
}

// ─────────────────────────────────────────────────────────────
// HTML parsing
// ─────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&pound;/g, '£');
}

function stripTags(s: string): string {
  return decodeEntities(
    s.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function soldDateToIso(day: string, monthWord: string, year: string): string | null {
  const m = MONTHS[monthWord.slice(0, 3).toLowerCase()];
  if (!m) return null;
  return `${year}-${String(m).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Grade parsed from a listing title. Handles "PSA 10", "PSA GEM MINT 10",
 *  "CGC 9.5", "BGS-9" and the like. */
export function parseGradeFromTitle(title: string): EbayGrade | null {
  const m = title.match(
    /\b(PSA|BGS|CGC|ACE|SGC|TAG)[\s:./-]*(?:GEM\s*(?:MINT|MT)\s*)?(10|[1-9](?:\.5)?)\b/i,
  );
  if (!m) return null;
  return { grader: m[1].toUpperCase(), grade: m[2] };
}

const CONDITION_RE =
  /\b(Pre-owned|Brand new|New \(other\)|Opened – never used|Graded|Ungraded|Seller refurbished|Used)\b/i;

/** Tolerant parse of an eBay sold-search results page. eBay serves two result
 *  markups (`.s-item` and `.s-card`); unparseable blocks are skipped. */
export function parseEbaySolds(html: string): EbaySold[] {
  const out: EbaySold[] = [];
  const seenUrls = new Set<string>();
  const chunks = html.split(/class="(?:s-item[\s"]|s-card[\s"]|su-card-container)/).slice(1);

  for (const raw of chunks) {
    // A block runs until the next item starts; cap length defensively so a
    // pathological page can't make the regexes scan megabytes.
    const block = raw.slice(0, 12000);

    const titleM =
      block.match(/s-(?:item|card)__title[^>]*>([\s\S]{0,600}?)<\/(?:div|h3|h4|span)>/) ??
      block.match(/role="heading"[^>]*>([\s\S]{0,600}?)<\//);
    let title = titleM ? stripTags(titleM[1]) : '';
    title = title.replace(/^New listing\s*/i, '').trim();
    if (!title || /^Shop on eBay/i.test(title)) continue;

    const priceM =
      block.match(/s-(?:item|card)__price[^>]*>(?:\s*<[^>]+>)*\s*£\s*([\d,]+(?:\.\d{1,2})?)/) ??
      block.match(/£\s*([\d,]+\.\d{2})/);
    if (!priceM) continue;
    const price = parseFloat(priceM[1].replace(/,/g, ''));
    if (!isFinite(price) || price <= 0) continue;

    const linkM = block.match(/href="(https:\/\/www\.ebay\.[^"]*\/itm\/[^"?]+)/);
    const url = linkM ? linkM[1] : null;
    if (url) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
    }

    const text = stripTags(block);
    const soldM = text.match(/Sold\s+(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})/i);
    const soldAt = soldM ? soldDateToIso(soldM[1], soldM[2], soldM[3]) : null;

    const condM = text.match(CONDITION_RE);
    const imageM = block.match(/src="(https:\/\/i\.ebayimg\.com\/[^"]+)"/);

    out.push({
      title,
      price,
      soldAt,
      condition: condM ? condM[1] : null,
      grade: parseGradeFromTitle(title),
      url,
      image: imageM ? imageM[1] : null,
    });
    if (out.length >= 30) break;
  }
  return out;
}

/** Fetch + parse the live sold-search page. Throws on HTTP errors, on the
 *  bot-wall interstitial, and on anything that isn't a results page. */
export async function fetchEbaySolds(query: string): Promise<EbaySold[]> {
  const res = await fetch(ebaySearchUrl(query), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`eBay returned ${res.status}`);
  const html = await res.text();
  if (html.length < 5000 || /Pardon our interruption|verify yourself|are you a human/i.test(html)) {
    throw new Error('eBay blocked the request');
  }
  return parseEbaySolds(html);
}

// ─────────────────────────────────────────────────────────────
// Aggregation helpers
// ─────────────────────────────────────────────────────────────

export function filterByGrade(items: EbaySold[], f: GradeFilter): EbaySold[] {
  if (f === 'all') return items;
  if (f === 'raw') return items.filter((i) => !i.grade);
  const want = f === 'psa10' ? '10' : '9';
  return items.filter((i) => i.grade?.grader === 'PSA' && i.grade.grade === want);
}

/** The headline number: average of the last `n` solds (or all when fewer).
 *  Items arrive newest-first from the recently-ended sort. */
export function averageSoldPrice(items: EbaySold[], n = 5): number | null {
  if (items.length === 0) return null;
  const take = items.slice(0, n);
  return take.reduce((sum, i) => sum + i.price, 0) / take.length;
}

// ─────────────────────────────────────────────────────────────
// Hook — shared-cache-first, then live scrape, then stale cache
// ─────────────────────────────────────────────────────────────

const EBAY_TTL_MS = 1000 * 60 * 60 * 12;

interface EbayCacheRow {
  items: EbaySold[];
  query: string;
  fetched_at: string;
}

export function useEbaySolds(card: TcgCard | undefined) {
  return useQuery<EbaySoldsResult>({
    queryKey: ['ebay-solds', card?.id],
    enabled: !!card,
    staleTime: 1000 * 60 * 30,
    retry: 0,
    queryFn: async (): Promise<EbaySoldsResult> => {
      const query = ebayQueryForCard(card!);
      const searchUrl = ebaySearchUrl(query);

      let cached: EbayCacheRow | null = null;
      try {
        const { data } = await supabase
          .from('ebay_solds')
          .select('items,query,fetched_at')
          .eq('card_id', card!.id)
          .maybeSingle();
        if (data) cached = data as EbayCacheRow;
      } catch {
        // Cache table missing or signed out; go straight to the live page.
      }
      if (cached && Date.now() - new Date(cached.fetched_at).getTime() < EBAY_TTL_MS) {
        return {
          items: cached.items, query: cached.query || query, searchUrl,
          fetchedAt: cached.fetched_at, stale: false, failed: false,
        };
      }

      try {
        const items = await fetchEbaySolds(query);
        const fetchedAt = new Date().toISOString();
        // Persist only non-empty parses: an empty result can mean no solds or
        // a markup change, and caching the latter would pin the miss.
        if (items.length > 0) {
          supabase
            .from('ebay_solds')
            .upsert({ card_id: card!.id, query, items, fetched_at: fetchedAt })
            .then(() => {}, () => {});
        }
        return { items, query, searchUrl, fetchedAt, stale: false, failed: false };
      } catch {
        if (cached) {
          return {
            items: cached.items, query: cached.query || query, searchUrl,
            fetchedAt: cached.fetched_at, stale: true, failed: false,
          };
        }
        return { items: [], query, searchUrl, fetchedAt: null, stale: false, failed: true };
      }
    },
  });
}
