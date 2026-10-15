import { Damped, lerp } from '../core/math';

/**
 * A side-scrolling camera. It eases after a target (critically damped, so it never overshoots),
 * leads the way the target is heading, and is interpolated between simulation steps so drawing stays
 * smooth at any refresh rate. The view is always `height` world units tall; its width follows the
 * screen's aspect.
 */
export class Camera {
  width: number;
  /** The centre to draw from this frame (see frame()). */
  readonly view = { x: 0, y: 0 };
  private readonly cx: Damped;
  private readonly cy: Damped;
  private readonly lead = new Damped(0);
  private prevX: number;
  private prevY: number;

  constructor(readonly height: number, x = 0, y = 0, aspect = 16 / 9) {
    this.width = height * aspect;
    this.cx = new Damped(x);
    this.cy = new Damped(y);
    this.prevX = x;
    this.prevY = y;
  }

  /** The simulated centre (this step). */
  get x(): number { return this.cx.value; }
  get y(): number { return this.cy.value; }

  /**
   * One simulation step toward (x + lead, y). The lead eases over `leadTime` seconds, so turning round
   * pans across smoothly; `smoothX`/`smoothY` are roughly the seconds to catch up.
   */
  follow(x: number, y: number, lead: number, dt: number, smoothX: number, smoothY: number, leadTime = 0.7): void {
    this.prevX = this.cx.value;
    this.prevY = this.cy.value;
    this.lead.update(lead, leadTime, dt);
    this.cx.update(x + this.lead.value, smoothX, dt);
    this.cy.update(y, smoothY, dt);
  }

  /** Hard vertical limits for this step, so a fast climb or dive never leaves the target off screen. */
  clampY(minY: number, maxY: number): void {
    const y = this.cy;
    if (y.value < minY) { y.value = minY; y.velocity = Math.max(0, y.velocity); }
    if (y.value > maxY) { y.value = maxY; y.velocity = Math.min(0, y.velocity); }
  }

  /** Interpolates the centre between the last two steps for drawing, and fits the width to `aspect`. */
  frame(alpha: number, aspect: number): Readonly<{ x: number; y: number }> {
    this.width = this.height * aspect;
    this.view.x = lerp(this.prevX, this.cx.value, alpha);
    this.view.y = lerp(this.prevY, this.cy.value, alpha);
    return this.view;
  }
}
