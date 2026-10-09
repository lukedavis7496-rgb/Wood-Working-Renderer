import { describe, expect, it } from 'vitest';
import { aabbOf, aabbOverlap, toWorld, type AABB } from '../src/core/geom';
import { SpecError } from '../src/core/spec';
import type { Part, ProjectSpec } from '../src/core/types';
import { cutSize } from '../src/output/cutList';
import { plan } from '../src/output/plan';
import { buildModel } from '../src/projects/registry';

const worldBox = (p: Part): AABB => aabbOf(p.solids.flatMap((s) => s.hexa.map((v) => toWorld(p.placement, v))));
const solidBoxes = (p: Part): AABB[] => p.solids.map((s) => aabbOf(s.hexa.map((v) => toWorld(p.placement, v))));

const liveEdge: ProjectSpec = {
  projectType: 'table',
  units: 'in',
  dimensions: { length: 84, width: 40, height: 30 },
  species: 'walnut',
  joinery: 'mortise-tenon',
  options: { tableStyle: 'live-edge', narrowWidth: 34, slabLength: 90, slabThickness: 2.5 },
};

describe('live edge slab on steel legs', () => {
  const p = plan(liveEdge);
  const slab = p.model.parts.find((x) => x.id === 'slab')!;

  it('measures the slab as the finished length × widest width × flattened thickness', () => {
    const s = cutSize(slab);
    expect(s.length).toBeCloseTo(84);
    expect(s.width).toBeCloseTo(40);
    expect(s.thickness).toBeCloseTo(2.25);
  });

  it('sits on top at the table height', () => {
    const b = worldBox(slab);
    expect(b.max[1]).toBeCloseTo(30);
    expect(b.min[1]).toBeCloseTo(27.75);
  });

  it('narrows toward the far end', () => {
    // last segment of the slab is within the 34″ narrow width
    const last = solidBoxes(slab).at(-1)!;
    expect(last.max[2] - last.min[2]).toBeLessThanOrEqual(34 + 1e-6);
  });

  it("doesn't buy lumber for a slab you own", () => {
    expect(p.lumber.groups).toHaveLength(0);
    expect(p.shoppingList[0]).toMatch(/you have it/);
  });

  it('orders two steel legs as tall as the underside of the slab, priced', () => {
    const legs = p.model.parts.filter((x) => x.material === 'steel');
    expect(legs).toHaveLength(2);
    for (const l of legs) {
      const b = worldBox(l);
      expect(b.min[1]).toBeCloseTo(0);
      expect(b.max[1]).toBeCloseTo(27.75);
      expect(b.max[2] - b.min[2]).toBeCloseTo(30); // default width: 2″ in from each edge at the narrow leg, even inch
    }
    expect(p.hardwareCost).toBeGreaterThan(0);
    expect(p.cutList.every((r) => r.role !== 'steel-leg')).toBe(true);
  });

  it('puts four hairpins inside the slab outline', () => {
    const m = buildModel({ ...liveEdge, options: { ...liveEdge.options, steelLegStyle: 'hairpin' } });
    const pins = m.parts.filter((x) => x.material === 'steel');
    expect(pins).toHaveLength(4);
    for (const pin of pins) expect(Math.abs(worldBox(pin).max[2])).toBeLessThan(20);
  });

  it('rejects legs wider than the slab where they mount', () => {
    expect(() => buildModel({ ...liveEdge, options: { ...liveEdge.options, steelLegWidth: 36 } })).toThrow(/too wide/);
  });

  it('rejects a slab shorter than the table', () => {
    expect(() => buildModel({ ...liveEdge, options: { ...liveEdge.options, slabLength: 80 } })).toThrow(SpecError);
  });
});

const round: ProjectSpec = {
  projectType: 'table',
  units: 'in',
  dimensions: { length: 36, width: 20, height: 28 },
  species: 'white-oak',
  joinery: 'mortise-tenon',
  options: { tableStyle: 'round', roundBase: 'four-legs' },
};

