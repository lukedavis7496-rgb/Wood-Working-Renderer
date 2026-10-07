import { box, mapHexa, type Placement, type Vec3 } from '../core/geom';
import { getSpecies } from '../core/species';
import type { Cutout, HardwareItem, Joint, Model, NormalizedSpec, Part, ProjectType, Shape } from '../core/types';
import { floorToSixteenth, formatLength, roundToSixteenth } from '../core/units';

/**
 * Four-legged table: square legs at the corners, an apron frame joined into
 * the legs just under the top, and a top glued up from boards.
 *
 * World frame: x = table length, y = up (floor at 0), z = table width.
 */

/** Gap left at the bottom of a mortise / dowel hole for glue and debris. */
export const GLUE_GAP = 1 / 16;
/** Tenon/joint shoulders top and bottom of the apron. */
export const TENON_SHOULDER = 1 / 2;
export const DOWEL_DIAMETER = 3 / 8;
export const DOWEL_LENGTH = 2;
/** Oversize for each glue-up board: trimmed off after the panel cures. */
export const TOP_BOARD_ALLOWANCE = { length: 1, width: 1 / 4 };

export interface TableOptions {
  legStyle: 'straight' | 'tapered';
  legThickness: number;
  taperFootSize: number;
  taperStart: number;
  apronInset: number;
  apronWidth: number;
  apronThickness: number;
  topThickness: number;
  overhang: number;
  maxTopBoardWidth: number;
  tenonLength: number;
}

export interface TableJoinery {
  /** Distance an apron extends into the leg beyond its shoulder (tenon length; 0 for butt joints). */
  tenonLength: number;
  tenonThickness: number;
  /** Tenon/dowel band height on the apron end. */
  tenonWidth: number;
  mortiseDepth: number;
  /** Deepest a mortise/hole can go from the leg's inside face without meeting the adjacent one. */
  maxDepth: number;
  dowel?: { count: number; legDepth: number; apronDepth: number; heights: number[] };
  pocket?: { count: number; heights: number[] };
}

/**
 * Resolve the joint geometry. Two aprons meet at each leg, entering through
 * adjacent inside faces at the same height, so their mortises (or dowel
 * holes) converge on the leg's core. Each must stop short of the other's,
 * which caps tenon length:
 *
 *   maxDepth = T − inset − (apronThickness + tenonThickness) / 2
 *
 * (leg thickness T minus the distance from the outer face to the far cheek of
 * the neighbouring mortise).
 */
export function resolveTableJoinery(spec: NormalizedSpec): TableJoinery {
  const o = spec.options as unknown as TableOptions;
  const T = o.legThickness;
  const a = o.apronThickness;
  const s = o.apronInset;
  const aw = o.apronWidth;
  const shoulder = aw >= 2.5 ? TENON_SHOULDER : 1 / 4;
  const tenonWidth = aw - 2 * shoulder;
  const bandCount = aw >= 5 ? 3 : 2;
  const heights = Array.from({ length: bandCount }, (_, i) => 1 + (i * (aw - 2)) / (bandCount - 1));

  switch (spec.joinery) {
    case 'mortise-tenon': {
      const t = Math.max(1 / 4, roundToSixteenth(a / 3));
      const maxDepth = T - s - (a + t) / 2;
      const tenonLength = Math.min(o.tenonLength, floorToSixteenth(maxDepth - GLUE_GAP));
      return { tenonLength, tenonThickness: t, tenonWidth, mortiseDepth: tenonLength + GLUE_GAP, maxDepth };
    }
    case 'dowel': {
      const maxDepth = T - s - (a + DOWEL_DIAMETER) / 2;
      const legDepth = Math.min(1, floorToSixteenth(maxDepth));
      const apronDepth = DOWEL_LENGTH - legDepth + GLUE_GAP;
      return {
        tenonLength: 0,
        tenonThickness: DOWEL_DIAMETER,
        tenonWidth,
        mortiseDepth: legDepth,
        maxDepth,
        dowel: { count: bandCount, legDepth, apronDepth, heights },
      };
    }
    default:
      return {
        tenonLength: 0,
        tenonThickness: 0,
        tenonWidth,
        mortiseDepth: 0,
        maxDepth: T,
        pocket: { count: bandCount, heights },
      };
  }
}

