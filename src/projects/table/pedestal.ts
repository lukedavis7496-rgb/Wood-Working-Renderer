import { box, type Placement } from '../../core/geom';
import type { Cutout, HardwareItem, Joint, NormalizedSpec, Part, Shape } from '../../core/types';
import { fmt, opts } from './common';

/**
 * Pedestal base for a round table: a column laminated from 8/4 stock,
 * standing on two half-lapped feet and carrying two half-lapped cleats that
 * the top screws to.
 */

/** Finished thickness of one lamination / foot / cleat (8/4 stock milled). */
export const PEDESTAL_STOCK = 1.75;
export const FOOT_HEIGHT = 3;
export const CLEAT_HEIGHT = 2.5;

export const defaultColumnSize = (diameter: number) => (diameter >= 40 ? 3 * PEDESTAL_STOCK : 2 * PEDESTAL_STOCK);
export const defaultFootSpan = (diameter: number) => Math.round(Math.min(34, Math.max(14, diameter * 0.7)));
export const cleatLength = (diameter: number) => Math.round(Math.max(10, Math.min(diameter - 6, diameter * 0.6)));

/**
 * Two members of length `len` crossing at the centre with a half-lap. The one
 * along x keeps its bottom half at the crossing, the one along z its top half,
 * so the solids interlock without overlapping.
 */
function crossLap(spec: NormalizedSpec, ids: [string, string], name: string, len: number, height: number, y0: number): Part[] {
  const t = PEDESTAL_STOCK;
  const c0 = len / 2 - t / 2;
  const c1 = len / 2 + t / 2;
  const f = fmt(spec);
  const member = (id: string, alongX: boolean): Part => {
    const keepBottom = alongX;
    const solids: Shape[] = [
      { kind: 'body', hexa: box(0, c0, 0, height, 0, t) },
      { kind: 'body', hexa: box(c1, len, 0, height, 0, t) },
      { kind: 'body', hexa: keepBottom ? box(c0, c1, 0, height / 2, 0, t) : box(c0, c1, height / 2, height, 0, t) },
    ];
    const cutouts: Cutout[] = [
      { kind: 'mortise', hexa: keepBottom ? box(c0, c1, height / 2, height, 0, t) : box(c0, c1, 0, height / 2, 0, t) },
    ];
    const placement: Placement = alongX
      ? { origin: [-len / 2, y0, -t / 2], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
      : { origin: [-t / 2, y0, -len / 2], x: [0, 0, 1], y: [0, 1, 0], z: [1, 0, 0] };
    return {
      id,
      role: name.toLowerCase(),
      name,
      species: spec.species,
      solids,
      cutouts,
      placement,
      notes: [`Half-lap at the centre: ${f(t)} wide × ${f(height / 2)} deep, cut from the ${keepBottom ? 'top' : 'bottom'} edge.`],
    };
  };
  return [member(ids[0], true), member(ids[1], false)];
}

export function buildPedestal(spec: NormalizedSpec, topUnderside: number, topId: string) {
  const o = opts(spec);
  const f = fmt(spec);
  const D = spec.dimensions.length;
  const C = Number(o.columnSize);
  const layers = Math.max(1, Math.round(C / PEDESTAL_STOCK));
  const colLen = topUnderside - FOOT_HEIGHT - CLEAT_HEIGHT;
  const parts: Part[] = [];

  parts.push(...crossLap(spec, ['foot-a', 'foot-b'], 'Foot', o.footSpan, FOOT_HEIGHT, 0));
  for (let i = 0; i < layers; i++) {
    parts.push({
      id: `column-${i + 1}`,
      role: 'column',
      name: 'Column lamination',
      species: spec.species,
      solids: [{ kind: 'body', hexa: box(0, colLen, 0, C, 0, PEDESTAL_STOCK) }],
      cutouts: [],
      placement: { origin: [-C / 2 + i * PEDESTAL_STOCK, FOOT_HEIGHT, -C / 2], x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0] },
      notes: [`Glue ${layers} laminations into a ${f(C)} square column; joint and plane it square after the glue cures.`],
    });
  }
  parts.push(...crossLap(spec, ['cleat-a', 'cleat-b'], 'Cleat', cleatLength(D), CLEAT_HEIGHT, topUnderside - CLEAT_HEIGHT));

  const joints: Joint[] = [
    { kind: 'fastener', parts: ['column-1', 'foot-a'], description: 'glue + lag screw up through the foot crossing' },
    { kind: 'fastener', parts: ['column-1', 'cleat-a'], description: 'glue + lag screw down through the cleat crossing' },
    { kind: 'fastener', parts: ['cleat-a', topId], description: 'screws in slotted holes (top floats)' },
  ];
  const hardware: HardwareItem[] = [
    { item: '3/8″ × 6″ lag screws with washers', quantity: 2, note: 'through the foot and cleat crossings into the column ends' },
    { item: '#10 × 1-1/2″ pan-head screws', quantity: 8, note: 'up through slotted holes in the cleats into the top' },
    { item: 'Felt or adjustable feet', quantity: 4, note: 'under the foot ends' },
    { item: 'Wood glue', quantity: 1 },
  ];
  return { parts, joints, hardware, colLen, layers };
}

export function pedestalSteps(spec: NormalizedSpec, layers: number, colLen: number): string[] {
  const o = opts(spec);
  const f = fmt(spec);
  return [
    `Glue the ${layers} column laminations face to face. Once cured, joint and plane the column to ${f(Number(o.columnSize))} square and crosscut it to ${f(colLen)}.`,
    `Cut the half-laps at the centre of each foot and each cleat (${f(PEDESTAL_STOCK)} wide, half the height deep). Fit them snug; the tops should sit flush.`,
    'Optionally taper or round over the foot ends, then sand all base parts to 180.',
    'Drill a 3/8″ clearance hole through each crossing and a pilot hole into the centre of each column end.',
    'Glue and lag-screw the column to the feet, then the cleats to the top of the column. Check the column is plumb both ways before the glue sets.',
    'Drill the cleat holes for the top screws; elongate the outer ones across the top\'s grain so the top can move.',
  ];
}
