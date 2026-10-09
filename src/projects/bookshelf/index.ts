import { box } from '../../core/geom';
import { SHELF_LOADS, shelfSag, type ShelfLoad } from '../../core/sag';
import { getSpecies } from '../../core/species';
import type { Assembly, Cutout, HardwareItem, Joint, Model, NormalizedSpec, Part, ProjectType, Shape } from '../../core/types';
import { floorToSixteenth, formatLength, formatSmall } from '../../core/units';
import { SHEET } from '../../output/stock';
import { clipY, gluedPanel } from '../shared/panel';

/**
 * Bookshelf: two sides, a bottom raised on a kick rail, a top (flush between
 * the sides or overhanging them), shelves (fixed in dados or adjustable on
 * pins) and an optional plywood back in rabbets.
 *
 * World frame: x = width (left–right), y = up, z = depth (front at +z).
 * `dimensions.length` is the overall width and `dimensions.width` the depth.
 */

export const BACK_THICKNESS = 1 / 4;
/** How far the back's rabbet cuts into each side's thickness. */
export const BACK_RABBET_DEPTH = 3 / 8;
export const PIN_SPACING = 1.25;
export const PIN_DIAMETER = 1 / 4;
export const PIN_HOLE_DEPTH = 3 / 8;
/** Adjustable shelves sit back from the front edge and have a little end play. */
export const ADJUSTABLE_SETBACK = 1 / 4;
export const ADJUSTABLE_CLEARANCE = 1 / 16;

interface ShelfOptions {
  caseMaterial: 'solid' | 'plywood';
  caseThickness: number;
  shelfType: 'adjustable' | 'fixed';
  shelfCount: number;
  shelfThickness: number;
  shelfLoad: ShelfLoad;
  topStyle: 'flush' | 'overhang';
  topOverhang: number;
  kickHeight: number;
  backPanel: 'plywood' | 'none';
  maxBoardWidth: number;
}

const opts = (spec: NormalizedSpec) => spec.options as unknown as ShelfOptions;

/** Everything about where things go, shared by validation and building. */
function layout(spec: NormalizedSpec) {
  const o = opts(spec);
  // The overall size is the outside of the finished piece. An overhanging
  // top sets the case in by the overhang at the ends and the front.
  const { length: Wo, width: Do, height: H } = spec.dimensions;
  const oh = o.topStyle === 'overhang' ? o.topOverhang : 0;
  const W = Wo - 2 * oh;
  const D = Do - oh;
  const t = o.caseThickness;
  const st = o.shelfThickness;
  const dado = spec.joinery === 'dado' ? floorToSixteenth(t / 3) : 0;
  const back = o.backPanel === 'plywood' ? BACK_THICKNESS : 0;
  const Wi = W - 2 * t;
  const kick = o.kickHeight;
  const sideHeight = o.topStyle === 'overhang' ? H - t : H;
  const interiorBottom = kick + t;
  const interiorTop = H - t;
  const n = Math.max(0, Math.round(o.shelfCount));
  const opening = (interiorTop - interiorBottom - n * st) / (n + 1);
  const shelfY = Array.from({ length: n }, (_, i) => interiorBottom + (i + 1) * opening + i * st);
  // A tall, wide case with only adjustable shelves gets one fixed shelf near
  // the middle to tie the sides together and stop them bowing.
  const interior = interiorTop - interiorBottom;
  const middleFixed = o.shelfType === 'adjustable' && n > 0 && interior > 48 && Wi > 24 ? Math.floor((n - 1) / 2) : -1;
  const fixed = shelfY.map((_, i) => o.shelfType === 'fixed' || i === middleFixed);
  return { o, W, D, H, Wo, Do, oh, t, st, dado, back, Wi, kick, sideHeight, interiorBottom, interiorTop, opening, shelfY, fixed, depthFixed: D - back };
}

