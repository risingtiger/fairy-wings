import { SpriteSheet } from '../anim/sprite-sheet';
import { createTexture, loadBitmap, MipmapGenerator } from '../gpu/texture';
import type { SpriteRenderer, TextureBinding } from './sprite-renderer';

/** Loads images onto the GPU, bound and ready to draw with `renderer`. */
export class Loader {
  private readonly mips: MipmapGenerator;

  constructor(private readonly device: GPUDevice, private readonly renderer: SpriteRenderer) {
    this.mips = new MipmapGenerator(device);
  }

  /** An image as a texture; `repeat` wraps it horizontally (looping parallax layers). */
  async texture(url: string, repeat = false, maxMips?: number): Promise<TextureBinding> {
    const bitmap = await loadBitmap(url), texture = createTexture(this.device, this.mips, bitmap, url, maxMips);
    bitmap.close();
    return this.renderer.bind(texture, repeat);
  }

  /** A sprite sheet: the JSON written by tools/sprites, and its image (a few mips only, so cells don't bleed). */
  sheet(url: string): Promise<SpriteSheet> {
    return SpriteSheet.load(url, (image) => this.texture(image, false, 4));
  }
}
