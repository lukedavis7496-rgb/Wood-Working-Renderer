import { getSpecies, type Species } from '../core/species';
import type { Model } from '../core/types';
import { cutSize } from './cutList';

/**
 * Lumber planning: decide what stock to buy and show how the pieces come out
 * of it. Everything here is in inches.
 *
 * Rough hardwood loses material to milling, so each board's usable area is
 * smaller than its nominal size, and every cut costs a kerf.
 */

/** Thickness lost flattening and planing rough stock (4/4 rough → 3/4″ finished). */
export const MILLING_ALLOWANCE = 1 / 4;
/** Width lost straightening and jointing both edges of a rough board. */
export const ROUGH_EDGE_ALLOWANCE = 1 / 2;
/** Length lost to end checks and snipe on a rough board (both ends together). */
export const ROUGH_END_TRIM = 2;
/** Squaring the factory ends of surfaced (S4S) boards. */
export const S4S_END_TRIM = 1 / 2;

/** Rough thicknesses lumberyards actually stock, in quarters of an inch. */
const ROUGH_QUARTERS = [4, 5, 6, 8, 10, 12, 16];
const ROUGH_WIDTHS = [4, 5, 6, 7, 8];
/** Boards over 10′ are harder to find and to get home; prefer shorter ones unless longer saves wood. */
const LONG_BOARD_PENALTY_PER_FOOT = 0.02;
const ROUGH_WIDE_WIDTHS = [10, 12];
const ROUGH_LENGTHS = [72, 96, 120, 144];
const ROUGH_LONG_LENGTHS = [168, 192];

const S4S_THICKNESSES = [
  { label: '1×', nominal: 1, actual: 0.75 },
  { label: '5/4×', nominal: 1.25, actual: 1 },
  { label: '2×', nominal: 2, actual: 1.5 },
  { label: '4×', nominal: 4, actual: 3.5 },
];
const S4S_WIDTHS = [
  { nominal: 4, actual: 3.5 },
  { nominal: 6, actual: 5.5 },
  { nominal: 8, actual: 7.25 },
  { nominal: 10, actual: 9.25 },
  { nominal: 12, actual: 11.25 },
];
const S4S_LENGTHS = [72, 96, 120, 144];
const S4S_LONG_LENGTHS = [192];

export interface StockThickness {
  label: string;
  /** Thickness used for board-foot math (rough quarters or nominal). */
  nominal: number;
  /** The thickest finished part this stock can yield. */
  maxFinished: number;
}

export function stockThicknessFor(finished: number, species: Species): StockThickness {
  if (species.soldAs === 'dimensional') {
    const t = S4S_THICKNESSES.find((s) => s.actual >= finished - 1e-9);
    if (!t) throw new Error(`No surfaced ${species.name} is thick enough for a ${finished}″ part; laminate it from thinner boards.`);
    return { label: t.label, nominal: t.nominal, maxFinished: t.actual };
  }
  const needed = (finished + MILLING_ALLOWANCE) * 4 - 1e-9;
  const quarters = ROUGH_QUARTERS.find((q) => q >= needed);
  if (!quarters) {
    throw new Error(
      `${finished.toFixed(2)}″ is thicker than any rough ${species.name.toLowerCase()} stocked (16/4 mills to ${16 / 4 - MILLING_ALLOWANCE}″); laminate it from thinner boards.`,
    );
  }
  return { label: `${quarters}/4`, nominal: quarters / 4, maxFinished: quarters / 4 - MILLING_ALLOWANCE };
}

/** Price multiplier for thick stock, relative to 4/4. */
function thicknessPremium(t: StockThickness, species: Species): number {
  if (species.soldAs === 'dimensional') return 1;
  const q = Math.round(t.nominal * 4);
  return q <= 4 ? 1 : q === 5 ? 1.1 : q === 6 ? 1.15 : q === 8 ? 1.25 : 1.4;
}

export interface Piece {
  partId: string;
  name: string;
  /** What the piece becomes: its panel for a glue-up board, else the part itself. */
  makes?: { id: string; name: string };
  width: number;
  length: number;
  thickness: number;
}

export interface Placement2D {
  partId: string;
  name: string;
  /** Offset along the board's usable length / width. */
  x: number;
  y: number;
  length: number;
  width: number;
}

export interface PackedBoard {
  placements: Placement2D[];
}

interface Strip {
  y: number;
  width: number;
  used: number;
}

