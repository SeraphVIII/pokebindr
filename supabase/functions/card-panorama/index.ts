// Edge Function: score panorama (connecting-artwork) candidate pairs.
//
// POST { pairs: [{ left: {card_id, image}, right: {card_id, image} }] }
//   → { scores: { "leftId|rightId": 0..1 }, failed: string[] }
// Compares the left card's right edge strip against the right card's left
// edge strip; scores are cached in card_pairs.
//
// Deploy: supabase functions deploy card-panorama --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_PAIRS = 10;
const CONCURRENCY = 4;
const STRIP_H = 64;   // strips are compared at this height
const STRIP_W = 3;    // columns averaged into each strip sample
const MAX_OFFSET = 2; // vertical slack (rows) when aligning the two strips

interface CardRef { card_id: string; image: string }
interface PairReq { left: CardRef; right: CardRef }

function toJpgUrl(image: string): string {
  if (/\.(webp|png|jpg)$/i.test(image)) return image.replace(/\.(webp|png)$/i, '.jpg');
  return `${image}/low.jpg`;
}

/** Fetch a card image and return its illustration crop at strip height. The
 *  crop is tighter than card-palette's so card frames never reach the strips;
 *  two same-era frames would otherwise fake continuity. */
async function fetchArt(image: string): Promise<Image> {
  const r = await fetch(toJpgUrl(image));
  if (!r.ok) throw new Error(`image fetch ${r.status}`);
  const img = await Image.decode(new Uint8Array(await r.arrayBuffer()));
  const cx = Math.round(img.width * 0.15);
  const cy = Math.round(img.height * 0.16);
  const cw = Math.round(img.width * 0.70);
  const ch = Math.round(img.height * 0.36);
  const art = img.clone().crop(cx, cy, cw, ch);
  art.resize(Image.RESIZE_AUTO, STRIP_H);
  return art;
}

/** Average the outermost STRIP_W columns on one side into per-row RGB. */
function edgeStrip(art: Image, side: 'left' | 'right'): number[][] {
  const cols = side === 'left'
    ? [1, Math.min(STRIP_W, art.width)]
    : [Math.max(1, art.width - STRIP_W + 1), art.width];
  const strip: number[][] = [];
  for (let y = 1; y <= art.height; y++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = cols[0]; x <= cols[1]; x++) {
      const [r8, g8, b8] = Image.colorToRGBA(art.getPixelAt(x, y));
      r += r8; g += g8; b += b8; n++;
    }
    strip.push([r / n, g / n, b / n]);
  }
  return strip;
}

const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

function variance(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
}

/** 0..1 continuity between the facing edges, best over small vertical offsets.
 *  60% colour + 40% luminance correlation; capped at 0.5 for near-flat strips. */
function continuity(rightOfLeft: number[][], leftOfRight: number[][]): number {
  let best = 0;
  for (let off = -MAX_OFFSET; off <= MAX_OFFSET; off++) {
    const a: number[][] = [], b: number[][] = [];
    for (let y = 0; y < rightOfLeft.length; y++) {
      const y2 = y + off;
      if (y2 < 0 || y2 >= leftOfRight.length) continue;
      a.push(rightOfLeft[y]);
      b.push(leftOfRight[y2]);
    }
    if (a.length < 8) continue;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
      dist += Math.sqrt(
        (a[i][0] - b[i][0]) ** 2 + (a[i][1] - b[i][1]) ** 2 + (a[i][2] - b[i][2]) ** 2,
      ) / 441.67;
    }
    const colorScore = Math.max(0, 1 - (dist / a.length) * 3);
    const corr = pearson(a.map(lum), b.map(lum));
    let score = 0.6 * colorScore + 0.4 * (corr + 1) / 2;
    if (variance(a.map(lum)) < 40 && variance(b.map(lum)) < 40) {
      score = Math.min(score, 0.5);
    }
    best = Math.max(best, score);
  }
  return Math.round(best * 1000) / 1000;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  let pairs: PairReq[];
  try {
    const body = await req.json();
    pairs = (body?.pairs ?? []).filter(
      (p: PairReq) =>
        typeof p?.left?.card_id === 'string' && typeof p?.left?.image === 'string' &&
        typeof p?.right?.card_id === 'string' && typeof p?.right?.image === 'string',
    );
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!pairs.length) return json({ scores: {}, failed: [] });
  pairs = pairs.slice(0, MAX_PAIRS);

  // Each artwork is fetched once even when it appears in several pairs.
  const artCache = new Map<string, Promise<Image>>();
  const getArt = (c: CardRef) => {
    let p = artCache.get(c.card_id);
    if (!p) {
      p = fetchArt(c.image);
      artCache.set(c.card_id, p);
    }
    return p;
  };

  const scores: Record<string, number> = {};
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < pairs.length) {
      const p = pairs[next++];
      const key = `${p.left.card_id}|${p.right.card_id}`;
      try {
        const [la, ra] = await Promise.all([getArt(p.left), getArt(p.right)]);
        scores[key] = continuity(edgeStrip(la, 'right'), edgeStrip(ra, 'left'));
      } catch {
        failed.push(key);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, worker));

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url && key && Object.keys(scores).length) {
    const supabase = createClient(url, key);
    const rows = Object.entries(scores).map(([k, score]) => {
      const [left_id, right_id] = k.split('|');
      return { left_id, right_id, score };
    });
    const { error } = await supabase
      .from('card_pairs')
      .upsert(rows, { onConflict: 'left_id,right_id' });
    if (error) console.error('card_pairs upsert failed:', error.message);
  }

  return json({ scores, failed });
});
