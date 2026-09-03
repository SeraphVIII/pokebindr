// Edge Function: extract dominant artwork palettes for card images.
//
// POST { cards: [{ card_id: string, image: string }] }
//   → { palettes: { [card_id]: PaletteEntry[] }, failed: string[] }
// Entries are HSL plus pixel-share weight, largest weight first.
//
// Deploy: supabase functions deploy card-palette --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_CARDS = 30;
const CONCURRENCY = 6;
const PALETTE_SIZE = 4;

interface PaletteEntry { h: number; s: number; l: number; w: number }
interface CardReq { card_id: string; image: string }

// ─────────────────────────────────────────────────────────────
// Colour math
// ─────────────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** Classic median-cut: split the box with the widest channel range until
 *  PALETTE_SIZE boxes remain, then average each box. Pixels are [r,g,b]. */
function medianCut(pixels: number[][]): PaletteEntry[] {
  type Box = number[][];
  const boxes: Box[] = [pixels];
  while (boxes.length < PALETTE_SIZE) {
    let bestBox = -1, bestRange = -1, bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of boxes[i]) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        if (hi - lo > bestRange) { bestRange = hi - lo; bestBox = i; bestCh = ch; }
      }
    }
    if (bestBox < 0) break;
    const box = boxes[bestBox];
    box.sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes.splice(bestBox, 1, box.slice(0, mid), box.slice(mid));
  }
  const total = pixels.length || 1;
  return boxes
    .filter((b) => b.length > 0)
    .map((b) => {
      let r = 0, g = 0, bl = 0;
      for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
      const n = b.length;
      const { h, s, l } = rgbToHsl(r / n, g / n, bl / n);
      return {
        h: Math.round(h),
        s: Math.round(s * 1000) / 1000,
        l: Math.round(l * 1000) / 1000,
        w: Math.round((n / total) * 1000) / 1000,
      };
    })
    .sort((a, b) => b.w - a.w);
}

// ─────────────────────────────────────────────────────────────
// Image fetch + sample
// ─────────────────────────────────────────────────────────────

/** TCGdex image fields/urls end in /low.webp (or are a bare base URL); the
 *  CDN also serves .jpg, which imagescript can decode. */
function toJpgUrl(image: string): string {
  if (/\.(webp|png|jpg)$/i.test(image)) return image.replace(/\.(webp|png)$/i, '.jpg');
  return `${image}/low.jpg`;
}

async function extractPalette(image: string): Promise<PaletteEntry[]> {
  const r = await fetch(toJpgUrl(image));
  if (!r.ok) throw new Error(`image fetch ${r.status}`);
  const img = await Image.decode(new Uint8Array(await r.arrayBuffer()));

  // Crop to the illustration window, skipping the card frame and text box.
  // The percentages hold up across card eras at this resolution.
  const cx = Math.round(img.width * 0.08);
  const cy = Math.round(img.height * 0.12);
  const cw = Math.round(img.width * 0.84);
  const ch = Math.round(img.height * 0.46);
  const art = img.clone().crop(cx, cy, cw, ch);
  art.resize(48, Image.RESIZE_AUTO);

  const pixels: number[][] = [];
  for (let y = 1; y <= art.height; y++) {
    for (let x = 1; x <= art.width; x++) {
      const [r8, g8, b8, a8] = Image.colorToRGBA(art.getPixelAt(x, y));
      if (a8 < 128) continue;
      pixels.push([r8, g8, b8]);
    }
  }
  if (pixels.length < 16) throw new Error('too few pixels');
  return medianCut(pixels);
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  let cards: CardReq[];
  try {
    const body = await req.json();
    cards = (body?.cards ?? []).filter(
      (c: CardReq) => typeof c?.card_id === 'string' && typeof c?.image === 'string',
    );
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!cards.length) return json({ palettes: {}, failed: [] });
  cards = cards.slice(0, MAX_CARDS);

  const palettes: Record<string, PaletteEntry[]> = {};
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < cards.length) {
      const c = cards[next++];
      try {
        palettes[c.card_id] = await extractPalette(c.image);
      } catch {
        failed.push(c.card_id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cards.length) }, worker));

  // Persist with the service role (bypasses RLS). The upsert only touches the
  // palette column, so other card_meta fields are preserved.
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url && key && Object.keys(palettes).length) {
    const supabase = createClient(url, key);
    const rows = Object.entries(palettes).map(([card_id, palette]) => ({ card_id, palette }));
    const { error } = await supabase.from('card_meta').upsert(rows, { onConflict: 'card_id' });
    if (error) console.error('card_meta upsert failed:', error.message);
  }

  return json({ palettes, failed });
});
