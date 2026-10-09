import { add, scale, type Hexa, type Placement } from '../../core/geom';
import type { Assembly, Cutout, Part, Shape } from '../../core/types';

/**
 * A wide solid-wood panel (a bookcase side, a shelf, a top) is glued up from
 * boards no wider than `maxBoardWidth`. This splits the panel across its
 * width (local y) into boards and hands each board only its share of the
 * geometry, so cut sizes, dados and rabbets stay exact per board.
 *
 * The callbacks describe the whole panel in panel coordinates, given the
 * width range [y0, y1] a board covers; the helper shifts each board's
 * geometry into its own frame. Plywood panels aren't split.
 */
export interface PanelSpec {
  id: string;
  name: string;
  role: string;
  species: string;
  plywood: boolean;
  width: number;
  maxBoardWidth: number;
  placement: Placement;
  solids: (y0: number, y1: number) => Shape[];
  cutouts?: (y0: number, y1: number) => Cutout[];
  notes?: string[];
}

/** Extra size per glue-up board, trimmed off after the panel cures. */
export const PANEL_BOARD_ALLOWANCE = { length: 1, width: 1 / 4 };

export interface Panel {
  parts: Part[];
  assembly?: Assembly;
}

export function gluedPanel(p: PanelSpec, finished: { thickness: number; length: number }): Panel {
  const n = p.plywood ? 1 : Math.ceil(p.width / p.maxBoardWidth - 1e-9);
  const bw = p.width / n;
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const y0 = i * bw;
    const y1 = y0 + bw;
    const shift = (h: Hexa): Hexa => h.map((v) => [v[0], v[1] - y0, v[2]]) as unknown as Hexa;
    parts.push({
      id: n > 1 ? `${p.id}-${i + 1}` : p.id,
      role: p.role,
      name: n > 1 ? `${p.name} board` : p.name,
      species: p.species,
      material: p.plywood ? 'plywood' : 'wood',
      solids: p.solids(y0, y1).map((s) => ({ ...s, hexa: shift(s.hexa) })),
      cutouts: (p.cutouts?.(y0, y1) ?? []).map((c) => ({ ...c, hexa: shift(c.hexa) })),
      placement: { ...p.placement, origin: add(p.placement.origin, scale(p.placement.y, y0)) },
      allowance: n > 1 ? { ...PANEL_BOARD_ALLOWANCE, reason: 'oversized for glue-up; trim after' } : undefined,
      panel: n > 1 ? { id: p.id, name: p.name } : undefined,
      notes: n > 1 ? [] : (p.notes ?? []),
    });
  }
  return {
    parts,
    assembly:
      n > 1
        ? {
            name: p.name,
            partIds: parts.map((x) => x.id),
            finishedSize: { thickness: finished.thickness, width: p.width, length: finished.length },
            note: `Glue ${n} boards edge to edge, then trim to size.${p.notes?.length ? ` ${p.notes.join(' ')}` : ''}`,
          }
        : undefined,
  };
}

/** Clip a box's y range to [y0, y1]; null if nothing is left. */
export function clipY(b: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }, y0: number, y1: number) {
  const a = Math.max(b.y0, y0);
  const c = Math.min(b.y1, y1);
  return c - a > 1e-9 ? { ...b, y0: a, y1: c } : null;
}
