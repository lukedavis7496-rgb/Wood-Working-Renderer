import { box, hexaVolume, type Hexa, type Vec3 } from '../../core/geom';
import { getSpecies } from '../../core/species';
import type { Assembly, NormalizedSpec, Part, Shape } from '../../core/types';
import { gluedPanel } from '../shared/panel';
import { fmt, hasProfile, opts, slabWidthFn, topThickness, wobble } from './common';

export interface Top {
  parts: Part[];
  assembly?: Assembly;
  /** Underside of the top, i.e. where the base ends. */
  underside: number;
  /** For slabs: finished weight, lb. */
  weight?: number;
}

/** Hexahedron from a corner function f(xBit, yBit, zBit). */
function hexaFrom(f: (xb: 0 | 1, yb: 0 | 1, zb: 0 | 1) => Vec3): Hexa {
  const c: Vec3[] = [];
  for (let i = 0; i < 8; i++) c.push(f((i & 1) as 0 | 1, ((i >> 1) & 1) as 0 | 1, ((i >> 2) & 1) as 0 | 1));
  return c as unknown as Hexa;
}

/** Rectangular top glued up from boards no wider than maxTopBoardWidth. */
export function rectBoardTop(spec: NormalizedSpec): Top {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: L, width: W, height: H } = spec.dimensions;
  const tt = o.topThickness;
  const y0 = H - tt;
  const panel = gluedPanel(
    {
      id: 'top',
      name: 'Top',
      role: 'top',
      species: spec.species,
      plywood: false,
      width: W,
      maxBoardWidth: o.maxTopBoardWidth,
      // Local x along the table's length, y across its width, z up.
      placement: { origin: [-L / 2, y0, -W / 2], x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0] },
      solids: (a, b) => [{ kind: 'body', hexa: box(0, L, a, b, 0, tt) }],
      assemblyNote: (n) => `Glue ${n} boards edge to edge (alternate growth-ring direction), then flatten and trim to ${f(W)} × ${f(L)}.`,
    },
    { thickness: tt, length: L },
  );
  return { parts: panel.parts, assembly: panel.assembly, underside: y0 };
}

/**
 * Round top glued up from strips, then cut to a circle. Each strip only
 * needs to be as long as the widest chord of the circle it spans, so outer
 * strips come out shorter — the geometry says exactly how much.
 */
export function roundBoardTop(spec: NormalizedSpec): Top {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: D, height: H } = spec.dimensions;
  const R = D / 2;
  const tt = o.topThickness;
  const y0 = H - tt;
  const half = (z: number) => Math.sqrt(Math.max(0, R * R - z * z));
  const panel = gluedPanel(
    {
      id: 'top',
      name: 'Top',
      role: 'top',
      species: spec.species,
      plywood: false,
      width: D,
      maxBoardWidth: o.maxTopBoardWidth,
      // Panel local y runs across the circle from one edge (y = 0) to the other.
      placement: { origin: [-R, y0, -R], x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0] },
      solids: (a, b) => {
        // Band edges: ~1″ bands for a smooth arc, plus the centre line where the chord peaks.
        const cuts = new Set<number>([a, b]);
        const bands = Math.max(2, Math.ceil(b - a));
        for (let k = 1; k < bands; k++) cuts.add(a + (k * (b - a)) / bands);
        if (a < R && b > R) cuts.add(R);
        const ys = [...cuts].sort((p, q) => p - q);
        return ys.slice(0, -1).map((ya, k) => ({
          kind: 'body' as const,
          hexa: hexaFrom((xb, yb, zb) => {
            const y = yb ? ys[k + 1] : ya;
            return [R + (xb ? 1 : -1) * half(y - R), y, zb ? tt : 0];
          }),
        }));
      },
      allowanceReason: 'oversized for glue-up; cut round after',
      assemblyNote: (n) =>
        `Glue ${n} boards edge to edge, flatten, then cut a ${f(D)} circle (router on a trammel, or bandsaw and flush-trim to a template). Outer boards are shorter because the circle is narrower there.`,
    },
    { thickness: tt, length: D },
  );
  return { parts: panel.parts, assembly: panel.assembly && { ...panel.assembly, name: 'Round top' }, underside: y0 };
}

/**
 * A live edge slab you already own. Its outline follows the widths you
 * measured (or a straight taper from the widest to the narrow end), with a
 * small natural wobble between measurements, and the bark edge is undercut
 * toward the bottom face the way most slabs are.
 */
