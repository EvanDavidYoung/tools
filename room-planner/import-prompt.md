# Room Planner import prompt

Copy everything below the line into ChatGPT, Claude or Gemini, then send it what
you have: photos of the room, a floor plan, a rental listing, furniture model
numbers, or numbers off a tape measure. It will ask for whatever it still needs
and hand back a block of JSON. Paste that into Room Planner's **Import a room**
box.

---

You are helping me turn a real room into a floor plan for a browser tool called
Room Planner. Your only job is to end up with one JSON object describing my room
and my furniture. Work in **inches** throughout.

## How to run this

0. If I paste you a layout in the format below, I'm asking you to *change* an existing
   one: edit it and hand the whole thing back in the same shape.
1. Ask me for what you need, a few questions at a time, in plain language. Start
   with the room itself, then the windows/doors/radiators/closets, then the
   furniture.
2. I may send photos, a floor plan, a listing, product links, or measurements.
   Read dimensions straight off a floor plan or a tape measure in a photo when
   you can.
3. **Never guess a scale from a photo alone.** If you only have pictures, ask me
   for one known length — a wall, a doorway width, the bed — and scale from that.
4. If I don't know something, fall back to a standard size, and list every
   assumption you made *before* the JSON so I can correct you.
5. Round to the nearest half inch. Don't pad "for safety" — the tool does
   clearance checks itself, and inflated sizes make them wrong.

## The coordinate system

- The plan is seen from above. **x** runs left→right, **y** runs top→bottom, and
  `(0, 0)` is the room's top-left inside corner.
- Walls are named like a compass rose on that drawing: **N** = top, **S** =
  bottom, **W** = left, **E** = right. Which real-world direction is "up" doesn't
  matter — pick whatever made the room easiest to describe and tell me what you
  picked.
- For anything attached to a wall, `offset` is how far along that wall it starts,
  measured from the corner nearest the top-left: from the **left** end for the N
  and S walls, from the **top** end for the W and E walls.
- `w` is always the left-to-right size, `d` the top-to-bottom size.

## The JSON

Output exactly one fenced ```json block, with this shape:

```json
{
  "room": {
    "name": "Bedroom",
    "w": 132,
    "d": 132,
    "openings": [
      { "type": "window",   "wall": "W", "offset": 12, "width": 36 },
      { "type": "door",     "wall": "E", "offset": 96, "width": 32, "hinge": "end" },
      { "type": "radiator", "wall": "W", "offset": 15, "width": 30, "depth": 9 },
      { "type": "closet",   "wall": "S", "offset": 0,  "width": 60, "depth": 29,
        "clearance": 20, "doors": 2, "inside": false }
    ]
  },
  "items": [
    { "name": "Queen bed", "w": 60, "d": 80, "x": 6, "y": 4, "rot": 0,
      "color": "#8fb3d9", "kind": "bed" },
    { "name": "Nightstand", "w": 20, "d": 16, "x": 68, "y": 4, "color": "#c9a27a" },
    { "name": "Rug 8×10", "w": 96, "d": 120, "x": 18, "y": 6,
      "color": "#e8cfae", "floor": true }
  ]
}
```

### room

| Field | Meaning |
|---|---|
| `name` | What I call the room. |
| `w`, `d` | Inside floor dimensions, inches, wall to wall. |
| `openings` | Everything fixed to the walls. Leave it `[]` if I haven't told you any. |

### openings

- **`window`** — `wall`, `offset`, `width`. Drawn in the wall itself; furniture is
  allowed in front of one, so don't fake a clearance zone with a fat window.
- **`door`** — `wall`, `offset`, `width`, `hinge`. `width` is the doorway opening
  (32 is typical for an interior door, 36 for an entry). `hinge` is `"start"` if
  the hinges are at the low-`offset` end of the opening, `"end"` if they're at the
  high end. The tool reserves a square of `width × width` for the swing, so a
  sliding, pocket or removed door should be a `door` with the right `width`
  anyway — tell me if you did that and I'll delete the swing myself.
- **`radiator`** — `wall`, `offset`, `width`, `depth` (how far it juts into the
  room). Use this for any solid wall fixture furniture must not cover: baseboard
  heaters, a hearth, a bulkhead.
- **`closet`** — `wall`, `offset`, `width`, `depth`, `clearance`, `doors`,
  `inside`. `depth` is front-to-back inside the closet. `clearance` is the strip
  of floor the doors need (about 20 for bifolds, 0 for sliders). `doors` is how
  many door panels to draw. `inside` is `false` for a closet recessed into the
  wall (the usual case — it sits outside the room rectangle and costs no floor
  space), `true` for one boxed out into the room, which *does* eat floor space, in
  which case `w`/`d` above must be the full room rectangle including that box.

### items

One entry per piece of furniture.

| Field | Meaning |
|---|---|
| `name` | Short label drawn on the piece. |
| `w`, `d` | Footprint. `w` is side-to-side and `d` front-to-back **as the piece is drawn unrotated** — a bed's `d` is head-to-foot. |
| `x`, `y` | Top-left corner of the footprint where it sits in the room, *after* any rotation. Optional; leave them out and the tool drops the piece in the middle for me to drag. |
| `rot` | `0`, `90`, `180` or `270`, clockwise. At `0` a bed's headboard is at the top (N). At `90` it's against the E wall. |
| `color` | Hex. Pick from the palette below so the plan stays readable. |
| `kind` | `"bed"` draws a headboard and pillows, `"round"` draws an ellipse (chairs, lamps, plants, round tables). Omit for a plain rectangle. |
| `floor` | `true` for rugs only — they're drawn underneath and never count as a collision. |

Palette: beds `#8fb3d9` · wood storage `#b88b5e` · dark wood `#a0764c` · light wood
`#c9a27a` · desks `#9aa57a` · chairs `#6f7d5a` · soft seating `#d39b8b` ·
electronics `#7d7d7d` · rugs `#e8cfae` · lamps `#f0d36b` · plants `#6bab6b`.

### Standard sizes, if I don't know mine

Twin 39×75 · Full 54×75 · Queen 60×80 · King 76×80 · nightstand 20×16 · dresser
60×18 · tall dresser 34×18 · wardrobe 40×24 · bookshelf 32×12 · desk 48×24 · desk
chair 24×24 · armchair 32×32 · bench 48×16 · TV stand 48×16 · 5×8 rug 60×96 ·
8×10 rug 96×120 · interior door 32 · entry door 36.

## Before you print the JSON

Check all of these, and fix anything that fails:

- Every item sits fully inside the room: `0 ≤ x`, `x + w ≤ room.w`, `0 ≤ y`,
  `y + d ≤ room.d` (using the rotated footprint).
- No two non-`floor` items overlap, and none sits on a radiator or inside a door
  swing or a closet's clearance strip.
- There's a walkway of at least 30 inches through the room and to the door, and
  at least 24 inches of clear floor along any side of a bed that isn't against a
  wall.
- Numbers are plain numbers, not strings like `"5 feet"`, and the JSON parses.

Then reply with, in this order: a short list of the assumptions you made, a
one-line note of which wall you called N, and the single ```json block. No other
text after the block.
