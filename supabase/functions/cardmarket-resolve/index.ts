// Edge Function: resolve a Cardmarket product URL for a given card and
// append ?language=1 so the user lands on the English-listings view.
//
// Strategy: scrape DDG's no-JS HTML search results for the first
// cardmarket.com/Singles link. Google's basic-HTML SERP no longer renders
// without JS, and Brave's API works but requires a key. DDG-html is
// scrape-friendly out of the box; ranking can be off for niche queries
// (e.g. picking #165 over #166), so we quote the number to force the
// ranker to require it.
//
// Deploy: `supabase functions deploy cardmarket-resolve --no-verify-jwt`

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// TCGdex set id → Cardmarket set code. Cardmarket URLs end with
// "-{CODE}{number}" (e.g. "-CRE166"), so including the code as a
// quoted token tightens the search hit dramatically vs. set name alone.
const SET_CODES: Record<string, string> = {
  // Scarlet & Violet era
  sv01: 'SVI', sv02: 'PAL', sv03: 'OBF', 'sv03.5': 'MEW',
  sv04: 'PAR', 'sv04.5': 'PAF', sv05: 'TEF', sv06: 'TWM',
  'sv06.5': 'SFA', sv07: 'SCR', sv08: 'SSP', 'sv08.5': 'PRE',
  sv09: 'JTG', sv10: 'DRI', 'sv10.5': 'BLK',
  // Sword & Shield era
  swsh1: 'SSH', swsh2: 'RCL', swsh3: 'DAA', 'swsh3.5': 'CPA',
  swsh4: 'VIV', 'swsh4.5': 'SHF', swsh5: 'BST', swsh6: 'CRE',
  swsh7: 'EVS', cel25: 'CEL', swsh8: 'FST', swsh9: 'BRS',
  swsh10: 'ASR', 'swsh10.5': 'PGO', swsh11: 'LOR', swsh12: 'SIT',
  'swsh12.5': 'CRZ',
  // Mega Evolution era
  me01: 'MEG', me02: 'PFL', 'me02.5': 'ASC', me03: 'POR',
  mee: 'MEE', mep: 'MEP',
  // Promos
  svp: 'SVP', swshp: 'SWSH',
};

function searchFallback(name: string, set: string, number?: string): string {
  const q = encodeURIComponent([name, set, number].filter(Boolean).join(' '));
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${q}&language=1`;
}

function appendLanguage(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('language', '1');
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}language=1`;
  }
}

// Pull the first Cardmarket Singles URL out of DDG's HTML page. DDG-html
// sometimes wraps result links in a redirector (/l/?uddg=ENCODED), other
// times exposes the URL directly — handle both.
function extractCardmarketUrl(html: string): string | null {
  const redirectorMatches = html.matchAll(/[?&]uddg=([^&"'\s]+)/g);
  for (const m of redirectorMatches) {
    const decoded = decodeURIComponent(m[1]);
    if (decoded.includes('cardmarket.com/en/Pokemon/Products/Singles')) {
      return decoded;
    }
  }
  const direct = html.match(/https?:\/\/(?:www\.)?cardmarket\.com\/en\/Pokemon\/Products\/Singles\/[^"'\s<>&]+/);
  return direct ? direct[0] : null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { name, set, setId, number } = (await req.json()) as {
      name?: string;
      set?: string;
      setId?: string;
      number?: string;
    };
    if (!name || !set) {
      return new Response(
        JSON.stringify({ error: 'missing name or set' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    // Quote setcode and number separately. The code is tighter than the
    // verbose set name (e.g. "CRE" vs "Chilling Reign") and the number
    // pins the right card in the set. Both quoted = both required.
    const code = setId ? SET_CODES[setId] : undefined;
    const tokens: string[] = [name];
    if (code) tokens.push(`"${code}"`); else tokens.push(set);
    if (number) tokens.push(`"${number}"`);
    tokens.push('site:cardmarket.com');
    const queryStr = tokens.join(' ');
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryStr)}`;

    const r = await fetch(ddgUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await r.text();
    const product = extractCardmarketUrl(html);
    const final = product ? appendLanguage(product) : searchFallback(name, set, number);
    return new Response(
      JSON.stringify({ url: final }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message ?? 'unknown' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