const opts = (spec: NormalizedSpec) => spec.options as unknown as TableOptions;
/** Length formatter in the spec's own units. */
const fmt = (spec: NormalizedSpec) => (inches: number) => formatLength(inches, spec.units);

function validateTable(spec: NormalizedSpec): string[] {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: L, width: W, height: H } = spec.dimensions;
  const errs: string[] = [];
  const legLen = H - o.topThickness;
  const baseL = L - 2 * o.overhang;
  const baseW = W - 2 * o.overhang;
  if (o.overhang > Math.min(L, W) / 4) errs.push('Overhang is more than a quarter of the table — the base would be too small to be stable.');
  if (baseL - 2 * o.legThickness < 6 || baseW - 2 * o.legThickness < 6)
    errs.push(`Table is too small for these legs and overhang: aprons would be shorter than ${f(6)}.`);
  if (o.apronWidth + 4 > legLen) errs.push('Apron is too wide for the table height.');
  if (o.apronInset + o.apronThickness > o.legThickness)
    errs.push('Apron inset + apron thickness must not exceed leg thickness (the apron must land on the leg).');
  if (o.legStyle === 'tapered') {
    if (o.taperFootSize >= o.legThickness) errs.push('Taper foot size must be smaller than the leg thickness.');
    if (o.taperFootSize < 0.5) errs.push('Taper foot size below 1/2″ is too fragile.');
    if (legLen - o.apronWidth - o.taperStart < 4) errs.push(`Taper start leaves less than ${f(4)} of taper.`);
  }
  const j = resolveTableJoinery(spec);
  if (spec.joinery === 'mortise-tenon' && j.tenonLength < 1 / 2)
    errs.push(
      `Only ${f(Math.max(0, j.tenonLength))} of tenon fits before the two mortises in each leg collide. ` +
        'Use thicker legs, a smaller apron inset, or another joint.',
    );
  if (spec.joinery === 'dowel' && j.dowel && j.dowel.legDepth < 1 / 2)
    errs.push('Legs are too thin for dowels from two sides; use thicker legs or pocket screws.');
  return errs;
}

