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

const ROUGH_WIDTHS = [4, 5, 6, 7, 8];
const ROUGH_WIDE_WIDTHS = [10, 12];
const ROUGH_LENGTHS = [72, 96, 120];

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
  const quarters = Math.max(4, Math.ceil((finished + MILLING_ALLOWANCE) * 4 - 1e-9));
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

export interface StockGroup {
  species: string;
  stock: StockThickness;
  /** Board size to buy (rough or nominal) and the area actually usable on it. */
  board: { width: number; length: number; usableWidth: number; usableLength: number };
  boards: PackedBoard[];
  purposes: string[];
  boardFeet: { net: number; packed: number; recommended: number };
  pricePerBoardFoot: number;
  cost: number;
}

export interface LumberPlan {
  groups: StockGroup[];
  totals: { netBoardFeet: number; packedBoardFeet: number; recommendedBoardFeet: number; cost: number };
  settings: { kerf: number; overage: number };
}

const boardFeet = (thickness: number, width: number, length: number) => (thickness * width * length) / 144;

export function planLumber(model: Model): LumberPlan {
  const { kerf, overage } = model.spec.stock;
  const byGroup = new Map<string, { species: Species; stock: StockThickness; pieces: Piece[] }>();
  for (const part of model.parts) {
    if (part.material === 'steel' || part.sourcing === 'owned') continue;
    const species = getSpecies(part.species);
    const size = cutSize(part);
    const stock = stockThicknessFor(size.thickness, species);
    const k = `${species.id}/${stock.label}`;
    if (!byGroup.has(k)) byGroup.set(k, { species, stock, pieces: [] });
    byGroup.get(k)!.pieces.push({ partId: part.id, name: part.name, ...size });
  }

  const groups: StockGroup[] = [];
  for (const { species, stock, pieces } of byGroup.values()) {
    const rough = species.soldAs === 'rough';
    const tryWidths = (widths: { nominal: number; usable: number }[]) => {
      let best: Omit<StockGroup, 'purposes' | 'boardFeet' | 'pricePerBoardFoot' | 'cost' | 'species' | 'stock'> & { bf: number } | null = null;
      for (const w of widths) {
        for (const len of rough ? ROUGH_LENGTHS : S4S_LENGTHS) {
          const usableLength = len - (rough ? ROUGH_END_TRIM : S4S_END_TRIM);
          const boards = packBoards(pieces, w.usable, usableLength, kerf);
          if (!boards) continue;
          const bf = boards.length * boardFeet(stock.nominal, w.nominal, len);
          const better = !best || bf < best.bf - 1e-9 || (Math.abs(bf - best.bf) < 1e-9 && boards.length < best.boards.length);
          if (better) best = { bf, boards, board: { width: w.nominal, length: len, usableWidth: w.usable, usableLength } };
        }
      }
      return best;
    };
    const widthOptions = (ws: number[]) => ws.map((w) => ({ nominal: w, usable: w - ROUGH_EDGE_ALLOWANCE }));
    const best = rough
      ? (tryWidths(widthOptions(ROUGH_WIDTHS)) ?? tryWidths(widthOptions(ROUGH_WIDE_WIDTHS)))
      : tryWidths(S4S_WIDTHS.map((w) => ({ nominal: w.nominal, usable: w.actual })));
    if (!best) {
      const longest = Math.max(...pieces.map((p) => p.length));
      throw new Error(`Can't source ${stock.label} ${species.name} for a ${longest.toFixed(1)}″ piece — split it or glue it up.`);
    }
    const net = pieces.reduce((s, p) => s + boardFeet(stock.nominal, p.width, p.length), 0);
    const recommended = best.bf * (1 + overage);
    const price = species.pricePerBoardFoot * thicknessPremium(stock, species);
    groups.push({
      species: species.id,
      stock,
      board: best.board,
      boards: best.boards,
      purposes: [...new Set(pieces.map((p) => p.name))],
      boardFeet: { net, packed: best.bf, recommended },
      pricePerBoardFoot: price,
      cost: recommended * price,
    });
  }
  groups.sort((a, b) => b.stock.nominal - a.stock.nominal);

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
