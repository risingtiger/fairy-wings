I'm attaching two files from my game: `elf.png` (a sprite sheet of an elf boy NPC) and `elf.json` (its frame data). Please make a NEW version of this sheet with 6 idle poses that look clearly different from each other. Give me back a new `elf.png` and `elf.json` in the exact format below, ready to drop into my game with no editing.

## The problem
The 6 poses in the current sheet are almost the same: same stance, arms hanging down, same expression. In the game the elf stands still as an NPC and switches to a random pose every 2–4 seconds, fading between them. Because the poses are so alike, he looks frozen. I want each pose to show a different moment of personality, so a child watching him sees him doing something new.

## Keep the character exactly the same (use the attached sheet as the model)
Only the pose and expression change. Everything else must match the reference:
- **Proportions:** chibi, about 3 heads tall. His head must be the same size in every frame, matching the reference.
- **Hair:** fluffy, messy, pale cream-blonde hair with a soft mint-green tint near the tips. One looped curl (ahoge) on top.
- **Face:** long pointed elf ears, big glossy green eyes, a small gentle smile, light blush.
- **Outfit:** a green hooded capelet made of layered leaf shapes, with gold trim, light-green leaf prints, and a small gold clasp at the collar. A light-green tunic with leaf patterns and a pointed hem. A dark-green sash with a white flower. Wide cream sleeves with green leaf prints. Dark-green puffy shorts. White tights. Cream boots with dark-green cuffs and stripes, each with a white flower.
- **Flowers:** all flowers are white with five petals and yellow centres (collar, sash, both boots).
- **Art style:** the same soft anime / storybook look. Clean thin dark outlines, soft cel shading with gentle gradients, the same colour palette and the same light direction as the reference.
- **Facing:** every pose faces the same way as the reference, a 3/4 view turned toward the viewer's right. The game flips him in code, so do NOT draw any poses facing left.

