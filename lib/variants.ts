// Master-set variant model: maps TCGdex printing data onto check-off slots.
// Slot keys are persisted on collections rows (`variant` column) and must
// never change.

import type { CardVariantsInfo } from './tcgdex';

export type MastersetLevel = 'base' | 'master' | 'grand';

export interface VariantSlot {
  key: string;
  label: string;
  /** Compact form for the on-art tag ("Reverse", "Gamestop stamp"). */
  short: string;
}

export const LEVEL_META: Record<MastersetLevel, { label: string; hint: string }> = {
  base:   { label: 'Base',        hint: 'One of each card' },
  master: { label: 'Master',      hint: 'Every printing: normal, reverse, holo' },
  grand:  { label: 'Grandmaster', hint: 'Master plus stamped and promo printings' },
};

const FLAG_ORDER = [
  ['normal', 'Normal', 'Normal'],
  ['holo', 'Holo', 'Holo'],
  ['reverse', 'Reverse holo', 'Reverse'],
  ['firstEdition', '1st edition', '1st ed'],
  ['wPromo', 'W promo', 'W promo'],
] as const;

const FLAG_LABEL = new Map<string, string>(FLAG_ORDER.map(([k, l]) => [k, l]));

function titleize(s: string) {
  const spaced = s.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type Detailed = NonNullable<CardVariantsInfo['variants_detailed']>[number];

/** Stable key for a detailed printing. A plain standard-size entry collapses
 *  onto its coarse flag key so master and grandmaster slots line up. */
export function detailedKey(v: Detailed): string {
  const parts = [v.type];
  if (v.size && v.size !== 'standard') parts.push(v.size);
  if (v.foil) parts.push(v.foil);
  for (const s of v.stamp ?? []) parts.push(s);
  return parts.join('+');
}

function detailedExtras(v: Detailed): string[] {
  const extras: string[] = [];
  if (v.size && v.size !== 'standard') extras.push(titleize(v.size));
  if (v.foil) extras.push(`${titleize(v.foil)} foil`);
  for (const s of v.stamp ?? []) extras.push(`${titleize(s)} stamp`);
  return extras;
}

function detailedLabel(v: Detailed): string {
  const base = FLAG_LABEL.get(v.type) ?? titleize(v.type);
  const extras = detailedExtras(v);
  return extras.length ? `${base} · ${extras.join(' · ')}` : base;
}

/** Extras alone ("Gamestop stamp") when present, else the base printing label. */
function detailedShort(v: Detailed): string {
  const extras = detailedExtras(v);
  return extras.length ? extras.join(' · ') : (FLAG_LABEL.get(v.type) ?? titleize(v.type));
}

/** Check-off slots a card contributes at a master-set level. Cards with no
 *  variant info fall back to a single Normal slot. */
export function slotsForLevel(
  info: CardVariantsInfo | undefined,
  level: MastersetLevel,
): VariantSlot[] {
  const flags = info?.variants ?? null;
  const flagSlots: VariantSlot[] = [];
  if (flags) {
    for (const [key, label, short] of FLAG_ORDER) {
      if (flags[key]) flagSlots.push({ key, label, short });
    }
  }
  if (flagSlots.length === 0) flagSlots.push({ key: 'normal', label: 'Normal', short: 'Normal' });

  if (level === 'base') return [flagSlots[0]];
  if (level === 'master') return flagSlots;

  const out = [...flagSlots];
  const seen = new Set(out.map((s) => s.key));
  for (const v of info?.variants_detailed ?? []) {
    const key = detailedKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: detailedLabel(v), short: detailedShort(v) });
  }
  return out;
}
