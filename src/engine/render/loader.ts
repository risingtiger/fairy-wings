import { SpriteSheet } from '../anim/sprite-sheet';
import { createTexture, loadBitmap, MipmapGenerator } from '../gpu/texture';
import type { SpriteRenderer, TextureBinding } from './sprite-renderer';

/**
 * Which copy of the art to load. 'high' is the full-size images; 'low' the half-size copies under
 * <root>/low/ (made by tools/sprites/make-low.mjs): a quarter of the GPU memory and much less to
 * download, for older iPads and other modest GPUs. Textures report their full size either way, so
 * sprite sheets, parallax layers and everything placed by them come out the same, just softer.
 */
export type Tier = 'high' | 'low';

/** Low-tier images: where they live (under the asset root) and their size relative to the full images. */
const LOW = { folder: 'low/', resolution: 0.5 } as const;

interface Loaded { readonly binding: TextureBinding; readonly url: string; readonly repeat: boolean; readonly maxMips?: number }

/** Loads images onto the GPU at the current tier, bound and ready to draw with `renderer`. */
export class Loader {
  private readonly mips: MipmapGenerator;
  private readonly loaded: Loaded[] = [];
  private readonly root: string;

  constructor(private readonly device: GPUDevice, private readonly renderer: SpriteRenderer, private current: Tier = 'high', root = import.meta.env.BASE_URL) {
    this.mips = new MipmapGenerator(device);
    this.root = new URL(root, location.href).pathname;
  }

  get tier(): Tier { return this.current; }

  /** An image as a texture; `repeat` wraps it horizontally (looping parallax layers). */
  async texture(url: string, repeat = false, maxMips?: number): Promise<TextureBinding> {
    const binding = await this.bind(url, repeat, maxMips);
    this.loaded.push({ binding, url, repeat, maxMips });
    return binding;
  }

  /** A sprite sheet: the JSON written by tools/sprites, and its image (a few mips only, so cells don't bleed). */
  sheet(url: string): Promise<SpriteSheet> {
    return SpriteSheet.load(url, (image) => this.texture(image, false, 4));
  }

  /**
   * Switches everything loaded so far to `tier`, swapping each texture in place: whatever holds it draws
   * the new one from the next frame, and the old one's memory is freed.
   */
  async setTier(tier: Tier): Promise<void> {
    if (tier === this.current) return;
    this.current = tier;
    await Promise.all(this.loaded.map(async (l) => {
      const fresh = await this.bind(l.url, l.repeat, l.maxMips), old = l.binding.texture.gpu;
      Object.assign(l.binding, fresh);
      old.destroy();
    }));
  }

  private async bind(url: string, repeat: boolean, maxMips?: number): Promise<TextureBinding> {
    const low = this.current === 'low', bitmap = await loadBitmap(low ? this.lowCopy(url) : url);
    const texture = createTexture(this.device, this.mips, bitmap, url, maxMips, low ? LOW.resolution : 1);
    bitmap.close();
    return this.renderer.bind(texture, repeat);
  }

  /** Where the low-tier copy of an image under the asset root is: the same path under low/. */
  private lowCopy(url: string): string {
    const u = new URL(url, location.href);
    if (!u.pathname.startsWith(this.root)) throw new Error(`${url} is outside the asset root ${this.root}`);
    u.pathname = this.root + LOW.folder + u.pathname.slice(this.root.length);
    return u.href;
  }
}
