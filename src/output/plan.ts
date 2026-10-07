import { getSpecies } from '../core/species';
import type { Model, ProjectSpec } from '../core/types';
import { FINISH_LABELS, JOINERY_LABELS } from '../core/types';
import { formatBoardLength, formatDims, formatLength, type Unit } from '../core/units';
import { buildModel, getProjectType } from '../projects/registry';
import { cutList, finishedWeight, type CutListRow } from './cutList';
import { planLumber, type LumberPlan, type StockGroup } from './stock';

export interface ProjectPlan {
  model: Model;
  cutList: CutListRow[];
  lumber: LumberPlan;
  shoppingList: string[];
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
    ...priced.map((h) => `${count(h.quantity)} ${h.item.charAt(0).toLowerCase()}${h.item.slice(1)} (~$${Math.round(h.quantity * h.unitCost!)}).`),
  ];
  if (!shoppingList.length) shoppingList.push('No lumber to buy.');
  return {
    model,
    cutList: cutList(model),
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

function plural(name: string): string {
  const base = name.replace(/ \(.*\)$/, '').toLowerCase();
  if (base.endsWith('foot')) return `${base.slice(0, -4)}feet`;
  return base.endsWith('s') ? base : `${base}s`;
}

/** "~4.6 board feet of 8/4 red oak: one board at least 4″ wide × 6′ long, for the legs." */
export function shoppingLine(g: StockGroup, unit: Unit): string {
  const species = getSpecies(g.species);
  const n = g.boards.length;
  const width = unit === 'mm' ? formatLength(g.board.width, unit) : `${g.board.width}″`;
  const what = species.soldAs === 'rough' ? `${g.stock.label} ${species.name.toLowerCase()}` : `${species.name}`;
  const boardDesc =
    species.soldAs === 'rough'
      ? `${count(n)} board${n > 1 ? 's' : ''} at least ${width} wide × ${formatBoardLength(g.board.length, unit)} long`
      : `${count(n)} ${g.stock.label}${g.board.width} board${n > 1 ? 's' : ''}, ${formatBoardLength(g.board.length, unit)} long`;
  return `~${g.boardFeet.recommended.toFixed(1)} board feet of ${what}: ${boardDesc}, for the ${joinWords(g.purposes.map(plural))}.`;
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
  lines.push(
    `${s.projectType.toUpperCase()}${style ? ` (${style})` : ''} — ${formatLength(d.length, u)} L × ${formatLength(d.width, u)} W × ${formatLength(d.height, u)} H`,
  );
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
    lines.push(`  ${String(r.quantity).padStart(2)} × ${r.name.padEnd(22)} ${formatDims(r.size.thickness, r.size.width, r.size.length, u)}`);
    if (r.allowanceReason) lines.push(`         (${r.allowanceReason})`);
    for (const n of r.notes) lines.push(`         - ${n}`);
  }
  for (const a of model.assemblies) {
    lines.push(`  ${a.name}: ${formatDims(a.finishedSize.thickness, a.finishedSize.width, a.finishedSize.length, u)} — ${a.note}`);
  }
  hr();

  lines.push('LUMBER SHOPPING LIST');
  for (const l of p.shoppingList) lines.push(`  • ${l}`);
  const t = p.lumber.totals;
  if (p.lumber.groups.length) {
    lines.push(
      `  Total: ~${t.recommendedBoardFeet.toFixed(1)} bd ft ` +
        `(${t.netBoardFeet.toFixed(1)} in parts, ${t.packedBoardFeet.toFixed(1)} after kerf ${formatLength(p.lumber.settings.kerf, u)} and trim, ` +
        `+${Math.round(p.lumber.settings.overage * 100)}% for defects and mistakes)`,
    );
    lines.push(`  Estimated lumber cost: ~$${Math.round(t.cost)} (regional prices vary widely)`);
  }
  if (p.hardwareCost) lines.push(`  Steel legs and priced hardware: ~$${Math.round(p.hardwareCost)}`);
  lines.push(`  Finished weight: ~${Math.round(p.weightLb)} lb`);
  hr();

  lines.push('HARDWARE');
  for (const h of model.hardware) lines.push(`  ${String(h.quantity).padStart(3)} × ${h.item}${h.note ? ` — ${h.note}` : ''}`);
  hr();

  lines.push('ASSEMBLY ORDER');
  model.assemblySteps.forEach((step, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${step}`));
  return lines.join('\n');
}
