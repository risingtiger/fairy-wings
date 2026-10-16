import type { InputBindings } from '../../engine/input/input';
import type { TouchPadOptions } from '../../engine/input/touch-pad';

export const ACTIONS = ['left', 'right', 'down', 'jump', 'run', 'attack', 'capture', 'cast', 'wings', 'hurt', 'mute', 'music', 'debug', 'help'] as const;
export type Action = (typeof ACTIONS)[number];

export const BINDINGS: InputBindings<Action> = {
  keys: {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    down: ['ArrowDown', 'KeyS'],
    jump: ['Space', 'ArrowUp', 'KeyW'],
    run: ['ShiftLeft', 'ShiftRight'],
    attack: ['KeyJ', 'KeyZ'],
    capture: ['KeyL'],
    cast: ['KeyK', 'KeyX'],
    wings: ['KeyE', 'KeyC'],
    hurt: ['KeyH'],
    mute: ['KeyM'], // all sound
    music: ['KeyN'],
    debug: ['Backquote', 'F3'],
    help: ['Slash', 'F1'],
  },
  // standard gamepad mapping
  buttons: { left: [14], right: [15], down: [13], jump: [0], run: [5, 7], attack: [2], capture: [3], cast: [1], wings: [4], debug: [8], help: [9] },
  axes: { left: { axis: 0, dir: -1 }, right: { axis: 0, dir: 1 }, down: { axis: 1, dir: 1 } },
};

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
/** A filled four-point twinkle centred on (x, y), `r` from its middle to a tip. */
const twinkle = (x: number, y: number, r: number) => {
  const k = r * 0.28;
  return `<path class="fill" d="M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z"/>`;
};
const WING = '<path class="fill" d="M12 10C10.5 5.5 5 3 3.6 6.6 2.5 9.6 6.5 11.6 12 11.6Z"/><path class="fill" d="M12 12.6c-4.6 0-7.4 1.8-6.4 4.6.9 2.3 4.3 1.5 6.4-3.4Z"/>';

/**
 * On touch screens (see TouchPad): a floating stick under the left thumb (pushed part way she walks
 * slowly, all the way she runs; down crouches) and round buttons under the right. Places and colours
 * are in hud.css.
 */
export const TOUCH: TouchPadOptions<Action> = {
  stick: { left: 'left', right: 'right', run: 'run', down: 'down' },
  buttons: [
    { action: 'jump', className: 'jump', label: 'Jump', icon: svg('<path d="M12 19.5V6M5.5 12 12 5.5l6.5 6.5"/>') },
    {
      action: 'capture', className: 'catch', label: 'Catch',
      icon: svg('<path d="M8 12.5V6.2M11 11.5V4.6M14 11.5V5.4M17 12.5V8.2"/><path d="M17 12v3a6 6 0 0 1-6 6 6.3 6.3 0 0 1-5.5-3.2L3.4 14a1.6 1.6 0 0 1 2.7-1.6L8 15"/>'),
    },
    { action: 'attack', className: 'wand', label: 'Wave your wand', icon: svg(`<path d="M4.5 19.5 14 10"/>${twinkle(17.5, 6.5, 5)}`) },
    { action: 'cast', className: 'magic', label: 'Magic', icon: svg(`${twinkle(9.5, 13.5, 7.5)}${twinkle(18.5, 5.5, 3.5)}${twinkle(18.5, 18, 2.6)}`) },
    { action: 'wings', className: 'wings', label: 'Wings on or away', icon: svg(`<path d="M12 7.5v11"/>${WING}<g transform="matrix(-1 0 0 1 24 0)">${WING}</g>`) },
  ],
};
