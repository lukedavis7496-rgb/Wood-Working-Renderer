import { describe, expect, it } from 'vitest';
import { aabbOf, toWorld, type AABB } from '../src/core/geom';
import { shelfSag } from '../src/core/sag';
import { SpecError } from '../src/core/spec';
import type { Model, Part, ProjectSpec } from '../src/core/types';
import { cutSize } from '../src/output/cutList';
import { plan } from '../src/output/plan';
import { buildModel } from '../src/projects/registry';

const base: ProjectSpec = {
  projectType: 'bookshelf',
  units: 'in',
  dimensions: { length: 36, width: 12, height: 72 },
  species: 'white-oak',
  joinery: 'dado',
  options: { shelfType: 'fixed', shelfCount: 4, caseMaterial: 'plywood' },
};
const part = (m: Model, id: string): Part => m.parts.find((p) => p.id === id)!;
const boxes = (p: Part, kind: 'tenon' | 'cutout' | 'body'): AABB[] =>
  (kind === 'cutout' ? p.cutouts.map((c) => c.hexa) : p.solids.filter((s) => s.kind === kind).map((s) => s.hexa)).map((h) =>
    aabbOf(h.map((v) => toWorld(p.placement, v))),
  );
const inside = (o: AABB, i: AABB, e = 1e-6) => [0, 1, 2].every((k) => i.min[k] >= o.min[k] - e && i.max[k] <= o.max[k] + e);

describe('bookshelf: dados change the shelf length', () => {
  it('a dadoed shelf is the opening plus both dado depths', () => {
    const m = buildModel(base);
    // 36 − 2 × 3/4 sides = 34-1/2 opening; 1/4″ dados (a third of 3/4″) each end
    expect(cutSize(part(m, 'shelf-fixed-1')).length).toBeCloseTo(34.5 + 0.5);
    expect(cutSize(part(m, 'bottom')).length).toBeCloseTo(35);
  });

  it('a pocket-screwed shelf is just the opening', () => {
    const m = buildModel({ ...base, joinery: 'pocket-screw' });
    expect(cutSize(part(m, 'shelf-fixed-1')).length).toBeCloseTo(34.5);
  });

  it('every shelf tongue sits inside a dado in a side', () => {
    const m = buildModel(base);
    const dados = m.parts.filter((p) => p.role === 'side').flatMap((p) => boxes(p, 'cutout'));
    const tongues = m.parts.flatMap((p) => boxes(p, 'tenon'));
    expect(tongues.length).toBe(2 * 6); // bottom, 4 shelves, top
    for (const t of tongues) expect(dados.some((d) => inside(d, t))).toBe(true);
  });

  it('shelves stop in front of the back panel', () => {
    const m = buildModel(base);
    expect(cutSize(part(m, 'shelf-fixed-1')).width).toBeCloseTo(12 - 0.25);
    const back = part(m, 'back');
    expect(cutSize(back)).toMatchObject({ thickness: 0.25 });
    expect(cutSize(back).width).toBeCloseTo(34.5 + 2 * 0.375);
    expect(cutSize(back).length).toBeCloseTo(72 - 3); // from the kick to the top
  });
});

describe('bookshelf: adjustable shelves', () => {
  const m = buildModel({ ...base, options: { shelfType: 'adjustable', shelfCount: 4, caseMaterial: 'plywood' } });
  it('are a little shorter and set back so they lift out', () => {
    const s = cutSize(part(m, 'shelf-1'));
    expect(s.length).toBeCloseTo(34.5 - 1 / 16);
    expect(s.width).toBeCloseTo(12 - 0.25 - 0.25);
  });
  it('keep one fixed shelf mid-height in a tall case', () => {
    expect(m.parts.filter((p) => p.id.startsWith('shelf-fixed'))).toHaveLength(1);
    expect(m.warnings.join(' ')).toMatch(/tie the tall sides together/);
  });
  it('get shelf-pin holes in both sides and 4 pins each', () => {
    const side = part(m, 'side-left');
    expect(side.cutouts.filter((c) => c.kind === 'dowel-hole').length).toBeGreaterThan(40);
    expect(m.hardware.find((h) => /shelf pins/.test(h.item))!.quantity).toBe(3 * 4);
  });
});

