import { describe, expect, it } from 'vitest';
import { getSpecies } from '../src/core/species';
import { formatInches } from '../src/core/units';
import { plan } from '../src/output/plan';
import { packBoards, stockThicknessFor, type Piece } from '../src/output/stock';

const piece = (length: number, width: number, id = 'p'): Piece => ({ partId: id, name: id, length, width, thickness: 0.75 });

describe('stock thickness', () => {
  const oak = getSpecies('red-oak');
  it('allows 1/4″ for milling rough lumber', () => {
    expect(stockThicknessFor(0.75, oak).label).toBe('4/4');
    expect(stockThicknessFor(1, oak).label).toBe('5/4');
    expect(stockThicknessFor(1.75, oak).label).toBe('8/4');
    // 9/4 isn't stocked: round up to the next thickness yards carry
    expect(stockThicknessFor(1.8, oak).label).toBe('10/4');
    expect(stockThicknessFor(2.5, oak).label).toBe('12/4');
    expect(() => stockThicknessFor(4, oak)).toThrow(/laminate/);
  });
  it('maps softwood to surfaced nominal sizes', () => {
    const pine = getSpecies('pine');
    expect(stockThicknessFor(0.75, pine).label).toBe('1×');
    expect(stockThicknessFor(1.5, pine).label).toBe('2×');
    expect(stockThicknessFor(1.75, pine).label).toBe('4×');
  });
});

describe('packBoards', () => {
  it('charges a kerf between crosscut pieces', () => {
    // 2 × 35″ + 1/8″ kerf = 70.125″ > 70″ usable → needs two boards
    expect(packBoards([piece(35, 3), piece(35, 3)], 3.5, 70, 0.125)).toHaveLength(2);
    expect(packBoards([piece(34.9, 3), piece(34.9, 3)], 3.5, 70, 0.125)).toHaveLength(1);
  });

  it('charges a kerf between ripped strips', () => {
    // two 40″ pieces can't share a 70″ strip, so side by side they need 3-5/8″ of width
    expect(packBoards([piece(40, 1.75), piece(40, 1.75)], 3.5, 70, 0.125)).toHaveLength(2);
    expect(packBoards([piece(40, 1.75), piece(40, 1.75)], 3.625, 70, 0.125)).toHaveLength(1);
  });

  it('places pieces without overlap and inside the board', () => {
    const pieces = [piece(56, 4, 'a'), piece(56, 4, 'b'), piece(32, 4, 'c'), piece(32, 4, 'd'), piece(12, 2, 'e')];
    const boards = packBoards(pieces, 7.5, 94, 0.125)!;
    const placed = boards.flatMap((b) => b.placements);
    expect(placed).toHaveLength(pieces.length);
    for (const b of boards) {
      for (const p of b.placements) {
        expect(p.x + p.length).toBeLessThanOrEqual(94);
        expect(p.y + p.width).toBeLessThanOrEqual(7.5);
      }
      for (let i = 0; i < b.placements.length; i++)
        for (let k = i + 1; k < b.placements.length; k++) {
          const p = b.placements[i];
          const q = b.placements[k];
          const apart = p.x + p.length + 0.125 <= q.x + 1e-9 || q.x + q.length + 0.125 <= p.x + 1e-9 || p.y + p.width + 0.125 <= q.y + 1e-9 || q.y + q.width + 0.125 <= p.y + 1e-9;
          expect(apart).toBe(true);
        }
    }
  });

  it('returns null when a piece is bigger than the board', () => {
    expect(packBoards([piece(80, 3)], 5.5, 70, 0.125)).toBeNull();
  });
});

describe('lumber plan for the dining table', () => {
  const p = plan({
    projectType: 'table',
    units: 'in',
    dimensions: { length: 60, width: 36, height: 30 },
    species: 'red-oak',
    joinery: 'mortise-tenon',
  });

  it('groups by rough thickness and buys whole boards', () => {
    const labels = p.lumber.groups.map((g) => g.stock.label);
    expect(labels).toEqual(['8/4', '5/4', '4/4']);
    const legs = p.lumber.groups[0];
    // four 29″ legs: two strips of two legs on a 5″ (4-1/2″ usable) × 6′ board
    expect(legs.boards).toHaveLength(1);
    expect(legs.boards[0].size).toMatchObject({ width: 5, length: 72 });
    expect(legs.boardFeet.packed).toBeCloseTo((2 * 5 * 72) / 144);
  });

  it('adds overage on top of kerf and trim, and costs it', () => {
    const t = p.lumber.totals;
    expect(t.netBoardFeet).toBeLessThan(t.packedBoardFeet);
    expect(t.recommendedBoardFeet).toBeCloseTo(t.packedBoardFeet * 1.15);
    expect(t.cost).toBeGreaterThan(0);
    expect(p.shoppingList[0]).toMatch(/^~5\.8 board feet of 8\/4 red oak: one board at least 5″ wide × 6′ long, for the legs\.$/);
  });

  it('cut list groups identical parts', () => {
    const legs = p.cutList.find((r) => r.role === 'leg')!;
    expect(legs.quantity).toBe(4);
    expect(p.cutList.map((r) => r.quantity).reduce((a, b) => a + b)).toBe(p.model.parts.length);
  });
});

describe('formatInches', () => {
  it('formats to the nearest sixteenth', () => {
    expect(formatInches(29.25)).toBe('29-1/4″');
    expect(formatInches(0.9375)).toBe('15/16″');
    expect(formatInches(12)).toBe('12″');
    expect(formatInches(56.375)).toBe('56-3/8″');
  });
});

describe('board sizing', () => {
  const long = plan({
    projectType: 'table',
    units: 'in',
    dimensions: { length: 130, width: 44, height: 30 },
    species: 'white-oak',
    joinery: 'mortise-tenon',
    options: { legStyle: 'straight', legThickness: 2.5 },
  });

  it('sources a 10′+ top from 12′ boards', () => {
    const top = long.lumber.groups.find((g) => g.purposes.includes('Top'))!;
    expect(top.boards.every((b) => b.size.length === 144)).toBe(true);
  });

  it('sizes each board to what it carries, so the last board can be smaller', () => {
    const aprons = long.lumber.groups.find((g) => g.stock.label === '4/4')!;
    const lengths = aprons.boards.map((b) => b.size.length).sort((a, b) => a - b);
    expect(lengths).toEqual([96, 144, 144]);
    for (const b of aprons.boards) for (const pl of b.placements) expect(pl.x + pl.length).toBeLessThanOrEqual(b.size.usableLength + 1e-9);
    expect(long.shoppingList.some((l) => /two boards at least 5″ wide × 12′ long and one at least 5″ × 8′/.test(l))).toBe(true);
  });

  it('prefers 6′ boards to 12′ boards when they use the same wood', () => {
    const dining = plan({
      projectType: 'table',
      units: 'in',
      dimensions: { length: 60, width: 36, height: 30 },
      species: 'red-oak',
      joinery: 'mortise-tenon',
    });
    const top = dining.lumber.groups.find((g) => g.stock.label === '5/4')!;
    expect(top.boards.map((b) => b.size.length)).toEqual([72, 72, 72, 72, 72, 72]);
  });

  it('explains when a piece is too wide for any board', () => {
    expect(() =>
      plan({
        projectType: 'table',
        units: 'in',
        dimensions: { length: 60, width: 36, height: 30 },
        species: 'red-oak',
        joinery: 'mortise-tenon',
        options: { maxTopBoardWidth: 12 },
      }),
    ).toThrow(/wide.*max top board width/);
  });
});
