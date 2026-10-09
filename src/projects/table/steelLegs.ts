import { box, mapHexa, type Hexa } from '../../core/geom';
import type { HardwareItem, NormalizedSpec, Part, Shape } from '../../core/types';
import { fmt, opts, slabWidthAt, type SteelLegStyle } from './common';

/**
 * Bought steel legs under a slab. They are not cut parts: they appear in the
 * shopping list with the size to order, and in the model so you can judge
 * proportions.
 */

export const STEEL_LEG_LABELS: Record<SteelLegStyle, string> = {
  u: 'U-shaped (square frame)',
  trapezoid: 'Trapezoid',
  x: 'X-shaped',
  hairpin: 'Hairpin',
};

/** Rough retail price per leg, USD. */
const STEEL_LEG_PRICE: Record<SteelLegStyle, number> = { u: 75, trapezoid: 80, x: 85, hairpin: 18 };
const HAIRPIN_ROD = 1 / 2;
/** Hairpins sit this far in from the slab's edges. */
export const HAIRPIN_EDGE_INSET = 2;

/** Default leg width: 2″ in from each edge at the narrower leg, rounded down to a stock even inch. */
export function defaultSteelLegWidth(widthAt: (x: number) => number, L: number, inset: number): number {
  const room = Math.min(widthAt(inset), widthAt(L - inset)) - 4;
  return Math.max(8, Math.floor(room / 2) * 2);
}

/** A bar from (zA, yA) to (zB, yB) in the leg's plane, s thick in x. */
function slantedBar(s: number, zA: number, yA: number, zB: number, yB: number): Hexa {
  // Box x ∈ [-s/2, s/2], y ∈ [yA, yB], z ∈ [0, s], then shear z along y.
  return mapHexa(box(-s / 2, s / 2, yA, yB, 0, s), (p, i) => [p[0], p[1], p[2] + (i & 2 ? zB : zA)]);
}

export function steelLegs(spec: NormalizedSpec, legHeight: number): { parts: Part[]; hardware: HardwareItem[]; notes: string[] } {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: L } = spec.dimensions;
  const s = o.steelTubeSize;
  const h = legHeight;
  const parts: Part[] = [];
  const mk = (id: string, xc: number, zc: number, solids: Shape[]): Part => ({
    id,
    role: 'steel-leg',
    name: `${STEEL_LEG_LABELS[o.steelLegStyle]} steel leg`,
    species: spec.species,
    material: 'steel',
    solids,
    cutouts: [],
    placement: { origin: [xc, 0, zc], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
    notes: [],
  });

  const xs = [-L / 2 + o.steelLegInset, L / 2 - o.steelLegInset];
  if (o.steelLegStyle === 'hairpin') {
    xs.forEach((xc, i) => {
      const half = slabWidthAt(spec, xc + L / 2) / 2 - HAIRPIN_EDGE_INSET;
      for (const side of [-1, 1]) {
        const zc = side * (half - 2);
        const r = HAIRPIN_ROD;
        const plate: Shape = { kind: 'body', hexa: box(-2, 2, h - 0.25, h, -2, 2) };
        // Two rods from the plate's ends converging to one foot.
        const rods: Shape[] = [-1.5, 1.5].map((dx) => ({
          kind: 'body',
          hexa: mapHexa(box(-r / 2, r / 2, 0, h - 0.25, -r / 2, r / 2), (p, k) => [p[0] + (k & 2 ? dx : 0), p[1], p[2]]),
        }));
        parts.push(mk(`steel-leg-${i * 2 + (side > 0 ? 2 : 1)}`, xc, zc, [plate, ...rods]));
      }
    });
  } else {
    const W = o.steelLegWidth;
    xs.forEach((xc, i) => {
      const solids: Shape[] = [];
      const bar = (z0: number, z1: number, y0: number, y1: number): Shape => ({ kind: 'body', hexa: box(-s / 2, s / 2, y0, y1, z0, z1) });
      if (o.steelLegStyle === 'u') {
        solids.push(bar(-W / 2, W / 2, 0, s), bar(-W / 2, W / 2, h - s, h), bar(-W / 2, -W / 2 + s, s, h - s), bar(W / 2 - s, W / 2, s, h - s));
      } else if (o.steelLegStyle === 'trapezoid') {
        const Wt = W * 0.7;
        solids.push(bar(-W / 2, W / 2, 0, s), bar(-Wt / 2, Wt / 2, h - s, h));
        solids.push({ kind: 'body', hexa: slantedBar(s, -W / 2, s, -Wt / 2, h - s) });
        solids.push({ kind: 'body', hexa: slantedBar(s, W / 2 - s, s, Wt / 2 - s, h - s) });
      } else {
        solids.push(bar(-W / 2, W / 2, h - s, h));
        solids.push({ kind: 'body', hexa: slantedBar(s, -W / 2, 0, W / 2 - s, h - s) });
        solids.push({ kind: 'body', hexa: slantedBar(s, W / 2 - s, 0, -W / 2, h - s) });
      }
      parts.push(mk(`steel-leg-${i + 1}`, xc, 0, solids));
    });
  }

  const count = parts.length;
  const size =
    o.steelLegStyle === 'hairpin'
      ? `${f(h)} tall, ${f(HAIRPIN_ROD)} rod`
      : `${f(h)} tall × ${f(o.steelLegWidth)} wide, ${f(s)} square tube`;
  const hardware: HardwareItem[] = [
    {
      item: `${STEEL_LEG_LABELS[o.steelLegStyle]} steel legs, ${size}`,
      quantity: count,
      unitCost: STEEL_LEG_PRICE[o.steelLegStyle],
      note: o.steelLegStyle === 'hairpin' ? undefined : 'sold in pairs; order the height to the underside of the slab',
    },
    {
      item: '#14 × 1-1/4″ pan-head screws',
      quantity: count * 4,
      note: 'through the leg mounting holes; ream the outer holes into slots across the grain so the slab can move',
    },
  ];
  const notes = [
    o.steelLegStyle === 'hairpin'
      ? `Hairpins ${f(o.steelLegInset)} from each end and ${f(HAIRPIN_EDGE_INSET + 2)} in from the edges.`
      : `Legs centred ${f(o.steelLegInset)} from each end of the slab.`,
  ];
  return { parts, hardware, notes };
}
