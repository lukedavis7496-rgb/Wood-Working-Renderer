# Wood-Working-Renderer

Turn a woodworking project spec into a **parametric 3D model**, a **cut list**,
a **lumber shopping list** with board feet and cost, and an **assembly order**.

Supported now: **tables** in three styles:

- **Classic**: square or tapered legs, mortise & tenon / dowel / pocket-screw
  aprons, top glued up from boards.
- **Live edge**: your own slab (widest and narrow-end width, current length
  and thickness) on bought steel legs (U, trapezoid, X or hairpin). The slab
  isn't on the lumber list; the plan covers flattening, trimming and stabilising it.
- **Round**: glued-up top cut to a circle (each board only as long as the
  chord it spans) or your own round slab, on a pedestal (laminated column,
  half-lapped feet and cleats) or four legs with aprons.

Bookshelves, cabinets and benches are next.
The spec and the project-type registry are built so they slot in without
touching the core.

```
npm install
npm run dev                                   # browser app with 3D viewer
npm run plan -- examples/dining-table.json    # text report in the terminal
npm test                                      # geometry + lumber math tests
npm run build:artifact                        # single-file page (three.js from CDN)
```

## Input spec

```json
{
  "projectType": "table",
  "units": "in",
  "dimensions": { "length": 60, "width": 36, "height": 30 },
  "species": "red-oak",
  "joinery": "mortise-tenon",
  "options": { "legStyle": "tapered" },
  "finish": "oil"
}
```

| Field | Values |
|---|---|
| `projectType` | `table` (style via `options.tableStyle`: `classic`, `live-edge`, `round`) |
| `units` | `in` or `mm` (all lengths, including length options, use this unit) |
| `dimensions` | overall finished length × width × height |
| `species` | `red-oak`, `white-oak`, `walnut`, `hard-maple`, `soft-maple`, `cherry`, `ash`, `poplar`, `pine` |
| `joinery` | `mortise-tenon`, `dowel`, `pocket-screw`, `dado` (each type declares which it supports; tables don't take dados) |
| `finish` | `stain`, `oil`, `paint`, `raw` (optional, default `oil`) |
| `options` | type-specific, all optional, with recommended defaults (see below) |
| `stock` | optional `{ "kerf": 0.125, "overage": 0.15 }` |

Table options: `tableStyle`; classic/four-leg base: `legStyle`
(`straight`/`tapered`), `legThickness`, `taperFootSize`, `taperStart`,
`apronInset`, `apronWidth`, `apronThickness`, `tenonLength`, `overhang`;
board tops: `topThickness`, `maxTopBoardWidth`; slabs: `narrowWidth`,
`slabLength`, `slabThickness`, `flattenAllowance`; steel legs: `steelLegStyle`,
`steelLegInset`, `steelLegWidth`, `steelTubeSize`; round: `roundTop`
(`boards`/`slab`), `roundBase` (`pedestal`/`four-legs`), `columnSize`, `footSpan`.
For round tables `dimensions.length` is the diameter. See `examples/` for each style.
The species is never a dimension: it drives weight, cost and how the lumber is
sold (rough hardwood in quarters vs. surfaced softwood in nominal sizes).

## How the math works

**Parts are solids, and cut sizes come from the solids.** Each part is built
from hexahedra in its own frame (x = grain/length, y = width, z = thickness):
a tapered leg is a square box over a hexahedron whose foot corners are pulled
in, and a tenoned apron is a body plus two tenon boxes. The cut list measures
each part's extent, so a tenoned apron is cut to its tip-to-tip length. Nothing
is "outer dimension minus a constant".

For the 60 × 36 × 30″ example:

- Legs: 30″ − 1″ top = **29″**
- Leg footprint: 60 − 2 × 1″ overhang = 58″; apron shoulders: 58 − 2 × 1-3/4″ legs = **54-1/2″**
- Two aprons meet in each leg at the same height, so their mortises converge.
  Maximum depth = `T − inset − (apronThk + tenonThk)/2` = 1-3/4 − 1/4 − 1/2 = 1″,
  less a 1/16″ glue gap → tenons capped at **15/16″** (the app warns that it shortened the requested 1-1/4″)
- Long apron cut length: 54-1/2 + 2 × 15/16 = **56-3/8″** (pocket screws or dowels: 54-1/2″)

The tests check this geometrically too: every tenon sits inside a mortise,
no two tenons overlap, and no apron body overlaps a leg.

**Lumber planning** groups parts by stock thickness. Rough hardwood gets 1/4″
for milling (3/4″ → 4/4, 1″ → 5/4, 1-3/4″ → 8/4), loses 1/2″ of width to edge
jointing and 1″ at each end to checks and snipe. Softwood maps to surfaced
nominal sizes (1×, 2×, 4×). Pieces are packed rip-first into strips and then
crosscut, with a saw kerf charged for every cut. The planner tries common board
widths and lengths and keeps the layout with the fewest board feet. It then adds
15% (configurable) for defects and mistakes. The browser app shows each board's
cutting layout.

## Adding a project type

Create `src/projects/<type>.ts` exporting a `ProjectType`:

- `options`: a schema of conditional inputs (`length`/`number`/`select`/`boolean`,
  with defaults that can depend on the dimensions). It drives validation,
  unit conversion and the browser form.
- `supportedJoinery` and `validate`
- `build(spec)` returns `Part`s (solids + placement), joints, hardware and
  assembly steps

Then register it in `src/projects/registry.ts`. Cut list, lumber plan, cost,
weight and the 3D view all work from the parts automatically.

## Layout

```
src/core/       units, geometry, species data, spec types + normalisation
src/projects/   project types and the registry; table/ holds the styles,
                bases (apron, pedestal, steel legs) and tops (boards, round, slabs)
src/output/     cut list, lumber planning/packing, report
src/ui/         browser app (form, Three.js viewer, outputs)
src/cli.ts      terminal report
test/           vitest suites
```

## Roadmap

- Shelving (fixed/adjustable shelves, dados, back panel) and cabinets (doors,
  drawers, overlay)
- Bench
- Three-leg round bases (angled joinery), wood trestle bases for slabs
- Bookmatched slabs with an epoxy river
- Mitred tenons for longer tenons in thin legs
- Printable / PDF cut sheets
- Cutting diagrams that mix board sizes (e.g. a wider board for the top)
