// Minimal PNG reader/writer (8-bit RGB/RGBA, non-interlaced). Node built-ins only.
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

/** Writes RGBA (straight alpha) as an 8-bit PNG. */
export function encodePNG(file, w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}
