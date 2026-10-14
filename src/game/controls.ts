import type { InputBindings } from '../engine/input/input';

export const ACTIONS = ['left', 'right', 'down', 'jump', 'run', 'attack', 'cast', 'wings', 'hurt', 'mute', 'debug', 'help'] as const;
export type Action = (typeof ACTIONS)[number];

export const BINDINGS: InputBindings<Action> = {
  keys: {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    down: ['ArrowDown', 'KeyS'],
    jump: ['Space', 'ArrowUp', 'KeyW'],
    run: ['ShiftLeft', 'ShiftRight'],
    attack: ['KeyJ', 'KeyZ'],
    cast: ['KeyK', 'KeyX'],
    wings: ['KeyE', 'KeyC'],
    hurt: ['KeyH'],
    mute: ['KeyM'],
    debug: ['Backquote', 'F3'],
    help: ['Slash', 'F1'],
  },
  // standard gamepad mapping
  buttons: { left: [14], right: [15], down: [13], jump: [0], run: [5, 7], attack: [2], cast: [1], wings: [4], debug: [8], help: [9] },
  axes: { left: { axis: 0, dir: -1 }, right: { axis: 0, dir: 1 }, down: { axis: 1, dir: 1 } },
};
