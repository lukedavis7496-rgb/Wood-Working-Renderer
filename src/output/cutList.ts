import { aabbOf, hexaVolume, type Vec3 } from '../core/geom';
import { getSpecies } from '../core/species';
import type { Model, Part } from '../core/types';

export interface CutSize {
  thickness: number;
  width: number;
  length: number;
}

/**
 * The size a part's blank is cut to, measured from its solids — body plus any
 * tenons — in the part's local frame, plus any glue-up allowance. This is the
 * "geometry, not arithmetic" rule: a tenoned apron is as long as its
 * tip-to-tip extent, never the table's outer dimension minus something.
 */
export function cutSize(part: Part): CutSize {
  const pts: Vec3[] = part.solids.flatMap((s) => [...s.hexa]);
  const bb = aabbOf(pts);
  return {
    length: bb.max[0] - bb.min[0] + (part.allowance?.length ?? 0),
    width: bb.max[1] - bb.min[1] + (part.allowance?.width ?? 0),
    thickness: bb.max[2] - bb.min[2],
  };
}

/** Finished (post-shaping, post-joinery) volume in cubic inches. */
export function finishedVolume(part: Part): number {
  const solid = part.solids.reduce((v, s) => v + hexaVolume(s.hexa), 0);
  // Mortises remove wood; tenons sit inside them, so overall the base is
  // roughly what you'd weigh. Dowel and pocket holes are negligible but cheap to subtract.
  const removed = part.cutouts.reduce((v, c) => v + hexaVolume(c.hexa), 0);
  return solid - removed;
}

export interface CutListRow {
  /** Plan-style key (A, B, C…) shared by the cut list, diagrams and 3D view. */
  letter: string;
  /** Part ids in this row (identical pieces are grouped). */
  ids: string[];
  name: string;
  role: string;
  quantity: number;
  species: string;
  size: CutSize;
  notes: string[];
  allowanceReason?: string;
  /** The maker already has this piece (e.g. their slab). */
  owned: boolean;
}

/** 0 → A, 25 → Z, 26 → AA. */
export function rowLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : rowLetter(Math.floor(i / 26) - 1) + rowLetter(i % 26);
}

/** partId → cut list letter. */
export function lettersByPart(rows: CutListRow[]): Record<string, string> {
  return Object.fromEntries(rows.flatMap((r) => r.ids.map((id) => [id, r.letter])));
}

const key = (p: Part, s: CutSize) =>
  [p.name, p.species, s.thickness.toFixed(4), s.width.toFixed(4), s.length.toFixed(4), p.notes.join('|')].join('/');

export function cutList(model: Model): CutListRow[] {
  const rows = new Map<string, CutListRow>();
  for (const part of model.parts) {
    if (part.material === 'steel') continue;
    const size = cutSize(part);
    const k = key(part, size);
    const row = rows.get(k);
    if (row) {
      row.ids.push(part.id);
      row.quantity++;
    } else {
      rows.set(k, {
        letter: rowLetter(rows.size),
        ids: [part.id],
        name: part.name,
        role: part.role,
        quantity: 1,
        species: part.species,
        size,
        notes: part.notes,
        allowanceReason: part.allowance?.reason,
        owned: part.sourcing === 'owned',
      });
    }
  }
  return [...rows.values()];
}

const STEEL_LB_PER_FT3 = 490;
/**
 * Steel legs are hollow tube: 2″ square 11-gauge tube weighs about 2.6 lb/ft
 * against 13.6 lb/ft for solid bar, so about a fifth of the section is metal.
 */
const TUBE_FILL = 0.19;

/** Identical glue-ups (two matching sides, several shelves) listed once with a count. */
export function groupedAssemblies(model: Model): { quantity: number; assembly: Model['assemblies'][number] }[] {
  const out: { quantity: number; assembly: Model['assemblies'][number]; key: string }[] = [];
  for (const a of model.assemblies) {
    const s = a.finishedSize;
    const key = [a.name, a.note, s.thickness.toFixed(4), s.width.toFixed(4), s.length.toFixed(4)].join('/');
    const hit = out.find((o) => o.key === key);
    if (hit) hit.quantity++;
    else out.push({ quantity: 1, assembly: a, key });
  }
  return out.map(({ quantity, assembly }) => ({ quantity, assembly }));
}

/** Finished weight in pounds, wood and steel. */
export function finishedWeight(model: Model): number {
  return model.parts.reduce((w, p) => {
    const density = p.material === 'steel' ? STEEL_LB_PER_FT3 * TUBE_FILL : getSpecies(p.species).densityLbPerFt3;
    return w + (finishedVolume(p) / 1728) * density;
  }, 0);
}
