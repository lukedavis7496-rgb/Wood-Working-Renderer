import { box, type Hexa, type Vec3 } from '../../core/geom';
import type { Assembly, NormalizedSpec, Part, Shape } from '../../core/types';
import { fmt, opts, topThickness, wobble } from './common';

/** Oversize for each glue-up board: trimmed off after the panel cures. */
export const TOP_BOARD_ALLOWANCE = { length: 1, width: 1 / 4 };

export interface Top {
  parts: Part[];
  assembly?: Assembly;
  /** Underside of the top, i.e. where the base ends. */
  underside: number;
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
  const n = Math.ceil(W / o.maxTopBoardWidth - 1e-9);
  const bw = W / n;
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    parts.push({
      id: `top-${i + 1}`,
      role: 'top',
      name: n > 1 ? 'Top board (glue-up)' : 'Top',
      species: spec.species,
      solids: [{ kind: 'body', hexa: box(0, L, 0, bw, 0, tt) }],
      cutouts: [],
      placement: { origin: [-L / 2, y0, -W / 2 + i * bw], x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0] },
      allowance: { ...TOP_BOARD_ALLOWANCE, reason: n > 1 ? 'oversized for glue-up; trim after' : 'oversized; trim to final size' },
      notes: [],
    });
  }
  return {
    parts,
    underside: y0,
    assembly: {
      name: 'Top panel',
      partIds: parts.map((p) => p.id),
      finishedSize: { thickness: tt, width: W, length: L },
      note:
        n > 1
          ? `Glue ${n} boards edge to edge (alternate growth-ring direction), then flatten and trim to ${f(W)} × ${f(L)}.`
          : `Trim to ${f(W)} × ${f(L)}.`,
    },
  };
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
  const n = Math.ceil(D / o.maxTopBoardWidth - 1e-9);
  const bw = D / n;
  const half = (z: number) => Math.sqrt(Math.max(0, R * R - z * z));
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const z0 = -R + i * bw;
    const z1 = z0 + bw;
    // Band edges: ~1″ bands for a smooth arc, plus z = 0 where the chord peaks.
    const cuts = new Set<number>([z0, z1]);
    const bands = Math.max(2, Math.ceil(bw));
    for (let k = 1; k < bands; k++) cuts.add(z0 + (k * bw) / bands);
    if (z0 < 0 && z1 > 0) cuts.add(0);
    const zs = [...cuts].sort((a, b) => a - b);
    const solids: Shape[] = [];
    for (let k = 0; k + 1 < zs.length; k++) {
      const za = zs[k];
      const zb = zs[k + 1];
      solids.push({
        kind: 'body',
        hexa: hexaFrom((xb, yb, zb_) => {
          const z = yb ? zb : za;
          return [R + (xb ? 1 : -1) * half(z), z - z0, zb_ ? tt : 0];
        }),
      });
    }
    parts.push({
      id: `top-${i + 1}`,
      role: 'top',
      name: 'Top board (glue-up)',
      species: spec.species,
      solids,
      cutouts: [],
      placement: { origin: [-R, y0, z0], x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0] },
      allowance: { ...TOP_BOARD_ALLOWANCE, reason: 'oversized for glue-up; cut round after' },
      notes: [],
    });
  }
  return {
    parts,
    underside: y0,
    assembly: {
      name: 'Round top',
      partIds: parts.map((p) => p.id),
      finishedSize: { thickness: tt, width: D, length: D },
      note: `Glue ${n} boards edge to edge, flatten, then cut a ${f(D)} circle (router on a trammel, or bandsaw and flush-trim to a template). Outer boards are shorter because the circle is narrower there.`,
    },
  };
}

/**
 * A live edge slab you already own. Width tapers from the widest end to the
 * narrow end with a natural wobble along both edges, and the bark edge is
 * undercut toward the bottom face the way most slabs are.
 */
export function liveEdgeSlab(spec: NormalizedSpec): Top {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: L, width: W, height: H } = spec.dimensions;
  const t = topThickness(o);
  const y0 = H - t;
  const Wn = o.narrowWidth;
  const seed = L * 7 + W * 3 + Wn;
  const amp = Math.min(1.5, 0.06 * W);
  const undercut = Math.min(0.75, 0.3 * t);
  const width = (x: number) => W + ((Wn - W) * x) / L;
  // Ramp the wobble in from zero so the widest end measures exactly W.
  const ramp = (x: number) => Math.min(1, (x / L) * 8);
  const left = (x: number) => (W - width(x)) / 2 + amp * ramp(x) * wobble(x / L, seed);
  const right = (x: number) => (W + width(x)) / 2 - amp * ramp(x) * wobble(x / L, seed + 1);
  const N = 48;
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
  const notes = [
    `Your slab: flatten from ${f(o.slabThickness)} to ${f(t)}, trim from ${f(o.slabLength)} to ${f(L)} long.`,
    `Width runs from ${f(W)} at the wide end to ${f(Wn)} at the narrow end.`,
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
  };
}
