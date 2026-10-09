import './style.css';
import { SpecError } from '../core/spec';
import { formatDims } from '../core/units';
import { cutSize } from '../output/cutList';
import { plan, type ProjectPlan } from '../output/plan';
import { esc, renderForm } from './form';
import { Outputs } from './outputs';
import { convertUnits, currentDesign, defaultState, loadStore, newDesign, saveStore, toSpec, type FormState } from './state';
import { Viewer } from './viewer';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const store = loadStore();
let current: ProjectPlan | null = null;
let referenceImage: string | undefined;
/** Re-frame the camera on the next successful build (new or switched design). */
let refit = false;

const design = () => currentDesign(store);
const state = (): FormState => design().state;

function persist(): void {
  design().updated = Date.now();
  saveStore(store);
}

const viewer = new Viewer($('#viewer'), $('#tooltip'), (part) => {
  if (part.material === 'steel') return part.name;
  const letter = current?.letters[part.id];
  const s = cutSize(part);
  return `${letter ? `${letter} · ` : ''}${part.name} · ${formatDims(s.thickness, s.width, s.length, current?.model.spec.units ?? 'in')}`;
});
const outputs = new Outputs(viewer, design, persist);

// ---------------------------------------------------------------------------
// Build and render
// ---------------------------------------------------------------------------

function showErrors(problems: string[] | null): void {
  for (const box of [$('#errors'), $('#form-errors')]) {
    box.hidden = !problems;
    if (problems) box.innerHTML = `<strong>Can't build this yet:</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
  }
  document.body.classList.toggle('has-errors', !!problems);
}

function drawForm(): void {
  const focused = document.activeElement as HTMLInputElement | null;
  const name = focused?.closest('#form') ? focused.name : null;
  const caret = name && focused && 'selectionStart' in focused ? focused.selectionStart : null;
  renderForm($('#form'), store, current);
  if (referenceImage) {
    const img = $('#reference-preview') as HTMLImageElement;
    img.src = referenceImage;
    img.hidden = false;
  }
  if (name) {
    const el = $(`#form [name="${name}"]`) as HTMLInputElement | null;
    el?.focus();
    if (el && caret !== null && el.type === 'text') el.setSelectionRange(caret, caret);
  }
}

let timer: number | undefined;
function update(rerenderForm: boolean): void {
  persist();
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const { spec, inputErrors } = toSpec(state(), referenceImage);
    if (inputErrors.length) {
      showErrors(inputErrors);
    } else {
      try {
        current = plan(spec);
        showErrors(null);
        viewer.letters = current.letters;
        viewer.setModel(current.model);
        if (refit) {
          viewer.resetView();
          refit = false;
        }
        outputs.render(current);
      } catch (err) {
        showErrors(err instanceof SpecError ? err.problems : [(err as Error).message]);
      }
    }
    if (rerenderForm) drawForm();
  }, 120);
}

// ---------------------------------------------------------------------------
// Form events
// ---------------------------------------------------------------------------

function onFormEvent(e: Event): void {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const name = el.name;
  if (!name) return;
  const s = state();

  if (name === 'design') {
    if (el.value === '__new') {
      const d = newDesign(`Design ${store.designs.length + 1}`);
      store.designs.push(d);
      store.currentId = d.id;
    } else {
      store.currentId = el.value;
    }
    refit = true;
    current = null;
    update(true);
    return;
  }
  if (name === 'designName') {
    design().name = el.value.trim() || 'Untitled';
    persist();
    if (e.type === 'change') drawForm();
    return;
  }
  if (name === 'reference') {
    const file = (el as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      referenceImage = String(reader.result);
      const img = $('#reference-preview') as HTMLImageElement;
      img.src = referenceImage;
      img.hidden = false;
    };
    reader.readAsDataURL(file);
    return;
  }

  const value = el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : el.value;
  if (name.startsWith('opt:')) s.options[name.slice(4)] = value;
  else if (name === 'units') {
    convertUnits(s, s.units, value as FormState['units']);
    s.units = value as FormState['units'];
  } else if (name === 'projectType') {
    if (value !== s.projectType) {
      s.projectType = value;
      s.options = {};
      refit = true;
    }
  } else (s as unknown as Record<string, string>)[name] = value;

  // Typing updates the model live; a committed change (select, blur) also
  // redraws the form, since it can show or hide other fields.
  update(e.type === 'change');
}

const form = $('#form');
form.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'file') onFormEvent(e);
});
form.addEventListener('change', onFormEvent);

/** Two-step confirm: the first click arms the button, a second within 4 s acts. */
function confirmClick(btn: HTMLButtonElement, label: string, act: () => void): void {
  if (btn.dataset.armed) {
    act();
    return;
  }
  const original = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = label;
  btn.classList.add('danger');
  window.setTimeout(() => {
    if (!btn.isConnected) return;
    delete btn.dataset.armed;
    btn.textContent = original;
    btn.classList.remove('danger');
  }, 4000);
}

form.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'duplicate') {
    const d = newDesign(`${design().name} (copy)`, structuredClone(state()));
    store.designs.push(d);
    store.currentId = d.id;
    update(true);
  } else if (btn.dataset.action === 'delete') {
    confirmClick(btn, 'Confirm delete', () => {
      store.designs = store.designs.filter((d) => d.id !== store.currentId);
      store.currentId = store.designs[0].id;
      refit = true;
      current = null;
      update(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Page controls
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('.tabs [role=tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll<HTMLElement>('[role=tabpanel]').forEach((p) => (p.hidden = p.id !== tab.getAttribute('aria-controls')));
  });
});

// Phones show one side at a time.
document.body.dataset.view = 'results';
document.querySelectorAll<HTMLButtonElement>('.mobile-switch button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.body.dataset.view = btn.dataset.view;
    document.querySelectorAll<HTMLButtonElement>('.mobile-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    window.scrollTo({ top: 0 });
  });
});

$('#explode').addEventListener('input', (e) => viewer.setExplode(Number((e.target as HTMLInputElement).value) / 100));
$('#xray').addEventListener('change', (e) => viewer.setXray((e.target as HTMLInputElement).checked));
$('#labels').addEventListener('change', (e) => viewer.setLabels((e.target as HTMLInputElement).checked));
$('#reset-view').addEventListener('click', () => viewer.resetView());

$('#reset-form').addEventListener('click', (e) =>
  confirmClick(e.currentTarget as HTMLButtonElement, 'Confirm reset', () => {
    design().state = defaultState();
    design().checks = { cut: [], steps: [] };
    refit = true;
    update(true);
  }),
);
$('#clear-checks').addEventListener('click', () => {
  design().checks = { cut: [], steps: [] };
  persist();
  if (current) outputs.render(current);
});

$('#copy-spec').addEventListener('click', async () => {
  const json = JSON.stringify({ ...toSpec(state()).spec, referenceImage: undefined }, null, 2);
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

drawForm();
update(true);
