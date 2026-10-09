import { getSpecies } from '../../core/species';
import type { NormalizedSpec } from '../../core/types';
import { formatLength } from '../../core/units';

/**
 * World frame for every table: x = table length, y = up (floor at 0),
 * z = table width. Tables are centred on the origin in plan.
 */

export type TableStyle = 'classic' | 'live-edge' | 'round';
export type SteelLegStyle = 'u' | 'trapezoid' | 'x' | 'hairpin';

export interface TableOptions {
  tableStyle: TableStyle;
  // Round
  roundTop: 'boards' | 'slab';
  roundBase: 'pedestal' | 'four-legs';
  // Slab tops (live edge, round slab)
  /** Widths measured at even spacing from one end of the finished slab to the other; [] if not given. */
  widthProfile: number[];
  narrowWidth: number;
  slabLength: number;
  slabThickness: number;
  flattenAllowance: number;
  // Bought steel legs (live edge)
  steelLegStyle: SteelLegStyle;
  steelLegInset: number;
  steelLegWidth: number;
  steelTubeSize: number;
  // Leg-and-apron base (classic, round four-legs)
  legStyle: 'straight' | 'tapered';
  legThickness: number;
  taperFootSize: number;
  taperStart: number;
  apronInset: number;
  apronWidth: number;
  apronThickness: number;
  tenonLength: number;
  // Board tops
  topThickness: number;
  overhang: number;
  maxTopBoardWidth: number;
  // Pedestal
  /** Select value, e.g. '3.5'. */
  columnSize: string;
  footSpan: number;
}

export const opts = (spec: NormalizedSpec) => spec.options as unknown as TableOptions;

/** Length formatter in the spec's own units. */
export const fmt = (spec: NormalizedSpec) => (inches: number) => formatLength(inches, spec.units);

export const usesSlab = (o: Pick<TableOptions, 'tableStyle' | 'roundTop'>) =>
  o.tableStyle === 'live-edge' || (o.tableStyle === 'round' && o.roundTop === 'slab');

export const usesApronBase = (o: Pick<TableOptions, 'tableStyle' | 'roundBase'>) =>
  o.tableStyle === 'classic' || (o.tableStyle === 'round' && o.roundBase === 'four-legs');

export const hasProfile = (o: Pick<TableOptions, 'tableStyle' | 'widthProfile'>) =>
  o.tableStyle === 'live-edge' && Array.isArray(o.widthProfile) && o.widthProfile.length >= 2;

/**
 * Nominal slab width at distance x from the first end. With measurements,
 * widths blend between stations along a cosine curve, which passes through
 * every measurement and never overshoots them; without, the slab tapers
 * straight from the widest end to the narrow end.
 */
export function slabWidthFn(L: number, W: number, o: Pick<TableOptions, 'tableStyle' | 'widthProfile' | 'narrowWidth'>): (x: number) => number {
  if (hasProfile(o)) {
    const p = o.widthProfile;
    const step = L / (p.length - 1);
    return (x: number) => {
      const t = Math.min(Math.max(x / step, 0), p.length - 1);
      const i = Math.min(Math.floor(t), p.length - 2);
      const u = (1 - Math.cos(Math.PI * (t - i))) / 2;
      return p[i] + (p[i + 1] - p[i]) * u;
    };
  }
  return (x: number) => W + ((o.narrowWidth - W) * x) / L;
}

export function slabWidthAt(spec: NormalizedSpec, x: number): number {
  return slabWidthFn(spec.dimensions.length, spec.dimensions.width, opts(spec))(x);
}

/** Finished top thickness: a slab loses its flattening allowance. */
export function topThickness(o: TableOptions): number {
  return usesSlab(o) ? o.slabThickness - o.flattenAllowance : o.topThickness;
}

/**
 * Smooth, repeatable "natural" wobble in [0, 1] for live edges. Integer
 * frequencies make it periodic over t ∈ [0, 1] (needed for round slabs);
 * the seed keeps a given slab looking the same between renders.
 */
export function wobble(t: number, seed: number): number {
  let s = 0;
  let norm = 0;
  for (let k = 1; k <= 5; k++) {
    const phase = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    s += Math.sin(2 * Math.PI * (k + 1) * t + phase) / k;
    norm += 1 / k;
  }
  return (s / norm + 1) / 2;
}

export function finishStep(spec: NormalizedSpec): string {
  const species = getSpecies(spec.species);
  const live = usesSlab(opts(spec));
  switch (spec.finish) {
    case 'stain':
      return (
        (species.blotchy ? `${species.name} blotches: apply a pre-stain conditioner first. ` : '') +
        'Sand to 180, stain the base and top separately (including the underside of the top), then 2–3 coats of clear topcoat.'
      );
    case 'paint':
      return 'Fill any gaps, sand to 220, prime, then two coats of paint. Seal the underside of the top too.';
    case 'raw':
      return 'Sand to 180–220. Left raw, the wood will mark easily; at least a coat of wax is recommended.';
    default:
      return live
        ? 'Sand to 180–220, flood on oil (or hardwax oil), wipe off after 15 minutes; 3 coats a day apart. Finish the underside and the live edge as heavily as the top so the slab dries evenly.'
        : 'Sand to 180, flood on oil, wipe off after 15 minutes; 3 coats a day apart. Finish both sides of the top equally.';
  }
}

/** Preparing a slab you already own: dry it, flatten it, stabilise it. */
export function slabPrepSteps(spec: NormalizedSpec, trimTo?: string): string[] {
  const o = opts(spec);
  const f = fmt(spec);
  return [
    'Check the slab with a moisture meter: 6–8% for indoor furniture. A wetter slab will keep moving, cracking and cupping after it is built.',
    'Knock off loose bark and clean the live edge with a drawknife and a stiff wire brush down to firm wood.',
    `Flatten both faces on a router sled, about ${f(o.flattenAllowance / 2)} off each face, to a finished ${f(topThickness(o))}.`,
    ...(trimTo ? [trimTo] : []),
    'Stabilise checks with butterfly keys across the crack, and fill voids and loose knots with epoxy. Let it cure fully.',
    'Sand the faces 80 → 120 → 180 (220 for an oil finish); sand the live edge by hand to keep its shape.',
  ];
}