function validateBookshelf(spec: NormalizedSpec): string[] {
  const L = layout(spec);
  const f = (x: number) => formatLength(x, spec.units);
  const errs: string[] = [];
  if (L.Wi < 6) errs.push(`The case is too narrow: under ${f(6)} between the sides.`);
  if (L.D < 4) errs.push(`The case needs to be at least ${f(4)} deep.`);
  if (L.interiorTop - L.interiorBottom < 6) errs.push('The case is too short for its top, bottom and kick.');
  else if (L.opening < 4) errs.push(`With ${L.shelfY.length} shelves the openings would be only ${f(Math.max(0, L.opening))} tall; use fewer shelves.`);
  if (L.o.caseMaterial === 'plywood') {
    // Every case part has to come out of one 4×8 sheet, grain running the long way.
    const tooBig = (what: string, a: number, b: number, fix: string) => {
      if (a > SHEET.usableWidth || b > SHEET.usableLength) errs.push(`${what} (${f(a)} × ${f(b)}) won't fit on a 4′ × 8′ plywood sheet; ${fix}.`);
    };
    tooBig('The sides', L.D, L.sideHeight, 'make the case shorter or use solid wood');
    tooBig('The shelves', L.depthFixed, L.Wi + 2 * L.dado, 'make the case narrower or use solid wood');
    if (L.o.topStyle === 'overhang') tooBig('The top', L.Do, L.Wo, 'reduce the size or the overhang');
  }
  return errs;
}

