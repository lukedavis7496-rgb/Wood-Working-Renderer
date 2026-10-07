import { getSpecies } from '../../core/species';
import type { Assembly, HardwareItem, Joint, Model, NormalizedSpec, Part, ProjectType } from '../../core/types';
import { roundToSixteenth } from '../../core/units';
import { apronBaseSteps, buildApronBase, validateApronBase, type ApronFootprint } from './apronBase';
import { finishStep, fmt, opts, slabPrepSteps, topThickness, usesApronBase, usesSlab, type TableOptions } from './common';
import { buildPedestal, defaultColumnSize, defaultFootSpan, FOOT_HEIGHT, CLEAT_HEIGHT, pedestalSteps } from './pedestal';
import { defaultSteelLegWidth, slabWidthAt, steelLegs, STEEL_LEG_LABELS } from './steelLegs';
import { liveEdgeSlab, rectBoardTop, roundBoardTop, roundSlab, type Top } from './tops';

export { resolveTableJoinery } from './apronBase';

const isRound = (o: Record<string, unknown>) => o.tableStyle === 'round';
const isLiveEdge = (o: Record<string, unknown>) => o.tableStyle === 'live-edge';
const slabTop = (o: Record<string, unknown>) => usesSlab(o as unknown as TableOptions);
const apronBase = (o: Record<string, unknown>) => usesApronBase(o as unknown as TableOptions);

/** Where the legs of a leg-and-apron base go. */
function apronFootprint(spec: NormalizedSpec): ApronFootprint {
  const o = opts(spec);
  const { length: L, width: W, height: H } = spec.dimensions;
  const legLen = H - topThickness(o);
  if (o.tableStyle === 'round') {
    // Square base inscribed in the circle, its corners `overhang` inside the edge.
    const h = (L / 2 - o.overhang) / Math.SQRT2;
    return { hl: h, hw: h, legLen };
  }
  return { hl: L / 2 - o.overhang, hw: W / 2 - o.overhang, legLen };
}

function validateTable(spec: NormalizedSpec): string[] {
  const o = opts(spec);
  const f = fmt(spec);
  const { length: L, width: W, height: H } = spec.dimensions;
  const errs: string[] = [];
  const tt = topThickness(o);

  if (usesSlab(o)) {
    if (tt < 0.75) errs.push(`The slab would be under ${f(0.75)} thick after flattening.`);
    if (o.flattenAllowance < 0) errs.push('Flattening allowance can\'t be negative.');
  }
  if (o.tableStyle === 'classic' && o.overhang > Math.min(L, W) / 4)
    errs.push('Overhang is more than a quarter of the table — the base would be too small to be stable.');

  if (usesApronBase(o)) errs.push(...validateApronBase(spec, apronFootprint(spec)));

  if (o.tableStyle === 'live-edge') {
    if (o.narrowWidth > W + 1e-9) errs.push('The narrow end can\'t be wider than the widest width.');
    if (o.slabLength < L - 1e-9) errs.push(`Your slab (${f(o.slabLength)}) is shorter than the table length (${f(L)}).`);
    if (H - tt < 6) errs.push('Table is too low for legs under this slab.');
    if (2 * o.steelLegInset > L - 6) errs.push('Legs are set in so far from the ends that they would meet.');
    if (o.steelLegStyle !== 'hairpin') {
      const narrowest = Math.min(slabWidthAt(spec, o.steelLegInset), slabWidthAt(spec, L - o.steelLegInset));
      if (o.steelLegWidth > narrowest - 1)
        errs.push(`${f(o.steelLegWidth)} legs are too wide for the slab where they mount (${f(narrowest)}); keep them at least ${f(0.5)} in from each edge.`);
    }
  }
  if (o.tableStyle === 'round' && o.roundBase === 'pedestal') {
    if (H - tt - FOOT_HEIGHT - CLEAT_HEIGHT < 6) errs.push('Table is too low for a pedestal.');
    if (o.footSpan > L) errs.push('Feet are wider than the top.');
  }
  return errs;
}

