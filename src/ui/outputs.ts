import { SPECIES } from '../core/species';
import { formatBoardLength, formatDims, formatLength } from '../core/units';
import { groupedAssemblies } from '../output/cutList';
import { boardsBySize, formatBoardWidth, type ProjectPlan } from '../output/plan';
import { esc } from './form';
import type { Design } from './state';
import type { Viewer } from './viewer';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/**
 * Renders the summary, cut list, shopping list, cutting diagrams and
 * assembly steps, and keeps the cut list, diagrams and 3D view pointing at
 * the same part letters.
 */
export class Outputs {
  private plan: ProjectPlan | null = null;
  private picked: string | null = null;

  constructor(
    private viewer: Viewer,
    private design: () => Design,
    private onChecksChanged: () => void,
  ) {
    viewer.onPick = (partId) => {
      const letter = partId ? (this.plan?.letters[partId] ?? null) : null;
      if (!letter) return;
      this.pick(letter);
      document.querySelector(`#tab-cut [data-letter="${letter}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    viewer.onHover = (partId) => {
      const letter = partId ? this.plan?.letters[partId] : undefined;
      document.querySelectorAll<HTMLElement>('#tab-cut [data-letter]').forEach((el) => el.classList.toggle('hovered', el.dataset.letter === letter));
    };
  }

  /** Highlight one cut-list letter everywhere; picking it again clears it. */
  pick(letter: string | null): void {
    this.picked = letter === this.picked ? null : letter;
    const row = this.plan?.cutList.find((r) => r.letter === this.picked);
    this.viewer.setSelected(row?.ids ?? []);
    document.querySelectorAll<Element>('[data-letter]').forEach((el) => el.classList.toggle('picked', (el as HTMLElement).dataset.letter === this.picked));
  }

  render(p: ProjectPlan): void {
    this.plan = p;
    this.summary(p);
    this.cutList(p);
    this.shopping(p);
    $('#tab-diagram').innerHTML = cuttingDiagrams(p);
    $('#tab-diagram')
      .querySelectorAll<HTMLElement>('[data-letter]')
      .forEach((el) => el.addEventListener('click', () => this.pick(el.dataset.letter!)));
    this.assembly(p);
    // Keep a picked part picked across edits if it still exists.
    const still = this.picked && p.cutList.some((r) => r.letter === this.picked) ? this.picked : null;
    this.picked = null;
    if (still) this.pick(still);
    else this.viewer.setSelected([]);
  }

  private summary(p: ProjectPlan): void {
    const u = p.model.spec.units;
    const t = p.lumber.totals;
    const pieces = p.cutList.reduce((n, r) => n + r.quantity, 0);
    const owned = p.cutList.some((r) => r.owned);
    const mv = p.model.movement;
    const sheets = p.lumber.groups.filter((g) => g.kind === 'sheet').reduce((n, g) => n + g.boards.length, 0);
    const hasLumber = p.lumber.groups.some((g) => g.kind === 'lumber');
    const extra = [owned ? 'plus your slab' : '', sheets ? `plus ${sheets} sheet${sheets > 1 ? 's' : ''} of plywood` : ''].filter(Boolean).join(', ');
    $('#summary').innerHTML = `
      <div class="stat"><span>Lumber to buy</span><strong>${hasLumber ? `~${t.recommendedBoardFeet.toFixed(1)} bd ft` : 'None'}</strong>${extra ? `<small>${extra}</small>` : ''}</div>
      <div class="stat"><span>Est. cost</span><strong>~$${Math.round(p.totalCost)}</strong>${p.hardwareCost ? `<small>incl. ~$${Math.round(p.hardwareCost)} steel legs</small>` : '<small>lumber only</small>'}</div>
      <div class="stat"><span>Wood pieces</span><strong>${pieces}</strong><small>${p.cutList.length} different</small></div>
      <div class="stat"><span>Finished weight</span><strong>~${Math.round(p.weightLb)} lb</strong></div>
      ${mv ? `<div class="stat"><span>Seasonal movement</span><strong>~${formatLength(mv.amount, u)}</strong><small>across the ${formatLength(mv.width, u)} top</small></div>` : ''}`;
    $('#warnings').innerHTML = p.model.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
    $('#warnings').hidden = !p.model.warnings.length;
  }

  private cutList(p: ProjectPlan): void {
    const u = p.model.spec.units;
    const cut = new Set(this.design().checks.cut);
    const done = p.cutList.filter((r) => cut.has(r.letter)).length;
    $('#tab-cut').innerHTML = `
      <div class="panel-head">
        <p class="hint">Tap a row to find those parts in the model, or a part in the model to find its row. Tick rows off as you cut them.</p>
        <span class="progress">${done} of ${p.cutList.length} cut</span>
      </div>
      <div class="table-scroll"><table class="cut-list">
        <thead><tr><th><span class="sr-only">Cut</span></th><th>Part</th><th>Qty</th><th>Name</th><th>Thickness</th><th>Width</th><th>Length</th><th>Notes</th></tr></thead>
        <tbody>${p.cutList
          .map(
            (r) => `<tr data-letter="${r.letter}" tabindex="0"${cut.has(r.letter) ? ' class="done"' : ''}>
              <td class="check"><input type="checkbox" data-check-cut="${r.letter}" aria-label="Cut ${esc(r.name)} (${r.letter})"${cut.has(r.letter) ? ' checked' : ''}></td>
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
      </table></div>
      ${groupedAssemblies(p.model)
        .map(
          ({ quantity, assembly: a }) =>
            `<p class="assembly"><strong>${quantity > 1 ? `${quantity} × ` : ''}${esc(a.name)}</strong> — ${formatDims(a.finishedSize.thickness, a.finishedSize.width, a.finishedSize.length, u)}. ${esc(a.note)}</p>`,
        )
        .join('')}`;
    $('#tab-cut')
      .querySelectorAll<HTMLElement>('tr[data-letter]')
      .forEach((tr) => {
        tr.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.check')) return;
          this.pick(tr.dataset.letter!);
        });
        tr.addEventListener('keydown', (e) => {
          if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            this.pick(tr.dataset.letter!);
          }
        });
      });
    $('#tab-cut')
      .querySelectorAll<HTMLInputElement>('[data-check-cut]')
      .forEach((box) =>
        box.addEventListener('change', () => {
          const d = this.design();
          const letter = box.dataset.checkCut!;
          d.checks.cut = box.checked ? [...new Set([...d.checks.cut, letter])] : d.checks.cut.filter((l) => l !== letter);
          this.onChecksChanged();
          this.cutList(p);
          if (this.picked) document.querySelectorAll<HTMLElement>('#tab-cut [data-letter]').forEach((el) => el.classList.toggle('picked', el.dataset.letter === this.picked));
        }),
      );
  }

  private shopping(p: ProjectPlan): void {
    const u = p.model.spec.units;
    const t = p.lumber.totals;
    $('#tab-shopping').innerHTML = `
      <ul class="shopping">${p.shoppingList.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${
        p.lumber.groups.length
          ? `<div class="table-scroll"><table class="compact">
        <thead><tr><th>Stock</th><th>Boards</th><th>In parts</th><th>With kerf &amp; trim</th><th>To buy (+${Math.round(p.lumber.settings.overage * 100)}%)</th><th>Est. cost</th></tr></thead>
        <tbody>${p.lumber.groups
          .map((g) =>
            g.kind === 'sheet'
              ? `<tr><td>${esc(formatLength(g.stock.nominal, u))} ${esc(SPECIES[g.species].name)} plywood</td><td class="num">${g.boards.length} sheet${g.boards.length > 1 ? 's' : ''}, 4′ × 8′</td>
            <td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">$${Math.round(g.cost)}</td></tr>`
              : `<tr><td>${esc(g.stock.label)} ${esc(SPECIES[g.species].name)}</td><td class="num">${boardsBySize(g)
                  .map(({ count, size }) => `${count} × ${formatBoardWidth(size.width, u)} × ${formatBoardLength(size.length, u)}`)
                  .join('<br>')}</td>
            <td class="num">${g.boardFeet.net.toFixed(1)}</td><td class="num">${g.boardFeet.packed.toFixed(1)}</td><td class="num">${g.boardFeet.recommended.toFixed(1)}</td><td class="num">$${Math.round(g.cost)}</td></tr>`,
          )
          .join('')}
          <tr class="total"><td>Total (bd ft)</td><td></td><td class="num">${t.netBoardFeet.toFixed(1)}</td><td class="num">${t.packedBoardFeet.toFixed(1)}</td><td class="num">${t.recommendedBoardFeet.toFixed(1)}</td><td class="num">$${Math.round(t.cost)}</td></tr>
        </tbody>
      </table></div>
      <p class="hint">Saw kerf ${formatLength(p.lumber.settings.kerf, u)}. Rough boards lose ${formatLength(1 / 4, u)} in thickness and ${formatLength(1 / 2, u)} in width to milling, plus ${formatLength(1, u)} at each end to checks and snipe. Each board is sized to the pieces it carries. Prices are rough US averages.</p>`
          : ''
      }
      <h3>Hardware</h3>
      <ul>${p.model.hardware.map((h) => `<li>${h.quantity} × ${esc(h.item)}${h.note ? ` <span class="hint">— ${esc(h.note)}</span>` : ''}</li>`).join('')}</ul>`;
  }

  private assembly(p: ProjectPlan): void {
    const done = new Set(this.design().checks.steps);
    const count = p.model.assemblySteps.filter((_, i) => done.has(i)).length;
    $('#tab-assembly').innerHTML = `
      <div class="panel-head"><p class="hint">Tick steps off as you go; your progress is saved with this design.</p><span class="progress">${count} of ${p.model.assemblySteps.length} done</span></div>
      <ol class="steps">${p.model.assemblySteps
        .map(
          (s, i) => `<li${done.has(i) ? ' class="done"' : ''}><label><input type="checkbox" data-check-step="${i}"${done.has(i) ? ' checked' : ''}><span>${esc(s)}</span></label></li>`,
        )
        .join('')}</ol>`;
    $('#tab-assembly')
      .querySelectorAll<HTMLInputElement>('[data-check-step]')
      .forEach((box) =>
        box.addEventListener('change', () => {
          const d = this.design();
          const i = Number(box.dataset.checkStep);
          d.checks.steps = box.checked ? [...new Set([...d.checks.steps, i])] : d.checks.steps.filter((n) => n !== i);
          this.onChecksChanged();
          this.assembly(p);
        }),
      );
  }
}

function cuttingDiagrams(p: ProjectPlan): string {
  if (!p.lumber.groups.length) return '<p class="hint">Nothing to cut from bought lumber for this design.</p>';
  const u = p.model.spec.units;
  const maxLen = Math.max(...p.lumber.groups.flatMap((g) => g.boards.map((b) => b.size.length)));
  const scale = 8; // viewBox units per inch; the SVG scales to its container
  return p.lumber.groups
    .map((g) => {
      const boards = g.boards
        .map((b, i) => {
          const { size } = b;
          const W = size.width * scale;
          const ox = ((size.length - size.usableLength) / 2) * scale;
          const oy = ((size.width - size.usableWidth) / 2) * scale;
          const rects = b.placements
            .map((pl) => {
              const x = ox + pl.x * scale;
              const y = oy + pl.y * scale;
              const w = pl.length * scale;
              const h = pl.width * scale;
              const letter = p.letters[pl.partId] ?? '';
              const fs = Math.min(h * 0.75, 26);
              return `<g data-letter="${letter}" class="piece-g"><rect class="piece" x="${x}" y="${y}" width="${w}" height="${h}"/><text x="${x + w / 2}" y="${y + h / 2}" font-size="${fs}" dominant-baseline="central" text-anchor="middle">${esc(`${letter} · ${formatLength(pl.length, u)}`)}</text><title>${esc(pl.name)}</title></g>`;
            })
            .join('');
          return `<figure><figcaption>${g.kind === 'sheet' ? 'Sheet' : 'Board'} ${i + 1}: ${formatBoardWidth(size.width, u)} × ${formatBoardLength(size.length, u)}</figcaption>
            <svg viewBox="0 0 ${maxLen * scale} ${W}" preserveAspectRatio="xMinYMin meet" style="aspect-ratio:${maxLen * scale}/${W}">
              <rect class="board" x="0" y="0" width="${size.length * scale}" height="${W}"/>${rects}
            </svg></figure>`;
        })
        .join('');
      const title = g.kind === 'sheet' ? `${formatLength(g.stock.nominal, u)} ${SPECIES[g.species].name} plywood` : `${g.stock.label} ${SPECIES[g.species].name}`;
      return `<section class="diagram"><h3>${esc(title)}</h3>${boards}</section>`;
    })
    .join('');
}
