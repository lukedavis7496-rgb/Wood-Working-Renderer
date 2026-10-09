import { box, type Hexa } from '../../core/geom';
import type { SteelLegStyle } from './common';
import { HAIRPIN_EDGE_INSET } from './steelLegs';

/**
 * Where to put the legs of a slab table so chairs fit.
 *
 * Seating guidance used here (common furniture-planning rules):
 * - each diner needs about 24″ of table edge at minimum; a typical 20″
 *   chair plus elbow room makes 26″ comfortable, which is what we plan with;
 * - someone sitting at an end needs at least 12″ of knee room between the
 *   end of the top and a leg frame that spans the width, 14″ to be
 *   comfortable;
 * - a seat at the end also needs the top to be at least 24″ wide there.
 *
 * Frame legs (U, trapezoid, X) span the width, so they block the ends'
 * knee room and bound the side seating between them. Hairpins sit at the
 * corners: the end seat goes between the two hairpins instead.
 */
export const SEAT_WIDTH = 26;
export const SEAT_WIDTH_MIN = 24;
export const KNEE_ROOM = 14;
export const KNEE_ROOM_MIN = 12;
/** Below this height it's a coffee or side table: nobody pulls up a chair. */
export const DINING_HEIGHT = 26;
const HAIRPIN_PLATE = 4;

export interface Seating {
  /** Leg centre distance from each end. */
  inset: number;
  perSide: number;
  /** 0 or 1 at each end. */
  perEnd: number;
  total: number;
  /** Edge length per side diner between the legs. */
  sideRoom: number;
  /** Clear depth from the end of the top to the leg (frame legs). */
  kneeRoom: number;
}

interface Layout {
  style: SteelLegStyle;
  length: number;
  tube: number;
  /** Slab width at a distance from the first end. */
  widthAt: (x: number) => number;
}

/** How many sit at this table with legs `inset` from each end. */
export function seatingFor(l: Layout, inset: number): Seating {
  const half = l.style === 'hairpin' ? HAIRPIN_PLATE / 2 : l.tube / 2;
  const kneeRoom = inset - half;
  const span = l.length - 2 * (inset + half);
  const perSide = Math.max(0, Math.floor(span / SEAT_WIDTH + 1e-9));
  const endWidth = Math.min(l.widthAt(0), l.widthAt(l.length));
  let perEnd = 0;
  if (endWidth >= SEAT_WIDTH_MIN) {
    if (l.style === 'hairpin') {
      // Knees go between the two hairpins at that end.
      const gap = Math.min(l.widthAt(inset), l.widthAt(l.length - inset)) - 2 * (HAIRPIN_EDGE_INSET + HAIRPIN_PLATE);
      perEnd = gap >= 22 ? 1 : 0;
    } else {
      perEnd = kneeRoom >= KNEE_ROOM_MIN - 1e-9 ? 1 : 0;
    }
  }
  return { inset, perSide, perEnd, total: 2 * perSide + 2 * perEnd, sideRoom: perSide ? span / perSide : span, kneeRoom };
}

/**
 * The leg position that seats the most people, then puts more of them on the
 * sides (where people prefer to sit), then gives each more room, then keeps
 * the legs nearer the ends (steadier, less overhang). Frame legs stay at
 * least 4″ in from the ends and never more than a quarter of the length (or
 * 20″).
 */
export function recommendedSeating(l: Layout): Seating {
  const half = l.style === 'hairpin' ? HAIRPIN_PLATE / 2 : l.tube / 2;
  // Frame legs right at the ends look like a bench and catch toes; hairpins
  // sit at the corners by design.
  const min = half + (l.style === 'hairpin' ? 2 : 4);
  const max = Math.max(min, Math.min(20, l.length / 4));
  let best: Seating | null = null;
  for (let inset = min; inset <= max + 1e-9; inset += 0.5) {
    const s = seatingFor(l, inset);
    // An end seat needs the comfortable knee room, not just the minimum.
    if (s.perEnd && l.style !== 'hairpin' && s.kneeRoom < KNEE_ROOM - 1e-9) continue;
    const better =
      !best ||
      s.total > best.total ||
      (s.total === best.total && (s.perSide > best.perSide || (s.perSide === best.perSide && s.sideRoom > best.sideRoom + 1e-9)));
    if (better) best = s;
  }
  return best ?? seatingFor(l, min);
}

/** Ghost chairs for the 3D view: seat, back and four legs, in world coordinates. */
export function chairGhosts(l: Layout, s: Seating): Hexa[][] {
  const chairs: Hexa[][] = [];
  const half = l.style === 'hairpin' ? HAIRPIN_PLATE / 2 : l.tube / 2;
  const L = l.length;
  // A chair 18″ square, seat at 18″, back to 32″, pushed 4″ under the edge.
  const chair = (cx: number, cz: number, facing: 'x+' | 'x-' | 'z+' | 'z-'): Hexa[] => {
    const parts: [number, number, number, number, number, number][] = [
      [-9, 9, 17, 18.5, -9, 9], // seat
      ...[-8, 7].flatMap((a) => [-8, 7].map((b): [number, number, number, number, number, number] => [a, a + 1, 0, 17, b, b + 1])),
      [-9, 9, 18.5, 32, 8, 9], // back, on the side away from the table
    ];
    return parts.map(([x0, x1, y0, y1, z0, z1]) => {
      const rot = (x: number, z: number): [number, number] =>
        facing === 'z-' ? [x, z] : facing === 'z+' ? [-x, -z] : facing === 'x-' ? [z, -x] : [-z, x];
      const b = box(x0, x1, y0, y1, z0, z1);
      return b.map((p) => {
        const [x, z] = rot(p[0], p[2]);
        return [cx + x, p[1], cz + z];
      }) as unknown as Hexa;
    });
  };
  const start = -L / 2 + s.inset + half;
  const span = L - 2 * (s.inset + half);
  for (let i = 0; i < s.perSide; i++) {
    const x = start + ((i + 0.5) * span) / s.perSide;
    const w = l.widthAt(x + L / 2) / 2;
    chairs.push(chair(x, w + 5, 'z-'), chair(x, -w - 5, 'z+'));
  }
  if (s.perEnd) chairs.push(chair(-L / 2 - 5, 0, 'x+'), chair(L / 2 + 5, 0, 'x-'));
  return chairs;
}
