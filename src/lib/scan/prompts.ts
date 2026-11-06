export const PAGE_PROMPT = `You are reading one image of a page from a product assembly manual, either a photo or a page rendered from a PDF. It can be furniture or anything else that gets assembled, from any brand. Report what is on this page as JSON only, no prose.

{
  "kind": "cover" | "parts" | "hardware" | "tools" | "steps" | "warnings" | "other",
  "product": { "name": "", "brand": "", "type": "", "size": "" },
  "parts": [{ "label": "1", "name": "side panel", "qty": 2, "size": "60 x 30 x 1.8 cm", "notes": "" }],
  "hardware": [{ "label": "A", "kind": "dowel", "qty": 8, "size": "8 x 30 mm" }],
  "tools": ["Phillips screwdriver"],
  "steps": [{ "n": 3, "shows": "what happens in the drawing, in one or two plain sentences", "parts": ["1", "2"], "hardware": [{ "label": "A", "qty": 4 }], "people": 1, "orientation": "upright | upside down | lying on its back | face down | on its side" }],
  "warnings": ["two people needed"]
}

Rules:
- Only include what you can actually see on this page. Leave out empty fields.
- Hardware kinds: dowel, cam bolt, cam lock, screw, nail, shelf pin, bolt, leg bolt, hinge, knob, handle, wall bracket, felt pad, plate, other.
- For steps, say plainly where things go: on top, underneath, left, right, front or back, and which parts touch.
- Read part sizes from any dimension lines or numbers printed next to the drawings.
- A page can hold more than one numbered step. Report each numbered step separately in steps, using the number printed beside its drawing, and keep them in order.
- A parts list, a hardware list or a "you will need" box is not a step. Never report one as a step.
- Large metal pieces that the person fits as a unit, such as a lift mechanism, a gas spring, a hinge, a metal frame or a leg, belong in parts with their printed label. Small screws, dowels, cams, nuts and washers belong in hardware only.
- If the photo shows the box or the finished product rather than a page, use kind "cover", and describe its shape in product.type, like "low media stand with two shelves and a vertical divider, about 70 cm wide".`;

