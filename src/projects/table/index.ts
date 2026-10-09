import { getSpecies } from '../../core/species';
import type { Assembly, HardwareItem, Joint, Model, NormalizedSpec, Part, ProjectType } from '../../core/types';
import { roundToSixteenth } from '../../core/units';

const roundUpSixteenth = (x: number) => Math.ceil(x * 16 - 1e-9) / 16;
import { apronBaseSteps, buildApronBase, validateApronBase, type ApronFootprint } from './apronBase';
import { finishStep, fmt, hasProfile, opts, slabPrepSteps, slabWidthAt, slabWidthFn, topThickness, usesApronBase, usesSlab, type TableOptions } from './common';
import { seasonalMovement, slotLength } from '../../core/movement';
import { buildPedestal, cleatLength, defaultColumnSize, defaultFootSpan, FOOT_HEIGHT, CLEAT_HEIGHT, pedestalSteps } from './pedestal';
import { defaultSteelLegWidth, HAIRPIN_EDGE_INSET, steelLegs, STEEL_LEG_LABELS } from './steelLegs';
import { chairGhosts, DINING_HEIGHT, KNEE_ROOM_MIN, recommendedSeating, seatingFor, SEAT_WIDTH_MIN, type Seating } from './seating';
import { butterflyKeys, butterflySteps, keyPositions, keySize } from './butterflies';
import { liveEdgeSlab, rectBoardTop, roundBoardTop, roundSlab, type Top } from './tops';
import { SPECIES } from '../../core/species';

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
    if (!hasProfile(o) && o.narrowWidth > W + 1e-9) errs.push('The narrow end can\'t be wider than the widest width.');
    if (o.slabLength < L - 1e-9) errs.push(`Your slab (${f(o.slabLength)}) is shorter than the table length (${f(L)}).`);
    if (H - tt < 6) errs.push('Table is too low for legs under this slab.');
    if (2 * o.steelLegInset > L - 6) errs.push('Legs are set in so far from the ends that they would meet.');
    const narrowest = Math.min(slabWidthAt(spec, o.steelLegInset), slabWidthAt(spec, L - o.steelLegInset));
    if (o.steelLegStyle === 'hairpin') {
      // Two 4″ mounting plates side by side, each 2″ in from its edge, plus a gap.
      const need = 2 * (HAIRPIN_EDGE_INSET + 4) + 1;
      if (narrowest < need) errs.push(`The slab is ${f(narrowest)} wide where the legs go; hairpins need about ${f(need)}. Use U, trapezoid or X legs.`);
    } else {
      if (o.steelLegWidth > narrowest - 1)
        errs.push(`${f(o.steelLegWidth)} legs are too wide for the slab where they mount (${f(narrowest)}); keep them at least ${f(0.5)} in from each edge.`);
    }
  }
  if (usesSlab(o)) errs.push(...validateKeys(spec));
  if (o.tableStyle === 'round' && o.roundBase === 'pedestal') {
    if (H - tt - FOOT_HEIGHT - CLEAT_HEIGHT < 6) errs.push('Table is too low for a pedestal.');
    if (o.footSpan > L) errs.push('Feet are wider than the top.');
  }
  return errs;
}