/**
 * Rip-first strip packing (how boards are actually broken down): each board
 * is ripped into strips as wide as the widest piece in them, and pieces are
 * crosscut along each strip. Kerf is charged between strips and between
 * pieces. First-fit-decreasing by length, best-fit by strip width.
 * Returns null if some piece doesn't fit on this board size at all.
 */
export function packBoards(pieces: Piece[], usableWidth: number, usableLength: number, kerf: number): PackedBoard[] | null {
  const sorted = [...pieces].sort((a, b) => b.length - a.length || b.width - a.width);
  const boards: { strips: Strip[]; usedWidth: number; placements: Placement2D[] }[] = [];
  for (const p of sorted) {
    if (p.width > usableWidth + 1e-9 || p.length > usableLength + 1e-9) return null;
    let best: { board: number; strip: Strip } | null = null;
    boards.forEach((b, bi) => {
      for (const s of b.strips) {
        const fits = p.width <= s.width + 1e-9 && s.used + kerf + p.length <= usableLength + 1e-9;
        if (fits && (!best || s.width < best.strip.width)) best = { board: bi, strip: s };
      }
    });
    if (best) {
      const { board, strip } = best as { board: number; strip: Strip };
      boards[board].placements.push({ partId: p.partId, name: p.name, x: strip.used + kerf, y: strip.y, length: p.length, width: p.width });
      strip.used += kerf + p.length;
      continue;
    }
    let bi = boards.findIndex((b) => b.usedWidth + (b.strips.length ? kerf : 0) + p.width <= usableWidth + 1e-9);
    if (bi < 0) {
      boards.push({ strips: [], usedWidth: 0, placements: [] });
      bi = boards.length - 1;
    }
    const b = boards[bi];
    const y = b.strips.length ? b.usedWidth + kerf : 0;
    b.strips.push({ y, width: p.width, used: p.length });
    b.usedWidth = y + p.width;
    b.placements.push({ partId: p.partId, name: p.name, x: 0, y, length: p.length, width: p.width });
  }
  return boards.map((b) => ({ placements: b.placements }));
}

export interface BoardSize {
  /** Width and length to buy (rough or nominal), inches. */
  width: number;
  length: number;
  /** What's left after edge jointing and end trimming. */
  usableWidth: number;
  usableLength: number;
}

export interface PlannedBoard extends PackedBoard {
  size: BoardSize;
  boardFeet: number;
}

export interface StockGroup {
  /** 'lumber' is bought by the board foot; 'sheet' is 4×8 plywood bought by the sheet. */
  kind: 'lumber' | 'sheet';
  species: string;
  stock: StockThickness;
  /** Each board is sized to what it carries, so sizes can differ. */
  boards: PlannedBoard[];
  purposes: string[];
  /** Zero for sheet goods. */
  boardFeet: { net: number; packed: number; recommended: number };
  /** Per board foot for lumber, per sheet for plywood. */
  pricePerBoardFoot: number;
  cost: number;
}

export interface LumberPlan {
  groups: StockGroup[];
  totals: { netBoardFeet: number; packedBoardFeet: number; recommendedBoardFeet: number; cost: number };
  settings: { kerf: number; overage: number };
}

const boardFeet = (thickness: number, width: number, length: number) => (thickness * width * length) / 144;

/** What the stock is for, by finished thing: ["Leg ×4", "Top"]. Names carry a ×N count when there's more than one. */
function purposesOf(pieces: Piece[]): string[] {
  const counts = new Map<string, Set<string>>();
  for (const p of pieces) {
    const m = p.makes ?? { id: p.partId, name: p.name };
    const name = m.name.replace(/ \(.*\)$/, '');
    if (!counts.has(name)) counts.set(name, new Set());
    counts.get(name)!.add(m.id);
  }
  return [...counts].map(([name, ids]) => (ids.size > 1 ? `${name} ×${ids.size}` : name));
}

/**
 * Board sizes to consider, smallest first. The common sizes come first; very
 * wide (10–12″) and very long (14–16′) boards are harder to find and only
 * used when a piece needs them.
 */