export const PLAN_PROMPT = `You turn an assembly manual into data for an animated 3D step by step guide. You get notes read from images of the manual's pages, in order, and maybe a name the person typed.

Reply with JSON only, no prose:
{
  "name": "LOOP",
  "brand": "Nordwood",
  "variant": "Record player stand",
  "category": "Media stand",
  "size": { "w": 70, "h": 66, "d": 40 },
  "minutes": 35,
  "people": 1,
  "difficulty": 2,
  "archetype": "shelf",
  "fromCover": false,
  "parts": [ { "id": "A", "label": "1", "name": "Side panel", "size": [18, 660, 400], "pos": [-341, 330, 0], "shape": "box", "material": "board" } ],
  "steps": [ { "title": "Tap the dowels into one side", "detail": "Lay it flat with the holes facing up.", "add": [], "fix": [ { "kind": "dowel", "count": 4, "to": ["A"] } ], "tools": ["hammer"], "people": 1, "pose": "upright", "warnings": ["floor"] } ],
  "watchOut": ["One short, common mistake with this product."]
}

Fields:
- name: the product name as printed. brand: the maker. variant: a short plain description. size: outer size in centimetres.
- difficulty: 1, 2 or 3. people: 2 only if a step really needs a second person.
- archetype: the closest of shelf, drawers, table, bed, cabinet, seat, sofa. It is only a backup.

Geometry, read this carefully:
- Units are millimetres.
- One entry per physical piece. Two identical side panels are two entries with different ids and the same label.
- size is [width, height, depth] of the piece as it sits in the FINISHED product. A side panel 18 thick, 660 tall and 400 deep is [18, 660, 400]. A top is [664, 18, 400].
- pos is the centre of the piece in the finished product. y is the height above the floor, x runs left to right seen from the front, z runs from the back (negative) to the front (positive). The product is centred on x = 0 and z = 0 and stands on y = 0.
- Pieces that are joined touch face to face exactly, with no gap and no overlap. Do the arithmetic for every piece: if sides 18 thick stand at x = -341 and x = 341, their inner faces are at -332 and 332, so a top that fits between them is 664 wide.
- Legs, rails, slats and rods are boxes too. Use "shape": "cyl" for round ones, with size [diameter, length, diameter] when upright or [length, diameter, diameter] when lying along x.
- materials: board (particleboard, MDF, plywood), fiber (thin hardboard backs and drawer bottoms), wood (solid wood, legs, slats), metal, soft (cushions, mattresses).
- Large metal pieces that the person fits as a unit, such as a lift mechanism, a gas spring, a hinge, a metal frame, a rail or a leg, are parts too: draw each as a simple box or cylinder with material metal. Leave out small screws, dowels, cams, nuts and washers, which the guide draws as fittings.
- Leave out packaging. At most 60 parts. If there are many identical slats, keep up to 12.

Steps:
- Use one step per numbered step in the manual, in the manual's order. Never split one numbered step into several steps, and never repeat the same action in two steps.
- If a page shows two numbered steps, keep both.
- Never make a step that only lists hardware or tools, like "You'll need four dowels". Hardware belongs to the step that uses it.
- Only make steps that join parts or fit hardware. Skip optional accessories (corner guards, wall straps, care kits), checks and notes, unless the manual makes them part of a numbered assembly step.
- Write each title as one short instruction, under 60 characters. detail is one or two short sentences. Never use em dashes or en dashes.
- add lists the ids of pieces that join the product in that step. Every piece is added exactly once, in the first step that uses it.
- fix lists the hardware used in that step and how many. kind is one of: dowel, camScrew (cam bolt or connecting screw), cam (cam lock disc), screw, nail, pin (shelf pin), bolt (allen bolt or machine screw), legScrew (double ended leg bolt), hinge, knob, handle, bracket (wall fixing), glide (felt pad), plate. Use "to" with the ids it goes into when the manual makes that clear. Add len and dia in mm when they are printed.
- pose is how the product lies while you work: upright, upside_down, on_back (front facing up), face_down (back facing up), on_left_side, on_right_side. Follow the drawings: when a step shows the product upside down, on its back or on its side, set pose to match, and set it back to upright when the drawing does.
- tools: allen, screwdriver, flathead, hammer, drill, wrench, level, tape, pencil, knife.
- warnings: two (needs two people), floor (work on a soft surface), loose (don't fully tighten yet), hand (hand tight only), wall (fix it to the wall), tip (can tip over), square (check it is square), face (mind which way the finished side faces).
- Usually 6 to 20 steps.

If you only have the cover or a photo of the product, design the most typical assembly for that exact product, with the usual pieces, hardware and steps for its shape and size, and set "fromCover": true.

Example, a small bedside table:
{"name":"KUBO","brand":"Acme","variant":"Bedside table","category":"Bedside table","size":{"w":40,"h":50,"d":35},"minutes":25,"people":1,"difficulty":1,"archetype":"cabinet",
"parts":[{"id":"A","label":"1","name":"Side panel","size":[16,500,350],"pos":[-192,250,0]},{"id":"B","label":"1","name":"Side panel","size":[16,500,350],"pos":[192,250,0]},{"id":"C","label":"2","name":"Top","size":[368,16,350],"pos":[0,492,0]},{"id":"D","label":"3","name":"Bottom","size":[368,16,350],"pos":[0,58,0]},{"id":"E","label":"4","name":"Back panel","size":[396,496,3],"pos":[0,252,-176.5],"material":"fiber"}],
"steps":[{"title":"Tap the dowels into the top and bottom","fix":[{"kind":"dowel","count":8,"to":["C","D"]}],"tools":["hammer"]},
{"title":"Fit the top and bottom to one side","add":["A","C","D"],"fix":[{"kind":"camScrew","count":4}],"pose":"on_back"},
{"title":"Lock the cam locks","fix":[{"kind":"cam","count":4}],"tools":["screwdriver"],"pose":"on_back"},
{"title":"Add the other side","add":["B"],"fix":[{"kind":"camScrew","count":4},{"kind":"cam","count":4}],"tools":["screwdriver"],"pose":"on_back"},
{"title":"Nail on the back panel","detail":"Start at the corners.","add":["E"],"fix":[{"kind":"nail","count":12}],"tools":["hammer"],"pose":"face_down","warnings":["square"]},
{"title":"Stand it up","pose":"upright"}]}
The top (368 wide) fits between the sides, whose inner faces are at x = -184 and 184. The back panel sits behind the sides, touching their back edges at z = -175.`;

export function planInput(pages: unknown[], hint: string) {
  const lines = [hint ? `The person says it is: ${hint}` : "The person didn't type a name.", `Pages read, in order (${pages.length}):`];
  pages.forEach((p, i) => lines.push(`Page ${i + 1}: ${JSON.stringify(p)}`));
  return lines.join("\n");
}

export function repairInput(issues: string[]) {
  return `Some parts don't fit together yet:\n${issues.map((x) => `- ${x}`).join("\n")}\nFix the sizes and positions so joined pieces touch face to face, then reply with the full corrected JSON only.`;
}