## The 6 new poses (each should be recognisable from its silhouette alone)
1. `idle1` – **Friendly wave:** one arm raised high and waving, hand open, the other hand relaxed at his side. Bright open smile.
2. `idle2` – **Thinking:** one finger tapping his chin, the other arm folded across his tummy, head tilted, eyes looking up. Slightly puckered "hmm" mouth.
3. `idle3` – **Excited cheer:** both fists raised up to shoulder height, up on his toes, eyes squeezed into happy arcs (^ ^), big open-mouth grin.
4. `idle4` – **Reading:** holding a small open storybook (green leaf cover, cream pages) in both hands at chest height, looking down at it with a soft, delighted smile.
5. `idle5` – **Look over there!:** one arm stretched out pointing forward and slightly up (toward the viewer's right), the other hand on his hip, leaning a little into the point, eager expression.
6. `idle6` – **Shy, rocking on his heels:** hands clasped behind his back, shoulders raised, head tilted, gentle closed-eye smile, one toe tipped up.

Rules for all 6 poses:
- His feet and boots must be planted in the same spot in every frame (his weight can shift, but his feet must not slide). The game fades directly from one pose to another, so planted feet make the change look like a natural movement and not a teleport.
- Show clear secondary motion: the capelet leaves, sleeves and hair should hang or swing to match each pose.
- Everything he does must fit inside his own cell (see below). Nothing gets cropped, and nothing reaches into a neighbouring cell.
- This is a game for 4–5 year olds: keep every pose warm, gentle and readable at a glance.

## Exact output format: `elf.png`
- PNG, RGBA, with **real transparent alpha** (not a checkerboard pattern, and no white or black background).
- **Clean edges:** smooth anti-aliased edges with no dark or grey halo, no leftover background fringe, and no stray semi-transparent specks. Every pixel outside the character must have alpha = 0.
- **Image size: exactly 1536 × 1440 px.** A grid of 3 columns × 2 rows, with every cell exactly **512 × 720 px**:
  - Row 1 (y 0–719): `idle1` at x 0, `idle2` at x 512, `idle3` at x 1024
  - Row 2 (y 720–1439): `idle4` at x 0, `idle5` at x 512, `idle6` at x 1024
- **Same scale as the reference, which is very important:** with the elf standing upright, the distance from his boot soles to the top of his hair curl is about **605 px**, and his head (from chin to the top of his hair, not counting the curl) is about **200 px** tall. Do not draw him bigger or smaller. The game uses a fixed pixel scale, so changing his size would change his size in the game.
- **Feet anchor (pivot):** in every cell, his boot soles sit on the line **y = 712** (measured from the top of the cell), and the midpoint between his two boots is at **x = 256** (measured from the left of the cell). This point is the same in every cell.
- Keep at least 8 px of empty transparent space between the character and every edge of the cell.
- Render at full native resolution with crisp line art and full detail, as sharp as the reference or sharper. Do not upscale a small image, do not blur, and do not add compression artifacts, noise or text/watermarks.

## Exact output format: `elf.json`
Use this structure exactly: the same keys and the same nesting. Put `head` and `source` in every frame:
```json
{
  "image": "elf.png",
  "cell": { "w": 512, "h": 720 },
  "pivot": { "x": 256, "y": 712 },
  "frames": {
    "idle1": { "x": 0,    "y": 0,   "w": 512, "h": 720, "head": [HX, HY], "sockets": {}, "source": { "x": 0,    "y": 0,   "w": 512, "h": 720, "scale": 1, "match": 1 } },
    "idle2": { "x": 512,  "y": 0,   "w": 512, "h": 720, "head": [HX, HY], "sockets": {}, "source": { "x": 512,  "y": 0,   "w": 512, "h": 720, "scale": 1, "match": 1 } },
    "idle3": { "x": 1024, "y": 0,   "w": 512, "h": 720, "head": [HX, HY], "sockets": {}, "source": { "x": 1024, "y": 0,   "w": 512, "h": 720, "scale": 1, "match": 1 } },
    "idle4": { "x": 0,    "y": 720, "w": 512, "h": 720, "head": [HX, HY], "sockets": {}, "source": { "x": 0,    "y": 720, "w": 512, "h": 720, "scale": 1, "match": 1 } },
    "idle5": { "x": 512,  "y": 720, "w": 512, "h": 720, "head": [HX, HY], "sockets": {}, "source": { "x": 512,  "y": 720, "w": 512, "h": 720, "scale": 1, "match": 1 } },
    "idle6": { "x": 1024, "y": 720, "w": 512, "h": 720, "head": [HX, HY], "sockets": {}, "source": { "x": 1024, "y": 720, "w": 512, "h": 720, "scale": 1, "match": 1 } }
  },
  "animations": {
    "idle": { "frames": ["idle1", "idle2", "idle3", "idle4", "idle5", "idle6"], "loop": true }
  }
}
```
- `head` is the **centre of his face/head in that frame, measured relative to the pivot** in pixels: x is positive to the right, y is negative going up. Formula: `head = [headCentreX_inCell − 256, headCentreY_inCell − 712]`. In the reference, an upright head is about `[0, −444]`. Measure each frame from the finished image; don't copy the example numbers. The game uses this value to place speech bubbles above his head, so it has to be accurate to within about 10 px.
- Output plain JSON: 2-space indentation, no comments, no trailing commas.

## How to produce it (please follow)
1. Generate each pose as its own image of the same character, using the attached sheet as the reference for both look and scale.
2. Then use code (Python + Pillow/NumPy) to build the final sheet: remove the background to true alpha, clean the edges (no halo, set alpha to 0 below about 24), scale each pose so his head matches the reference head size, and place each pose so its boot soles land on y = 712 with the midpoint between the boots at x = 256 in its cell.
3. Measure each frame's head centre from the placed image and write `elf.json`.
4. **Check before you hand it over** (run these checks in code and tell me the results):
   - The PNG is exactly 1536×1440 and RGBA, and the corners and gutters are fully transparent.
   - No non-transparent pixel touches or crosses a cell border, and every pose has at least 8 px of empty margin.
   - In every cell, the lowest boot pixel is at y = 711–712.
   - The head height in pixels is within ±3% of the reference in all 6 frames.
   - The JSON parses, and its frame rectangles match the grid.
   - Put the 6 poses side by side as silhouettes (solid black fill) and confirm each one is clearly different.
5. Give me the two files as downloads named exactly `elf.png` and `elf.json`.
