# Wood-Working-Renderer

Turn a woodworking project spec into a **parametric 3D model**, a **cut list**,
a **lumber shopping list** with board feet and cost, **cutting diagrams** and
an **assembly order**.

```
npm install
npm run dev                                   # browser app with 3D viewer
npm run plan -- examples/dining-table.json    # text report in the terminal
npm test                                      # geometry, joinery and lumber tests
npm run build:artifact                        # single-file page (three.js from CDN)
```

## What it builds

**Tables**, in three styles:

- **Classic**: square or tapered legs; mortise & tenon, dowel or pocket-screw
  aprons; top glued up from boards.
- **Live edge**: your own slab on bought steel legs (U, trapezoid, X or
  hairpin). Describe the slab by its widest and narrow-end widths, or by
  widths measured along its length; the model, leg sizes and fit checks
  follow it. At dining height the legs default to the position that seats
  the most people comfortably, and the 3D view shows the chairs. Butterfly
  keys can be inlaid across checks. The slab isn't on the lumber list; the
  plan covers flattening, trimming and stabilising it, and sizes the slotted
  screw holes for seasonal movement.
- **Round**: glued-up top cut to a circle (each board only as long as the
  chord it spans) or your own round slab, on a pedestal (laminated column,
  half-lapped feet and cleats) or four legs with aprons.

**Bookshelves**: sides, a bottom on a kick rail, a flush or overhanging top,
shelves fixed in dados or adjustable on pins, and a plywood back in rabbets.
Solid-wood panels glue up from narrow boards; or build the case from veneer
plywood planned on 4×8 sheets. Shelf sag is checked against the load.

Cabinets and benches are next.

## In the browser

- **Designs**: keep several designs; each remembers its inputs and shop
  checklist in this browser.
- **Lengths as you write them**: `1-3/4`, `1 3/4`, `29.25`, or millimetres.
  Blank boxes show the recommended value.
- **Part letters**: every cut-list row has a letter (A, B, C…) shared with
  the cutting diagrams and the 3D view. Click a row to highlight those parts;
  click a part to find its row; turn on letter labels in the model.
- **Shop checklist**: tick off cut-list rows and assembly steps as you go.
- **X-ray and exploded views** show tenons, mortises, dados and pin holes.
- On a phone, switch between *Model & plans* and *Edit design*.

## Input spec

```json
{
  "projectType": "table",
  "units": "in",
  "dimensions": { "length": 84, "width": 40, "height": 30 },
  "species": "walnut",
  "joinery": "mortise-tenon",
  "options": {
    "tableStyle": "live-edge",
    "widthProfile": "38-1/2, 40, 37, 35-1/2, 36, 33",
    "slabLength": 90,
    "slabThickness": 2.5,
    "steelLegStyle": "u"
  },
  "finish": "oil"
}
```

| Field | Values |
|---|---|
| `projectType` | `table`, `bookshelf` |
| `units` | `in` or `mm`; every length (dimensions, options, kerf) uses it. Inch values may be fractions as strings: `"1-3/4"` |
| `dimensions` | overall finished size. Tables: length × width × height (round: `length` is the diameter). Bookshelves: width × depth × height |
| `species` | `red-oak`, `white-oak`, `walnut`, `hard-maple`, `soft-maple`, `cherry`, `ash`, `poplar`, `pine` |
| `joinery` | tables: `mortise-tenon`, `dowel`, `pocket-screw`; bookshelves: `dado`, `pocket-screw`, `dowel` |
| `finish` | `stain`, `oil`, `paint`, `raw` (default `oil`) |
| `options` | type-specific, all optional with recommended defaults |
| `stock` | optional `{ "kerf": 0.125, "overage": 0.15 }` |

**Table options** — `tableStyle` (`classic`, `live-edge`, `round`).
Legs and aprons: `legStyle` (`straight`/`tapered`), `legThickness`,
`taperFootSize`, `taperStart`, `apronInset`, `apronWidth`, `apronThickness`,
`tenonLength`, `overhang`. Board tops: `topThickness`, `maxTopBoardWidth`.
Slabs: `widthProfile` (comma-separated widths, evenly spaced end to end),
`narrowWidth`, `slabLength`, `slabThickness`, `flattenAllowance`. Butterfly
keys: `butterflyCount`, `butterflyPositions` (from the first end),
`butterflySpecies`, `butterflyLength`, `butterflyThickness`. Steel legs:
`steelLegStyle` (`u`, `trapezoid`, `x`, `hairpin`), `steelLegInset`,
`steelLegWidth`, `steelTubeSize`. Round: `roundTop` (`boards`/`slab`),
`roundBase` (`pedestal`/`four-legs`), `columnSize`, `footSpan`.

**Bookshelf options** — `caseMaterial` (`solid`/`plywood`), `caseThickness`,
`topStyle` (`flush`/`overhang`), `topOverhang`, `kickHeight`, `backPanel`
(`plywood`/`none`), `maxBoardWidth`, `shelfType` (`adjustable`/`fixed`),
`shelfCount`, `shelfThickness`, `shelfLoad` (`light`, `books`, `heavy`).