function buildTable(spec: NormalizedSpec): Model {
  const o = opts(spec);
  const f = fmt(spec);
  const species = getSpecies(spec.species);
  const { length: L, width: W } = spec.dimensions;

  let top: Top;
  if (o.tableStyle === 'live-edge') top = liveEdgeSlab(spec);
  else if (o.tableStyle === 'round') top = o.roundTop === 'slab' ? roundSlab(spec) : roundBoardTop(spec);
  else top = rectBoardTop(spec);

  const parts: Part[] = [...top.parts];
  const joints: Joint[] = [];
  const hardware: HardwareItem[] = [];
  const warnings: string[] = [];
  const assemblies: Assembly[] = top.assembly ? [top.assembly] : [];
  const steps: string[] = [];

  // Shared opening steps.
  const boards = top.parts.filter((p) => p.sourcing !== 'owned').length;
  const hasLumber = boards > 0 || !(o.tableStyle === 'live-edge');
  if (hasLumber) {
    steps.push(
      species.soldAs === 'rough'
        ? 'Mill the rough lumber: flatten one face, square an edge, plane to thickness, and let it rest a day before final dimensioning.'
        : 'Check the surfaced boards for straightness; joint any edges that will be glued.',
    );
    steps.push(boards ? 'Cut every part to the cut-list size. Leave the top boards oversized as listed.' : 'Cut every base part to the cut-list size.');
  }
  if (boards > 1) steps.push(`Glue up the ${boards} top boards edge to edge, alternating growth rings. Set aside to cure overnight.`);
  if (usesSlab(o)) {
    steps.push(
      ...slabPrepSteps(
        spec,
        o.tableStyle === 'live-edge' && o.slabLength > L + 1e-9
          ? `Square the ends with a track saw or a router against a straightedge, trimming ${f(o.slabLength)} down to ${f(L)}.`
          : undefined,
      ),
    );
  }

  const topId = top.parts[0].id;
  let attach: string;

  if (usesApronBase(o)) {
    const base = buildApronBase(spec, apronFootprint(spec));
    parts.push(...base.parts);
    joints.push(...base.joints);
    for (const id of base.apronIds) joints.push({ kind: 'fastener', parts: [id, topId], description: 'figure-8 fasteners (top floats for seasonal movement)' });
    hardware.push(...base.hardware);
    warnings.push(...base.warnings);
    steps.push(...apronBaseSteps(spec, base));
    attach = `Centre the top upside-down on a blanket, set the base on it (${f(o.overhang)} overhang ${o.tableStyle === 'round' ? 'at the leg corners' : 'all round'}) and attach with the figure-8 fasteners. Don't glue the top: it must move across its width with the seasons.`;
  } else if (o.tableStyle === 'live-edge') {
    const legs = steelLegs(spec, top.underside);
    parts.push(...legs.parts);
    hardware.push(...legs.hardware);
    for (const p of legs.parts) joints.push({ kind: 'fastener', parts: [p.id, topId], description: 'screws through slotted mounting holes' });
    attach =
      `Lay the slab face down on a blanket. ${legs.notes[0]} Square each leg to the slab's centreline, mark and drill pilot holes ` +
      '(stop well short of the top face), slot the outer holes across the grain, and screw the legs on. Level the feet if the floor needs it.';
    if (o.steelLegStyle === 'hairpin' && L > 60) warnings.push('Hairpin legs flex under a long, heavy slab; U, trapezoid or X legs are steadier above 60″.');
  } else {
    const ped = buildPedestal(spec, top.underside, topId);
    parts.push(...ped.parts);
    joints.push(...ped.joints);
    hardware.push(...ped.hardware);
    steps.push(...pedestalSteps(spec, ped.layers, ped.colLen));
    if (o.footSpan < 0.6 * L) warnings.push(`Feet span only ${Math.round((o.footSpan / L) * 100)}% of the top; under 60% a pedestal table tips easily when leaned on.`);
    attach = 'Centre the base upside-down on the top and screw the cleats to it through the slotted holes. No glue: the top must move with the seasons.';
  }

  if (o.roundTop === 'boards' && o.tableStyle === 'round') {
    steps.push(`Flatten the cured top panel and cut it to a ${f(L)} circle. Ease or profile the edge.`);
  } else if (o.tableStyle === 'classic') {
    steps.push(`Flatten the cured top panel, trim to ${f(W)} × ${f(L)}, and ease the edges.`);
  }
  steps.push(finishStep(spec));
  steps.push(attach);

  return { spec, parts, joints, assemblies, hardware, assemblySteps: steps, warnings };
}