export function liveEdgeSlab(spec: NormalizedSpec): Top {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: L, width: W, height: H } = spec.dimensions;
  const t = topThickness(o);
  const y0 = H - t;
  const measured = hasProfile(o);
  const width = slabWidthFn(L, W, o);
  const seed = L * 7 + W * 3 + o.narrowWidth;
  const undercut = Math.min(0.75, 0.3 * t);
  // Wobble only ever eats inward from the nominal width, so the widest
  // measurement stays exactly W. With measurements it's small and fades to
  // zero at each station; without, it ramps in from the wide end.
  const amp = measured ? Math.min(0.5, 0.015 * W) : Math.min(1.5, 0.06 * W);
  const fade = measured
    ? (x: number) => Math.sin((Math.PI * x * (o.widthProfile.length - 1)) / L) ** 2
    : (x: number) => Math.min(1, (x / L) * 8);
  const left = (x: number) => (W - width(x)) / 2 + amp * fade(x) * wobble(x / L, seed);
  const right = (x: number) => (W + width(x)) / 2 - amp * fade(x) * wobble(x / L, seed + 1);
  const N = measured ? Math.max(48, 12 * (o.widthProfile.length - 1)) : 48;
  const solids: Shape[] = [];
  for (let i = 0; i < N; i++) {
    const xs = [(L * i) / N, (L * (i + 1)) / N];
    solids.push({
      kind: 'body',
      hexa: hexaFrom((xb, yb, zb) => {
        const x = xs[xb];
        const u = zb ? 0 : undercut * (0.6 + 0.4 * wobble(x / L, seed + 2 + yb));
        return [x, yb ? right(x) - u : left(x) + u, zb ? t : 0];
      }),
    });
  }
  const volume = solids.reduce((v, s) => v + hexaVolume(s.hexa), 0);
  const weight = (volume / 1728) * getSpecies(spec.species).densityLbPerFt3;
  const avgWidth = volume / (L * t);
  const roughBoardFeet = (o.slabThickness * avgWidth * o.slabLength) / 144;
  const notes = [
    `Your slab: flatten from ${f(o.slabThickness)} to ${f(t)}, trim from ${f(o.slabLength)} to ${f(L)} long.`,
    measured
      ? `Measured widths, end to end every ${f(L / (o.widthProfile.length - 1))}: ${o.widthProfile.map(f).join(', ')}.`
      : `Width runs from ${f(W)} at the wide end to ${f(o.narrowWidth)} at the narrow end.`,
    `About ${roughBoardFeet.toFixed(0)} board feet as it is now; about ${Math.round(weight)} lb finished.`,
  ];
  return {
    parts: [
      {
        id: 'slab',
        role: 'top',
        name: 'Live edge slab',
        species: spec.species,
        sourcing: 'owned',
        solids,
        cutouts: [],
        placement: { origin: [-L / 2, y0, -W / 2], x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0] },
        notes,
      },
    ],
    underside: y0,
    weight,
  };
}

/** A round slab you already own, with a natural edge all the way round. */
export function roundSlab(spec: NormalizedSpec): Top {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: D, height: H } = spec.dimensions;
  const R = D / 2;
  const t = topThickness(o);
  const y0 = H - t;
  const seed = D * 5 + t;
  const amp = Math.min(1, 0.04 * D);
  const undercut = Math.min(0.75, 0.3 * t);
  const radius = (a: number) => R - amp * wobble(a / (2 * Math.PI), seed);
  const N = 64;
  const solids: Shape[] = [];
  for (let i = 0; i < N; i++) {
    const as = [(2 * Math.PI * i) / N, (2 * Math.PI * ((i + 1) % N)) / N];
    // Wedge from the centre (xBit 0, both y corners coincide) to the rim (xBit 1).
    solids.push({
      kind: 'body',
      hexa: hexaFrom((xb, yb, zb) => {
        if (!xb) return [R, R, zb ? t : 0];
        const a = as[yb];
        const r = radius(a) - (zb ? 0 : undercut);
        return [R + r * Math.cos(a), R + r * Math.sin(a), zb ? t : 0];
      }),
    });
  }
  return {
    parts: [
      {
        id: 'slab',
        role: 'top',
        name: 'Round slab',
        species: spec.species,
        sourcing: 'owned',
        solids,
        cutouts: [],
        placement: { origin: [-R, y0, -R], x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0] },
        notes: [`Your slab: about ${f(D)} across; flatten from ${f(o.slabThickness)} to ${f(t)}.`],
      },
    ],
    underside: y0,
    weight: (solids.reduce((v, s) => v + hexaVolume(s.hexa), 0) / 1728) * getSpecies(spec.species).densityLbPerFt3,
  };
}
