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
| ← → / A D | walk |
| Shift | hold to run |
| ↓ / S | crouch |
| Space / ↑ / W | jump (hold for higher); in the air with wings on, fly (hold to climb, ↓ to dive) |
| J / Z | wave the wand · knocks a walking letter off the screen |
| L | catch the missing letter (and the thing the wings hide in) |
| K / X | cast a spell |
| H | get hurt (demo) |
| E / C | switch wings / put them away (once found) |
| M | sound effects and music on/off (remembered; the voice stays on) |
| N | music on/off (remembered) |
| ? | show/hide controls |
| ` | performance stats |

Gamepads use the standard mapping: stick to move, A jump, Y catch (L), X wand (J), B cast, LB wings, RB run.

**The story.** The fairy is out to earn her wings. The elf boy says hello, then tosses up the first word of a sentence (the grown-ups' panel picks which). It floats to the top of the screen; one letter glows gold for a moment, then melts into lights and floats away. Out on the meadow letters come walking along on little legs: she jumps over the wrong ones (or bounces off their heads), knocks them away with her wand, and catches the missing one with L. A grown-up types `ok` when she says its sound, and again when she reads the word; the elf runs in with a star and the next word. Once the whole sentence is read (and `ok`'d) there's a party, then the elf leads her to a field of balls, boxes and stars. The sentence says which one the Purple Wings hide in; she catches it, and a light show gives her the wings. The elf follows her about from then on.

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
  input/           action-based keyboard + gamepad input with buffered presses and typed words
  audio/           one shared AudioContext (Mixer) with sfx/music/voice buses; sound bank, music playlist, voice-over queue
src/game/          the reading game, built on the engine
  config/          controls, and the audio mix (sound levels, music, voice lines)
  world/           levels as data (parallax layers, sky, camera rest height); MEADOW is the first
  actors/          the player (movement feel, moves, flight), NPCs (idle poses, walk/follow/hop), the star sidekick
  prizes/          wings: styles, the wardrobe she wears (and the flight it gives), the floating pickup
  reading/         sentences, orb letters, the sentence sign, walking letters, the clue things
  quest/           the story's state machine, and when the voice-overs play
  fx/              the scene's effects, the star orbs, the party, the wing ceremony
  game.ts          composes it all: camera, draw order, her moves → effects, sounds and reactions
src/hud/           lit-html overlay
assets/            game-ready art and sounds, served as-is
art/               source art and raw recordings the tools read (not in git)
tools/sprites/     sprite-sheet tools: align-sheet (characters), pack-sheet (props, wings, companions); npm run sprites
tools/audio/       cut-sounds (npm run sounds), fetch-music (npm run music), prep-voice; all need ffmpeg
```

**Adding a level:** describe it in `src/game/world/level.ts` (its layers under `assets/scenes/<level>/`, sky colour, camera height) and pass it to `Game`. Floating shelves are `Terrain` platforms (`game.terrain.platforms.push({ left, right, y })`).

**Adding an effect:** most bursts are a `Spray` constant (count, direction, speed, life, size, colours) launched with `particles.spray(x, y, RECIPE)`; rings and glows are one call each.

Sound effects are CC0 clips from Kenney's packs and Freesound; `assets/sounds/CREDITS.md` lists each source. To swap or add one, edit `tools/audio/sounds.config.json`, run `npm run sounds`, and set its level in `src/game/config/audio.ts`. Music credits are in `assets/music/CREDITS.md`.

In development, `window.game` exposes the game, renderer, loop, input, mixer, voice and music for console debugging.
