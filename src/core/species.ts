/**
 * Species drive weight, cost and how lumber is sold. Prices are rough US
 * retail averages for 4/4 FAS hardwood (or common-grade softwood) per board
 * foot and vary a lot by region — treat cost output as an estimate.
 */
export interface Species {
  id: string;
  name: string;
  /** Air-dried density at ~12% moisture content, lb/ft³. */
  densityLbPerFt3: number;
  /** Approximate price per board foot of 4/4 stock, USD. */
  pricePerBoardFoot: number;
  /**
   * 'rough': hardwood sold rough-sawn by the board foot in quarter thicknesses
   * (4/4, 8/4…), milled down by the woodworker.
   * 'dimensional': softwood sold surfaced in nominal sizes (1×6, 2×4…).
   */
  soldAs: 'rough' | 'dimensional';
  /** Prone to blotching under stain — pre-stain conditioner recommended. */
  blotchy: boolean;
  /** Display colour for the 3D render. */
  color: string;
}

export const SPECIES: Record<string, Species> = {
  'red-oak': { id: 'red-oak', name: 'Red oak', densityLbPerFt3: 44, pricePerBoardFoot: 6, soldAs: 'rough', blotchy: false, color: '#c4986a' },
  'white-oak': { id: 'white-oak', name: 'White oak', densityLbPerFt3: 47, pricePerBoardFoot: 9, soldAs: 'rough', blotchy: false, color: '#b8a07a' },
  walnut: { id: 'walnut', name: 'Black walnut', densityLbPerFt3: 38, pricePerBoardFoot: 14, soldAs: 'rough', blotchy: false, color: '#5c4033' },
  'hard-maple': { id: 'hard-maple', name: 'Hard maple', densityLbPerFt3: 44, pricePerBoardFoot: 7.5, soldAs: 'rough', blotchy: true, color: '#e3cfa8' },
  'soft-maple': { id: 'soft-maple', name: 'Soft maple', densityLbPerFt3: 38, pricePerBoardFoot: 5.5, soldAs: 'rough', blotchy: true, color: '#dcc49c' },
  cherry: { id: 'cherry', name: 'Cherry', densityLbPerFt3: 35, pricePerBoardFoot: 9, soldAs: 'rough', blotchy: true, color: '#a8664a' },
  ash: { id: 'ash', name: 'Ash', densityLbPerFt3: 41, pricePerBoardFoot: 6.5, soldAs: 'rough', blotchy: false, color: '#d6c29c' },
  poplar: { id: 'poplar', name: 'Poplar', densityLbPerFt3: 29, pricePerBoardFoot: 4, soldAs: 'rough', blotchy: true, color: '#cfc79a' },
  pine: { id: 'pine', name: 'Pine (S4S)', densityLbPerFt3: 26, pricePerBoardFoot: 3, soldAs: 'dimensional', blotchy: true, color: '#e8cf9a' },
};

export function getSpecies(id: string): Species {
  const s = SPECIES[id];
  if (!s) throw new Error(`Unknown species "${id}". Known: ${Object.keys(SPECIES).join(', ')}`);
  return s;
}
