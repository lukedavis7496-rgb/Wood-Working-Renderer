import { SEASONAL_MC_SWING } from '../core/movement';
import { getSpecies } from '../core/species';
import type { Model, ProjectSpec } from '../core/types';
import { FINISH_LABELS, JOINERY_LABELS } from '../core/types';
import { formatBoardLength, formatDims, formatLength, type Unit } from '../core/units';
import { buildModel, getProjectType } from '../projects/registry';
import { cutList, finishedWeight, groupedAssemblies, lettersByPart, type CutListRow } from './cutList';
import { planLumber, type BoardSize, type LumberPlan, type StockGroup } from './stock';

export interface ProjectPlan {
  model: Model;
  cutList: CutListRow[];
  lumber: LumberPlan;
  shoppingList: string[];
  /** partId → cut list letter (A, B, C…). */
  letters: Record<string, string>;
  /** Priced hardware (e.g. steel legs), USD. */
  hardwareCost: number;
  /** Lumber + priced hardware, USD. */
  totalCost: number;
  weightLb: number;
}

export function plan(spec: ProjectSpec): ProjectPlan {
  const model = buildModel(spec);
  const lumber = planLumber(model);
  const u = model.spec.units;
  const priced = model.hardware.filter((h) => h.unitCost);
  const hardwareCost = priced.reduce((s, h) => s + h.quantity * h.unitCost!, 0);
  const owned = model.parts.filter((p) => p.sourcing === 'owned');
  const shoppingList = [
    ...owned.map((p) => `${p.name}: you have it — nothing to buy for the top.`),
    ...lumber.groups.map((g) => shoppingLine(g, u)),
    ...priced.map((h) => `${count(h.quantity)} ${/^[A-Z][a-z]/.test(h.item) ? h.item.charAt(0).toLowerCase() + h.item.slice(1) : h.item} (~$${Math.round(h.quantity * h.unitCost!)}).`),
  ];
  if (!shoppingList.length) shoppingList.push('No lumber to buy.');
  const rows = cutList(model);
  return {
    model,
    cutList: rows,
    letters: lettersByPart(rows),
    lumber,
    shoppingList: shoppingList.map((l) => l.charAt(0).toUpperCase() + l.slice(1)),
    hardwareCost,
    totalCost: lumber.totals.cost + hardwareCost,
    weightLb: finishedWeight(model),
  };
}

const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number) => numberWords[n] ?? String(n);

function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "Leg ×4" → "legs", "Top" → "top", "Foot ×2" → "feet", "Adjustable shelf ×3" → "adjustable shelves". */
function plural(purpose: string): string {
  const m = purpose.match(/^(.*?)(?: ×(\d+))?$/)!;
  const base = m[1].toLowerCase();
  if (!m[2]) return base;
  if (base.endsWith('foot')) return `${base.slice(0, -4)}feet`;
  if (base.endsWith('shelf')) return `${base.slice(0, -5)}shelves`;
  return base.endsWith('s') ? base : `${base}s`;
}

/** Board width as a buyer asks for it: whole inches, or mm. */
export function formatBoardWidth(inches: number, unit: Unit): string {
  return unit === 'mm' ? formatLength(inches, unit) : `${inches}″`;
}

/** Boards of one stock grouped by size, largest first: [{count, size}]. */
export function boardsBySize(g: StockGroup): { count: number; size: BoardSize }[] {
  const out: { count: number; size: BoardSize }[] = [];
  for (const b of g.boards) {
    const hit = out.find((o) => o.size.width === b.size.width && o.size.length === b.size.length);
    if (hit) hit.count++;
    else out.push({ count: 1, size: b.size });
  }
  return out;
}

/** "~5.8 board feet of 8/4 red oak: one board at least 5″ wide × 6′ long, for the legs." */
export function shoppingLine(g: StockGroup, unit: Unit): string {
  const species = getSpecies(g.species);
  if (g.kind === 'sheet') {
    const n = g.boards.length;
    const name = species.name.replace(/ \(.*\)$/, '').toLowerCase();
    return `${count(n)} sheet${n > 1 ? 's' : ''} of ${formatLength(g.stock.nominal, unit)} ${name} plywood (${unit === 'mm' ? '1220 × 2440 mm' : '4′ × 8′'}), for the ${joinWords(g.purposes.map(plural))} (~$${Math.round(g.cost)}).`;
  }
  const rough = species.soldAs === 'rough';
  const what = rough ? `${g.stock.label} ${species.name.toLowerCase()}` : `${species.name}`;
  const sizes = boardsBySize(g).map(({ count: n, size }, i) => {
    const len = formatBoardLength(size.length, unit);
    if (!rough) return `${count(n)} ${g.stock.label}${size.width} board${n > 1 ? 's' : ''}, ${len} long`;
    return i === 0
      ? `${count(n)} board${n > 1 ? 's' : ''} at least ${formatBoardWidth(size.width, unit)} wide × ${len} long`
      : `${count(n)} at least ${formatBoardWidth(size.width, unit)} × ${len}`;
  });
  return `~${g.boardFeet.recommended.toFixed(1)} board feet of ${what}: ${joinWords(sizes)}, for the ${joinWords(g.purposes.map(plural))}.`;
}

