// Renders the extension icons from src/logo.js. No dependencies.
// Run: node tools/make-icons.js   → icons/icon{16,32,48,128}.png and icons/logo.svg
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { LOGO_RECTS } = require('../src/logo.js');

const OUT = path.join(__dirname, '..', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 8; // supersampling per axis, for anti-aliased edges

function hex(c) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

function insideRoundRect(px, py, [x, y, w, h, r]) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function render(size) {
  const k = 128 / size;
  const shapes = LOGO_RECTS.map((r) => ({ r, rgb: hex(r[5]) }));
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let R = 0, G = 0, B = 0, A = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const gx = (x + (sx + 0.5) / SS) * k;
          const gy = (y + (sy + 0.5) / SS) * k;
          let hit = null;
          for (const s of shapes) if (insideRoundRect(gx, gy, s.r)) hit = s; // last one wins
          if (hit) { R += hit.rgb[0]; G += hit.rgb[1]; B += hit.rgb[2]; A += 1; }
        }
      }
      const i = (y * size + x) * 4;
      if (A) {
        px[i] = Math.round(R / A);
        px[i + 1] = Math.round(G / A);
        px[i + 2] = Math.round(B / A);
      }
      px[i + 3] = Math.round((A / (SS * SS)) * 255);
    }
  }
  return px;
}

// --- minimal PNG encoder (RGBA, 8 bit) ---
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg() {
  const rects = LOGO_RECTS.map(([x, y, w, h, r, f]) =>
    `  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">\n${rects}\n</svg>\n`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const s of SIZES) {
  const file = path.join(OUT, `icon${s}.png`);
  fs.writeFileSync(file, png(s, render(s)));
  console.log('wrote', path.relative(process.cwd(), file));
}
fs.writeFileSync(path.join(OUT, 'logo.svg'), svg());
console.log('wrote', path.relative(process.cwd(), path.join(OUT, 'logo.svg')));