function validateKeys(spec: NormalizedSpec): string[] {
  const o = opts(spec);
  const f = fmt(spec);
  const L = spec.dimensions.length;
  const at = keyPositions(o.butterflyCount, o.butterflyPositions, L);
  if (!at.length) return [];
  const k = keySize(o.butterflyLength, o.butterflyThickness);
  const errs: string[] = [];
  const slabWidth =
    o.tableStyle === 'round' ? (x: number) => 2 * Math.sqrt(Math.max(0, (L / 2) ** 2 - (x - L / 2) ** 2)) : (x: number) => slabWidthAt(spec, x);
  if (o.butterflyThickness > topThickness(o) / 2) errs.push(`Butterfly keys over half the slab's thickness (${f(topThickness(o) / 2)}) weaken it more than they hold it.`);
  if (k.waist < 0.375) errs.push(`Butterfly keys under ${f(3)} long have too thin a waist; make them longer.`);
  for (const x of at) {
    if (x < k.width / 2 + 0.5 || x > L - k.width / 2 - 0.5) errs.push(`A butterfly key at ${f(x)} hangs off the end of the slab.`);
    else if (k.length > slabWidth(x) - 4) errs.push(`A ${f(k.length)} butterfly key at ${f(x)} is too long for the slab's ${f(slabWidth(x))} width there.`);
  }
  const sorted = [...at].sort((a, b) => a - b);
  if (sorted.some((x, i) => i > 0 && x - sorted[i - 1] < k.width + 0.5)) errs.push(`Butterfly keys need at least ${f(k.width + 0.5)} between their centres.`);
  return errs;
}

