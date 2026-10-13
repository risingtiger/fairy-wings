I'm attaching two files from my game: `elf.png` (a sprite sheet of an elf boy) and `elf.json` (its frame data). Please make a NEW sprite sheet of the same elf boy doing a full set of movements: walking, running, jumping, landing, throwing, catching, crouching, taking off, flying, levitating, fast flying and landing from flight. Give me back `elf-moves.png` and `elf-moves.json` in the exact format below, ready to drop into my game with no editing.

## Keep the character exactly the same (use the attached sheet as the model)
Only the pose and expression change. Everything else must match the reference:
- **Proportions:** chibi, about 3 heads tall. His head must be the same size in every frame, matching the reference.
- **Hair:** fluffy, messy, pale cream-blonde hair with a soft mint-green tint near the tips. One looped curl (ahoge) on top.
- **Face:** long pointed elf ears, big glossy green eyes, a small gentle smile, light blush.
- **Outfit:** a green hooded capelet made of layered leaf shapes, with gold trim, light-green leaf prints, and a small gold clasp at the collar. A light-green tunic with leaf patterns and a pointed hem. A dark-green sash with a white flower. Wide cream sleeves with green leaf prints. Dark-green puffy shorts. White tights. Cream boots with dark-green cuffs and stripes, each with a white flower.
- **Flowers:** all flowers are white with five petals and yellow centres (collar, sash, both boots).
- **Art style:** the same soft anime / storybook look. Clean thin dark outlines, soft cel shading with gentle gradients, the same colour palette and the same light direction as the reference.
- **Direction:** every frame shows him facing and moving toward the **viewer's right**, in a side / 3/4 view. The game flips him in code to go left, so do NOT draw any frames facing left.
- **Draw only the boy.** No wings, no thrown objects, no sparkles, no motion lines, no dust, no shadows and no ground. The game draws all of those itself (see "Sockets" below).
- He is a happy, bouncy little character in a game for 4–5 year olds: keep the movement lively, clear and cute. Let the capelet leaves, sleeves and hair swing and trail to sell the motion.

