/** Colours are packed into a u32: r, g, b, a bytes (little-endian), straight alpha. */

/** Packs a colour: r, g, b in 0..255, alpha in 0..1. */
export function rgba(r: number, g: number, b: number, a = 1): number {
  return ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((Math.round(a * 255) & 255) << 24)) >>> 0;
}

function hslChannel(n: number, h12: number, l: number, c: number): number {
  const k = (n + h12) % 12;
  return Math.round(255 * (l - c * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
}

/** Packs a colour from hue (turns, wraps), saturation and lightness (0..1), alpha 0..1. */
export function hsla(h: number, s: number, l: number, a = 1): number {
  const h12 = (h - Math.floor(h)) * 12, c = s * Math.min(l, 1 - l);
  return rgba(hslChannel(0, h12, l, c), hslChannel(8, h12, l, c), hslChannel(4, h12, l, c), a);
}

/** The same colour with a new opacity (0..1). */
export const withAlpha = (color: number, a: number) => ((color & 0x00ffffff) | ((Math.round(Math.max(0, Math.min(1, a)) * 255) & 255) << 24)) >>> 0;

/** `color` moved `t` of the way toward `to` (both packed; alpha ignored), with opacity `a`. */
export function mixColor(color: number, to: number, t: number, a: number): number {
  const r = color & 255, g = (color >>> 8) & 255, b = (color >>> 16) & 255;
  return rgba(r + ((to & 255) - r) * t, g + (((to >>> 8) & 255) - g) * t, b + (((to >>> 16) & 255) - b) * t, a);
}

/** `n` hues evenly round the colour wheel (from `from` to `to` turns), for picking at random without per-pixel maths. */
export const hues = (n: number, s: number, l: number, from = 0, to = 1, a = 1) =>
  Array.from({ length: n }, (_, i) => hsla(from + ((to - from) * i) / n, s, l, a));

export const WHITE = 0xffffffff;
