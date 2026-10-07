import { getSpecies } from '../core/species';
import type { Model, ProjectSpec } from '../core/types';
import { FINISH_LABELS, JOINERY_LABELS } from '../core/types';
import { formatBoardLength, formatDims, formatLength, type Unit } from '../core/units';
import { buildModel } from '../projects/registry';
import { cutList, finishedWeight, type CutListRow } from './cutList';
import { planLumber, type LumberPlan, type StockGroup } from './stock';

export interface ProjectPlan {
  model: Model;
  cutList: CutListRow[];
  lumber: LumberPlan;
  shoppingList: string[];
  weightLb: number;
}

export function plan(spec: ProjectSpec): ProjectPlan {
  const model = buildModel(spec);
  const lumber = planLumber(model);
  return {
    model,
    cutList: cutList(model),
    lumber,
    shoppingList: lumber.groups.map((g) => shoppingLine(g, model.spec.units)),
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
  lines.push(
    `${s.projectType.toUpperCase()} — ${formatLength(d.length, u)} L × ${formatLength(d.width, u)} W × ${formatLength(d.height, u)} H`,
  );
  lines.push(`${species.name} · ${JOINERY_LABELS[s.joinery]} · ${FINISH_LABELS[s.finish]}`);
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
  lines.push(
    `  Total: ~${t.recommendedBoardFeet.toFixed(1)} bd ft ` +
      `(${t.netBoardFeet.toFixed(1)} in parts, ${t.packedBoardFeet.toFixed(1)} after kerf ${formatLength(p.lumber.settings.kerf, u)} and trim, ` +
      `+${Math.round(p.lumber.settings.overage * 100)}% for defects and mistakes)`,
  );
  lines.push(`  Estimated lumber cost: ~$${Math.round(t.cost)} (regional prices vary widely)`);
  lines.push(`  Finished weight: ~${Math.round(p.weightLb)} lb`);
  hr();

  lines.push('HARDWARE');
  for (const h of model.hardware) lines.push(`  ${String(h.quantity).padStart(3)} × ${h.item}${h.note ? ` — ${h.note}` : ''}`);
  hr();

  lines.push('ASSEMBLY ORDER');
  model.assemblySteps.forEach((step, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${step}`));
  return lines.join('\n');
}
