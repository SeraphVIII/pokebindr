// One-off asset generator — produces the app icon set as PNGs with no native
// image tooling, using only Node's built-in zlib. Draws a gold Poké Ball
// emblem on the obsidian background to match the Vault theme (lib/theme.ts).
//
// Run:  node scripts/gen-icons.js
// Outputs into ../assets. Re-run any time to regenerate; safe to delete the
// script afterwards (assets are committed, this is not needed at build time).

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ── Theme colors ────────────────────────────────────────────
const BG = [0x0c, 0x0a, 0x08]; // obsidian
const GOLD = [0xd4, 0xaf, 0x37]; // accent

// ── Minimal PNG encoder (color type 2 = RGB, or 6 = RGBA) ────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, pixels, alpha) {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.alloc(height * (1 + width * ch));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + width * ch);
    raw[o] = 0; // filter: none
    pixels.copy(raw, o + 1, y * width * ch, (y + 1) * width * ch);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;            // bit depth
  ihdr[9] = alpha ? 6 : 2; // color type
  return Buffer.concat([
    sig, chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Emblem rasteriser ───────────────────────────────────────
// 1px-ish analytic anti-aliasing via coverage of distance bands.
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const AA = 1.6;
const inside = (d, r) => clamp01((r - d) / AA + 0.5);   // coverage inside radius r
const outside = (d, r) => clamp01((d - r) / AA + 0.5);  // coverage outside radius r
const band = (v, half) => clamp01((half - v) / AA + 0.5);

/** Gold coverage [0..1] at pixel (x,y). Rfrac sets the medallion radius as a
 *  fraction of the canvas, so the same shape scales to every output size. */
function goldCoverage(x, y, size, Rfrac) {
  const c = size / 2;
  const R = size * Rfrac;
  const dx = x + 0.5 - c, dy = y + 0.5 - c;
  const d = Math.hypot(dx, dy);

  const lw = R * 0.085;                    // line weight
  const ringOuter = R, ringInner = R - lw;
  const b1 = R * 0.30, b2 = R * 0.21, b3 = R * 0.10; // button radii

  // Outer ring
  let cov = inside(d, ringOuter) * outside(d, ringInner);
  // Equator line, clipped to between the button and the ring
  const eq = inside(d, ringOuter) * outside(d, b1) * band(Math.abs(dy), lw / 2);
  cov = Math.max(cov, eq);
  // Center button: annulus + dot
  cov = Math.max(cov, inside(d, b1) * outside(d, b2));
  cov = Math.max(cov, inside(d, b3));
  return clamp01(cov);
}

function render(size, { Rfrac, transparent }) {
  const ch = transparent ? 4 : 3;
  const px = Buffer.alloc(size * size * ch);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const g = goldCoverage(x, y, size, Rfrac);
      const o = (y * size + x) * ch;
      if (transparent) {
        px[o] = GOLD[0]; px[o + 1] = GOLD[1]; px[o + 2] = GOLD[2];
        px[o + 3] = Math.round(g * 255);
      } else {
        px[o] = Math.round(BG[0] + (GOLD[0] - BG[0]) * g);
        px[o + 1] = Math.round(BG[1] + (GOLD[1] - BG[1]) * g);
        px[o + 2] = Math.round(BG[2] + (GOLD[2] - BG[2]) * g);
      }
    }
  }
  return encodePng(size, size, px, transparent);
}

// ── Outputs ─────────────────────────────────────────────────
const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  // iOS / store icon — opaque, no alpha (Apple rejects alpha), medallion large.
  ['icon.png', 1024, { Rfrac: 0.40, transparent: false }],
  // Google Play hi-res listing icon — 512×512 PNG, opaque, used on the
  // Store page (Main store listing → App icon). Same emblem as icon.png.
  ['play-store-icon.png', 512, { Rfrac: 0.40, transparent: false }],
  // Android adaptive foreground — transparent, content kept inside the safe
  // zone (~66% center) so the OS mask can't clip the ring.
  ['adaptive-icon.png', 1024, { Rfrac: 0.30, transparent: true }],
  // Splash mark — transparent, smaller; background color set in app.json.
  ['splash-icon.png', 1024, { Rfrac: 0.22, transparent: true }],
  // Web favicon — opaque.
  ['favicon.png', 48, { Rfrac: 0.40, transparent: false }],
];

for (const [name, size, opts] of jobs) {
  const buf = render(size, opts);
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`wrote assets/${name} (${size}×${size}, ${buf.length} bytes)`);
}
