# Fairy Sidescroller

A reading game for 4–5 year olds: a 2D side-scroller rendered entirely with WebGPU. The only runtime library is lit-html, used for the DOM HUD.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in a browser with WebGPU: recent Chrome or Edge, or Safari 26 and later.

| Key | Action |
|---|---|
| ← → / A D | walk |
| Shift | hold to run |
| ↓ / S | crouch |
| Space / ↑ / W | jump (hold for higher) · under the word, puts the letter in |
| U | talk to the elf |
| J / Z | wave the wand · knocks a walking letter off the screen |
| L | catch the missing letter |
| K / X | cast a spell |
| H | get hurt (demo) |
| E / C | switch wings / put them away (once found) |
| Space in the air | fly (wings worn): hold to climb, ↓ to dive |
| M | sound effects on/off (remembered) |
| ? | show/hide controls |
| ` | performance stats |

Gamepads use the standard mapping: stick to move, A jump, Y catch (L), X wand (J), B cast, LB wings, RB run.

**The story.** The fairy wants to earn her wings. The elf boy next to the start tells her she needs ten stars. Each round he shows a word with one letter missing (CAT, SUN, DOG, …); the gap shows the missing letter as a dotted outline, like a tracing sheet. The missing letter bursts out of the elf as a flurry of little lights, swirls up into its shape over his head, and flies off screen, left or right, to hide. It finds the leafiest spot near its round's place on the meadow, sometimes up where she has to jump, and takes on the colours of the leaves behind it, so it is still a letter but hard to see. Nothing gives it away as she walks past. Standing in front of it, she waves her wand (J) to catch it: it lights up, bursts apart and flocks back together beside the star sidekick, following it like a little school of fish. Under the word she jumps, and the letter flies up into its place. The word reads itself out letter by letter, a star pops out, and the sidekick rounds it up into the line of stars trailing behind it. Ten stars bring the Purple Wings floating down to her, and she puts them on.

All the letters are drawn from code, not art: a ball-and-stick stroke font (`src/engine/text/stroke-font.ts`) lays out where the orbs go, and each letter is a flock of orbs (`src/engine/fx/swarm.ts`, `src/game/orb-letter.ts`). How hard the hidden letters are to spot is set by `CAMO` in `orb-letter.ts`.

The elf and the star read every line aloud with the browser's built-in speech, so a child who can't read yet can still play. Speech bubbles show the same words. After 25 seconds of searching, the star starts pointing the way; after 35, once she is close, it makes the hidden letter twinkle every few seconds.

Both pairs of wings float over the start the whole time, just higher than she can jump. The Purple Wings are mid-tier: smaller, a third of the height, 3 seconds per flight, refilled on landing. The Rainbow Wings (two screens high, no time limit) stay out of reach for now. Once she owns wings, E puts them on or away. The star dozes off if she stands still.

## Layout

```
src/engine/   reusable, game-agnostic
  gpu/        device setup, texture loading (premultiplied alpha), GPU mipmaps
  render/     instanced sprite/shape batcher (one buffer upload per frame), looping parallax (and what colour it shows where)
  anim/       sprite sheets (from tools/sprites) and the animator
  fx/         fixed-pool particle system, formation swarms (flocks that hold a shape); no per-frame allocation
  text/       ball-and-stick stroke font: points along the letters, for drawing them out of dots or particles
  input/      action-based keyboard + gamepad input with buffered presses
  audio/      sound effects (Web Audio, decoded up front, varied per play), read-aloud lines through speech synthesis
  core/       fixed-timestep loop (120 Hz sim, interpolated rendering), math helpers
src/game/     the opening scene: player, elf NPC, reading quest (words.ts, quest.ts, letters.ts, orb-letter.ts, star-trail.ts), effects
src/hud/      lit-html overlay
assets/       game-ready art and sounds, served as-is
tools/sprites/ sprite-sheet tools: align-sheet (characters, incl. multi-sheet idle sets), pack-sheet (props, wings, companions); npm run sprites rebuilds all
tools/audio/  cut-sounds: downloads the free sound packs, cuts and normalises each take; npm run sounds rebuilds all (needs ffmpeg)
```

Sound effects are CC0 clips from Kenney's packs; `assets/sounds/CREDITS.md` lists each source. To swap or add one, edit `tools/audio/sounds.config.json`, run `npm run sounds`, and set its level in `src/game/sounds.ts`.

In development, `window.game` exposes the scene, renderer, loop and input for console debugging.