See `examples/` for one of each.

## How the math works

**Parts are solids, and cut sizes come from the solids.** Each part is built
from hexahedra in its own frame (x = grain/length, y = width, z = thickness).
A tapered leg is a square box over a hexahedron with its foot corners pulled
in. A tenoned apron is a body plus two tenon boxes. A dadoed shelf is a body
plus two tongues. The cut list measures each part's extent, so nothing is
"outer dimension minus a constant". For the 60 × 36 × 30″ table:

- Legs: 30″ − 1″ top = **29″**
- Apron shoulders: 60 − 2 × 1″ overhang − 2 × 1-3/4″ legs = 54-1/2″
- Two aprons meet in each leg at the same height, so their mortises converge.
  Max depth = `T − inset − (apronThk + tenonThk)/2` = 1″, less a 1/16″ glue
  gap → tenons capped at **15/16″** (with a warning)
- Long apron cut length: 54-1/2 + 2 × 15/16 = **56-3/8″**
  (pocket screws or dowels: 54-1/2″)

For a 36″ bookcase with 3/4″ sides, a dadoed shelf is the 34-1/2″ opening
plus two 1/4″ dados = **35″**. An adjustable shelf is 1/16″ shorter than the
opening, so it lifts out.

The tests check the geometry physically, not just the numbers. Every tenon
and shelf tongue sits inside its mortise or dado. Across hundreds of style,
size, joinery and species combinations, no two parts overlap and nothing pokes
outside the overall size.

**Lumber planning.** Parts are grouped by stock thickness. Rough hardwood
gets 1/4″ for milling, snapped to thicknesses yards stock (4/4, 5/4, 6/4,
8/4, 10/4, 12/4, 16/4). Rough boards also lose 1/2″ of width to edge
jointing and 1″ at each end to checks and snipe. Softwood maps to surfaced
nominal sizes. Pieces are packed rip-first into strips and then crosscut,
with a kerf for every cut. Each board is sized to what it carries, so the
last board in a run isn't a half-empty 10-footer. Boards over 10′ carry a
small penalty, so they're used only when they save wood. 15% (configurable)
is added for defects. Plywood is packed onto 4×8 sheets. A back too big for
one sheet splits at the middle fixed shelf.

**Wood movement.** Dimensional change coefficients from the USDA Wood
Handbook give the seasonal movement across a top (4% moisture swing,
flatsawn). The app uses it to size the slots for steel-leg and cleat screws.

**Chair room.** Each side diner gets 26″ of edge between the leg frames
(24″ is the usual minimum). An end seat needs the top at least 24″ wide
there, and 14″ of knee room before a U, trapezoid or X frame (12″ minimum),
or room for knees between the hairpins. Frame legs stay between 4″ and a
quarter of the length in from the ends. The default leg position seats the
most people. On a tie it favours side seats, then more room per person, then
legs nearer the ends. A position you choose that seats fewer gets a warning.

**Butterfly keys.** Bowties with 12° sides (a 4″ key is 1-1/2″ wide at the
ends, 5/8″ at the waist), inlaid in a matching mortise 1/16″ shallower than
the key, so it sands flush. Keys come from an offcut.

**Shelf sag.** `δ = 5wL⁴ / (384 E I)`, using each species' modulus of
elasticity (plywood ≈ 1,000,000 psi). The limit is the common 0.02″ per
foot. When a shelf is over, the app gives the longest span that would pass.

## Adding a project type

Create `src/projects/<type>/index.ts` exporting a `ProjectType`:

- `options`: the schema of type-specific inputs (`length`, `lengthList`,
  `number`, `select`, `boolean`). Each can have defaults that depend on the
  dimensions or earlier options, a form `group`, and `showIf`. The schema
  drives validation, unit conversion and the browser form.
- `supportedJoinery`, `validate`, `dimensionLabels`, `deriveDimensions`
- `build(spec)` returns `Part`s (solids + placement), joints, hardware and
  assembly steps. `shared/panel.ts` splits wide panels into glue-up boards.

Then register it in `src/projects/registry.ts`. The cut list, part letters,
lumber and sheet planning, cost, weight and 3D view all work from the parts.

## Layout

```
src/core/       units, geometry, species data, spec types + normalisation,
                wood movement, shelf sag
src/projects/   table/ (styles, bases, tops), bookshelf/, shared/panel.ts,
                registry
src/output/     cut list, lumber and sheet planning, report
src/ui/         browser app: state (designs, checklist), form, outputs, viewer
src/cli.ts      terminal report
test/           vitest suites, including the all-combinations interference test
```

## Roadmap

- Cabinets (doors, drawers, overlay styles) and benches
- Three-leg round bases (angled joinery), wood trestle bases for slabs
- Bookmatched slabs with an epoxy river
- Butterfly keys placed off the centreline (where the check actually is)
- Mitred tenons for longer tenons in thin legs
- Printable cut sheets (the published page can't print or download files)