function boardSizes(species: Species, stock: StockThickness): { common: BoardSize[]; all: BoardSize[] } {
  const rough = species.soldAs === 'rough';
  const make = (widths: { nominal: number; usable: number }[], lengths: number[]) =>
    widths
      .flatMap((w) =>
        lengths.map((len) => ({
          width: w.nominal,
          length: len,
          usableWidth: w.usable,
          usableLength: len - (rough ? ROUGH_END_TRIM : S4S_END_TRIM),
        })),
      )
      .sort((a, b) => boardFeet(stock.nominal, a.width, a.length) - boardFeet(stock.nominal, b.width, b.length) || a.length - b.length);
  if (rough) {
    const w = (ws: number[]) => ws.map((x) => ({ nominal: x, usable: x - ROUGH_EDGE_ALLOWANCE }));
    return { common: make(w(ROUGH_WIDTHS), ROUGH_LENGTHS), all: make(w([...ROUGH_WIDTHS, ...ROUGH_WIDE_WIDTHS]), [...ROUGH_LENGTHS, ...ROUGH_LONG_LENGTHS]) };
  }
  const w = S4S_WIDTHS.map((x) => ({ nominal: x.nominal, usable: x.actual }));
  return { common: make(w.slice(0, 3), S4S_LENGTHS), all: make(w, [...S4S_LENGTHS, ...S4S_LONG_LENGTHS]) };
}

/** Smallest single board (by board feet) that holds these pieces. */
function rightSize(pieces: Piece[], sizes: BoardSize[], kerf: number, stock: StockThickness): PlannedBoard | null {
  for (const size of sizes) {
    const packed = packBoards(pieces, size.usableWidth, size.usableLength, kerf);
    if (packed && packed.length === 1) return { ...packed[0], size, boardFeet: boardFeet(stock.nominal, size.width, size.length) };
  }
  return null;
}

/**
 * Pack every piece of one thickness. Try each board size as the "main" size,
 * then shrink every board to the smallest size that still holds its pieces —
 * the last board in a run is usually half empty. Keep the plan with the
 * fewest board feet, then the fewest boards, then the fewest different sizes.
 */
function planBoards(pieces: Piece[], sizes: BoardSize[], kerf: number, stock: StockThickness): PlannedBoard[] | null {
  // bf here is a score: board feet with a small surcharge on long boards.
  let best: { boards: PlannedBoard[]; bf: number; distinct: number } | null = null;
  // Different main sizes often produce the same per-board groups of pieces;
  // right-size each group once.
  const sized = new Map<string, PlannedBoard | null>();
  for (const main of sizes) {
    const packed = packBoards(pieces, main.usableWidth, main.usableLength, kerf);
    if (!packed) continue;
    const boards: PlannedBoard[] = [];
    for (const b of packed) {
      const own = pieces.filter((p) => b.placements.some((pl) => pl.partId === p.partId));
      const key = own.map((p) => p.partId).sort().join(',');
      if (!sized.has(key)) sized.set(key, rightSize(own, sizes, kerf, stock));
      boards.push(sized.get(key) ?? { ...b, size: main, boardFeet: boardFeet(stock.nominal, main.width, main.length) });
    }
    const bf = boards.reduce((s, b) => s + b.boardFeet * (1 + LONG_BOARD_PENALTY_PER_FOOT * Math.max(0, b.size.length / 12 - 10)), 0);
    const distinct = new Set(boards.map((b) => `${b.size.width}x${b.size.length}`)).size;
    const better =
      !best ||
      bf < best.bf - 1e-9 ||
      (Math.abs(bf - best.bf) < 1e-9 && (boards.length < best.boards.length || (boards.length === best.boards.length && distinct < best.distinct)));
    if (better) best = { boards, bf, distinct };
  }
  return best?.boards.sort((a, b) => b.boardFeet - a.boardFeet) ?? null;
}

function unsourceable(pieces: Piece[], stock: StockThickness, species: Species, sizes: BoardSize[]): Error {
  const maxW = Math.max(...sizes.map((s) => s.usableWidth));
  const maxL = Math.max(...sizes.map((s) => s.usableLength));
  const wide = pieces.find((p) => p.width > maxW + 1e-9);
  if (wide) {
    return new Error(
      `${wide.name} is ${wide.width.toFixed(2)}″ wide, more than the widest ${stock.label} ${species.name.toLowerCase()} board yields (${maxW}″). ` +
        'Glue it up from narrower boards (for a top, lower the max top board width).',
    );
  }
  const long = pieces.find((p) => p.length > maxL + 1e-9)!;
  return new Error(
    `${long.name} is ${long.length.toFixed(1)}″ long, longer than the longest ${stock.label} board planned for (${Math.round((maxL + 2) / 12)}′). ` +
      'Shorten it or join it end to end.',
  );
}

/** A full 4×8 sheet; factory edges are straight, so only a whisker is lost squaring them. */
export const SHEET: BoardSize = { width: 48, length: 96, usableWidth: 47.75, usableLength: 95.75 };

/** Rough price for a sheet of veneer plywood: scales with the species and thickness. */
export function sheetPrice(species: Species, thickness: number): number {
  return Math.round(species.pricePerBoardFoot * (4 + 10.7 * thickness));
}