describe('bookshelf: sheet goods and solid glue-ups', () => {
  it('plans a plywood case on 4×8 sheets', () => {
    const p = plan(base);
    const sheets = p.lumber.groups.filter((g) => g.kind === 'sheet');
    expect(sheets.map((g) => g.stock.nominal).sort()).toEqual([0.25, 0.75]);
    expect(p.shoppingList.some((l) => /sheets? of 3\/4″ white oak plywood \(4′ × 8′\)/.test(l))).toBe(true);
    expect(p.model.hardware.some((h) => /edge banding/.test(h.item))).toBe(true);
  });

  it('glues solid sides up from boards no wider than the max', () => {
    const m = buildModel({ ...base, options: { ...base.options, caseMaterial: 'solid', maxBoardWidth: 6 } });
    const sides = m.parts.filter((p) => p.role === 'side');
    expect(sides).toHaveLength(4);
    for (const s of sides) expect(cutSize(s).width).toBeCloseTo(6 + 0.25);
    // each board carries its own share of the dados
    expect(sides.every((s) => s.cutouts.some((c) => c.kind === 'mortise'))).toBe(true);
  });
});

describe('shelf sag', () => {
  it('matches the beam formula', () => {
    // 36″ span, 11″ deep, 3/4″ red oak, 20 lb/ft: 5wL⁴/(384EI)
    const I = (11 * 0.75 ** 3) / 12;
    const expected = (5 * (20 / 12) * 36 ** 4) / (384 * 1_820_000 * I);
    expect(shelfSag({ species: 'red-oak', plywood: false, span: 36, depth: 11, thickness: 0.75, lbPerFt: 20 }).sag).toBeCloseTo(expected, 9);
  });

  it('warns about a long pine shelf under books, with the span that would work', () => {
    const m = buildModel({ ...base, species: 'pine', dimensions: { length: 48, width: 12, height: 72 } });
    const w = m.warnings.find((x) => /sag/.test(x))!;
    expect(w).toMatch(/Keep spans under/);
  });

  it('a stiffer, thicker shelf sags less', () => {
    const a = shelfSag({ species: 'pine', plywood: false, span: 36, depth: 11, thickness: 0.75, lbPerFt: 20 }).sag;
    const b = shelfSag({ species: 'pine', plywood: false, span: 36, depth: 11, thickness: 1, lbPerFt: 20 }).sag;
    expect(b).toBeLessThan(a / 2);
  });
});

describe('bookshelf: validation and options', () => {
  it('rejects more shelves than fit', () => {
    expect(() => buildModel({ ...base, options: { ...base.options, shelfCount: 20 } })).toThrow(SpecError);
  });

  it('rejects mortise and tenon for a bookshelf', () => {
    expect(() => buildModel({ ...base, joinery: 'mortise-tenon' })).toThrow(/isn't supported for a bookshelf/);
  });

  it('an overhanging top is the overall size, with the case set in under it', () => {
    const m = buildModel({ ...base, options: { ...base.options, topStyle: 'overhang', topOverhang: 1 } });
    const top = boxes(part(m, 'top'), 'body')[0];
    expect(top.max[1]).toBeCloseTo(72);
    expect(top.max[0] - top.min[0]).toBeCloseTo(36);
    expect(top.max[2] - top.min[2]).toBeCloseTo(12);
    const side = boxes(part(m, 'side-left'), 'body')[0];
    expect(side.max[1]).toBeCloseTo(72 - 0.75);
    expect(side.min[0]).toBeCloseTo(-18 + 1); // 1″ in from the end of the top
    expect(side.max[2]).toBeCloseTo(6 - 1); // 1″ back from the front of the top
    const sideBack = Math.min(...boxes(part(m, 'side-left'), 'body').map((b) => b.min[2]));
    expect(sideBack).toBeCloseTo(top.min[2]); // flush at the back
  });

  it('splits a back too big for one sheet at the middle fixed shelf', () => {
    const p = plan({ ...base, dimensions: { length: 60, width: 16, height: 84 }, options: { shelfType: 'adjustable', shelfCount: 5, caseMaterial: 'solid' } });
    const backs = p.model.parts.filter((x) => x.role === 'back');
    expect(backs.map((b) => b.id)).toEqual(['back-lower', 'back-upper']);
    const fixed = boxes(p.model.parts.find((x) => x.id.startsWith('shelf-fixed'))!, 'body')[0];
    const seam = boxes(backs[0], 'body')[0].max[1];
    expect(seam).toBeGreaterThan(fixed.min[1]);
    expect(seam).toBeLessThan(fixed.max[1]);
  });
});