function buildTable(spec: NormalizedSpec): Model {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: L, width: W, height: H } = spec.dimensions;
  const species = getSpecies(spec.species);
  const T = o.legThickness;
  const a = o.apronThickness;
  const aw = o.apronWidth;
  const s = o.apronInset;
  const tt = o.topThickness;
  const legLen = H - tt;
  const hl = (L - 2 * o.overhang) / 2;
  const hw = (W - 2 * o.overhang) / 2;
  const apronBottom = legLen - aw;
  const j = resolveTableJoinery(spec);
  const Lt = j.tenonLength;
  const tenonShoulder = (aw - j.tenonWidth) / 2;
  const warnings: string[] = [];

  // Shoulder-to-shoulder: the visible apron between the legs' inside faces.
  const longShoulder = 2 * (hl - T);
  const shortShoulder = 2 * (hw - T);

  const parts: Part[] = [];
  const joints: Joint[] = [];

  // ---- Legs ---------------------------------------------------------------
  // Leg local frame: x = height from the floor, y and z measured inward from
  // the two outer faces, so y = T and z = T are the inside faces.
  const taperStartHeight = apronBottom - o.taperStart;
  const corners: { id: string; name: string; sx: 1 | -1; sz: 1 | -1 }[] = [
    { id: 'leg-fl', name: 'Leg (front left)', sx: -1, sz: 1 },
    { id: 'leg-fr', name: 'Leg (front right)', sx: 1, sz: 1 },
    { id: 'leg-bl', name: 'Leg (back left)', sx: -1, sz: -1 },
    { id: 'leg-br', name: 'Leg (back right)', sx: 1, sz: -1 },
  ];

  const mortiseZ0 = s + (a - j.tenonThickness) / 2;
  const mortiseZ1 = s + (a + j.tenonThickness) / 2;

  for (const c of corners) {
    const solids: Shape[] = [];
    const notes: string[] = [];
    if (o.legStyle === 'tapered') {
      const F = o.taperFootSize;
      solids.push({ kind: 'body', hexa: box(taperStartHeight, legLen, 0, T, 0, T) });
      solids.push({
        kind: 'body',
        hexa: mapHexa(box(0, taperStartHeight, 0, T, 0, T), (p, i) =>
          i & 1 ? p : ([p[0], i & 2 ? F : 0, i & 4 ? F : 0] as Vec3),
        ),
      });
      notes.push(
        `Taper the two inside faces to ${f(F)} square at the foot, starting ${f(taperStartHeight)} from the floor (${f(o.taperStart)} below the apron).`,
      );
    } else {
      solids.push({ kind: 'body', hexa: box(0, legLen, 0, T, 0, T) });
    }

    const cutouts: Cutout[] = [];
    if (spec.joinery === 'mortise-tenon') {
      const x0 = apronBottom + tenonShoulder;
      const x1 = legLen - tenonShoulder;
      cutouts.push({ kind: 'mortise', hexa: box(x0, x1, T - j.mortiseDepth, T, mortiseZ0, mortiseZ1) });
      cutouts.push({ kind: 'mortise', hexa: box(x0, x1, mortiseZ0, mortiseZ1, T - j.mortiseDepth, T) });
      notes.push(
        `Two mortises on the inside faces: ${f(j.tenonThickness)} wide × ${f(j.tenonWidth)} long × ${f(j.mortiseDepth)} deep, ` +
          `${f(mortiseZ0)} from the outer face, top ${f(tenonShoulder)} below the leg top. Cut before tapering.`,
      );
    } else if (j.dowel) {
      const r = DOWEL_DIAMETER / 2;
      const zc = s + a / 2;
      for (const h of j.dowel.heights) {
        const x = apronBottom + h;
        cutouts.push({ kind: 'dowel-hole', hexa: box(x - r, x + r, T - j.dowel.legDepth, T, zc - r, zc + r) });
        cutouts.push({ kind: 'dowel-hole', hexa: box(x - r, x + r, zc - r, zc + r, T - j.dowel.legDepth, T) });
      }
      notes.push(
        `${j.dowel.count} × ${f(DOWEL_DIAMETER)} dowel holes per inside face, ${f(j.dowel.legDepth)} deep, centred ${f(zc)} from the outer face.`,
      );
    }

    const placement: Placement = {
      origin: [c.sx * hl, 0, c.sz * hw],
      x: [0, 1, 0],
      y: [-c.sx, 0, 0],
      z: [0, 0, -c.sz],
    };
    parts.push({ id: c.id, role: 'leg', name: 'Leg', species: species.id, solids, cutouts, placement, notes });
  }

  // ---- Aprons -------------------------------------------------------------
  // Apron local frame: x = length from the left tenon tip, y = height from the
  // apron's bottom edge, z = thickness from the outer face.
  function apron(id: string, name: string, shoulderLen: number, placement: Placement, legs: [string, string]): Part {
    const solids: Shape[] = [{ kind: 'body', hexa: box(Lt, Lt + shoulderLen, 0, aw, 0, a) }];
    const cutouts: Cutout[] = [];
    const notes: string[] = [];
    if (spec.joinery === 'mortise-tenon') {
      const ty0 = tenonShoulder;
      const ty1 = aw - tenonShoulder;
      const tz0 = (a - j.tenonThickness) / 2;
      const tz1 = (a + j.tenonThickness) / 2;
      solids.push({ kind: 'tenon', hexa: box(0, Lt, ty0, ty1, tz0, tz1) });
      solids.push({ kind: 'tenon', hexa: box(Lt + shoulderLen, 2 * Lt + shoulderLen, ty0, ty1, tz0, tz1) });
      notes.push(
        `Tenon both ends: ${f(j.tenonThickness)} thick × ${f(j.tenonWidth)} wide × ${f(Lt)} long, centred on the thickness; ` +
          `shoulders ${f(shoulderLen)} apart.`,
      );
    } else if (j.dowel) {
      const r = DOWEL_DIAMETER / 2;
      for (const h of j.dowel.heights) {
        cutouts.push({ kind: 'dowel-hole', hexa: box(0, j.dowel.apronDepth, h - r, h + r, a / 2 - r, a / 2 + r) });
        cutouts.push({
          kind: 'dowel-hole',
          hexa: box(shoulderLen - j.dowel.apronDepth, shoulderLen, h - r, h + r, a / 2 - r, a / 2 + r),
        });
      }
      notes.push(`${j.dowel.count} × ${f(DOWEL_DIAMETER)} dowel holes in each end, ${f(j.dowel.apronDepth)} deep.`);
    } else if (j.pocket) {
      for (const h of j.pocket.heights) {
        cutouts.push({ kind: 'pocket-hole', hexa: box(0.25, 2.25, h - 0.2, h + 0.2, a - 0.35, a) });
        cutouts.push({ kind: 'pocket-hole', hexa: box(shoulderLen - 2.25, shoulderLen - 0.25, h - 0.2, h + 0.2, a - 0.35, a) });
      }
      notes.push(`${j.pocket.count} pocket holes at each end, on the inside face.`);
    }
    for (const leg of legs) {
      joints.push({
        kind: spec.joinery,
        parts: [id, leg],
        description:
          spec.joinery === 'mortise-tenon'
            ? `${f(Lt)} tenon into ${f(j.mortiseDepth)} mortise`
            : spec.joinery === 'dowel'
              ? `${j.dowel!.count} dowels`
              : `${j.pocket!.count} pocket screws`,
      });
    }
    return { id, role: 'apron', name, species: species.id, solids, cutouts, placement, notes };
  }

  const y0 = apronBottom;
  parts.push(
    apron('apron-front', 'Long apron', longShoulder, { origin: [-hl + T - Lt, y0, hw - s], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] }, ['leg-fl', 'leg-fr']),
    apron('apron-back', 'Long apron', longShoulder, { origin: [-hl + T - Lt, y0, -hw + s], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, ['leg-bl', 'leg-br']),
    apron('apron-left', 'Short apron', shortShoulder, { origin: [-hl + s, y0, -hw + T - Lt], x: [0, 0, 1], y: [0, 1, 0], z: [1, 0, 0] }, ['leg-bl', 'leg-fl']),
    apron('apron-right', 'Short apron', shortShoulder, { origin: [hl - s, y0, -hw + T - Lt], x: [0, 0, 1], y: [0, 1, 0], z: [-1, 0, 0] }, ['leg-br', 'leg-fr']),
  );

  // ---- Top ----------------------------------------------------------------
  const boardCount = Math.ceil(W / o.maxTopBoardWidth - 1e-9);
  const bw = W / boardCount;
  const topIds: string[] = [];
  for (let i = 0; i < boardCount; i++) {
    const id = `top-${i + 1}`;
    topIds.push(id);
    parts.push({
      id,
      role: 'top',
      name: boardCount > 1 ? 'Top board (glue-up)' : 'Top',
      species: species.id,
      solids: [{ kind: 'body', hexa: box(0, L, 0, bw, 0, tt) }],
      cutouts: [],
      placement: { origin: [-L / 2, legLen, -W / 2 + i * bw], x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0] },
      allowance: {
        ...TOP_BOARD_ALLOWANCE,
        reason: boardCount > 1 ? 'oversized for glue-up; trim after' : 'oversized; trim to final size',
      },
      notes: [],
    });
  }

  // ---- Hardware & fasteners ----------------------------------------------
  const fastenersPer = (len: number) => Math.max(1, Math.ceil(len / 16));
  const topFasteners = 2 * fastenersPer(longShoulder) + 2 * fastenersPer(shortShoulder);
  for (const id of ['apron-front', 'apron-back', 'apron-left', 'apron-right']) {
    joints.push({ kind: 'fastener', parts: [id, topIds[0]], description: 'figure-8 fasteners (top floats for seasonal movement)' });
  }
  const hardware: HardwareItem[] = [];
  if (j.dowel) {
    hardware.push({ item: `${f(DOWEL_DIAMETER)} × ${f(DOWEL_LENGTH)} fluted dowel pins`, quantity: 8 * j.dowel.count });
  }
  if (j.pocket) {
    const thread = species.soldAs === 'dimensional' ? 'coarse' : 'fine';
    hardware.push({ item: `1-1/4″ ${thread}-thread pocket screws`, quantity: 8 * j.pocket.count });
  }
  hardware.push(
    { item: 'Figure-8 tabletop fasteners', quantity: topFasteners, note: 'recessed into the apron top edges' },
    { item: '#8 × 5/8″ flat-head wood screws', quantity: topFasteners * 2, note: 'one into the apron, one into the top per fastener' },
    { item: 'Wood glue', quantity: 1 },
  );

  // ---- Checks -------------------------------------------------------------
  if (spec.joinery === 'mortise-tenon' && Lt < o.tenonLength - 1e-9) {
    warnings.push(
      `Tenons shortened from ${f(o.tenonLength)} to ${f(Lt)} so the two mortises in each leg don't collide ` +
        `(max depth ${f(j.maxDepth)} from the inside face).`,
    );
  }
  if (spec.joinery === 'mortise-tenon' && Lt < 3 / 4) {
    warnings.push(`Tenons under ${f(3 / 4)} are weak for a table — consider thicker legs or a smaller apron inset.`);
  }
  if (H >= 27 && apronBottom < 24) {
    warnings.push(`Only ${f(apronBottom)} of knee clearance under the aprons; ${f(24)} or more is comfortable for seating.`);
  }
  if (species.soldAs === 'dimensional' && ![0.75, 1.5, 3.5].some((size) => Math.abs(size - T) < 1 / 32)) {
    warnings.push(`${f(T)} legs don't match a surfaced softwood size; they'll be ripped/planed from thicker stock (${f(1.5)} or ${f(3.5)} legs avoid that).`);
  }

  return {
    spec,
    parts,
    joints,
    assemblies: [
      {
        name: 'Top panel',
        partIds: topIds,
        finishedSize: { thickness: tt, width: W, length: L },
        note:
          boardCount > 1
            ? `Glue ${boardCount} boards edge to edge (alternate growth-ring direction), then flatten and trim to ${f(W)} × ${f(L)}.`
            : `Trim to ${f(W)} × ${f(L)}.`,
      },
    ],
    hardware,
    assemblySteps: tableAssemblySteps(spec, j, { boardCount, topFasteners, taperStartHeight }),
    warnings,
  };
}

