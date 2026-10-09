import './style.css';
import { optionVisible, SpecError } from '../core/spec';
import { SPECIES } from '../core/species';
import type { Finish, Joinery, OptionField, ProjectSpec } from '../core/types';
import { FINISH_LABELS, JOINERY_LABELS } from '../core/types';
import { formatBoardLength, formatDims, formatLength, fromInches, toInches, type Unit } from '../core/units';
import { cutSize } from '../output/cutList';
import { boardsBySize, formatBoardWidth, plan, type ProjectPlan } from '../output/plan';
import { PLANNED_TYPES, PROJECT_TYPES, getProjectType } from '../projects/registry';
import { Viewer } from './viewer';

const STORAGE_KEY = 'wwr-spec-v1';
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Form state mirrors ProjectSpec; empty option strings mean "use the recommended default". */
interface FormState {
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

function defaultState(): FormState {
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

function loadState(): FormState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: fall back to defaults */
  }
  return defaultState();
}

function saveState(s: FormState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

let state = loadState();
let referenceImage: string | undefined;
let current: ProjectPlan | null = null;

function toSpec(s: FormState): ProjectSpec {
  const options: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.options)) if (v !== '') options[k] = v;
  return {
    projectType: s.projectType,
    units: s.units,
    dimensions: { length: Number(s.length), width: Number(s.width), height: Number(s.height) },
    species: s.species,
    joinery: s.joinery,
    finish: s.finish,
    options,
    referenceImage,
    stock: {
      ...(s.kerf !== '' ? { kerf: Number(s.kerf) } : {}),
      ...(s.overage !== '' ? { overage: Number(s.overage) / 100 } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function selectHtml(name: string, value: string, choices: { value: string; label: string; disabled?: boolean }[]): string {
  return `<select name="${name}">${choices
    .map((c) => `<option value="${esc(c.value)}"${c.value === value ? ' selected' : ''}${c.disabled ? ' disabled' : ''}>${esc(c.label)}</option>`)
    .join('')}</select>`;
}

function field(label: string, control: string, help?: string): string {
  return `<label class="field"><span>${esc(label)}</span>${control}${help ? `<small>${esc(help)}</small>` : ''}</label>`;
}

/** Recommended default for an option, shown as the input placeholder. */
function optionPlaceholder(f: OptionField): string {
  const resolved = current?.model.spec.options[f.key];
  if (resolved === undefined || typeof resolved !== 'number') return '';
  return f.kind === 'length' ? `auto: ${formatLength(resolved, state.units)}` : `auto: ${resolved}`;
}

function renderForm(): void {
  const type = getProjectType(state.projectType);
  const unitLabel = state.units === 'mm' ? 'mm' : 'in';
  const resolved = (current?.model.spec.options ?? {}) as Record<string, unknown>;
  const merged = { ...resolved, ...nonEmpty(state.options) };
  const optionField = (f: OptionField) => {
      const v = state.options[f.key] ?? '';
      if (f.kind === 'select') {
        const def = typeof resolved[f.key] === 'string' ? resolved[f.key] : '';
        return field(f.label, selectHtml(`opt:${f.key}`, v || String(def), f.choices), f.help);
      }
      if (f.kind === 'boolean') {
        return field(f.label, `<input type="checkbox" name="opt:${f.key}"${v === 'true' ? ' checked' : ''}>`, f.help);
      }
      const step = f.kind === 'length' ? (state.units === 'mm' ? '1' : '0.0625') : 'any';
      return field(
        `${f.label}${f.kind === 'length' ? ` (${unitLabel})` : ''}`,
        `<input type="number" step="${step}" min="0" name="opt:${f.key}" value="${esc(v)}" placeholder="${esc(optionPlaceholder(f))}">`,
        f.help,
      );
  };
  const visible = type.options.filter((f) => optionVisible(f, merged, state.joinery));
  const prominent = visible.filter((f) => f.prominent).map(optionField).join('');
  const opts = visible.filter((f) => !f.prominent).map(optionField).join('');
  const labels = type.dimensionLabels?.(merged) ?? { length: 'Length', width: 'Width', height: 'Height' };
  const joineryApplies = type.joineryApplies?.(merged) ?? true;

  const typeChoices = [
    ...Object.values(PROJECT_TYPES).map((t) => ({ value: t.id, label: t.label })),
    ...PLANNED_TYPES.map((t) => ({ value: `planned:${t}`, label: `${t} (coming soon)`, disabled: true })),
  ];
  const joineryChoices = (Object.keys(JOINERY_LABELS) as Joinery[]).map((j) => ({
    value: j,
    label: type.supportedJoinery.includes(j) ? JOINERY_LABELS[j] : `${JOINERY_LABELS[j]} (n/a for ${type.label.toLowerCase()})`,
    disabled: !type.supportedJoinery.includes(j),
  }));

  $('#form').innerHTML = `
    <fieldset>
      <legend>Project</legend>
      ${field('Project type', selectHtml('projectType', state.projectType, typeChoices))}
      ${prominent}
      ${field('Units', selectHtml('units', state.units, [{ value: 'in', label: 'Inches' }, { value: 'mm', label: 'Millimetres' }]))}
      <div class="dims${labels.width === null ? ' two' : ''}">
        ${field(`${labels.length} (${unitLabel})`, `<input type="number" min="0" step="any" name="length" value="${esc(state.length)}">`)}
        ${labels.width === null ? '' : field(`${labels.width} (${unitLabel})`, `<input type="number" min="0" step="any" name="width" value="${esc(state.width)}">`)}
        ${field(`${labels.height} (${unitLabel})`, `<input type="number" min="0" step="any" name="height" value="${esc(state.height)}">`)}
      </div>
      ${field('Wood species', selectHtml('species', state.species, Object.values(SPECIES).map((s) => ({ value: s.id, label: s.name }))))}
      ${
        joineryApplies
          ? field('Joinery', selectHtml('joinery', state.joinery, joineryChoices))
          : field('Joinery', '<select name="joinery" disabled><option>Not needed for this base</option></select>', 'The base is screwed together and to the top.')
      }
    </fieldset>
    <fieldset>
      <legend>${esc(type.label)} details</legend>
      <p class="hint">Leave blank to use the recommended value.</p>
      ${opts}
    </fieldset>
    <fieldset>
      <legend>Finish &amp; reference</legend>
      ${field('Finish', selectHtml('finish', state.finish, (Object.keys(FINISH_LABELS) as Finish[]).map((f) => ({ value: f, label: FINISH_LABELS[f] }))))}
      ${field('Reference sketch or photo', '<input type="file" name="reference" accept="image/*">', 'Shown next to the model for comparison.')}
      <img id="reference-preview" alt="Reference" ${referenceImage ? `src="${referenceImage}"` : 'hidden'}>
    </fieldset>
    <details>
      <summary>Lumber planning</summary>
      ${field(`Saw kerf (${unitLabel})`, `<input type="number" min="0" step="any" name="kerf" value="${esc(state.kerf)}" placeholder="auto: ${esc(formatLength(1 / 8, state.units))}">`)}
      ${field('Overage for defects (%)', `<input type="number" min="0" max="100" step="1" name="overage" value="${esc(state.overage)}">`, 'Added on top of kerf and trim waste. 15–20% is typical.')}
    </details>`;
}

function nonEmpty(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
}

/** Convert user-entered lengths when switching units, so the table doesn't change size. */
function convertUnits(from: Unit, to: Unit): void {
  const conv = (v: string) => {
    if (v === '' || !Number.isFinite(Number(v))) return v;
    const x = fromInches(toInches(Number(v), from), to);
    return String(to === 'mm' ? Math.round(x) : Math.round(x * 16) / 16);
  };
  state.length = conv(state.length);
  state.width = conv(state.width);
  state.height = conv(state.height);
  state.kerf = conv(state.kerf);
  const type = getProjectType(state.projectType);
  for (const f of type.options) if (f.kind === 'length' && state.options[f.key]) state.options[f.key] = conv(state.options[f.key]);
}

function onFormChange(e: Event): void {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const name = el.name;
  if (!name) return;
  if (name === 'reference') {
    const file = (el as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        referenceImage = String(reader.result);
        const img = $('#reference-preview') as HTMLImageElement;
        img.src = referenceImage;
        img.hidden = false;
      };
      reader.readAsDataURL(file);
    }
    return;
  }
  const value = el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : el.value;
  if (name.startsWith('opt:')) state.options[name.slice(4)] = value;
  else if (name === 'units') {
    convertUnits(state.units, value as Unit);
    state.units = value as Unit;
  } else (state as unknown as Record<string, string>)[name] = value;

  update(e.type === 'change');
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const viewer = new Viewer($('#viewer'), $('#tooltip'), (part) => {
  const letter = current?.letters[part.id];
  if (part.material === 'steel') return part.name;
  const s = cutSize(part);
  return `${letter ? `${letter} · ` : ''}${part.name} · ${formatDims(s.thickness, s.width, s.length, current?.model.spec.units ?? 'in')}`;
});

/** Cut list row letter currently picked (highlighted in the model). */
let pickedLetter: string | null = null;

function pickLetter(letter: string | null): void {
  pickedLetter = letter === pickedLetter ? null : letter;
  const row = current?.cutList.find((r) => r.letter === pickedLetter);
  viewer.setSelected(row?.ids ?? []);
  document.querySelectorAll<HTMLElement>('[data-letter]').forEach((el) => el.classList.toggle('picked', el.dataset.letter === pickedLetter));
}

viewer.onPick = (partId) => {
  const letter = partId ? (current?.letters[partId] ?? null) : null;
  pickLetter(letter ?? pickedLetter);
  if (letter) document.querySelector(`#tab-cut [data-letter="${letter}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};
viewer.onHover = (partId) => {
  const letter = partId ? current?.letters[partId] : undefined;
  document.querySelectorAll<HTMLElement>('#tab-cut [data-letter]').forEach((el) => el.classList.toggle('hovered', el.dataset.letter === letter));
};

function renderOutputs(p: ProjectPlan): void {
  const u = p.model.spec.units;
  const t = p.lumber.totals;
  const woodPieces = p.cutList.reduce((n, r) => n + r.quantity, 0);
  const owned = p.cutList.some((r) => r.owned);

  $('#summary').innerHTML = `
    <div class="stat"><span>Lumber to buy</span><strong>${p.lumber.groups.length ? `~${t.recommendedBoardFeet.toFixed(1)} bd ft` : 'None'}</strong>${owned ? '<small>plus your slab</small>' : ''}</div>
    <div class="stat"><span>Est. cost</span><strong>~$${Math.round(p.totalCost)}</strong>${p.hardwareCost ? `<small>incl. ~$${Math.round(p.hardwareCost)} steel legs</small>` : ''}</div>
    <div class="stat"><span>Wood pieces</span><strong>${woodPieces}</strong><small>${p.cutList.length} different</small></div>
    <div class="stat"><span>Finished weight</span><strong>~${Math.round(p.weightLb)} lb</strong></div>
    ${
      p.model.movement
        ? `<div class="stat"><span>Seasonal movement</span><strong>~${formatLength(p.model.movement.amount, u)}</strong><small>across the ${formatLength(p.model.movement.width, u)} top</small></div>`
        : ''
    }`;

  $('#warnings').innerHTML = p.model.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  $('#warnings').hidden = !p.model.warnings.length;

  $('#tab-cut').innerHTML = `
    <p class="hint">Tap a row to find those parts in the model; tap a part in the model to find its row.</p>
    <table class="cut-list">
      <thead><tr><th>Part</th><th>Qty</th><th>Name</th><th>Thickness</th><th>Width</th><th>Length</th><th>Notes</th></tr></thead>
      <tbody>${p.cutList
        .map(
          (r) => `<tr data-letter="${r.letter}" tabindex="0">
            <td><span class="key">${r.letter}</span></td>
            <td class="num">${r.quantity}</td>
            <td>${esc(r.name)}${r.owned ? ' <span class="chip">yours</span>' : ''}</td>
            <td class="num">${formatLength(r.size.thickness, u)}</td>
            <td class="num">${formatLength(r.size.width, u)}</td>
            <td class="num">${formatLength(r.size.length, u)}</td>
            <td class="notes">${[r.allowanceReason ? `<em>${esc(r.allowanceReason)}</em>` : '', ...r.notes.map(esc)].filter(Boolean).join('<br>')}</td>
          </tr>`,
        )
        .join('')}</tbody>
    </table>
    ${p.model.assemblies
      .map((a) => `<p class="assembly"><strong>${esc(a.name)}</strong> — ${formatDims(a.finishedSize.thickness, a.finishedSize.width, a.finishedSize.length, u)}. ${esc(a.note)}</p>`)
      .join('')}`;
  $('#tab-cut').querySelectorAll<HTMLElement>('tr[data-letter]').forEach((tr) => {
    const pick = () => pickLetter(tr.dataset.letter!);
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
  });

  $('#tab-shopping').innerHTML = `
    <ul class="shopping">${p.shoppingList.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    ${
      p.lumber.groups.length
        ? `<table class="compact">
      <thead><tr><th>Stock</th><th>Boards</th><th>In parts</th><th>With kerf &amp; trim</th><th>To buy (+${Math.round(p.lumber.settings.overage * 100)}%)</th><th>Est. cost</th></tr></thead>
      <tbody>${p.lumber.groups
        .map(
          (g) => `<tr><td>${esc(g.stock.label)} ${esc(SPECIES[g.species].name)}</td><td class="num">${boardsBySize(g)
            .map(({ count, size }) => `${count} × ${formatBoardWidth(size.width, u)} × ${formatBoardLength(size.length, u)}`)
            .join('<br>')}</td>
          <td class="num">${g.boardFeet.net.toFixed(1)}</td><td class="num">${g.boardFeet.packed.toFixed(1)}</td><td class="num">${g.boardFeet.recommended.toFixed(1)}</td><td class="num">$${Math.round(g.cost)}</td></tr>`,
        )
        .join('')}
        <tr class="total"><td>Total (bd ft)</td><td></td><td class="num">${t.netBoardFeet.toFixed(1)}</td><td class="num">${t.packedBoardFeet.toFixed(1)}</td><td class="num">${t.recommendedBoardFeet.toFixed(1)}</td><td class="num">$${Math.round(t.cost)}</td></tr>
      </tbody>
    </table>
    <p class="hint">Saw kerf ${formatLength(p.lumber.settings.kerf, u)}. Rough boards lose ${formatLength(1 / 4, u)} in thickness and ${formatLength(1 / 2, u)} in width to milling, plus ${formatLength(1, u)} at each end to checks and snipe. Each board is sized to the pieces it carries. Prices are rough US averages.</p>`
        : ''
    }
    <h3>Hardware</h3>
    <ul>${p.model.hardware.map((h) => `<li>${h.quantity} × ${esc(h.item)}${h.note ? ` <span class="hint">— ${esc(h.note)}</span>` : ''}</li>`).join('')}</ul>`;

  $('#tab-diagram').innerHTML = cuttingDiagrams(p);
  $('#tab-diagram').querySelectorAll<SVGElement>('[data-letter]').forEach((el) => el.addEventListener('click', () => pickLetter(el.dataset.letter!)));

  $('#tab-assembly').innerHTML = `<ol class="steps">${p.model.assemblySteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;

  // Keep a picked row picked across edits if it still exists.
  const still = pickedLetter && p.cutList.some((r) => r.letter === pickedLetter) ? pickedLetter : null;
  pickedLetter = null;
  if (still) pickLetter(still);
  else viewer.setSelected([]);
}

function cuttingDiagrams(p: ProjectPlan): string {
  if (!p.lumber.groups.length) return '<p class="hint">Nothing to cut from bought lumber for this design.</p>';
  const u = p.model.spec.units;
  const maxLen = Math.max(...p.lumber.groups.flatMap((g) => g.boards.map((b) => b.size.length)));
  const scale = 8; // px per inch in viewBox units; SVG scales to container width
  return p.lumber.groups
    .map((g) => {
      const boards = g.boards
        .map((b, i) => {
          const { size } = b;
          const W = size.width * scale;
          const L = size.length * scale;
          const ox = ((size.length - size.usableLength) / 2) * scale;
          const oy = ((size.width - size.usableWidth) / 2) * scale;
          const rects = b.placements
            .map((pl) => {
              const x = ox + pl.x * scale;
              const y = oy + pl.y * scale;
              const w = pl.length * scale;
              const h = pl.width * scale;
              const letter = p.letters[pl.partId] ?? '';
              const label = `${letter} · ${formatLength(pl.length, u)}`;
              const fs = Math.min(h * 0.75, 26);
              return `<g data-letter="${letter}" class="piece-g"><rect class="piece" x="${x}" y="${y}" width="${w}" height="${h}"/><text x="${x + w / 2}" y="${y + h / 2}" font-size="${fs}" dominant-baseline="central" text-anchor="middle">${esc(label)}</text><title>${esc(pl.name)}</title></g>`;
            })
            .join('');
          return `<figure><figcaption>Board ${i + 1}: ${formatBoardWidth(size.width, u)} × ${formatBoardLength(size.length, u)}</figcaption>
            <svg viewBox="0 0 ${maxLen * scale} ${W}" preserveAspectRatio="xMinYMin meet" style="aspect-ratio:${maxLen * scale}/${W}">
              <rect class="board" x="0" y="0" width="${L}" height="${W}"/>${rects}
            </svg></figure>`;
        })
        .join('');
      return `<section class="diagram"><h3>${esc(g.stock.label)} ${esc(SPECIES[g.species].name)}</h3>${boards}</section>`;
    })
    .join('');
}

let timer: number | undefined;
function update(rerenderForm: boolean): void {
  saveState(state);
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      current = plan(toSpec(state));
      $('#errors').hidden = true;
      viewer.letters = current.letters;
      viewer.setModel(current.model);
      renderOutputs(current);
      document.body.classList.remove('has-errors');
    } catch (err) {
      const problems = err instanceof SpecError ? err.problems : [(err as Error).message];
      $('#errors').innerHTML = `<strong>Can't build this yet:</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
      $('#errors').hidden = false;
      document.body.classList.add('has-errors');
    }
    if (rerenderForm) {
      const focused = (document.activeElement as HTMLInputElement | null)?.name;
      renderForm();
      if (focused) ($(`#form [name="${focused}"]`) as HTMLElement | null)?.focus();
    }
  }, 120);
}

// Tabs
document.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll<HTMLElement>('[role=tabpanel]').forEach((p) => (p.hidden = p.id !== tab.getAttribute('aria-controls')));
  });
});

$('#explode').addEventListener('input', (e) => viewer.setExplode(Number((e.target as HTMLInputElement).value) / 100));
$('#xray').addEventListener('change', (e) => viewer.setXray((e.target as HTMLInputElement).checked));
$('#labels').addEventListener('change', (e) => viewer.setLabels((e.target as HTMLInputElement).checked));
$('#reset-view').addEventListener('click', () => viewer.resetView());
$('#reset-form').addEventListener('click', () => {
  state = defaultState();
  update(true);
});
$('#copy-spec').addEventListener('click', async () => {
  const json = JSON.stringify({ ...toSpec(state), referenceImage: undefined }, null, 2);
  const status = $('#copy-status');
  try {
    await navigator.clipboard.writeText(json);
    status.textContent = 'Spec copied';
  } catch {
    const box = $('#spec-json') as HTMLTextAreaElement;
    box.value = json;
    box.hidden = false;
    box.select();
    status.textContent = 'Select and copy the spec below';
  }
  window.setTimeout(() => (status.textContent = ''), 4000);
});

const form = $('#form');
form.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.type === 'number') onFormChange(e);
});
form.addEventListener('change', onFormChange);

renderForm();
update(true);
