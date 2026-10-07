/**
 * Minimal solid geometry. Every component is built from hexahedra (8-corner
 * solids with planar-ish quad faces): a plain board is a box, a tapered leg
 * section is a hexahedron whose foot corners are pulled in, a tenon is a box.
 *
 * Corner index convention: i = xBit | yBit << 1 | zBit << 2, where a bit of 0
 * means the min side of that local axis and 1 the max side.
 */
export type Vec3 = readonly [number, number, number];
export type Hexa = readonly [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3];

/** Quad faces, wound counter-clockwise when viewed from outside. */
export const HEXA_FACES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 4, 6, 2], // -x
  [1, 3, 7, 5], // +x
  [0, 1, 5, 4], // -y
  [2, 6, 7, 3], // +y
  [0, 2, 3, 1], // -z
  [4, 5, 7, 6], // +z
];

export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Hexa {
  const c: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    c.push([i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0]);
  }
  return c as unknown as Hexa;
}

export function mapHexa(h: Hexa, f: (p: Vec3, index: number) => Vec3): Hexa {
  return h.map((p, i) => f(p, i)) as unknown as Hexa;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Volume via the divergence theorem over the triangulated faces. */
export function hexaVolume(h: Hexa): number {
  let v = 0;
  for (const [a, b, c, d] of HEXA_FACES) {
    v += dot(h[a], cross(h[b], h[c])) + dot(h[a], cross(h[c], h[d]));
  }
  return Math.abs(v) / 6;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function aabbOf(points: Iterable<Vec3>): AABB {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/** True when the boxes share volume (touching faces do not count). */
export function aabbOverlap(a: AABB, b: AABB, eps = 1e-6): boolean {
  for (let k = 0; k < 3; k++) {
    if (a.max[k] <= b.min[k] + eps || b.max[k] <= a.min[k] + eps) return false;
  }
  return true;
}

/**
 * Places a part's local frame in the world. Local x is always the grain /
 * length direction, local y the width, local z the thickness.
 */
export interface Placement {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

export function toWorld(pl: Placement, p: Vec3): Vec3 {
  return add(pl.origin, add(scale(pl.x, p[0]), add(scale(pl.y, p[1]), scale(pl.z, p[2]))));
}

/** -1 when the placement mirrors (left-handed), which flips face winding. */
export function handedness(pl: Placement): 1 | -1 {
  return dot(cross(pl.x, pl.y), pl.z) < 0 ? -1 : 1;
}