function tableAssemblySteps(
  spec: NormalizedSpec,
  j: TableJoinery,
  ctx: { boardCount: number; topFasteners: number; taperStartHeight: number },
): string[] {
  const o = opts(spec);
  const f = fmt(spec);
  const species = getSpecies(spec.species);
  const steps: string[] = [];
  steps.push(
    species.soldAs === 'rough'
      ? 'Mill the rough lumber: flatten one face, square an edge, plane to thickness, and let it rest a day before final dimensioning.'
      : 'Check the surfaced boards for straightness; joint any edges that will be glued.',
  );
  steps.push('Cut every part to the cut-list size. Leave the top boards oversized as listed.');
  if (ctx.boardCount > 1) {
    steps.push(`Glue up the ${ctx.boardCount} top boards edge to edge, alternating growth rings. Set aside to cure overnight.`);
  }
  if (spec.joinery === 'mortise-tenon') {
    steps.push(`Lay out and cut the mortises in the legs (${f(j.mortiseDepth)} deep) while all four faces are still square.`);
    steps.push(`Cut the tenons on the aprons (${f(j.tenonThickness)} × ${f(j.tenonWidth)} × ${f(j.tenonLength)}) and fit each one to its mortise — snug by hand pressure.`);
  } else if (spec.joinery === 'dowel' && j.dowel) {
    steps.push(`Drill the dowel holes with a doweling jig referenced from the outer faces: ${f(j.dowel.legDepth)} deep in the legs, ${f(j.dowel.apronDepth)} deep in the apron ends.`);
  } else if (j.pocket) {
    steps.push(`Drill ${j.pocket.count} pocket holes at each end of every apron, on the inside face.`);
  }
  if (o.legStyle === 'tapered') {
    steps.push(`Taper the two inside faces of each leg, from ${f(ctx.taperStartHeight)} above the floor down to ${f(o.taperFootSize)} at the foot.`);
  }
  steps.push(`Cut ${ctx.topFasteners} recesses for figure-8 fasteners into the aprons' top edges.`);
  steps.push('Sand all base parts to 180 grit before assembly; it is much harder once the base is glued.');
  steps.push('Dry-fit the whole base and check that it sits flat with no rocking.');
  if (spec.joinery === 'pocket-screw') {
    steps.push('Assemble the two ends: screw (and glue) each short apron between a pair of legs, outer face set back by the apron inset.');
    steps.push(`Join the two ends with the long aprons. Measure the diagonals — they should match within ${f(1 / 16)}.`);
  } else {
    steps.push('Glue up the two ends: two legs + one short apron each. Clamp, check for square, let cure.');
    steps.push(`Glue the long aprons between the two ends. Measure the diagonals — they should match within ${f(1 / 16)} — and adjust clamps until they do.`);
  }
  steps.push(`Flatten the cured top panel, trim to ${f(spec.dimensions.width)} × ${f(spec.dimensions.length)}, and ease the edges.`);
  steps.push(finishStep(spec));
  steps.push(
    `Centre the top upside-down on a blanket, set the base on it (${f(o.overhang)} overhang all round) and attach with the figure-8 fasteners. Don't glue the top: it must move across its width with the seasons.`,
  );
  return steps;
}

