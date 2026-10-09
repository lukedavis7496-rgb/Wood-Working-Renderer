import { describe, expect, it } from 'vitest';
import { aabbOf, hexaVolume, toWorld } from '../src/core/geom';
import { SpecError } from '../src/core/spec';
import type { ProjectSpec } from '../src/core/types';
import { cutSize } from '../src/output/cutList';
import { plan } from '../src/output/plan';
import { buildModel } from '../src/projects/registry';
import { keyPositions, keySize } from '../src/projects/table/butterflies';

const slab = (options: Record<string, unknown>, species = 'walnut'): ProjectSpec => ({
  projectType: 'table',
  units: 'in',
  dimensions: { length: 84, width: 40, height: 30 },
  species,
  joinery: 'mortise-tenon',
  options: { tableStyle: 'live-edge', slabThickness: 2.5, ...options },
});

describe('butterfly key shape', () => {
  it('tapers 12° from the ends to the waist', () => {
    const k = keySize(4, 0.5);
    expect(k.width).toBe(1.5);
    expect(k.waist).toBe(0.625);
    const angle = (Math.atan((k.width - k.waist) / 2 / (k.length / 2)) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(11);
    expect(angle).toBeLessThan(13);
    expect(k.depth).toBe(0.5 - 1 / 16);
  });

  it('spreads keys from alternate ends unless you give positions', () => {
    expect(keyPositions(4, [], 84)).toEqual([6, 78, 14, 70]);
    expect(keyPositions(1, [5, 12, 78], 84)).toEqual([5, 12, 78]);
  });
});

describe('butterfly keys in a slab', () => {
  const p = plan(slab({ butterflyPositions: '5, 12, 78' }));
  const keys = p.model.parts.filter((x) => x.role === 'butterfly');
  const slabPart = p.model.parts.find((x) => x.id === 'slab')!;

  it('makes one key per position, cut 1/16″ proud of its mortise', () => {
    expect(keys).toHaveLength(3);
    expect(cutSize(keys[0])).toEqual({ thickness: 0.5, width: 1.5, length: 4 });
    const row = p.cutList.find((r) => r.role === 'butterfly')!;
    expect(row.quantity).toBe(3);
    expect(row.scrap).toBe(true);
  });

  it('sits flush with the top, across the slab, at the given distance from the first end', () => {
    const b = aabbOf(keys[0].solids.flatMap((s) => s.hexa.map((v) => toWorld(keys[0].placement, v))));
    expect(b.max[1]).toBeCloseTo(30);
    expect(b.max[2] - b.min[2]).toBeCloseTo(4); // long axis across the slab
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(-42 + 5);
  });

  it('cuts a matching bowtie mortise in the slab for each key', () => {
    const mortises = slabPart.cutouts.filter((c) => c.kind === 'mortise');
    expect(mortises).toHaveLength(6); // two halves per key
    const keyVol = keys.reduce((v, k) => v + k.solids.reduce((a, s) => a + hexaVolume(s.hexa), 0), 0);
    expect(mortises.reduce((v, c) => v + hexaVolume(c.hexa), 0)).toBeCloseTo(keyVol, 6);
  });

  it('comes from an offcut, not the lumber list, in a contrasting wood', () => {
    expect(p.lumber.groups).toHaveLength(0);
    expect(keys[0].species).toBe('hard-maple');
    expect(p.shoppingList.join(' ')).toMatch(/3 butterfly keys: an offcut of hard maple at least 1\/2″ thick, 1-3\/4″ wide and 13-1\/2″ long/);
    expect(p.model.assemblySteps.join(' ')).toMatch(/rout the mortise 7\/16″ deep/);
    expect(buildModel(slab({ butterflyCount: 1 }, 'red-oak')).parts.find((x) => x.role === 'butterfly')!.species).toBe('walnut');
  });

  it('rejects keys that won’t fit', () => {
    expect(() => buildModel(slab({ butterflyPositions: '10, 11' }))).toThrow(/between their centres/);
    expect(() => buildModel(slab({ butterflyCount: 1, butterflyLength: 10, widthProfile: '12, 12, 12' }))).toThrow(SpecError);
    expect(() => buildModel(slab({ butterflyCount: 1, butterflyThickness: 1, slabThickness: 1.5 }))).toThrow(/half the slab/);
    expect(() => buildModel(slab({ butterflyPositions: '0.5' }))).toThrow(/hangs off the end/);
  });
});