/** Plain-text report for the CLI. */
export function formatPlan(p: ProjectPlan): string {
  const { model } = p;
  const s = model.spec;
  const u = s.units;
  const species = getSpecies(s.species);
  const lines: string[] = [];
  const hr = () => lines.push('');

  const d = s.dimensions;
  const style = String(s.options.tableStyle ?? '');
  const labels = getProjectType(s.projectType).dimensionLabels?.(s.options) ?? { length: 'Length', width: 'Width', height: 'Height' };
  const abbr = (label: string | null) => (/depth/i.test(label ?? '') ? 'D' : /width/i.test(label ?? 'width') ? 'W' : 'L');
  const plan = labels.length === 'Diameter' ? `${formatLength(d.length, u)} diameter` : `${formatLength(d.length, u)} ${abbr(labels.length)} × ${formatLength(d.width, u)} ${abbr(labels.width)}`;
  lines.push(`${s.projectType.toUpperCase()}${style ? ` (${style})` : ''} — ${plan} × ${formatLength(d.height, u)} H`);
  const joineryApplies = getProjectType(s.projectType).joineryApplies?.(s.options) ?? true;
  lines.push([species.name, ...(joineryApplies ? [JOINERY_LABELS[s.joinery]] : []), FINISH_LABELS[s.finish]].join(' · '));
  hr();

  if (model.warnings.length) {
    lines.push('WARNINGS');
    for (const w of model.warnings) lines.push(`  ! ${w}`);
    hr();
  }

  lines.push('CUT LIST (finished sizes: thickness × width × length)');
  for (const r of p.cutList) {
    lines.push(`  ${r.letter.padEnd(2)} ${String(r.quantity).padStart(2)} × ${r.name.padEnd(22)} ${formatDims(r.size.thickness, r.size.width, r.size.length, u)}${r.owned ? '  (your slab)' : ''}`);
    if (r.allowanceReason) lines.push(`            (${r.allowanceReason})`);
    for (const n of r.notes) lines.push(`            - ${n}`);
  }
  for (const { quantity, assembly: a } of groupedAssemblies(model)) {
    lines.push(`  ${quantity > 1 ? `${quantity} × ` : ''}${a.name}: ${formatDims(a.finishedSize.thickness, a.finishedSize.width, a.finishedSize.length, u)} — ${a.note}`);
  }
  hr();

  lines.push('LUMBER SHOPPING LIST');
  for (const l of p.shoppingList) lines.push(`  • ${l}`);
  const t = p.lumber.totals;
  if (p.lumber.groups.some((g) => g.kind === 'lumber')) {
    lines.push(
      `  Total: ~${t.recommendedBoardFeet.toFixed(1)} bd ft ` +
        `(${t.netBoardFeet.toFixed(1)} in parts, ${t.packedBoardFeet.toFixed(1)} after kerf ${formatLength(p.lumber.settings.kerf, u)} and trim, ` +
        `+${Math.round(p.lumber.settings.overage * 100)}% for defects and mistakes)`,
    );
    lines.push(`  Estimated lumber cost: ~$${Math.round(t.cost)} (regional prices vary widely)`);
  }
  if (p.hardwareCost) lines.push(`  Steel legs and priced hardware: ~$${Math.round(p.hardwareCost)}`);
  lines.push(`  Finished weight: ~${Math.round(p.weightLb)} lb`);
  if (model.movement) {
    lines.push(
      `  Seasonal movement: ~${formatLength(model.movement.amount, u)} across the ${formatLength(model.movement.width, u)} top (${SEASONAL_MC_SWING}% moisture swing, flatsawn)`,
    );
  }
  hr();

  lines.push('HARDWARE');
  for (const h of model.hardware) lines.push(`  ${String(h.quantity).padStart(3)} × ${h.item}${h.note ? ` — ${h.note}` : ''}`);
  hr();

  lines.push('ASSEMBLY ORDER');
  model.assemblySteps.forEach((step, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${step}`));
  return lines.join('\n');
}
