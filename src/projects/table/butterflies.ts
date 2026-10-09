import { toLocal, toWorld, type Hexa, type Placement, type Vec3 } from '../../core/geom';
import { getSpecies } from '../../core/species';
import type { NormalizedSpec, Part, Shape } from '../../core/types';
import { roundToSixteenth } from '../../core/units';
import { fmt, opts } from './common';

/**
 * Butterfly (bowtie) keys across checks in a slab. Each key is a bowtie
 * whose sides taper 12° from the ends to the waist, the angle hand-cut keys
 * have long used; it's inlaid in a matching mortise, cut from stock 1/16″
 * thicker than the mortise is deep, and sanded flush after gluing.
 *
 * Checks open from the ends of a slab along the grain, so a key's long axis
 * runs across the slab (across the crack) and keys default to positions a
 * few inches in from each end, on the centreline.
 */

export const KEY_TAPER_DEG = 12;
/** Width at the ends as a fraction of the key's length (4″ key → 1-1/2″). */
export const KEY_WIDTH_RATIO = 0.375;
/** Left proud of the slab, then sanded flush. */
export const KEY_PROUD = 1 / 16;

export interface KeySize {
  length: number;
  width: number;
  waist: number;
  /** Finished, flush with the top: the mortise depth. */
  depth: number;
}

export function keySize(length: number, thickness: number): KeySize {
  const width = roundToSixteenth(length * KEY_WIDTH_RATIO);
  const waist = roundToSixteenth(width - length * Math.tan((KEY_TAPER_DEG * Math.PI) / 180));
  return { length, width, waist, depth: thickness - KEY_PROUD };
}

/** Key centres, measured along the slab from its first end. */
export function keyPositions(count: number, given: number[], slabLength: number): number[] {
  // Positions you measure win; the count only spreads keys when you haven't.
  if (given.length) return [...given];
  // Alternate ends, 6″ in, then every 8″ further in.
  return Array.from({ length: count }, (_, i) => {
    const d = 6 + Math.floor(i / 2) * 8;
    return i % 2 ? slabLength - d : d;
  });
}

/**
 * A bowtie in the key's own frame: x along its length (across the crack),
 * y across its width, z up. Two trapezoids meeting at the waist.
 */
function bowtie(k: KeySize): Hexa[] {
  const half = k.length / 2;
  const inset = (k.width - k.waist) / 2;
  const prism = (x0: number, x1: number, wideAtX0: boolean): Hexa => {
    const c: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      const xb = i & 1;
      const yb = (i >> 1) & 1;
      const zb = (i >> 2) & 1;
      const wide = (xb === 0) === wideAtX0;
      const y = wide ? (yb ? k.width : 0) : yb ? k.width - inset : inset;
      c.push([xb ? x1 : x0, y, zb ? k.depth : 0]);
    }
    return c as unknown as Hexa;
  };
  return [prism(0, half, true), prism(half, k.length, false)];
}

/**
 * Build the keys and cut their mortises into the slab. `slab` is the slab
 * part (its local x runs along its length from the first end, z up from its
 * underside); `along` is that length and `top` the height of its top face.
 */
export function butterflyKeys(spec: NormalizedSpec, slab: Part, along: number, top: number): Part[] {
  const o = opts(spec);
  const f = fmt(spec);
  const k = keySize(o.butterflyLength, o.butterflyThickness);
  const positions = keyPositions(o.butterflyCount, o.butterflyPositions, along);
  const species = getSpecies(o.butterflySpecies);
  const slabStart = toWorld(slab.placement, [0, 0, 0])[0];
  return positions.map((x, i) => {
    const cx = slabStart + x;
    // Key frame: its length across the slab (world z), its width along the slab.
    const placement: Placement = { origin: [cx - k.width / 2, top - k.depth, -k.length / 2], x: [0, 0, 1], y: [1, 0, 0], z: [0, 1, 0] };
    const solids: Shape[] = bowtie(k).map((hexa) => ({ kind: 'body', hexa }));
    for (const s of solids) {
      slab.cutouts.push({
        kind: 'mortise',
        hexa: s.hexa.map((p) => toLocal(slab.placement, toWorld(placement, p))) as unknown as Hexa,
      });
    }
    return {
      id: `butterfly-${i + 1}`,
      role: 'butterfly',
      name: 'Butterfly key',
      species: species.id,
      sourcing: 'scrap',
      inlay: { host: slab.id },
      solids,
      cutouts: [],
      placement,
      allowance: { length: 0, width: 0, thickness: KEY_PROUD, reason: `cut ${f(KEY_PROUD)} thick so it stands proud; sand flush after gluing` },
      notes: [
        `${f(k.width)} wide at the ends, ${f(k.waist)} at the waist (${KEY_TAPER_DEG}° sides); grain running the length of the key, across the check.`,
        `Set in a mortise ${f(k.depth)} deep.`,
      ],
    } satisfies Part;
  });
}

export function butterflySteps(spec: NormalizedSpec, positions: number[]): string[] {
  const o = opts(spec);
  const f = fmt(spec);
  const k = keySize(o.butterflyLength, o.butterflyThickness);
  const species = getSpecies(o.butterflySpecies).name.toLowerCase();
  const n = positions.length;
  return [
    `Make ${n} butterfly key${n > 1 ? 's' : ''} from ${f(o.butterflyThickness)} ${species}: ${f(k.length)} long, ${f(k.width)} wide at the ends and ${f(k.waist)} at the waist (${KEY_TAPER_DEG}° sides), grain running the length of the key. Bevel the sides a degree or two so the bottom face is a hair smaller.`,
    `Lay each key across its check (centred ${positions.map(f).join(', ')} from the first end; slide it over the actual crack), knife around it, and rout the mortise ${f(k.depth)} deep with a 1/8″ bit. Pare the corners square with a chisel.`,
    'Glue the keys in and tap them home. Once cured, plane or sand them flush. Fill any remaining voids and loose knots with epoxy.',
  ];
}
