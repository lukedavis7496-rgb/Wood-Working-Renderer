import type { Hexa, Placement } from './geom';
import type { Unit } from './units';

export type Joinery = 'pocket-screw' | 'mortise-tenon' | 'dowel' | 'dado';
export type Finish = 'stain' | 'oil' | 'paint' | 'raw';

export const JOINERY_LABELS: Record<Joinery, string> = {
  'pocket-screw': 'Pocket screws',
  'mortise-tenon': 'Mortise & tenon',
  dowel: 'Dowels',
  dado: 'Dados',
};

export const FINISH_LABELS: Record<Finish, string> = {
  stain: 'Stain + topcoat',
  oil: 'Oil',
  paint: 'Paint',
  raw: 'Raw / unfinished',
};

/** What the user supplies. Dimensions and length options are in `units`. */
export interface ProjectSpec {
  projectType: string;
  units: Unit;
  /** Overall finished size: length (left–right) × width (depth) × height. */
  dimensions: { length: number; width: number; height: number };
  species: string;
  joinery: Joinery;
  /** Project-type specific options, keyed by the type's option schema. */
  options?: Record<string, unknown>;
  finish?: Finish;
  /** Optional reference sketch/photo (file name or data URL); shown, not interpreted. */
  referenceImage?: string;
  /** Advanced lumber-planning overrides. Kerf is in `units`. */
  stock?: { kerf?: number; overage?: number };
}

/**
 * Option schema entry. Project types declare their conditional inputs with
 * these so normalisation, validation, unit conversion and the UI form are all
 * generic — adding a project type never touches the core.
 */
export type OptionField =
  | (OptionBase & { kind: 'length'; default: number | ((ctx: DefaultCtx) => number); min?: number; max?: number })
  | (OptionBase & { kind: 'number'; default: number | ((ctx: DefaultCtx) => number); min?: number; max?: number; step?: number })
  | (OptionBase & { kind: 'select'; default: string | ((ctx: DefaultCtx) => string); choices: { value: string; label: string }[] })
  | (OptionBase & { kind: 'boolean'; default: boolean | ((ctx: DefaultCtx) => boolean) });

interface OptionBase {
  key: string;
  label: string;
  help?: string;
  /** Show near the top of forms, with the main choices (e.g. a style that changes everything else). */
  prominent?: boolean;
  /** Only show this field in forms when the predicate holds (it still resolves to its default). */
  showIf?: (options: Record<string, unknown>, joinery: Joinery) => boolean;
}

/** Context for computing defaults; lengths in inches. */
export interface DefaultCtx {
  dimensions: { length: number; width: number; height: number };
  joinery: Joinery;
  options: Record<string, unknown>;
}

/** Spec after validation: everything in inches, all options resolved. */
export interface NormalizedSpec {
  projectType: string;
  units: Unit;
  dimensions: { length: number; width: number; height: number };
  species: string;
  joinery: Joinery;
  options: Record<string, number | string | boolean>;
  finish: Finish;
  referenceImage?: string;
  stock: { kerf: number; overage: number };
}

export interface Shape {
  kind: 'body' | 'tenon';
  hexa: Hexa;
}

export interface Cutout {
  kind: 'mortise' | 'dowel-hole' | 'pocket-hole';
  hexa: Hexa;
}

/**
 * One physical piece of wood. Geometry is in the part's local frame
 * (x = length/grain, y = width, z = thickness); `placement` puts it in the
 * world (x = table length, y = up, z = table width/depth).
 *
 * The cut size is DERIVED from the solids' extent — a tenoned apron is cut to
 * its tip-to-tip length because its tenon solids are part of it.
 */
export interface Part {
  id: string;
  role: string;
  name: string;
  species: string;
  solids: Shape[];
  cutouts: Cutout[];
  placement: Placement;
  /** Extra size at cut time beyond the finished geometry (e.g. glue-up boards). */
  allowance?: { length: number; width: number; reason: string };
  /** Shaping/machining notes that don't change the blank size (tapers, mortises). */
  notes: string[];
  /** Bought steel parts are shown in the model but aren't cut or planned as lumber. */
  material?: 'wood' | 'steel';
  /** 'owned': material the maker already has (e.g. their slab) — not on the lumber list. */
  sourcing?: 'owned';
}

export interface Joint {
  kind: Joinery | 'fastener';
  parts: [string, string];
  description: string;
}

export interface HardwareItem {
  item: string;
  quantity: number;
  note?: string;
  /** Rough price each, USD, for items worth costing (e.g. steel legs). */
  unitCost?: number;
}

/** A glue-up or sub-assembly that isn't a single cut piece (e.g. a tabletop panel). */
export interface Assembly {
  name: string;
  partIds: string[];
  finishedSize: { thickness: number; width: number; length: number };
  note: string;
}

export interface Model {
  spec: NormalizedSpec;
  parts: Part[];
  joints: Joint[];
  assemblies: Assembly[];
  hardware: HardwareItem[];
  assemblySteps: string[];
  warnings: string[];
}

export interface ProjectType {
  id: string;
  label: string;
  supportedJoinery: Joinery[];
  /** Typical sizes, for UI hints and defaults (inches). */
  defaultDimensions: { length: number; width: number; height: number };
  options: OptionField[];
  /**
   * Labels for the overall dimensions given the resolved options. A null
   * width means the shape has one plan dimension (e.g. a round top's
   * diameter); width is then set equal to length.
   */
  dimensionLabels?: (options: Record<string, unknown>) => { length: string; width: string | null; height: string };
  /** False when the joinery choice doesn't apply to these options (e.g. bought steel legs). */
  joineryApplies?: (options: Record<string, unknown>) => boolean;
  /** Extra validation beyond the schema; return error messages. Lengths in inches. */
  validate?: (spec: NormalizedSpec) => string[];
  build: (spec: NormalizedSpec) => Model;
}