describe('round table', () => {
  it('uses the length as the diameter', () => {
    const m = buildModel(round);
    expect(m.spec.dimensions.width).toBe(36);
  });

  it('cuts each strip only as long as its widest chord', () => {
    const m = buildModel(round);
    const strips = m.parts.filter((x) => x.role === 'top');
    expect(strips).toHaveLength(6);
    const lengths = strips.map((s) => cutSize(s).length - 1); // minus the 1″ allowance
    // outer strip spans z ∈ [-18, -12]: widest chord at z = -12 → 2√(18² − 12²)
    expect(lengths[0]).toBeCloseTo(2 * Math.sqrt(18 ** 2 - 12 ** 2), 6);
    // strips touching the centre line are a full diameter
    expect(lengths[2]).toBeCloseTo(36, 6);
    expect(lengths[0]).toBe(lengths[5]);
  });

  it('keeps every corner of the glued-up top inside the circle', () => {
    const m = buildModel(round);
    for (const s of m.parts.filter((x) => x.role === 'top'))
      for (const sol of s.solids)
        for (const v of sol.hexa) {
          const w = toWorld(s.placement, v);
          expect(Math.hypot(w[0], w[2])).toBeLessThanOrEqual(18 + 1e-6);
        }
  });

  it('places four-leg corners the overhang inside the edge', () => {
    const m = buildModel(round);
    const leg = worldBox(m.parts.find((x) => x.id === 'leg-fr')!);
    expect(Math.hypot(leg.max[0], leg.max[2])).toBeCloseTo(18 - 2, 6);
  });

  it('pedestal feet interlock with a half-lap instead of overlapping', () => {
    const m = buildModel({ ...round, options: { tableStyle: 'round', roundBase: 'pedestal' } });
    const a = m.parts.find((x) => x.id === 'foot-a')!;
    const b = m.parts.find((x) => x.id === 'foot-b')!;
    for (const sa of solidBoxes(a)) for (const sb of solidBoxes(b)) expect(aabbOverlap(sa, sb)).toBe(false);
    expect(cutSize(a).length).toBe(cutSize(b).length);
  });

  it('pedestal column reaches from the feet to the cleats under the top', () => {
    const m = buildModel({ ...round, options: { tableStyle: 'round', roundBase: 'pedestal' } });
    const col = worldBox(m.parts.find((x) => x.id === 'column-1')!);
    const cleat = worldBox(m.parts.find((x) => x.id === 'cleat-a')!);
    expect(col.min[1]).toBeCloseTo(3);
    expect(col.max[1]).toBeCloseTo(cleat.min[1]);
    expect(cleat.max[1]).toBeCloseTo(28 - 0.75); // 3/4″ top by default under 48″
  });

  it('round slab tops are owned, not bought', () => {
    const p = plan({ ...round, options: { tableStyle: 'round', roundTop: 'slab', roundBase: 'pedestal', slabThickness: 2 } });
    expect(p.lumber.groups.every((g) => !g.purposes.includes('Round slab'))).toBe(true);
    expect(cutSize(p.model.parts.find((x) => x.id === 'slab')!).thickness).toBeCloseTo(1.75);
  });
});

describe('measured live edge slab', () => {
  const measured: ProjectSpec = {
    ...liveEdge,
    dimensions: { length: 84, width: 30, height: 30 }, // width is replaced by the widest measurement
    options: { tableStyle: 'live-edge', widthProfile: '38-1/2, 40, 37, 35-1/2, 36, 33', slabLength: 90, slabThickness: 2.5 },
  };
  const p = plan(measured);
  const slab = p.model.parts.find((x) => x.id === 'slab')!;

  it('takes the overall width from the widest measurement', () => {
    expect(p.model.spec.dimensions.width).toBe(40);
    expect(cutSize(slab).width).toBeCloseTo(40, 6);
  });

  it('passes through every measured width at its station', () => {
    const widths = [38.5, 40, 37, 35.5, 36, 33];
    const step = 84 / (widths.length - 1);
    const pts = slab.solids.flatMap((s) => s.hexa.filter((v) => v[2] > 0).map((v) => toWorld(slab.placement, v)));
    widths.forEach((w, i) => {
      const at = pts.filter((v) => Math.abs(v[0] + 42 - i * step) < 1e-6);
      expect(at.length).toBeGreaterThan(0);
      const span = Math.max(...at.map((v) => v[2])) - Math.min(...at.map((v) => v[2]));
      expect(span).toBeCloseTo(w, 6);
    });
  });

  it('sizes the steel legs from the measured width where they mount', () => {
    // legs 10″ in from each end; narrowest there is near the 33″ end
    const legs = p.model.parts.filter((x) => x.material === 'steel');
    const w = worldBox(legs[1]).max[2] - worldBox(legs[1]).min[2];
    expect(w).toBeLessThanOrEqual(33 - 4 + 2);
    expect(w % 2).toBe(0);
  });

  it('rejects a measurement list it cannot read', () => {
    expect(() => buildModel({ ...measured, options: { ...measured.options, widthProfile: '40, wide' } })).toThrow(/separated by commas/);
  });
});

describe('wood movement', () => {
  it('estimates seasonal movement across the top from species and width', () => {
    const p = plan(liveEdge);
    // 40″ walnut, tangential 0.00274 per 1% MC, 4% swing
    expect(p.model.movement!.amount).toBeCloseTo(40 * 0.00274 * 4, 6);
  });

  it('sizes the leg screw slots for that movement', () => {
    const steps = plan(liveEdge).model.assemblySteps.join(' ');
    expect(steps).toMatch(/elongate the others across the grain to about 9\/16″ long/);
  });

  it('red oak moves more than cherry at the same width', () => {
    const at = (species: string) => plan({ ...liveEdge, species }).model.movement!.amount;
    expect(at('red-oak')).toBeGreaterThan(at('cherry'));
  });
});