## The 28 frames
**Walking (looping cycle, 4 frames):**
- `walk1` – contact: front heel touching down, back toe pushing off, legs apart, arms swinging opposite to the legs.
- `walk2` – passing: weight on one leg, the other knee lifting past it, body slightly higher.
- `walk3` – contact with the other leg in front (a mirror of `walk1`'s legs and arms).
- `walk4` – passing with the other leg (a mirror of `walk2`).

**Running (looping cycle, 4 frames):** leaning forward, bigger strides, elbows bent and pumping, hair and capelet streaming back.
- `run1` – contact: front foot strikes the ground, back leg extended behind.
- `run2` – flight: both feet off the ground, front knee high, back leg kicked up behind.
- `run3` – contact with the other leg in front (a mirror of `run1`).
- `run4` – flight with the other leg (a mirror of `run2`).

**Ground moves:**
- `crouch` – squatting low, knees deeply bent, hands on his knees, peeking forward with a curious look. Both boots on the ground.
- `jumpStart` – the wind-up: knees bent, arms swung down and back, about to spring. Both boots on the ground.
- `jumpUp` – rising: arms thrown up, knees tucked, big excited smile.
- `fall` – coming down: arms out to the sides for balance, legs stretched down toward the ground, eyes looking down.
- `land` – the impact: knees bent and absorbing the landing, arms out to the sides, capelet bouncing up. Both boots on the ground.

**Throwing (plays in order, 3 frames):** throwing a small ball-sized object, about the size of his head, forward and up.
- `throw1` – wind-up: throwing arm pulled back behind his shoulder, hand cupped as if holding the object, front arm pointing at the target, weight on the back foot.
- `throw2` – release: throwing arm swinging forward and up at about shoulder height, hand opening, weight moving onto the front foot.
- `throw3` – follow-through: throwing arm extended forward and across, leaning in, watching the object fly away happily.

**Catching (plays in order, 2 frames):**
- `catch1` – reaching: both arms stretched up and forward with hands open to receive something, on his tiptoes, eyes wide and eager.
- `catch2` – caught: both hands cupped together at chest height holding the object close, delighted, squeezed-eye smile.

**Flying:** he flies magically. The game attaches separate wing sprites to his back, so do NOT draw wings. Keep the area between his shoulder blades clear.
- `liftOff1` – gathering: a deep crouch, arms swept down and back, looking up at the sky.
- `liftOff2` – springing up: body stretched tall, arms thrown up, toes pointed down and just leaving the ground, capelet flaring down.
- `fly1` – cruising: body tilted forward about 20°, one arm reaching forward, the other trailing, legs relaxed and trailing slightly behind, joyful look.
- `fly2` – the same cruise a moment later (for a gentle bob): arms swapped or softly shifted, legs slightly bent, capelet rippling the other way.
- `levitate1` – floating calmly in place: upright, arms held out slightly at his sides with palms down, toes pointed, legs gently together, eyes softly closed and smiling.
- `levitate2` – the same float a moment later: arms a little higher, one knee slightly bent, hair and capelet drifting upward.
- `flyFast1` – dashing: body leaning far forward (about 55–65° from upright), both arms stretched forward like a superhero, legs straight back, hair and capelet streaming hard behind him, determined grin.
- `flyFast2` – the same dash a moment later: legs and capelet fluttering in a different position.
- `flyLand1` – coming in to land: upright and descending feet first, arms out for balance, legs reaching down, capelet floating up.
- `flyLand2` – touchdown: both boots on the ground, knees softly bent, arms coming down, capelet and hair still settling.

## Exact output format: `elf-moves.png`
- PNG, RGBA, with **real transparent alpha** (not a checkerboard pattern, and no white or black background).
- **Clean edges:** smooth anti-aliased edges with no dark or grey halo, no leftover background fringe, and no stray semi-transparent specks. Every pixel outside the character must have alpha = 0.
- **Image size: exactly 4928 × 3072 px.** A grid of 7 columns × 4 rows, with every cell exactly **704 × 768 px**. Each frame's cell starts at `x = column × 704`, `y = row × 768`:
  - Row 0: `walk1` `walk2` `walk3` `walk4` `run1` `run2` `run3`
  - Row 1: `run4` `crouch` `jumpStart` `jumpUp` `fall` `land` `throw1`
  - Row 2: `throw2` `throw3` `catch1` `catch2` `liftOff1` `liftOff2` `fly1`
  - Row 3: `fly2` `levitate1` `levitate2` `flyFast1` `flyFast2` `flyLand1` `flyLand2`
- **Same scale as the reference, which is very important:** when he stands upright, the distance from his boot soles to the top of his hair curl is about **605 px**, and his head (from chin to the top of his hair, not counting the curl) is about **200 px** tall. His head is that size in every frame, even when he crouches, leans or flies. Do not draw him bigger or smaller. The game uses a fixed pixel scale, so changing his size would change his size in the game.
- **The anchor point (pivot) is at x = 352, y = 756 in every cell** (measured from the cell's top-left). In the game this point is where his feet touch the ground. How to line each frame up to it:
  - **Frames with a foot on the ground** (walk, `run1`, `run3`, `crouch`, `jumpStart`, `land`, throws, catches, `liftOff1`, `flyLand2`): the lowest boot sole sits on the line **y = 756**. His hips are centred on **x = 352**.
  - **Walk and run cycles:** keep his hips at x = 352 in all 4 frames of each cycle, so he doesn't jitter sideways while the game moves him. It's fine (and good) for his body to bob up and down between frames.
  - **Airborne frames** (`run2`, `run4`, `jumpUp`, `fall`, `liftOff2`, `fly`, `levitate`, `flyFast`, `flyLand1`): draw him at the same height he would be standing up, with his head centre about 444 px above y = 756, so the game can move him through the air itself. His hips (or, in `flyFast`, the middle of his body) go on x = 352. Nothing hangs below y = 756.
- **Fit inside the cell:** keep at least **16 px** of empty transparent space between the character and every edge of his cell. No cropping, and nothing reaching into a neighbouring cell. The game samples the sheet at reduced sizes, so this margin stops frames from bleeding into each other.
- Render at full native resolution with crisp line art and full detail, as sharp as the reference or sharper. Do not upscale a small image, do not blur, and do not add compression artifacts, noise or text/watermarks.

## Sockets (attachment points the game uses)
Measure every point in pixels **relative to the pivot** (x positive to the right, y negative going up): `point = [xInCell − 352, yInCell − 756]`.
- `head` (every frame) – the centre of his face/head. When he stands upright this is about `[0, −444]`. The game uses it to place speech bubbles and effects, so it has to be accurate to within about 10 px.
- `back` (every frame, in `sockets`) – the point between his shoulder blades on the surface of his back/capelet, where the game attaches his wings. Rotate it along with his body when he leans.
- `hand` (only in `throw1`, `throw2`, `throw3`, `catch1` and `catch2`, in `sockets`) – the centre of the space inside his throwing or catching hand(s), where the game draws the object. In `throw3`, put it where the object has just left his hand.

## Exact output format: `elf-moves.json`
Use this structure exactly: the same keys and the same nesting. Put all 28 frames in `frames`. Each frame's `x`/`y` is its cell's top-left corner, and `w`/`h` is always 704/768:
```json
{
  "image": "elf-moves.png",
  "cell": { "w": 704, "h": 768 },
  "pivot": { "x": 352, "y": 756 },
  "frames": {
    "walk1":  { "x": 0,    "y": 0,    "w": 704, "h": 768, "head": [HX, HY], "sockets": { "back": [BX, BY] } },
    "throw1": { "x": 4224, "y": 768,  "w": 704, "h": 768, "head": [HX, HY], "sockets": { "back": [BX, BY], "hand": [AX, AY] } },
    "...": "one entry for each of the 28 frames, in the row order above"
  },
  "animations": {
    "walk":      { "frames": ["walk1", "walk2", "walk3", "walk4"], "fps": 8,  "loop": true },
    "run":       { "frames": ["run1", "run2", "run3", "run4"],     "fps": 12, "loop": true },
    "crouch":    { "frames": ["crouch"],    "loop": true },
    "jumpStart": { "frames": ["jumpStart"], "fps": 12 },
    "jumpUp":    { "frames": ["jumpUp"],    "loop": true },
    "fall":      { "frames": ["fall"],      "loop": true },
    "land":      { "frames": ["land"],      "fps": 12 },
    "throw":     { "frames": ["throw1", "throw2", "throw3"], "fps": 12 },
    "catch":     { "frames": ["catch1", "catch2"], "fps": 10 },
    "liftOff":   { "frames": ["liftOff1", "liftOff2"], "fps": 10 },
    "fly":       { "frames": ["fly1", "fly2"], "fps": 4, "loop": true },
    "levitate":  { "frames": ["levitate1", "levitate2"], "fps": 2, "loop": true },
    "flyFast":   { "frames": ["flyFast1", "flyFast2"], "fps": 8, "loop": true },
    "flyLand":   { "frames": ["flyLand1", "flyLand2"], "fps": 10 }
  }
}
```
- Replace the placeholders (`HX, HY`, `BX, BY`, `AX, AY`) with numbers measured from the finished image, and remove the `"..."` line. Don't copy example numbers.
- Output plain JSON: 2-space indentation, no comments, no trailing commas.

## How to produce it (please follow)
1. Generate the poses as separate images of the same character, using the attached sheet as the reference for look and scale. Work in batches if that helps (for example: walk + run, then ground moves, then throw/catch, then flying), and keep comparing each new pose against the reference and the poses you've already made so the character stays identical throughout.
2. Then use code (Python + Pillow/NumPy) to build the final sheet: remove the background to true alpha, clean the edges (no halo, set alpha to 0 below about 24), scale each pose so his head matches the reference head size, and place each pose in its cell using the pivot rules above.
3. Measure `head`, `back` and `hand` for each frame from the placed image and write `elf-moves.json`.
4. **Check before you hand it over** (run these checks in code and tell me the results):
   - The PNG is exactly 4928×3072 and RGBA, and the corners and gutters are fully transparent.
   - No non-transparent pixel is within 16 px of any cell border.
   - In every grounded frame, the lowest boot pixel is at y = 755–756 in its cell. In every airborne frame, no pixel is below y = 756.
   - In the walk and run cycles, the hip centre varies by no more than ±6 px in x across the 4 frames.
   - The head height in pixels is within ±3% of the reference in all 28 frames.
   - The JSON parses, has all 28 frames, its frame rectangles match the grid, and every name used in `animations` exists in `frames`.
   - Make a contact sheet of the 28 frames with their names, and a strip of each animation in order. Look at them and confirm the cycles flow smoothly and the character looks the same in every frame.
5. Give me the two files as downloads named exactly `elf-moves.png` and `elf-moves.json`.
