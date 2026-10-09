import { describe, expect, it } from 'vitest';
import { aabbOf, aabbOverlap, toWorld } from '../src/core/geom';
import type { ProjectSpec } from '../src/core/types';
import { plan } from '../src/output/plan';
import { buildModel } from '../src/projects/registry';
import { KNEE_ROOM, recommendedSeating, seatingFor } from '../src/projects/table/seating';

const slab = (length: number, width: number, options: Record<string, unknown> = {}, height = 30): ProjectSpec => ({
  projectType: 'table',
  units: 'in',
  dimensions: { length, width, height },
  species: 'walnut',
  joinery: 'mortise-tenon',
  options: { tableStyle: 'live-edge', ...options },
});
const flat = (w: number) => () => w;

describe('seating around steel legs', () => {
  it('an end seat needs 12″ of knee room before a leg frame', () => {
    const l = { style: 'u' as const, length: 84, tube: 2, widthAt: flat(40) };
    expect(seatingFor(l, 12.9).perEnd).toBe(0); // 11.9″ clear
    expect(seatingFor(l, 13).perEnd).toBe(1); // 12″ clear
  });

  it('counts 26″ of edge per side diner between the legs', () => {
    const l = { style: 'u' as const, length: 84, tube: 2, widthAt: flat(40) };
    // legs 15″ in: 84 − 2 × 16 = 52″ between the frames → 2 per side
    expect(seatingFor(l, 15)).toMatchObject({ perSide: 2, perEnd: 1, total: 6 });
  });

  it('recommends the leg position that seats the most, with comfortable end knee room', () => {
    const best = recommendedSeating({ style: 'u', length: 84, tube: 2, widthAt: flat(40) });
    expect(best.total).toBe(6);
    expect(best.kneeRoom).toBeGreaterThanOrEqual(KNEE_ROOM);
  });

  it('prefers side seats when ends would only trade for them', () => {
    // 72″: two per side with legs near the ends, or one per side plus the ends — same 4.
    const best = recommendedSeating({ style: 'u', length: 72, tube: 2, widthAt: flat(38) });
    expect(best).toMatchObject({ perSide: 2, perEnd: 0 });
  });

  it('skips end seats on a slab too narrow at the ends', () => {
    const best = recommendedSeating({ style: 'u', length: 84, tube: 2, widthAt: flat(20) });
    expect(best.perEnd).toBe(0);
  });

  it('hairpins seat someone at each end between them', () => {
    expect(recommendedSeating({ style: 'hairpin', length: 96, tube: 2, widthAt: flat(42) })).toMatchObject({ perEnd: 1, perSide: 3 });
  });
});

describe('the table uses it', () => {
  it('defaults dining-height leg position to the recommendation', () => {
    const m = buildModel(slab(84, 40));
    expect(m.spec.options.steelLegInset).toBe(15);
    expect(m.seating!.total).toBe(6);
    expect(m.seating!.summary).toMatch(/1 at each end \(14″ of knee room/);
  });

  it('warns when your leg position seats fewer than it could', () => {
    const m = buildModel(slab(84, 40, { steelLegInset: 8 }));
    expect(m.warnings.join(' ')).toMatch(/Legs 8″ from the ends seat 4; 15″ from the ends would seat 6/);
  });

  it('leaves coffee tables alone', () => {
    const m = buildModel(slab(48, 24, {}, 18));
    expect(m.seating).toBeUndefined();
    expect(m.ghosts).toBeUndefined();
  });

  it('places the ghost chairs clear of the legs and under the edge', () => {
    const p = plan(slab(84, 40));
    const legs = p.model.parts.filter((x) => x.material === 'steel').flatMap((x) => x.solids.map((s) => aabbOf(s.hexa.map((v) => toWorld(x.placement, v)))));
    expect(p.model.ghosts).toHaveLength(6);
    for (const chair of p.model.ghosts!) for (const solid of chair.solids) for (const leg of legs) expect(aabbOverlap(aabbOf(solid), leg)).toBe(false);
  });
});
