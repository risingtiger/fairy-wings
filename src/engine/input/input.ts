export interface InputBindings<A extends string> {
  /** KeyboardEvent.code values per action. */
  keys: Partial<Record<A, string[]>>;
  /** Standard-mapping gamepad button indices per action. */
  buttons?: Partial<Record<A, number[]>>;
  /** Stick directions per action: axis index and sign. */
  axes?: Partial<Record<A, { axis: number; dir: -1 | 1 }>>;
}

const AXIS_THRESHOLD = 0.35;
/** Letters remembered for typed(). */
const TYPED_HISTORY = 16;

/**
 * Action-based input over keyboard and gamepads. Presses are timestamped so gameplay can buffer them
 * (e.g. a jump pressed just before landing still counts).
 */
export class Input<A extends string> {
  private readonly index = new Map<A, number>();
  private readonly keyActions = new Map<string, number[]>();
  private readonly keyHeld: Uint8Array;
  private readonly padHeld: Uint8Array;
  private readonly pressedAt: Float64Array;
  private readonly consumed: Uint8Array;
  /** The last few letters typed (lower case) and when, oldest first, for typed(). */
  private readonly typedKeys: string[] = [];
  private readonly typedAt: number[] = [];

  constructor(target: Window, readonly actions: readonly A[], private readonly bindings: InputBindings<A>) {
    actions.forEach((a, i) => this.index.set(a, i));
    this.keyHeld = new Uint8Array(actions.length);
    this.padHeld = new Uint8Array(actions.length);
    this.pressedAt = new Float64Array(actions.length).fill(-Infinity);
    this.consumed = new Uint8Array(actions.length).fill(1);
    for (const a of actions) for (const code of bindings.keys[a] ?? []) {
      const list = this.keyActions.get(code) ?? [];
      list.push(this.index.get(a)!);
      this.keyActions.set(code, list);
    }
    target.addEventListener('keydown', (e) => {
      if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && /^[a-z]$/i.test(e.key)) this.remember(e.key.toLowerCase(), e.timeStamp);
      const list = this.keyActions.get(e.code);
      if (!list || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      if (e.repeat) return;
      for (const i of list) { if (!this.keyHeld[i]) this.press(i, e.timeStamp); this.keyHeld[i] = 1; }
    });
    target.addEventListener('keyup', (e) => {
      for (const i of this.keyActions.get(e.code) ?? []) this.keyHeld[i] = 0;
    });
    target.addEventListener('blur', () => { this.keyHeld.fill(0); this.padHeld.fill(0); });
  }

  /** Polls gamepads; call once per frame before simulating. */
  poll(now: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const { buttons = {}, axes = {} } = this.bindings;
    for (let i = 0; i < this.actions.length; i++) {
      const a = this.actions[i];
      let held = false;
      for (const pad of pads) {
        if (!pad) continue;
        for (const b of (buttons as Record<string, number[]>)[a] ?? []) if (pad.buttons[b]?.pressed) held = true;
        const ax = (axes as Record<string, { axis: number; dir: number }>)[a];
        if (ax && (pad.axes[ax.axis] ?? 0) * ax.dir > AXIS_THRESHOLD) held = true;
      }
      if (held && !this.padHeld[i] && !this.keyHeld[i]) this.press(i, now);
      this.padHeld[i] = held ? 1 : 0;
    }
  }

  down(action: A): boolean {
    const i = this.index.get(action)!;
    return this.keyHeld[i] === 1 || this.padHeld[i] === 1;
  }

  /** True once per press if it happened within the last `bufferMs`; the press is then used up. */
  take(action: A, now: number, bufferMs = 0): boolean {
    const i = this.index.get(action)!;
    if (this.consumed[i] || now - this.pressedAt[i] > bufferMs) return false;
    this.consumed[i] = 1;
    return true;
  }

  /**
   * True if the last letters typed spell `word` (lower case), all of them after `since` (a frame
   * timestamp, ms) and each within `gapMs` of the one before. Bound or not, every letter key counts.
   */
  typed(word: string, since: number, gapMs = 2000): boolean {
    const n = this.typedKeys.length, w = word.length;
    if (n < w) return false;
    for (let i = 0; i < w; i++) {
      const j = n - w + i;
      if (this.typedKeys[j] !== word[i] || this.typedAt[j] < since) return false;
      if (i > 0 && this.typedAt[j] - this.typedAt[j - 1] > gapMs) return false;
    }
    return true;
  }

  private remember(letter: string, time: number): void {
    this.typedKeys.push(letter);
    this.typedAt.push(time);
    if (this.typedKeys.length > TYPED_HISTORY) { this.typedKeys.shift(); this.typedAt.shift(); }
  }

  private press(i: number, time: number): void {
    this.pressedAt[i] = time;
    this.consumed[i] = 0;
  }
}
