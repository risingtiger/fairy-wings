/** What a pointer is: a mouse, a finger or a pen. */
export type PointerKind = 'mouse' | 'touch' | 'pen';

/**
 * The primary pointer over an element: the mouse, or the first finger or pen to touch it (others
 * are ignored until it lifts). Positions are fractions of the element's box (0..1 across and down),
 * so the game can map them into any view; times are event timestamps, on the frame clock.
 */
export class Pointer {
  /** Where it is (or was last), 0..1 across and down the element. */
  u = 0.5;
  v = 0.5;
  kind: PointerKind = 'mouse';
  /** A finger or pen touching, or a mouse button held. */
  pressed = false;
  /** Touching the element (a finger or pen), or over it (a mouse, pressed or not). */
  inside = false;
  /** Where and when the latest press began. */
  readonly pressStart = { u: 0, v: 0, at: -Infinity };
  private id: number | null = null;

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', (e) => {
      if (this.pressed && e.pointerId !== this.id) return;
      e.preventDefault(); // no text selection or callouts
      this.follow(e);
      this.pressed = true;
      Object.assign(this.pressStart, { u: this.u, v: this.v, at: e.timeStamp });
      element.setPointerCapture(e.pointerId); // keep it even if it slides off the edge
    });
    element.addEventListener('pointermove', (e) => {
      if (this.pressed && e.pointerId !== this.id) return;
      if (e.pointerType === 'mouse' || this.pressed) this.follow(e);
    });
    const lift = (e: PointerEvent) => {
      if (e.pointerId !== this.id) return;
      this.pressed = false;
      if (this.kind !== 'mouse') this.inside = false;
    };
    element.addEventListener('pointerup', lift);
    element.addEventListener('pointercancel', lift);
    element.addEventListener('pointerleave', (e) => { if (e.pointerId === this.id && !this.pressed) this.inside = false; });
    window.addEventListener('blur', () => { this.pressed = this.inside = false; });
  }

  private follow(e: PointerEvent): void {
    const r = this.element.getBoundingClientRect();
    this.id = e.pointerId;
    this.kind = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse';
    this.inside = true;
    this.u = (e.clientX - r.left) / r.width;
    this.v = (e.clientY - r.top) / r.height;
  }
}
