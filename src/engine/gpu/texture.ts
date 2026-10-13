import type { MipmapGenerator } from './mipmaps';

export interface Texture {
  readonly gpu: GPUTexture;
  readonly view: GPUTextureView;
  readonly width: number;
  readonly height: number;
  readonly url: string;
}

export interface TextureOptions {
  /** Maximum mip levels (atlases want a few, so cells don't bleed into each other when small). */
  maxMips?: number;
}

/** Loads an image into a premultiplied-alpha rgba8 texture with a GPU-built mip chain. */
export async function loadTexture(device: GPUDevice, mips: MipmapGenerator, url: string, options: TextureOptions = {}): Promise<Texture> {
  const bitmap = await loadBitmap(url);
  const texture = createTexture(device, mips, bitmap, url, options);
  bitmap.close();
  return texture;
}

/** Fetches and decodes an image as stored (straight alpha, no colour conversion). */
export async function loadBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

/** Uploads a decoded image (see loadBitmap) as a premultiplied-alpha texture; the bitmap stays usable. */
export function createTexture(device: GPUDevice, mips: MipmapGenerator, bitmap: ImageBitmap, label: string, options: TextureOptions = {}): Texture {
  const { width, height } = bitmap;
  const fullChain = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const gpu = device.createTexture({
    label,
    size: [width, height],
    format: 'rgba8unorm',
    mipLevelCount: Math.min(fullChain, options.maxMips ?? fullChain),
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: gpu, premultipliedAlpha: true }, [width, height]);
  mips.generate(gpu);
  return { gpu, view: gpu.createView(), width, height, url: label };
}

/** A 1x1 white texture, used where a pipeline needs a texture binding but draws procedurally. */
export function createWhiteTexture(device: GPUDevice): Texture {
  const gpu = device.createTexture({ label: 'white', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: gpu }, new Uint8Array([255, 255, 255, 255]), {}, [1, 1]);
  return { gpu, view: gpu.createView(), width: 1, height: 1, url: 'white' };
}
