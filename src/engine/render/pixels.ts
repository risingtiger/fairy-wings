/** An image held in memory for CPU-side colour lookups: straight-alpha RGBA, row by row. */
export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * Copies a bitmap into memory at `scale` of its size. A small copy is cheap to keep and averages fine
 * detail away, which is what a lookup like "what colour is behind this point" wants.
 */
export function readPixels(bitmap: ImageBitmap, scale = 1): Pixels {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('readPixels: no 2D canvas available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}