function finishStep(spec: NormalizedSpec): string {
  const species = getSpecies(spec.species);
  switch (spec.finish) {
    case 'stain':
      return (
        (species.blotchy ? `${species.name} blotches: apply a pre-stain conditioner first. ` : '') +
        'Sand to 180, stain base and top separately (including the underside of the top), then 2–3 coats of clear topcoat.'
      );
    case 'paint':
      return 'Fill any gaps, sand to 220, prime, then two coats of paint. Seal the underside of the top too.';
    case 'raw':
      return 'Sand to 180–220. Left raw, the wood will mark easily; at least a coat of wax is recommended.';
    default:
      return 'Sand to 180, flood on oil, wipe off after 15 minutes; 3 coats a day apart. Finish both sides of the top equally.';
  }
}

export const table: ProjectType = {
  id: 'table',
  label: 'Table',
  supportedJoinery: ['mortise-tenon', 'dowel', 'pocket-screw'],
  defaultDimensions: { length: 60, width: 36, height: 30 },
  validate: validateTable,
  build: buildTable,
  options: [
    {
      key: 'legStyle',
      label: 'Leg style',
      kind: 'select',
      default: 'tapered',
      choices: [
        { value: 'straight', label: 'Straight (square)' },
        { value: 'tapered', label: 'Tapered (inside faces)' },
      ],
    },
    { key: 'legThickness', label: 'Leg thickness', kind: 'length', default: (c) => (c.dimensions.height < 22 ? 1.5 : 1.75), min: 1, max: 4 },
    {
      key: 'taperFootSize',
      label: 'Taper: size at foot',
      kind: 'length',
      default: (c) => roundToSixteenth((c.options.legThickness as number) * 0.65),
      showIf: (o) => o.legStyle === 'tapered',
      help: 'Square size the leg tapers down to at the floor.',
    },
    {
      key: 'taperStart',
      label: 'Taper: start below apron',
      kind: 'length',
      default: 1,
      min: 0,
      showIf: (o) => o.legStyle === 'tapered',
    },
    {
      key: 'apronInset',
      label: 'Apron inset',
      kind: 'length',
      default: 0.25,
      min: 0,
      help: "How far the apron's face is set back from the leg's outer face.",
    },
    { key: 'apronWidth', label: 'Apron width (height)', kind: 'length', default: (c) => (c.dimensions.height >= 26 ? 4 : 3), min: 1.5 },
    { key: 'apronThickness', label: 'Apron thickness', kind: 'length', default: 0.75, min: 0.5, max: 1.5 },
    { key: 'topThickness', label: 'Top thickness', kind: 'length', default: (c) => (c.dimensions.length >= 48 ? 1 : 0.75), min: 0.5, max: 2.5 },
    { key: 'overhang', label: 'Top overhang', kind: 'length', default: 1, min: 0, help: 'Overhang of the top past the legs, all round.' },
    {
      key: 'maxTopBoardWidth',
      label: 'Max top board width',
      kind: 'length',
      default: 6,
      min: 2,
      help: 'Narrower boards in the glue-up = flatter, more stable top.',
    },
    {
      key: 'tenonLength',
      label: 'Preferred tenon length',
      kind: 'length',
      default: 1.25,
      min: 0.5,
      showIf: (_o, joinery) => joinery === 'mortise-tenon',
      help: "Shortened automatically if adjacent mortises would collide inside the leg.",
    },
  ],
};
