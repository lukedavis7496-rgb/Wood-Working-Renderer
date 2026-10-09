import { normalizeSpec } from '../core/spec';
import type { Model, ProjectSpec, ProjectType } from '../core/types';
import { bookshelf } from './bookshelf/index';
import { table } from './table/index';

/**
 * Register new project types here. Each one supplies its option schema,
 * supported joinery, validation and a `build` that returns parts as solids;
 * the cut list, lumber plan, cost and renderer are shared.
 */
export const PROJECT_TYPES: Record<string, ProjectType> = {
  [table.id]: table,
  [bookshelf.id]: bookshelf,
};

/** Types on the roadmap, listed so the UI can show what's coming. */
export const PLANNED_TYPES = ['Cabinet', 'Bench'];

export function getProjectType(id: string): ProjectType {
  const t = PROJECT_TYPES[id];
  if (!t) {
    throw new Error(`Project type "${id}" isn't supported yet. Available: ${Object.keys(PROJECT_TYPES).join(', ')}.`);
  }
  return t;
}

export function buildModel(spec: ProjectSpec): Model {
  const type = getProjectType(spec.projectType);
  const { spec: normalized, warnings } = normalizeSpec(spec, type);
  const model = type.build(normalized);
  model.warnings.unshift(...warnings);
  return model;
}
