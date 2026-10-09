import { DEFAULT_KERF_IN, optionVisible } from '../core/spec';
import { SPECIES } from '../core/species';
import type { Finish, Joinery, OptionField } from '../core/types';
import { FINISH_LABELS, JOINERY_LABELS } from '../core/types';
import { formatLength, parseLengthList } from '../core/units';
import type { ProjectPlan } from '../output/plan';
import { PLANNED_TYPES, PROJECT_TYPES, getProjectType } from '../projects/registry';
import type { Store } from './state';
import { currentDesign, inputLength } from './state';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Choice = { value: string; label: string; disabled?: boolean };

const idFor = (name: string) => `f-${name.replace(/[^a-z0-9]+/gi, '-')}`;

function selectHtml(name: string, value: string, choices: Choice[], disabled = false): string {
  return `<select id="${idFor(name)}" name="${name}"${disabled ? ' disabled' : ''}>${choices
    .map((c) => `<option value="${esc(c.value)}"${c.value === value ? ' selected' : ''}${c.disabled ? ' disabled' : ''}>${esc(c.label)}</option>`)
    .join('')}</select>`;
}

/** A text box for lengths: accepts fractions like 1-3/4, so not type="number". */
function lengthInput(name: string, value: string, placeholder = '', wide = false): string {
  return `<input id="${idFor(name)}" name="${name}" type="text" inputmode="text" autocomplete="off" spellcheck="false"${wide ? ' class="wide"' : ''} value="${esc(value)}" placeholder="${esc(placeholder)}">`;
}

function field(name: string, label: string, control: string, help?: string): string {
  return `<div class="field"><label for="${idFor(name)}">${esc(label)}</label>${control}${help ? `<small>${esc(help)}</small>` : ''}</div>`;
}

/** The recommended value for an option, shown greyed out until you type your own. */
function placeholderFor(f: OptionField, plan: ProjectPlan | null, unit: 'in' | 'mm'): string {
  const v = plan?.model.spec.options[f.key];
  if (f.kind === 'lengthList') return f.placeholder ?? '';
  if (typeof v !== 'number') return '';
  return `auto: ${f.kind === 'length' ? formatLength(v, unit).replace('″', '') : v}`;
}

