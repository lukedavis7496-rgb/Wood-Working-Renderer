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
  /** Part ids in this row (identical pieces are grouped). */
  ids: string[];
  name: string;
  role: string;
  quantity: number;
  species: string;
  size: CutSize;
  notes: string[];
  allowanceReason?: string;
}

const key = (p: Part, s: CutSize) =>
  [p.name, p.species, s.thickness.toFixed(4), s.width.toFixed(4), s.length.toFixed(4), p.notes.join('|')].join('/');

export function cutList(model: Model): CutListRow[] {
  const rows = new Map<string, CutListRow>();
  for (const part of model.parts) {
    const size = cutSize(part);
    const k = key(part, size);
    const row = rows.get(k);
    if (row) {
      row.ids.push(part.id);
      row.quantity++;
    } else {
      rows.set(k, {
        ids: [part.id],
        name: part.name,
        role: part.role,
        quantity: 1,
        species: part.species,
        size,
        notes: part.notes,
        allowanceReason: part.allowance?.reason,
      });
    }
  }
  return [...rows.values()];
}

/** Finished weight in pounds. */
export function finishedWeight(model: Model): number {
  return model.parts.reduce((w, p) => w + (finishedVolume(p) / 1728) * getSpecies(p.species).densityLbPerFt3, 0);
}
