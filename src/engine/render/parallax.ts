import { fract, type Span } from '../core/math';
import type { SpriteRenderer, TextureBinding } from './sprite-renderer';

export interface ParallaxLayer {
  /** Bound with `repeat` so the layer wraps seamlessly. */
  binding: TextureBinding;
  /** World units per texel. */
  scale: number;
  /** World y of the image's top edge, as seen from the reference camera height. */
  top: number;
  /** How much the layer follows the camera: 0 = pinned to the screen, 1 = moves with the world. */
  factorX: number;
  factorY: number;
  saturation?: number;
  /** Packed haze colour + amount (see rgba()); pulls distant layers toward the sky. */
  fog?: number;
  /** Soft fade at the layer's top edge, in texels (hides art that is cut off at the top). */
  fadeTop?: number;
  /** The ground the characters walk on (it moves with the world): the background's `holes` are cut out of it. */
  ground?: boolean;
}

/**
 * Horizontally looping parallax layers, back to front. Each layer is one quad whose UVs scroll and
 * wrap, so it costs one instance however wide the world is. Layers in front of the action
 * (foliage, mist) are just another ParallaxBackground drawn after it, with factors above 1.
 */
export class ParallaxBackground {
  /** Gaps in the ground (world x, left to right), left out of the ground layer. */
  holes: readonly Span[] = [];
  /** How wide (world units) the ragged edge is where the ground stops at a hole; it's centred on the hole's edge. */
  holeEdge = 120;

  constructor(readonly layers: readonly ParallaxLayer[], private readonly referenceY: number) {}

  /** `beneathGround` draws what shows through the holes, just before the ground layer (with the view already set to the world). */
  draw(renderer: SpriteRenderer, cameraX: number, cameraY: number, viewWidth: number, viewHeight: number, beneathGround?: () => void): void {
    for (const layer of this.layers) {
      const vx = cameraX * layer.factorX, left = vx - viewWidth / 2, right = left + viewWidth;
      renderer.setView(vx, this.referenceY + (cameraY - this.referenceY) * layer.factorY, viewWidth, viewHeight);
      if (layer.ground) beneathGround?.();
      if (!layer.ground || this.holes.length === 0) { this.stretch(renderer, layer, left, right, -Infinity, Infinity); continue; }
      // the stretches of ground between the holes, each running a little way into the hole either side
      // where its ragged edge fades out (see fs_texture)
      const e = this.holeEdge / 2;
      let from = -Infinity;
      for (const h of this.holes) {
        this.stretch(renderer, layer, left, right, from, h.left + e);
        from = h.right - e;
      }
      this.stretch(renderer, layer, left, right, from, Infinity);
    }
  }

  /** Draws the layer from `from` to `to` (an infinite end is the view's edge; a finite one is cut raggedly), if it shows. */
  private stretch(renderer: SpriteRenderer, layer: ParallaxLayer, left: number, right: number, from: number, to: number): void {
    const a = Math.max(from, left), b = Math.min(to, right);
    if (b <= a) return;
    const x0 = Number.isFinite(from) ? from : a, x1 = Number.isFinite(to) ? to : b, w = x1 - x0;
    const { texture } = layer.binding, tileWidth = texture.width * layer.scale;
    // u is counted from a cut edge where there is one, so the ragged pattern there stays put as the camera moves
    const anchor = Number.isFinite(from) ? from : Number.isFinite(to) ? to : x0;
    const q = renderer.quad.reset();
    q.x = x0;
    q.y = layer.top;
    q.w = w;
    q.h = texture.height * layer.scale;
    q.originX = q.originY = 0;
    q.u0 = (x0 - anchor) / tileWidth + fract(anchor / tileWidth); // wrapped in doubles so the GPU only ever sees small UVs
    q.u1 = q.u0 + w / tileWidth;
    q.saturation = layer.saturation ?? 1;
    q.fog = layer.fog ?? 0;
    q.fadeTop = (layer.fadeTop ?? 0) / texture.height;
    if (Number.isFinite(from)) q.cutLeft = this.holeEdge / w;
    if (Number.isFinite(to)) q.cutRight = this.holeEdge / w;
    renderer.drawTexture(layer.binding);
  }
}