function buildTable(spec: NormalizedSpec): Model {
  const o = opts(spec);
  const f = fmt(spec);
  const species = getSpecies(spec.species);
  const { length: L, width: W } = spec.dimensions;
  const movement = seasonalMovement(species.id, W);
  const moves = `${species.name} ${f(W)} wide moves about ${f(movement)} across its width between a dry winter and a humid summer`;

  let top: Top;
  if (o.tableStyle === 'live-edge') top = liveEdgeSlab(spec);
  else if (o.tableStyle === 'round') top = o.roundTop === 'slab' ? roundSlab(spec) : roundBoardTop(spec);
  else top = rectBoardTop(spec);

  // Cut list order follows part order: base first, glued-up top last; a slab
  // you own leads, since the design is built around it.
  const parts: Part[] = [];
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
  // Butterfly keys inlaid across checks in a slab top.
  const keyAt = usesSlab(o) ? keyPositions(o.butterflyCount, o.butterflyPositions, L) : [];
  const keys = keyAt.length ? butterflyKeys(spec, top.parts[0], L, spec.dimensions.height) : [];
  if (usesSlab(o)) {
    steps.push(
      ...slabPrepSteps(
        spec,
        o.tableStyle === 'live-edge' && o.slabLength > L + 1e-9
          ? `Square the ends with a track saw or a router against a straightedge, trimming ${f(o.slabLength)} down to ${f(L)}.`
          : undefined,
        keyAt.length ? butterflySteps(spec, keyAt) : undefined,
      ),
    );
  }

  const topId = top.parts[0].id;
  let attach: string;
  let seating: Model['seating'];
  let ghosts: Model['ghosts'];

  if (usesApronBase(o)) {
    const base = buildApronBase(spec, apronFootprint(spec));
    parts.push(...base.parts);
    joints.push(...base.joints);
    for (const id of base.apronIds) joints.push({ kind: 'fastener', parts: [id, topId], description: 'figure-8 fasteners (top floats for seasonal movement)' });
    hardware.push(...base.hardware);
    warnings.push(...base.warnings);
    steps.push(...apronBaseSteps(spec, base));
    attach =
      `Centre the top upside-down on a blanket, set the base on it (${f(o.overhang)} overhang ${o.tableStyle === 'round' ? 'at the leg corners' : 'all round'}) and attach with the figure-8 fasteners. ` +
      `Don't glue the top: ${moves}, and the fasteners pivot to let it.`;
  } else if (o.tableStyle === 'live-edge') {
    const legs = steelLegs(spec, top.underside);
    parts.push(...legs.parts);
    hardware.push(...legs.hardware);
    for (const p of legs.parts) joints.push({ kind: 'fastener', parts: [p.id, topId], description: 'screws through slotted mounting holes' });
    // The outermost screw sits near the end of the leg's top bar (or, for
    // hairpins, near the slab's edge); it travels the most.
    const outer = o.steelLegStyle === 'hairpin' ? Math.max(...legs.parts.map((p) => Math.abs(p.placement.origin[2]))) + 1.5 : o.steelLegWidth / 2 - o.steelTubeSize / 2;
    const slot = slotLength(species.id, outer, 1 / 4);
    attach =
      `Lay the slab face down on a blanket. ${legs.notes[0]} Square each leg to the slab's centreline and mark the holes. ` +
      `${moves}, so leave the centre hole of each leg round and elongate the others across the grain to about ${f(roundUpSixteenth(slot))} long. ` +
      'Drill pilot holes (stop well short of the top face), centre the screws in the slots, and screw the legs on. Level the feet if the floor needs it.';
    if (o.steelLegStyle === 'hairpin' && L > 60) warnings.push('Hairpin legs flex under a long, heavy slab; U, trapezoid or X legs are steadier above 60″.');
    if (spec.dimensions.height >= DINING_HEIGHT) {
      const layout = seatingLayout(spec.dimensions, o);
      const seats = seatingFor(layout, o.steelLegInset);
      const best = recommendedSeating(layout);
      seating = { total: seats.total, summary: describeSeating(seats, layout, f) };
      ghosts = chairGhosts(layout, seats).map((solids) => ({ kind: 'chair' as const, solids }));
      if (best.total > seats.total) {
        warnings.push(`Legs ${f(o.steelLegInset)} from the ends seat ${seats.total}; ${f(best.inset)} from the ends would seat ${best.total}. ${describeSeating(best, layout, f)}`);
      }
    }
  } else {
    const ped = buildPedestal(spec, top.underside, topId);
    parts.push(...ped.parts);
    joints.push(...ped.joints);
    hardware.push(...ped.hardware);
    steps.push(...pedestalSteps(spec, ped.layers, ped.colLen));
    if (o.footSpan < 0.6 * L) warnings.push(`Feet span only ${Math.round((o.footSpan / L) * 100)}% of the top; under 60% a pedestal table tips easily when leaned on.`);
    const slot = slotLength(species.id, cleatLength(L) / 2 - 1, 0.19);
    attach =
      `Centre the base upside-down on the top and screw the cleats to it. ${moves}: leave the centre holes round, ` +
      `elongate the outer holes on the cleat that runs across the grain to about ${f(roundUpSixteenth(slot))}, and centre the screws in them. No glue.`;
  }

  if (o.roundTop === 'boards' && o.tableStyle === 'round') {
    steps.push(`Flatten the cured top panel and cut it to a ${f(L)} circle. Ease or profile the edge.`);
  } else if (o.tableStyle === 'classic') {
    steps.push(`Flatten the cured top panel, trim to ${f(W)} × ${f(L)}, and ease the edges.`);
  }
  steps.push(finishStep(spec));
  steps.push(attach);

  if (top.weight && top.weight > 80) {
    warnings.push(`The slab weighs about ${Math.round(top.weight)} lb finished. Line up a helper (or a slab cart) for every flip and move.`);
  }

  const ordered = top.parts[0].sourcing === 'owned' ? [...top.parts, ...keys, ...parts] : [...parts, ...top.parts];
  return {
    spec,
    parts: ordered,
    joints,
    assemblies,
    hardware,
    assemblySteps: steps,
    warnings,
    movement: { width: W, amount: movement, species: species.id },
    seating,
    ghosts,
  };
}

function seatingLayout(d: { length: number; width: number }, o: TableOptions) {
  return { style: o.steelLegStyle, length: d.length, tube: o.steelTubeSize, widthAt: slabWidthFn(d.length, d.width, o) };
}