function planSheets(model: Model, kerf: number): StockGroup[] {
  const byGroup = new Map<string, { species: Species; thickness: number; pieces: Piece[] }>();
  for (const part of model.parts) {
    if (part.material !== 'plywood' || part.sourcing === 'owned') continue;
    const species = getSpecies(part.species);
    const size = cutSize(part);
    const k = `${species.id}/${size.thickness}`;
    if (!byGroup.has(k)) byGroup.set(k, { species, thickness: size.thickness, pieces: [] });
    // Turn a grain-doesn't-matter piece crosswise when that's the only way it fits.
    const fits = size.width <= SHEET.usableWidth && size.length <= SHEET.usableLength;
    const turned = !fits && part.rotatable && size.length <= SHEET.usableWidth && size.width <= SHEET.usableLength;
    byGroup.get(k)!.pieces.push({
      partId: part.id,
      name: part.name,
      makes: part.panel ?? { id: part.id, name: part.name },
      ...size,
      ...(turned ? { width: size.length, length: size.width } : {}),
    });
  }
  const groups: StockGroup[] = [];
  for (const { species, thickness, pieces } of byGroup.values()) {
    const packed = packBoards(pieces, SHEET.usableWidth, SHEET.usableLength, kerf);
    if (!packed) {
      const big = pieces.find((p) => p.width > SHEET.usableWidth || p.length > SHEET.usableLength)!;
      throw new Error(
        `${big.name} (${big.width.toFixed(1)}″ × ${big.length.toFixed(1)}″) doesn't fit on a 4′ × 8′ sheet.` +
          (/back/i.test(big.name) ? ' Add a fixed shelf so the back can be made in two pieces.' : ''),
      );
    }
    const price = sheetPrice(species, thickness);
    groups.push({
      kind: 'sheet',
      species: species.id,
      stock: { label: `${thickness}″ plywood`, nominal: thickness, maxFinished: thickness },
      boards: packed.map((b) => ({ ...b, size: SHEET, boardFeet: 0 })),
      purposes: purposesOf(pieces),
      boardFeet: { net: 0, packed: 0, recommended: 0 },
      pricePerBoardFoot: price,
      cost: packed.length * price,
    });
  }
  return groups.sort((a, b) => b.stock.nominal - a.stock.nominal);
}

export function planLumber(model: Model): LumberPlan {
  const { kerf, overage } = model.spec.stock;
  const byGroup = new Map<string, { species: Species; stock: StockThickness; pieces: Piece[] }>();
  for (const part of model.parts) {
    if (part.material === 'steel' || part.material === 'plywood' || part.sourcing === 'owned') continue;
    const species = getSpecies(part.species);
    const size = cutSize(part);
    const stock = stockThicknessFor(size.thickness, species);
    const k = `${species.id}/${stock.label}`;
    if (!byGroup.has(k)) byGroup.set(k, { species, stock, pieces: [] });
    byGroup.get(k)!.pieces.push({ partId: part.id, name: part.name, makes: part.panel ?? { id: part.id, name: part.name }, ...size });
  }

  const groups: StockGroup[] = [];
  for (const { species, stock, pieces } of byGroup.values()) {
    const sizes = boardSizes(species, stock);
    const boards = planBoards(pieces, sizes.common, kerf, stock) ?? planBoards(pieces, sizes.all, kerf, stock);
    if (!boards) throw unsourceable(pieces, stock, species, sizes.all);
    const packed = boards.reduce((s, b) => s + b.boardFeet, 0);
    const net = pieces.reduce((s, p) => s + boardFeet(stock.nominal, p.width, p.length), 0);
    const recommended = packed * (1 + overage);
    const price = species.pricePerBoardFoot * thicknessPremium(stock, species);
    groups.push({
      kind: 'lumber',
      species: species.id,
      stock,
      boards,
      purposes: purposesOf(pieces),
      boardFeet: { net, packed, recommended },
      pricePerBoardFoot: price,
      cost: recommended * price,
    });
  }
  groups.sort((a, b) => b.stock.nominal - a.stock.nominal);
  groups.push(...planSheets(model, kerf));

  const sum = (f: (g: StockGroup) => number) => groups.reduce((s, g) => s + f(g), 0);
  return {
    groups,
    totals: {
      netBoardFeet: sum((g) => g.boardFeet.net),
      packedBoardFeet: sum((g) => g.boardFeet.packed),
      recommendedBoardFeet: sum((g) => g.boardFeet.recommended),
      cost: sum((g) => g.cost),
    },
    settings: { kerf, overage },
  };
}
