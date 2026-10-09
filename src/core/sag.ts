import { getSpecies } from './species';

/**
 * Shelf sag. A shelf is a beam resting on its two ends under an evenly
 * spread load, so its middle drops
 *
 *   δ = 5 w L⁴ / (384 E I),   I = depth × thickness³ / 12
 *
 * Woodworkers commonly accept up to 0.02″ of sag per foot of span; more than
 * that is visible and keeps creeping over the years. Dadoed ends are treated
 * as simply supported, which errs on the safe side.
 */

/** Plywood is roughly half as stiff as solid wood along its face grain. */
export const PLYWOOD_MODULUS_PSI = 1_000_000;
export const SAG_LIMIT_PER_FOOT = 0.02;

export const SHELF_LOADS = {
  light: { label: 'Light (decor, paperbacks)', lbPerFt: 10 },
  books: { label: 'Books', lbPerFt: 20 },
  heavy: { label: 'Heavy (art books, records)', lbPerFt: 35 },
} as const;
export type ShelfLoad = keyof typeof SHELF_LOADS;

export interface SagResult {
  /** Mid-span drop under the load, inches. */
  sag: number;
  /** The acceptable sag for this span, inches. */
  limit: number;
  /** The longest span this shelf can have and stay within the limit, inches. */
  maxSpan: number;
}

export function shelfSag(opts: {
  species: string;
  plywood: boolean;
  span: number;
  depth: number;
  thickness: number;
  lbPerFt: number;
}): SagResult {
  const E = opts.plywood ? PLYWOOD_MODULUS_PSI : getSpecies(opts.species).modulusPsi;
  const I = (opts.depth * opts.thickness ** 3) / 12;
  const w = opts.lbPerFt / 12;
  const sag = (5 * w * opts.span ** 4) / (384 * E * I);
  const limit = (SAG_LIMIT_PER_FOOT * opts.span) / 12;
  // 5wL³/(384EI) = 0.02/12  →  L = ∛(384·E·I·0.02 / (5·w·12))
  const maxSpan = Math.cbrt((384 * E * I * SAG_LIMIT_PER_FOOT) / (5 * w * 12));
  return { sag, limit, maxSpan };
}
