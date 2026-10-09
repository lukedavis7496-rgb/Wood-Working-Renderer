import { describe, expect, it } from 'vitest';
import { aabbOf, aabbOverlap, hexaVolume, toWorld, type AABB } from '../src/core/geom';
import { SpecError } from '../src/core/spec';
import type { Model, Part, ProjectSpec } from '../src/core/types';
import { cutSize } from '../src/output/cutList';
import { buildModel } from '../src/projects/registry';

const dining: ProjectSpec = {
  projectType: 'table',
  units: 'in',
  dimensions: { length: 60, width: 36, height: 30 },
  species: 'red-oak',
  joinery: 'mortise-tenon',
  options: { legStyle: 'tapered' },
};

const part = (m: Model, id: string): Part => m.parts.find((p) => p.id === id)!;

function worldBoxes(p: Part, kind: 'tenon' | 'body' | 'cutout'): AABB[] {
  const hexas = kind === 'cutout' ? p.cutouts.map((c) => c.hexa) : p.solids.filter((s) => s.kind === kind).map((s) => s.hexa);
  return hexas.map((h) => aabbOf(h.map((v) => toWorld(p.placement, v))));
}

const contains = (outer: AABB, inner: AABB, eps = 1e-6) =>
  [0, 1, 2].every((k) => inner.min[k] >= outer.min[k] - eps && inner.max[k] <= outer.max[k] + eps);

describe('table: mortise & tenon dining table, 60 × 36 × 30', () => {
  const m = buildModel(dining);

  it('legs run from the floor to the underside of the top', () => {
    // 30″ height − 1″ top (default for tables ≥ 48″ long)
    expect(cutSize(part(m, 'leg-fl'))).toEqual({ thickness: 1.75, width: 1.75, length: 29 });
  });

  it('apron cut length is shoulder-to-shoulder plus both tenons, not the outer dimension', () => {
    // base = 60 − 2×1″ overhang = 58; shoulders = 58 − 2×1.75 legs = 54.5
    // tenon capped at T − inset − (a + t)/2 − glue gap = 1.75 − .25 − .5 − 1/16 = 15/16
    expect(cutSize(part(m, 'apron-front')).length).toBeCloseTo(54.5 + 2 * (15 / 16), 9);
    // base width = 36 − 2 = 34; shoulders = 34 − 3.5 = 30.5
    expect(cutSize(part(m, 'apron-left')).length).toBeCloseTo(30.5 + 2 * (15 / 16), 9);
    expect(m.warnings.some((w) => w.includes('Tenons shortened'))).toBe(true);
  });

  it('every tenon sits inside a mortise of the leg it joins', () => {
    const legs = m.parts.filter((p) => p.role === 'leg');
    const mortises = legs.flatMap((l) => worldBoxes(l, 'cutout'));
    const tenons = m.parts.filter((p) => p.role === 'apron').flatMap((a) => worldBoxes(a, 'tenon'));
    expect(tenons).toHaveLength(8);
    for (const t of tenons) expect(mortises.some((mo) => contains(mo, t))).toBe(true);
  });

  it('tenons from adjacent aprons never collide inside a leg', () => {
    const aprons = m.parts.filter((p) => p.role === 'apron');
    for (let i = 0; i < aprons.length; i++) {
      for (let k = i + 1; k < aprons.length; k++) {
        for (const a of worldBoxes(aprons[i], 'tenon')) {
          for (const b of worldBoxes(aprons[k], 'tenon')) expect(aabbOverlap(a, b)).toBe(false);
        }
      }
    }
  });

  it('apron bodies stop at the leg faces (no wood occupies the same space)', () => {
    const legs = m.parts.filter((p) => p.role === 'leg').flatMap((l) => worldBoxes(l, 'body'));
    const aprons = m.parts.filter((p) => p.role === 'apron').flatMap((a) => worldBoxes(a, 'body'));
    for (const a of aprons) for (const l of legs) expect(aabbOverlap(a, l)).toBe(false);
  });

  it('aprons are flush with the leg tops and inset from the outer faces', () => {
    const front = worldBoxes(part(m, 'apron-front'), 'body')[0];
    expect(front.max[1]).toBeCloseTo(29);
    expect(front.min[1]).toBeCloseTo(25);
    expect(front.max[2]).toBeCloseTo(17 - 0.25); // leg outer face at z = 34/2
  });

  it('top is glued up from boards no wider than the max, oversized for trimming', () => {
    const tops = m.parts.filter((p) => p.role === 'top');
    expect(tops).toHaveLength(6);
    expect(cutSize(tops[0])).toEqual({ thickness: 1, width: 6.25, length: 61 });
    const all = aabbOf(tops.flatMap((p) => p.solids[0].hexa.map((v) => toWorld(p.placement, v))));
    expect(all.min).toEqual([-30, 29, -18]);
    expect(all.max).toEqual([30, 30, 18]);
  });

  it('tapered legs keep their outer faces and lose volume', () => {
    const leg = part(m, 'leg-fl');
    const volume = leg.solids.reduce((v, s) => v + hexaVolume(s.hexa), 0);
    expect(volume).toBeLessThan(1.75 * 1.75 * 29);
    // Lower segment: frustum-like hexahedron from 1.75² to 1.125² over 24″
    const lower = leg.solids[1];
    expect(aabbOf(lower.hexa).max).toEqual([24, 1.75, 1.75]);
  });
});

describe('table: joinery changes cut lengths', () => {
  const lengthFor = (joinery: ProjectSpec['joinery']) =>
    cutSize(part(buildModel({ ...dining, joinery }), 'apron-front')).length;

  it('pocket screws and dowels are butt joints: apron = shoulder length', () => {
    expect(lengthFor('pocket-screw')).toBeCloseTo(54.5);
    expect(lengthFor('dowel')).toBeCloseTo(54.5);
  });

  it('a requested tenon shorter than the collision limit is used as-is', () => {
    const m = buildModel({ ...dining, options: { tenonLength: 0.75 } });
    expect(cutSize(part(m, 'apron-front')).length).toBeCloseTo(54.5 + 1.5);
  });

  it('thicker legs allow full-length tenons', () => {
    const m = buildModel({ ...dining, options: { legThickness: 2.5 } });
    // shoulders: 58 − 5 = 53; tenons 1.25 (max 2.5 − .25 − .5 − 1/16 = 1.6875)
    expect(cutSize(part(m, 'apron-front')).length).toBeCloseTo(53 + 2.5);
    expect(m.warnings.some((w) => w.includes('Tenons shortened'))).toBe(false);
  });

  it('dados are rejected for a table', () => {
    expect(() => buildModel({ ...dining, joinery: 'dado' })).toThrow(SpecError);
  });

  it('rejects legs too thin for two mortises', () => {
    expect(() => buildModel({ ...dining, options: { legThickness: 1.25, apronInset: 0.25 } })).toThrow(/collide/);
  });
});

describe('table: metric input', () => {
  it('converts mm to the same geometry as the inch spec', () => {
    const mm = buildModel({
      ...dining,
      units: 'mm',
      dimensions: { length: 60 * 25.4, width: 36 * 25.4, height: 30 * 25.4 },
      options: { legStyle: 'tapered', legThickness: 1.75 * 25.4 },
    });
    expect(cutSize(part(mm, 'apron-front')).length).toBeCloseTo(cutSize(part(buildModel(dining), 'apron-front')).length, 6);
  });
});
