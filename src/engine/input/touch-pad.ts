import type { Input } from './input';

/** A round on-screen button: the action it holds, a class for its place and look, its icon (SVG markup) and a name for screen readers. */
export interface TouchButton<A extends string> { action: A; className: string; icon: string; label: string }

export interface TouchPadOptions<A extends string> {
  /**
   * The stick: pushed left or right it holds those actions (harder the further it goes), pushed nearly
   * all the way across it holds `run` as well, and pushed down it holds `down`.
   */
  stick: { left: A; right: A; run?: A; down?: A };
  buttons: readonly TouchButton<A>[];
}

/** The stick, in CSS pixels and fractions of its reach. */
const STICK = {
  /** How far the knob goes from the middle; a thumb sliding further drags the whole stick along. */
  reach: 64,
  /** Ignored around the middle, so a resting thumb doesn't creep her along. */
  dead: 0.18,
  /** Just past the dead zone it holds left or right this hard, rising to fully at `full`. */
  slowest: 0.45,
  full: 0.7,
  /** Pushed this far across, it holds `run` too. */
  run: 0.88,
  /** Pushed this far down (and more down than across), it holds `down`. */
  down: 0.6,
} as const;

/**
 * On-screen controls for touch screens, laid out the way most mobile games do it: a floating stick for
 * the left thumb (it appears wherever the thumb lands on the left of the screen and follows it if it
 * slides too far) and round buttons for the right. They hold an Input's actions just as keys do, so
 * several can be held at once. Its look and the buttons' places are all CSS (.touch-pad and below).
 */
export class TouchPad<A extends string> {
  readonly element: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<A, HTMLElement>();
  /** The pointer on each button that's down (by action), and on the stick. */
  private readonly pressing = new Map<A, number>();
  private stickId: number | null = null;
  /** Where the stick's middle is (client pixels) while a thumb is on it. */
  private cx = 0;
  private cy = 0;
  private on = true;

  constructor(parent: HTMLElement, private readonly input: Input<A>, private readonly options: TouchPadOptions<A>) {
    const make = (className: string, tag = 'div') => Object.assign(document.createElement(tag), { className });
    this.element = make('touch-pad');
    this.zone = make('stick-zone');
    this.stick = make('stick');
    this.knob = make('knob');
    this.stick.append(this.knob);
    this.zone.append(this.stick);
    this.element.append(this.zone);
    for (const b of options.buttons) {
      const button = make(`pad-button ${b.className}`, 'button');
      button.innerHTML = b.icon;
      button.tabIndex = -1;
      button.setAttribute('aria-label', b.label);
      this.listen(button, b.action);
      this.buttons.set(b.action, button);
      this.element.append(button);
    }

    const zone = this.zone;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.cx = e.clientX;
      this.cy = e.clientY;
      this.stick.classList.add('active');
      this.steer(e);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.steer(e); });
    const letGo = (e: PointerEvent) => { if (e.pointerId === this.stickId) this.releaseStick(e.timeStamp); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) zone.addEventListener(type, letGo);
    // no scrolling, zooming, text callouts or swiping back a page from the controls
    this.element.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    parent.append(this.element);
  }

  /** Off, the controls fade away and let go of everything they hold (say, while she stands reading). */
  get enabled(): boolean { return this.on; }
  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.element.classList.toggle('off', !on);
    if (!on) this.letGoAll();
  }

  /** Shows or hides a button (say, one for something she can't do yet). */
  show(action: A, visible: boolean): void {
    const button = this.buttons.get(action);
    if (!button || button.hidden === !visible) return;
    button.hidden = !visible;
    if (!visible) this.releaseButton(action, performance.now());
  }

  private listen(button: HTMLElement, action: A): void {
    button.addEventListener('pointerdown', (e) => {
      if (this.pressing.has(action)) return;
      this.pressing.set(action, e.pointerId);
      button.setPointerCapture(e.pointerId);
      button.classList.add('pressed');
      this.input.hold(action, true, e.timeStamp);
    });
    const up = (e: PointerEvent) => { if (this.pressing.get(action) === e.pointerId) this.releaseButton(action, e.timeStamp); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, up);
  }

  /** The thumb on the stick moved: the knob follows it (the stick too, past its reach), and that sets which way and how hard. */
  private steer(e: PointerEvent): void {
    let dx = e.clientX - this.cx, dy = e.clientY - this.cy;
    const d = Math.hypot(dx, dy), reach = STICK.reach;
    if (d > reach) {
      this.cx += dx * (1 - reach / d);
      this.cy += dy * (1 - reach / d);
      dx *= reach / d;
      dy *= reach / d;
    }
    const box = this.zone.getBoundingClientRect();
    this.stick.style.left = `${this.cx - box.left}px`;
    this.stick.style.top = `${this.cy - box.top}px`;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

    const s = this.options.stick, t = e.timeStamp, x = dx / reach, y = dy / reach, across = Math.abs(x);
    const moving = across > STICK.dead;
    const strength = Math.min(1, STICK.slowest + ((1 - STICK.slowest) * (across - STICK.dead)) / (STICK.full - STICK.dead));
    this.input.hold(s.left, moving && x < 0, t, strength);
    this.input.hold(s.right, moving && x > 0, t, strength);
    if (s.run) this.input.hold(s.run, across >= STICK.run, t);
    if (s.down) this.input.hold(s.down, y >= STICK.down && y > across, t);
  }

  private releaseStick(time: number): void {
    const s = this.options.stick, id = this.stickId;
    this.stickId = null;
    if (id !== null && this.zone.hasPointerCapture(id)) this.zone.releasePointerCapture(id);
    for (const action of [s.left, s.right, s.run, s.down]) if (action) this.input.hold(action, false, time);
    this.stick.classList.remove('active');
    this.stick.style.left = this.stick.style.top = '';
    this.knob.style.transform = '';
  }

  private releaseButton(action: A, time: number): void {
    const id = this.pressing.get(action), button = this.buttons.get(action);
    if (id === undefined || !button) return;
    this.pressing.delete(action);
    if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    button.classList.remove('pressed');
    this.input.hold(action, false, time);
  }

  private letGoAll(): void {
    const now = performance.now();
    this.releaseStick(now);
    for (const action of [...this.pressing.keys()]) this.releaseButton(action, now);
  }
}
