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
  /**
   * Dimensional change coefficients (fraction of width per 1% change in
   * moisture content), USDA Wood Handbook table 4-5. Tangential applies to
   * flatsawn faces — most boards and nearly all slabs — radial to quartersawn.
   */
  movement: { tangential: number; radial: number };
  /** Modulus of elasticity (bending stiffness) at 12% MC, psi. USDA Wood Handbook table 5-3a. */
  modulusPsi: number;
}

export const SPECIES: Record<string, Species> = {
  'red-oak': { id: 'red-oak', name: 'Red oak', densityLbPerFt3: 44, pricePerBoardFoot: 6, soldAs: 'rough', blotchy: false, color: '#c4986a', movement: { tangential: 0.00369, radial: 0.00158 }, modulusPsi: 1820000 },
  'white-oak': { id: 'white-oak', name: 'White oak', densityLbPerFt3: 47, pricePerBoardFoot: 9, soldAs: 'rough', blotchy: false, color: '#b8a07a', movement: { tangential: 0.00365, radial: 0.0018 }, modulusPsi: 1780000 },
  walnut: { id: 'walnut', name: 'Black walnut', densityLbPerFt3: 38, pricePerBoardFoot: 14, soldAs: 'rough', blotchy: false, color: '#7a5640', movement: { tangential: 0.00274, radial: 0.0019 }, modulusPsi: 1680000 },
  'hard-maple': { id: 'hard-maple', name: 'Hard maple', densityLbPerFt3: 44, pricePerBoardFoot: 7.5, soldAs: 'rough', blotchy: true, color: '#e3cfa8', movement: { tangential: 0.00353, radial: 0.00165 }, modulusPsi: 1830000 },
  'soft-maple': { id: 'soft-maple', name: 'Soft maple', densityLbPerFt3: 38, pricePerBoardFoot: 5.5, soldAs: 'rough', blotchy: true, color: '#dcc49c', movement: { tangential: 0.00289, radial: 0.00137 }, modulusPsi: 1640000 },
  cherry: { id: 'cherry', name: 'Cherry', densityLbPerFt3: 35, pricePerBoardFoot: 9, soldAs: 'rough', blotchy: true, color: '#a8664a', movement: { tangential: 0.00248, radial: 0.00126 }, modulusPsi: 1490000 },
  ash: { id: 'ash', name: 'Ash', densityLbPerFt3: 41, pricePerBoardFoot: 6.5, soldAs: 'rough', blotchy: false, color: '#d6c29c', movement: { tangential: 0.00274, radial: 0.00169 }, modulusPsi: 1740000 },
  poplar: { id: 'poplar', name: 'Poplar', densityLbPerFt3: 29, pricePerBoardFoot: 4, soldAs: 'rough', blotchy: true, color: '#cfc79a', movement: { tangential: 0.00289, radial: 0.00158 }, modulusPsi: 1580000 },
  pine: { id: 'pine', name: 'Pine (S4S)', densityLbPerFt3: 26, pricePerBoardFoot: 3, soldAs: 'dimensional', blotchy: true, color: '#e8cf9a', movement: { tangential: 0.00212, radial: 0.00071 }, modulusPsi: 1240000 },
};

export function getSpecies(id: string): Species {
  const s = Object.hasOwn(SPECIES, id) ? SPECIES[id] : undefined;
  if (!s) throw new Error(`Unknown species "${id}". Known: ${Object.keys(SPECIES).join(', ')}`);
  return s;
}