export function renderForm(root: HTMLElement, store: Store, plan: ProjectPlan | null): void {
  const design = currentDesign(store);
  const state = design.state;
  const type = getProjectType(state.projectType);
  const unit = state.units;
  const unitLabel = unit === 'mm' ? 'mm' : 'in';
  const resolved = (plan?.model.spec.options ?? {}) as Record<string, unknown>;
  // What the user typed wins over the last build (which may be stale or have
  // failed); lists are parsed so predicates see measurements, not text.
  const typed = Object.fromEntries(
    Object.entries(state.options)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => [k, type.options.find((f) => f.key === k)?.kind === 'lengthList' ? (parseLengthList(v) ?? []) : v]),
  );
  const merged = { ...resolved, ...typed };

  const optionField = (f: OptionField): string => {
    const name = `opt:${f.key}`;
    const v = state.options[f.key] ?? '';
    if (f.kind === 'select') {
      const def = typeof resolved[f.key] === 'string' ? String(resolved[f.key]) : '';
      return field(name, f.label, selectHtml(name, v || def, f.choices), f.help);
    }
    if (f.kind === 'boolean') {
      return field(name, f.label, `<input id="${idFor(name)}" type="checkbox" name="${name}"${v === 'true' ? ' checked' : ''}>`, f.help);
    }
    if (f.kind === 'number') {
      return field(name, f.label, `<input id="${idFor(name)}" type="number" step="any" name="${name}" value="${esc(v)}" placeholder="${esc(placeholderFor(f, plan, unit))}">`, f.help);
    }
    return field(name, `${f.label} (${unitLabel})`, lengthInput(name, v, placeholderFor(f, plan, unit), f.kind === 'lengthList'), f.help);
  };

  const visible = type.options.filter((f) => optionVisible(f, merged, state.joinery));
  const prominent = visible.filter((f) => f.prominent).map(optionField).join('');
  // Sections in the order their first field appears in the schema.
  const sections = new Map<string, string[]>();
  for (const f of visible.filter((f) => !f.prominent)) {
    const g = f.group ?? `${type.label} details`;
    if (!sections.has(g)) sections.set(g, []);
    sections.get(g)!.push(optionField(f));
  }
  const labels = type.dimensionLabels?.(merged) ?? { length: 'Length', width: 'Width', height: 'Height' };
  const joineryApplies = type.joineryApplies?.(merged) ?? true;

  const typeChoices: Choice[] = [
    ...Object.values(PROJECT_TYPES).map((t) => ({ value: t.id, label: t.label })),
    ...PLANNED_TYPES.map((t) => ({ value: `planned:${t}`, label: `${t} (coming soon)`, disabled: true })),
  ];
  const joineryChoices: Choice[] = (Object.keys(JOINERY_LABELS) as Joinery[]).map((j) => ({
    value: j,
    label: type.supportedJoinery.includes(j) ? JOINERY_LABELS[j] : `${JOINERY_LABELS[j]} (n/a for ${type.label.toLowerCase()})`,
    disabled: !type.supportedJoinery.includes(j),
  }));
  const designChoices: Choice[] = [
    ...store.designs.map((d) => ({ value: d.id, label: d.name || 'Untitled' })),
    { value: '__new', label: '+ New design' },
  ];
  const derivedWidth = labels.width === null && plan ? inputLength(plan.model.spec.dimensions.width, unit) : null;

  root.innerHTML = `
    <fieldset class="design-bar">
      <legend>Design</legend>
      ${field('design', 'Open design', selectHtml('design', design.id, designChoices))}
      ${field('designName', 'Name', `<input id="${idFor('designName')}" name="designName" type="text" value="${esc(design.name)}" maxlength="60">`)}
      <div class="design-actions">
        <button type="button" data-action="duplicate">Duplicate</button>
        <button type="button" data-action="delete"${store.designs.length < 2 ? ' disabled title="Your only design"' : ''}>Delete</button>
      </div>
    </fieldset>
    <fieldset>
      <legend>Project</legend>
      ${field('projectType', 'Project type', selectHtml('projectType', state.projectType, typeChoices))}
      ${prominent}
      ${field('units', 'Units', selectHtml('units', unit, [{ value: 'in', label: 'Inches (fractions OK: 1-3/4)' }, { value: 'mm', label: 'Millimetres' }]))}
      <div class="dims${labels.width === null ? ' two' : ''}">
        ${field('length', `${labels.length} (${unitLabel})`, lengthInput('length', state.length))}
        ${labels.width === null ? '' : field('width', `${labels.width} (${unitLabel})`, lengthInput('width', state.width))}
        ${field('height', `${labels.height} (${unitLabel})`, lengthInput('height', state.height))}
      </div>
      ${derivedWidth && state.options.tableStyle === 'live-edge' ? `<p class="hint">Widest measurement: ${esc(derivedWidth)} ${unitLabel}.</p>` : ''}
      ${field('species', 'Wood species', selectHtml('species', state.species, Object.values(SPECIES).map((s) => ({ value: s.id, label: s.name }))))}
      ${
        joineryApplies
          ? field('joinery', 'Joinery', selectHtml('joinery', state.joinery, joineryChoices))
          : field('joinery', 'Joinery', selectHtml('joinery', '', [{ value: '', label: 'Not needed for this base' }], true), 'The base is screwed together and to the top.')
      }
    </fieldset>
    ${[...sections]
      .map(
        ([title, fields], i) => `<fieldset>
      <legend>${esc(title)}</legend>
      ${i === 0 ? '<p class="hint">Leave a box blank to use the recommended value shown in it.</p>' : ''}
      ${fields.join('')}
    </fieldset>`,
      )
      .join('')}
    <fieldset>
      <legend>Finish &amp; reference</legend>
      ${field('finish', 'Finish', selectHtml('finish', state.finish, (Object.keys(FINISH_LABELS) as Finish[]).map((f) => ({ value: f, label: FINISH_LABELS[f] }))))}
      ${field('reference', 'Reference sketch or photo', `<input id="${idFor('reference')}" type="file" name="reference" accept="image/*">`, 'Shown here for comparison; not saved.')}
      <img id="reference-preview" alt="Your reference image" hidden>
    </fieldset>
    <details>
      <summary>Lumber planning</summary>
      ${field('kerf', `Saw kerf (${unitLabel})`, lengthInput('kerf', state.kerf, `auto: ${formatLength(DEFAULT_KERF_IN, unit).replace('″', '')}`))}
      ${field('overage', 'Overage for defects (%)', `<input id="${idFor('overage')}" type="number" min="0" max="100" step="1" name="overage" value="${esc(state.overage)}">`, 'Added on top of kerf and trim waste. 15–20% is typical.')}
    </details>`;
}
