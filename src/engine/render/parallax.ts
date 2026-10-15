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
}

/**
 * Horizontally looping parallax layers, back to front. Each layer is one quad whose UVs scroll and
 * wrap, so it costs one instance however wide the world is. Layers in front of the action
 * (foliage, mist) are just another ParallaxBackground drawn after it, with factors above 1.
 */
export class ParallaxBackground {
  constructor(readonly layers: readonly ParallaxLayer[], private readonly referenceY: number) {}

  draw(renderer: SpriteRenderer, cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): void {
    for (const layer of this.layers) {
      const vx = cameraX * layer.factorX;
      renderer.setView(vx, this.referenceY + (cameraY - this.referenceY) * layer.factorY, viewWidth, viewHeight);
      const { texture } = layer.binding;
      const tileWidth = texture.width * layer.scale, left = vx - viewWidth / 2, u = left / tileWidth;
      const q = renderer.quad.reset();
      q.x = left;
      q.y = layer.top;
      q.w = viewWidth;
      q.h = texture.height * layer.scale;
      q.originX = q.originY = 0;
      q.u0 = u - Math.floor(u); // wrap in doubles so the GPU only ever sees small UVs
      q.u1 = q.u0 + viewWidth / tileWidth;
      q.saturation = layer.saturation ?? 1;
      q.fog = layer.fog ?? 0;
      q.fadeTop = (layer.fadeTop ?? 0) / texture.height;
      renderer.drawTexture(layer.binding);
    }
  }
}
