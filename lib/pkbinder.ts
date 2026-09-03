// .pkbinder file format: a portable JSON snapshot of one binder.
// Server-assigned fields (ids, timestamps, prices, share state) are not
// serialized; they are reassigned or refreshed on import.

import type { Binder, BinderPage, CollectionRow, Status } from './types';

export const PKBINDER_FORMAT = 'pkbinder';
export const PKBINDER_VERSION = 1;
export const PKBINDER_MIME = 'application/json';
// Double extension on purpose: the trailing `.json` makes Android infer MIME
// `application/json` so the document picker's JSON filter shows these files.
export const PKBINDER_EXT = 'pkbinder.json';

export interface PkBinderCard {
  card_id: string;
  card_name: string;
  set_id: string;
  set_name: string;
  card_number: string;
  rarity: string | null;
  card_type: string | null;
  image_small: string | null;
  image_large: string | null;
  status: Status;
  condition: string;
  quantity: number;
  /** Printing key ('normal', 'reverse', …). Absent in v1 files. */
  variant?: string | null;
  notes: string | null;
  position: number;
}

export interface PkBinderFile {
  format: typeof PKBINDER_FORMAT;
  version: number;
  exportedAt: string;
  binder: {
    name: string;
    cols: number;
    rows: number;
  };
  pages: Array<{ title: string | null }>;
  cards: PkBinderCard[];
}

export function serializeBinder(
  binder: Binder,
  pages: BinderPage[],
  cards: CollectionRow[],
  now: string,
): string {
  const orderedPages = [...pages].sort((a, b) => a.page_index - b.page_index);
  const file: PkBinderFile = {
    format: PKBINDER_FORMAT,
    version: PKBINDER_VERSION,
    exportedAt: now,
    binder: {
      name: binder.name,
      cols: binder.grid_cols,
      rows: binder.grid_rows,
    },
    pages: orderedPages.map((p) => ({ title: p.title })),
    cards: [...cards]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        card_id: c.card_id,
        card_name: c.card_name,
        set_id: c.set_id,
        set_name: c.set_name,
        card_number: c.card_number,
        rarity: c.rarity,
        card_type: c.card_type,
        image_small: c.image_small,
        image_large: c.image_large,
        status: c.status,
        condition: c.condition,
        quantity: c.quantity,
        variant: c.variant ?? null,
        notes: c.notes,
        position: c.position,
      })),
  };
  return JSON.stringify(file, null, 2);
}

export class PkBinderParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PkBinderParseError';
  }
}

const STATUSES = new Set<Status>(['have', 'want', 'really']);

/** Validate + normalize. Throws PkBinderParseError on any structural problem. */
export function parsePkBinder(text: string): PkBinderFile {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PkBinderParseError('Not valid JSON.');
  }
  if (!raw || typeof raw !== 'object') {
    throw new PkBinderParseError('Empty or non-object file.');
  }
  if (raw.format !== PKBINDER_FORMAT) {
    throw new PkBinderParseError('Not a .pkbinder file.');
  }
  if (typeof raw.version !== 'number' || raw.version > PKBINDER_VERSION) {
    throw new PkBinderParseError(`Unsupported version: ${raw.version}.`);
  }
  if (!raw.binder || typeof raw.binder !== 'object') {
    throw new PkBinderParseError('Missing binder block.');
  }
  const name = String(raw.binder.name ?? '').trim();
  const cols = Number(raw.binder.cols);
  const rows = Number(raw.binder.rows);
  if (!name) throw new PkBinderParseError('Binder name is empty.');
  if (!Number.isInteger(cols) || cols < 1 || cols > 6) {
    throw new PkBinderParseError(`Invalid grid cols: ${raw.binder.cols}.`);
  }
  if (!Number.isInteger(rows) || rows < 1 || rows > 6) {
    throw new PkBinderParseError(`Invalid grid rows: ${raw.binder.rows}.`);
  }
  if (!Array.isArray(raw.pages)) {
    throw new PkBinderParseError('Missing pages array.');
  }
  const pages = raw.pages.map((p: any, i: number) => {
    if (p == null || typeof p !== 'object') {
      throw new PkBinderParseError(`Page ${i} is not an object.`);
    }
    const title = p.title == null ? null : String(p.title);
    return { title };
  });
  if (pages.length === 0) pages.push({ title: null });

  if (!Array.isArray(raw.cards)) {
    throw new PkBinderParseError('Missing cards array.');
  }
  const cards: PkBinderCard[] = raw.cards.map((c: any, i: number) => {
    if (c == null || typeof c !== 'object') {
      throw new PkBinderParseError(`Card ${i} is not an object.`);
    }
    const card_id = String(c.card_id ?? '').trim();
    if (!card_id) throw new PkBinderParseError(`Card ${i} is missing card_id.`);
    const position = Number(c.position);
    if (!Number.isInteger(position) || position < 0) {
      throw new PkBinderParseError(`Card ${i} has invalid position.`);
    }
    const status = STATUSES.has(c.status) ? (c.status as Status) : 'have';
    const quantity = Number.isInteger(c.quantity) && c.quantity > 0 ? c.quantity : 1;
    return {
      card_id,
      card_name: String(c.card_name ?? ''),
      set_id: String(c.set_id ?? ''),
      set_name: String(c.set_name ?? ''),
      card_number: String(c.card_number ?? ''),
      rarity: c.rarity == null ? null : String(c.rarity),
      card_type: c.card_type == null ? null : String(c.card_type),
      image_small: c.image_small == null ? null : String(c.image_small),
      image_large: c.image_large == null ? null : String(c.image_large),
      status,
      condition: String(c.condition ?? 'NM'),
      quantity,
      variant: c.variant == null ? null : String(c.variant),
      notes: c.notes == null ? null : String(c.notes),
      position,
    };
  });

  return {
    format: PKBINDER_FORMAT,
    version: raw.version,
    exportedAt: String(raw.exportedAt ?? ''),
    binder: { name, cols, rows },
    pages,
    cards,
  };
}

/** Slugify a binder name for a filename; strict ASCII for cross-platform
 *  share targets. */
export function pkBinderFilename(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'binder'}.${PKBINDER_EXT}`;
}
