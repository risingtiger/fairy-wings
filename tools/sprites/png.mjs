// Minimal PNG reader/writer (8-bit RGB/RGBA, non-interlaced) and sprite-edge helpers. Node built-ins only.
import fs from 'node:fs';
import zlib from 'node:zlib';

/** @returns {{ w: number, h: number, hasAlpha: boolean, d: Uint8Array }} RGBA, straight alpha */
export function decodePNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  let i = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), tag = buf.toString('ascii', i + 4, i + 8), body = buf.subarray(i + 8, i + 8 + len);
    i += 12 + len;
    if (tag === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (depth !== 8 || interlace !== 0 || !bpp) throw new Error(`${file}: only 8-bit non-interlaced RGB/RGBA is supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = new Uint8Array(h * stride);
  for (let y = 0, p = 0; y < h; y++) {
    const filter = raw[p++], row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[prev + x] : 0, c = y && x >= bpp ? px[prev + x - bpp] : 0;
      let v = raw[p + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v;
    }
    p += stride;
  }
  const d = new Uint8Array(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    d[k * 4] = px[k * bpp]; d[k * 4 + 1] = px[k * bpp + 1]; d[k * 4 + 2] = px[k * bpp + 2];
    d[k * 4 + 3] = bpp === 4 ? px[k * bpp + 3] : 255;
  }
  return { w, h, hasAlpha: bpp === 4, d };
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (bytes) => { let c = -1; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (tag, body) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tagged = Buffer.concat([Buffer.from(tag, 'ascii'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tagged));
  return Buffer.concat([len, tagged, crc]);
};

/** Paeth predictor (PNG filter 4). */
function paeth(a, b, c) {
  const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Writes RGBA (straight alpha) as an 8-bit PNG: RGB when every pixel is opaque, and each row run
 * through whichever PNG filter leaves the smallest residuals, so it compresses well.
 */
export function encodePNG(file, w, h, rgba) {
  let opaque = true;
  for (let k = 3; k < rgba.length; k += 4) if (rgba[k] !== 255) { opaque = false; break; }
  const bpp = opaque ? 3 : 4, stride = w * bpp, px = new Uint8Array(h * stride);
  for (let k = 0; k < w * h; k++) for (let c = 0; c < bpp; c++) px[k * bpp + c] = rgba[k * 4 + c];
  const raw = Buffer.alloc(h * (stride + 1)), row = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const at = y * stride, out = y * (stride + 1);
    let bestScore = Infinity;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const v = px[at + x], a = x >= bpp ? px[at + x - bpp] : 0, b = y ? px[at - stride + x] : 0, c = y && x >= bpp ? px[at - stride + x - bpp] : 0;
        const r = (v - (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 255;
        row[x] = r;
        score += r < 128 ? r : 256 - r;
      }
      if (score < bestScore) { bestScore = score; raw[out] = filter; raw.set(row, out + 1); }
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/**
 * Bleeds edge colours into fully transparent neighbours (`passes` pixels deep, in place), so texture
 * filtering never pulls in black around a sprite's edges.
 */
export function bleedEdges(d, w, h, passes = 4) {
  for (let pass = 0; pass < passes; pass++) {
    const fill = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = (y * w + x) * 4;
      if (d[t + 3] || d[t] || d[t + 1] || d[t + 2]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const u = (yy * w + xx) * 4;
        if (d[u + 3] || d[u] || d[u + 1] || d[u + 2]) { r += d[u]; g += d[u + 1]; b += d[u + 2]; n++; }
      }
      if (n) fill.push(t, Math.round(r / n) || 1, Math.round(g / n) || 1, Math.round(b / n) || 1);
    }
    for (let j = 0; j < fill.length; j += 4) { d[fill[j]] = fill[j + 1]; d[fill[j] + 1] = fill[j + 2]; d[fill[j] + 2] = fill[j + 3]; }
  }
}
