# Fairy Sidescroller

A reading game for 4–5 year olds: a 2D side-scroller rendered entirely with WebGPU. The only runtime library is lit-html, used for the DOM HUD. Built to run smoothly on iPads from around 2023.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in a browser with WebGPU: recent Chrome or Edge, or Safari 26 and later.

| Key | Action |
|---|---|
| finger / mouse | tap (click) a letter with the wand · press and slide across a word (while reading) |
| ← → / A D | walk |
| Shift | hold to run |
| ↓ / S | crouch |
| Space / ↑ / W | jump (hold for higher); in the air with wings on, fly (hold to climb, ↓ to dive) |
| J / Z | wave the wand · bops whatever's in front of her |
| L | catch the thing the wings hide in |
| K / X | cast a spell |
| H | get hurt (demo) |
| E / C | switch wings / put them away (once found) |
| M | sound effects and music on/off (remembered; the voice stays on) |
| N | music on/off (remembered) |
| ? | show/hide controls |
| ` | performance stats |

Gamepads use the standard mapping: stick to move, A jump, Y catch (L), X wand (J), B cast, LB wings, RB run.

**The story.** The fairy is out to earn her wings. The elf boy says hello, then tosses a whole sentence up to the top of the screen (the grown-ups' panel picks which); it's the clue to where the wings are. She stands by him and reads it with her wand, and a grown-up beside her confirms each step by typing `ok`:

1. She taps the letter she's on (finger on an iPad, or a mouse click). She raises her wand, a swirl of sparkles flows from it to the letter, and the letter glows gold, staying lit while she says it. Touching a different letter puts it out (and the line dissolves) until she taps hers again.
2. She says its sound; the grown-up types `ok`. The letter pops back to normal, and the next one lights only once she taps it.
3. With every sound said, she puts her finger down on the word's first letter (with the mouse, holds the button down) and slides it to the right: each letter lights as her finger reaches it, and at the last one the word shimmers and fizzes, as often as she likes. She reads it out; the grown-up types `ok`. The word hops for joy and gives her a star. A word of one letter, like "a", skips this: its sound's `ok` reads the word.

After the last word the elf says she's found them all, and a moment after he's said it there's a party. Then the elf leads her to a field of balls, boxes and stars. The sentence says which one the Purple Wings hide in; she catches it (L), and a light show gives her the wings. The elf follows her about from then on. An `ok` typed before she's tapped the letter, or before she's swiped the word, doesn't count.

Letters are drawn by the GPU, not art: a ball-and-stick stroke font (`src/engine/text/stroke-font.ts`) lays out where the orbs go, and each letter is a flock of orbs (`src/engine/fx/swarm.ts`, `src/game/reading/orb-letter.ts`).

## Layout

```
src/engine/        reusable, game-agnostic modules
  core/            fixed-timestep loop (120 Hz sim, interpolated rendering), math (springs, damping, RNG), fetch, settings storage
  gpu/             device setup, textures (premultiplied alpha, GPU mipmaps)
  render/          instanced quad renderer (one buffer upload per frame; shape() and sprite() helpers), procedural
                   shapes in the shader, colours, looping parallax, follow camera, asset loader
  anim/            sprite sheets (from tools/sprites) and the animator
  fx/              particle pool with data-driven Spray recipes, formation swarms (flocks that hold a shape)
  physics/         boxes, reach checks (nearestInFront), terrain: ground plus one-way platforms
  text/            stroke font: points along the letters
  input/           action-based keyboard + gamepad input with buffered presses and typed words; the primary pointer (finger, pen or mouse)
  audio/           one shared AudioContext (Mixer) with sfx/music/voice buses; sound bank, music playlist, voice-over queue
src/game/          the reading game, built on the engine
  config/          controls, and the audio mix (sound levels, music, voice lines)
  world/           levels as data (parallax layers, sky, camera rest height); MEADOW is the first
  actors/          the player (movement feel, moves, flight), NPCs (idle poses, walk/follow/hop), the star sidekick
  prizes/          wings: styles, the wardrobe she wears (and the flight it gives), the floating pickup
  reading/         sentences, orb letters, the sentence sign, the read-along (tapping, sounding out, swiping), the clue things
  quest/           the story's state machine, and when the voice-overs play
  fx/              the scene's effects, the star orbs, the wand stream, the party, the wing ceremony
  game.ts          composes it all: camera, draw order, her moves → effects, sounds and reactions
src/hud/           lit-html overlay
assets/            game-ready art and sounds, served as-is; assets/low/ holds the half-size art
art/               source art and raw recordings the tools read (not in git)
tools/sprites/     sprite-sheet tools: align-sheet (characters), pack-sheet (props, wings, companions), make-low (half-size copies); npm run sprites
tools/audio/       cut-sounds (npm run sounds), fetch-music (npm run music), prep-voice; all need ffmpeg
```

**Two qualities of art.** Every sprite sheet and background has a full-size image and a half-size copy under `assets/low/` (made by `npm run lowres`, which `npm run sprites` also runs; images need even dimensions). Sheets and level layers keep one JSON / definition in full-size coordinates, so the game looks the same either way, just softer. The low tier also caps the drawing buffer at 1080 pixels tall: about a quarter of the GPU memory (36 MB against 145 MB) and far fewer pixels to fill, for older iPads. Which one runs (`chooseTier` in `src/engine/render/quality.ts`): `?quality=high` or `?quality=low` in the URL (remembered); otherwise touch devices and ones reporting under 4 GB start low, others high, and a high start that can't hold 45 fps drops to low mid-game (and starts low from then on). The stats panel (`) shows the tier and buffer size.

**Adding a level:** describe it in `src/game/world/level.ts` (its layers under `assets/scenes/<level>/`, sky colour, camera height) and pass it to `Game`. Floating shelves are `Terrain` platforms (`game.terrain.platforms.push({ left, right, y })`).

**Adding an effect:** most bursts are a `Spray` constant (count, direction, speed, life, size, colours) launched with `particles.spray(x, y, RECIPE)`; rings and glows are one call each.

Sound effects are CC0 clips from Kenney's packs and Freesound; `assets/sounds/CREDITS.md` lists each source. To swap or add one, edit `tools/audio/sounds.config.json`, run `npm run sounds`, and set its level in `src/game/config/audio.ts`. Music credits are in `assets/music/CREDITS.md`.

In development, `window.game` exposes the game, renderer, loop, input, mixer, voice and music for console debugging.
