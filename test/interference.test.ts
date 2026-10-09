import { describe, expect, it } from 'vitest';
import { aabbOf, aabbOverlap, toWorld, type AABB } from '../src/core/geom';
import type { ProjectSpec } from '../src/core/types';
import { plan } from '../src/output/plan';

/**
 * Physical sanity across every table style × size × joinery × species:
 * no two parts' solid bodies occupy the same space (tenons are checked
 * against their mortises in table.test.ts), nothing pokes outside the overall
 * dimensions, and every plan has finite, positive numbers.
 */
const styles: Record<string, unknown>[] = [
  { tableStyle: 'classic', legStyle: 'tapered' },
  { tableStyle: 'classic', legStyle: 'straight' },
  { tableStyle: 'live-edge', steelLegStyle: 'u' },
  { tableStyle: 'live-edge', steelLegStyle: 'trapezoid' },
  { tableStyle: 'live-edge', steelLegStyle: 'x' },
  { tableStyle: 'live-edge', steelLegStyle: 'hairpin' },
  { tableStyle: 'round', roundBase: 'pedestal', roundTop: 'boards' },
  { tableStyle: 'round', roundBase: 'pedestal', roundTop: 'slab' },
  { tableStyle: 'round', roundBase: 'four-legs', roundTop: 'boards' },
  { tableStyle: 'round', roundBase: 'four-legs', roundTop: 'slab' },
];
const sizes = [
  { length: 96, width: 42, height: 30 },
  { length: 48, width: 24, height: 18 },
  { length: 22, width: 22, height: 24 },
  { length: 36, width: 60, height: 30 },
  { length: 130, width: 44, height: 30 },
];
const joinery = ['mortise-tenon', 'dowel', 'pocket-screw'] as const;

const cases: [string, ProjectSpec][] = [];
for (const options of styles)
  for (const dimensions of sizes)
    for (const j of joinery)
      for (const species of ['red-oak', 'pine'])
        cases.push([
          `${Object.values(options).join('/')} ${dimensions.length}×${dimensions.width}×${dimensions.height} ${j} ${species}`,
          { projectType: 'table', units: 'in', dimensions, species, joinery: j, options },
        ]);

const shelves: Record<string, unknown>[] = [
  { shelfType: 'adjustable', caseMaterial: 'solid' },
  { shelfType: 'fixed', caseMaterial: 'plywood', topStyle: 'overhang' },
  { shelfType: 'adjustable', caseMaterial: 'plywood', backPanel: 'none', kickHeight: 0 },
];
const shelfSizes = [
  { length: 36, width: 12, height: 72 },
  { length: 30, width: 10, height: 30 },
  { length: 60, width: 16, height: 84 },
];
for (const options of shelves)
  for (const dimensions of shelfSizes)
    for (const j of ['dado', 'pocket-screw', 'dowel'] as const)
      cases.push([
        `bookshelf ${Object.values(options).join('/')} ${dimensions.length}×${dimensions.width}×${dimensions.height} ${j}`,
        { projectType: 'bookshelf', units: 'in', dimensions, species: 'white-oak', joinery: j, options },
      ]);

describe('every project combination is physically consistent', () => {
  it.each(cases)('%s', (_name, spec) => {
    const p = plan(spec);
    const D = p.model.spec.dimensions;
    const parts = p.model.parts.map((part) => ({
      part,
      bodies: part.solids.filter((s) => s.kind === 'body').map((s): AABB => aabbOf(s.hexa.map((v) => toWorld(part.placement, v)))),
    }));
    const e = 1e-6;
    for (const { part, bodies } of parts)
      for (const b of bodies) {
        expect(b.min[1], `${part.id} below floor`).toBeGreaterThanOrEqual(-e);
        expect(b.max[1], `${part.id} above top`).toBeLessThanOrEqual(D.height + e);
        expect(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), `${part.id} past the ends`).toBeLessThanOrEqual(D.length / 2 + e);
        expect(Math.max(Math.abs(b.min[2]), Math.abs(b.max[2])), `${part.id} past the sides`).toBeLessThanOrEqual(D.width / 2 + e);
      }
    for (let i = 0; i < parts.length; i++)
      for (let k = i + 1; k < parts.length; k++)
        for (const a of parts[i].bodies)
          for (const b of parts[k].bodies) expect(aabbOverlap(a, b, 1e-4), `${parts[i].part.id} overlaps ${parts[k].part.id}`).toBe(false);
    for (const r of p.cutList) expect(Math.min(r.size.length, r.size.width, r.size.thickness)).toBeGreaterThan(0);
    expect(Number.isFinite(p.totalCost) && Number.isFinite(p.weightLb)).toBe(true);
  });
});
