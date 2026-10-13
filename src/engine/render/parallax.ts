import type { Pixels } from './pixels';
import type { SpriteRenderer, TextureBinding } from './sprite-renderer';

/** A premultiplied colour, 0..1 per channel. */
export interface Rgba { r: number; g: number; b: number; a: number }

export interface ParallaxLayer {
  /** Bound with `{ repeat: true }` so the layer wraps seamlessly. */
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
  /** A copy of the image in memory (any size), so sample() can tell what colour the layer shows where. */
  pixels?: Pixels;
}

/**
 * Horizontally looping parallax layers. Each layer is one quad whose UVs scroll and wrap,
 * so it costs one instance however wide the world is.
 */
export class ParallaxBackground {
  constructor(readonly layers: ParallaxLayer[], private readonly referenceY: number) {}

  draw(renderer: SpriteRenderer, cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): void {
    for (const layer of this.layers) {
      const vx = cameraX * layer.factorX;
      const vy = this.referenceY + (cameraY - this.referenceY) * layer.factorY;
      renderer.setView(vx, vy, viewWidth, viewHeight);
      const { texture } = layer.binding;
      const tileWidth = texture.width * layer.scale;
      const left = vx - viewWidth / 2;
      const u = left / tileWidth;
      const q = renderer.quad.reset();
      q.x = left;
      q.y = layer.top;
      q.w = viewWidth;
      q.h = texture.height * layer.scale;
      q.originX = 0;
      q.originY = 0;
      q.u0 = u - Math.floor(u); // wrap in doubles so the GPU only ever sees small UVs
      q.u1 = q.u0 + viewWidth / tileWidth;
      q.saturation = layer.saturation ?? 1;
      q.fog = layer.fog ?? 0;
      q.fadeTop = (layer.fadeTop ?? 0) / texture.height;
      renderer.drawTexture(layer.binding);
    }
  }

  /**
   * The colour the layers paint at world point (x, y) for a camera centred at (cameraX, cameraY), as
   * draw() would show it (saturation, haze and edge fades included). Composited from layer `first`
   * upward over transparent black, so `out.a` says how much of the point those layers cover; layers
   * without `pixels` are skipped. Nearest-texel lookup, no allocation.
   */
  sample(x: number, y: number, cameraX: number, cameraY: number, out: Rgba, first = 0): Rgba {
    out.r = out.g = out.b = out.a = 0;
    for (let i = first; i < this.layers.length; i++) {
      const layer = this.layers[i], px = layer.pixels;
      if (!px) continue;
      const { texture } = layer.binding;
      const vy = this.referenceY + (cameraY - this.referenceY) * layer.factorY;
      const v = (vy + y - cameraY - layer.top) / (texture.height * layer.scale);
      if (v < 0 || v >= 1) continue;
      const u = (cameraX * layer.factorX + x - cameraX) / (texture.width * layer.scale);
      const o = (Math.floor(v * px.height) * px.width + Math.floor((u - Math.floor(u)) * px.width)) * 4;
      let a = px.data[o + 3] / 255;
      if (layer.fadeTop) { const t = Math.min(1, (v * texture.height) / layer.fadeTop); a *= t * t * (3 - 2 * t); }
      if (a <= 0) continue;
      let r = (px.data[o] / 255) * a, g = (px.data[o + 1] / 255) * a, b = (px.data[o + 2] / 255) * a;
      const sat = layer.saturation ?? 1;
      if (sat !== 1) {
        const grey = r * 0.299 + g * 0.587 + b * 0.114;
        r = grey + (r - grey) * sat; g = grey + (g - grey) * sat; b = grey + (b - grey) * sat;
      }
      const fog = layer.fog ?? 0, haze = (fog >>> 24) / 255;
      if (haze > 0) {
        r += (((fog & 255) / 255) * a - r) * haze;
        g += ((((fog >>> 8) & 255) / 255) * a - g) * haze;
        b += ((((fog >>> 16) & 255) / 255) * a - b) * haze;
      }
      const k = 1 - a; // this layer over what's behind it
      out.r = r + out.r * k; out.g = g + out.g * k; out.b = b + out.b * k; out.a = a + out.a * k;
    }
    return out;
  }
}
