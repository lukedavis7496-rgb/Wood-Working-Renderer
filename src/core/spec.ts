import { SPECIES } from './species';
import type { DefaultCtx, Finish, Joinery, NormalizedSpec, OptionField, OptionValue, ProjectSpec, ProjectType } from './types';
import { FINISH_LABELS, JOINERY_LABELS } from './types';
import { formatLength, parseLength, parseLengthList, toInches, type Unit } from './units';

export class SpecError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid project spec:\n  - ${problems.join('\n  - ')}`);
    this.name = 'SpecError';
  }
}

export const DEFAULT_KERF_IN = 1 / 8;
/** Extra lumber for defects, grain matching and mistakes, on top of kerf/trim. */
export const DEFAULT_OVERAGE = 0.15;

function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function resolveDefault<T>(d: T | ((ctx: DefaultCtx) => T), ctx: DefaultCtx): T {
  return typeof d === 'function' ? (d as (ctx: DefaultCtx) => T)(ctx) : d;
}

/** Whether a form should show an option, given the other options and joinery. */
export function optionVisible(field: OptionField, options: Record<string, unknown>, joinery: Joinery): boolean {
  return !field.showIf || field.showIf(options, joinery);
}

/**
 * Resolve a project type's options: user values (converted to inches for
 * 'length' fields) or schema defaults. Fields are resolved in schema order,
 * so a default may depend on earlier fields.
 */
export function resolveOptions(
  type: ProjectType,
  raw: Record<string, unknown>,
  units: Unit,
  base: Omit<DefaultCtx, 'options'>,
  problems: string[],
  warnings: string[],
): Record<string, OptionValue> {
  const out: Record<string, OptionValue> = {};
  const fmtMin = (field: OptionField, v: number) => (field.kind === 'length' ? formatLength(v, units) : String(v));
  const known = new Set(type.options.map((f) => f.key));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) warnings.push(`Unknown ${type.label.toLowerCase()} option "${key}" ignored.`);
  }
  for (const field of type.options) {
    const ctx: DefaultCtx = { ...base, options: out };
    const given = raw[field.key];
    let value: OptionValue;
    if (given === undefined || given === null || given === '' || (Array.isArray(given) && !given.length)) {
      value = resolveDefault<OptionValue>(field.default as OptionValue | ((c: DefaultCtx) => OptionValue), ctx);
    } else if (field.kind === 'lengthList') {
      const list = parseLengthList(given as string | number[]);
      if (!list || list.some((n) => n <= 0)) {
        problems.push(`${field.label}: enter lengths separated by commas, like 40, 38-1/2, 36.`);
        continue;
      }
      if (field.minCount && list.length < field.minCount) {
        problems.push(`${field.label}: enter at least ${field.minCount} measurements.`);
        continue;
      }
      value = list.map((n) => toInches(n, units));
    } else if (field.kind === 'length' || field.kind === 'number') {
      const n = field.kind === 'length' ? parseLength(given as string | number) : typeof given === 'string' ? Number(given) : given;
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        problems.push(`${field.label} must be ${field.kind === 'length' ? 'a length, like 1-3/4 or 1.75' : 'a number'}.`);
        continue;
      }
      value = field.kind === 'length' ? toInches(n, units) : n;
    } else if (field.kind === 'select') {
      if (!field.choices.some((c) => c.value === given)) {
        problems.push(`${field.label} must be one of: ${field.choices.map((c) => c.value).join(', ')}.`);
        continue;
      }
      value = given as string;
    } else {
      value = given === true || given === 'true';
    }
    if ((field.kind === 'length' || field.kind === 'number') && typeof value === 'number') {
      if (field.min !== undefined && value < field.min - 1e-9) problems.push(`${field.label} must be at least ${fmtMin(field, field.min)}.`);
      if (field.max !== undefined && value > field.max + 1e-9) problems.push(`${field.label} can be at most ${fmtMin(field, field.max)}.`);
    }
    out[field.key] = value;
  }
  return out;
}

export function normalizeSpec(spec: ProjectSpec, type: ProjectType): { spec: NormalizedSpec; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];

  const units: Unit = spec.units === 'mm' ? 'mm' : 'in';
  if (spec.units !== 'in' && spec.units !== 'mm') problems.push('units must be "in" or "mm".');

  const d = spec.dimensions ?? ({} as ProjectSpec['dimensions']);
  for (const k of ['length', 'width', 'height'] as const) {
    if (!isPositive(d[k])) problems.push(`dimensions.${k} must be a positive number.`);
  }
  if (!Object.hasOwn(SPECIES, spec.species)) problems.push(`Unknown species "${spec.species}". Known: ${Object.keys(SPECIES).join(', ')}.`);

  const joinery = spec.joinery;
  if (!Object.hasOwn(JOINERY_LABELS, joinery)) {
    problems.push(`joinery must be one of: ${Object.keys(JOINERY_LABELS).join(', ')}.`);
  } else if (!type.supportedJoinery.includes(joinery)) {
    problems.push(
      `${JOINERY_LABELS[joinery]} isn't supported for a ${type.label.toLowerCase()}. ` +
        `Choose: ${type.supportedJoinery.map((j) => JOINERY_LABELS[j]).join(', ')}.`,
    );
  }

  const finish: Finish = spec.finish ?? 'oil';
  if (!Object.hasOwn(FINISH_LABELS, finish)) problems.push(`finish must be one of: ${Object.keys(FINISH_LABELS).join(', ')}.`);

  if (problems.length) throw new SpecError(problems);

  const dimensions = {
    length: toInches(d.length, units),
    width: toInches(d.width, units),
    height: toInches(d.height, units),
  };
  let options = resolveOptions(type, spec.options ?? {}, units, { dimensions, joinery: joinery as Joinery }, problems, warnings);
  // Some options decide the overall size (a round top's diameter, a measured
  // slab's widest point). Apply that, then re-resolve defaults that depend on it.
  if (type.deriveDimensions && !problems.length) {
    const derived = type.deriveDimensions({ ...dimensions }, options);
    if (derived.length !== dimensions.length || derived.width !== dimensions.width || derived.height !== dimensions.height) {
      Object.assign(dimensions, derived);
      options = resolveOptions(type, spec.options ?? {}, units, { dimensions, joinery: joinery as Joinery }, problems, []);
    }
  }

  const kerf = spec.stock?.kerf !== undefined ? toInches(spec.stock.kerf, units) : DEFAULT_KERF_IN;
  const overage = spec.stock?.overage ?? DEFAULT_OVERAGE;
  if (!(kerf >= 0 && kerf < 0.5)) problems.push('stock.kerf must be between 0 and 1/2″.');
  if (!(overage >= 0 && overage <= 1)) problems.push('stock.overage must be a fraction between 0 and 1 (e.g. 0.15).');

  const normalized: NormalizedSpec = {
    projectType: type.id,
    units,
    dimensions,
    species: spec.species,
    joinery: joinery as Joinery,
    options,
    finish,
    referenceImage: spec.referenceImage,
    stock: { kerf, overage },
  };
  if (!problems.length && type.validate) problems.push(...type.validate(normalized));
  if (problems.length) throw new SpecError(problems);
  return { spec: normalized, warnings };
}