const choice = (value: string, label: string) => ({ value, label });

export const table: ProjectType = {
  id: 'table',
  label: 'Table',
  supportedJoinery: ['mortise-tenon', 'dowel', 'pocket-screw'],
  defaultDimensions: { length: 60, width: 36, height: 30 },
  validate: validateTable,
  build: buildTable,
  dimensionLabels: (o) =>
    o.tableStyle === 'round'
      ? { length: 'Diameter', width: null, height: 'Height' }
      : o.tableStyle === 'live-edge'
        ? { length: 'Finished length', width: 'Slab width (widest)', height: 'Height' }
        : { length: 'Length', width: 'Width', height: 'Height' },
  joineryApplies: (o) => usesApronBase(o as unknown as TableOptions),
  options: [
    {
      key: 'tableStyle',
      label: 'Table style',
      kind: 'select',
      default: 'classic',
      prominent: true,
      choices: [choice('classic', 'Classic (legs + aprons)'), choice('live-edge', 'Live edge slab'), choice('round', 'Round')],
    },
    // ---- Round -------------------------------------------------------------
    {
      key: 'roundTop',
      label: 'Round top',
      kind: 'select',
      default: 'boards',
      choices: [choice('boards', 'Glued-up boards, cut round'), choice('slab', 'My round slab (live edge)')],
      showIf: isRound,
    },
    {
      key: 'roundBase',
      label: 'Base',
      kind: 'select',
      default: 'pedestal',
      choices: [choice('pedestal', 'Pedestal'), choice('four-legs', 'Four legs + aprons')],
      showIf: isRound,
    },
    // ---- Slab --------------------------------------------------------------
    {
      key: 'narrowWidth',
      label: 'Slab width at narrow end',
      kind: 'length',
      default: (c) => c.dimensions.width,
      min: 6,
      showIf: isLiveEdge,
      help: 'Measure across the top face at the narrower end, after trimming.',
    },
    {
      key: 'slabLength',
      label: 'Slab length as it is now',
      kind: 'length',
      default: (c) => c.dimensions.length + 2,
      showIf: isLiveEdge,
      help: 'Extra length is trimmed off to square the ends.',
    },
    {
      key: 'slabThickness',
      label: 'Slab thickness as it is now',
      kind: 'length',
      default: (c) => (c.dimensions.height >= 26 ? 2.25 : 2),
      min: 1,
      max: 6,
      showIf: slabTop,
    },
    {
      key: 'flattenAllowance',
      label: 'Lost to flattening',
      kind: 'length',
      default: 0.25,
      min: 0,
      showIf: slabTop,
      help: 'Total off both faces on the router sled. More for a cupped or twisted slab.',
    },
    // ---- Steel legs --------------------------------------------------------
    {
      key: 'steelLegStyle',
      label: 'Steel legs',
      kind: 'select',
      default: 'u',
      choices: (Object.keys(STEEL_LEG_LABELS) as (keyof typeof STEEL_LEG_LABELS)[]).map((k) => choice(k, STEEL_LEG_LABELS[k])),
      showIf: isLiveEdge,
    },
    {
      key: 'steelLegInset',
      label: 'Legs in from each end',
      kind: 'length',
      default: (c) => Math.min(12, Math.max(4, Math.round(c.dimensions.length * 0.12))),
      min: 0,
      showIf: isLiveEdge,
    },
    {
      key: 'steelLegWidth',
      label: 'Steel leg width',
      kind: 'length',
      default: (c) =>
        defaultSteelLegWidth(c.dimensions.length, c.dimensions.width, c.options.narrowWidth as number, c.options.steelLegInset as number),
      min: 6,
      showIf: (o) => isLiveEdge(o) && o.steelLegStyle !== 'hairpin',
      help: 'Defaults to 2″ in from each edge at the narrower leg, in an even stock size.',
    },
    {
      key: 'steelTubeSize',
      label: 'Steel tube size',
      kind: 'length',
      default: 2,
      min: 0.75,
      max: 4,
      showIf: (o) => isLiveEdge(o) && o.steelLegStyle !== 'hairpin',
    },
    // ---- Leg-and-apron base -------------------------------------------------
    {
      key: 'legStyle',
      label: 'Leg style',
      kind: 'select',
      default: 'tapered',
      choices: [choice('straight', 'Straight (square)'), choice('tapered', 'Tapered (inside faces)')],
      showIf: apronBase,
    },
    { key: 'legThickness', label: 'Leg thickness', kind: 'length', default: (c) => (c.dimensions.height < 22 ? 1.5 : 1.75), min: 1, max: 4, showIf: apronBase },
    {
      key: 'taperFootSize',
      label: 'Taper: size at foot',
      kind: 'length',
      default: (c) => roundToSixteenth((c.options.legThickness as number) * 0.65),
      showIf: (o) => apronBase(o) && o.legStyle === 'tapered',
      help: 'Square size the leg tapers down to at the floor.',
    },
    { key: 'taperStart', label: 'Taper: start below apron', kind: 'length', default: 1, min: 0, showIf: (o) => apronBase(o) && o.legStyle === 'tapered' },
    {
      key: 'apronInset',
      label: 'Apron inset',
      kind: 'length',
      default: 0.25,
      min: 0,
      showIf: apronBase,
      help: "How far the apron's face is set back from the leg's outer face.",
    },
    { key: 'apronWidth', label: 'Apron width (height)', kind: 'length', default: (c) => (c.dimensions.height >= 26 ? 4 : 3), min: 1.5, showIf: apronBase },
    { key: 'apronThickness', label: 'Apron thickness', kind: 'length', default: 0.75, min: 0.5, max: 1.5, showIf: apronBase },
    {
      key: 'tenonLength',
      label: 'Preferred tenon length',
      kind: 'length',
      default: 1.25,
      min: 0.5,
      showIf: (o, joinery) => apronBase(o) && joinery === 'mortise-tenon',
      help: 'Shortened automatically if adjacent mortises would collide inside the leg.',
    },
    // ---- Board tops ----------------------------------------------------------
    {
      key: 'topThickness',
      label: 'Top thickness',
      kind: 'length',
      default: (c) => (c.dimensions.length >= 48 ? 1 : 0.75),
      min: 0.5,
      max: 2.5,
      showIf: (o) => !slabTop(o),
    },
    {
      key: 'overhang',
      label: 'Top overhang',
      kind: 'length',
      default: (c) => (c.options.tableStyle === 'round' ? 2 : 1),
      min: 0,
      showIf: apronBase,
      help: 'How far the top reaches past the legs (past the leg corners on a round table).',
    },
    {
      key: 'maxTopBoardWidth',
      label: 'Max top board width',
      kind: 'length',
      default: 6,
      min: 2,
      showIf: (o) => !slabTop(o),
      help: 'Narrower boards in the glue-up = flatter, more stable top.',
    },
    // ---- Pedestal ----------------------------------------------------------
    {
      key: 'columnSize',
      label: 'Column size',
      kind: 'select',
      default: (c) => String(defaultColumnSize(c.dimensions.length)),
      choices: [choice('3.5', '3-1/2″ (2 laminations)'), choice('5.25', '5-1/4″ (3 laminations)')],
      showIf: (o) => isRound(o) && o.roundBase === 'pedestal',
    },
    {
      key: 'footSpan',
      label: 'Foot span',
      kind: 'length',
      default: (c) => defaultFootSpan(c.dimensions.length),
      min: 8,
      showIf: (o) => isRound(o) && o.roundBase === 'pedestal',
      help: 'Tip-to-tip length of each foot. 60–75% of the diameter keeps it from tipping.',
    },
  ],
};