function describeSeating(s: Seating, l: ReturnType<typeof seatingLayout>, f: (x: number) => string): string {
  const sides = `${s.perSide} along each side (${f(Math.floor(s.sideRoom))} each)`;
  if (s.perEnd) {
    const knees = l.style === 'hairpin' ? 'knees between the hairpins' : `${f(s.kneeRoom)} of knee room before the legs`;
    return `Seats ${s.total}: ${sides} and 1 at each end (${knees}).`;
  }
  const endWidth = Math.min(l.widthAt(0), l.widthAt(l.length));
  const why =
    endWidth < SEAT_WIDTH_MIN
      ? `the ends are under ${f(SEAT_WIDTH_MIN)} wide`
      : l.style === 'hairpin'
        ? 'the hairpins at each end are too close together for knees'
        : `the legs leave ${f(Math.max(0, s.kneeRoom))} of knee room at the ends, under the ${f(KNEE_ROOM_MIN)} a chair needs`;
  return `Seats ${s.total}: ${sides}; no end chairs, because ${why}.`;
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
        ? { length: 'Finished length', width: hasProfile(o as unknown as TableOptions) ? null : 'Slab width (widest)', height: 'Height' }
        : { length: 'Length', width: 'Width', height: 'Height' },
  deriveDimensions: (d, options) => {
    const o = options as unknown as TableOptions;
    if (o.tableStyle === 'round') return { ...d, width: d.length };
    if (hasProfile(o)) return { ...d, width: Math.max(...o.widthProfile) };
    return d;
  },
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
      key: 'roundTop', group: 'Round table',
      label: 'Round top',
      kind: 'select',
      default: 'boards',
      choices: [choice('boards', 'Glued-up boards, cut round'), choice('slab', 'My round slab (live edge)')],
      showIf: isRound,
    },
    {
      key: 'roundBase', group: 'Round table',
      label: 'Base',
      kind: 'select',
      default: 'pedestal',
      choices: [choice('pedestal', 'Pedestal'), choice('four-legs', 'Four legs + aprons')],
      showIf: isRound,
    },
    // ---- Slab --------------------------------------------------------------
    {
      key: 'widthProfile', group: 'Your slab',
      label: 'Widths measured along the slab',
      kind: 'lengthList',
      default: [],
      minCount: 2,
      placeholder: 'e.g. 40, 38-1/2, 37, 36, 34',
      showIf: isLiveEdge,
      help: 'Optional. Measure across the top face at even spacing from one end of the finished length to the other. The model, leg sizes and fit checks follow your slab.',
    },
    {
      key: 'narrowWidth', group: 'Your slab',
      label: 'Slab width at narrow end',
      kind: 'length',
      default: (c) => c.dimensions.width,
      min: 6,
      showIf: (o) => isLiveEdge(o) && !hasProfile(o as unknown as TableOptions),
      help: 'Measure across the top face at the narrower end, after trimming.',
    },
    {
      key: 'slabLength', group: 'Your slab',
      label: 'Slab length as it is now',
      kind: 'length',
      default: (c) => c.dimensions.length + 2,
      showIf: isLiveEdge,
      help: 'Extra length is trimmed off to square the ends.',
    },
    {
      key: 'slabThickness', group: 'Your slab',
      label: 'Slab thickness as it is now',
      kind: 'length',
      default: (c) => (c.dimensions.height >= 26 ? 2.25 : 2),
      min: 1,
      max: 6,
      showIf: slabTop,
    },
    {
      key: 'flattenAllowance', group: 'Your slab',
      label: 'Lost to flattening',
      kind: 'length',
      default: 0.25,
      min: 0,
      showIf: slabTop,
      help: 'Total off both faces on the router sled. More for a cupped or twisted slab.',
    },
    // ---- Butterfly keys -----------------------------------------------------
    {
      key: 'butterflyCount', group: 'Butterfly keys',
      label: 'Number of keys',
      kind: 'number',
      default: 0,
      min: 0,
      max: 12,
      showIf: slabTop,
      help: 'Bowtie keys across checks. Without positions they go 6″ in from alternate ends, on the centreline.',
    },
    {
      key: 'butterflyPositions', group: 'Butterfly keys',
      label: 'Key positions from the first end',
      kind: 'lengthList',
      default: [],
      placeholder: 'e.g. 5, 12, 78',
      showIf: slabTop,
      help: 'Optional: where your checks are, measured to the centre of each key. Overrides the number above.',
    },
    {
      key: 'butterflySpecies', group: 'Butterfly keys',
      label: 'Key wood',
      kind: 'select',
      // Contrast with the slab: pale maple keys in walnut, walnut keys in anything else.
      default: (c) => (c.species === 'walnut' ? 'hard-maple' : 'walnut'),
      choices: Object.values(SPECIES).map((sp) => choice(sp.id, sp.name)),
      showIf: (o) => slabTop(o) && (Number(o.butterflyCount) > 0 || (Array.isArray(o.butterflyPositions) && o.butterflyPositions.length > 0)),
      help: 'A contrasting wood shows the keys off; the same wood hides them.',
    },
    {
      key: 'butterflyLength', group: 'Butterfly keys',
      label: 'Key length',
      kind: 'length',
      default: 4,
      min: 2,
      max: 10,
      showIf: (o) => slabTop(o) && (Number(o.butterflyCount) > 0 || (Array.isArray(o.butterflyPositions) && o.butterflyPositions.length > 0)),
    },
    {
      key: 'butterflyThickness', group: 'Butterfly keys',
      label: 'Key thickness',
      kind: 'length',
      default: 0.5,
      min: 0.25,
      max: 1,
      showIf: (o) => slabTop(o) && (Number(o.butterflyCount) > 0 || (Array.isArray(o.butterflyPositions) && o.butterflyPositions.length > 0)),
      help: 'Structural keys are 5/16″–1/2″ thick; the mortise is 1/16″ shallower so the key can be sanded flush.',
    },
    // ---- Steel legs --------------------------------------------------------
    {
      key: 'steelLegStyle', group: 'Steel legs',
      label: 'Steel legs',
      kind: 'select',
      default: 'u',
      choices: (Object.keys(STEEL_LEG_LABELS) as (keyof typeof STEEL_LEG_LABELS)[]).map((k) => choice(k, STEEL_LEG_LABELS[k])),
      showIf: isLiveEdge,
    },
    {
      key: 'steelTubeSize', group: 'Steel legs',
      label: 'Steel tube size',
      kind: 'length',
      default: 2,
      min: 0.75,
      max: 4,
      showIf: (o) => isLiveEdge(o) && o.steelLegStyle !== 'hairpin',
    },
    {
      key: 'steelLegInset', group: 'Steel legs',
      label: 'Legs in from each end',
      kind: 'length',
      // Dining height: wherever seats the most people comfortably. Lower
      // tables have no chairs, so just a pleasing inset.
      default: (c) =>
        c.dimensions.height >= DINING_HEIGHT
          ? recommendedSeating(seatingLayout(c.dimensions, c.options as unknown as TableOptions)).inset
          : Math.min(12, Math.max(4, Math.round(c.dimensions.length * 0.12))),
      min: 0,
      showIf: isLiveEdge,
      help: 'Measured to the centre of each leg. At dining height the default leaves room for chairs: 26″ per person along the sides and 14″ of knee room at the ends.',
    },
    {
      key: 'steelLegWidth', group: 'Steel legs',
      label: 'Steel leg width',
      kind: 'length',
      default: (c) =>
        defaultSteelLegWidth(
          slabWidthFn(c.dimensions.length, c.dimensions.width, c.options as unknown as TableOptions),
          c.dimensions.length,
          c.options.steelLegInset as number,
        ),
      min: 6,
      showIf: (o) => isLiveEdge(o) && o.steelLegStyle !== 'hairpin',
      help: 'Defaults to 2″ in from each edge at the narrower leg, in an even stock size.',
    },
    // ---- Leg-and-apron base -------------------------------------------------
    {
      key: 'legStyle', group: 'Legs & aprons',
      label: 'Leg style',
      kind: 'select',
      default: 'tapered',
      choices: [choice('straight', 'Straight (square)'), choice('tapered', 'Tapered (inside faces)')],
      showIf: apronBase,
    },
    { key: 'legThickness', group: 'Legs & aprons', label: 'Leg thickness', kind: 'length', default: (c) => (c.dimensions.height < 22 ? 1.5 : 1.75), min: 1, max: 3.5, showIf: apronBase },
    {
      key: 'taperFootSize', group: 'Legs & aprons',
      label: 'Taper: size at foot',
      kind: 'length',
      default: (c) => roundToSixteenth((c.options.legThickness as number) * 0.65),
      showIf: (o) => apronBase(o) && o.legStyle === 'tapered',
      help: 'Square size the leg tapers down to at the floor.',
    },
    { key: 'taperStart', group: 'Legs & aprons', label: 'Taper: start below apron', kind: 'length', default: 1, min: 0, showIf: (o) => apronBase(o) && o.legStyle === 'tapered' },
    {
      key: 'apronInset', group: 'Legs & aprons',
      label: 'Apron inset',
      kind: 'length',
      default: 0.25,
      min: 0,
      showIf: apronBase,
      help: "How far the apron's face is set back from the leg's outer face.",
    },
    { key: 'apronWidth', group: 'Legs & aprons', label: 'Apron width (height)', kind: 'length', default: (c) => (c.dimensions.height >= 26 ? 4 : 3), min: 1.5, showIf: apronBase },
    { key: 'apronThickness', group: 'Legs & aprons', label: 'Apron thickness', kind: 'length', default: 0.75, min: 0.5, max: 1.5, showIf: apronBase },
    {
      key: 'tenonLength', group: 'Legs & aprons',
      label: 'Preferred tenon length',
      kind: 'length',
      default: 1.25,
      min: 0.5,
      showIf: (o, joinery) => apronBase(o) && joinery === 'mortise-tenon',
      help: 'Shortened automatically if adjacent mortises would collide inside the leg.',
    },
    // ---- Board tops ----------------------------------------------------------
    {
      key: 'topThickness', group: 'Top',
      label: 'Top thickness',
      kind: 'length',
      default: (c) => (c.dimensions.length >= 48 ? 1 : 0.75),
      min: 0.5,
      max: 2.5,
      showIf: (o) => !slabTop(o),
    },
    {
      key: 'overhang', group: 'Legs & aprons',
      label: 'Top overhang',
      kind: 'length',
      default: (c) => (c.options.tableStyle === 'round' ? 2 : 1),
      min: 0,
      showIf: apronBase,
      help: 'How far the top reaches past the legs (past the leg corners on a round table).',
    },
    {
      key: 'maxTopBoardWidth', group: 'Top',
      label: 'Max top board width',
      kind: 'length',
      default: 6,
      min: 2,
      showIf: (o) => !slabTop(o),
      help: 'Narrower boards in the glue-up = flatter, more stable top.',
    },
    // ---- Pedestal ----------------------------------------------------------
    {
      key: 'columnSize', group: 'Pedestal',
      label: 'Column size',
      kind: 'select',
      default: (c) => String(defaultColumnSize(c.dimensions.length)),
      choices: [choice('3.5', '3-1/2″ (2 laminations)'), choice('5.25', '5-1/4″ (3 laminations)')],
      showIf: (o) => isRound(o) && o.roundBase === 'pedestal',
    },
    {
      key: 'footSpan', group: 'Pedestal',
      label: 'Foot span',
      kind: 'length',
      default: (c) => defaultFootSpan(c.dimensions.length),
      min: 8,
      showIf: (o) => isRound(o) && o.roundBase === 'pedestal',
      help: 'Tip-to-tip length of each foot. 60–75% of the diameter keeps it from tipping.',
    },
  ],
};
