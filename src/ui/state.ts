import type { Finish, Joinery, ProjectSpec } from '../core/types';
import { formatInches, fromInches, parseLength, parseLengthList, toInches, type Unit } from '../core/units';
import { getProjectType } from '../projects/registry';

/**
 * Everything the page remembers lives here: the designs you've saved (each
 * with its form inputs and shop checklist) and which one is open. It's kept
 * in this browser's storage only.
 */

/** Form inputs exactly as typed; empty option strings mean "use the recommended value". */
export interface FormState {
  projectType: string;
  units: Unit;
  length: string;
  width: string;
  height: string;
  species: string;
  joinery: Joinery;
  finish: Finish;
  options: Record<string, string>;
  kerf: string;
  overage: string;
}

export interface Design {
  id: string;
  name: string;
  state: FormState;
  /**
   * Shop checklist. Keyed by what was done, not by position, so ticks stay
   * on the right part when letters shift, and drop off when a part's size
   * or an assembly step changes: cut-list rows by name + size + quantity,
   * steps by their text.
   */
  checks: { cut: string[]; steps: string[] };
  updated: number;
}

export interface Store {
  designs: Design[];
  currentId: string;
}

const STORE_KEY = 'wwr-designs-v1';
const LEGACY_KEY = 'wwr-spec-v1';

export function defaultState(): FormState {
  const t = getProjectType('table');
  return {
    projectType: t.id,
    units: 'in',
    length: String(t.defaultDimensions.length),
    width: String(t.defaultDimensions.width),
    height: String(t.defaultDimensions.height),
    species: 'red-oak',
    joinery: 'mortise-tenon',
    finish: 'oil',
    options: {},
    kerf: '',
    overage: '15',
  };
}

const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newDesign(name: string, state: FormState = defaultState()): Design {
  return { id: newId(), name, state, checks: { cut: [], steps: [] }, updated: Date.now() };
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const store = JSON.parse(raw) as Store;
      if (store.designs?.length) {
        for (const d of store.designs) {
          d.state = { ...defaultState(), ...d.state };
          // Earlier ticks were stored by position; they can't be trusted.
          d.checks = {
            cut: (d.checks?.cut ?? []).filter((k) => typeof k === 'string' && k.includes('|')),
            steps: (d.checks?.steps ?? []).filter((k): k is string => typeof k === 'string'),
          };
        }
        if (!store.designs.some((d) => d.id === store.currentId)) store.currentId = store.designs[0].id;
        return store;
      }
    }
    // Carry over the single design saved by the first version of the page.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const d = newDesign('My table', { ...defaultState(), ...JSON.parse(legacy) });
      return { designs: [d], currentId: d.id };
    }
  } catch {
    /* storage unavailable or unreadable: start fresh */
  }
  const d = newDesign('My table');
  return { designs: [d], currentId: d.id };
}

export function saveStore(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable: the page still works, it just won't remember */
  }
}

export function currentDesign(store: Store): Design {
  return store.designs.find((d) => d.id === store.currentId) ?? store.designs[0];
}

/** Turn the form into a spec, plus messages for anything that isn't a readable length. */
export function toSpec(s: FormState, referenceImage?: string, widthShown = true): { spec: ProjectSpec; inputErrors: string[] } {
  const inputErrors: string[] = [];
  const len = (label: string, v: string) => {
    const n = parseLength(v);
    if (n === null) inputErrors.push(`${label}: enter a length like ${s.units === 'mm' ? '760' : '30 or 29-1/2'}.`);
    return n ?? NaN;
  };
  const options: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.options)) if (v !== '') options[k] = v;
  const kerf = s.kerf !== '' ? len('Saw kerf', s.kerf) : undefined;
  return {
    spec: {
      projectType: s.projectType,
      units: s.units,
      // A hidden width (round tables, measured slabs) is derived from other
      // inputs, so a stale value in it mustn't block the build.
      dimensions: {
        length: len('Length', s.length),
        width: widthShown ? len('Width', s.width) : (parseLength(s.width) ?? parseLength(s.length) ?? 1),
        height: len('Height', s.height),
      },
      species: s.species,
      joinery: s.joinery,
      finish: s.finish,
      options,
      referenceImage,
      stock: {
        ...(kerf !== undefined ? { kerf } : {}),
        ...(s.overage !== '' ? { overage: Number(s.overage) / 100 } : {}),
      },
    },
    inputErrors,
  };
}

/** A length as it would be typed back into the form: "29-1/4" or "743". */
export function inputLength(inches: number, unit: Unit): string {
  return unit === 'mm' ? String(Math.round(fromInches(inches, unit))) : formatInches(inches).replace('″', '');
}

/** Re-express every typed length in the new unit so the design doesn't change size. */
export function convertUnits(s: FormState, from: Unit, to: Unit): void {
  const conv = (v: string) => {
    const n = parseLength(v);
    return n === null ? v : inputLength(toInches(n, from), to);
  };
  const convList = (v: string) => {
    const list = parseLengthList(v);
    return list ? list.map((n) => inputLength(toInches(n, from), to)).join(', ') : v;
  };
  s.length = conv(s.length);
  s.width = conv(s.width);
  s.height = conv(s.height);
  if (s.kerf) s.kerf = conv(s.kerf);
  for (const f of getProjectType(s.projectType).options) {
    const v = s.options[f.key];
    if (!v) continue;
    if (f.kind === 'length') s.options[f.key] = conv(v);
    if (f.kind === 'lengthList') s.options[f.key] = convList(v);
  }
}