function buildBookshelf(spec: NormalizedSpec): Model {
  const L = layout(spec);
  const { o, W, D, H, t, st, dado, back, Wi, kick } = L;
  const f = (x: number) => formatLength(x, spec.units);
  const small = (x: number) => formatSmall(x, spec.units);
  const species = getSpecies(spec.species);
  const plywood = o.caseMaterial === 'plywood';
  const parts: Part[] = [];
  const assemblies: Assembly[] = [];
  const joints: Joint[] = [];
  const hardware: HardwareItem[] = [];
  const warnings: string[] = [];
  const addPanel = (p: ReturnType<typeof gluedPanel>) => {
    parts.push(...p.parts);
    if (p.assembly) assemblies.push(p.assembly);
  };

  // Horizontal parts captured in the sides: bottom, fixed shelves, flush top.
  const captured: { y: number; thickness: number; name: string }[] = [
    { y: kick, thickness: t, name: 'bottom' },
    ...L.shelfY.flatMap((y, i) => (L.fixed[i] ? [{ y, thickness: st, name: 'fixed shelf' }] : [])),
    ...(o.topStyle === 'flush' ? [{ y: H - t, thickness: t, name: 'top' }] : []),
  ];
  const adjustable = L.shelfY.filter((_, i) => !L.fixed[i]);

  // ---- Sides --------------------------------------------------------------
  // Side local frame: x = height from the floor, y = depth from the front
  // edge, z = thickness from the outer face (z = t is the inside face).
  const pinRows: number[] = [];
  if (adjustable.length) {
    for (let y = L.interiorBottom + 3; y <= L.interiorTop - 3 + 1e-9; y += PIN_SPACING) pinRows.push(y);
  }
  const pinCols = [2, L.depthFixed - 2];
  for (const side of [-1, 1] as const) {
    const sideSolids = (y0: number, y1: number): Shape[] => {
      const boxes = [
        clipY({ x0: 0, x1: L.sideHeight, y0: 0, y1: D - back, z0: 0, z1: t }, y0, y1),
        back ? clipY({ x0: 0, x1: L.sideHeight, y0: D - back, y1: D, z0: 0, z1: t - BACK_RABBET_DEPTH }, y0, y1) : null,
      ];
      return boxes.filter((b) => b !== null).map((b) => ({ kind: 'body' as const, hexa: box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1) }));
    };
    const sideCutouts = (y0: number, y1: number): Cutout[] => {
      const out: Cutout[] = [];
      if (dado) {
        for (const c of captured) {
          const b = clipY({ x0: c.y, x1: c.y + c.thickness, y0: 0, y1: D - back, z0: t - dado, z1: t }, y0, y1);
          if (b) out.push({ kind: 'mortise', hexa: box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1) });
        }
      }
      const r = PIN_DIAMETER / 2;
      for (const x of pinRows)
        for (const yc of pinCols)
          if (yc - r >= y0 - 1e-9 && yc + r <= y1 + 1e-9) out.push({ kind: 'dowel-hole', hexa: box(x - r, x + r, yc - r, yc + r, t - PIN_HOLE_DEPTH, t) });
      return out;
    };
    const notes = [
      ...(dado ? [`Dados ${f(dado)} deep on the inside face, bottoms at ${captured.map((c) => f(c.y)).join(', ')} from the floor.`] : []),
      ...(back ? [`Rabbet the back inside edge ${f(back)} wide × ${f(BACK_RABBET_DEPTH)} deep for the back.`] : []),
      ...(pinRows.length ? [`Shelf-pin holes: ${f(PIN_DIAMETER)} × ${f(PIN_HOLE_DEPTH)} deep, every ${f(PIN_SPACING)} from ${f(pinRows[0])} to ${f(pinRows.at(-1)!)}, ${f(pinCols[0])} from the front and back.`] : []),
    ];
    addPanel(
      gluedPanel(
        {
          id: side < 0 ? 'side-left' : 'side-right',
          name: 'Side',
          role: 'side',
          species: species.id,
          plywood,
          width: D,
          maxBoardWidth: o.maxBoardWidth,
          placement: { origin: [(side * W) / 2, 0, D / 2], x: [0, 1, 0], y: [0, 0, -1], z: [-side, 0, 0] },
          solids: sideSolids,
          cutouts: sideCutouts,
          notes,
        },
        { thickness: t, length: L.sideHeight },
      ),
    );
  }

  // ---- Captured horizontals: bottom, fixed shelves, flush top --------------
  // Local frame: x = width from the left tongue tip, y = depth from the
  // front, z = thickness (up). Tongues are the ends inside the dados.
  const sag = (depth: number) =>
    shelfSag({ species: species.id, plywood, span: Wi, depth, thickness: st, lbPerFt: SHELF_LOADS[o.shelfLoad].lbPerFt });
  const sagNote = (depth: number) => {
    const s = sag(depth);
    return `Sags about ${small(s.sag)} under ${SHELF_LOADS[o.shelfLoad].label.toLowerCase()} (${small(s.limit)} is the most that looks right over ${f(Wi)}).`;
  };
  captured.forEach((c, i) => {
    const isShelf = c.name === 'fixed shelf';
    const name = c.name === 'bottom' ? 'Bottom' : c.name === 'top' ? 'Top' : 'Fixed shelf';
    const id = c.name === 'bottom' ? 'bottom' : c.name === 'top' ? 'top' : `shelf-fixed-${i}`;
    const len = Wi + 2 * dado;
    addPanel(
      gluedPanel(
        {
          id,
          name,
          role: isShelf ? 'shelf' : c.name,
          species: species.id,
          plywood,
          width: L.depthFixed,
          maxBoardWidth: o.maxBoardWidth,
          placement: { origin: [-Wi / 2 - dado, c.y, D / 2], x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
          solids: (y0, y1) => [
            { kind: 'body', hexa: box(dado, dado + Wi, y0, y1, 0, c.thickness) },
            ...(dado
              ? [
                  { kind: 'tenon' as const, hexa: box(0, dado, y0, y1, 0, c.thickness) },
                  { kind: 'tenon' as const, hexa: box(dado + Wi, len, y0, y1, 0, c.thickness) },
                ]
              : []),
          ],
          notes: [
            ...(dado ? [`Into ${f(dado)} dados at both ends; ${f(Wi)} between the sides.`] : []),
            ...(isShelf ? [sagNote(L.depthFixed)] : []),
          ],
        },
        { thickness: c.thickness, length: len },
      ),
    );
    for (const s of ['side-left', 'side-right'])
      joints.push({ kind: spec.joinery, parts: [id, s], description: dado ? `${f(dado)} dado` : spec.joinery === 'dowel' ? 'dowels' : 'pocket screws' });
  });

  // ---- Adjustable shelves ---------------------------------------------------
  const adjDepth = L.depthFixed - ADJUSTABLE_SETBACK;
  const adjLen = Wi - ADJUSTABLE_CLEARANCE;
  adjustable.forEach((y, i) =>
    addPanel(
      gluedPanel(
        {
          id: `shelf-${i + 1}`,
          name: 'Adjustable shelf',
          role: 'shelf',
          species: species.id,
          plywood,
          width: adjDepth,
          maxBoardWidth: o.maxBoardWidth,
          placement: { origin: [-adjLen / 2, y, D / 2 - ADJUSTABLE_SETBACK], x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
          solids: (y0, y1) => [{ kind: 'body', hexa: box(0, adjLen, y0, y1, 0, st) }],
          notes: [`${f(ADJUSTABLE_CLEARANCE)} shorter than the opening so it lifts out; rests on 4 pins.`, sagNote(adjDepth)],
        },
        { thickness: st, length: adjLen },
      ),
    ),
  );

  // ---- Overhanging top -----------------------------------------------------
  if (o.topStyle === 'overhang') {
    const { oh, Wo, Do } = L;
    const len = Wo;
    addPanel(
      gluedPanel(
        {
          id: 'top',
          name: 'Top',
          role: 'top',
          species: species.id,
          plywood,
          width: Do,
          maxBoardWidth: o.maxBoardWidth,
          // Built around the case's centre, like everything else; the whole
          // piece is shifted back by oh/2 below so the back edges line up.
          placement: { origin: [-Wo / 2, H - t, D / 2 + oh], x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
          solids: (y0, y1) => [{ kind: 'body', hexa: box(0, len, y0, y1, 0, t) }],
          notes: [`Overhangs ${f(oh)} at the front and ends; flush at the back.`],
        },
        { thickness: t, length: len },
      ),
    );
    const per = Math.max(2, Math.floor(D / 5));
    hardware.push({ item: '3/8″ × 1-1/2″ dowel pins', quantity: 2 * per, note: 'top into the tops of the sides, with glue' });
  }

  // ---- Kick rail -----------------------------------------------------------
  if (kick > 0) {
    parts.push({
      id: 'kick',
      role: 'kick',
      name: 'Kick rail',
      species: species.id,
      material: plywood ? 'plywood' : 'wood',
      solids: [{ kind: 'body', hexa: box(0, Wi, 0, kick, 0, t) }],
      cutouts: [],
      placement: { origin: [-Wi / 2, 0, D / 2 - t], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
      notes: ['Flush with the front edges, under the bottom.'],
    });
    hardware.push({ item: '1-1/4″ pocket screws', quantity: 4, note: 'kick rail into the sides, from behind' });
  }

  // ---- Back ----------------------------------------------------------------
  if (back) {
    const backTop = o.topStyle === 'flush' ? H : H - t;
    const bw = Wi + 2 * BACK_RABBET_DEPTH;
    const bh = backTop - kick;
    // A back bigger than a 4×8 sheet both ways is made in two pieces that
    // meet on the back edge of the fixed shelf nearest the middle.
    const fitsSheet = (a: number, b: number) => (a <= SHEET.usableWidth && b <= SHEET.usableLength) || (b <= SHEET.usableWidth && a <= SHEET.usableLength);
    const seamAt = captured.filter((c) => c.name === 'fixed shelf').sort((a, b) => Math.abs(a.y - (kick + bh / 2)) - Math.abs(b.y - (kick + bh / 2)))[0];
    const pieces =
      !fitsSheet(bw, bh) && seamAt
        ? [
            { id: 'back-lower', name: 'Back (lower)', y0: kick, y1: seamAt.y + seamAt.thickness / 2 },
            { id: 'back-upper', name: 'Back (upper)', y0: seamAt.y + seamAt.thickness / 2, y1: backTop },
          ]
        : [{ id: 'back', name: 'Back', y0: kick, y1: backTop }];
    for (const pc of pieces) {
      parts.push({
        id: pc.id,
        role: 'back',
        name: pc.name,
        species: species.id,
        material: 'plywood',
        rotatable: true,
        solids: [{ kind: 'body', hexa: box(0, pc.y1 - pc.y0, 0, bw, 0, back) }],
        cutouts: [],
        placement: { origin: [-bw / 2, pc.y0, -D / 2 + back], x: [0, 1, 0], y: [1, 0, 0], z: [0, 0, -1] },
        notes: [
          pieces.length > 1
            ? 'Too big for one sheet: the two pieces meet on the back edge of the middle fixed shelf.'
            : 'Sits in the side rabbets; screws into the back edges of the bottom, fixed shelves and top.',
        ],
      });
    }
    const fixedCount = captured.length;
    hardware.push({ item: '#6 × 5/8″ flat-head screws', quantity: Math.ceil((2 * (bh + bw)) / 6) + fixedCount * Math.ceil(Wi / 8), note: 'back panel, about every 6″' });
  }

  // ---- Joinery hardware ----------------------------------------------------
  const joints2 = captured.length * 2;
  const perEnd = Math.max(2, Math.floor(L.depthFixed / 4));
  if (spec.joinery === 'pocket-screw') hardware.push({ item: '1-1/4″ fine-thread pocket screws', quantity: joints2 * perEnd, note: 'pocket holes on the underside of each captured part' });
  if (spec.joinery === 'dowel') hardware.push({ item: '3/8″ × 1-1/2″ fluted dowel pins', quantity: joints2 * perEnd, note: `${perEnd} per end, ${f(1 / 2)} into the side` });
  if (adjustable.length) hardware.push({ item: `${f(PIN_DIAMETER)} shelf pins`, quantity: adjustable.length * 4 });
  if (plywood) {
    const edges = 2 * L.sideHeight + captured.length * Wi + adjustable.length * adjLen + (o.topStyle === 'overhang' ? L.Wo + 2 * L.Do : 0) + (kick ? Wi : 0);
    const banding = spec.units === 'mm' ? `${Math.ceil((edges * 1.1 * 25.4) / 1000)} m` : `${Math.ceil((edges * 1.1) / 12)} ft`;
    hardware.push({ item: `Iron-on ${species.name.toLowerCase()} veneer edge banding, ${banding}`, quantity: 1, note: 'for the exposed plywood edges, with 10% spare' });
  }
  hardware.push({ item: 'Wood glue', quantity: 1 });
  if (H > 30) hardware.push({ item: 'Anti-tip furniture strap', quantity: 1, note: 'or a screw through the back into a wall stud' });

  // ---- Checks ----------------------------------------------------------------
  const worst = L.shelfY.length ? sag(adjustable.length ? adjDepth : L.depthFixed) : null;
  if (worst && worst.sag > worst.limit) {
    warnings.push(
      `Shelves will sag about ${small(worst.sag)} under ${SHELF_LOADS[o.shelfLoad].label.toLowerCase()}, more than the ${small(worst.limit)} that looks right over a ${f(Wi)} span. ` +
        `Keep spans under ${f(floorToSixteenth(worst.maxSpan))}, use thicker shelves, or glue a ${f(3 / 4)} × ${f(1.5)} strip under the front edge.`,
    );
  }
  if (o.shelfType === 'adjustable' && L.fixed.some(Boolean)) {
    warnings.push(
      `One shelf near the middle is ${dado ? 'fixed in dados' : spec.joinery === 'dowel' ? 'doweled in place' : 'screwed in place'} to tie the tall sides together and stop them bowing; the rest adjust.`,
    );
  }

  // Line the case's back up with the top's back edge (see the top above).
  if (L.oh) for (const p of parts) p.placement = { ...p.placement, origin: [p.placement.origin[0], p.placement.origin[1], p.placement.origin[2] - L.oh / 2] };

  return {
    spec,
    parts,
    joints,
    assemblies,
    hardware,
    assemblySteps: bookshelfSteps(spec, { captured, pinRows, adjustable: adjustable.length, plywood }),
    warnings,
  };
}

function bookshelfSteps(
  spec: NormalizedSpec,
  c: { captured: { y: number; name: string }[]; pinRows: number[]; adjustable: number; plywood: boolean },
): string[] {
  const o = opts(spec);
  const L = layout(spec);
  const f = (x: number) => formatLength(x, spec.units);
  const species = getSpecies(spec.species);
  const steps: string[] = [];
  if (c.plywood) {
    steps.push('Break the plywood sheets down with a track saw or a circular saw and straightedge, then cut every part to the cut-list size on the table saw.');
  } else {
    steps.push(
      species.soldAs === 'rough'
        ? 'Mill the rough lumber: flatten one face, square an edge, plane to thickness, and let it rest a day.'
        : 'Check the surfaced boards for straightness; joint any edges that will be glued.',
    );
    steps.push(`Glue up the wide panels (sides${o.topStyle === 'overhang' ? ', top' : ''} and shelves) from boards no wider than ${f(o.maxBoardWidth)}; trim to the cut-list sizes once cured.`);
  }
  steps.push(`Clamp the two sides together, inside faces out, and mark both at once from the floor: ${c.captured.map((x) => `${x.name} at ${f(x.y)}`).join(', ')}.`);
  if (spec.joinery === 'dado') {
    steps.push(`Cut the dados ${f(L.dado)} deep with a dado stack or a router and edge guide. Test-fit against your actual ${c.plywood ? 'plywood (it runs under its nominal thickness)' : 'shelf stock'} before cutting the real parts.`);
  } else if (spec.joinery === 'pocket-screw') {
    steps.push('Drill pocket holes on the underside of each end of the bottom, fixed shelves and top.');
  } else {
    steps.push('Drill the dowel holes with a doweling jig referenced from the front edge, so every joint lines up.');
  }
  if (L.back) steps.push(`Rabbet the back inside edge of each side ${f(L.back)} wide × ${f(BACK_RABBET_DEPTH)} deep for the back panel.`);
  if (c.pinRows.length) {
    steps.push(`Drill the shelf-pin holes with a pin jig referenced from the bottom of each side, so the rows match: every ${f(PIN_SPACING)}, ${f(PIN_HOLE_DEPTH)} deep (a stop collar keeps them from going through).`);
  }
  if (c.plywood) steps.push('Iron edge banding onto every exposed front edge and trim it flush.');
  steps.push('Sand all inside faces to 180 now; inside corners are hard to reach after glue-up.');
  steps.push('Dry-fit the case.');
  steps.push(
    `Glue the bottom${c.captured.some((x) => x.name === 'fixed shelf') ? ', fixed shelves' : ''}${o.topStyle === 'flush' ? ' and top' : ''} between the sides. Clamp across, then measure the diagonals and adjust until they match within ${f(1 / 16)}.`,
  );
  if (L.kick) steps.push('Glue and screw the kick rail under the bottom, flush with the front edges.');
  if (L.back) steps.push('Lay the case on its front. Drop the back into the rabbets; it squares the case. Screw it to the sides and to the back edges of the fixed parts about every 6″.');
  if (o.topStyle === 'overhang') steps.push(`Glue and dowel the top onto the sides, overhanging ${f(o.topOverhang)} at the front and ends.`);
  steps.push(
    spec.finish === 'paint'
      ? 'Fill and sand to 220, prime, then two coats of paint; leave the shelf-pin holes clear.'
      : spec.finish === 'stain'
        ? `${species.blotchy ? 'Apply a pre-stain conditioner, then stain' : 'Stain'} and topcoat with 2–3 coats; shelves get the same finish on both faces so they stay flat.`
        : spec.finish === 'raw'
          ? 'Sand to 180–220; consider at least a coat of wax.'
          : 'Wipe on oil, 3 coats a day apart; finish both faces of every shelf equally so they stay flat.',
  );
  if (spec.dimensions.height > 30) steps.push('Stand it in place and fasten it to the wall with an anti-tip strap or a screw into a stud. Tall bookcases tip when climbed or loaded at the top.');
  if (c.adjustable) steps.push(`Set the pins and drop in the ${c.adjustable === 1 ? 'adjustable shelf' : `${c.adjustable} adjustable shelves`}.`);
  return steps;
}

const choice = (value: string, label: string) => ({ value, label });

export const bookshelf: ProjectType = {
  id: 'bookshelf',
  label: 'Bookshelf',
  supportedJoinery: ['dado', 'pocket-screw', 'dowel'],
  defaultDimensions: { length: 36, width: 12, height: 72 },
  validate: validateBookshelf,
  build: buildBookshelf,
  dimensionLabels: () => ({ length: 'Width', width: 'Depth', height: 'Height' }),
  options: [
    { key: 'caseMaterial', group: 'Case', label: 'Case material', kind: 'select', default: 'solid', choices: [choice('solid', 'Solid wood (glued-up panels)'), choice('plywood', 'Veneer plywood, edge-banded')] },
    { key: 'caseThickness', group: 'Case', label: 'Side, top and bottom thickness', kind: 'length', default: 0.75, min: 0.5, max: 1.25 },
    {
      key: 'topStyle',
      group: 'Case',
      label: 'Top',
      kind: 'select',
      default: 'flush',
      choices: [choice('flush', 'Flush, between the sides'), choice('overhang', 'Overhanging the sides')],
    },
    { key: 'topOverhang', group: 'Case', label: 'Top overhang', kind: 'length', default: 0.75, min: 0.25, max: 3, showIf: (o) => o.topStyle === 'overhang' },
    { key: 'kickHeight', group: 'Case', label: 'Kick (bottom shelf height)', kind: 'length', default: 3, min: 0, max: 8, help: 'Height of the rail under the bottom shelf. 0 puts the bottom on the floor.' },
    { key: 'backPanel', group: 'Case', label: 'Back', kind: 'select', default: 'plywood', choices: [choice('plywood', '1/4″ plywood in rabbets'), choice('none', 'Open back')] },
    {
      key: 'maxBoardWidth',
      group: 'Case',
      label: 'Max board width in glue-ups',
      kind: 'length',
      default: 6,
      min: 2,
      showIf: (o) => o.caseMaterial !== 'plywood',
    },
    { key: 'shelfType', group: 'Shelves', label: 'Shelves', kind: 'select', default: 'adjustable', choices: [choice('adjustable', 'Adjustable, on shelf pins'), choice('fixed', 'Fixed')] },
    {
      key: 'shelfCount',
      group: 'Shelves',
      label: 'Number of shelves',
      kind: 'number',
      default: (c) => Math.max(0, Math.round((c.dimensions.height - 3 - 1.5) / 12) - 1),
      min: 0,
      max: 20,
      help: 'Between the bottom and the top, evenly spaced.',
    },
    { key: 'shelfThickness', group: 'Shelves', label: 'Shelf thickness', kind: 'length', default: 0.75, min: 0.5, max: 1.5 },
    {
      key: 'shelfLoad',
      group: 'Shelves',
      label: 'What goes on the shelves',
      kind: 'select',
      default: 'books',
      choices: (Object.keys(SHELF_LOADS) as ShelfLoad[]).map((k) => choice(k, SHELF_LOADS[k].label)),
      help: 'Used to check how much the shelves sag.',
    },
  ],
};
